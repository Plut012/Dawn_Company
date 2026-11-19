// Starting a match: squads onto their spawn zones.
//
// Pure: no DOM, Node APIs, clock or randomness.

import { NAMES, UNITS } from '../content';
import type { GameMap, GameState, Squad, Unit } from '../shared/types';

/**
 * A new match. Seat `i` (the squad whose `player` is `i`) uses spawn zone
 * `map.seatSpawns[n][i]`; its units go on that zone's hexes in squad order.
 * Surnames are dealt round the table (`NAMES[index * n + seat]`), so no two
 * units share one while the pool lasts.
 * Throws on input no lobby should produce: a map without seats for this many
 * players, seats that are not exactly 0..n-1, an unknown unit type, or a
 * squad larger than its spawn zone.
 */
export function createMatch(map: GameMap, squads: Squad[]): GameState {
  const n = squads.length;
  const zones = map.seatSpawns[n];
  if (!zones) throw new Error(`Map ${map.id} has no spawn layout for ${n} players.`);
  const bySeat = [...squads].sort((a, b) => a.player - b.player);
  const units: Unit[] = [];
  bySeat.forEach((squad, seat) => {
    if (squad.player !== seat) throw new Error(`Squads must be for seats 0 to ${n - 1}, one each.`);
    const zone = map.spawns[zones[seat]] ?? [];
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
      });
    });
  });
  return {
    map,
    playerCount: n,
    units,
    round: 1,
    scores: bySeat.map(() => 0),
    eliminated: bySeat.map(() => false),
    over: false,
    winners: [],
  };
}
