// (28) The board tells every tile its neighbours, and asks again round a hex whose ground changes.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { aroundOf, createTiling } from './tiling';
import { key, neighbors } from '../../shared/hex';
import type { Cell, Hex, HexKey, TerrainId } from '../../shared/types';
import type { Around } from './kit';
import { lowpolyKit } from './kits/lowpoly';
import { mapFor } from '../../content';

const hex = (q: number, r: number): Hex => ({ q, r });

/** A kit that only notes what it is asked. */
function recorder() {
  const asked: { terrain: TerrainId; elevation: number; hex: Hex; around: Around | undefined }[] = [];
  return {
    asked,
    tile(terrain: TerrainId, elevation: number, h: Hex, around?: Around) {
      asked.push({ terrain, elevation, hex: h, around });
      return new THREE.Object3D();
    },
  };
}

// A row of three, and one hex above the middle one:   (1,-1)
//                                                  (0,0) (1,0) (2,0)
const CELLS: Record<HexKey, Cell> = {
  [key(hex(0, 0))]: { terrain: 'open', elevation: 0 },
  [key(hex(1, 0))]: { terrain: 'wall', elevation: 1 },
  [key(hex(2, 0))]: { terrain: 'water', elevation: 0 },
  [key(hex(1, -1))]: { terrain: 'crops', elevation: 2 },
};

describe('aroundOf', () => {
  it('gives the six neighbours in the order E, NE, NW, W, SW, SE, null where there is no hex', () => {
    const around = aroundOf(hex(1, 0), (k) => CELLS[k]);
    expect(around).toEqual([
      { terrain: 'water', elevation: 0 },     // E: (2, 0)
      null,                                   // NE: (2, -1)
      { terrain: 'crops', elevation: 2 },     // NW: (1, -1)
      { terrain: 'open', elevation: 0 },      // W: (0, 0)
      null,                                   // SW: (0, 1)
      null,                                   // SE: (1, 1)
    ]);
    expect(neighbors(hex(1, 0)).map(key)).toEqual(['2,0', '2,-1', '1,-1', '0,0', '0,1', '1,1']);
    expect(aroundOf(hex(9, 9), (k) => CELLS[k])).toEqual([null, null, null, null, null, null]);
  });
});

describe('tiling', () => {
  it('asks the kit for every hex of a map with its neighbours', () => {
    const kit = recorder();
    const drawn = createTiling(kit).build(CELLS);
    expect(drawn.map((d) => d.key).sort()).toEqual(Object.keys(CELLS).sort());
    expect(kit.asked.length).toBe(4);
    for (const a of kit.asked) {
      expect(a.around).toEqual(aroundOf(a.hex, (k) => CELLS[k]));
      expect(a.terrain).toBe(CELLS[key(a.hex)].terrain);
      expect(a.elevation).toBe(CELLS[key(a.hex)].elevation);
    }
    // At the edge of the map: (0,0) has the wall to its east and the crops to its north-east, and nothing else.
    const corner = kit.asked.find((a) => key(a.hex) === '0,0')!;
    expect(corner.around).toEqual([{ terrain: 'wall', elevation: 1 }, { terrain: 'crops', elevation: 2 }, null, null, null, null]);
  });

  it('asks again for a hex whose terrain changes, and for its neighbours, each told the new ground', () => {
    const kit = recorder();
    const tiling = createTiling(kit);
    tiling.build(CELLS);
    kit.asked.length = 0;
    // A work goes up on the middle hex.
    const again = tiling.retile(key(hex(1, 0)), 'sandbags');
    expect(again.map((d) => d.key)).toEqual(['1,0', '2,0', '1,-1', '0,0']);       // itself, then its neighbours on the map, in order
    expect(kit.asked.map((a) => `${key(a.hex)} ${a.terrain}`)).toEqual(['1,0 sandbags', '2,0 water', '1,-1 crops', '0,0 open']);
    expect(tiling.terrainOf('1,0')).toBe('sandbags');
    // The neighbours are told of the work: (0,0) has it to its east, (2,0) to its west.
    expect(kit.asked[3].around![0]).toEqual({ terrain: 'sandbags', elevation: 1 });
    expect(kit.asked[1].around![3]).toEqual({ terrain: 'sandbags', elevation: 1 });
    // The same again changes nothing; nor does a hex that is not on the map.
    kit.asked.length = 0;
    expect(tiling.retile(key(hex(1, 0)), 'sandbags')).toEqual([]);
    expect(tiling.retile(key(hex(7, 7)), 'wire')).toEqual([]);
    expect(kit.asked.length).toBe(0);
  });

  it('forgets an old map when a new one is built', () => {
    const kit = recorder();
    const tiling = createTiling(kit);
    tiling.build(CELLS);
    tiling.build({ '0,0': { terrain: 'woods', elevation: 0 } });
    expect(tiling.terrainOf('1,0')).toBeUndefined();
    expect(kit.asked.at(-1)!.around).toEqual([null, null, null, null, null, null]);
  });

  it('builds a real map with lowpoly as before: the kit ignores its neighbours', () => {
    const map = mapFor(2);
    const a = createTiling(lowpolyKit()).build(map.cells);
    const plain = lowpolyKit();
    const count = (o: THREE.Object3D) => { let n = 0; o.traverse(() => { n++; }); return n; };
    expect(a.length).toBe(Object.keys(map.cells).length);
    for (const d of a.slice(0, 40)) {
      const [q, r] = d.key.split(',').map(Number);
      expect(count(d.object)).toBe(count(plain.tile(map.cells[d.key].terrain, map.cells[d.key].elevation, { q, r })));
    }
  });
});
