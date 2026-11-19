// The end of a match as a table: one row per player, best score first.
// Pure; the results screen draws it.

import type { PlayerId, PlayerView } from '../../shared/types';

export interface Standing {
  seat: PlayerId;
  name: string;
  score: number;
  winner: boolean;
  out: boolean;
  /**
   * Units still standing (ready or pinned). Exact for the viewer's own squad
   * and for a wiped squad; for anyone else it is only those in the viewer's
   * sight when the match ended, so `exact` is false.
   */
  standing: number;
  exact: boolean;
  summary: string;
}

function summary(s: { score: number; winner: boolean; out: boolean }, shared: boolean, best: number): string {
  if (s.winner && s.out) return 'Won from the casualty list. The points do not mind.';
  if (s.winner && shared) return 'Shares the win. Nobody is pleased about it.';
  if (s.winner && s.score === 0) return 'Won with nothing on the board. Technically.';
  if (s.winner) return 'Held the ground that counted.';
  if (s.out) return 'Wiped out. The score stands; nobody is left to read it.';
  if (s.score === 0) return 'Never held an objective. Saw a good deal of the map.';
  if (best - s.score <= 3) return `Short by ${best - s.score}. Close enough to argue about.`;
  return 'Held something, some of the time.';
}

export function standings(view: PlayerView, names: string[]): Standing[] {
  const best = Math.max(0, ...view.scores);
  const shared = view.winners.length > 1;
  const rows: Standing[] = [];
  for (let seat = 0; seat < view.playerCount; seat++) {
    const out = view.eliminated[seat] ?? false;
    const winner = view.winners.includes(seat);
    const score = view.scores[seat] ?? 0;
    rows.push({
      seat,
      name: names[seat] ?? `Player ${seat + 1}`,
      score,
      winner,
      out,
      standing: view.units.filter((u) => u.owner === seat && u.status !== 'down').length,
      exact: out || seat === view.player || (view.eliminated[view.player] ?? false),
      summary: summary({ score, winner, out }, shared, best),
    });
  }
  return rows.sort((a, b) => Number(b.winner) - Number(a.winner) || b.score - a.score || a.seat - b.seat);
}
