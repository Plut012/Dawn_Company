// What ground gives (21): a unit benefits from an objective when it stands on
// a hex of its area and its owner holds the flag. Areas never overlap, so a
// unit benefits from at most one. Everything that reads a kind's numbers asks
// here (and `sightOf`, which adds the sight).
//
// Pure: no DOM, Node APIs, clock or randomness.

import { OBJECTIVE_KINDS, UNITS } from '../content';
import type { GameState, Objective, ObjectiveKindDef, PlayerView, Unit } from '../shared/types';

type Board = Pick<GameState, 'map' | 'flags'> | Pick<PlayerView, 'map' | 'flags'>;

/** The objective this unit benefits from where it stands now, with its kind; null if none (or the unit is down). */
export function benefitOf(state: Board, unit: Unit): { objective: Objective; kind: ObjectiveKindDef } | null {
  if (unit.status === 'down') return null;
  for (const objective of state.map.objectives) {
    if ((state.flags?.[objective.id] ?? null) !== unit.owner) continue;
    if (!objective.hexes.some((h) => h.q === unit.pos.q && h.r === unit.pos.r)) continue;
    const kind = Object.hasOwn(OBJECTIVE_KINDS, objective.kind) ? OBJECTIVE_KINDS[objective.kind] : null;
    return kind ? { objective, kind } : null;
  }
  return null;
}

/**
 * How many hexes this unit may move in the round being planned or resolved:
 * its type's `move` plus the `move` of the objective it benefits from where it
 * stands (when the round begins: orders are judged from there). A dash is
 * twice this.
 */
export function moveOf(state: GameState | PlayerView, unit: Unit): number {
  const def = Object.hasOwn(UNITS, unit.type) ? UNITS[unit.type] : undefined;
  if (!def) return 0;
  return def.move + (benefitOf(state, unit)?.kind.move ?? 0);
}
