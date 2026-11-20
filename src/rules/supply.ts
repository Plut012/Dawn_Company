// Supply Line (18): who holds their HQ, what a buy-back costs, which
// purchases may be made. Only a mode with `returns` has any of this; in one
// without, nothing can be bought and nobody comes back.
//
// Pure: no DOM, Node APIs, clock or randomness.

import { MODES, UNITS } from '../content';
import type { GameState, ModeDef, Objective, OrderError, PlayerId, PlayerView, Purchase, UnitId } from '../shared/types';

type Board = Pick<GameState, 'map' | 'playerCount' | 'flags' | 'mode'> | Pick<PlayerView, 'map' | 'playerCount' | 'flags' | 'mode'>;

/** The match's mode, or null for an id no mode has. */
export function modeOf(state: Pick<GameState, 'mode'>): ModeDef | null {
  return Object.hasOwn(MODES, state.mode) ? MODES[state.mode] : null;
}

/** The match's return rule, or null when the downed never come back. */
export function returnsOf(state: Pick<GameState, 'mode'>): { rounds: number; buyBack: number } | null {
  return modeOf(state)?.returns ?? null;
}

/** The player's HQ: the objective of kind `hq` whose zone their seat uses. Null if there is none. */
export function hqOf(state: Board, player: PlayerId): Objective | null {
  const zone = state.map.seatSpawns[state.playerCount]?.[player];
  if (zone === undefined) return null;
  return state.map.objectives.find((o) => o.kind === 'hq' && o.zone === zone) ?? null;
}

/** Is the player's line open: do they hold their HQ's flag? */
export function lineOpen(state: Board, player: PlayerId): boolean {
  const hq = hqOf(state, player);
  return hq !== null && (state.flags[hq.id] ?? null) === player;
}

/**
 * What buying this unit back costs now, or null when it cannot be bought back
 * now: the mode has no returns, the unit is not down or not coming back, its
 * owner's line is cut, its owner is out, or it is due back at the end of this
 * round anyway (or already waiting for room at the HQ).
 */
export function buyBackCost(state: GameState | PlayerView, unit: UnitId): number | null {
  const returns = returnsOf(state);
  const u = state.units.find((x) => x.id === unit);
  if (!returns || modeOf(state)?.supply === false || !u || u.status !== 'down' || u.returnRound === null || u.returnRound === undefined) return null;
  if (u.returnRound <= state.round || state.over || state.eliminated[u.owner] || !lineOpen(state, u.owner)) return null;
  const def = Object.hasOwn(UNITS, u.type) ? UNITS[u.type] : null;
  return def ? def.cost * returns.buyBack : null;
}

/**
 * What is wrong with a player's purchases; empty = they may all be made.
 * Each must be a buy-back of one of the player's own down units that
 * `buyBackCost` prices, no unit twice, and the running total within the
 * player's supply. Takes anything: the list may come straight off the network.
 */
export function validatePurchases(state: GameState, player: PlayerId, purchases: Purchase[]): OrderError[] {
  const errors: OrderError[] = [];
  if (!Array.isArray(purchases)) return [{ unit: null, reason: 'purchases must be a list' }];
  const seen = new Set<UnitId>();
  let total = 0;
  for (const p of purchases) {
    const id = typeof p === 'object' && p !== null && typeof p.unit === 'string' ? p.unit : null;
    const fail = (reason: string) => errors.push({ unit: id, reason });
    if (id === null || p.kind !== 'return') { fail('not a purchase'); continue; }
    if (modeOf(state)?.supply === false) { fail('No supply in this mode.'); continue; }
    const u = state.units.find((x) => x.id === id);
    if (!u || u.owner !== player) { fail('not your unit'); continue; }
    if (seen.has(id)) { fail('bought back twice'); continue; }
    seen.add(id);
    const cost = buyBackCost(state, id);
    if (cost === null) {
      fail(!returnsOf(state) ? 'nobody comes back in this mode'
        : u.status !== 'down' ? 'unit is not down'
        : !lineOpen(state, player) ? 'your line is cut: retake your HQ'
        : 'unit cannot be bought back now');
      continue;
    }
    total += cost;
    if (total > (state.scores[player] ?? 0)) fail('not enough supply');
  }
  return errors;
}
