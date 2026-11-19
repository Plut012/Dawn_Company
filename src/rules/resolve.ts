// One round: everyone's orders at once, into a new state and a list of events.
//
// Pure and deterministic: no DOM, Node APIs, clock or randomness, and the
// input is never changed. Wherever order matters, units go in id order.
//
// What each player is told is worked out as the round goes. For every player
// we keep the set of enemy units they see (`seen`). After each moment of the
// round the set is brought up to date with `visibleEnemies`, which sends the
// `spotted` and `lost` events, so the events a player receives always add up
// to exactly what `viewFor` shows at the end.

import { TERRAIN } from '../content';
import { distance, key } from '../shared/hex';
import type { ActionDef, GameEvent, GameState, Hex, HexKey, Order, Phase, PlayerId, Unit, UnitId } from '../shared/types';
import { applyEffect } from './effects';
import type { Use, World } from './effects';
import { actionOf, byId, orderProblem, useProblem } from './orders';
import { spots, visibleEnemies, visibleHexes } from './sight';

interface Mover { unit: Unit; path: Hex[]; next: number }

export function resolve(state: GameState, orders: Order[][]): {
  state: GameState;
  events: GameEvent[];
  playerEvents: GameEvent[][];
} {
  const map = state.map;
  const round = state.round;
  const players: PlayerId[] = Array.from({ length: state.playerCount }, (_, i) => i);
  const next: GameState = {
    map,
    playerCount: state.playerCount,
    units: state.units.map((u) => ({ ...u, pos: { q: u.pos.q, r: u.pos.r } })),
    round,
    scores: [...state.scores],
    eliminated: [...state.eliminated],
    over: state.over,
    winners: [...state.winners],
  };
  const events: GameEvent[] = [];
  const playerEvents: GameEvent[][] = players.map(() => []);
  if (state.over) return { state: next, events, playerEvents };

  const units = [...next.units].sort((a, b) => byId(a.id, b.id));   // same objects as next.units
  const unitById = new Map(units.map((u) => [u.id, u]));
  const alive = (u: Unit) => u.status !== 'down';
  const ready = (u: Unit) => u.status === 'ready';
  const hexOf = (u: Unit): Hex => ({ q: u.pos.q, r: u.pos.r });
  const inCover = (u: Unit) => TERRAIN[map.cells[key(u.pos)]?.terrain ?? '']?.cover ?? false;

  // ---- the orders that count: legal ones, the first for each unit
  const orderOf = new Map<UnitId, Order>();
  for (const p of players) {
    const list = Array.isArray(orders?.[p]) ? orders[p] : [];
    let spotted: Set<HexKey> | null = null;
    const visible = () => (spotted ??= visibleHexes(state, p));
    for (const o of list) {
      if (orderProblem(map, state.units, p, o, visible) === null && !orderOf.has(o.unit)) orderOf.set(o.unit, o);
    }
  }
  const kindOf = (u: Unit) => orderOf.get(u.id)?.kind;

  // ---- who is told what
  let seen = players.map((p) => new Set(visibleEnemies(next, p).map((u) => u.id)));
  const sees = (p: PlayerId, id: UnitId) => unitById.get(id)?.owner === p || seen[p].has(id);
  const about = (id: UnitId) => (p: PlayerId) => sees(p, id);
  const everyone = () => true;
  const emit = (e: GameEvent, who: (p: PlayerId) => boolean) => {
    events.push(e);
    for (const p of players) if (who(p)) playerEvents[p].push(e);
  };
  const seesHex = (p: PlayerId, h: Hex) => visibleHexes(next, p).has(key(h));
  /** Bring every player's `seen` up to date, telling them what came into view and what left it. */
  const sync = () => {
    seen = players.map((p) => {
      const now = new Set(visibleEnemies(next, p).map((u) => u.id));
      for (const u of units) {
        // A unit that went down in view was reported by its `hit`; no `lost`.
        if (seen[p].has(u.id) && !now.has(u.id) && alive(u)) playerEvents[p].push({ t: 'lost', unit: u.id });
      }
      for (const u of units) {
        if (now.has(u.id) && !seen[p].has(u.id)) playerEvents[p].push({ t: 'spotted', unit: { ...u, pos: hexOf(u) } });
      }
      return now;
    });
  };
  const phase = (p: Phase) => emit({ t: 'phase', phase: p }, everyone);

  /** Record an event: the full list gets `e`, each player the version `told` gives them. */
  const record = (e: GameEvent, told: (p: PlayerId) => GameEvent | null) => {
    events.push(e);
    for (const p of players) {
      const mine = told(p);
      if (mine) playerEvents[p].push(mine);
    }
  };

  // ---- actions and their effects
  const coverUsed = new Set<UnitId>();
  const world: World = {
    round,
    shelter: (u) => {
      if (!inCover(u) || u.posture === 'dashed' || coverUsed.has(u.id)) return false;
      coverUsed.add(u.id);
      return true;
    },
    exposed: (u) => u.posture === 'dashed',
    sees,
    record,
    refresh: sync,
  };
  /** The units of this round ordered to use an action whose effects land in one of these phases, in id order. */
  const usesIn = (...phases: ActionDef['phase'][]): Use[] => {
    const out: Use[] = [];
    for (const u of units) {
      const order = orderOf.get(u.id);
      if ((order?.kind !== 'fire' && order?.kind !== 'special') || !ready(u)) continue;
      const action = actionOf(u.type, order.kind);
      if (action && phases.includes(action.phase)) out.push({ user: u, action, target: { q: order.target.q, r: order.target.r } });
    }
    return out;
  };
  /** One use landing: each effect in turn, on every living unit in the area it applies to, in id order. Never the user. */
  const land = (use: Use) => {
    const { user, action, target } = use;
    for (const effect of action.effects) {
      for (const u of units) {
        if (u.id === user.id || !alive(u) || distance(u.pos, target) > action.blast) continue;
        if (action.affects === 'friends' && u.owner !== user.owner) continue;
        if (action.affects === 'enemies' && u.owner === user.owner) continue;
        applyEffect(world, effect, use, u);
      }
    }
  };
  /** Using a revealing action gives the user away. */
  const giveAway = (use: Use) => {
    if (use.action.reveals) use.user.revealed = true;
    sync();
  };
  /** A shot is announced: in full to those who see the shooter, without it to those who see only the target. */
  const fire = (use: Use, ambush: boolean) => {
    giveAway(use);
    const { user, action, target } = use;
    const full: GameEvent = { t: 'fire', unit: user.id, from: hexOf(user), target, blast: action.blast, ambush, action: action.id };
    record(full, (p) => (sees(p, user.id) ? full : seesHex(p, target) ? { ...full, unit: null, from: null } : null));
  };

  // ---- phase 0: actions that land before anyone fires
  phase('treat');
  // A new round: nobody has fired or moved in it yet.
  for (const u of units) { u.revealed = false; u.posture = 'still'; }
  sync();
  // The quiet phase: an action here is not announced; each effect reports on each unit it changes.
  for (const use of usesIn('treat')) {
    if (use.action.reveals && !use.user.revealed) {
      giveAway(use);
      emit({ t: 'reveal', unit: use.user.id, action: use.action.id }, about(use.user.id));
    }
    land(use);
  }

  // ---- phase 1: fire
  phase('fire');
  // Whoever is to dash breaks cover now: seen like a unit in the open, no cover, down from one hit.
  for (const u of units) {
    if (kindOf(u) !== 'dash' || !ready(u)) continue;
    u.posture = 'dashed';
    sync();
    emit({ t: 'dash', unit: u.id }, about(u.id));
  }
  const shots = usesIn('fire', 'mortar');
  const late = shots.filter((s) => s.action.phase === 'mortar');
  for (const s of shots) {
    if (s.action.phase === 'mortar') {
      giveAway(s);
      emit({ t: 'launch', unit: s.user.id, from: hexOf(s.user), action: s.action.id }, about(s.user.id));
    } else {
      fire(s, false);
    }
  }
  for (const s of shots) if (s.action.phase === 'fire') land(s);
  sync();

  // ---- phase 2: movement
  //
  // Units of one squad do not block each other; units of different squads do,
  // exactly as they always have. Two things keep "one living unit per hex"
  // true once movement is over.
  //
  // 1. Who steps. Each step, every mover means to enter the next hex of its
  //    path. It stops for good (`blocked`) if
  //    a. a unit of another squad means to enter the same hex this step;
  //    b. a unit of another squad stands there and means to enter the mover's hex (a swap);
  //    c. a unit of another squad stands there and is not leaving this step;
  //    d. the hex is the END of its path, and a teammate stands there who is not
  //       leaving this step, or another teammate also ends its path there this step.
  //    (c) and (d) feed on themselves (a stopped unit is not leaving), so they
  //    are worked out to a stable answer before anyone moves. A mover is never
  //    stopped on its way THROUGH a teammate, and teammates may swap.
  //
  // 2. Settling. After each step and its ambushes, look at the units that have
  //    come to rest (no steps left to take this round; a unit still on its way
  //    is passed through, not contested). Where two or more rest in one hex,
  //    one keeps it and the rest fall back one hex along the way they came:
  //    - a unit standing where it began the round with nothing left to walk
  //      back keeps the hex (so a unit that never moved is never displaced,
  //      and a unit pushed all the way home always has somewhere to stand);
  //    - otherwise the one that has been in the hex longest keeps it;
  //    - if two or more have been there equally long, all of them fall back.
  //    Everyone who must fall back does so together, as the newest arrival in
  //    the hex they fall back to, and the hexes are looked at again. Each pass
  //    takes at least one hex off somebody's way back and nobody ever walks
  //    forward here, so it ends; it ends with no two resting units in a hex,
  //    because any such pair would send somebody back. Two units can never
  //    both be "home" in one hex: they began the round in different ones.
  //    A unit only ever stands on its start hex or a hex of its own path.
  //    A fall back is told as `blocked` (once a round, at the hex the unit
  //    could not keep) and `move` events; it springs no ambush.
  phase('move');
  let movers: Mover[] = [];
  for (const u of units) {
    const order = orderOf.get(u.id);
    if ((order?.kind === 'move' || order?.kind === 'dash') && ready(u)) movers.push({ unit: u, path: order.path, next: 0 });
  }
  const ambushers = new Set(units.filter((u) => kindOf(u) === 'ambush' && ready(u)));
  const trail = new Map<UnitId, Hex[]>();     // the hexes a unit has walked from this round, oldest first
  const since = new Map<UnitId, number>();    // the moment it came to the hex it is in; none = there all round
  const toldBlocked = new Set<UnitId>();
  let moment = 0;                             // counts the steps and the fall backs: the `step` of a `move`
  const blocked = (u: Unit) => {
    if (toldBlocked.has(u.id)) return;
    toldBlocked.add(u.id);
    emit({ t: 'blocked', unit: u.id, at: hexOf(u) }, about(u.id));
  };
  const settle = () => {
    for (;;) {
      const moving = new Set(movers.map((m) => m.unit.id));
      const resting = new Map<HexKey, Unit[]>();
      for (const u of units) {
        if (!alive(u) || moving.has(u.id)) continue;
        const k = key(u.pos);
        resting.set(k, [...(resting.get(k) ?? []), u]);
      }
      const back: Unit[] = [];
      for (const here of resting.values()) {
        if (here.length < 2) continue;
        const home = here.find((u) => (trail.get(u.id)?.length ?? 0) === 0);
        const first = Math.min(...here.map((u) => since.get(u.id) ?? 0));
        const longest = here.filter((u) => (since.get(u.id) ?? 0) === first);
        const keeper = home ?? (longest.length === 1 ? longest[0] : null);
        for (const u of here) if (u !== keeper) back.push(u);
      }
      if (back.length === 0) return;
      back.sort((a, b) => byId(a.id, b.id));
      moment++;
      for (const u of back) blocked(u);
      for (const u of back) {
        const from = hexOf(u);
        const to = trail.get(u.id)!.pop()!;
        u.pos = { q: to.q, r: to.r };
        since.set(u.id, moment);
        emit({ t: 'move', step: moment, unit: u.id, from, to: hexOf(u) }, about(u.id));
      }
      sync();
    }
  };
  while (movers.length > 0) {
    moment++;
    // Who stops: worked out to a stable answer before anyone moves.
    const intent = new Map<UnitId, HexKey>(movers.map((m) => [m.unit.id, key(m.path[m.next])]));
    const ending = new Set<UnitId>(movers.filter((m) => m.next === m.path.length - 1).map((m) => m.unit.id));
    const at = new Map<HexKey, Unit[]>();
    for (const u of units) if (alive(u)) at.set(key(u.pos), [...(at.get(key(u.pos)) ?? []), u]);
    const wanting = new Map<HexKey, Unit[]>();
    for (const m of movers) wanting.set(intent.get(m.unit.id)!, [...(wanting.get(intent.get(m.unit.id)!) ?? []), m.unit]);
    const stopped = new Set<UnitId>();
    for (const m of movers) {
      const me = m.unit;
      const k = intent.get(me.id)!;
      const rivals = wanting.get(k)!.filter((o) => o !== me);
      const there = at.get(k) ?? [];
      if (rivals.some((o) => o.owner !== me.owner)) stopped.add(me.id);                                          // (a)
      else if (there.some((o) => o.owner !== me.owner && intent.get(o.id) === key(me.pos))) stopped.add(me.id);   // (b)
      else if (ending.has(me.id) && rivals.some((o) => ending.has(o.id))) stopped.add(me.id);                    // (d), two ending there
    }
    for (let changed = true; changed;) {
      changed = false;
      for (const m of movers) {
        const me = m.unit;
        if (stopped.has(me.id)) continue;
        const staying = (at.get(intent.get(me.id)!) ?? []).filter((o) => !intent.has(o.id) || stopped.has(o.id));
        if (staying.some((o) => o.owner !== me.owner || ending.has(me.id))) { stopped.add(me.id); changed = true; }   // (c), (d)
      }
    }
    for (const m of movers) if (stopped.has(m.unit.id)) blocked(m.unit);
    movers = movers.filter((m) => !stopped.has(m.unit.id));

    // The rest move, all together.
    const moves: GameEvent[] = [];
    const moved: Unit[] = [];
    for (const m of movers) {
      const from = hexOf(m.unit);
      const to = m.path[m.next++];
      m.unit.pos = { q: to.q, r: to.r };
      if (m.unit.posture === 'still') m.unit.posture = 'moved';
      trail.set(m.unit.id, [...(trail.get(m.unit.id) ?? []), from]);
      since.set(m.unit.id, moment);
      moves.push({ t: 'move', step: moment, unit: m.unit.id, from, to: hexOf(m.unit) });
      moved.push(m.unit);
    }
    // Seen before the step: told of the move. Seen only after: `spotted` instead, from sync.
    for (const e of moves) if (e.t === 'move') emit(e, about(e.unit));
    sync();

    // Ambushes: each picks from where everyone now stands, then all the hits land.
    const sprung: Use[] = [];
    for (const a of units) {
      const action = actionOf(a.type, 'ambush');
      if (!ambushers.has(a) || !ready(a) || !action) continue;
      let best: Unit | null = null;
      for (const e of moved) {           // in id order, so the first nearest is the lowest id
        const d = distance(a.pos, e.pos);
        if (e.owner === a.owner || d < action.minRange || d > action.range) continue;
        if (!spots(map, a, e)) continue;   // the ambusher must see its target itself
        if (!best || d < distance(a.pos, best.pos)) best = e;
      }
      if (best) sprung.push({ user: a, action, target: hexOf(best) });
    }
    for (const s of sprung) {
      ambushers.delete(s.user);
      fire(s, true);
    }
    for (const s of sprung) land(s);
    if (sprung.length > 0) sync();

    movers = movers.filter((m) => ready(m.unit) && m.next < m.path.length);
    settle();
  }

  // ---- phase 3: assault. What movers were told to do where their move ends.
  // Judged for everyone from the positions movement left, then announced, then all effects land.
  phase('assault');
  const acts: Use[] = [];
  for (const u of units) {
    const order = orderOf.get(u.id);
    if (order?.kind !== 'move' || !order.then) continue;
    const action = actionOf(u.type, order.then.kind);
    if (!action) continue;
    const target = { q: order.then.target.q, r: order.then.target.r };
    const reason = !alive(u) ? 'down' : !ready(u) ? 'pinned'
      : useProblem(map, next.units, u, action, target, () => visibleHexes(next, u.owner))?.why ?? null;
    if (reason) emit({ t: 'unable', unit: u.id, action: action.id, reason }, about(u.id));
    else acts.push({ user: u, action, target });
  }
  for (const s of acts) {
    if (s.action.phase === 'mortar') {
      giveAway(s);
      emit({ t: 'launch', unit: s.user.id, from: hexOf(s.user), action: s.action.id }, about(s.user.id));
      late.push(s);
    } else if (s.action.phase === 'fire') {
      fire(s, false);
    } else if (s.action.reveals && !s.user.revealed) {   // a quiet action: not announced, as in the treat phase
      giveAway(s);
      emit({ t: 'reveal', unit: s.user.id, action: s.action.id }, about(s.user.id));
    }
  }
  for (const s of acts) if (s.action.phase !== 'mortar') land(s);
  sync();

  // ---- phase 4: what was launched lands
  phase('mortar');
  for (const s of late) {
    const e: GameEvent = { t: 'impact', target: s.target, blast: s.action.blast, action: s.action.id };
    record(e, (p) => (s.user.owner === p || seesHex(p, s.target) ? e : null));
    land(s);
    sync();
  }

  // ---- phase 5: score and recover
  phase('score');
  for (const obj of map.objectives) {
    const holder = units.find((u) => alive(u) && key(u.pos) === key(obj.hex));
    if (!holder) continue;
    next.scores[holder.owner] += obj.value;
    // Scores are public; where the points came from is not. Only a player who sees the holder is told the objective.
    const full: GameEvent = { t: 'score', objective: obj.id, player: holder.owner, value: obj.value };
    record(full, (p) => (sees(p, holder.id) ? full : { ...full, objective: null }));
  }
  for (const u of units) {
    if (u.status === 'pinned' && (u.pinnedRound ?? -Infinity) < round) {
      emit({ t: 'recover', unit: u.id }, about(u.id));
      u.status = 'ready';
      u.pinnedRound = null;
    }
  }
  const standing = (p: PlayerId) => units.some((u) => u.owner === p && alive(u));
  for (const p of players) {
    if (!next.eliminated[p] && !standing(p)) {
      next.eliminated[p] = true;
      emit({ t: 'eliminated', player: p }, everyone);
    }
  }
  sync();   // an eliminated player now sees the whole board
  next.round = round + 1;
  if (next.round > map.maxRounds || players.filter(standing).length < 2) {
    const top = Math.max(...next.scores);
    next.over = true;
    next.winners = players.filter((p) => next.scores[p] === top);
    emit({ t: 'over', scores: [...next.scores], winners: [...next.winners] }, everyone);
  }
  return { state: next, events, playerEvents };
}
