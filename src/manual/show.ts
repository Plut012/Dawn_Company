// What the manual screen shows of a lesson: whose view, which events, the
// order marks, the phases to step through and the closing line. All of it
// worked out here, away from the DOM and the board, so it can be tested.
//
// Pure: no three.js, no DOM.

import { actionOf, validateOrders, viewFor, visibleEnemies } from '../rules';
import { label } from '../shared/hex';
import type { GameEvent, GameState, Hex, Order, Phase, PlayerId, PlayerView } from '../shared/types';
import type { Lesson, LessonRun } from './lesson';

export type Viewpoint = PlayerId | 'umpire';

/** The seat the umpire's view is given: nobody's, so no unit on the board is "his own". */
export const UMPIRE_SEAT: PlayerId = -1;

/** Sides are named by their player mark's colour (docs/design.md). */
export const SIDE_NAMES: readonly string[] = ['Blue', 'Plum', 'Teal', 'Bone'];
export const sideName = (p: PlayerId): string => SIDE_NAMES[p] ?? `Player ${p + 1}`;
export const viewpointName = (v: Viewpoint): string => (v === 'umpire' ? 'Umpire' : sideName(v));

export const PHASES: readonly Phase[] = ['treat', 'fire', 'move', 'assault', 'mortar', 'score'];
export const PHASE_NAMES: Record<Phase, string> = {
  treat: 'Treat', fire: 'Fire', move: 'Movement', assault: 'Assault', mortar: 'Mortars', score: 'Score',
};

/**
 * The view a viewpoint has of a state. A side gets `viewFor`. The umpire sees
 * every hex and every unit still in the match; a unit that is down is left
 * out, as it is from any view of an enemy, because that is how the board
 * leaves one that goes down while it plays.
 */
export function viewOf(state: GameState, viewpoint: Viewpoint): PlayerView {
  if (viewpoint !== 'umpire') return viewFor(state, viewpoint);
  return {
    player: UMPIRE_SEAT,
    map: state.map,
    playerCount: state.playerCount,
    round: state.round,
    maxRounds: state.map.maxRounds,
    units: state.units.filter((u) => u.status !== 'down'),
    visible: Object.keys(state.map.cells),
    scores: [...state.scores],
    eliminated: [...state.eliminated],
    over: state.over,
    winners: [...state.winners],
  };
}

/** The events a viewpoint is shown for one round: a side's own, or all of them. */
export function eventsOf(result: LessonRun['results'][number], viewpoint: Viewpoint): GameEvent[] {
  return viewpoint === 'umpire' ? result.events : result.playerEvents[viewpoint] ?? [];
}

export interface PhaseChunk { phase: Phase; events: GameEvent[] }

/** A round's events cut at each `phase` event. Each chunk starts with its `phase` event. */
export function phaseChunks(events: GameEvent[]): PhaseChunk[] {
  const out: PhaseChunk[] = [];
  for (const e of events) {
    if (e.t === 'phase') out.push({ phase: e.phase, events: [e] });
    else if (out.length > 0) out[out.length - 1].events.push(e);
    else out.push({ phase: 'treat', events: [e] });
  }
  return out;
}

/** Is there anything to stop for in this chunk: something happens, or the lesson has a word to say. */
export function worthAStop(lesson: Lesson, chunk: PhaseChunk): boolean {
  return lesson.notes?.[chunk.phase] !== undefined || chunk.events.some((e) => e.t !== 'phase' && e.t !== 'over' && e.t !== 'eliminated');
}

/** The board's planning marks, as the board takes them (see `Mark` in src/client/render). */
export type OrderMark =
  | { kind: 'path'; from: Hex; path: Hex[]; dash: boolean }
  | { kind: 'target'; from: Hex; hex: Hex; blast: number }
  | { kind: 'ambush'; hex: Hex };

/**
 * The marks for one round's orders, on the state they were given in. A side
 * sees its own orders; the umpire sees everyone's. Orders the rules would
 * turn down are not drawn.
 */
export function orderMarks(state: GameState, orders: Order[][], viewpoint: Viewpoint): OrderMark[] {
  const out: OrderMark[] = [];
  for (let p = 0; p < state.playerCount; p++) {
    if (viewpoint !== 'umpire' && viewpoint !== p) continue;
    const mine = orders[p] ?? [];
    const bad = new Set(validateOrders(state, p, mine).map((e) => e.unit));
    for (const o of mine) {
      const u = state.units.find((x) => x.id === o.unit);
      if (!u || bad.has(o.unit)) continue;
      if (o.kind === 'move' || o.kind === 'dash') {
        out.push({ kind: 'path', from: u.pos, path: o.path, dash: o.kind === 'dash' });
        // A follow-up is aimed from where the path ends.
        if (o.kind === 'move' && o.then) out.push({ kind: 'target', from: o.path[o.path.length - 1], hex: o.then.target, blast: actionOf(u.type, o.then.kind)?.blast ?? 0 });
      } else if (o.kind === 'fire' || o.kind === 'special') out.push({ kind: 'target', from: u.pos, hex: o.target, blast: actionOf(u.type, o.kind)?.blast ?? 0 });
      else out.push({ kind: 'ambush', hex: u.pos });
    }
  }
  return out;
}

/**
 * How the lesson ended, in one line, read from the last state: where each
 * unit the lesson is about stands and how, who sees whom, and the score.
 * Which things to mention comes from the lesson's `expect`; what is said
 * about them comes from the state, so a lesson that fails says what happened.
 */
export function outcome(lesson: Lesson, run: LessonRun): string {
  const end = run.states[run.states.length - 1];
  const about = new Map<string, { status: boolean; at: boolean; seenBy: PlayerId[] }>();
  const entry = (id: string) => {
    let e = about.get(id);
    if (!e) about.set(id, e = { status: false, at: false, seenBy: [] });
    return e;
  };
  let score = false;
  for (const e of lesson.expect) {
    if ('status' in e) entry(e.unit).status = true;
    else if ('at' in e) entry(e.unit).at = true;
    else if ('seenBy' in e) entry(e.unit).seenBy.push(e.seenBy);
    else if ('score' in e) score = true;
  }
  const parts: string[] = [];
  for (const [id, what] of about) {
    const u = end.units.find((x) => x.id === id);
    if (!u) continue;
    const said: string[] = [];
    if (what.status && what.at) said.push(`${u.status} at ${label(u.pos)}`);
    else if (what.status) said.push(u.status);
    else if (what.at) said.push(`at ${label(u.pos)}`);
    for (const p of what.seenBy) {
      const seen = visibleEnemies(end, p).some((x) => x.id === id);
      said.push(seen ? `seen by ${sideName(p)}` : `not seen by ${sideName(p)}`);
    }
    parts.push(`${u.name}: ${said.join(', ')}.`);
  }
  if (score) parts.push(`Score: ${end.scores.map((s, p) => `${sideName(p)} ${s}`).join(', ')}.`);
  return parts.join(' ') || 'Done.';
}

// ---- stepping

/**
 * One press of Step. Either a phase is played, or (between rounds) the next
 * round's orders are put up. Phases in which nothing happens and the lesson
 * has nothing to say are not stopped at: they ride along with the stop
 * before or after them, and play in no time.
 */
export type Stop =
  | { kind: 'orders'; round: number }                     // round is 0-based; never for the first round
  | {
    kind: 'phase'; round: number;
    phase: Phase | null;         // the phase this stop is for; null when nothing in the whole round is worth a stop
    chunks: PhaseChunk[];        // what to play, in order
  };

/** Every stop of the lesson for one viewpoint, in order. Each round's chunks are all in its stops, once. */
export function stopsFor(lesson: Lesson, run: LessonRun, viewpoint: Viewpoint): Stop[] {
  const out: Stop[] = [];
  run.results.forEach((result, round) => {
    if (round > 0) out.push({ kind: 'orders', round });
    let last: Extract<Stop, { kind: 'phase' }> | null = null;
    let waiting: PhaseChunk[] = [];
    for (const chunk of phaseChunks(eventsOf(result, viewpoint))) {
      waiting.push(chunk);
      if (!worthAStop(lesson, chunk)) continue;
      out.push(last = { kind: 'phase', round, phase: chunk.phase, chunks: waiting });
      waiting = [];
    }
    if (last) last.chunks.push(...waiting);
    else out.push({ kind: 'phase', round, phase: null, chunks: waiting });
  });
  return out;
}

// ---- the manual's place in the URL

/**
 * A page's query string with the manual opened at a lesson (`id`), or closed
 * (`null`). Everything else in the query (a dev slot, say) is kept.
 */
export function manualSearch(search: string, id: string | null): string {
  const params = new URLSearchParams(search);
  if (id === null) params.delete('manual'); else params.set('manual', id);
  const s = params.toString();
  return s ? `?${s}` : '';
}
