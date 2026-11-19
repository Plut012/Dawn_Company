// Many whole matches with random legal orders, checking what must always hold.
// The randomness lives here only (a small seeded generator); the rules have none.

import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_MAP, MAPS, PRESETS, TERRAIN, UNITS } from '../content';
import { distance, key, neighbors, parseKey } from '../shared/hex';
import type { GameEvent, GameState, Hex, Order, PlayerId, Unit, UnitId } from '../shared/types';
import { canSee, createMatch, findPath, followUpOptions, orderOptions, resolve, validateOrders, viewFor, visibleEnemies, visibleHexes } from './index';

const MATCHES = 240;

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

const map = MAPS[DEFAULT_MAP];
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
  for (const unit of view.units.filter((x) => x.owner === player)) {
    const opts = orderOptions(view, unit.id);
    if (opts.kinds.length === 0) continue;
    const can = (k: string) => opts.kinds.includes(k as never);
    const targets = opts.fire.filter((k) => enemyAt.has(k));
    const roll = rnd();
    if (targets.length > 0 && roll < 0.5) {
      orders.push({ unit: unit.id, kind: 'fire', target: parseKey(pick(targets)) });
    } else if (opts.special.length > 0 && roll < 0.65) {
      orders.push({ unit: unit.id, kind: 'special', target: parseKey(pick(opts.special)) });
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
      const allowance = UNITS[unit.type].move * (kind === 'dash' ? 2 : 1);
      let path: Hex[] | null;
      if (rnd() < 0.2) {
        // a wandering path, which may double back
        path = [];
        let at = unit.pos;
        const steps = 1 + Math.floor(rnd() * allowance);
        for (let i = 0; i < steps; i++) {
          const next = neighbors(at).filter((n) => map.cells[key(n)] && TERRAIN[map.cells[key(n)].terrain].passable);
          at = pick(next);
          path.push(at);
        }
      } else if (rnd() < 0.15) {
        // onto, or through, a hex one of its own squad stands on
        const friends = ends.filter((k) => view.units.some((x) => x.owner === player && x.id !== unit.id && x.status !== 'down' && key(x.pos) === k));
        path = friends.length > 0 ? findPath(map, unit.pos, parseKey(pick(friends)), allowance) : null;
      } else {
        let end = pick(ends);
        if (rnd() < 0.7) {
          const goal = pick(map.objectives).hex;
          end = ends.reduce((best, k) => (distance(parseKey(k), goal) < distance(parseKey(best), goal) ? k : best), ends[0]);
        }
        path = findPath(map, unit.pos, parseKey(end), allowance);
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
          order.then = { kind: k, target: parseKey(pick(good.length > 0 && rnd() < 0.8 ? good : follow[k])) };
        }
      }
      orders.push(order);
    }
  }
  return orders;
}

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
      if (d <= UNITS[f.type].sight && d <= near + UNITS[f.type].spotting && canSee(s.map, f.pos, e.pos)) { out.add(e.id); break; }
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
    && distance(f.pos, holder.pos) <= UNITS[f.type].sight && canSee(s.map, f.pos, holder.pos) && !maySee(s, f.owner).has(holder.id));
}

function applyEvent(s: GameState, e: GameEvent, round: number): void {
  const unit = (id: UnitId) => s.units.find((x) => x.id === id)!;
  switch (e.t) {
    case 'phase': if (e.phase === 'treat') for (const x of s.units) { x.revealed = false; x.posture = 'still'; } break;
    case 'dash': unit(e.unit).posture = 'dashed'; break;
    case 'treat': unit(e.target).status = 'ready'; unit(e.target).pinnedRound = null; break;
    case 'fire': if (e.unit && givesAway(e.action)) unit(e.unit).revealed = true; break;
    case 'launch': if (givesAway(e.action)) unit(e.unit).revealed = true; break;
    case 'reveal': unit(e.unit).revealed = true; break;
    case 'hit':
      if (e.result === 'pinned') { unit(e.unit).status = 'pinned'; unit(e.unit).pinnedRound = round; }
      if (e.result === 'down') { unit(e.unit).status = 'down'; unit(e.unit).pinnedRound = null; }
      break;
    case 'move': unit(e.unit).pos = { ...e.to }; if (unit(e.unit).posture === 'still') unit(e.unit).posture = 'moved'; break;
    case 'recover': unit(e.unit).status = 'ready'; unit(e.unit).pinnedRound = null; break;
    case 'score': s.scores[e.player] += e.value; break;
    case 'eliminated': s.eliminated[e.player] = true; break;
    case 'over': s.over = true; s.winners = [...e.winners]; break;
    default: break;
  }
}

/** Does a player's event correspond to this event of the full list? */
function matches(mine: GameEvent, full: GameEvent): boolean {
  if (JSON.stringify(mine) === JSON.stringify(full)) return true;
  if (mine.t === 'fire' && full.t === 'fire' && mine.unit === null) {
    return JSON.stringify(mine) === JSON.stringify({ ...full, unit: null, from: null });
  }
  // A score whose holder the player cannot see comes without the objective's name.
  if (mine.t === 'score' && full.t === 'score' && mine.objective === null) {
    return JSON.stringify(mine) === JSON.stringify({ ...full, objective: null });
  }
  return mine.t === 'recover' && full.t === 'treat' && full.target === mine.unit;
}

interface Stats { [k: string]: number }

/** Check one resolved round from every angle. Returns nothing; throws on a broken rule. */
function checkRound(before: GameState, orders: Order[][], result: ReturnType<typeof resolve>, stats: Stats, where: string): void {
  const { state: after, events, playerEvents } = result;
  const players = Array.from({ length: before.playerCount }, (_, i) => i);
  const fail = (msg: string): never => { throw new Error(`${where}: ${msg}`); };

  // one living unit per hex, everyone on passable ground
  const held = new Set<string>();
  for (const x of after.units) {
    const cell = map.cells[key(x.pos)];
    if (!cell || !TERRAIN[cell.terrain].passable) fail(`${x.id} is off the board`);
    if (x.status === 'down') continue;
    if (held.has(key(x.pos))) fail(`two units on ${key(x.pos)}`);
    held.add(key(x.pos));
  }
  if (after.round !== before.round + 1) fail('round did not advance by one');

  // where a unit may be: on its start hex or a hex of the path it was given, never past its end or off it;
  // a unit given no move stands where it stood. The order that counts is the first legal one for the unit.
  const counted = new Map<UnitId, Order>();
  players.forEach((p) => {
    for (const o of orders[p] ?? []) {
      if (o && typeof o === 'object' && !counted.has(o.unit) && validateOrders(before, p, [o]).length === 0) counted.set(o.unit, o);
    }
  });
  const follows = new Map<UnitId, string>();        // unit -> the action its follow-up uses
  for (const x of before.units) {
    const o = counted.get(x.id);
    const walked = o && (o.kind === 'move' || o.kind === 'dash') ? o.path : [];
    const now = after.units.find((y) => y.id === x.id)!;
    const at = [x.pos, ...walked].findIndex((hx) => key(hx) === key(now.pos));
    if (at === -1) fail(walked.length > 0 ? `${x.id} ended at ${key(now.pos)}, off its path` : `${x.id} held still and has moved to ${key(now.pos)}`);
    if (o?.kind === 'move' && o.then) {
      follows.set(x.id, UNITS[x.type][o.then.kind]!);
      stats['follow-up ordered'] = (stats['follow-up ordered'] ?? 0) + 1;
    }
  }
  // Every follow-up is accounted for, once: it ran (the unit's own shot, launch or quiet action in the assault phase) or an `unable` says why not.
  {
    let assault = false;
    const unable = new Map<UnitId, string>();
    const ran = new Set<UnitId>();
    for (const e of events) {
      if (e.t === 'phase') assault = e.phase === 'assault';
      if (e.t === 'unable') {
        if (!assault) fail(`"unable" outside the assault phase: ${JSON.stringify(e)}`);
        if (unable.has(e.unit) || follows.get(e.unit) !== e.action) fail(`"unable" for a follow-up that was not ordered, or twice: ${JSON.stringify(e)}`);
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
  }

  // snapshots: the state after each "moment" (a run of hits, or the moves of one step, counts as one)
  const snap = (s: GameState): GameState => ({ ...s, units: s.units.map((x) => ({ ...x, pos: { ...x.pos } })), scores: [...s.scores], eliminated: [...s.eliminated], winners: [...s.winners] });
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
  // the full event list describes the whole change of state
  if (text(sim) !== text(after)) fail('the events do not add up to the new state');

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
      if (e.t === 'score') {
        // Named exactly when the player holds it or can see who does; never otherwise.
        const full = events[k];
        if (full.t !== 'score' || full.objective === null) throw new Error('the full list must name every objective');
        const obj = map.objectives.find((o) => o.id === full.objective)!;
        const holder = snaps[post].units.find((x) => x.status !== 'down' && key(x.pos) === key(obj.hex));
        if (!holder || holder.owner !== full.player) return fail(`score for ${full.objective} without its holder standing there`);
        const knows = holder.owner === p || vis(post, p).has(holder.id);
        if (e.objective !== null && !knows) fail(`player ${p} was told which objective unseen ${holder.id} holds: ${JSON.stringify(e)}`);
        if (e.objective === null && knows) fail(`player ${p} sees ${holder.id} on ${full.objective} but was not told the objective`);
        stats[knows ? 'score named' : 'score unnamed'] = (stats[knows ? 'score named' : 'score unnamed'] ?? 0) + 1;
        if (!knows && hidesHolder(snaps[post], holder)) stats['score by a hidden holder'] = (stats['score by a hidden holder'] ?? 0) + 1;
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
    const need = (id: UnitId, e: GameEvent): Unit => model.get(id) ?? fail(`player ${p}: ${JSON.stringify(e)} is about a unit not in its picture`);
    for (const e of playerEvents[p]) {
      switch (e.t) {
        case 'phase': if (e.phase === 'treat') for (const x of model.values()) { x.revealed = false; x.posture = 'still'; } break;
        case 'dash': need(e.unit, e).posture = 'dashed'; break;
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
          if (x.posture === 'still') x.posture = 'moved';
          break;
        }
        case 'blocked': need(e.unit, e); break;
        case 'hit': {
          const x = need(e.unit, e);
          if (key(x.pos) !== key(e.at)) fail(`player ${p}: hit on ${e.unit} is not where it was last seen`);
          if (e.result === 'pinned') { x.status = 'pinned'; x.pinnedRound = before.round; }
          if (e.result === 'down') {
            x.status = 'down'; x.pinnedRound = null;
            if (x.owner !== p) model.delete(x.id);   // a downed enemy leaves the picture
          }
          break;
        }
        default: break;
      }
    }
    const byId = (a: Unit, b: Unit) => (a.id < b.id ? -1 : 1);
    if (JSON.stringify([...model.values()].sort(byId)) !== JSON.stringify([...viewFor(after, p).units].sort(byId))) {
      fail(`player ${p}'s events do not add up to its view`);
    }
  }
}

function playMatch(seed: number, stats: Stats): void {
  const rnd = mulberry32(seed);
  const playerCount = 2 + (seed % 3);
  const squads = Array.from({ length: playerCount }, (_, player) => ({
    player, units: PRESETS[Math.floor(rnd() * PRESETS.length)].units,
  }));
  let state = createMatch(map, squads);
  const record: Order[][][] = [];
  const allEvents: GameEvent[][] = [];
  while (!state.over) {
    const where = `seed ${seed} round ${state.round}`;
    const orders: Order[][] = [];
    for (let p = 0; p < playerCount; p++) {
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
    const ordersText = JSON.stringify(orders);
    deepFreeze(state.units); deepFreeze(state.scores); deepFreeze(state.eliminated); deepFreeze(state.winners);
    deepFreeze(orders);
    let result: ReturnType<typeof resolve>;
    try {
      result = resolve(state, orders);
    } catch (err) {
      throw new Error(`${where}: resolve threw: ${String(err)}`);
    }
    if (JSON.stringify(state) !== beforeText || JSON.stringify(orders) !== ordersText) throw new Error(`${where}: input was changed`);
    // same input, same output
    const twice = resolve(state, orders);
    if (text(twice.state) !== text(result.state) || JSON.stringify([twice.events, twice.playerEvents]) !== JSON.stringify([result.events, result.playerEvents])) {
      throw new Error(`${where}: not deterministic`);
    }
    checkRound(state, orders, result, stats, where);
    record.push(orders);
    allEvents.push(result.events);
    state = result.state;
    if (state.round > map.maxRounds + 1) throw new Error(`seed ${seed}: match ran past its last round`);
  }
  stats.matches = (stats.matches ?? 0) + 1;
  stats.rounds = (stats.rounds ?? 0) + record.length;
  if (record.length < map.maxRounds) stats['ended early'] = (stats['ended early'] ?? 0) + 1;
  if (state.winners.length === 0) throw new Error(`seed ${seed}: over with no winner`);
  if (state.winners.length > 1) stats['shared win'] = (stats['shared win'] ?? 0) + 1;

  // replay from the recorded orders (through JSON, as a log file would be)
  let again = createMatch(map, squads);
  const recorded: Order[][][] = JSON.parse(JSON.stringify(record));
  recorded.forEach((orders, i) => {
    const r = resolve(again, orders);
    if (JSON.stringify(r.events) !== JSON.stringify(allEvents[i])) throw new Error(`seed ${seed}: replay differs in round ${i + 1}`);
    again = r.state;
  });
  expect(JSON.stringify(again), `seed ${seed}: replay ends in a different state`).toBe(JSON.stringify(state));
}

describe('random matches', () => {
  it(`${MATCHES} full matches of random legal orders keep every promise`, () => {
    const stats: Stats = {};
    for (let seed = 1; seed <= MATCHES; seed++) playMatch(seed, stats);
    // The matches must actually have exercised the rules, or the checks above prove little.
    for (const k of ['treat', 'fire', 'fire ambush', 'fire unseen shooter', 'launch', 'impact', 'hit cover', 'hit pinned', 'hit down',
      'move', 'blocked', 'dash', 'spotted', 'lost', 'recover', 'score', 'score named', 'score unnamed', 'score by a hidden holder',
      'eliminated', 'over', 'follow-up ordered', 'follow-up fire', 'follow-up treat', 'unable down', 'unable pinned', 'unable range',
      'unable sight', 'unable needs', 'shared hex', 'fall back']) {
      expect(stats[k] ?? 0, `no "${k}" in ${MATCHES} matches`).toBeGreaterThan(0);
    }
    expect(stats.matches).toBe(MATCHES);
    console.log(JSON.stringify(stats));
  }, 120_000);
});
