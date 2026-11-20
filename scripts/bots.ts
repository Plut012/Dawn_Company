// The smoke test: mindless bots play whole matches against the real server,
// over real sockets, using only the protocol. Run with `npm run bots`.
//   --matches <n>   how many matches to play (default 60)
//   --players <n>   2, 3 or 4; left out, the matches are dealt round 2, 3, 4
//   --seed <n>      first match's seed (default: from the clock); match i uses seed + i
//   --mode <id>     supply-line (default) or last-stand: the host picks it in the lobby (task 17);
//                   squads are drawn from what the mode allows, and the lobby, plan views and log are checked for it
//
// A test tool, not an opponent: every unit gets a random legal order taken
// from `orderOptions` on the bot's own view. At most tables the bots are also
// "keen" (see randomOrders), so that squads meet, go down and are wiped out.
// Never imported by the client.
//
// Checked every round, for every bot:
//   - the view holds no enemy the bot's own units could not see, and no hex
//     they could not see (worked out again from the view alone);
//   - no order that `orderOptions` offered is rejected;
//   - events speak only of units the bot knows, and add up to the next view
//     (where each unit stands, its status, its posture, whether it gave itself away, whether it is dug in (24));
//   - captures and scores follow the flags: a capture takes the flag from its
//     owner as the bot knew it, by a seat other than that owner (and, when the
//     bot itself is the taker, with one of its ready units in the area); every
//     flag owned after the captures earns exactly one score of its value and its kind's supply (21); and
//     the flags so worked out, with an eliminated seat's flags gone to nobody,
//     are the next view's;
//   - flags are the same for every seat;
//   - supply follows the events: each seat's moves by exactly its `score`s, less its `purchase`s (task 18), which
//     are told to every seat alike, cost the unit's price times the mode's buy-back, and name a man who was down;
//   - a `return` puts the bot's own man back on his feet, still, at its HQ while its HQ flag is its own;
//   - (25) works: a `build` is by the bot's own engineer on his hex or the next, or told because the bot sees the hex;
//     the bot's own supply drops by exactly its works' costs, another seat's by what it was seen to build and, for
//     builds out of sight, by some sum of work costs; works are never lost, every work seen built is in the next view,
//     and the next view's map has each work's terrain on its hex;
//   - the match ends, with the same result for every seat.
// And at the end of each match the server's order log is replayed through
// `createMatch` and `resolve`, and must reach the same scores.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { ACTIONS, DEFAULT_MODE, MAPS, MODES, OBJECTIVE_KINDS, PRESETS, RULES, TERRAIN, UNITS, WORKS, mapFor, validateSquad } from '../src/content';
import { actionOf, buyBackCost, canSee, createMatch, findPath, followUpOptions, hqOf, lineOpen, moveOf, orderOptions, resolve, sightOf } from '../src/rules';
import { distance, key, parseKey, within } from '../src/shared/hex';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';
import type {
  GameEvent, Hex, HexKey, Order, OrderKind, PlayerView, Posture, Purchase, Squad, Unit, UnitId, UnitStatus, UnitTypeId, WorkId,
} from '../src/shared/types';

const WAIT_MS = 10_000;          // longest a bot waits for the server before the match is called stuck
const REJOIN_CHANCE = 0.04;      // how often a bot drops its socket and takes its seat back before ordering

// ---- options

function option(name: string): number | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`--${name} needs a whole number.`);
    process.exit(2);
  }
  return n;
}

const modeAt = process.argv.indexOf('--mode');
const modeOpt: string = modeAt === -1 ? DEFAULT_MODE : (process.argv[modeAt + 1] ?? '');
if (!Object.hasOwn(MODES, modeOpt)) {
  console.error(`--mode must be one of: ${Object.keys(MODES).join(', ')}.`);
  process.exit(2);
}
const matchCount = option('matches') ?? 60;
const playersOpt = option('players');
const baseSeed = (option('seed') ?? Date.now() % 1_000_000_000) >>> 0;
if (playersOpt !== undefined && ![2, 3, 4].includes(playersOpt)) {
  console.error('--players must be 2, 3 or 4.');
  process.exit(2);
}

// ---- seeded randomness (mulberry32)

type Rng = () => number;
function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];

/** A preset half the time, otherwise any legal squad. */
function randomSquad(r: Rng): UnitTypeId[] {
  const allowed = (units: UnitTypeId[]) => validateSquad(units, modeOpt).ok;
  const presets = PRESETS.filter((p) => allowed(p.units));        // all of them in Supply Line
  if (r() < 0.5) return [...pick(r, presets).units];
  const types = Object.keys(UNITS).filter((t) => (MODES[modeOpt].units ?? [t]).includes(t));
  for (;;) {
    const size = RULES.minUnits + Math.floor(r() * (RULES.maxUnits - RULES.minUnits + 1));
    const squad = Array.from({ length: size }, () => pick(r, types));
    if (allowed(squad)) return squad;
  }
}

/**
 * One random legal order for each living unit, or none (hold), from the bot's
 * own view. A `keen` bot is no cleverer, only pointed the right way so that
 * squads meet and get wiped: most of the time it fires at a hex where it sees
 * an enemy if it has one, and ends its moves as near an objective's area as it
 * can: the hill at the centre, or (as often) the nearest area whose flag is not
 * its own. Every choice is still one that `orderOptions` offered.
 *
 * Task 14: about one move in six is aimed at a hex one of the bot's own units
 * stands on (to walk onto it, or through it), and about half of the moves by
 * a unit whose action may follow a move carry a follow-up from
 * `followUpOptions`: at an enemy in view if one is in reach of the path's
 * end (a keen bot), else at any hex it may be aimed at.
 */
function randomOrders(r: Rng, view: PlayerView, keen: boolean): Order[] {
  const orders: Order[] = [];
  // (25) A build names a work: one the seat can still pay for after the works it has ordered, most of the time; now
  // and then any work, so that a build short of supply is seen too.
  let left = view.scores[view.player] ?? 0;
  const work = (type: UnitTypeId): { work?: WorkId } => {
    if (!actionOf(type, 'special')?.effects.some((e) => e.kind === 'build')) return {};
    const all = Object.values(WORKS);
    const affordable = all.filter((w) => w.cost <= left);
    const w = affordable.length > 0 && r() < 0.9 ? pick(r, affordable) : pick(r, all);
    left -= w.cost;
    return { work: w.id };
  };
  const mine = view.units.filter((u) => u.owner === view.player && u.status !== 'down');
  const enemyAt = new Set(view.units.filter((u) => u.owner !== view.player).map((u) => key(u.pos)));
  const middle = [...view.map.objectives].sort((a, b) => b.value - a.value)[0]?.hexes ?? [{ q: 0, r: 0 }];
  const near = (area: Hex[], k: HexKey) => Math.min(...area.map((h) => distance(parseKey(k), h)));
  for (const u of mine) {
    // Where this unit is going: the centre, or the nearest area whose flag is not this seat's.
    const others = view.map.objectives.filter((o) => view.flags[o.id] !== view.player);
    const goal = others.length > 0 && r() < 0.5
      ? others.reduce((a, b) => (near(b.hexes, key(u.pos)) < near(a.hexes, key(u.pos)) ? b : a)).hexes
      : middle;
    const opt = orderOptions(view, u.id);
    const choices: (OrderKind | 'hold')[] = ['hold'];
    for (const k of opt.kinds) if (k === 'ambush' || opt[k].length > 0) choices.push(k);
    const marked = opt.fire.filter((k) => enemyAt.has(k));
    const kind = keen && marked.length > 0 && r() < 0.8 ? 'fire' : pick(r, choices);
    if (kind === 'hold') continue;
    if (kind === 'ambush') { orders.push({ unit: u.id, kind }); continue; }
    let ends = opt[kind];
    if (keen && kind === 'fire' && marked.length > 0 && r() < 0.9) ends = marked;
    if (keen && (kind === 'move' || kind === 'dash') && r() < 0.7) {
      const best = Math.min(...ends.map((k) => near(goal, k)));
      ends = ends.filter((k) => near(goal, k) === best);
    }
    if ((kind === 'move' || kind === 'dash') && r() < 0.17) {
      const held = ends.filter((k) => mine.some((f) => f.id !== u.id && key(f.pos) === k));
      if (held.length > 0) ends = held;
    }
    const target = parseKey(pick(r, ends));
    if (kind === 'move' || kind === 'dash') {
      const steps = moveOf(view, u) * (kind === 'dash' ? 2 : 1);
      const path = findPath(view.map, u.pos, target, steps);
      if (!path || path.length === 0) throw new Error(`orderOptions offered ${kind} to ${key(target)} for ${u.id} but findPath has no route`);
      const order: Order = { unit: u.id, kind, path };
      if (order.kind === 'move' && r() < 0.5) {
        const follow = followUpOptions(view, u.id, path[path.length - 1]);
        const kinds = (['fire', 'special'] as const).filter((k) => follow[k].length > 0);
        if (kinds.length > 0) {
          const k = pick(r, kinds);
          const friendAt = new Set(mine.filter((f) => f.id !== u.id).map((f) => key(f.pos)));
          const good = follow[k].filter((t) => (k === 'fire' ? enemyAt.has(t) : friendAt.has(t)));
          const aim = parseKey(pick(r, keen && good.length > 0 && r() < 0.9 ? good : follow[k]));
          order.then = k === 'special' ? { kind: k, target: aim, ...work(u.type) } : { kind: k, target: aim };
        }
      }
      orders.push(order);
    } else if (kind === 'special') {
      orders.push({ unit: u.id, kind, target, ...work(u.type) });
    } else {
      orders.push({ unit: u.id, kind, target });
    }
  }
  return orders;
}

// ---- one bot: a socket and an inbox

class Bot {
  ws!: WebSocket;
  inbox: ServerMsg[] = [];
  token = '';
  seat = -1;
  view: PlayerView | null = null;
  private wake: (() => void)[] = [];
  private readonly url: string;
  readonly name: string;

  constructor(url: string, name: string) {
    this.url = url;
    this.name = name;
  }

  connect(): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.on('message', (d) => {
      this.inbox.push(JSON.parse(d.toString()) as ServerMsg);
      this.wake.splice(0).forEach((w) => w());
    });
    this.ws.on('error', () => { /* shows up as a timeout with a clearer message */ });
    return new Promise((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
  }

  send(m: ClientMsg): void { this.ws.send(JSON.stringify(m)); }

  /** The next message of one of these kinds; earlier messages of other kinds are dropped. */
  async next<T extends ServerMsg['t']>(...kinds: T[]): Promise<Extract<ServerMsg, { t: T }>> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const i = this.inbox.findIndex((m) => (kinds as string[]).includes(m.t));
      if (i !== -1) {
        const m = this.inbox[i];
        this.inbox.splice(0, i + 1);
        return m as Extract<ServerMsg, { t: T }>;
      }
      if (Date.now() > deadline) throw new Error(`${this.name} waited ${WAIT_MS / 1000}s for ${kinds.join('/')} and got nothing`);
      await new Promise<void>((r) => { this.wake.push(r); setTimeout(r, 200); });
    }
  }

  async join(): Promise<void> {
    this.send({ t: 'join', name: this.name, ...(this.token ? { token: this.token } : {}) });
    const w = await this.next('welcome', 'error');
    if (w.t === 'error') throw new Error(`${this.name} could not join: ${w.message}`);
    this.token = w.token;
    this.seat = w.seat;
  }

  close(): Promise<void> {
    return new Promise((done) => {
      if (this.ws.readyState === WebSocket.CLOSED) return done();
      this.ws.once('close', () => done());
      this.ws.close();
    });
  }
}

// ---- the checks

/**
 * How near one of the bot's units must be to see this enemy where it stands,
 * before the spotter's own `spotting`: the stealth rule, from the view alone.
 * Hiding terrain hides a unit that has not fired, to `still` hexes if it kept
 * still in the last round and to `moved` if it moved without dashing. One
 * that dashed or fired, or stands in the open, is not hidden at all.
 */
function hiddenBeyond(view: PlayerView, e: Unit): number {
  const hide = TERRAIN[view.map.cells[key(e.pos)]?.terrain ?? '']?.hide ?? null;
  if (hide === null || e.revealed) return Infinity;
  if (e.posture === 'dashed') return Infinity;
  if (e.posture === 'moved') return hide.moved ?? Infinity;
  if (e.posture === 'still') return hide.still;
  throw new Error(`unit ${e.id} has no posture the rules know: ${String(e.posture)}`);
}
const ownLiving = (view: PlayerView): Unit[] => view.units.filter((u) => u.owner === view.player && u.status !== 'down');

/** Now and then (18), buy back a downed man the view says may be bought back and the bot can still afford. */
function randomPurchases(r: Rng, view: PlayerView): Purchase[] {
  const out: Purchase[] = [];
  let left = view.scores[view.player] ?? 0;
  for (const u of view.units) {
    if (u.owner !== view.player) continue;
    const cost = buyBackCost(view, u.id);
    if (cost === null || cost > left || r() >= 0.35) continue;
    out.push({ kind: 'return', unit: u.id });
    left -= cost;
  }
  return out;
}

/** Could this view's own units see that unit? The sight rule, from the view alone. */
function couldSee(view: PlayerView, e: Unit): boolean {
  if (e.status === 'down') return false;
  if (view.eliminated[view.player]) return true;
  const near = hiddenBeyond(view, e);
  return ownLiving(view).some((f) => {
    const d = distance(f.pos, e.pos);
    if (d > sightOf(view, f)) return false;   // in this round's light (19)
    if (!canSee(view.map, f.pos, e.pos)) return false;
    return d <= near + (UNITS[f.type]?.spotting ?? 0);
  });
}

function hexesInSight(view: PlayerView): Set<HexKey> {
  if (view.eliminated[view.player]) return new Set(Object.keys(view.map.cells));
  const out = new Set<HexKey>();
  for (const u of ownLiving(view)) {
    for (const h of within(u.pos, sightOf(view, u))) {
      if (view.map.cells[key(h)] && canSee(view.map, u.pos, h)) out.add(key(h));
    }
  }
  return out;
}

/** A view on its own: nothing in it that its player should not have. */
function checkView(view: PlayerView, fail: (what: string) => void): void {
  for (const u of view.units) {
    if (u.owner !== view.player && !couldSee(view, u)) fail(`view holds enemy ${u.id} at ${key(u.pos)} (${u.status}) that no own unit can see`);
  }
  const sight = hexesInSight(view);
  const sent = new Set(view.visible);
  for (const k of sent) if (!sight.has(k)) fail(`view lists hex ${k} as visible but no own unit can see it`);
  for (const k of sight) if (!sent.has(k)) fail(`view leaves out hex ${k} that an own unit can see`);
}

/** All the views of one moment, against each other: each seat sees exactly the enemies the sight rule gives it. */
function checkTogether(views: PlayerView[], fail: (seat: number, what: string) => void): void {
  for (const a of views) {
    for (const b of views) {
      if (a.player === b.player) continue;
      for (const truth of b.units.filter((u) => u.owner === b.player)) {
        const got = a.units.find((u) => u.id === truth.id);
        const should = couldSee(a, truth);
        if (should && !got) fail(a.player, `view leaves out enemy ${truth.id} at ${key(truth.pos)} that an own unit can see`);
        if (got && JSON.stringify(got) !== JSON.stringify(truth)) fail(a.player, `view shows enemy ${truth.id} differently from its owner's view`);
      }
    }
    if (JSON.stringify(a.scores) !== JSON.stringify(views[0].scores)) fail(a.player, 'scores differ between seats');
    if (JSON.stringify(a.flags) !== JSON.stringify(views[0].flags)) fail(a.player, 'flags differ between seats');
    if (JSON.stringify(a.worth) !== JSON.stringify(views[0].worth)) fail(a.player, 'what the men were worth differs between seats');
    if (a.round !== views[0].round || a.over !== views[0].over) fail(a.player, 'round or end differs between seats');
  }
}

/**
 * One round's events as one seat received them: they may speak only of units
 * that seat knows (its own, enemies in its last view, enemies `spotted`
 * since), and followed through they must arrive at the next view.
 */
function checkEvents(before: PlayerView, events: GameEvent[], after: PlayerView, fail: (what: string) => void): void {
  const me = before.player;
  interface Known { pos: HexKey; status: UnitStatus; owner: number; posture: Posture; revealed: boolean; dugIn: boolean }
  const known = new Map<UnitId, Known>();
  for (const u of before.units) known.set(u.id, { pos: key(u.pos), status: u.status, owner: u.owner, posture: u.posture, revealed: u.revealed, dugIn: u.dugIn });
  const givesAway = (action: string): boolean => ACTIONS[action]?.reveals ?? true;
  let atScore: Map<UnitId, Known> | null = null;     // who the seat knew of, and where, when the scoring began
  const flags: Record<string, number | null> = { ...before.flags };   // followed through the round's captures
  const scored = new Map<string, number>();          // objective id -> how many scores it earned this round
  let supplied: Record<string, number | null> | null = null;   // the flags as they were when they earned
  const need = (id: UnitId, e: GameEvent): Known | null => {
    const k = known.get(id);
    if (!k) fail(`event ${JSON.stringify(e)} names unit ${id}, which this seat does not know`);
    return k ?? null;
  };
  for (const e of events) {
    switch (e.t) {
      case 'spotted':
        if (e.unit.owner === me) fail(`own unit ${e.unit.id} reported as spotted`);
        else if (known.has(e.unit.id)) fail(`${e.unit.id} spotted while already in view`);
        known.set(e.unit.id, { pos: key(e.unit.pos), status: e.unit.status, owner: e.unit.owner, posture: e.unit.posture, revealed: e.unit.revealed, dugIn: e.unit.dugIn });
        break;
      case 'phase':
        // A new round: nobody has fired or moved in it yet.
        if (e.phase === 'treat') for (const k of known.values()) { k.posture = 'still'; k.revealed = false; }
        if (e.phase === 'score') atScore = new Map([...known].map(([id, k]) => [id, { ...k }]));
        break;
      case 'dash': {
        const k = need(e.unit, e);
        if (k) { k.posture = 'dashed'; k.dugIn = false; }
        break;
      }
      case 'dig': {      // (24) told to whoever sees the unit, own included
        const k = need(e.unit, e);
        if (k) { if (k.dugIn) fail(`${e.unit} dug in but was already dug in`); k.dugIn = true; }
        break;
      }
      case 'capture': {
        const obj = before.map.objectives.find((o) => o.id === e.objective);
        if (!obj) { fail(`capture of objective ${e.objective}, which is not on the map`); break; }
        if (scored.size > 0) fail(`capture of ${obj.id} after the scores began`);
        if (e.from !== (flags[obj.id] ?? null)) fail(`capture of ${obj.id} from seat ${e.from}, but its flag was seat ${flags[obj.id]}'s`);
        if (e.player === e.from) fail(`capture of ${obj.id} by seat ${e.player}, which already held it`);
        if (e.player === me) {
          const area = new Set(obj.hexes.map(key));
          const inside = [...(atScore ?? known).values()].some((k) => k.owner === me && k.status === 'ready' && area.has(k.pos));
          if (!inside) fail(`this seat captured ${obj.id} without a ready unit of its own in the area`);
        }
        flags[obj.id] = e.player;
        break;
      }
      case 'score': {
        const obj = before.map.objectives.find((o) => o.id === e.objective);
        if (!obj) { fail(`score names objective ${e.objective}, which is not on the map`); break; }
        if (flags[obj.id] !== e.player) fail(`score of ${obj.id} for seat ${e.player}, but its flag is seat ${flags[obj.id]}'s`);
        const worth = obj.value + (OBJECTIVE_KINDS[obj.kind]?.supply ?? 0);   // its value and its kind's supply (21)
        if (e.value !== worth) fail(`score of ${obj.id} worth ${e.value}, but the objective is worth ${worth}`);
        scored.set(obj.id, (scored.get(obj.id) ?? 0) + 1);
        break;
      }
      case 'eliminated': {
        // Scores come before eliminations: the flags that earned are the ones before the first. The out seat's go to nobody.
        supplied ??= { ...flags };
        for (const id of Object.keys(flags)) if (flags[id] === e.player) flags[id] = null;
        break;
      }
      case 'lost':
        if (need(e.unit, e)) known.delete(e.unit);
        break;
      case 'treat': {
        need(e.unit, e);
        const t = need(e.target, e);
        if (t) t.status = 'ready';
        break;
      }
      case 'fire':
        if (e.unit !== null) {
          const k = need(e.unit, e);
          if (k && e.from && key(e.from) !== k.pos) fail(`fire by ${e.unit} from ${key(e.from)} but it stands at ${k.pos}`);
          if (k && givesAway(e.action)) k.revealed = true;
        }
        break;
      case 'launch': {
        const k = need(e.unit, e);
        if (k && givesAway(e.action)) k.revealed = true;
        break;
      }
      case 'reveal': {
        const k = need(e.unit, e);
        if (k) k.revealed = true;
        break;
      }
      case 'hit': {
        const k = need(e.unit, e);
        if (!k) break;
        if (key(e.at) !== k.pos) fail(`hit on ${e.unit} at ${key(e.at)} but it stands at ${k.pos}`);
        if (e.result === 'pinned') k.status = 'pinned';
        if (e.result === 'down') {
          k.status = 'down';
          k.dugIn = false;
          if (k.owner !== me) known.delete(e.unit);      // a downed enemy leaves the view without a `lost`
        }
        break;
      }
      case 'move': {
        const k = need(e.unit, e);
        if (!k) break;
        if (key(e.from) !== k.pos) fail(`move of ${e.unit} from ${key(e.from)} but it stands at ${k.pos}`);
        k.pos = key(e.to);
        k.dugIn = false;
        if (k.posture === 'still') k.posture = 'moved';
        break;
      }
      case 'blocked':
      case 'unable':
        need(e.unit, e);
        break;
      case 'build': {      // (25) told to the owner, and to whoever sees the hex
        if (!Object.hasOwn(WORKS, e.work)) { fail(`build of an unknown work ${e.work}`); break; }
        if (e.unit.startsWith(`${me}-`)) {
          const k = need(e.unit, e);
          if (k && distance(parseKey(k.pos), e.at) > 1) fail(`${e.unit} built at ${key(e.at)}, more than a hex from ${k.pos}`);
        } else if (!hexesInSight(before).has(key(e.at)) && !hexesInSight(after).has(key(e.at))) {
          fail(`told of a build at ${key(e.at)}, a hex this seat does not see`);
        }
        if (Object.hasOwn(before.works ?? {}, key(e.at))) fail(`a build at ${key(e.at)}, where there was a work already`);
        if (after.works?.[key(e.at)] !== e.work) fail(`a build of ${e.work} at ${key(e.at)} is not in the next view's works`);
        break;
      }
      case 'recover': {
        const k = need(e.unit, e);
        if (k) k.status = 'ready';
        break;
      }
      case 'purchase': {
        const mine = before.units.find((u) => u.id === e.unit);
        const returns = MODES[before.mode]?.returns ?? null;
        if (!returns) fail(`a purchase in ${before.mode}, where nobody comes back`);
        if (e.player === me) {
          if (!mine || mine.owner !== me || mine.status !== 'down') fail(`this seat bought back ${e.unit}, which was not one of its men down`);
          else if (returns && e.cost !== (UNITS[mine.type]?.cost ?? 0) * returns.buyBack) fail(`${e.unit} bought back for ${e.cost}, not its price`);
        } else if (!e.unit.startsWith(`${e.player}-`)) fail(`seat ${e.player} bought back ${e.unit}, not one of its own`);
        break;
      }
      case 'return': {
        if (!e.unit.startsWith(`${me}-`)) break;      // an enemy's: its `spotted` brings it into view, if this seat sees it
        const k = need(e.unit, e);
        if (!k) break;
        if (k.status !== 'down') fail(`${e.unit} returned but was not down`);
        const hq = hqOf(before, me);
        const zone = before.map.spawns[before.map.seatSpawns[before.playerCount]?.[me] ?? -1] ?? [];
        if (![...(hq?.hexes ?? []), ...zone].some((h) => key(h) === key(e.at))) fail(`${e.unit} returned at ${key(e.at)}, not at its HQ or start zone`);
        if (!lineOpen(after, me)) fail(`${e.unit} returned while this seat's line is cut`);
        Object.assign(k, { pos: key(e.at), status: 'ready', posture: 'still', revealed: false, dugIn: false });
        break;
      }
      default:
        break;
    }
  }
  for (const u of after.units) {
    const k = known.get(u.id);
    if (!k) { fail(`next view holds ${u.id} but no event brought it into view`); continue; }
    if (k.pos !== key(u.pos)) fail(`events leave ${u.id} at ${k.pos}, next view has it at ${key(u.pos)}`);
    if (k.status !== u.status) fail(`events leave ${u.id} ${k.status}, next view has it ${u.status}`);
    if (k.posture !== u.posture) fail(`events leave ${u.id} ${k.posture}, next view has it ${u.posture}`);
    if (k.dugIn !== u.dugIn) fail(`events leave ${u.id} ${k.dugIn ? 'dug in' : 'not dug in'}, next view says otherwise`);
    if (u.dugIn && (u.posture !== 'still' || u.status === 'down')) fail(`${u.id} is dug in but ${u.status}, ${u.posture}`);
    if (k.revealed !== u.revealed) fail(`events leave ${u.id} ${k.revealed ? 'given away' : 'not given away'}, next view says otherwise`);
  }
  // Every flag owned after the captures earned exactly once; a flag of nobody's, never.
  if (events.some((e) => e.t === 'phase' && e.phase === 'score')) {
    const owned = supplied ?? flags;
    for (const o of before.map.objectives) {
      const n = scored.get(o.id) ?? 0;
      // (20) a mode without supply earns nothing, flags or no flags
      const want = (owned[o.id] ?? null) === null || MODES[before.mode]?.supply === false ? 0 : 1;
      if (n !== want) fail(`flag ${o.id} (seat ${owned[o.id]}) earned ${n} times this round, expected ${want}`);
    }
  }
  if (JSON.stringify(flags) !== JSON.stringify(after.flags)) {
    fail(`events leave the flags ${JSON.stringify(flags)}, next view has ${JSON.stringify(after.flags)}`);
  }
  for (const id of known.keys()) {
    if (!after.units.some((u) => u.id === id)) fail(`events leave ${id} in view, next view does not hold it`);
  }
  // (25) Works stay, and each is ground on the next view's map.
  for (const [k, w] of Object.entries(before.works ?? {})) if (after.works?.[k] !== w) fail(`the work at ${k} (${w}) is gone from the next view`);
  for (const [k, w] of Object.entries(after.works ?? {})) {
    if (after.map.cells[k]?.terrain !== WORKS[w]?.terrain) fail(`the work at ${k} (${w}) is not the terrain there: ${after.map.cells[k]?.terrain}`);
  }
}

/** (25) Can `n` supply be spent as a sum of work costs? (A seat's works out of this seat's sight.) */
function sumOfWorks(n: number): boolean {
  const ok = [true];
  for (let i = 1; i <= n; i++) ok[i] = Object.values(WORKS).some((w) => w.cost <= i && ok[i - w.cost]);
  return n >= 0 && ok[n] === true;
}

// ---- the server

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => done(p));
    });
    s.on('error', fail);
  });
}

interface Server { child: ChildProcess; port: number; logs: string[]; errors: string[] }

async function startServer(dir: string): Promise<Server> {
  const port = await freePort();
  const root = resolvePath(fileURLToPath(new URL('../', import.meta.url)));
  const child = spawn(process.execPath, ['--import', 'tsx', join(root, 'src/server/main.ts'), '--port', String(port), '--timer', '0', '--matches', dir], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const server: Server = { child, port, logs: [], errors: [] };
  let out = '';
  const up = new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(new Error('the server did not start in 20 seconds')), 20_000);
    child.stdout!.on('data', (d: Buffer) => {
      out += d.toString();
      for (const m of out.matchAll(/^Match log: (.+)$/gm)) if (!server.logs.includes(m[1])) server.logs.push(m[1]);
      if (out.includes('listening')) { clearTimeout(timer); done(); }
    });
    child.once('exit', (code) => { clearTimeout(timer); fail(new Error(`the server stopped (code ${code})`)); });
  });
  child.stderr!.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n')) if (line.trim()) server.errors.push(line.trim());
  });
  await up;
  return server;
}

// ---- one match

interface Tally { works: Record<string, number>; buildsNot: number; returns: number; buyBacks: number; spent: number; hqsLost: number; rounds: number; hits: number; downs: number; eliminations: number; early: number; orders: number; rejoins: number; treats: number; ambushes: number; score: number; captures: number; followUps: number; followRan: number; followNot: number; onto: number; fellBack: number; matches: number; roundsPlayed: number; shared: number; levelOnMen: number; decidedOnWorth: number; fellTogether: number; digs: number }

async function playMatch(server: Server, bots: Bot[], seed: number, tally: Tally, fail: (what: string) => void): Promise<void> {
  const r = rng(seed);
  const n = bots.length;
  const logsBefore = server.logs.length;

  // lobby: squads in seat order, everyone ready, host starts
  const keen = r() < 0.6;           // most tables fight; the rest wander
  const squads = bots.map(() => randomSquad(r));
  for (const b of bots) b.inbox = [];
  // The host picks the mode first and waits to hear it back, so that nobody's ready is cleared by it later.
  bots[0].send({ t: 'mode', mode: modeOpt });
  for (;;) {
    const l = await bots[0].next('lobby');
    if (l.mode === modeOpt) break;
  }
  for (const [i, b] of bots.entries()) {
    b.send({ t: 'squad', units: squads[i] });
    b.send({ t: 'ready', ready: true });
  }
  // The sockets are separate: wait until the host has been told that everyone is ready.
  for (;;) {
    const l = await bots[0].next('lobby');
    if (l.seats.length === n && l.seats.every((s) => s.ready)) break;
  }
  bots[0].send({ t: 'start' });
  let views: PlayerView[] = [];
  for (const [i, b] of bots.entries()) {
    const m = await b.next('plan', 'error');
    if (m.t === 'error') throw new Error(`the match did not start: ${m.message}`);
    views[i] = m.view;
    if (m.view.mode !== modeOpt) fail(`seat ${i}: the match is in mode "${m.view.mode}", not "${modeOpt}"`);
    if (m.view.map.id !== mapFor(n).id) fail(`seat ${i}: the match is on map "${m.view.map.id}", not "${mapFor(n).id}", the map for ${n} players`);
  }

  const maxRounds = views[0].maxRounds;
  let beforeLast = views[0];               // the view the last round was planned from
  for (;;) {
    for (const v of views) checkView(v, (what) => fail(`seat ${v.player}, round ${v.round}: ${what}`));
    checkTogether(views, (seat, what) => fail(`seat ${seat}, round ${views[0].round}: ${what}`));
    if (views[0].over) break;
    if (views[0].round > maxRounds) { fail(`round ${views[0].round} reached and the match is not over`); break; }

    // orders, in seat order
    const sent: Order[][] = [];
    const bought: Purchase[][] = [];
    for (const [i, b] of bots.entries()) {
      if (views[i].eliminated[i]) { sent[i] = []; continue; }
      if (r() < REJOIN_CHANCE) {
        // Drop the line and take the seat back: the server must hand over the same view.
        await b.close();
        await b.connect();
        b.inbox = [];
        await b.join();
        const back = (await b.next('plan')).view;
        if (JSON.stringify(back) !== JSON.stringify(views[i])) fail(`seat ${i}, round ${views[i].round}: the view after rejoining differs from the one before`);
        tally.rejoins++;
      }
      sent[i] = randomOrders(r, views[i], keen);
      bought[i] = randomPurchases(r, views[i]);
      tally.orders += sent[i].length;
      for (const o of sent[i]) {
        if (o.kind === 'move' && o.then) tally.followUps++;
        const end = o.kind === 'move' || o.kind === 'dash' ? o.path[o.path.length - 1] : null;
        if (end && views[i].units.some((u) => u.owner === i && u.id !== o.unit && u.status !== 'down' && key(u.pos) === key(end))) tally.onto++;
      }
      b.send({ t: 'orders', orders: sent[i], purchases: bought[i] });
    }

    // the round, as each seat is told it
    const next: PlayerView[] = [];
    let purchasesSeen: GameEvent[] = [];
    for (const [i, b] of bots.entries()) {
      let m = await b.next('resolve', 'rejected', 'error');
      if (m.t !== 'resolve') {
        fail(`seat ${i}, round ${views[i].round}: ${m.t === 'rejected' ? `orders rejected: ${JSON.stringify(m.errors)}` : `server error: ${m.message}`}; orders were ${JSON.stringify(sent[i])}, purchases ${JSON.stringify(bought[i] ?? [])}`);
        b.send({ t: 'orders', orders: [] });         // hold, so the match can go on
        m = await b.next('resolve');
      }
      const where = `seat ${i}, round ${views[i].round}`;
      checkEvents(views[i], m.events, m.view, (what) => fail(`${where}: ${what}`));
      // Supply: what the flags earned, less what was spent, and nothing else.
      const survival = MODES[modeOpt].win === 'survival';
      m.view.scores.forEach((s, p) => {
        if (survival) {
          // Last Stand (20): the score is the men standing, with no event of its own. Exact for this seat's own
          // squad; for the others, at least the ones this seat can see.
          const seen = m.view.units.filter((u) => u.owner === p && u.status !== 'down').length;
          if (p === i ? s !== seen : s < seen) fail(`${where}: seat ${p}'s score is ${s}, but ${seen} of its men stand${p === i ? '' : ' in view'}`);
          if (m.events.some((e) => e.t === 'score' || e.t === 'purchase' || e.t === 'return')) fail(`${where}: supply, purchase or return in ${modeOpt}`);
          return;
        }
        let want = views[i].scores[p];
        for (const e of m.events) {
          if (e.t === 'score' && e.player === p) want += e.value;
          if (e.t === 'purchase' && e.player === p) want -= e.cost;
          if (e.t === 'build' && e.unit.startsWith(`${p}-`)) want -= WORKS[e.work]?.cost ?? 0;   // (25)
        }
        // Another seat's works out of sight are not told: what is missing must be some works' costs.
        if (p === i ? s !== want : !sumOfWorks(want - s)) fail(`${where}: seat ${p}'s supply went from ${views[i].scores[p]} to ${s}; its scores, purchases and works make it ${want}`);
      });
      const told = (x: GameEvent[]) => JSON.stringify(x.filter((e) => e.t === 'purchase'));
      if (i > 0 && told(m.events) !== told(purchasesSeen)) fail(`${where}: this seat was told other purchases than seat 0`);
      if (i === 0) purchasesSeen = m.events;
      if (m.view.round !== views[i].round + 1) fail(`${where}: next view is for round ${m.view.round}`);
      if (i === 0) {
        tally.rounds++;
        for (const e of m.events) if (e.t === 'eliminated') tally.eliminations++;
      }
      // Every follow-up this seat ordered must be accounted for: it ran, or an `unable` says why not.
      let assault = false;
      const halted = new Set<UnitId>();
      const settled = new Set<UnitId>();
      for (const e of m.events) {
        if (e.t === 'phase') assault = e.phase === 'assault';
        if (e.t === 'blocked') halted.add(e.unit);
        if (e.t === 'move' && halted.has(e.unit) && e.unit.startsWith(`${i}-`)) tally.fellBack++;
        if (e.t === 'unable' && e.unit.startsWith(`${i}-`)) { if (e.action !== 'build') tally.followNot++; settled.add(e.unit); }   // a build's: counted below
        if (assault && (e.t === 'fire' || e.t === 'launch' || e.t === 'treat') && e.unit?.startsWith(`${i}-`)) { tally.followRan++; settled.add(e.unit); }
        if (e.t === 'hit' && e.unit.startsWith(`${i}-`)) { tally.hits++; if (e.result === 'down') tally.downs++; }
        if (e.t === 'treat' && e.unit.startsWith(`${i}-`)) tally.treats++;
        if (e.t === 'dig' && e.unit.startsWith(`${i}-`)) tally.digs++;
        if (e.t === 'fire' && e.ambush && e.unit?.startsWith(`${i}-`)) tally.ambushes++;
        if (e.t === 'capture' && e.player === i) tally.captures++;
        if (e.t === 'capture' && e.from === i && views[i].map.objectives.find((o) => o.id === e.objective)?.kind === 'hq') tally.hqsLost++;
        if (e.t === 'purchase' && e.player === i) { tally.buyBacks++; tally.spent += e.cost; }
        if (e.t === 'return' && e.unit.startsWith(`${i}-`)) tally.returns++;
        if (e.t === 'build' && e.unit.startsWith(`${i}-`)) { tally.works[e.work] = (tally.works[e.work] ?? 0) + 1; settled.add(e.unit); }
        if (e.t === 'unable' && e.action === 'build' && e.unit.startsWith(`${i}-`)) tally.buildsNot++;
      }
      for (const o of sent[i]) {
        if (o.kind !== 'move' || !o.then || settled.has(o.unit)) continue;
        const type = views[i].units.find((u) => u.id === o.unit)?.type ?? '';
        const action = ACTIONS[UNITS[type]?.[o.then.kind] ?? ''];
        // A quiet action that changes nobody (a medic at a man who is not pinned) leaves no event.
        if (action?.phase !== 'treat') fail(`${where}: ${o.unit}'s follow-up neither ran nor was reported as not happening`);
      }
      next[i] = m.view;
    }
    beforeLast = views[0];
    views = next;
  }
  if (views[0].round <= maxRounds) tally.early++;
  tally.score += views[0].scores.reduce((a, b) => a + b, 0);
  tally.matches++;
  tally.roundsPlayed += views[0].round - 1;
  if (views[0].winners.length > 1) tally.shared++;
  if (MODES[modeOpt].win === 'survival') {
    // The win rule, worked out again from the final view alone (20): most men, then the dearer men, then they share;
    // if nobody is left, every squad that was not out before the last round.
    const v = views[0];
    const alive = (p: number) => v.scores[p];
    const worth = (p: number) => v.worth?.[p] ?? NaN;
    const seats = Array.from({ length: n }, (_, p) => p);
    const most = Math.max(...v.scores);
    let want: number[];
    if (most === 0) want = seats.filter((p) => !beforeLast.eliminated[p]);
    else {
      const tied = seats.filter((p) => alive(p) === most);
      const dear = Math.max(...tied.map(worth));
      want = tied.filter((p) => worth(p) === dear);
      if (tied.length > 1) {
        tally.levelOnMen++;
        if (want.length < tied.length) tally.decidedOnWorth++;
      }
    }
    if (most === 0) tally.fellTogether++;
    if (JSON.stringify(want) !== JSON.stringify(v.winners)) fail(`the winners are ${JSON.stringify(v.winners)}; the men standing and what they cost make it ${JSON.stringify(want)}`);
    if (v.worth === undefined) fail('the finished match has no `worth`');
    for (const u of v.units) if (u.status === 'down' && u.returnRound !== null) fail(`${u.id} is down and due back in ${modeOpt}`);
  } else if (views[0].worth !== undefined) {
    fail('`worth` in a match that is not Last Stand');
  }

  // the server's log, replayed
  const logFile = server.logs[logsBefore];
  if (!logFile || server.logs.length !== logsBefore + 1) {
    fail(`expected one new match log, found ${server.logs.length - logsBefore}`);
  } else {
    const lines = readFileSync(logFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const start = lines[0];
    if (start?.t !== 'start') {
      fail('the log does not begin with a start line');
    } else {
      const logSquads: Squad[] = start.seats.map((s: { squad: UnitTypeId[] }, p: number) => ({ player: p, units: s.squad }));
      if (JSON.stringify(logSquads.map((s) => s.units)) !== JSON.stringify(squads)) fail('the squads in the log are not the ones the bots sent');
      if ((start.mode ?? DEFAULT_MODE) !== modeOpt) fail(`the log's start line has mode "${start.mode}", not "${modeOpt}"`);
      let state = createMatch(MAPS[start.map], logSquads, start.mode ?? DEFAULT_MODE);
      for (const line of lines.slice(1)) state = resolve(state, line.orders, line.purchases).state;
      if (!state.over) fail(`replaying the log stops at round ${state.round} without ending the match`);
      if (JSON.stringify(state.scores) !== JSON.stringify(views[0].scores)) fail(`replay scores ${JSON.stringify(state.scores)} differ from the match's ${JSON.stringify(views[0].scores)}`);
      if (JSON.stringify(state.winners) !== JSON.stringify(views[0].winners)) fail(`replay winners ${JSON.stringify(state.winners)} differ from the match's ${JSON.stringify(views[0].winners)}`);
    }
  }
  if (server.errors.length > 0) fail(`the server wrote to stderr: ${server.errors.splice(0).join(' | ')}`);

  // back to the lobby for the next one
  bots[0].send({ t: 'rematch' });
  for (const b of bots) await b.next('lobby');
}

// ---- the run

async function main(): Promise<number> {
  const plan = Array.from({ length: matchCount }, (_, i) => ({ seed: (baseSeed + i) >>> 0, players: playersOpt ?? 2 + (i % 3) }));
  console.log(`Dawn Squad bots: ${matchCount} matches, ${MODES[modeOpt].name}, seed ${baseSeed}${playersOpt ? `, ${playersOpt} players` : ', players 2/3/4 in turn'}`);
  const dir = mkdtempSync(join(tmpdir(), 'dawn-squad-bots-'));
  const failures: string[] = [];
  let failedMatches = 0;
  const started = Date.now();
  try {
    for (const players of [2, 3, 4]) {
      const mine = plan.filter((m) => m.players === players);
      if (mine.length === 0) continue;
      const server = await startServer(dir);
      const tally: Tally = { works: {}, buildsNot: 0, returns: 0, buyBacks: 0, spent: 0, hqsLost: 0, rounds: 0, hits: 0, downs: 0, eliminations: 0, early: 0, orders: 0, rejoins: 0, treats: 0, ambushes: 0, score: 0, captures: 0, followUps: 0, followRan: 0, followNot: 0, onto: 0, fellBack: 0, matches: 0, roundsPlayed: 0, shared: 0, levelOnMen: 0, decidedOnWorth: 0, fellTogether: 0, digs: 0 };
      let bad = 0;
      try {
        const bots = Array.from({ length: players }, (_, i) => new Bot(`ws://127.0.0.1:${server.port}/ws`, `Bot ${i + 1}`));
        for (const b of bots) {             // one at a time, so seats are in order
          await b.connect();
          await b.join();
          await b.next('lobby');
        }
        for (const m of mine) {
          const found: string[] = [];
          const rerun = `npm run bots -- --seed ${m.seed} --players ${players} --matches 1`;
          try {
            await playMatch(server, bots, m.seed, tally, (what) => { if (found.length < 20) found.push(what); });
          } catch (e) {
            found.push(`stopped: ${(e as Error).message}`);
            if (server.errors.length > 0) found.push(`server stderr: ${server.errors.splice(0).join(' | ')}`);
          }
          if (found.length > 0) {
            bad++;
            failedMatches++;
            failures.push(`FAIL seed ${m.seed}, ${players} players (re-run: ${rerun})`, ...found.map((f) => `  - ${f}`));
            console.log(failures.slice(-found.length - 1).join('\n'));
            if (found.some((f) => f.startsWith('stopped:'))) break;      // the table is in an unknown state
          }
        }
        await Promise.all(bots.map((b) => b.close().catch(() => undefined)));
      } finally {
        server.child.kill();
      }
      console.log(
        `${players} players: ${mine.length - bad}/${mine.length} matches passed; ${tally.rounds} rounds, ${tally.orders} orders, `
        + `${tally.hits} hits (${tally.downs} down), ${tally.treats} treated, ${tally.ambushes} ambushes sprung, ${tally.digs} dug in, `
        + (MODES[modeOpt].win === 'survival'
          ? `${(tally.roundsPlayed / mine.length).toFixed(1)} rounds to the end on average, `
            + `${tally.score} men left at the ends (${(tally.score / mine.length).toFixed(1)} a match), ${tally.shared} shared wins, `
            + `${tally.levelOnMen} level on men at the end, ${tally.decidedOnWorth} of them decided by what the men cost, ${tally.fellTogether} where the last squads fell together, `
          : `${tally.score} supply in hand at the ends, ${tally.spent} spent on ${tally.buyBacks} buy-backs, ${tally.returns} men back, `
            + `works built ${Object.keys(WORKS).map((w) => `${w} ${tally.works[w] ?? 0}`).join(', ')} (${tally.buildsNot} builds did not happen), `)
        + `${tally.captures} flags captured, ${tally.hqsLost} HQs lost, `
        + `${tally.eliminations} squads wiped, ${tally.early} ended early, ${tally.rejoins} rejoins; `
        + `${tally.followUps} follow-ups ordered (${tally.followRan} ran, ${tally.followNot} did not), `
        + `${tally.onto} moves ordered onto a teammate's hex, ${tally.fellBack} steps fallen back`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (failedMatches > 0) {
    console.log(`FAILED: ${failedMatches} of ${matchCount} matches had failures (seed ${baseSeed}, ${secs}s)`);
    return 1;
  }
  console.log(`PASS: ${matchCount} matches, no failures (seed ${baseSeed}, ${secs}s)`);
  return 0;
}

main().then((code) => process.exit(code), (e) => {
  console.error('bots:', e);
  process.exit(1);
});
