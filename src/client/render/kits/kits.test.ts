// Kit selection, and the diorama kit's promises that can be checked without a screen.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { kitFromUrl, makeKit } from './index';
import { dioramaKit } from './diorama';
import { lowpolyKit } from './lowpoly';
import { rigOf } from './lowpoly/units';
import { CROPS, corn } from './diorama/crops';
import { wallRuns } from './diorama/walls';
import type { UnitStatus } from '../../../shared/types';

const meshes = (o: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); });
  return out;
};
/** Every mesh's geometry as numbers: what is drawn, whatever the object ids. */
const shape = (o: THREE.Object3D): number[][] => meshes(o).map((m) => [
  ...m.geometry.getAttribute('position').array, ...(m.geometry.getAttribute('color')?.array ?? []), m.position.y,
]);
const height = (o: THREE.Object3D): number => {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o).max.y;
};

describe('kit selection', () => {
  it('reads ?kit=diorama, and takes anything else for lowpoly', () => {
    expect(kitFromUrl('?kit=diorama')).toBe('diorama');
    expect(kitFromUrl('?slot=dev1&kit=diorama&auto=x')).toBe('diorama');
    expect(kitFromUrl('?kit=lowpoly')).toBe('lowpoly');
    expect(kitFromUrl('?kit=Diorama')).toBe('lowpoly');
    expect(kitFromUrl('?kit=')).toBe('lowpoly');
    expect(kitFromUrl('')).toBe('lowpoly');
    expect(kitFromUrl()).toBe('lowpoly');      // no page, no query
  });

  it('makes the kit asked for: only the diorama sets up the renderer', () => {
    const low = makeKit('lowpoly');
    const dio = makeKit('diorama');
    expect(low.renderer).toBeUndefined();
    expect(typeof dio.renderer).toBe('function');
    expect(dio.tokens).toEqual(low.tokens);
    for (const kit of [low, dio]) {
      expect(typeof kit.tile).toBe('function');
      expect(typeof kit.light).toBe('function');
      expect(typeof kit.effect).toBe('function');
    }
  });
});

describe('diorama kit', () => {
  it('sets a scene up and follows the dawn without a renderer', () => {
    const kit = dioramaKit();
    const scene = new THREE.Scene();
    kit.environment(scene);
    const sun = scene.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight;
    expect(sun).toBeDefined();
    kit.tile('open', 0, { q: 0, r: 0 });
    kit.light!(scene, 0);
    const night = { power: sun.intensity, colour: sun.color.getHex() };
    kit.light!(scene, 1);
    expect(sun.intensity).toBeGreaterThan(night.power);
    expect(sun.color.getHex()).not.toBe(night.colour);
    expect(() => kit.light!(scene, Number.NaN)).not.toThrow();
    expect(kit.fog().transparent).toBe(true);
  });

  it('gives a placeholder, never an error, for a terrain or unit it does not know', () => {
    const kit = dioramaKit();
    const tile = kit.tile('swamp', 1, { q: 2, r: 1 });
    expect(meshes(tile).length).toBeGreaterThan(0);
    const unit = kit.unit('tank', 0);
    expect(meshes(unit.object).length).toBeGreaterThan(0);
    for (const s of ['ready', 'pinned', 'down'] as UnitStatus[]) expect(() => unit.setStatus(s)).not.toThrow();
    expect(() => kit.unit('rifleman', 9).setStatus('pinned')).not.toThrow();    // an owner with no mark
    expect(() => kit.tile('open', Number.NaN, { q: 0, r: 0 })).not.toThrow();
  });

  it('hands the works and the gunner to lowpoly: the same shapes', () => {
    const kit = dioramaKit();
    const low = lowpolyKit();
    const hex = { q: 3, r: 2 };
    expect(shape(kit.tile('wire', 1, hex))).toEqual(shape(low.tile('wire', 1, hex)));
    for (const terrain of ['sandbags', 'wire', 'nest']) {
      expect(shape(kit.tile(terrain, 0, hex))).toEqual(shape(low.tile(terrain, 0, hex)));
    }
    // The gunner is lowpoly's man (every part after its base) on the diorama's base.
    const theirs = low.unit('gunner', 1).object;
    const ours = kit.unit('gunner', 1).object;
    expect(ours.children.slice(0, -1).map(shape)).toEqual(theirs.children.slice(1).map(shape));
    // ...and makes open ground and the rifleman itself.
    expect(shape(kit.tile('open', 1, hex))).not.toEqual(shape(low.tile('open', 1, hex)));
    expect(shape(kit.unit('rifleman', 1).object)).not.toEqual(shape(low.unit('rifleman', 1).object));
  });

  it('stands the gunner on the same base as the rifleman, dimmer at first light, the hue kept', () => {
    const kit = dioramaKit();
    const scene = new THREE.Scene();
    kit.environment(scene);
    const baseOf = (o: THREE.Object3D): THREE.Mesh[] => meshes(o.children.find((c) => meshes(c).some((m) => (m.material as THREE.Material).type === 'ShadowMaterial'))!);
    const rifle = baseOf(kit.unit('rifleman', 1).object);
    const gun = baseOf(kit.unit('gunner', 1).object);
    expect(gun.map((m) => m.material)).toEqual(rifle.map((m) => m.material));      // the very same materials
    const disc = rifle[0].material as THREE.MeshBasicMaterial;
    const hsl = (c: THREE.Color) => c.getHSL({ h: 0, s: 0, l: 0 });
    kit.light!(scene, 1);
    const day = hsl(disc.color.clone());
    kit.light!(scene, 0);
    const night = hsl(disc.color.clone());
    expect(night.l).toBeLessThan(day.l * 0.75);
    expect(night.h).toBeCloseTo(day.h, 3);
    expect(night.s).toBeCloseTo(day.s, 2);
    expect(disc.toneMapped).toBe(false);
  });

  it('lays the mist in sheets over the board, fewer of them as the dawn lifts it, and none over the hilltop', () => {
    const kit = dioramaKit();
    const scene = new THREE.Scene();
    kit.environment(scene);
    for (let q = 0; q < 4; q++) for (let r = 0; r < 3; r++) kit.tile('open', 0, { q, r });
    const sheets = (): THREE.Mesh[] => meshes(scene).filter((m) => m.renderOrder === -1);
    const up = (): number => sheets().filter((m) => m.visible).length;
    kit.light!(scene, 0);
    expect(sheets().length).toBeGreaterThan(0);
    const night = up();
    expect(night).toBe(sheets().length);
    kit.light!(scene, 0.5);
    const grey = up();
    kit.light!(scene, 1);
    const day = up();
    expect(grey).toBeLessThan(night);
    expect(day).toBeLessThan(grey);
    expect(day).toBeGreaterThan(0);
    for (const sheet of sheets()) {
      const box = new THREE.Box3().setFromObject(sheet);
      expect(box.max.y).toBeLessThan(1);                       // level 2 stands clear of it
      expect(box.min.y).toBeGreaterThan(0);                    // and it never cuts level-0 ground
      expect(box.max.y < 0.5 || box.min.y > 0.5).toBe(true);   // nor the flat top of the first step
      expect((sheet.material as THREE.Material).depthWrite).toBe(false);
    }
    // Over the board and a margin round it.
    const span = new THREE.Box3().setFromObject(sheets()[0]);
    expect(span.min.x).toBeLessThan(-3);
    expect(span.max.z).toBeGreaterThan(3 + 3);
  });

  it('leaves lowpoly\'s own materials as they were', () => {
    const low = lowpolyKit().unit('rifleman', 0);
    const before = meshes(low.object).map((m) => m.material);
    const dressed = dioramaKit().unit('gunner', 0);
    dressed.setStatus('pinned');
    for (const m of before.flat()) {
      expect(m.toneMapped).toBe(true);
      expect(m.onBeforeCompile.toString()).toBe(new THREE.Material().onBeforeCompile.toString());
    }
    expect(meshes(low.object).map((m) => m.material)).toEqual(before);
  });

  // ---- (27) woods and buildings

  /** The meshes the board's veil would wear (`makeVeil` in ../index.ts): opaque and not drawn inside out. */
  const veiled = (tile: THREE.Object3D): THREE.Mesh[] => meshes(tile).filter(
    (m) => [m.material].flat().every((mat) => !mat.transparent && mat.side !== THREE.BackSide),
  );
  const named = (tile: THREE.Object3D, name: string): THREE.Mesh => meshes(tile).find((m) => m.name === name)!;

  it('makes woods and buildings itself, the same hex the same way twice, at every level', () => {
    const low = lowpolyKit();
    for (const terrain of ['woods', 'building']) {
      for (const level of [0, 1, 2]) {
        const hex = { q: 4, r: -1 };
        const a = dioramaKit().tile(terrain, level, hex);
        expect(shape(a)).toEqual(shape(dioramaKit().tile(terrain, level, hex)));
        expect(shape(a)).not.toEqual(shape(low.tile(terrain, level, hex)));
        expect(shape(dioramaKit().tile(terrain, level, { q: 5, r: -1 }))).not.toEqual(shape(a));
        // It stands on the ground at its level, and nothing of it goes below.
        const thing = named(a, terrain === 'woods' ? 'wood' : 'house');
        a.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(thing);
        expect(box.min.y).toBeGreaterThan(level * 0.5 - 0.12);       // roots and the foot of a bush, in the ground
        expect(box.min.y).toBeLessThan(level * 0.5 + 0.05);
      }
    }
  });

  it('gives the veil something to wear on a woods hex and on a building hex: every leaf and stone of it', () => {
    const kit = dioramaKit();
    for (const [terrain, name] of [['woods', 'wood'], ['building', 'house']]) {
      const tile = kit.tile(terrain, 1, { q: 1, r: 2 });
      const wears = veiled(tile);
      expect(wears.length).toBeGreaterThanOrEqual(2);              // the ground, and what stands on it
      expect(wears).toContain(named(tile, name));
      expect(wears.length).toBeLessThanOrEqual(3);                 // few draw calls a hex
    }
  });

  it('keeps a wood clear where a man stands and where his mark and the label are, and its trees in bounds', () => {
    for (const hex of [{ q: 0, r: 0 }, { q: 3, r: 1 }, { q: -2, r: 4 }, { q: 7, r: 7 }]) {
      const trees = named(dioramaKit().tile('woods', 0, hex), 'wood');
      const at = trees.geometry.getAttribute('position');
      let top = 0;
      for (let i = 0; i < at.count; i++) {
        const [x, y, z] = [at.getX(i), at.getY(i), at.getZ(i)];
        top = Math.max(top, y);
        // What a point hides from the camera (55 degrees down, from the south) is the ground 0.7 y to its north.
        const hides = z - 0.7 * y;
        // Nothing stands where the man does, or south of him in front of him.
        if (Math.abs(x) < 0.16) expect(z < -0.14 || z > 0.5 || y < 0.02).toBe(true);
        // His mark, at the front of his base (0.3 south of the middle), is not hidden.
        if (Math.abs(x) < 0.36) expect(hides < 0.12 || hides > 0.5 || y < 0.02).toBe(true);
        // Nor is the label, at the back, by anything south of it.
        if (Math.abs(x) < 0.28 && z > -0.57) expect(hides < -0.83 || hides > -0.57).toBe(true);
        // The mark of a man in the hex to the north-east or north-west (0.866 across, 1.5 up; the mark 0.3 south of his middle).
        if (Math.abs(Math.abs(x) - 0.866) < 0.3) expect(hides).toBeGreaterThan(-1.5 + 0.45);
        expect(Math.abs(x)).toBeLessThan(1.35);                   // a crown over the edge, not over the next hex's middle
      }
      expect(top).toBeGreaterThan(0.8);
      expect(top).toBeLessThan(1.5);
    }
  });

  it('gives neighbouring hexes houses of different kinds, each filling its hex and hiding no mark behind it', () => {
    const kit = dioramaKit();
    const tris = (hex: { q: number; r: number }) => {
      const tile = kit.tile('building', 0, hex);
      return named(tile, 'house').geometry.getAttribute('position').count + named(tile, 'lid').geometry.getAttribute('position').count;
    };
    const kinds = new Set<number>();
    for (const hex of [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: 5, r: 3 }, { q: -3, r: 2 }, { q: 2, r: 2 }]) {
      const tile = kit.tile('building', 0, hex);
      const box = new THREE.Box3().setFromObject(named(tile, 'lid')).union(new THREE.Box3().setFromObject(named(tile, 'house')));
      expect(box.max.y).toBeGreaterThan(0.7);
      expect(box.max.y).toBeLessThan(1.05);
      expect(box.max.z).toBeGreaterThan(0.6);                      // a whole house on the hex: it comes to the front
      expect(box.min.z).toBeLessThan(-0.6);
      expect(Math.max(-box.min.x, box.max.x)).toBeLessThan(0.87);  // inside the hex from side to side
      for (const part of ['house', 'lid']) {
        const at = named(tile, part).geometry.getAttribute('position');
        expect(named(tile, part).geometry.getAttribute('aMat')).toBeDefined();
        for (let i = 0; i < at.count; i++) {
          // What a point hides is the ground 0.7 y to its north; the front of the mark of a man in the hex behind is 1.02 north.
          expect(at.getZ(i) - 0.7 * at.getY(i)).toBeGreaterThan(-1.03);
          // Its corners are cut along the hex's edges (a hex of circumradius 1, a corner along z), the eaves a little over.
          expect(Math.abs(at.getZ(i)) + Math.abs(at.getX(i)) / Math.sqrt(3)).toBeLessThan(1.03);
        }
      }
      kinds.add(tris(hex));
    }
    for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]) {
      expect(tris({ q: 2 + dq, r: 2 + dr })).not.toBe(tris({ q: 2, r: 2 }));     // another kind has other parts
    }
    expect(kinds.size).toBe(3);
  });

  it('takes the lid off a house while it is occupied, and puts it back; other tiles take no notice', () => {
    const kit = dioramaKit();
    const tile = kit.tile('building', 1, { q: 1, r: 1 });
    const lid = named(tile, 'lid');
    const shell = named(tile, 'house');
    const seen = () => meshes(tile).filter((m) => m.visible).length;
    expect(lid.visible).toBe(true);
    const closed = seen();
    kit.occupied!(tile, true);
    expect(lid.visible).toBe(false);
    expect(shell.visible).toBe(true);
    // Open: the back and side walls stand to their full height, the front is down to a sill no higher than a base.
    const at = shell.geometry.getAttribute('position');
    let back = 0;
    let front = 0;
    for (let i = 0; i < at.count; i++) {
      if (at.getZ(i) < -0.6) back = Math.max(back, at.getY(i));
      if (at.getZ(i) > 0.55 && Math.abs(at.getX(i)) < 0.45) front = Math.max(front, at.getY(i));
    }
    expect(back).toBeGreaterThan(0.38);
    expect(front).toBeLessThanOrEqual(0.0701);
    kit.occupied!(tile, true);                                     // told twice: no harm
    kit.occupied!(tile, false);
    expect(lid.visible).toBe(true);
    expect(seen()).toBe(closed);
    for (const terrain of ['open', 'woods', 'water', 'wall']) {
      const other = kit.tile(terrain, 0, { q: 0, r: 0 });
      const before = meshes(other).map((m) => m.visible);
      expect(() => kit.occupied!(other, true)).not.toThrow();
      expect(meshes(other).map((m) => m.visible)).toEqual(before);
    }
    expect(lowpolyKit().occupied).toBeUndefined();
  });

  it('veils an opened house as the closed house: the board shuts it while the veil is copied', () => {
    const kit = dioramaKit();
    const tile = kit.tile('building', 0, { q: 3, r: 0 });
    kit.occupied!(tile, true);
    // What the board does (applyFog in ../index.ts): shut, copy, open again.
    kit.occupied!(tile, false);
    const veil = tile.clone(true);
    kit.occupied!(tile, true);
    expect(named(tile, 'lid').visible).toBe(false);
    const copy = named(veil, 'lid');
    expect(copy.visible).toBe(true);
    expect(veiled(veil)).toContain(copy);                          // opaque: it wears the veil
    kit.occupied!(veil, true);                                     // the copy is not a tile the kit opens
    expect(copy.visible).toBe(true);
  });

  // ---- (28) water, crops and walls: tiles that know their neighbours

  const cell = (terrain: string, elevation = 0) => ({ terrain, elevation });
  const all = (terrain: string | null) => Array.from({ length: 6 }, () => (terrain === null ? null : cell(terrain)));
  /** Around with these directions (E, NE, NW, W, SW, SE = 0..5) set, the rest open ground. */
  const withAt = (set: Record<number, string | null>) => all('open').map((n, i) => (i in set ? (set[i] === null ? null : cell(set[i]!)) : n));
  const pts = (m: THREE.Mesh): [number, number, number][] => {
    const at = m.geometry.getAttribute('position');
    return Array.from({ length: at.count }, (_, i) => [at.getX(i), at.getY(i), at.getZ(i)]);
  };
  const near = (m: THREE.Mesh, x: number, z: number, within = 0.12): boolean => pts(m).some(([px, , pz]) => Math.hypot(px - x, pz - z) < within);

  it('gives lowpoly the same tile with or without neighbours', () => {
    const low = lowpolyKit();
    for (const terrain of ['open', 'woods', 'building', 'crops', 'wall', 'water', 'sandbags']) {
      expect(shape(low.tile(terrain, 1, { q: 2, r: 3 }, all('wall')))).toEqual(shape(low.tile(terrain, 1, { q: 2, r: 3 })));
    }
  });

  it('makes water, crops and walls itself: the same hex and neighbours, the same tile; other neighbours, another', () => {
    const low = lowpolyKit();
    const hex = { q: 2, r: 3 };
    for (const terrain of ['water', 'crops', 'wall']) {
      const around = withAt({ 0: terrain, 3: terrain, 1: 'building' });
      const a = dioramaKit().tile(terrain, 1, hex, around);
      expect(shape(a)).toEqual(shape(dioramaKit().tile(terrain, 1, hex, around)));
      expect(shape(a)).not.toEqual(shape(low.tile(terrain, 1, hex, around)));
      expect(shape(dioramaKit().tile(terrain, 1, hex, all('open')))).not.toEqual(shape(a));
      expect(() => dioramaKit().tile(terrain, 0, hex)).not.toThrow();           // no neighbours told: still a tile
      expect(veiled(a).length).toBeGreaterThanOrEqual(1);
      expect(veiled(a).length).toBeLessThanOrEqual(3);                           // few draw calls a hex
    }
  });

  it('lays water below the ground, shallow towards each bank and deep where water runs on', () => {
    const kit = dioramaKit();
    const tile = kit.tile('water', 1, { q: 0, r: 0 }, withAt({ 0: 'water', 3: null }));     // water east, the board's edge west
    const ground = named(tile, 'ground');
    const edge = ground.geometry.getAttribute('aEdge');
    const at = ground.geometry.getAttribute('position');
    let top = -9;
    const shoreAt = (x: number, z: number): number => {
      let best = -1; let d = 9;
      for (let i = 0; i < at.count; i++) {
        const dd = Math.hypot(at.getX(i) - x, at.getZ(i) - z) + Math.abs(at.getY(i) - top) * 9;
        if (dd < d) { d = dd; best = edge.getX(i); }
      }
      return best;
    };
    for (let i = 0; i < at.count; i++) top = Math.max(top, at.getY(i));
    expect(top).toBeCloseTo(0.5 - 0.14, 5);
    expect(shoreAt(0.866, 0)).toBe(0);           // east: water runs on
    expect(shoreAt(-0.866, 0)).toBe(0);          // west: off the board, it runs on
    expect(shoreAt(0.433, -0.75)).toBe(1);       // north-east: a bank
    expect(shoreAt(0, 0)).toBe(0);
    // Reeds only along banks, and low.
    const reeds = named(tile, 'reeds');
    expect(near(reeds, 0.8, 0, 0.2)).toBe(false);
    expect(near(reeds, 0.38, -0.66, 0.3) || near(reeds, -0.38, 0.66, 0.3)).toBe(true);
    for (const [, y, z] of pts(reeds)) expect(z - 0.7 * (y - 0.14)).toBeGreaterThan(-1.03);
    // A pond of one's own neighbours all water: no banks, no reeds.
    expect(meshes(kit.tile('water', 0, { q: 0, r: 0 }, all('water'))).some((m) => m.name === 'reeds')).toBe(false);
  });

  it('stands the corn in the map\'s rows, ends the field at its edge, and keeps a man, his mark and the hex behind clear', () => {
    const kit = dioramaKit();
    const hex = { q: 1, r: 2 };
    const tile = kit.tile('crops', 0, hex, withAt({ 0: 'crops', 3: 'crops', 5: 'crops' }));     // the field ends to the north and south-west
    const field = named(tile, 'field');
    const middle = named(tile, 'middle');
    expect(field.geometry.getAttribute('position').count).toBeGreaterThan(1000);
    // The headland: nothing against the north-east edge, corn right up to the east one.
    expect(near(field, 0.42, -0.72, 0.05)).toBe(false);
    expect(near(field, 0.8, 0, 0.1)).toBe(true);
    for (const [x, y, z] of pts(field)) {
      const hides = z - 0.7 * y;
      expect(hides).toBeGreaterThan(-1.03);                                   // the mark of a man in the hex behind
      if (y > 0.03) {
        expect(Math.hypot(x, z)).toBeGreaterThan(0.64);                       // not where his base goes
        if (Math.abs(x) < 0.36 && z > 0.1) expect(hides).toBeGreaterThan(0.5);  // not in front of his mark
      }
      expect(y).toBeLessThan(0.5);                                            // to his waist
    }
    // The middle is the corn where he would stand: there while the hex is empty, gone while he is in it.
    expect(near(middle, 0, 0, 0.15)).toBe(true);
    expect(middle.visible).toBe(true);
    kit.occupied!(tile, true);
    expect(middle.visible).toBe(false);
    expect(field.visible).toBe(true);
    kit.occupied!(tile, false);
    expect(middle.visible).toBe(true);
    // One field: a stalk's place is the map's, so neighbouring hexes' rows line up (the same offset across the rows).
    const turn = 0.32; const apart = 0.105;
    const rowOf = (m: THREE.Mesh, h: { q: number; r: number }) => {
      const cx = Math.sqrt(3) * (h.q + h.r / 2); const cz = 1.5 * h.r;
      const [x, , z] = pts(m)[0];
      const t = ((cx + x) * Math.sin(turn) + (cz + z) * Math.cos(turn)) / apart;
      return Math.abs(t - Math.floor(t) - 0.5);
    };
    const next = named(kit.tile('crops', 0, { q: 2, r: 2 }, all('crops')), 'field');
    expect(rowOf(field, hex)).toBeLessThan(0.2);
    expect(rowOf(next, { q: 2, r: 2 })).toBeLessThan(0.2);
    // The phone's field is the same rows, sparser: about half the stalks.
    expect(corn(hex, all('crops'), CROPS.phone).field.getAttribute('position').count)
      .toBeLessThan(corn(hex, all('crops'), CROPS.desktop).field.getAttribute('position').count * 0.7);
  });

  it('runs a wall to its wall and building neighbours and nowhere else', () => {
    // Alone: a short length across the north of the hex, clear of the corners.
    expect(wallRuns(all('open'))).toEqual({ east: null, west: null, northEast: null, northWest: null, downEast: null, downWest: null });
    const alone = named(dioramaKit().tile('wall', 0, { q: 0, r: 0 }, all('open')), 'wall');
    expect(near(alone, 0, -0.76)).toBe(true);
    expect(near(alone, 0.866, -0.5)).toBe(false);
    expect(near(alone, -0.866, -0.5)).toBe(false);
    // A wall to the east: out to the east corner, where that hex's own wall begins; not to the west one.
    const east = named(dioramaKit().tile('wall', 0, { q: 0, r: 0 }, withAt({ 0: 'wall' })), 'wall');
    expect(near(east, 0.866, -0.5)).toBe(true);
    expect(near(east, -0.866, -0.5)).toBe(false);
    expect(near(east, 0, -1)).toBe(false);
    // North-west: a spur to the north corner. South-east: down the east side to the lower corner.
    const turn = named(dioramaKit().tile('wall', 0, { q: 0, r: 0 }, withAt({ 2: 'wall', 5: 'wall' })), 'wall');
    expect(near(turn, 0, -1)).toBe(true);
    expect(near(turn, 0.866, 0.5)).toBe(true);
    expect(near(turn, -0.866, 0.5)).toBe(false);
    // South-west: down the west side, unless the hex to the west is a wall (the side is its east side, and its to draw).
    expect(wallRuns(withAt({ 4: 'wall' })).downWest).toBe('wall');
    expect(wallRuns(withAt({ 4: 'wall', 3: 'wall' })).downWest).toBeNull();
    expect(wallRuns(withAt({ 4: 'wall', 3: 'building' })).downWest).toBe('wall');
    // A building: the wall is carried on to the house's wall, past the corner.
    expect(wallRuns(withAt({ 0: 'building', 1: 'building' }))).toMatchObject({ east: 'house', northEast: 'house' });
    const toHouse = named(dioramaKit().tile('wall', 0, { q: 0, r: 0 }, withAt({ 0: 'building', 5: 'building' })), 'wall');
    expect(near(toHouse, 0.866 + 0.13, -0.5)).toBe(true);
    expect(near(toHouse, 0.866, 0.85)).toBe(true);
    expect(near(east, 0.866 + 0.13, -0.5, 0.06)).toBe(false);
    // Low, behind the man, and hiding nobody's mark: his own (its front 0.5 south) or the hex behind's.
    for (const wallMesh of [alone, east, turn, toHouse]) {
      for (const [x, y, z] of pts(wallMesh)) {
        expect(y).toBeLessThan(0.3);
        expect(Math.hypot(x, z)).toBeGreaterThan(0.66);
        expect(z - 0.7 * y).toBeGreaterThan(-1.2);
        if (Math.abs(Math.abs(x) - 0.866) < 0.33) expect(z - 0.7 * y).toBeGreaterThan(-1.03);
      }
    }
    // A hex off the board is no wall.
    expect(wallRuns(all(null))).toEqual(wallRuns(all('open')));
  });

  it('draws the same hex the same way twice, and another hex differently', () => {
    const hex = { q: -2, r: 5 };
    const a = dioramaKit().tile('open', 2, hex);
    const b = dioramaKit().tile('open', 2, hex);
    expect(shape(a)).toEqual(shape(b));
    expect(meshes(a).length).toBeGreaterThanOrEqual(2);      // the ground and what grows on it
    expect(shape(dioramaKit().tile('open', 2, { q: -1, r: 5 }))).not.toEqual(shape(a));
  });

  it('raises open ground to its level', () => {
    const kit = dioramaKit();
    for (const level of [0, 1, 2]) {
      const top = height(meshes(kit.tile('open', level, { q: 0, r: 0 }))[0]);
      expect(top).toBeCloseTo(level * 0.5, 5);
    }
  });

  it('stands, crouches and lays the rifleman down, and digs him in', () => {
    const unit = dioramaKit().unit('rifleman', 0);
    const man = (): number => {
      // The figure alone: the group lowpoly's effects lean.
      const figure = unit.object.children[1];
      unit.object.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(figure).max.y;
    };
    unit.setStatus('ready');
    const standing = man();
    expect(standing).toBeGreaterThan(0.9);
    expect(standing).toBeLessThan(1.25);
    unit.setStatus('pinned');
    const crouching = man();
    expect(crouching).toBeLessThan(standing - 0.15);
    unit.setStatus('down');
    expect(man()).toBeLessThan(crouching - 0.15);

    unit.setStatus('ready');
    const before = height(unit.object);
    const hole = meshes(unit.object).filter((m) => !m.visible);
    expect(hole.length).toBe(1);
    unit.setDugIn!(true);
    expect(hole[0].visible).toBe(true);
    expect(height(hole[0])).toBeLessThan(0.4);               // low: he is seen over it
    expect(new THREE.Box3().setFromObject(hole[0]).max.x).toBeLessThan(0.95);
    unit.setDugIn!(false);
    expect(hole[0].visible).toBe(false);
    expect(height(unit.object)).toBeCloseTo(before, 5);
  });

  it('gives lowpoly\'s effects a rig to drive the new figure', () => {
    const unit = dioramaKit().unit('rifleman', 1);
    const rig = rigOf(unit.object);
    expect(rig).not.toBeNull();
    expect(rig!.status()).toBe('ready');
    unit.setStatus('pinned');
    expect(rig!.status()).toBe('pinned');
    expect(rig!.mark.visible).toBe(true);
    rig!.blend('pinned', 'ready', 1);
    expect(rig!.mark.visible).toBe(false);
    expect(() => { rig!.lean(1, 0, 0.4); rig!.lean(1, 0, 0); rig!.dig(0.5); }).not.toThrow();
    expect(rig!.dashes(1)).toBe(false);
    expect(rig!.dashes(99)).toBe(true);
  });
});
