// What a lesson is, and how one is staged, run and checked.
//
// A lesson is data: a tiny map, a few units, preset orders, and what must be
// true afterwards. It is run by the real `resolve`, so a lesson that no
// longer holds means the rules have changed (or never did what was written).
//
// Pure: no three.js, DOM, clock or randomness.

import { DEFAULT_MODE, NAMES, SUN, UNITS } from '../content';
import { NO_HEX, TERRAIN_CHARS, readAreas } from '../content/mapFormat';
import { resolve, visibleEnemies } from '../rules';
import { key, label, offsetToAxial } from '../shared/hex';
import type {
  Cell, GameEvent, GameMap, GameState, Hex, ModeId, ObjectiveKindId, Order, Phase, PlayerId, Purchase, Unit, UnitId,
  UnitStatus, UnitTypeId,
} from '../shared/types';

export type Group = 'Seeing' | 'Moving' | 'Shooting' | 'Units' | 'Timing' | 'Winning' | 'Supply' | 'Ground' | 'Last Stand';
export const GROUPS: readonly Group[] = ['Seeing', 'Moving', 'Shooting', 'Units', 'Timing', 'Winning', 'Supply', 'Ground', 'Last Stand'];

export interface Lesson {
  id: string;                    // url-safe, e.g. "cover"
  group: Group;
  title: string;                 // a few words
  text: string;                  // one or two sentences: the rule, plainly
  map: GameMap;                  // tiny, about 5 x 5 hexes, purpose-built
  units: { owner: PlayerId; type: UnitTypeId; at: string; status?: UnitStatus; dugIn?: boolean }[];   // `at` is a hex label; `dugIn` (24): staged in his foxhole
  mode?: ModeId;                 // (20) the mode it is played in; left out = the default (Supply Line)
  flags?: Record<string, PlayerId | null>;   // who holds each flag at the start; left out = nobody
  supply?: number[];             // each side's supply at the start; left out = none (18)
  round?: number;                // (19) the match round it starts in; left out = full day (SUN.length), so the light changes nothing
  rounds: Order[][][];           // one entry per round: orders indexed by player
  purchases?: Purchase[][][];    // (18) as `rounds`: each round's buy-backs, indexed by player; left out = none
  notes?: Partial<Record<Phase, string>>;   // a short line shown as that phase plays
  viewAs: PlayerId | 'umpire';   // default viewpoint; 'umpire' sees everything
  fogMatters: boolean;           // show the viewpoint switch
  expect: Expectation[];         // what must be true after the last round
}

export type Expectation =
  | { unit: string; status: UnitStatus }          // unit named by "owner-index"
  | { unit: string; at: string }
  | { unit: string; dugIn: boolean }               // (24)
  | { event: GameEvent['t']; count?: number }     // such an event occurred (in the full list; `count` = exactly so many)
  | { score: number[] }
  | { winners: PlayerId[] }                       // (20) the match is over, and these won it
  | { flag: string; owner: PlayerId | null }      // whose flag flies over the objective
  | { seenBy: PlayerId; unit: string; seen: boolean; after?: number };   // after that many rounds (0 = at the start); left out = the last

// ---- hexes by label

/** "B3" -> the hex in column B, row 3 (the inverse of `label`). */
export function hex(at: string): Hex {
  const m = /^([A-Z])(\d+)$/.exec(at);
  if (!m) throw new Error(`"${at}" is not a hex label.`);
  return offsetToAxial(m[1].charCodeAt(0) - 65, Number(m[2]) - 1);
}

// ---- orders, written with labels

export const move = (unit: UnitId, ...path: string[]): Order => ({ unit, kind: 'move', path: path.map(hex) });
/** A move with a follow-up: `thenFire(move('0-0', 'B2'), 'E2')`. */
export const thenFire = (order: Order, at: string): Order => (order.kind === 'move' ? { ...order, then: { kind: 'fire', target: hex(at) } } : order);
export const thenTreat = (order: Order, at: string): Order => (order.kind === 'move' ? { ...order, then: { kind: 'special', target: hex(at) } } : order);
export const dash = (unit: UnitId, ...path: string[]): Order => ({ unit, kind: 'dash', path: path.map(hex) });
export const fire = (unit: UnitId, at: string): Order => ({ unit, kind: 'fire', target: hex(at) });
export const ambush = (unit: UnitId): Order => ({ unit, kind: 'ambush' });
export const treat = (unit: UnitId, at: string): Order => ({ unit, kind: 'special', target: hex(at) });
/** (25) An engineer's build: `build('0-0', 'C1', 'sandbags')`. */
export const build = (unit: UnitId, at: string, work: string): Order => ({ unit, kind: 'special', target: hex(at), work });

// ---- tiny maps

/**
 * A tiny map, drawn the way src/content/mapFormat.ts explains: one character
 * per hex, odd rows indented. `elevation` and `marks` may be left out (flat,
 * no objectives). `x` is a hex that is not on the board; a letter in `marks`
 * is a hex of that objective's area. There are no spawn zones: a lesson sets its units down by
 * label, which is why `readMap` itself cannot be used here. An `hq` objective is
 * the HQ of the seat of the same number, in letter order (the first is Blue's,
 * the second Plum's), so that a lesson can cut a line and bring a man back.
 */
export interface TinyDrawing {
  id: string;
  terrain: string[];
  elevation?: string[];
  marks?: string[];
  objectives?: Record<string, { kind: ObjectiveKindId; value: number }>;   // a letter drawn on several hexes is one area
}

const ELEVATION_CHARS: Record<string, number> = { '.': 0, '0': 0, '1': 1, '2': 2 };

export function tinyMap(d: TinyDrawing): GameMap {
  const grid = (layer: string, lines: string[]): string[][] => {
    const rows = lines.map((line) => line.replace(/\s+/g, '').split(''));
    if (rows.length !== d.terrain.length) throw new Error(`Map ${d.id}: ${layer} has ${rows.length} rows, expected ${d.terrain.length}.`);
    return rows;
  };
  const terrain = grid('terrain', d.terrain);
  const elevation = d.elevation ? grid('elevation', d.elevation) : null;
  const marks = d.marks ? grid('marks', d.marks) : null;
  const cols = terrain[0]?.length ?? 0;
  const cells: Record<string, Cell> = {};
  const drawn = new Map<string, Hex[]>();
  terrain.forEach((line, row) => {
    for (const [name, layer] of [['terrain', terrain], ['elevation', elevation], ['marks', marks]] as const) {
      if (layer && layer[row].length !== cols) throw new Error(`Map ${d.id}: ${name} row ${row + 1} has ${layer[row].length} hexes, expected ${cols}.`);
    }
    line.forEach((char, col) => {
      const at = offsetToAxial(col, row);
      if (char === NO_HEX) return;
      const t = TERRAIN_CHARS[char];
      const e = ELEVATION_CHARS[elevation ? elevation[row][col] : '.'];
      if (t === undefined) throw new Error(`Map ${d.id}: unknown terrain "${char}" at ${label(at)}.`);
      if (e === undefined) throw new Error(`Map ${d.id}: unknown elevation at ${label(at)}.`);
      cells[key(at)] = { terrain: t, elevation: e };
      const m = marks ? marks[row][col] : '.';
      if (m === '.') return;
      if (!/^[A-Z]$/.test(m) || !d.objectives?.[m]) throw new Error(`Map ${d.id}: mark "${m}" at ${label(at)} is not an objective with an entry.`);
      if (!drawn.has(m)) drawn.set(m, []);
      drawn.get(m)!.push(at);
    });
  });
  const objectives = readAreas(`manual-${d.id}`, drawn, d.objectives ?? {});
  // HQs, in letter order, are zones 0, 1, ...: seat n uses zone n. The zones have no spawn hexes.
  const hqs = objectives.filter((o) => o.kind === 'hq').sort((a, b) => (a.id < b.id ? -1 : 1));
  hqs.forEach((o, zone) => { o.zone = zone; });
  const seats = (n: number) => Array.from({ length: n }, (_, i) => i);
  return {
    id: `manual-${d.id}`, name: d.id, cols, rows: terrain.length,
    cells, objectives, spawns: hqs.map(() => []),
    seatSpawns: hqs.length > 0 ? { 2: seats(2), 3: seats(3), 4: seats(4) } : {},
    maxRounds: 12,
  };
}

// ---- staging, running, checking

/** The starting state. Units are named as `createMatch` names them; one staged as pinned was pinned in an earlier round. */
export function stageLesson(lesson: Lesson): GameState {
  const n = Math.max(2, ...lesson.units.map((u) => u.owner + 1));
  const count: number[] = Array.from({ length: n }, () => 0);
  const units: Unit[] = lesson.units.map((u) => {
    const def = UNITS[u.type];
    if (!def) throw new Error(`Lesson ${lesson.id}: unknown unit type "${u.type}".`);
    const pos = hex(u.at);
    if (!lesson.map.cells[key(pos)]) throw new Error(`Lesson ${lesson.id}: no hex ${u.at} on its map.`);
    const index = count[u.owner]++;
    const status = u.status ?? 'ready';
    return {
      id: `${u.owner}-${index}`, owner: u.owner, type: u.type,
      name: `${def.rank} ${NAMES[(index * n + u.owner) % NAMES.length]}`,
      pos, status, pinnedRound: status === 'pinned' ? 0 : null, revealed: false, posture: 'still', returnRound: null, dugIn: u.dugIn === true,
    };
  });
  return {
    map: lesson.map, playerCount: n, units, round: lesson.round ?? SUN.length,
    scores: count.map((_, p) => lesson.supply?.[p] ?? 0), eliminated: count.map(() => false),
    flags: Object.fromEntries(lesson.map.objectives.map((o) => [o.id, lesson.flags?.[o.id] ?? null])),
    mode: lesson.mode ?? DEFAULT_MODE, works: {}, over: false, winners: [],
  };
}

export interface LessonRun {
  states: GameState[];                          // states[0] is the start; states[i] follows round i
  results: ReturnType<typeof resolve>[];        // one per round
}

/** Every round of the lesson through the real `resolve`. */
export function runLesson(lesson: Lesson): LessonRun {
  const states = [stageLesson(lesson)];
  const results: ReturnType<typeof resolve>[] = [];
  for (const [r, orders] of lesson.rounds.entries()) {
    const result = resolve(states[states.length - 1], orders, lesson.purchases?.[r]);
    results.push(result);
    states.push(result.state);
  }
  return { states, results };
}

/** The expectations that do not hold after the last round, in plain words. Empty = the lesson holds. */
export function checkLesson(lesson: Lesson, run: LessonRun = runLesson(lesson)): string[] {
  const end = run.states[run.states.length - 1];
  const events = run.results.flatMap((r) => r.events);
  const failed: string[] = [];
  const find = (id: string): Unit | null => {
    const u = end.units.find((x) => x.id === id);
    if (!u) failed.push(`There is no unit ${id}.`);
    return u ?? null;
  };
  for (const e of lesson.expect) {
    if ('status' in e) {
      const u = find(e.unit);
      if (u && u.status !== e.status) failed.push(`${u.name} (${u.id}) should be ${e.status}, but is ${u.status}.`);
    } else if ('at' in e) {
      const u = find(e.unit);
      if (u && label(u.pos) !== e.at) failed.push(`${u.name} (${u.id}) should be at ${e.at}, but is at ${label(u.pos)}.`);
    } else if ('dugIn' in e) {
      const u = find(e.unit);
      if (u && u.dugIn !== e.dugIn) failed.push(`${u.name} (${u.id}) should ${e.dugIn ? 'be dug in' : 'not be dug in'}, but ${u.dugIn ? 'is' : 'is not'}.`);
    } else if ('event' in e) {
      const n = events.filter((x) => x.t === e.event).length;
      if (e.count === undefined ? n === 0 : n !== e.count) {
        failed.push(`Expected ${e.count ?? 'at least one'} "${e.event}" event${e.count === undefined || e.count === 1 ? '' : 's'}, but there ${n === 1 ? 'was' : 'were'} ${n}.`);
      }
    } else if ('score' in e) {
      if (e.score.join(',') !== end.scores.join(',')) failed.push(`The score should be ${e.score.join(' to ')}, but is ${end.scores.join(' to ')}.`);
    } else if ('winners' in e) {
      if (!end.over || end.winners.join(',') !== e.winners.join(',')) {
        failed.push(`The winners should be ${e.winners.join(' and ') || 'nobody'}, but ${end.over ? `are ${end.winners.join(' and ') || 'nobody'}` : 'the match is not over'}.`);
      }
    } else if ('flag' in e) {
      const owner = end.flags[e.flag] ?? null;
      const say = (p: PlayerId | null) => (p === null ? 'nobody' : `player ${p}`);
      if (owner !== e.owner) failed.push(`Objective ${e.flag}'s flag should be ${say(e.owner)}'s, but is ${say(owner)}'s.`);
    } else {
      const u = find(e.unit);
      const when = e.after === undefined ? end : run.states[e.after];
      if (!when) { failed.push(`There is no state after ${e.after} rounds.`); continue; }
      const seen = visibleEnemies(when, e.seenBy).some((x) => x.id === e.unit);
      const at = e.after === undefined ? '' : ` after ${e.after} round${e.after === 1 ? '' : 's'}`;
      if (u && seen !== e.seen) failed.push(`${u.name} (${u.id}) should ${e.seen ? 'be seen' : 'not be seen'} by player ${e.seenBy}${at}, but ${seen ? 'is' : 'is not'}.`);
    }
  }
  return failed;
}
