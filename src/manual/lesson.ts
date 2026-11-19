// What a lesson is, and how one is staged, run and checked.
//
// A lesson is data: a tiny map, a few units, preset orders, and what must be
// true afterwards. It is run by the real `resolve`, so a lesson that no
// longer holds means the rules have changed (or never did what was written).
//
// Pure: no three.js, DOM, clock or randomness.

import { NAMES, UNITS } from '../content';
import { resolve, visibleEnemies } from '../rules';
import { key, label, offsetToAxial } from '../shared/hex';
import type {
  Cell, GameEvent, GameMap, GameState, Hex, Objective, Order, Phase, PlayerId, TerrainId, Unit, UnitId,
  UnitStatus, UnitTypeId,
} from '../shared/types';

export type Group = 'Seeing' | 'Moving' | 'Shooting' | 'Units' | 'Timing' | 'Winning';
export const GROUPS: readonly Group[] = ['Seeing', 'Moving', 'Shooting', 'Units', 'Timing', 'Winning'];

export interface Lesson {
  id: string;                    // url-safe, e.g. "cover"
  group: Group;
  title: string;                 // a few words
  text: string;                  // one or two sentences: the rule, plainly
  map: GameMap;                  // tiny, about 5 x 5 hexes, purpose-built
  units: { owner: PlayerId; type: UnitTypeId; at: string; status?: UnitStatus }[];   // `at` is a hex label
  rounds: Order[][][];           // one entry per round: orders indexed by player
  notes?: Partial<Record<Phase, string>>;   // a short line shown as that phase plays
  viewAs: PlayerId | 'umpire';   // default viewpoint; 'umpire' sees everything
  fogMatters: boolean;           // show the viewpoint switch
  expect: Expectation[];         // what must be true after the last round
}

export type Expectation =
  | { unit: string; status: UnitStatus }          // unit named by "owner-index"
  | { unit: string; at: string }
  | { event: GameEvent['t']; count?: number }     // such an event occurred (in the full list; `count` = exactly so many)
  | { score: number[] }
  | { seenBy: PlayerId; unit: string; seen: boolean };

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

// ---- tiny maps

/**
 * A tiny map, drawn the way src/content/mapFormat.ts explains: one character
 * per hex, odd rows indented. `elevation` and `marks` may be left out (flat,
 * no objectives). There are no spawn zones: a lesson sets its units down by
 * label, which is why `readMap` itself cannot be used here.
 */
export interface TinyDrawing {
  id: string;
  terrain: string[];
  elevation?: string[];
  marks?: string[];
  objectiveValues?: Record<string, number>;
}

const TERRAIN_CHARS: Record<string, TerrainId> = { '.': 'open', w: 'woods', b: 'building', c: 'crops', '=': 'wall', '~': 'water' };
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
  const objectives: Objective[] = [];
  terrain.forEach((line, row) => {
    for (const [name, layer] of [['terrain', terrain], ['elevation', elevation], ['marks', marks]] as const) {
      if (layer && layer[row].length !== cols) throw new Error(`Map ${d.id}: ${name} row ${row + 1} has ${layer[row].length} hexes, expected ${cols}.`);
    }
    line.forEach((char, col) => {
      const at = offsetToAxial(col, row);
      const t = TERRAIN_CHARS[char];
      const e = ELEVATION_CHARS[elevation ? elevation[row][col] : '.'];
      if (t === undefined) throw new Error(`Map ${d.id}: unknown terrain "${char}" at ${label(at)}.`);
      if (e === undefined) throw new Error(`Map ${d.id}: unknown elevation at ${label(at)}.`);
      cells[key(at)] = { terrain: t, elevation: e };
      const m = marks ? marks[row][col] : '.';
      if (m === '.') return;
      const value = d.objectiveValues?.[m];
      if (!/^[A-Z]$/.test(m) || value === undefined) throw new Error(`Map ${d.id}: mark "${m}" at ${label(at)} is not an objective with a value.`);
      objectives.push({ id: m, hex: at, value });
    });
  });
  objectives.sort((a, b) => a.id.localeCompare(b.id));
  return {
    id: `manual-${d.id}`, name: d.id, cols, rows: terrain.length,
    cells, objectives, spawns: [], seatSpawns: {}, maxRounds: 12,
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
      pos, status, pinnedRound: status === 'pinned' ? 0 : null, revealed: false, posture: 'still',
    };
  });
  return {
    map: lesson.map, playerCount: n, units, round: 1,
    scores: count.map(() => 0), eliminated: count.map(() => false),
    over: false, winners: [],
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
  for (const orders of lesson.rounds) {
    const result = resolve(states[states.length - 1], orders);
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
    } else if ('event' in e) {
      const n = events.filter((x) => x.t === e.event).length;
      if (e.count === undefined ? n === 0 : n !== e.count) {
        failed.push(`Expected ${e.count ?? 'at least one'} "${e.event}" event${e.count === undefined || e.count === 1 ? '' : 's'}, but there ${n === 1 ? 'was' : 'were'} ${n}.`);
      }
    } else if ('score' in e) {
      if (e.score.join(',') !== end.scores.join(',')) failed.push(`The score should be ${e.score.join(' to ')}, but is ${end.scores.join(' to ')}.`);
    } else {
      const u = find(e.unit);
      const seen = visibleEnemies(end, e.seenBy).some((x) => x.id === e.unit);
      if (u && seen !== e.seen) failed.push(`${u.name} (${u.id}) should ${e.seen ? 'be seen' : 'not be seen'} by player ${e.seenBy}, but ${seen ? 'is' : 'is not'}.`);
    }
  }
  return failed;
}
