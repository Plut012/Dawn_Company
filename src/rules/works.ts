// Works (25): where a work may go. Asked by `validateOrders` when ordering
// (what can be known then) and by the build effect when it lands (all of it).
//
// Pure: no DOM, Node APIs, clock or randomness.

import { TERRAIN, WORKS } from '../content';
import { key } from '../shared/hex';
import type { ActionDef, GameMap, Hex, HexKey, Unit, WorkId } from '../shared/types';

/** Does this action put up a work? */
export function builds(action: ActionDef | null | undefined): boolean {
  return !!action && action.effects.some((e) => e.kind === 'build');
}

/** Is this a work id? */
export function isWork(work: unknown): work is WorkId {
  return typeof work === 'string' && Object.hasOwn(WORKS, work);
}

/**
 * What stops this work going up on this hex, or null if nothing does: the hex
 * must be on the map, passable, not water, outside every objective area and
 * without a work. `units`, when given (as it is when the work lands), are
 * looked at too: nobody living may stand where wire goes.
 */
export function workProblem(
  map: GameMap, works: Record<HexKey, WorkId>, target: Hex, work: WorkId, units?: Unit[],
): string | null {
  if (!isWork(work)) return 'no such work';
  const k = key(target);
  const cell = map.cells[k];
  if (!cell) return 'target is off the map';
  if (cell.terrain === 'water' || !(TERRAIN[cell.terrain]?.passable ?? false)) return 'nothing can be built there';
  if (Object.hasOwn(works, k)) return 'there is a work there already';
  if (map.objectives.some((o) => o.hexes.some((h) => key(h) === k))) return 'nothing can be built in an objective';
  if (units && !(TERRAIN[WORKS[work].terrain]?.passable ?? false)
    && units.some((u) => u.status !== 'down' && key(u.pos) === k)) return `${WORKS[work].name.toLowerCase()} cannot go where a man stands`;
  return null;
}
