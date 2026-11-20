// Turns a hand-drawn map into a GameMap.
//
// A map is drawn three times over, one character per hex, as rows in odd-r
// offset layout (odd rows sit half a hex to the right; indent them by one
// space so the drawing looks like the board). Spaces are ignored.
//
//   terrain    .  open      w  woods     b  building
//              c  crops     =  low wall  ~  water
//              x  no hex: not on the board (the other layers have . or x there)
//   elevation  .  or 0      1            2
//   marks      .  nothing   A-Z  a hex of an objective's area, by id
//                           1-8  a spawn hex, by placement order
//
// A letter drawn on several hexes is one objective: its area, which must be
// connected. Each letter has an entry in `objectives` giving its kind and
// value. An objective of kind `hq` is a start zone's HQ. The zones are
// numbered by their HQs in letter order, and a spawn hex belongs to the zone
// whose HQ area is nearest to it (a tie is an error). Every zone has spawn
// hexes 1 to 8.

import { OBJECTIVE_KINDS } from './objectives';
import { distance, key, neighbors, offsetToAxial } from '../shared/hex';
import type { Cell, GameMap, Hex, Objective, ObjectiveKindId, TerrainId } from '../shared/types';

export interface MapDrawing {
  id: string;
  name: string;
  terrain: string[];
  elevation: string[];
  marks: string[];
  objectives: Record<string, { kind: ObjectiveKindId; value: number }>;   // objective id -> its kind, and supply per round
  seatSpawns: Record<number, number[]>;
  maxRounds: number;
}

export const TERRAIN_CHARS: Record<string, TerrainId> = { '.': 'open', w: 'woods', b: 'building', c: 'crops', '=': 'wall', '~': 'water' };
export const NO_HEX = 'x';
const ELEVATION_CHARS: Record<string, number> = { '.': 0, '0': 0, '1': 1, '2': 2 };
const ZONE_SIZE = 8;

/** One drawn layer -> a grid of single characters, checked for shape. */
function grid(map: string, layer: string, lines: string[], cols?: number): string[][] {
  const out = lines.map((line) => line.replace(/\s+/g, '').split(''));
  const width = cols ?? out[0]?.length ?? 0;
  out.forEach((row, i) => {
    if (row.length !== width) {
      throw new Error(`Map ${map}: ${layer} row ${i + 1} has ${row.length} hexes, expected ${width}.`);
    }
  });
  return out;
}

/**
 * The objectives drawn as letters (each letter's hexes in drawing order), with
 * their entries: checked, connected, sorted by id, `zone` still null.
 * Shared with the manual's tiny maps.
 */
export function readAreas(
  map: string,
  drawn: Map<string, Hex[]>,
  entries: Record<string, { kind: ObjectiveKindId; value: number }>,
): Objective[] {
  const out: Objective[] = [];
  for (const [id, hexes] of drawn) {
    const entry = entries[id];
    if (!entry) throw new Error(`Map ${map}: objective ${id} has no entry (kind and value).`);
    if (!OBJECTIVE_KINDS[entry.kind]) throw new Error(`Map ${map}: objective ${id} has an unknown kind "${entry.kind}".`);
    // Connected: everything reachable from the first hex through hexes of the area.
    const all = new Set(hexes.map(key));
    const reached = new Set([key(hexes[0])]);
    const queue = [hexes[0]];
    while (queue.length > 0) {
      for (const n of neighbors(queue.shift()!)) {
        const k = key(n);
        if (all.has(k) && !reached.has(k)) { reached.add(k); queue.push(n); }
      }
    }
    if (reached.size !== all.size) throw new Error(`Map ${map}: objective ${id} is drawn in more than one piece; an area must be connected.`);
    out.push({ id, kind: entry.kind, hexes, value: entry.value, zone: null });
  }
  for (const id of Object.keys(entries)) {
    if (!drawn.has(id)) throw new Error(`Map ${map}: objective ${id} is not drawn.`);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Steps from a hex to the nearest hex of an area. */
export function areaDistance(hexes: Hex[], h: Hex): number {
  return Math.min(...hexes.map((a) => distance(a, h)));
}

export function readMap(d: MapDrawing): GameMap {
  const terrain = grid(d.id, 'terrain', d.terrain);
  const rows = terrain.length;
  const cols = terrain[0]?.length ?? 0;
  const elevation = grid(d.id, 'elevation', d.elevation, cols);
  const marks = grid(d.id, 'marks', d.marks, cols);
  if (elevation.length !== rows || marks.length !== rows) {
    throw new Error(`Map ${d.id}: the three layers must have the same number of rows.`);
  }

  const cells: Record<string, Cell> = {};
  const drawn = new Map<string, Hex[]>();
  const spawnHexes: { hex: Hex; slot: number; at: string }[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const at = `row ${row + 1}, column ${col + 1}`;
      const hex = offsetToAxial(col, row);
      const m = marks[row][col];

      if (terrain[row][col] === NO_HEX) {
        if (!['.', NO_HEX].includes(elevation[row][col]) || !['.', NO_HEX].includes(m)) {
          throw new Error(`Map ${d.id}: ${at} is not on the board (x), so its elevation and mark must be . or x.`);
        }
        continue;
      }
      const t = TERRAIN_CHARS[terrain[row][col]];
      const e = ELEVATION_CHARS[elevation[row][col]];
      if (t === undefined) throw new Error(`Map ${d.id}: unknown terrain "${terrain[row][col]}" at ${at}.`);
      if (e === undefined) throw new Error(`Map ${d.id}: unknown elevation "${elevation[row][col]}" at ${at}.`);
      cells[key(hex)] = { terrain: t, elevation: e };

      if (m === '.') continue;
      if (/^[A-Z]$/.test(m)) {
        if (!drawn.has(m)) drawn.set(m, []);
        drawn.get(m)!.push(hex);
      } else if (/^[1-8]$/.test(m)) {
        spawnHexes.push({ hex, slot: Number(m) - 1, at });
      } else {
        throw new Error(`Map ${d.id}: unknown mark "${m}" at ${at}.`);
      }
    }
  }

  const objectives = readAreas(d.id, drawn, d.objectives);
  const hqs = objectives.filter((o) => o.kind === 'hq');
  hqs.forEach((o, z) => { o.zone = z; });

  if (spawnHexes.length > 0 && hqs.length === 0) throw new Error(`Map ${d.id}: spawn hexes are drawn but there is no HQ for them to belong to.`);
  const zones: (Hex | undefined)[][] = hqs.map(() => []);
  for (const s of spawnHexes) {
    const steps = hqs.map((o) => areaDistance(o.hexes, s.hex));
    const best = Math.min(...steps);
    const nearest = hqs.filter((_, z) => steps[z] === best);
    if (nearest.length > 1) {
      throw new Error(`Map ${d.id}: spawn hex ${s.slot + 1} at ${s.at} is as near HQ ${nearest.map((o) => o.id).join(' as HQ ')}; it must be nearest one.`);
    }
    const zone = nearest[0].zone!;
    if (zones[zone][s.slot]) throw new Error(`Map ${d.id}: spawn zone ${zone} (HQ ${hqs[zone].id}) has two hexes numbered ${s.slot + 1}.`);
    zones[zone][s.slot] = s.hex;
  }

  const spawns = zones.map((zone, z) => {
    const hexes: Hex[] = [];
    for (let slot = 0; slot < ZONE_SIZE; slot++) {
      const hex = zone[slot];
      if (!hex) throw new Error(`Map ${d.id}: spawn zone ${z} (HQ ${hqs[z].id}) has no hex numbered ${slot + 1}.`);
      hexes.push(hex);
    }
    return hexes;
  });

  return {
    id: d.id, name: d.name, cols, rows,
    cells, objectives, spawns,
    seatSpawns: d.seatSpawns,
    maxRounds: d.maxRounds,
  };
}
