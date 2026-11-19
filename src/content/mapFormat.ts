// Turns a hand-drawn map into a GameMap.
//
// A map is drawn three times over, one character per hex, as rows in odd-r
// offset layout (odd rows sit half a hex to the right; indent them by one
// space so the drawing looks like the board). Spaces are ignored.
//
//   terrain    .  open      w  woods     b  building
//              c  crops     =  low wall  ~  water
//   elevation  .  or 0      1            2
//   marks      .  nothing   A-Z  an objective, by id
//                           1-8  a spawn hex, by placement order
//
// A spawn hex belongs to the zone of the corner it sits in:
//   0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.

import { offsetToAxial, key } from '../shared/hex';
import type { Cell, GameMap, Hex, Objective, TerrainId } from '../shared/types';

export interface MapDrawing {
  id: string;
  name: string;
  terrain: string[];
  elevation: string[];
  marks: string[];
  objectiveValues: Record<string, number>;   // objective id -> points per round
  seatSpawns: Record<number, number[]>;
  maxRounds: number;
}

const TERRAIN_CHARS: Record<string, TerrainId> = { '.': 'open', w: 'woods', b: 'building', c: 'crops', '=': 'wall', '~': 'water' };
const ELEVATION_CHARS: Record<string, number> = { '.': 0, '0': 0, '1': 1, '2': 2 };
const ZONES = 4;
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
  const objectives: Objective[] = [];
  const zones: (Hex | undefined)[][] = Array.from({ length: ZONES }, () => []);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const at = `row ${row + 1}, column ${col + 1}`;
      const hex = offsetToAxial(col, row);

      const t = TERRAIN_CHARS[terrain[row][col]];
      const e = ELEVATION_CHARS[elevation[row][col]];
      if (t === undefined) throw new Error(`Map ${d.id}: unknown terrain "${terrain[row][col]}" at ${at}.`);
      if (e === undefined) throw new Error(`Map ${d.id}: unknown elevation "${elevation[row][col]}" at ${at}.`);
      cells[key(hex)] = { terrain: t, elevation: e };

      const m = marks[row][col];
      if (m === '.') continue;
      if (/^[A-Z]$/.test(m)) {
        const value = d.objectiveValues[m];
        if (value === undefined) throw new Error(`Map ${d.id}: objective ${m} has no value.`);
        if (objectives.some((o) => o.id === m)) throw new Error(`Map ${d.id}: objective ${m} is drawn twice.`);
        objectives.push({ id: m, hex, value });
      } else if (/^[1-8]$/.test(m)) {
        const top = row < rows / 2;
        const left = col < cols / 2;
        const zone = top ? (left ? 0 : 1) : (left ? 3 : 2);
        const slot = Number(m) - 1;
        if (zones[zone][slot]) throw new Error(`Map ${d.id}: spawn zone ${zone} has two hexes numbered ${m}.`);
        zones[zone][slot] = hex;
      } else {
        throw new Error(`Map ${d.id}: unknown mark "${m}" at ${at}.`);
      }
    }
  }

  for (const id of Object.keys(d.objectiveValues)) {
    if (!objectives.some((o) => o.id === id)) throw new Error(`Map ${d.id}: objective ${id} is not drawn.`);
  }
  objectives.sort((a, b) => a.id.localeCompare(b.id));

  const spawns = zones.map((zone, z) => {
    const hexes: Hex[] = [];
    for (let slot = 0; slot < ZONE_SIZE; slot++) {
      const hex = zone[slot];
      if (!hex) throw new Error(`Map ${d.id}: spawn zone ${z} has no hex numbered ${slot + 1}.`);
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
