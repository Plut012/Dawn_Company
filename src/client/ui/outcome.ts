// The end of a match as a table: one row per player, best score first.
// Pure; the results screen draws it.

import { MODES } from '../../content';
import type { ModeId, PlayerId, PlayerView } from '../../shared/types';

/** Last Stand (20): is the score the men still standing (a mode whose win is survival), not supply? */
export const survives = (mode: ModeId): boolean => Object.hasOwn(MODES, mode) && MODES[mode].win === 'survival';

/** What the score is called in this mode: *Supply* in Supply Line, *Standing* in Last Stand. */
export const scoreWord = (mode: ModeId): 'Supply' | 'Standing' => (survives(mode) ? 'Standing' : 'Supply');

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
  if (s.winner && s.out) return 'Won from the casualty list. The supply does not mind.';
  if (s.winner && shared) return 'Shares the win. Nobody is pleased about it.';
  if (s.winner && s.score === 0) return 'Won with nothing on the board. Technically.';
  if (s.winner) return 'Held the ground that counted.';
  if (s.out) return 'Wiped out. The supply stands; nobody is left to spend it.';
  if (s.score === 0) return 'Never held an objective. Saw a good deal of the map.';
  if (best - s.score <= 3) return `Short by ${best - s.score}. Close enough to argue about.`;
  return 'Held something, some of the time.';
}

/** Last Stand's words for a row: who stood and how many men were left. `alone`: no other squad has a man left. */
function survivalSummary(s: { score: number; winner: boolean; out: boolean }, shared: boolean, alone: boolean): string {
  if (s.winner && s.out) return 'Lost the last man in the same round as the others. Shares the win.';
  if (s.out) return 'Wiped out. Nobody came back.';
  const left = `${men(s.score)[0].toUpperCase()}${men(s.score).slice(1)} left`;
  if (s.winner && shared) return `${left}, level on worth too. Shares the win.`;
  if (s.winner && alone) return s.score === 1 ? 'The last man standing.' : `The last squad standing, with ${men(s.score)}.`;
  if (s.winner) return `${left}. Stood at the end.`;
  return `${left}. Not enough.`;
}

/** The men a score counts: "no one", "one man", "3 men". */
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const men = (n: number): string => (n === 0 ? 'no one' : n === 1 ? 'one man' : `${NUMBER_WORDS[n] ?? n} men`);

/**
 * Last Stand: why this squad won, in a sentence, or null when the plain count
 * said it. "Both had two men; Bo's were worth more." `worth` is the total cost
 * of each squad's men (`view.worth`); without it the sentence says only that
 * the count was level.
 */
export function tieBreak(view: PlayerView, names: string[]): string | null {
  if (!survives(view.mode) || view.winners.length === 0) return null;
  const name = (p: PlayerId) => names[p] ?? `Player ${p + 1}`;
  const top = Math.max(...view.scores);
  // Everyone gone together: the last squads fell in the same round.
  if (top === 0) {
    return view.winners.length > 1
      ? `${view.winners.map(name).join(' and ')} lost their last men in the same round. They share it.`
      : null;
  }
  const level = view.scores.map((n, p) => (n === top ? p : -1)).filter((p) => p >= 0);
  if (level.length < 2) return null;                    // one squad had the most men: the count said it
  const both = level.length === 2 ? 'Both' : 'All';
  const count = `${both} had ${men(top)}`;
  const worth = view.worth;
  if (!worth) return view.winners.length > 1 ? `${count}; they share the win.` : `${count}; the dearer men won it.`;
  const best = Math.max(...level.map((p) => worth[p] ?? 0));
  const dearer = level.filter((p) => (worth[p] ?? 0) === best);
  if (dearer.length === level.length) return `${count}, and their men were worth the same. They share it.`;
  return dearer.length === 1
    ? `${count}; ${name(dearer[0])}'s were worth more.`
    : `${count}; ${dearer.map(name).join(' and ')}'s were worth more, and equally so. They share it.`;
}

/** Last Stand: who stood at the end and how many men they had left. Null when nobody did. */
export function stoodLine(view: PlayerView, names: string[]): string | null {
  const top = Math.max(0, ...view.scores);
  if (!survives(view.mode) || top === 0 || view.winners.length === 0) return null;
  const name = (p: PlayerId) => names[p] ?? `Player ${p + 1}`;
  const who = view.winners.map(name).join(' and ');
  const others = view.scores.filter((n) => n > 0).length - view.winners.length;
  if (view.winners.length > 1) return `${who} stood with ${men(top)} each.`;
  return `${who} stood with ${men(top)}${others > 0 ? ` against ${others === 1 ? 'one other squad' : `${others} others`}` : ' and the field to themselves'}.`;
}

export function standings(view: PlayerView, names: string[]): Standing[] {
  const best = Math.max(0, ...view.scores);
  const shared = view.winners.length > 1;
  const survival = survives(view.mode);
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
      // In Last Stand the score is the men standing, exactly, for every squad.
      standing: survival ? score : view.units.filter((u) => u.owner === seat && u.status !== 'down').length,
      exact: survival || out || seat === view.player || (view.eliminated[view.player] ?? false),
      summary: survival ? survivalSummary({ score, winner, out }, shared, view.scores.filter((n) => n > 0).length === 1) : summary({ score, winner, out }, shared, best),
    });
  }
  return rows.sort((a, b) => Number(b.winner) - Number(a.winner) || b.score - a.score || a.seat - b.seat);
}
