// What a unit may be told to do: checking orders (server side, from the full
// state) and listing the choices (client side, from a player's view). Both
// ask the same small questions below, so they cannot disagree.
//
// Pure: no DOM, Node APIs, clock or randomness.

import { ACTIONS, TERRAIN, UNITS } from '../content';
import { distance, key, neighbors, within } from '../shared/hex';
import type {
  ActionDef, FollowUp, GameMap, GameState, Hex, HexKey, Order, OrderError, OrderKind, PlayerId, PlayerView, Unit, UnitId, UnitTypeId, WorkId,
} from '../shared/types';
import { builds, isWork, workProblem } from './works';
import { moveOf } from './kinds';
import { canSee, sightOf, visibleHexes } from './sight';

const KINDS: readonly string[] = ['move', 'dash', 'fire', 'ambush', 'special'];

function isHex(h: unknown): h is Hex {
  if (typeof h !== 'object' || h === null) return false;
  const { q, r } = h as Hex;
  return Number.isInteger(q) && Number.isInteger(r);
}

function passable(map: GameMap, h: Hex): boolean {
  const cell = map.cells[key(h)];
  return !!cell && (TERRAIN[cell.terrain]?.passable ?? false);
}

/** Unit ids in a fixed order everywhere: by owner, then by index, as numbers. */
export function byId(a: UnitId, b: UnitId): number {
  const [ao, ai] = a.split('-').map(Number);
  const [bo, bi] = b.split('-').map(Number);
  return ao - bo || ai - bi || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * The action a unit of this type performs under this kind of order, or null
 * if it has none: `fire` and `special` use the type's own; `ambush` uses the
 * `fire` action, and only one whose effects land in the fire phase.
 */
export function actionOf(type: UnitTypeId, kind: OrderKind): ActionDef | null {
  const def = Object.hasOwn(UNITS, type) ? UNITS[type] : undefined;
  const id = kind === 'special' ? def?.special : kind === 'fire' || kind === 'ambush' ? def?.fire : null;
  const action = id != null && Object.hasOwn(ACTIONS, id) ? ACTIONS[id] : null;
  if (!action || (kind === 'ambush' && action.phase !== 'fire')) return null;
  return action;
}

/** May a unit of this type be given this kind of order at all? */
function canTake(type: UnitTypeId, kind: OrderKind): boolean {
  if (!UNITS[type]?.orders.includes(kind)) return false;
  return kind === 'move' || kind === 'dash' || actionOf(type, kind) !== null;
}

/** Is the target hex on the map and within the action's range band of `from`? If not, why not. */
function reachProblem(map: GameMap, from: Hex, action: ActionDef, target: Hex): string | null {
  if (!map.cells[key(target)]) return 'target is off the map';
  const d = distance(from, target);
  if (d < action.minRange || d > action.range) return 'target is out of range';
  return null;
}

/**
 * What stops this unit using this action on this hex from where it stands, or
 * null if nothing does: `range`, then the action's `sight` rule, then what it
 * `needs` on the target hex. `units` are the units the asker knows of;
 * `visible` is the unit's player's visible hexes; `sight` is how far the unit
 * sees this round (`sightOf`). The `own` rule is the unit's own eyes: the
 * target within its sight and a clear line to it. The action's range is not
 * changed by the light: it only decides how far the unit may reach.
 */
export function useProblem(
  map: GameMap, units: Unit[], unit: Unit, action: ActionDef, target: Hex, visible: () => { has(k: HexKey): boolean }, sight: number,
): { why: 'range' | 'sight' | 'needs'; reason: string } | null {
  const reach = reachProblem(map, unit.pos, action, target);
  if (reach) return { why: 'range', reason: reach };
  if (action.sight === 'own' && distance(unit.pos, target) > sight) return { why: 'sight', reason: `the target is beyond his sight (${sight})` };
  if (action.sight === 'own' && !canSee(map, unit.pos, target)) return { why: 'sight', reason: 'no line of sight to the target' };
  if (action.sight === 'squad' && !visible().has(key(target))) return { why: 'sight', reason: 'no friendly unit can see the target' };
  if (action.needs !== 'any') {
    const pinned = action.needs === 'pinned-friend';
    const there = units.some((u) => u.owner === unit.owner && u.id !== unit.id && u.pos.q === target.q && u.pos.r === target.r
      && (pinned ? u.status === 'pinned' : u.status !== 'down'));
    if (!there) return { why: 'needs', reason: pinned ? 'no pinned friendly unit there' : 'no friendly unit there' };
  }
  return null;
}

/**
 * What is wrong with a move's follow-up, or null if it may be ordered. Only
 * what can be known when ordering is checked: the unit may take that kind of
 * order, its action is `mobile`, and the target is in range of `end`, the
 * last hex of the path. Sight and `needs` are judged when the move is over.
 */
function followUpProblem(map: GameMap, unit: Unit, end: Hex, then: FollowUp, works: Record<HexKey, WorkId>): string | null {
  if (typeof then !== 'object' || then === null || (then.kind !== 'fire' && then.kind !== 'special')) return 'the follow-up is not a fire or special order';
  if (!isHex(then.target)) return 'follow-up target is not a hex';
  const action = canTake(unit.type, then.kind) ? actionOf(unit.type, then.kind) : null;
  if (!action) return `this unit cannot be ordered to ${then.kind}`;
  if (!action.mobile) return `this unit cannot ${then.kind} after a move`;
  const reach = reachProblem(map, end, action, then.target);
  if (reach) return map.cells[key(then.target)] ? 'follow-up target is out of range from the end of the path' : 'follow-up target is off the map';
  return buildProblem(map, works, action, then.target, (then as { work?: unknown }).work);
}

/**
 * (25) What is wrong with a build as ordered: it must name a work, and the hex must be able to take one. Who will
 * be standing there and whether the supply is there are judged when it lands. Null for an action that builds nothing.
 */
function buildProblem(map: GameMap, works: Record<HexKey, WorkId>, action: ActionDef, target: Hex, work: unknown): string | null {
  if (!builds(action)) return null;
  if (work === undefined) return 'a build must name a work';
  if (!isWork(work)) return 'no such work';
  return workProblem(map, works, target, work);
}

/**
 * What is wrong with one order, or null if it is legal. Takes anything: the
 * order may come straight off the network. `sight` gives a unit's `sightOf`
 * and `move` its `moveOf` in the round the order is for.
 */
export function orderProblem(
  map: GameMap, units: Unit[], player: PlayerId, order: Order, visible: () => { has(k: HexKey): boolean }, sight: (u: Unit) => number,
  move: (u: Unit) => number, works: Record<HexKey, WorkId> = {},
): string | null {
  if (typeof order !== 'object' || order === null) return 'not an order';
  const unit = units.find((u) => u.id === order.unit);
  if (!unit || unit.owner !== player) return 'not your unit';
  if (unit.status === 'down') return 'unit is down';
  const def = UNITS[unit.type];
  if (!def || !KINDS.includes(order.kind) || !canTake(unit.type, order.kind)) return `this unit cannot be ordered to ${String(order.kind)}`;

  switch (order.kind) {
    case 'move':
    case 'dash': {
      const allowance = order.kind === 'dash' ? move(unit) * 2 : move(unit);
      const path: unknown = order.path;
      if (!Array.isArray(path) || path.length < 1) return 'path is empty';
      if (path.length > allowance) return `path is longer than ${allowance}`;
      let prev = unit.pos;
      for (const h of path) {
        if (!isHex(h)) return 'path has something that is not a hex';
        if (!map.cells[key(h)]) return 'path leaves the map';
        if (!passable(map, h)) return 'path crosses impassable ground';
        if (distance(prev, h) !== 1) return 'path has a gap';
        prev = h;
      }
      const then: unknown = (order as { then?: unknown }).then;
      if (then === undefined) return null;
      if (order.kind === 'dash') return 'a dash takes no follow-up';
      return followUpProblem(map, unit, prev, then as FollowUp, works);
    }
    case 'fire':
    case 'special': {
      if (!isHex(order.target)) return 'target is not a hex';
      const action = actionOf(unit.type, order.kind);
      if (!action) return `this unit cannot be ordered to ${order.kind}`;
      return useProblem(map, units, unit, action, order.target, visible, sight(unit))?.reason
        ?? buildProblem(map, works, action, order.target, (order as { work?: unknown }).work);
    }
    case 'ambush':
      return null;
  }
}

/** Check one player's orders for the round now being planned. Empty = legal. */
export function validateOrders(state: GameState, player: PlayerId, orders: Order[]): OrderError[] {
  if (!Array.isArray(orders)) return [{ unit: null, reason: 'orders must be a list' }];
  const errors: OrderError[] = [];
  let seen: Set<HexKey> | null = null;
  const visible = () => (seen ??= visibleHexes(state, player));
  const ordered = new Set<UnitId>();
  for (const order of orders) {
    const id = typeof order === 'object' && order !== null && typeof order.unit === 'string' ? order.unit : null;
    let reason = state.over ? 'the match is over' : orderProblem(state.map, state.units, player, order, visible, (u) => sightOf(state, u), (u) => moveOf(state, u), state.works);
    if (!reason && id !== null && ordered.has(id)) reason = 'more than one order for this unit';
    if (id !== null) ordered.add(id);
    if (reason) errors.push({ unit: id, reason });
  }
  return errors;
}

/**
 * Shortest path over passable terrain, ignoring units; null if `to` cannot be
 * reached within `maxSteps`. The path excludes `from` (so it is empty when
 * `to` is `from`). Ties always break the same way: the search spreads in the
 * fixed neighbour order E, NE, NW, W, SW, SE.
 */
export function findPath(map: GameMap, from: Hex, to: Hex, maxSteps: number): Hex[] | null {
  const goal = key(to);
  const start = key(from);
  if (!map.cells[start] || !passable(map, to)) return null;
  if (goal === start) return [];
  const cameFrom = new Map<HexKey, Hex | null>([[start, null]]);
  let frontier: Hex[] = [from];
  for (let step = 1; step <= maxSteps && frontier.length > 0; step++) {
    const next: Hex[] = [];
    for (const h of frontier) {
      for (const n of neighbors(h)) {
        const k = key(n);
        if (cameFrom.has(k) || !passable(map, n)) continue;
        cameFrom.set(k, h);
        if (k === goal) {
          const path: Hex[] = [];
          for (let at: Hex | null = n; at && key(at) !== start; at = cameFrom.get(key(at)) ?? null) path.push(at);
          return path.reverse();
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

/** Hexes other than `from` reachable in 1..maxSteps over passable terrain, nearest first. */
function reachable(map: GameMap, from: Hex, maxSteps: number): HexKey[] {
  const seen = new Set<HexKey>([key(from)]);
  const out: HexKey[] = [];
  let frontier: Hex[] = [from];
  for (let step = 1; step <= maxSteps && frontier.length > 0; step++) {
    const next: Hex[] = [];
    for (const h of frontier) {
      for (const n of neighbors(h)) {
        const k = key(n);
        if (seen.has(k) || !passable(map, n)) continue;
        seen.add(k);
        out.push(k);
        next.push(n);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * The choices for one of the viewing player's units. `kinds` is empty for a
 * down unit (and for a unit that is not the player's). `move` and `dash` are
 * the end hexes within the allowance, ignoring units and leaving out the hex
 * the unit stands on. `fire` and `special` are the hexes `validateOrders`
 * would accept. A list is empty when the unit cannot take that order.
 */
export function orderOptions(view: PlayerView, unit: UnitId): {
  kinds: OrderKind[];
  move: HexKey[]; dash: HexKey[];
  fire: HexKey[]; special: HexKey[];
} {
  const none = { kinds: [], move: [], dash: [], fire: [], special: [] };
  const u = view.units.find((x) => x.id === unit);
  const def = u && UNITS[u.type];
  if (!u || !def || u.owner !== view.player || u.status === 'down' || view.over) return none;
  const can = (k: OrderKind) => canTake(u.type, k);
  const visible = new Set(view.visible);
  const targets = (k: 'fire' | 'special'): HexKey[] => {
    const action = can(k) ? actionOf(u.type, k) : null;
    if (!action) return [];
    const sight = sightOf(view, u);
    return within(u.pos, action.range).filter((h) => useProblem(view.map, view.units, u, action, h, () => visible, sight) === null
      && buildable(view, action, h)).map(key);
  };
  return {
    kinds: def.orders.filter(can),
    move: can('move') ? reachable(view.map, u.pos, moveOf(view, u)) : [],
    dash: can('dash') ? reachable(view.map, u.pos, moveOf(view, u) * 2) : [],
    fire: targets('fire'),
    special: targets('special'),
  };
}

/**
 * The follow-up choices for one of the viewing player's units if its move
 * ends on `end`: the target hexes `validateOrders` would accept for a `then`
 * of each kind. Empty for a kind the unit cannot take or whose action is not
 * `mobile`. Range only: nobody knows yet what will be seen from there.
 */
export function followUpOptions(view: PlayerView, unit: UnitId, end: Hex): { fire: HexKey[]; special: HexKey[] } {
  const u = view.units.find((x) => x.id === unit);
  if (!u || u.owner !== view.player || u.status === 'down' || view.over || !canTake(u.type, 'move')) return { fire: [], special: [] };
  const targets = (k: 'fire' | 'special'): HexKey[] => {
    const action = canTake(u.type, k) ? actionOf(u.type, k) : null;
    if (!action || !action.mobile) return [];
    return within(end, action.range).filter((h) => reachProblem(view.map, end, action, h) === null && buildable(view, action, h)).map(key);
  };
  return { fire: targets('fire'), special: targets('special') };
}

/** (25) For a build, may some work go on this hex as far as ordering can tell? True for an action that builds nothing. */
function buildable(view: PlayerView, action: ActionDef, h: Hex): boolean {
  return !builds(action) || workProblem(view.map, view.works ?? {}, h, 'sandbags') === null;
}
