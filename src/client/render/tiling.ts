// (28) What the board has asked its kit to draw on each hex, and asking again when the ground changes.
//
// A tile is told its six neighbours (`Around`), so a wall can run to the next wall and a field end at its
// edge. So when a hex's terrain changes (a work goes up), its neighbours are asked for again too. This keeps
// the terrain *drawn* on each hex, which during playback is ahead of the map of the last view.

import type * as THREE from 'three';
import { key, neighbors, parseKey } from '../../shared/hex';
import type { Cell, Hex, HexKey, TerrainId } from '../../shared/types';
import type { Around, VisualKit } from './kit';

/** The six neighbours of a hex in `neighbors()` order (E, NE, NW, W, SW, SE); null where there is no hex. */
export function aroundOf(hex: Hex, cellAt: (k: HexKey) => { terrain: TerrainId; elevation: number } | undefined): Around {
  return neighbors(hex).map((n) => {
    const cell = cellAt(key(n));
    return cell ? { terrain: cell.terrain, elevation: cell.elevation } : null;
  });
}

export interface Drawn { key: HexKey; object: THREE.Object3D }

export interface Tiling {
  /** Ask the kit for every hex of a map, each with its neighbours. Forgets what was drawn before. */
  build(cells: Record<HexKey, Cell>): Drawn[];
  /**
   * A hex's terrain is now this: ask for it again, and for each of its neighbours on the map (their own
   * terrain, their new surroundings). Nothing, if the hex is not on the map or is drawn so already.
   */
  retile(k: HexKey, terrain: TerrainId): Drawn[];
  /** The terrain drawn on a hex. */
  terrainOf(k: HexKey): TerrainId | undefined;
}

export function createTiling(kit: Pick<VisualKit, 'tile'>): Tiling {
  const drawn = new Map<HexKey, { terrain: TerrainId; elevation: number }>();
  const ask = (k: HexKey): Drawn => {
    const cell = drawn.get(k)!;
    const hex = parseKey(k);
    return { key: k, object: kit.tile(cell.terrain, cell.elevation, hex, aroundOf(hex, (n) => drawn.get(n))) };
  };
  return {
    build(cells) {
      drawn.clear();
      for (const k of Object.keys(cells)) drawn.set(k, { terrain: cells[k].terrain, elevation: cells[k].elevation });
      return [...drawn.keys()].map(ask);
    },
    retile(k, terrain) {
      const cell = drawn.get(k);
      if (!cell || cell.terrain === terrain) return [];
      cell.terrain = terrain;
      return [k, ...neighbors(parseKey(k)).map(key).filter((n) => drawn.has(n))].map(ask);
    },
    terrainOf: (k) => drawn.get(k)?.terrain,
  };
}
