// Squad-builder arithmetic: pure, so it can be tested without a DOM.

import { DEFAULT_MODE, MODES, RULES, UNITS, validateSquad } from '../../content';
import { actionOf } from '../../rules';
import type { ModeId, UnitTypeId } from '../../shared/types';

export type RowState = 'idle' | 'at-limit' | 'unaffordable' | 'barred';

export interface RosterRow {
  count: number;
  cost: number;           // points each
  canInc: boolean;
  canDec: boolean;
  state: RowState;
  caption: string;        // "4 PTS EA · 3 LEFT"
}

export function spent(squad: UnitTypeId[]): number {
  return validateSquad(squad).cost;
}

/** Why the mode keeps this unit out ("Last Stand has no mortar."), or null when it is allowed. */
export function barredReason(id: UnitTypeId, mode: ModeId = DEFAULT_MODE): string | null {
  const m = MODES[mode];
  return m?.units && !m.units.includes(id) ? `${m.name} has no ${id}.` : null;
}

export function rosterRow(squad: UnitTypeId[], id: UnitTypeId, mode: ModeId = DEFAULT_MODE): RosterRow {
  const def = UNITS[id];
  const count = squad.filter((u) => u === id).length;
  const left = RULES.budget - spent(squad);
  const atMax = def.max !== null && count >= def.max;
  const full = squad.length >= RULES.maxUnits;
  const cant = def.cost > left;
  const base = `${def.cost} PTS EA`;
  let state: RowState = 'idle';
  let caption = base;
  if (barredReason(id, mode)) {
    // Not a limit of the squad but of the mode: the unit cannot be added at all. Those already in the squad can still be taken out.
    state = 'barred';
    caption = `${base} · BARRED`;
  } else if (atMax || full || left <= 0) {
    // A spent budget is a limit, not a warning: Rust is for a unit that is nearly, but not quite, affordable.
    state = 'at-limit';
    caption = atMax ? `${base} · MAX ${def.max}` : full ? `${base} · FULL` : `${base} · 0 LEFT`;
  } else if (cant) {
    state = 'unaffordable';
    caption = `${base} · ${Math.max(0, left)} LEFT`;
  }
  return { count, cost: def.cost, canInc: state === 'idle', canDec: count > 0, state, caption };
}

/**
 * What a unit type can do besides walking, one line per action, straight
 * from the data: "Fire, 1 to 4 hexes. One shot at one hex he can see."
 * An action that may follow a move in the same round says so.
 */
export function actionLines(id: UnitTypeId): string[] {
  const out: string[] = [];
  for (const kind of ['fire', 'special'] as const) {
    const a = UNITS[id]?.orders.includes(kind) ? actionOf(id, kind) : null;
    if (!a) continue;
    const reach = a.range === a.minRange ? `${a.range} ${a.range === 1 ? 'hex' : 'hexes'}` : `${a.minRange} to ${a.range} hexes`;
    out.push(`${a.name}, ${reach}. ${a.blurb}${a.mobile ? ' Can follow a move.' : ''}`);
  }
  return out;
}

export const add = (squad: UnitTypeId[], id: UnitTypeId): UnitTypeId[] => [...squad, id];

/** Removes the last unit of that type, so earlier ones keep their place. */
export function remove(squad: UnitTypeId[], id: UnitTypeId): UnitTypeId[] {
  const i = squad.lastIndexOf(id);
  return i === -1 ? squad : [...squad.slice(0, i), ...squad.slice(i + 1)];
}

/** Swaps the unit at `i` with its neighbour (`delta` -1 or +1). Out of range does nothing. */
export function move(squad: UnitTypeId[], i: number, delta: -1 | 1): UnitTypeId[] {
  const j = i + delta;
  if (i < 0 || j < 0 || i >= squad.length || j >= squad.length) return squad;
  const next = [...squad];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export const sameSquad = (a: UnitTypeId[], b: UnitTypeId[]): boolean =>
  a.length === b.length && a.every((u, i) => u === b[i]);
