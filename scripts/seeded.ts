// A fixed set of seeded matches, played straight through the rules (no
// server): the same seeds always give the same matches. Used two ways:
//   - `src/rules/digest.test.ts` pins a digest of every match, so a change
//     that was meant to keep the game as it is can prove that it did;
//   - `npx tsx scripts/seeded.ts` prints the digests and the play figures
//     (units down, ambushes sprung, score) for the designer's tuning;
//     `--figures <n>` plays n matches instead and prints only the figures,
//     with each seat's mean score and share of the wins for 2, 3 and 4
//     squads (task 15); `--no-follow` with it plays them without any
//     move-then-act orders (the script of before task 14, on today's rules);
//     `--same <preset id>` gives every seat that preset instead of a random
//     one, so a difference between seats is the board's and not the draw's.
// The players are not opponents: each unit takes a random legal order from
// `orderOptions` on its own player's view, leaning towards contact. A unit
// told to move adds a follow-up (task 14) when its action allows one and an
// enemy it sees (for a medic: a pinned friend) is in reach of the end of its
// path, with a clear line from there, most of the time; now and then it adds
// one blind.

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DEFAULT_MAP, MAPS, PRESETS, TERRAIN, UNITS } from '../src/content';
import { canSee, createMatch, findPath, followUpOptions, orderOptions, resolve, viewFor } from '../src/rules';
import { distance, parseKey, key } from '../src/shared/hex';
import type { GameEvent, GameState, Order, PlayerId } from '../src/shared/types';

export const SEEDS: readonly number[] = Array.from({ length: 50 }, (_, i) => 1001 + i);

/**
 * Fields left out of the digest. Stage A of task 12 added `action` to four
 * events without changing how the game plays, and proved it by leaving that
 * one field out and getting the digests of the engine before it. Stage B
 * changed the rules on purpose, the digests were recorded afresh, and since
 * then nothing is left out.
 */
export const ADDED_FIELDS: readonly string[] = [];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Option lists sorted, so the choice does not hang on the order `orderOptions` lists hexes in. */
const sorted = (keys: string[]): string[] => [...keys].sort();

function scriptedOrders(state: GameState, player: PlayerId, rnd: () => number, seen: { enemies: number; aimed: number; lurking: number; lurkingSeen: number }, follow: boolean): Order[] {
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)];
  const view = viewFor(state, player);
  const enemyAt = new Set(view.units.filter((x) => x.owner !== player).map((x) => key(x.pos)));
  const orders: Order[] = [];
  seen.enemies += enemyAt.size;
  // Enemies standing in hiding terrain with one of this player's units in sight range and a clear line:
  // the ones only stealth can hide. How many of them does the player see?
  const mine = state.units.filter((x) => x.owner === player && x.status !== 'down');
  for (const e of state.units) {
    if (e.owner === player || e.status === 'down' || !TERRAIN[state.map.cells[key(e.pos)].terrain].hide) continue;
    if (!mine.some((f) => distance(f.pos, e.pos) <= UNITS[f.type].sight && canSee(state.map, f.pos, e.pos))) continue;
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
    if (targets.length > 0 && roll < 0.5) {
      seen.aimed++;
      orders.push({ unit: unit.id, kind: 'fire', target: parseKey(pick(targets)) });
    } else if (special.length > 0 && roll < 0.65) {
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
      const allowance = UNITS[unit.type].move * (kind === 'dash' ? 2 : 1);
      let end = pick(ends);
      if (rnd() < 0.7) {
        const goal = pick(state.map.objectives).hex;
        end = ends.reduce((best, k) => (distance(parseKey(k), goal) < distance(parseKey(best), goal) ? k : best), ends[0]);
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
}

const strip = (_k: string, v: unknown): unknown => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (!ADDED_FIELDS.includes(k)) out[k] = x;
  return out;
};

export function playSeeded(seed: number, follow = true, samePreset?: string): SeededMatch {
  const rnd = mulberry32(seed);
  const map = MAPS[DEFAULT_MAP];
  const players = 2 + (seed % 3);
  const fixed = samePreset ? PRESETS.find((p) => p.id === samePreset) : undefined;
  const squads = Array.from({ length: players }, (_, player) => {
    const drawn = PRESETS[Math.floor(rnd() * PRESETS.length)];   // always drawn, so a fixed preset leaves the rest of the stream as it was
    return { player, units: (fixed ?? drawn).units };
  });
  let state = createMatch(map, squads);
  const hash = createHash('sha256');
  const m: SeededMatch = { seed, players, rounds: 0, digest: '', down: 0, ambushes: 0, shots: 0, hits: 0, treats: 0, inView: 0, aimed: 0, lurking: 0, lurkingSeen: 0, score: 0, scores: [], winners: [], top: 0, followRan: 0, followNot: 0, followNotWhy: {}, blocked: 0, fellBack: 0 };
  while (!state.over) {
    const orders: Order[][] = [];
    const seen = { enemies: 0, aimed: 0, lurking: 0, lurkingSeen: 0 };
    for (let p = 0; p < players; p++) orders.push(scriptedOrders(state, p, rnd, seen, follow));
    m.inView += seen.enemies;
    m.aimed += seen.aimed;
    m.lurking += seen.lurking;
    m.lurkingSeen += seen.lurkingSeen;
    const r = resolve(state, orders);
    hash.update(JSON.stringify([r.events, r.playerEvents], strip));
    let assault = false;
    const halted = new Set<string>();
    for (const e of r.events as GameEvent[]) {
      if (e.t === 'phase') assault = e.phase === 'assault';
      if (assault && (e.t === 'fire' || e.t === 'launch' || e.t === 'treat')) m.followRan++;
      if (e.t === 'unable') { m.followNot++; m.followNotWhy[e.reason] = (m.followNotWhy[e.reason] ?? 0) + 1; }
      if (e.t === 'blocked') { m.blocked++; halted.add(e.unit); }
      if (e.t === 'move' && halted.has(e.unit)) m.fellBack++;
      if (e.t === 'fire') { if (e.ambush) m.ambushes++; else m.shots++; }
      if (e.t === 'launch') m.shots++;
      if (e.t === 'hit') m.hits++;
      if (e.t === 'treat') m.treats++;
    }
    state = r.state;
    m.rounds++;
  }
  hash.update(JSON.stringify({ ...state, map: state.map.id }, strip));
  m.digest = hash.digest('hex').slice(0, 16);
  m.down = state.units.filter((u) => u.status === 'down').length;
  m.score = state.scores.reduce((a, b) => a + b, 0);
  m.scores = [...state.scores];
  m.winners = [...state.winners];
  m.top = Math.max(...state.scores);
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
  };
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
    early: matches.filter((m) => m.rounds < MAPS[DEFAULT_MAP].maxRounds).length,
  };
}

const figuresArg = process.argv.indexOf('--figures');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && figuresArg !== -1) {
  const n = Number(process.argv[figuresArg + 1]) || 300;
  const sameAt = process.argv.indexOf('--same');
  const same = sameAt === -1 ? undefined : process.argv[sameAt + 1];
  const all = Array.from({ length: n }, (_, i) => playSeeded(SEEDS[0] + i, !process.argv.includes('--no-follow'), same));
  const of = (players: number) => all.filter((m) => m.players === players);
  console.log(JSON.stringify({
    seeds: `${SEEDS[0]} to ${SEEDS[0] + n - 1}`, preset: same ?? 'random per seat',
    all: figures(all), two: figures(of(2)), three: figures(of(3)), four: figures(of(4)),
    seats: { two: seatFigures(of(2)), three: seatFigures(of(3)), four: seatFigures(of(4)) },
  }, null, 1));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const all = SEEDS.map((seed) => playSeeded(seed));
  console.log(JSON.stringify({ digest: digestAll(all), figures: figures(all), matches: all.map((m) => `${m.seed}:${m.digest}`) }, null, 1));
}
