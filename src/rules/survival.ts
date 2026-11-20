// Last Stand (20): a mode whose `win` is 'survival'. The score is a live tally
// of living units; the winner has the most, then the dearest.
//
// Pure: no DOM, Node APIs, clock or randomness.

import { UNITS } from '../content';
import type { PlayerId, Unit } from '../shared/types';

/** How many of a player's units are standing (ready or pinned). */
export function standingCount(units: Unit[], player: PlayerId): number {
  return units.filter((u) => u.owner === player && u.status !== 'down').length;
}

/** The total `cost` of a player's standing units: the tie-break. */
export function worthOf(units: Unit[], player: PlayerId): number {
  return units.reduce((a, u) => a + (u.owner === player && u.status !== 'down' ? UNITS[u.type]?.cost ?? 0 : 0), 0);
}

/**
 * Who wins a survival match that has ended: the most living units, then the
 * greatest total cost of them; still equal, they share. If nobody has a man
 * left, the last squads all fell in the same round: every squad that was not
 * already out (`outBefore`, as the round began) shares the win.
 */
export function survivalWinners(units: Unit[], players: PlayerId[], outBefore: boolean[]): PlayerId[] {
  const count = new Map(players.map((p) => [p, standingCount(units, p)]));
  const most = Math.max(...count.values());
  if (most === 0) return players.filter((p) => !outBefore[p]);
  const tied = players.filter((p) => count.get(p) === most);
  const best = Math.max(...tied.map((p) => worthOf(units, p)));
  return tied.filter((p) => worthOf(units, p) === best);
}
