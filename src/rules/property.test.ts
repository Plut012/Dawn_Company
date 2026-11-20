// Many whole matches with random legal orders, checking what must always hold.
// The randomness lives here only (a small seeded generator); the rules have none.

import { describe, expect, it } from 'vitest';
import { ACTIONS, mapFor, MAPS, MODES, OBJECTIVE_KINDS, PRESETS, SUN, TERRAIN, UNITS, WORKS } from '../content';
import { distance, key, neighbors, parseKey } from '../shared/hex';
import type { GameEvent, GameState, Hex, Order, PlayerId, Purchase, Unit, UnitId } from '../shared/types';
import {
  buyBackCost, canSee, createMatch, hqOf, findPath, followUpOptions, lineOpen, orderOptions, resolve, validateOrders, validatePurchases, viewFor, visibleEnemies, visibleHexes,
} from './index';

const MATCHES = 240;
// Seeds played as well as 1..MATCHES, for a rule the random orders reach too seldom. An elimination came once in the
// 240 under the old full-day light and not at all at first light (19); 272 was the first seed after them with one.
// On the crossroads redrawn by task 22 (a stream, walled hamlets, every area of open ground or buildings) it is 344; and
// a capture by a hidden unit, which no seed in 1..240 has there any more, comes first at 624.
const EXTRA_SEEDS = [344, 624];

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

/** The map of the match being played: `mapFor` its number of players (set by `playMatch`; 23: two, three and four each have their own). */
let map = mapFor(4);
const clone = <T>(x: T): T => structuredClone(x);
/** A state as text, without the map (which never changes). */
const text = (s: GameState): string => JSON.stringify({ ...s, map: s.map.id });
function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// ---- random legal orders, pushed towards contact so that things happen
function randomOrders(state: GameState, player: PlayerId, rnd: () => number): Order[] {
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)];
  const view = viewFor(state, player);
  const enemyAt = new Set(view.units.filter((x) => x.owner !== player).map((x) => key(x.pos)));
  const orders: Order[] = [];
  // (25) A build names a work: any of them, so that some cannot be paid for and some land on a man (wire).
  const work = (type: string): { work?: string } =>
    (ACTIONS[UNITS[type].special ?? '']?.effects.some((e) => e.kind === 'build') ? { work: pick(Object.keys(WORKS)) } : {});
  for (const unit of view.units.filter((x) => x.owner === player)) {
    const opts = orderOptions(view, unit.id);
    if (opts.kinds.length === 0) continue;
    const can = (k: string) => opts.kinds.includes(k as never);
    const targets = opts.fire.filter((k) => enemyAt.has(k));
    const roll = rnd();
    if (targets.length > 0 && roll < 0.5) {
      orders.push({ unit: unit.id, kind: 'fire', target: parseKey(pick(targets)) });
    } else if (opts.special.length > 0 && roll < 0.65) {
      orders.push({ unit: unit.id, kind: 'special', target: parseKey(pick(opts.special)), ...work(unit.type) });
    } else if (roll < 0.1) {
      // hold
    } else if (roll < 0.25 && can('ambush')) {
      orders.push({ unit: unit.id, kind: 'ambush' });
    } else if (roll < 0.35 && opts.fire.length > 0) {
      orders.push({ unit: unit.id, kind: 'fire', target: parseKey(pick(opts.fire)) });
    } else {
      const kind = can('dash') && rnd() < 0.3 ? 'dash' : 'move';
      const ends = kind === 'dash' ? opts.dash : opts.move;
      if (ends.length === 0) continue;
      const allowance = (UNITS[unit.type].move + (gift(view, unit)?.move ?? 0)) * (kind === 'dash' ? 2 : 1);
      let path: Hex[] | null;
      if (rnd() < 0.2) {
        // a wandering path, which may double back
        path = [];
        let at = unit.pos;
        const steps = 1 + Math.floor(rnd() * allowance);
        for (let i = 0; i < steps; i++) {
          const next = neighbors(at).filter((n) => view.map.cells[key(n)] && TERRAIN[view.map.cells[key(n)].terrain].passable);
          at = pick(next);
          path.push(at);
        }
      } else if (rnd() < 0.15) {
        // onto, or through, a hex one of its own squad stands on
        const friends = ends.filter((k) => view.units.some((x) => x.owner === player && x.id !== unit.id && x.status !== 'down' && key(x.pos) === k));
        path = friends.length > 0 ? findPath(view.map, unit.pos, parseKey(pick(friends)), allowance) : null;
      } else {
        let end = pick(ends);
        if (rnd() < 0.7) {
          const area = pick(map.objectives).hexes;
          const near = (k: string) => Math.min(...area.map((h) => distance(parseKey(k), h)));
          end = ends.reduce((best, k) => (near(k) < near(best) ? k : best), ends[0]);
        }
        path = findPath(view.map, unit.pos, parseKey(end), allowance);
      }
      if (!path || path.length === 0) continue;
      const order: Order = { unit: unit.id, kind, path };
      if (order.kind === 'move' && rnd() < 0.5) {
        // a follow-up from the end of the path: at an enemy in view if one is in reach, else anywhere it may be aimed
        const follow = followUpOptions(view, unit.id, path[path.length - 1]);
        const kinds = (['fire', 'special'] as const).filter((k) => follow[k].length > 0);
        if (kinds.length > 0) {
          const k = pick(kinds);
          const friendAt = new Set(view.units.filter((x) => x.owner === player && x.id !== unit.id).map((x) => key(x.pos)));
          const good = follow[k].filter((t) => (k === 'fire' ? enemyAt.has(t) : friendAt.has(t)));
          const target = parseKey(pick(good.length > 0 && rnd() < 0.8 ? good : follow[k]));
          order.then = k === 'special' ? { kind: k, target, ...work(unit.type) } : { kind: k, target };
        }
      }
      orders.push(order);
    }
  }
  return orders;
}

/** Now and then, buy back a downed man who can be bought back and afforded (18); now and then, junk. */
function randomPurchases(state: GameState, player: PlayerId, rnd: () => number): Purchase[] {
  const out: Purchase[] = [];
  let left = state.scores[player];
  for (const u of state.units) {
    if (u.owner !== player) continue;
    const cost = buyBackCost(state, u.id);
    if (cost !== null && cost <= left && rnd() < 0.35) { out.push({ kind: 'return', unit: u.id }); left -= cost; }
  }
  return out;
}
const junkPurchases = (state: GameState, player: PlayerId): Purchase[] => [
  { kind: 'return', unit: state.units.find((x) => x.owner !== player)!.id },
  { kind: 'return', unit: state.units.find((x) => x.owner === player)!.id },
  { kind: 'return', unit: 'nobody' },
  { kind: 'other', unit: 'x' } as unknown as Purchase,
];

/** Orders no client should send: resolve must shrug them off. */
function junkOrders(state: GameState, player: PlayerId, rnd: () => number): Order[] {
  const other = state.units.find((x) => x.owner !== player)!;
  const mine = state.units.find((x) => x.owner === player)!;
  const junk: Order[] = [
    { unit: other.id, kind: 'ambush' },
    { unit: mine.id, kind: 'move', path: [{ q: 40, r: 40 }] },
    { unit: mine.id, kind: 'fire', target: { q: mine.pos.q + 30, r: mine.pos.r } },
    { unit: 'nobody', kind: 'ambush' },
    { unit: mine.id, kind: 'dash', path: [], then: { kind: 'fire', target: mine.pos } } as unknown as Order,
    { unit: mine.id, kind: 'move', path: [mine.pos], then: { kind: 'fire', target: { q: mine.pos.q + 30, r: mine.pos.r } } },
    null as unknown as Order,
  ];
  return junk.filter(() => rnd() < 0.6);
}

// ---- who may see whom, written out again from the rule's table and not taken from the rules
//
//   the unit, so far this round | in hiding terrain          | in the open
//   kept still                  | from `hide.still` or nearer | seen
//   moved, did not dash         | from `hide.moved` or nearer | seen
//   dashed                      | seen                        | seen
//   fired (revealed)            | seen                        | seen
//
// "Seen" still needs a living enemy unit within its own sight range and a clear
// line. A spotter's `spotting` is added to the hide distance. An eliminated
// player sees every living unit. A unit that is down is never seen.
// The kind of the objective whose area the unit stands in, if its owner holds that flag (21). Worked out here.
const gift = (s: Pick<GameState, 'map' | 'flags'>, f: Unit) => {
  const obj = s.map.objectives.find((o) => s.flags[o.id] === f.owner && o.hexes.some((h) => key(h) === key(f.pos)));
  return obj ? OBJECTIVE_KINDS[obj.kind] : null;
};
// A unit's sight in the state's round: its type's, plus the sun (19), at least 1, plus a held objective's (21).
// Worked out here, not by `sightOf`.
const sightIn = (s: GameState, f: Unit): number =>
  Math.max(1, UNITS[f.type].sight + SUN[Math.min(s.round, SUN.length) - 1]) + (gift(s, f)?.sight ?? 0);
function maySee(s: GameState, p: PlayerId): Set<UnitId> {
  const out = new Set<UnitId>();
  for (const e of s.units) {
    if (e.owner === p || e.status === 'down') continue;
    if (s.eliminated[p]) { out.add(e.id); continue; }
    const hide = TERRAIN[s.map.cells[key(e.pos)].terrain].hide;
    let near = Infinity;
    if (hide !== null && !e.revealed) {
      if (e.posture === 'still') near = hide.still;
      else if (e.posture === 'moved') near = hide.moved ?? Infinity;
      else if (e.posture !== 'dashed') throw new Error(`unit ${e.id} has posture ${String(e.posture)}`);
    }
    for (const f of s.units) {
      if (f.owner !== p || f.status === 'down') continue;
      const d = distance(f.pos, e.pos);
      if (d <= sightIn(s, f) && d <= near + UNITS[f.type].spotting && canSee(s.map, f.pos, e.pos)) { out.add(e.id); break; }
    }
  }
  return out;
}

// ---- an independent replay of one round from its full event list
const enemyIdsIn = (e: GameEvent): UnitId[] => {
  switch (e.t) {
    case 'treat': return [e.unit, e.target];
    case 'fire': return e.unit ? [e.unit] : [];
    case 'launch': case 'hit': case 'move': case 'blocked': case 'lost': case 'recover': case 'reveal': case 'dash': case 'unable': return [e.unit];
    case 'spotted': return [e.unit.id];
    default: return [];
  }
};

/** Does using this action give its user away? What an event's `action` tells whoever sees it. */
const givesAway = (action: string): boolean => ACTIONS[action].reveals;

/** Is this unit out of an enemy's sight although that enemy has a clear line to it within sight range? */
function hidesHolder(s: GameState, holder: Unit): boolean {
  return s.units.some((f) => f.owner !== holder.owner && f.status !== 'down' && !s.eliminated[f.owner]
    && distance(f.pos, holder.pos) <= sightIn(s, f) && canSee(s.map, f.pos, holder.pos) && !maySee(s, f.owner).has(holder.id));
}

function applyEvent(s: GameState, e: GameEvent, round: number): void {
  const unit = (id: UnitId) => s.units.find((x) => x.id === id)!;
  switch (e.t) {
    case 'phase': if (e.phase === 'treat') for (const x of s.units) { x.revealed = false; x.posture = 'still'; } break;
    case 'dash': unit(e.unit).posture = 'dashed'; unit(e.unit).dugIn = false; break;
    case 'dig': unit(e.unit).dugIn = true; break;
    case 'treat': unit(e.target).status = 'ready'; unit(e.target).pinnedRound = null; break;
    case 'fire': if (e.unit && givesAway(e.action)) unit(e.unit).revealed = true; break;
    case 'launch': if (givesAway(e.action)) unit(e.unit).revealed = true; break;
    case 'reveal': unit(e.unit).revealed = true; break;
    case 'hit':
      if (e.result === 'pinned') { unit(e.unit).status = 'pinned'; unit(e.unit).pinnedRound = round; }
      if (e.result === 'down') {
        unit(e.unit).status = 'down'; unit(e.unit).pinnedRound = null; unit(e.unit).dugIn = false;
        const returns = MODES[s.mode].returns;
        if (returns) unit(e.unit).returnRound = round + returns.rounds;     // the event does not say it: the rule does
      }
      break;
    case 'purchase': s.scores[e.player] -= e.cost; unit(e.unit).returnRound = round; break;
    case 'return': Object.assign(unit(e.unit), { pos: { ...e.at }, status: 'ready', posture: 'still', revealed: false, pinnedRound: null, returnRound: null, dugIn: false }); break;
    case 'move': unit(e.unit).pos = { ...e.to }; unit(e.unit).dugIn = false; if (unit(e.unit).posture === 'still') unit(e.unit).posture = 'moved'; break;
    case 'recover': unit(e.unit).status = 'ready'; unit(e.unit).pinnedRound = null; break;
    case 'capture': s.flags[e.objective] = e.player; break;
    case 'score': s.scores[e.player] += e.value; break;
    case 'eliminated':
      s.eliminated[e.player] = true;
      for (const id of Object.keys(s.flags)) if (s.flags[id] === e.player) s.flags[id] = null;
      break;
    case 'over': s.over = true; s.winners = [...e.winners]; break;
    case 'build': {   // (25) the cost leaves supply; the hex is the work's terrain from now on
      s.scores[unit(e.unit).owner] -= WORKS[e.work].cost;
      s.works = { ...s.works, [key(e.at)]: e.work };
      s.map = { ...s.map, cells: { ...s.map.cells, [key(e.at)]: { ...s.map.cells[key(e.at)], terrain: WORKS[e.work].terrain } } };
      break;
    }
    default: break;
  }
}

/** Does a player's event correspond to this event of the full list? */
function matches(mine: GameEvent, full: GameEvent): boolean {
  if (JSON.stringify(mine) === JSON.stringify(full)) return true;
  if (mine.t === 'fire' && full.t === 'fire' && mine.unit === null) {
    return JSON.stringify(mine) === JSON.stringify({ ...full, unit: null, from: null });
  }
  return mine.t === 'recover' && full.t === 'treat' && full.target === mine.unit;
}

interface Stats { [k: string]: number }

/** Check one resolved round from every angle. Returns nothing; throws on a broken rule. */
function checkRound(before: GameState, orders: Order[][], result: ReturnType<typeof resolve>, stats: Stats, where: string): void {
  const { state: after, events, playerEvents } = result;
  const players = Array.from({ length: before.playerCount }, (_, i) => i);
  const fail = (msg: string): never => { throw new Error(`${where}: ${msg}`); };

  // a recover (the score phase's) is of a unit pinned before this round, or (21) of one a held depot rallies
  for (const e of events) {
    if (e.t !== 'recover') continue;
    const b = before.units.find((x) => x.id === e.unit)!;
    if (b.status === 'pinned' && (b.pinnedRound ?? Infinity) < before.round) continue;
    const a = after.units.find((x) => x.id === e.unit)!;
    if (!gift(after, a)?.rally) fail(`${e.unit} recovered in the round it was pinned, off a held depot`);
    stats.rally = (stats.rally ?? 0) + 1;
  }

  // one living unit per hex, everyone on passable ground (the ground as it is now: works included, 25)
  const held = new Set<string>();
  for (const x of after.units) {
    const cell = after.map.cells[key(x.pos)];
    // A man who is down may lie where wire went up after he fell (25): nobody stands there, he only lies there.
    if (!cell || (!TERRAIN[cell.terrain].passable && !(x.status === 'down' && Object.hasOwn(after.works, key(x.pos))))) fail(`${x.id} is off the board`);
    if (x.status === 'down') continue;
    if (held.has(key(x.pos))) fail(`two units on ${key(x.pos)}`);
    held.add(key(x.pos));
  }
  if (after.round !== before.round + 1) fail('round did not advance by one');

  // works (25): never lost, each one the terrain of its hex, never on water or in an objective, each new one told by a `build`
  for (const [k, w] of Object.entries(before.works)) if (after.works[k] !== w) fail(`the work at ${k} is gone`);
  const built = events.filter((e): e is Extract<GameEvent, { t: 'build' }> => e.t === 'build');
  if (Object.keys(after.works).length !== Object.keys(before.works).length + built.length) fail('works and build events do not add up');
  for (const [k, w] of Object.entries(after.works)) {
    if (after.map.cells[k]?.terrain !== WORKS[w].terrain) fail(`the work at ${k} is not its hex's terrain`);
    if (before.map.cells[k].terrain === 'water' || after.map.objectives.some((o) => o.hexes.some((h) => key(h) === k))) fail(`a work at ${k}, on water or in an objective`);
  }
  for (const e of built) {
    if (!TERRAIN[WORKS[e.work].terrain].passable && after.units.some((x) => x.status !== 'down' && key(x.pos) === key(e.at))) fail(`wire at ${key(e.at)} under a man`);
    stats[`built ${e.work}`] = (stats[`built ${e.work}`] ?? 0) + 1;
  }
  if (Object.keys(after.works).length === 0 && after.map !== before.map) fail('the map was copied with nothing built');

  // dig in (24): dug in means alive and still this round; a man dug in who was not before was told by a `dig`; a man who stepped or ran is not
  const digs = new Set(events.flatMap((e) => (e.t === 'dig' ? [e.unit] : [])));
  for (const x of after.units) {
    const was = before.units.find((y) => y.id === x.id)!;
    if (x.dugIn && (x.status === 'down' || x.posture !== 'still')) fail(`${x.id} is dug in but ${x.status} and ${x.posture}`);
    if (x.dugIn && !was.dugIn && !digs.has(x.id)) fail(`${x.id} dug in without a dig event`);
    if (digs.has(x.id) && (!x.dugIn || was.dugIn || was.status === 'down')) fail(`${x.id} dug in again, or from the dead`);
    if (x.dugIn) stats['dug in at a round end'] = (stats['dug in at a round end'] ?? 0) + 1;
  }

  // where a unit may be: on its start hex or a hex of the path it was given, never past its end or off it;
  // a unit given no move stands where it stood. The order that counts is the first legal one for the unit.
  const counted = new Map<UnitId, Order>();
  players.forEach((p) => {
    for (const o of orders[p] ?? []) {
      if (o && typeof o === 'object' && !counted.has(o.unit) && validateOrders(before, p, [o]).length === 0) counted.set(o.unit, o);
    }
  });
  const follows = new Map<UnitId, string>();        // unit -> the action its follow-up uses
  const builders = new Set<UnitId>();               // (25) units with a build ordered: a special, or a move's follow-up
  for (const x of before.units) {
    const o = counted.get(x.id);
    const walked = o && (o.kind === 'move' || o.kind === 'dash') ? o.path : [];
    const now = after.units.find((y) => y.id === x.id)!;
    const back = events.find((e): e is Extract<GameEvent, { t: 'return' }> => e.t === 'return' && e.unit === x.id);
    const at = back ? (key(back.at) === key(now.pos) ? 0 : -1) : [x.pos, ...walked].findIndex((hx) => key(hx) === key(now.pos));
    if (at === -1) fail(walked.length > 0 ? `${x.id} ended at ${key(now.pos)}, off its path` : `${x.id} held still and has moved to ${key(now.pos)}`);
    const special = o?.kind === 'special' ? o : o?.kind === 'move' && o.then?.kind === 'special' ? o.then : null;
    if (special && ACTIONS[UNITS[x.type].special ?? '']?.phase === 'build') builders.add(x.id);
    if (o?.kind === 'move' && o.then) {
      follows.set(x.id, UNITS[x.type][o.then.kind]!);
      stats['follow-up ordered'] = (stats['follow-up ordered'] ?? 0) + 1;
    }
  }
  // Every follow-up is accounted for, once: it ran (the unit's own shot, launch or quiet action in the assault phase) or an `unable` says why not.
  {
    let assault = false;
    let scoring = false;
    const unable = new Map<UnitId, string>();
    const ran = new Set<UnitId>();
    for (const e of events) {
      if (e.t === 'phase') { assault = e.phase === 'assault'; scoring = e.phase === 'score'; }
      if (e.t === 'build') {   // (25) a work goes up in the score phase, for a build that was ordered; once
        if (!scoring || !builders.has(e.unit) || ran.has(e.unit) || unable.has(e.unit)) fail(`a build that was not ordered, or out of turn: ${JSON.stringify(e)}`);
        ran.add(e.unit);
      }
      if (e.t === 'unable') {
        const build = ACTIONS[e.action]?.phase === 'build';
        if (!assault && !(build && scoring)) fail(`"unable" outside the assault phase: ${JSON.stringify(e)}`);
        if (build ? !builders.has(e.unit) : follows.get(e.unit) !== e.action) fail(`"unable" for a follow-up that was not ordered: ${JSON.stringify(e)}`);
        if (unable.has(e.unit)) fail(`"unable" twice: ${JSON.stringify(e)}`);
        unable.set(e.unit, e.reason);
        stats[`unable ${e.reason}`] = (stats[`unable ${e.reason}`] ?? 0) + 1;
      }
      if (assault && (e.t === 'fire' || e.t === 'launch' || e.t === 'treat') && e.unit) {
        if (follows.get(e.unit) !== e.action) fail(`an action in the assault phase that was not ordered as a follow-up: ${JSON.stringify(e)}`);
        ran.add(e.unit);
        stats[`follow-up ${e.t}`] = (stats[`follow-up ${e.t}`] ?? 0) + 1;
      }
    }
    for (const [id, action] of follows) {
      if (unable.has(id) && ran.has(id)) fail(`${id}'s follow-up both ran and did not`);
      // A quiet action that changes nobody leaves no event; anything announced must show.
      if (!unable.has(id) && !ran.has(id) && ACTIONS[action].phase !== 'treat') fail(`${id}'s follow-up left no trace`);
    }
    for (const id of builders) if (!unable.has(id) && !ran.has(id)) fail(`${id}'s build left no trace`);
  }

  // snapshots: the state after each "moment" (a run of hits, or the moves of one step, counts as one)
  const snap = (s: GameState): GameState => ({ ...s, units: s.units.map((x) => ({ ...x, pos: { ...x.pos } })), scores: [...s.scores], eliminated: [...s.eliminated], flags: { ...s.flags }, works: { ...s.works }, winners: [...s.winners] });
  const sim = snap(before);
  let phaseNow = 'plan';
  const halted = new Set<UnitId>();                 // units told `blocked` this round: a later move of theirs is a fall back
  const group: number[] = [];                       // event index -> the snapshot just before its moment
  const snaps: GameState[] = [snap(sim)];           // snaps[0] = before the round; snaps[g + 1] = after moment g
  events.forEach((e, i) => {
    const prev = events[i - 1];
    // Effects that land together are one moment: a hit may take down the only man who saw the treatment beside it.
    const lands = (x: GameEvent) => x.t === 'hit' || x.t === 'treat';
    const same = i > 0 && ((lands(e) && lands(prev)) || (e.t === 'move' && prev.t === 'move' && e.step === prev.step));
    applyEvent(sim, e, before.round);
    // One living unit per hex whenever movement is not under way; teammates (never enemies, except where one
    // has just fallen back) may share a hex while it is.
    const stack = new Map<string, Unit[]>();
    for (const x of sim.units) if (x.status !== 'down') stack.set(key(x.pos), [...(stack.get(key(x.pos)) ?? []), x]);
    const shared = [...stack.values()].filter((l) => l.length > 1);
    if (shared.length > 0) {
      if (phaseNow !== 'move') fail(`two units on ${key(shared[0][0].pos)} in the ${phaseNow} phase`);
      stats['shared hex'] = (stats['shared hex'] ?? 0) + 1;
      if (shared.some((l) => l.some((x) => x.owner !== l[0].owner))) stats['shared hex, enemies'] = (stats['shared hex, enemies'] ?? 0) + 1;
    }
    if (e.t === 'phase') {
      if (shared.length > 0) fail(`two units on ${key(shared[0][0].pos)} when the ${e.phase} phase begins`);
      phaseNow = e.phase;
      halted.clear();
    }
    if (e.t === 'blocked') {
      if (halted.has(e.unit)) fail(`${e.unit} blocked twice in a round`);
      halted.add(e.unit);
    }
    if (e.t === 'move' && halted.has(e.unit)) stats['fall back'] = (stats['fall back'] ?? 0) + 1;
    if (same) snaps[snaps.length - 1] = snap(sim);
    else snaps.push(snap(sim));
    group.push(snaps.length - 2);
    const name = e.t === 'hit' ? `hit ${e.result}` : e.t === 'fire' && e.ambush ? 'fire ambush' : e.t;
    stats[name] = (stats[name] ?? 0) + 1;
  });
  sim.round += 1;
  // Last Stand (20): the score is a live tally of men standing, with no event of its own.
  if (MODES[before.mode].win === 'survival') {
    sim.scores = sim.scores.map((_, p) => sim.units.filter((x) => x.owner === p && x.status !== 'down').length);
  }
  snaps.push(snap(sim));   // the last moment: the next round's light (19), which may bring more into sight
  // the full event list describes the whole change of state
  if (text(sim) !== text(after)) fail('the events do not add up to the new state');
  // every flag owned once the captures are done earns exactly once; a flag of nobody's, never
  if (!before.over) {
    const owned = { ...before.flags };
    for (const e of events) if (e.t === 'capture') owned[e.objective] = e.player;
    for (const o of map.objectives) {
      const n = events.filter((e) => e.t === 'score' && e.objective === o.id).length;
      const earns = MODES[before.mode].supply && owned[o.id] !== null;     // (20) a mode without supply earns nothing
      if (n !== (earns ? 1 : 0)) fail(`flag ${o.id} (${owned[o.id]}) earned ${n} times`);
    }
  }

  // Last Stand (20): down is final, nothing is bought, the winners are the most men, then the dearest, and a
  // last round that wipes the last squads together shares the win among those not already out.
  if (MODES[before.mode].win === 'survival') {
    if (events.some((e) => e.t === 'purchase' || e.t === 'return')) fail('a purchase or a return in a mode with neither');
    const alive = (p: PlayerId) => after.units.filter((u) => u.owner === p && u.status !== 'down');
    for (const p of players) if (after.scores[p] !== alive(p).length) fail(`player ${p}'s score is not the men standing`);
    for (const u of after.units) if (u.returnRound !== null) fail(`${u.id} has a returnRound in Last Stand`);
    const left = players.filter((p) => alive(p).length > 0);
    if (after.over !== (after.round > map.maxRounds || left.length < 2) && !before.over) fail('the match ended at the wrong time');
    if (after.over && !before.over) {
      const worth = (p: PlayerId) => alive(p).reduce((a, u) => a + UNITS[u.type].cost, 0);
      let want: PlayerId[];
      if (left.length === 0) want = players.filter((p) => !before.eliminated[p]);
      else {
        const most = Math.max(...left.map((p) => alive(p).length));
        const tied = left.filter((p) => alive(p).length === most);
        const dear = Math.max(...tied.map(worth));
        want = tied.filter((p) => worth(p) === dear);
        if (tied.length > 1 && tied.some((p) => worth(p) !== dear)) stats['won on worth'] = (stats['won on worth'] ?? 0) + 1;
      }
      if (JSON.stringify(after.winners) !== JSON.stringify(want)) fail(`winners ${after.winners} are not ${want}`);
      if (left.length === 0) stats['last squads fell together'] = (stats['last squads fell together'] ?? 0) + 1;
    }
  }

  // Supply Line (18): purchases paid from what there was, returns only at an open HQ, nobody due left waiting for nothing
  {
    const returns = MODES[before.mode].returns;
    for (const p of players) {
      if (after.scores[p] < 0) fail(`player ${p} has negative supply`);
      const told = playerEvents[p].filter((e) => e.t === 'purchase').map((e) => JSON.stringify(e));
      const all = events.filter((e) => e.t === 'purchase').map((e) => JSON.stringify(e));
      if (told.join() !== all.join()) fail(`player ${p} was not told every purchase`);
    }
    for (const e of events) {
      if (e.t === 'purchase') {
        const u = before.units.find((x) => x.id === e.unit);
        if (!returns || !u || u.owner !== e.player || u.status !== 'down') fail(`a purchase of ${e.unit} that should not be: ${JSON.stringify(e)}`);
        stats.purchase = (stats.purchase ?? 0) + 1;
      }
      if (e.t === 'return') {
        const u = after.units.find((x) => x.id === e.unit)!;
        const hq = hqOf(after, u.owner);
        const zone = map.spawns[map.seatSpawns[after.playerCount][u.owner]];
        if (!returns || !lineOpen(after, u.owner)) fail(`${e.unit} came back with its line cut`);
        if (![...(hq?.hexes ?? []), ...zone].some((h) => key(h) === key(e.at)) || key(u.pos) !== key(e.at)) fail(`${e.unit} came back at ${key(e.at)}, not at its HQ`);
        stats.return = (stats.return ?? 0) + 1;
        if (hq && !hq.hexes.some((h) => key(h) === key(e.at))) stats['return in the start zone'] = (stats['return in the start zone'] ?? 0) + 1;
      }
    }
    for (const u of after.units) {
      if (u.status !== 'down') { if (u.returnRound !== null) fail(`${u.id} stands with a returnRound`); continue; }
      if (!returns && u.returnRound !== null) fail(`${u.id} is due back in a mode where nobody comes back`);
      if (returns && u.returnRound === null) fail(`${u.id} is down and not coming back in a mode with returns`);
      if (u.returnRound !== null && u.returnRound <= before.round && !after.eliminated[u.owner]) {
        if (lineOpen(after, u.owner)) fail(`${u.id} was due back and its line is open, but it did not come back`);
        stats['waits, line cut'] = (stats['waits, line cut'] ?? 0) + 1;
      }
    }
    for (const p of players) {
      const standing = after.units.some((u) => u.owner === p && u.status !== 'down');
      const due = lineOpen(after, p) && after.units.some((u) => u.owner === p && u.status === 'down' && u.returnRound !== null);
      if (after.eliminated[p] && !before.eliminated[p] && (standing || due)) fail(`player ${p} eliminated while it could still fight or bring a man back`);
      if (!after.eliminated[p] && !standing && !due) fail(`player ${p} has nobody and nobody coming, and is not out`);
    }
  }

  const visCache = new Map<string, Set<UnitId>>();
  const vis = (snap: number, p: PlayerId): Set<UnitId> => {
    const k = `${snap}/${p}`;
    let v = visCache.get(k);
    if (!v) {
      visCache.set(k, (v = maySee(snaps[snap], p)));
      // The rules must agree with the table at every moment of the round, not only at its end.
      const rules = visibleEnemies(snaps[snap], p).map((x) => x.id).sort().join(' ');
      if (rules !== [...v].sort().join(' ')) fail(`player ${p} at moment ${snap}: the rules show [${rules}], the sight table says [${[...v].sort().join(' ')}]`);
    }
    return v;
  };
  const owner = (id: UnitId) => before.units.find((x) => x.id === id)?.owner;

  for (const p of players) {
    // -- (a) nothing about an enemy the player could not see around that moment
    let last = 0;                                    // snapshot index reached so far
    let pending: GameEvent[] = [];                   // spotted / lost waiting for their window to close
    let j = 0;
    const closeWindow = (upTo: number) => {
      for (const e of pending) {
        let ok = false;
        for (let s = last; s <= upTo && !ok; s++) {
          if (e.t === 'spotted') {
            const there = snaps[s].units.find((x) => x.id === e.unit.id)!;
            ok = vis(s, p).has(e.unit.id) && JSON.stringify(there) === JSON.stringify(e.unit);
          } else if (e.t === 'lost') {
            ok = !vis(s, p).has(e.unit);
          }
        }
        if (!ok) fail(`player ${p} got ${JSON.stringify(e)} with no moment to justify it`);
      }
      pending = [];
    };
    for (const e of playerEvents[p]) {
      if (e.t === 'spotted' || e.t === 'lost') {
        if (owner(e.t === 'spotted' ? e.unit.id : e.unit) === p) fail(`player ${p} got ${e.t} for an own unit`);
        pending.push(e);
        stats[e.t] = (stats[e.t] ?? 0) + 1;
        continue;
      }
      let k = j;
      while (k < events.length && !matches(e, events[k])) k++;
      if (k >= events.length) fail(`player ${p} got ${JSON.stringify(e)}, which is not in the round's events (in order)`);
      j = k + 1;
      const pre = group[k];                          // snapshot before this event's group
      const post = group[k] + 1;
      closeWindow(post);
      last = post;
      for (const id of enemyIdsIn(e)) {
        if (owner(id) === p) continue;
        if (!vis(pre, p).has(id) && !vis(post, p).has(id)) fail(`player ${p} was told of unseen ${id}: ${JSON.stringify(e)}`);
      }
      if (e.t === 'fire' && e.unit === null) {
        stats['fire unseen shooter'] = (stats['fire unseen shooter'] ?? 0) + 1;
        const full = events[k];
        if (full.t !== 'fire' || !full.unit) throw new Error('bad match');
        if (vis(post, p).has(full.unit)) fail(`player ${p} saw the shooter but got no name: ${JSON.stringify(full)}`);
        if (!visibleHexes(snaps[pre], p).has(key(e.target)) && !visibleHexes(snaps[post], p).has(key(e.target))) {
          fail(`player ${p} was told of fire at a hex it cannot see`);
        }
      }
      if (e.t === 'capture' || e.t === 'score') {
        // Flags are public: told to everyone, exactly as the full list has it.
        const full = events[k];
        if (JSON.stringify(full) !== JSON.stringify(e)) fail(`player ${p} was told ${JSON.stringify(e)} for ${JSON.stringify(full)}`);
      }
      if (e.t === 'capture' && p === 0) {
        // The only side with a ready unit in the area takes the flag from whoever had it.
        const obj = map.objectives.find((o) => o.id === e.objective)!;
        const area = new Set(obj.hexes.map(key));
        const inside = snaps[post].units.filter((x) => x.status === 'ready' && area.has(key(x.pos)));
        const sides = new Set(inside.map((x) => x.owner));
        if (sides.size !== 1 || !sides.has(e.player)) fail(`capture of ${obj.id} by ${e.player} with ${[...sides].join(',') || 'nobody'} in the area`);
        if ((snaps[pre].flags[obj.id] ?? null) !== e.from || e.from === e.player) fail(`capture of ${obj.id} from ${e.from}, but the flag was ${snaps[pre].flags[obj.id]}'s`);
        stats.capture = (stats.capture ?? 0) + 1;
        if (e.from !== null) stats['capture from a player'] = (stats['capture from a player'] ?? 0) + 1;
        if (inside.every((x) => hidesHolder(snaps[post], x))) stats['capture by a hidden unit'] = (stats['capture by a hidden unit'] ?? 0) + 1;
      }
      if (e.t === 'score' && p === 0) {
        const obj = map.objectives.find((o) => o.id === e.objective)!;
        if (snaps[post].flags[obj.id] !== e.player || e.value !== obj.value + OBJECTIVE_KINDS[obj.kind].supply) fail(`score ${JSON.stringify(e)} but the flag is ${snaps[post].flags[obj.id]}'s`);
      }
      if (e.t === 'impact') {
        const launched = playerEvents[p].some((x) => x.t === 'launch' && owner(x.unit) === p);
        if (!launched && !visibleHexes(snaps[pre], p).has(key(e.target)) && !visibleHexes(snaps[post], p).has(key(e.target))) {
          fail(`player ${p} was told of an impact on a hex it cannot see`);
        }
      }
    }
    closeWindow(snaps.length - 1);

    // -- (b) a client that only applies its events ends up with exactly the new view
    const start = viewFor(before, p);
    const model = new Map<UnitId, Unit>(start.units.map((x) => [x.id, clone(x)]));
    const flags = { ...start.flags };
    const need = (id: UnitId, e: GameEvent): Unit => model.get(id) ?? fail(`player ${p}: ${JSON.stringify(e)} is about a unit not in its picture`);
    for (const e of playerEvents[p]) {
      switch (e.t) {
        case 'phase': if (e.phase === 'treat') for (const x of model.values()) { x.revealed = false; x.posture = 'still'; } break;
        case 'dash': need(e.unit, e).posture = 'dashed'; need(e.unit, e).dugIn = false; break;
        case 'dig': need(e.unit, e).dugIn = true; break;
        case 'spotted': if (model.has(e.unit.id)) fail(`player ${p}: spotted ${e.unit.id} twice`); model.set(e.unit.id, clone(e.unit)); break;
        case 'lost': need(e.unit, e); model.delete(e.unit); break;
        case 'treat': need(e.unit, e); need(e.target, e).status = 'ready'; need(e.target, e).pinnedRound = null; break;
        case 'recover': need(e.unit, e).status = 'ready'; need(e.unit, e).pinnedRound = null; break;
        case 'fire': if (e.unit && givesAway(e.action)) need(e.unit, e).revealed = true; break;
        case 'launch': if (givesAway(e.action)) need(e.unit, e).revealed = true; break;
        case 'reveal': need(e.unit, e).revealed = true; break;
        case 'move': {
          const x = need(e.unit, e);
          if (key(x.pos) !== key(e.from)) fail(`player ${p}: move of ${e.unit} does not start where it was last seen`);
          x.pos = { ...e.to };
          x.dugIn = false;
          if (x.posture === 'still') x.posture = 'moved';
          break;
        }
        case 'blocked': need(e.unit, e); break;
        case 'capture': flags[e.objective] = e.player; break;
        case 'eliminated': for (const id of Object.keys(flags)) if (flags[id] === e.player) flags[id] = null; break;
        case 'hit': {
          const x = need(e.unit, e);
          if (key(x.pos) !== key(e.at)) fail(`player ${p}: hit on ${e.unit} is not where it was last seen`);
          if (e.result === 'pinned') { x.status = 'pinned'; x.pinnedRound = before.round; }
          if (e.result === 'down') {
            x.status = 'down'; x.pinnedRound = null; x.dugIn = false;
            const returns = MODES[before.mode].returns;
            if (returns) x.returnRound = before.round + returns.rounds;
            if (x.owner !== p) model.delete(x.id);   // a downed enemy leaves the picture
          }
          break;
        }
        case 'purchase': if (model.has(e.unit)) need(e.unit, e).returnRound = before.round; break;
        case 'return': {
          // Own: back on its feet at the HQ. An enemy's comes into the picture by its `spotted`, if at all.
          const x = model.get(e.unit);
          if (x) Object.assign(x, { pos: { ...e.at }, status: 'ready', posture: 'still', revealed: false, pinnedRound: null, returnRound: null, dugIn: false });
          else if (owner(e.unit) === p) fail(`player ${p}: return of own ${e.unit}, which it did not know`);
          break;
        }
        default: break;
      }
    }
    const byId = (a: Unit, b: Unit) => (a.id < b.id ? -1 : 1);
    if (JSON.stringify([...model.values()].sort(byId)) !== JSON.stringify([...viewFor(after, p).units].sort(byId))) {
      fail(`player ${p}'s events do not add up to its view`);
    }
    if (JSON.stringify(flags) !== JSON.stringify(viewFor(after, p).flags)) fail(`player ${p}'s captures do not add up to its view's flags`);
  }
}

function playMatch(seed: number, stats: Stats): void {
  const rnd = mulberry32(seed);
  const buyRnd = mulberry32(seed + 1_000_003);   // purchases draw from their own stream, so the orders are drawn as they were before 18
  const playerCount = 2 + (seed % 3);
  // One match in four in Last Stand, where nobody comes back (and squads are wiped out); the rest in Supply Line (18).
  const mode = seed % 4 === 0 ? 'last-stand' : 'supply-line';
  const presets = PRESETS.filter((p) => p.units.every((u) => (MODES[mode].units ?? [u]).includes(u)));
  const squads = Array.from({ length: playerCount }, (_, player) => ({
    player, units: presets[Math.floor(rnd() * presets.length)].units,
  }));
  map = mapFor(playerCount);
  const mapBefore = JSON.stringify(map.cells);
  let state = createMatch(map, squads, mode);
  const record: Order[][][] = [];
  const bought: Purchase[][][] = [];
  const allEvents: GameEvent[][] = [];
  while (!state.over) {
    const where = `seed ${seed} round ${state.round}`;
    const orders: Order[][] = [];
    const purchases: Purchase[][] = [];
    for (let p = 0; p < playerCount; p++) {
      const buys = randomPurchases(state, p, buyRnd);
      if (validatePurchases(state, p, buys).length > 0) throw new Error(`${where}: generated purchases rejected: ${JSON.stringify(validatePurchases(state, p, buys))}`);
      purchases.push(buyRnd() < 0.1 ? [...junkPurchases(state, p), ...buys] : buys);
      const legal = randomOrders(state, p, rnd);
      const errors = validateOrders(state, p, legal);
      if (errors.length > 0) throw new Error(`${where}: generated orders rejected: ${JSON.stringify(errors)}`);
      if (rnd() < 0.1) {
        const junk = junkOrders(state, p, rnd);
        if (junk.length > 0 && validateOrders(state, p, [...legal, ...junk]).length < junk.length) {
          throw new Error(`${where}: junk orders were accepted`);
        }
        orders.push([...legal, ...junk]);
      } else {
        orders.push(legal);
      }
    }
    const beforeText = JSON.stringify(state);
    const ordersText = JSON.stringify([orders, purchases]);
    deepFreeze(state.units); deepFreeze(state.scores); deepFreeze(state.eliminated); deepFreeze(state.winners);
    deepFreeze(state.works); deepFreeze(state.map);   // (25) a build copies the map; MAPS itself is never written
    deepFreeze(orders); deepFreeze(purchases);
    let result: ReturnType<typeof resolve>;
    try {
      result = resolve(state, orders, purchases);
    } catch (err) {
      throw new Error(`${where}: resolve threw: ${String(err)}`);
    }
    if (JSON.stringify(state) !== beforeText || JSON.stringify([orders, purchases]) !== ordersText) throw new Error(`${where}: input was changed`);
    // same input, same output
    const twice = resolve(state, orders, purchases);
    if (text(twice.state) !== text(result.state) || JSON.stringify([twice.events, twice.playerEvents]) !== JSON.stringify([result.events, result.playerEvents])) {
      throw new Error(`${where}: not deterministic`);
    }
    checkRound(state, orders, result, stats, where);
    record.push(orders);
    bought.push(purchases);
    allEvents.push(result.events);
    state = result.state;
    if (state.round > map.maxRounds + 1) throw new Error(`seed ${seed}: match ran past its last round`);
  }
  if (JSON.stringify(map.cells) !== mapBefore) throw new Error(`seed ${seed}: MAPS.${map.id} was changed`);
  stats.matches = (stats.matches ?? 0) + 1;
  stats.rounds = (stats.rounds ?? 0) + record.length;
  if (record.length < map.maxRounds) stats['ended early'] = (stats['ended early'] ?? 0) + 1;
  if (state.winners.length === 0) throw new Error(`seed ${seed}: over with no winner`);
  if (state.winners.length > 1) stats['shared win'] = (stats['shared win'] ?? 0) + 1;

  // replay from the recorded orders (through JSON, as a log file would be)
  let again = createMatch(map, squads, mode);
  const recorded: Order[][][] = JSON.parse(JSON.stringify(record));
  const recordedBuys: Purchase[][][] = JSON.parse(JSON.stringify(bought));
  recorded.forEach((orders, i) => {
    const r = resolve(again, orders, recordedBuys[i]);
    if (JSON.stringify(r.events) !== JSON.stringify(allEvents[i])) throw new Error(`seed ${seed}: replay differs in round ${i + 1}`);
    again = r.state;
  });
  expect(JSON.stringify(again), `seed ${seed}: replay ends in a different state`).toBe(JSON.stringify(state));
}

describe('random matches', () => {
  it(`${MATCHES} full matches of random legal orders keep every promise`, () => {
    const stats: Stats = {};
    for (let seed = 1; seed <= MATCHES; seed++) playMatch(seed, stats);
    for (const seed of EXTRA_SEEDS) playMatch(seed, stats);
    // The matches must actually have exercised the rules, or the checks above prove little.
    for (const k of ['treat', 'fire', 'fire ambush', 'fire unseen shooter', 'launch', 'impact', 'hit cover', 'hit pinned', 'hit down',
      'move', 'blocked', 'dash', 'spotted', 'lost', 'recover', 'rally', 'score', 'capture', 'capture from a player', 'capture by a hidden unit',
      'eliminated', 'over', 'follow-up ordered', 'follow-up fire', 'follow-up treat', 'unable down', 'unable pinned', 'unable range',
      'unable sight', 'unable needs', 'shared hex', 'fall back', 'purchase', 'return', 'won on worth', 'dug in at a round end',
      'built sandbags', 'built wire', 'built nest', 'unable supply', 'unable blocked']) {
      expect(stats[k] ?? 0, `no "${k}" in ${MATCHES} matches`).toBeGreaterThan(0);
    }
    expect(stats.matches).toBe(MATCHES + EXTRA_SEEDS.length);
    console.log(JSON.stringify(stats));
  }, 120_000);
});
