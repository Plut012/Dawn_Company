// Starting a match: squads onto their spawn zones.
//
// Pure: no DOM, Node APIs, clock or randomness.

import { DEFAULT_MODE, MODES, NAMES, UNITS } from '../content';
import type { GameMap, GameState, ModeId, PlayerId, Squad, Unit } from '../shared/types';

/**
 * A new match. Seat `i` (the squad whose `player` is `i`) uses spawn zone
 * `map.seatSpawns[n][i]`; its units go on that zone's hexes in squad order.
 * Surnames are dealt round the table (`NAMES[index * n + seat]`), so no two
 * units share one while the pool lasts.
 * Flags: each HQ belongs to the seat that uses its zone; an HQ whose zone no
 * seat uses, and every other objective, to nobody.
 * `mode` is stored on the state; `resolve` reads its return rule (18).
 * Throws on input no lobby should produce: an unknown mode, a unit the mode
 * does not allow, a map without seats for this many
 * players, seats that are not exactly 0..n-1, an unknown unit type, or a
 * squad larger than its spawn zone.
 */
export function createMatch(map: GameMap, squads: Squad[], mode: ModeId = DEFAULT_MODE): GameState {
  if (!Object.hasOwn(MODES, mode)) throw new Error(`Unknown mode "${mode}".`);
  const n = squads.length;
  const zones = map.seatSpawns[n];
  if (!zones) throw new Error(`Map ${map.id} has no spawn layout for ${n} players.`);
  const bySeat = [...squads].sort((a, b) => a.player - b.player);
  const units: Unit[] = [];
  bySeat.forEach((squad, seat) => {
    if (squad.player !== seat) throw new Error(`Squads must be for seats 0 to ${n - 1}, one each.`);
    const zone = map.spawns[zones[seat]] ?? [];
    for (const type of squad.units) {
      const def = UNITS[type];
      const allowed = MODES[mode].units;
      if (def && allowed && !allowed.includes(type)) throw new Error(`${MODES[mode].name} has no ${type}.`);
    }
    if (squad.units.length > zone.length) {
      throw new Error(`Seat ${seat} has ${squad.units.length} units but its spawn zone holds ${zone.length}.`);
    }
    squad.units.forEach((type, index) => {
      const def = UNITS[type];
      if (!def) throw new Error(`Unknown unit type "${type}".`);
      units.push({
        id: `${seat}-${index}`,
        owner: seat,
        type,
        name: `${def.rank} ${NAMES[(index * n + seat) % NAMES.length]}`,
        pos: { q: zone[index].q, r: zone[index].r },
        status: 'ready',
        pinnedRound: null,
        revealed: false,
        posture: 'still',
        returnRound: null,
        dugIn: false,
      });
    });
  });
  const flags: Record<string, PlayerId | null> = {};
  for (const o of map.objectives) {
    const seat = o.zone === null ? -1 : zones.indexOf(o.zone);
    flags[o.id] = seat >= 0 ? seat : null;
  }
  return {
    map,
    playerCount: n,
    units,
    round: 1,
    scores: bySeat.map(() => 0),
    eliminated: bySeat.map(() => false),
    flags,
    mode,
    works: {},
    over: false,
    winners: [],
  };
}
