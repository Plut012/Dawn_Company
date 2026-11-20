// A fixed set of seeded matches, played straight through the rules (no
// server): the same seeds always give the same matches. Used two ways:
//   - `src/rules/digest.test.ts` pins a digest of every match, so a change
//     that was meant to keep the game as it is can prove that it did;
//   - `npx tsx scripts/seeded.ts` prints the digests and the play figures
//     (units down, ambushes sprung, score) for the designer's tuning;
//     `--figures <n>` plays n matches instead and prints only the figures,
//     with each seat's mean score and share of the wins for 2, 3 and 4
//     squads (task 15); `--mode <id>` plays them in that mode (default supply-line;
//     Last Stand deals only presets it allows); `--no-follow` with it plays them without any
//     move-then-act orders (the script of before task 14, on today's rules);
//     `--same <preset id>` gives every seat that preset instead of a random
//     one, so a difference between seats is the board's and not the draw's.
//     The figures also give, by objective kind (task 21), how often its flags were held
//     and by whom at the end (`kindFigures`).
// The players are not opponents: each unit takes a random legal order from
// `orderOptions` on its own player's view, leaning towards contact: a move
// mostly heads for a random objective, by walking steps (22; a beeline before),
// any equally near end at random. A unit
// told to move adds a follow-up (task 14) when its action allows one and an
// enemy it sees (for a medic: a pinned friend) is in reach of the end of its
// path, with a clear line from there, most of the time; now and then it adds
// one blind. Each round a player also buys back (task 18) a downed man it can
// afford, now and then (`BUY_CHANCE` for each one it could). An engineer (25) builds now and then
// (`BUILD_CHANCE` a round, when his side can pay for a work): a random work it can afford, on a random hex he may
// build on, never wire where one of his own side stands; and now and then as a move's follow-up.

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DEFAULT_MODE, mapFor, MODES, PRESETS, TERRAIN, UNITS, WORKS } from '../src/content';
import { actionOf, benefitOf, buyBackCost, canSee, hqOf, lineOpen, createMatch, findPath, followUpOptions, moveOf, orderOptions, resolve, sightOf, viewFor } from '../src/rules';
import { distance, neighbors, parseKey, key } from '../src/shared/hex';
import type { GameEvent, GameMap, GameState, Hex, ModeId, Objective, Order, PlayerId, Purchase } from '../src/shared/types';

export const SEEDS: readonly number[] = Array.from({ length: 50 }, (_, i) => 1001 + i);
/** Ten more, pinned for Last Stand (20): the same script, played in that mode. */
export const LAST_STAND_SEEDS: readonly number[] = Array.from({ length: 10 }, (_, i) => 2001 + i);

/**
 * Fields left out of the digest. Stage A of task 12 added `action` to four
 * events without changing how the game plays, and proved it by leaving that
 * one field out and getting the digests of the engine before it. Stage B
 * changed the rules on purpose, the digests were recorded afresh, and since
 * then nothing is left out. (Task 17 used it once, in passing: it added `mode` to
 * the match state, left it out and got task 16's digests unchanged, then
 * recorded them afresh with it in.)
 */
export const ADDED_FIELDS: readonly string[] = [];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How often a player buys back a man it could afford, each round (18). */
export const BUY_CHANCE = 0.3;
/** (25) How often an engineer whose side can pay for a work builds one, each round. */
export const BUILD_CHANCE = 0.3;

/** The buy-backs a player makes this round: each down man it may bring back and can still afford, now and then, in id order. */
export function scriptedPurchases(state: GameState, player: PlayerId, rnd: () => number): Purchase[] {
  const out: Purchase[] = [];
  let left = state.scores[player];
  for (const u of state.units) {
    if (u.owner !== player) continue;
    const cost = buyBackCost(state, u.id);
    if (cost === null || cost > left) continue;
    if (rnd() < BUY_CHANCE) { out.push({ kind: 'return', unit: u.id }); left -= cost; }
  }
  return out;
}

/** (22) Steps over passable ground from every hex to the nearest hex of an objective's area, units aside; kept per map. */
const stepCache = new WeakMap<GameMap, Map<string, Map<string, number>>>();
export function stepsTo(map: GameMap, o: Objective): Map<string, number> {
  let byObjective = stepCache.get(map);
  if (!byObjective) stepCache.set(map, (byObjective = new Map()));
  let d = byObjective.get(o.id);
  if (d) return d;
  d = new Map(o.hexes.map((h) => [key(h), 0]));
  for (let frontier = [...o.hexes]; frontier.length > 0;) {
    const next: Hex[] = [];
    for (const h of frontier) for (const n of neighbors(h)) {
      const cell = map.cells[key(n)];
      if (!cell || !TERRAIN[cell.terrain].passable || d.has(key(n))) continue;
      d.set(key(n), d.get(key(h))! + 1);
      next.push(n);
    }
    frontier = next;
  }
  byObjective.set(o.id, d);
  return d;
}

/** Option lists sorted, so the choice does not hang on the order `orderOptions` lists hexes in. */
const sorted = (keys: string[]): string[] => [...keys].sort();

export function scriptedOrders(state: GameState, player: PlayerId, rnd: () => number, seen: { enemies: number; aimed: number; lurking: number; lurkingSeen: number }, follow: boolean): Order[] {
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)];
  const view = viewFor(state, player);
  const enemyAt = new Set(view.units.filter((x) => x.owner !== player).map((x) => key(x.pos)));
  const orders: Order[] = [];
  seen.enemies += enemyAt.size;
  // (25) Supply not yet spoken for by this round's works, and a work for a hex: one the side can afford, never wire
  // where one of its own stands now. Null if there is none.
  let left = state.scores[player];
  const ownAt = new Set(view.units.filter((x) => x.owner === player && x.status !== 'down').map((x) => key(x.pos)));
  const workFor = (at: string, manned = ownAt.has(at)): string | null => {
    const can = Object.values(WORKS).filter((w) => w.cost <= left && (TERRAIN[w.terrain].passable || !manned));
    if (can.length === 0) return null;
    const w = pick(can);
    left -= w.cost;
    return w.id;
  };
  const builds = (type: string) => actionOf(type, 'special')?.effects.some((e) => e.kind === 'build') ?? false;
  // Enemies standing in hiding terrain with one of this player's units in sight range and a clear line:
  // the ones only stealth can hide. How many of them does the player see?
  const mine = state.units.filter((x) => x.owner === player && x.status !== 'down');
  for (const e of state.units) {
    if (e.owner === player || e.status === 'down' || !TERRAIN[state.map.cells[key(e.pos)].terrain].hide) continue;
    if (!mine.some((f) => distance(f.pos, e.pos) <= sightOf(state, f) && canSee(state.map, f.pos, e.pos))) continue;
    seen.lurking++;
    if (enemyAt.has(key(e.pos))) seen.lurkingSeen++;
  }
  for (const unit of view.units.filter((x) => x.owner === player)) {
    const opts = orderOptions(view, unit.id);
    if (opts.kinds.length === 0) continue;
    const can = (k: string) => opts.kinds.includes(k as never);
    const fire = sorted(opts.fire);
    const special = sorted(opts.special);
    const targets = fire.filter((k) => enemyAt.has(k));
    const roll = rnd();
    const builder = builds(unit.type);
    const affordable = builder && Object.values(WORKS).some((w) => w.cost <= left);
    if (builder && special.length > 0 && affordable && roll < BUILD_CHANCE) {
      const at = pick(special);
      const work = workFor(at);
      if (work) orders.push({ unit: unit.id, kind: 'special', target: parseKey(at), work });
    } else if (targets.length > 0 && roll < 0.5) {
      seen.aimed++;
      orders.push({ unit: unit.id, kind: 'fire', target: parseKey(pick(targets)) });
    } else if (!builder && special.length > 0 && roll < 0.65) {
      orders.push({ unit: unit.id, kind: 'special', target: parseKey(pick(special)) });
    } else if (roll < 0.1) {
      // hold
    } else if (roll < 0.3 && can('ambush')) {
      orders.push({ unit: unit.id, kind: 'ambush' });
    } else if (roll < 0.4 && fire.length > 0) {
      orders.push({ unit: unit.id, kind: 'fire', target: parseKey(pick(fire)) });
    } else {
      const kind = can('dash') && rnd() < 0.3 ? 'dash' : 'move';
      const ends = sorted(kind === 'dash' ? opts.dash : opts.move);
      if (ends.length === 0) continue;
      const allowance = moveOf(state, unit) * (kind === 'dash' ? 2 : 1);
      let end = pick(ends);
      if (rnd() < 0.7) {
        // Towards an objective, by the steps a man would walk to it (22: a river is walked round, not through), any
        // of the ends equally near: a tie broken by the list's order would favour one side of a symmetric map.
        const steps = stepsTo(state.map, pick(state.map.objectives));
        const near = (k: string) => steps.get(k) ?? Infinity;
        const best = Math.min(...ends.map(near));
        end = pick(ends.filter((k) => near(k) === best));
      }
      const path = findPath(state.map, unit.pos, parseKey(end), allowance);
      if (!path || path.length === 0) continue;
      const order: Order = { unit: unit.id, kind, path };
      if (follow && order.kind === 'move') {
        const from = followUpOptions(view, unit.id, path[path.length - 1]);
        const pinnedAt = new Set(view.units.filter((x) => x.owner === player && x.id !== unit.id && x.status === 'pinned').map((x) => key(x.pos)));
        for (const k of ['fire', 'special'] as const) {
          const all = sorted(from[k]);
          if (all.length === 0 || order.then) continue;
          const end = path[path.length - 1];
          if (k === 'special' && builds(unit.type)) {
            // (25) Now and then, a work where the move ends or next to it; never wire on the end of his own path.
            if (rnd() >= 0.15) continue;
            const at = pick(all);
            const work = workFor(at, ownAt.has(at) || at === key(end));
            if (work) order.then = { kind: k, target: parseKey(at), work };
            continue;
          }
          const good = all.filter((t) => (k === 'fire' ? enemyAt.has(t) && canSee(state.map, end, parseKey(t)) : pinnedAt.has(t)));
          const roll2 = rnd();
          if (good.length > 0 && roll2 < 0.8) order.then = { kind: k, target: parseKey(pick(good)) };
          else if (roll2 < 0.1) order.then = { kind: k, target: parseKey(pick(all)) };
        }
      }
      orders.push(order);
    }
  }
  return orders;
}

export interface SeededMatch {
  seed: number; players: number; rounds: number;
  digest: string;          // of the final state and every event, each player's included
  down: number;            // units down at the end
  ambushes: number;        // ambush shots fired
  shots: number;           // every other shot and launch
  hits: number;
  treats: number;
  inView: number;          // enemy units in view when planning, added up over every player and round
  aimed: number;           // fire orders given at a hex where an enemy was seen
  lurking: number;         // enemies in hiding terrain, in a player's sight range with a clear line, when planning
  lurkingSeen: number;     // ...of those, the ones that player saw
  score: number;           // all players' scores added up
  scores: number[];        // each seat's final score
  winners: number[];       // the seats that won (ties share)
  top: number;             // the winning score
  followRan: number;       // follow-ups that happened: a shot, launch or treatment in the assault phase
  followNot: number;       // follow-ups that did not (`unable`), whatever the reason
  followNotWhy: Record<string, number>;   // ...by reason
  blocked: number;         // `blocked` events
  fellBack: number;        // moves made by a unit after it was blocked: giving up a hex it could not keep
  downs: number;           // times a unit went down, over the match (18: a man may go down more than once)
  earned: number;          // supply earned by flags over the match, all players
  spent: number;           // supply spent on buy-backs, all players
  returns: number;         // `return` events
  buyBacks: number;        // `purchase` events
  hqsLost: number;         // an HQ's flag taken from its owner
  captures: number;        // (22) `capture` events: a flag that changed hands, from nobody included
  cutWaits: number;        // rounds a man due back spent waiting because his line was cut, added up
  contact: number;         // (19) the first round in which any player was told of an enemy (`spotted`); rounds + 1 if never
  unitsLeft: number;       // (20) units standing at the end, all players
  endedEarly: boolean;     // (20) the match ended before its last round
  levelOnMen: boolean;     // (20) Last Stand: two or more squads shared the most men at the end
  decidedOnWorth: boolean; // (20) ...and what their men cost picked the winner
  fellTogether: boolean;   // (20) Last Stand: nobody was left, the last squads fell in the same round
  kinds: Record<string, KindTally>;   // (21) by objective kind: how often its flags were held, and by whom at the end
  digs: number;            // (24) `dig` events: a man digging in
  dugRounds: number;       // (24) men dug in when a round began, added up over the rounds
  unitRounds: number;      // (24) men standing when a round began, added up over the rounds
  coverHits: number;       // (24) hits that cover or a foxhole turned aside
  foxholeHits: number;     // (24) ...of those, on a man who began the round dug in
  works: Record<string, number>;      // (25) works built, by kind
  buildsNot: Record<string, number>;  // (25) builds that did not happen (`unable` of a build), by reason
  workSpent: number;       // (25) supply spent on works, all players
  workCoverHits: number;   // (25) hits turned aside on a hex with a work (sandbags or a nest)
  engineers: number;       // (25) engineers dealt, all players
}

/** (21) One objective kind in one match, its flags added up. "Near" is the seat whose HQ is nearest the area (one seat only). */
export interface KindTally {
  flags: number;           // objectives of this kind on the map
  heldRounds: number;      // flag-rounds held by somebody, after each round's captures
  rounds: number;          // flag-rounds in all (flags x rounds)
  endNobody: number; endNear: number; endOther: number;   // at the end: held by nobody, by the nearest seat, by another
  endWinner: number;       // at the end: held by a seat that won
  hasNear: number;         // flags of this kind with one nearest seat
  benefits: number;        // unit-rounds a unit planned standing on ground that gave it something (sight, move or rally)
  rallies: number;         // `recover` events of a man pinned in the same round (only a depot does that)
}

const strip = (_k: string, v: unknown): unknown => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (!ADDED_FIELDS.includes(k)) out[k] = x;
  return out;
};

export function playSeeded(seed: number, follow = true, samePreset?: string, mode: ModeId = DEFAULT_MODE): SeededMatch {
  const rnd = mulberry32(seed);
  const players = 2 + (seed % 3);
  const map = mapFor(players);
  const allowed = PRESETS.filter((p) => !MODES[mode].units || p.units.every((u) => MODES[mode].units!.includes(u)));   // all of them in Supply Line
  const fixed = samePreset ? PRESETS.find((p) => p.id === samePreset) : undefined;
  const squads = Array.from({ length: players }, (_, player) => {
    const drawn = allowed[Math.floor(rnd() * allowed.length)];   // always drawn, so a fixed preset leaves the rest of the stream as it was
    return { player, units: (fixed ?? drawn).units };
  });
  let state = createMatch(map, squads, mode);
  const hash = createHash('sha256');
  const m: SeededMatch = { seed, players, rounds: 0, digest: '', down: 0, ambushes: 0, shots: 0, hits: 0, treats: 0, inView: 0, aimed: 0, lurking: 0, lurkingSeen: 0, score: 0, scores: [], winners: [], top: 0, followRan: 0, followNot: 0, followNotWhy: {}, blocked: 0, fellBack: 0, downs: 0, earned: 0, spent: 0, returns: 0, buyBacks: 0, hqsLost: 0, captures: 0, cutWaits: 0, contact: 0, unitsLeft: 0, endedEarly: false, levelOnMen: false, decidedOnWorth: false, fellTogether: false, kinds: {}, digs: 0, dugRounds: 0, unitRounds: 0, coverHits: 0, foxholeHits: 0, works: {}, buildsNot: {}, workSpent: 0, workCoverHits: 0, engineers: squads.flatMap((x) => x.units).filter((t) => t === 'engineer').length };
  const hqs = new Set(map.objectives.filter((o) => o.kind === 'hq').map((o) => o.id));
  // (21) The seat whose HQ is nearest each objective (null if two are equally near, or nobody's HQ is on the map).
  const nearest = new Map(map.objectives.map((o) => {
    const ds = Array.from({ length: players }, (_, p) => {
      const hq = hqOf(state, p);
      return hq ? Math.min(...o.hexes.flatMap((a) => hq.hexes.map((b) => distance(a, b)))) : Infinity;
    });
    const best = Math.min(...ds);
    return [o.id, ds.filter((d) => d === best).length === 1 && best < Infinity ? ds.indexOf(best) : null] as const;
  }));
  const tally = (kind: string): KindTally => (m.kinds[kind] ??= { flags: 0, heldRounds: 0, rounds: 0, endNobody: 0, endNear: 0, endOther: 0, endWinner: 0, hasNear: 0, benefits: 0, rallies: 0 });
  for (const o of map.objectives) { tally(o.kind).flags++; if (nearest.get(o.id) !== null) tally(o.kind).hasNear++; }
  while (!state.over) {
    const orders: Order[][] = [];
    const purchases: Purchase[][] = [];
    const seen = { enemies: 0, aimed: 0, lurking: 0, lurkingSeen: 0 };
    for (let p = 0; p < players; p++) orders.push(scriptedOrders(state, p, rnd, seen, follow));
    for (let p = 0; p < players; p++) purchases.push(scriptedPurchases(state, p, rnd));
    m.inView += seen.enemies;
    m.aimed += seen.aimed;
    m.lurking += seen.lurking;
    m.lurkingSeen += seen.lurkingSeen;
    for (const u of state.units) {
      const b = benefitOf(state, u);
      if (b && (b.kind.sight || b.kind.move || b.kind.rally)) tally(b.kind.id).benefits++;
    }
    const dugAtStart = new Set(state.units.filter((u) => u.status !== 'down' && u.dugIn).map((u) => u.id));
    m.dugRounds += dugAtStart.size;
    m.unitRounds += state.units.filter((u) => u.status !== 'down').length;
    const r = resolve(state, orders, purchases);
    for (const e of r.events) {
      if (e.t !== 'recover') continue;
      const u = r.state.units.find((x) => x.id === e.unit);
      const was = state.units.find((x) => x.id === e.unit);
      const b = u ? benefitOf(r.state, u) : null;
      if (b && was && was.status !== 'pinned') tally(b.kind.id).rallies++;
    }
    for (const o of map.objectives) {
      tally(o.kind).rounds++;
      if ((r.state.flags[o.id] ?? null) !== null) tally(o.kind).heldRounds++;
    }
    if (!m.contact && r.playerEvents.some((list) => list.some((e) => e.t === 'spotted'))) m.contact = state.round;
    hash.update(JSON.stringify([r.events, r.playerEvents], strip));
    let assault = false;
    const halted = new Set<string>();
    for (const e of r.events as GameEvent[]) {
      if (e.t === 'phase') assault = e.phase === 'assault';
      if (assault && (e.t === 'fire' || e.t === 'launch' || e.t === 'treat')) m.followRan++;
      if (e.t === 'unable' && e.action === 'build') m.buildsNot[e.reason] = (m.buildsNot[e.reason] ?? 0) + 1;
      else if (e.t === 'unable') { m.followNot++; m.followNotWhy[e.reason] = (m.followNotWhy[e.reason] ?? 0) + 1; }
      if (e.t === 'build') { m.works[e.work] = (m.works[e.work] ?? 0) + 1; m.workSpent += WORKS[e.work].cost; }
      if (e.t === 'hit' && e.result === 'cover' && Object.hasOwn(state.works, key(e.at))) m.workCoverHits++;
      if (e.t === 'blocked') { m.blocked++; halted.add(e.unit); }
      if (e.t === 'move' && halted.has(e.unit)) m.fellBack++;
      if (e.t === 'fire') { if (e.ambush) m.ambushes++; else m.shots++; }
      if (e.t === 'launch') m.shots++;
      if (e.t === 'hit') m.hits++;
      if (e.t === 'hit' && e.result === 'cover') { m.coverHits++; if (dugAtStart.has(e.unit)) m.foxholeHits++; }
      if (e.t === 'dig') m.digs++;
      if (e.t === 'treat') m.treats++;
      if (e.t === 'hit' && e.result === 'down') m.downs++;
      if (e.t === 'score') m.earned += e.value;
      if (e.t === 'purchase') { m.spent += e.cost; m.buyBacks++; }
      if (e.t === 'return') m.returns++;
      if (e.t === 'capture' && hqs.has(e.objective) && e.from !== null) m.hqsLost++;
      if (e.t === 'capture') m.captures++;
    }
    for (const u of r.state.units) {
      if (u.status === 'down' && u.returnRound !== null && u.returnRound <= state.round && !r.state.eliminated[u.owner] && !lineOpen(r.state, u.owner)) m.cutWaits++;
    }
    state = r.state;
    m.rounds++;
  }
  hash.update(JSON.stringify({ ...state, map: state.map.id }, strip));
  m.digest = hash.digest('hex').slice(0, 16);
  if (!m.contact) m.contact = m.rounds + 1;
  m.down = state.units.filter((u) => u.status === 'down').length;
  m.score = state.scores.reduce((a, b) => a + b, 0);
  m.scores = [...state.scores];
  m.winners = [...state.winners];
  m.top = Math.max(...state.scores);
  m.unitsLeft = state.units.filter((u) => u.status !== 'down').length;
  m.endedEarly = m.rounds < map.maxRounds;
  for (const o of map.objectives) {
    const t = tally(o.kind);
    const owner = state.flags[o.id] ?? null;
    if (owner === null) t.endNobody++;
    else if (owner === nearest.get(o.id)) t.endNear++;
    else t.endOther++;
    if (owner !== null && state.winners.includes(owner)) t.endWinner++;
  }
  if (MODES[mode].win === 'survival') {
    const level = state.scores.filter((n) => n === m.top).length;
    m.fellTogether = m.top === 0;
    m.levelOnMen = m.top > 0 && level > 1;
    m.decidedOnWorth = m.levelOnMen && state.winners.length < level;
  }
  return m;
}

/** One digest for the whole set. */
export function digestAll(matches: SeededMatch[]): string {
  return createHash('sha256').update(matches.map((m) => m.digest).join('\n')).digest('hex').slice(0, 16);
}

export function figures(matches: SeededMatch[]): Record<string, number> {
  const per = (f: (m: SeededMatch) => number) => Math.round((matches.reduce((a, m) => a + f(m), 0) / matches.length) * 100) / 100;
  return {
    matches: matches.length,
    rounds: per((m) => m.rounds),
    down: per((m) => m.down),
    ambushes: per((m) => m.ambushes),
    shots: per((m) => m.shots),
    hits: per((m) => m.hits),
    treats: per((m) => m.treats),
    inView: per((m) => m.inView),
    aimed: per((m) => m.aimed),
    lurking: per((m) => m.lurking),
    lurkingSeen: per((m) => m.lurkingSeen),
    score: per((m) => m.score),
    top: per((m) => m.top),
    followRan: per((m) => m.followRan),
    followNot: per((m) => m.followNot),
    ...Object.fromEntries(['down', 'pinned', 'range', 'sight', 'needs'].map((why) => [`followNot_${why}`, per((m) => m.followNotWhy[why] ?? 0)])),
    blocked: per((m) => m.blocked),
    fellBack: per((m) => m.fellBack),
    downs: per((m) => m.downs),
    earned: per((m) => m.earned),
    spent: per((m) => m.spent),
    returns: per((m) => m.returns),
    buyBacks: per((m) => m.buyBacks),
    hqsLost: per((m) => m.hqsLost),
    captures: per((m) => m.captures),
    cutWaits: per((m) => m.cutWaits),
    contact: per((m) => m.contact),
    incomePerSeatRound: per((m) => m.earned / (m.players * m.rounds)),
    unitsLeft: per((m) => m.unitsLeft),
    digsAMatch: per((m) => m.digs),                          // (24) men digging in, a match
    dugShare: per((m) => m.dugRounds / m.unitRounds),        // (24) share of the men standing at a round's start who were dug in
    dugPerRound: per((m) => m.dugRounds / m.rounds),         // (24) men dug in at a round's start, a round
    coverHits: per((m) => m.coverHits),                      // (24) hits turned aside by cover or a foxhole, a match
    foxholeHits: per((m) => m.foxholeHits),                  // (24) ...of them, on a man dug in at the round's start
    endedEarly: per((m) => Number(m.endedEarly)),          // share of the matches that ended before the last round
    levelOnMen: per((m) => Number(m.levelOnMen)),          // Last Stand: share that ended level on men ...
    decidedOnWorth: per((m) => Number(m.decidedOnWorth)),  // ... share where the tie-break (what the men cost) decided
    fellTogether: per((m) => Number(m.fellTogether)),      // ... share where the last squads fell together
    // (25) works, a match: built by kind, spent on, refused by reason, hits taken by them; and per engineer dealt
    ...Object.fromEntries(Object.keys(WORKS).map((w) => [`works_${w}`, per((m) => m.works[w] ?? 0)])),
    worksAMatch: per((m) => Object.values(m.works).reduce((a, b) => a + b, 0)),
    workSpent: per((m) => m.workSpent),
    ...Object.fromEntries(['supply', 'blocked', 'pinned', 'down', 'range'].map((why) => [`buildNot_${why}`, per((m) => m.buildsNot[why] ?? 0)])),
    workCoverHits: per((m) => m.workCoverHits),
    engineers: per((m) => m.engineers),
    matchesWithEngineers: per((m) => Number(m.engineers > 0)),
  };
}

/**
 * (21) By objective kind, over the matches: the share of flag-rounds held by somebody; at the end, the share of its
 * flags held by nobody, by the seat whose HQ is nearest, by another seat, and by a seat that won; and, a match, how
 * many unit-rounds a man stood on ground that gave him something, and how many men a depot rallied.
 */
export function kindFigures(matches: SeededMatch[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const kinds = [...new Set(matches.flatMap((m) => Object.keys(m.kinds)))].sort();
  for (const k of kinds) {
    const sum = (f: (t: KindTally) => number) => matches.reduce((a, m) => a + (m.kinds[k] ? f(m.kinds[k]) : 0), 0);
    const flags = sum((t) => t.flags);
    out[k] = {
      flagsAMatch: r2(flags / matches.length),
      held: r2(sum((t) => t.heldRounds) / sum((t) => t.rounds)),
      endNobody: r2(sum((t) => t.endNobody) / flags),
      endNearest: r2(sum((t) => t.endNear) / flags),
      endOther: r2(sum((t) => t.endOther) / flags),
      endWinner: r2(sum((t) => t.endWinner) / flags),
      withNearest: r2(sum((t) => t.hasNear) / flags),
      benefitsAMatch: r2(sum((t) => t.benefits) / matches.length),
      ralliesAMatch: r2(sum((t) => t.rallies) / matches.length),
    };
  }
  return out;
}

/** For one player count: each seat's mean score and share of the wins (a tie gives each tied seat its share), and how many matches ended early. */
export function seatFigures(matches: SeededMatch[]): { matches: number; meanScore: number[]; winShare: number[]; vsOthers: string[]; early: number } {
  const players = matches[0]?.players ?? 0;
  const round2 = (x: number) => Math.round(x * 100) / 100;
  /** Each seat's score minus the mean of the other seats' in the same match, averaged: "mean ± one standard error". */
  const vsOthers = Array.from({ length: players }, (_, seat) => {
    const d = matches.map((m) => m.scores[seat] - m.scores.filter((_, i) => i !== seat).reduce((a, b) => a + b, 0) / (players - 1));
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (d.length - 1));
    return `${mean >= 0 ? '+' : ''}${mean.toFixed(2)} ± ${(sd / Math.sqrt(d.length)).toFixed(2)}`;
  });
  return {
    vsOthers,
    matches: matches.length,
    meanScore: Array.from({ length: players }, (_, seat) => round2(matches.reduce((a, m) => a + m.scores[seat], 0) / matches.length)),
    winShare: Array.from({ length: players }, (_, seat) => round2(matches.reduce((a, m) => a + (m.winners.includes(seat) ? 1 / m.winners.length : 0), 0) / matches.length)),
    early: matches.filter((m) => m.rounds < mapFor(m.players).maxRounds).length,
  };
}

const figuresArg = process.argv.indexOf('--figures');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && figuresArg !== -1) {
  const n = Number(process.argv[figuresArg + 1]) || 300;
  const sameAt = process.argv.indexOf('--same');
  const same = sameAt === -1 ? undefined : process.argv[sameAt + 1];
  const modeAt = process.argv.indexOf('--mode');
  const mode = modeAt === -1 ? DEFAULT_MODE : process.argv[modeAt + 1];
  const all = Array.from({ length: n }, (_, i) => playSeeded(SEEDS[0] + i, !process.argv.includes('--no-follow'), same, mode));
  const of = (players: number) => all.filter((m) => m.players === players);
  console.log(JSON.stringify({
    seeds: `${SEEDS[0]} to ${SEEDS[0] + n - 1}`, mode, preset: same ?? 'random per seat',
    all: figures(all), two: figures(of(2)), three: figures(of(3)), four: figures(of(4)),
    seats: { two: seatFigures(of(2)), three: seatFigures(of(3)), four: seatFigures(of(4)) },
    kinds: { all: kindFigures(all), two: kindFigures(of(2)), three: kindFigures(of(3)), four: kindFigures(of(4)) },
  }, null, 1));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const modeAt = process.argv.indexOf('--mode');
  const mode = modeAt === -1 ? DEFAULT_MODE : process.argv[modeAt + 1];
  const all = (mode === 'last-stand' ? LAST_STAND_SEEDS : SEEDS).map((seed) => playSeeded(seed, true, undefined, mode));
  console.log(JSON.stringify({ digest: digestAll(all), figures: figures(all), matches: all.map((m) => `${m.seed}:${m.digest}`) }, null, 1));
}
