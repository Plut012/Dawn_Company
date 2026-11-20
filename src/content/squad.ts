// The one piece of logic in content: is this squad legal?

import type { ModeId, UnitTypeId } from '../shared/types';
import { DEFAULT_MODE, MODES } from './modes';
import { RULES } from './rules';
import { UNITS } from './units';

/**
 * Checks a squad against the roster and the limits in RULES. `cost` is the
 * total of every unit that exists; `errors` are plain sentences, empty when
 * the squad is legal. A unit type the mode does not allow is an error
 * ("Last Stand has no mortar."); so is a mode that does not exist.
 */
export function validateSquad(units: UnitTypeId[], mode: ModeId = DEFAULT_MODE): { ok: boolean; cost: number; errors: string[] } {
  const errors: string[] = [];
  const modeDef = Object.hasOwn(MODES, mode) ? MODES[mode] : null;
  if (!modeDef) errors.push(`No such mode: "${mode}".`);
  const counts = new Map<UnitTypeId, number>();
  const unknown = new Set<UnitTypeId>();
  let cost = 0;

  for (const id of units) {
    if (!Object.hasOwn(UNITS, id)) {
      unknown.add(id);
      continue;
    }
    cost += UNITS[id].cost;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  for (const id of unknown) errors.push(`No such unit: "${id}".`);
  if (units.length < RULES.minUnits) {
    errors.push(`Too few units: ${units.length}. The minimum is ${RULES.minUnits}.`);
  }
  if (units.length > RULES.maxUnits) {
    errors.push(`Too many units: ${units.length}. The maximum is ${RULES.maxUnits}.`);
  }
  if (cost > RULES.budget) {
    errors.push(`Over budget: ${cost} points. The budget is ${RULES.budget}.`);
  }
  for (const id of counts.keys()) {
    if (modeDef?.units && !modeDef.units.includes(id)) errors.push(`${modeDef.name} has no ${id}.`);
  }
  for (const [id, count] of counts) {
    const def = UNITS[id];
    if (def.max !== null && count > def.max) {
      errors.push(`Too many of ${def.name}: ${count}. The limit is ${def.max} per squad.`);
    }
  }

  return { ok: errors.length === 0, cost, errors };
}
