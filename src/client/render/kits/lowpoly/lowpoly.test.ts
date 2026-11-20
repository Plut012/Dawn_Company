// The kit's promises that can be checked without a screen: everything it is
// asked for comes back as an object, known id or not.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { lowpolyKit } from './index';
import { MAPS, mapFor, TERRAIN, UNITS } from '../../../../content';
import { hexToPixel, key, parseKey } from '../../../../shared/hex';
import type { GameEvent, Hex, Unit, UnitStatus } from '../../../../shared/types';
import type { KitCtx } from '../../kit';
import type { Mark } from '../../index';
import { TOKENS } from './parts';

const map = mapFor(4);
const ctx: KitCtx = {
  scene: new THREE.Scene(),
  hexToWorld(hex: Hex) {
    const p = hexToPixel(hex, 1);
    return new THREE.Vector3(p.x, (map.cells[key(hex)]?.elevation ?? 0) * 0.5, p.y);
  },
  unitObject: () => null,
};

const meshes = (o: THREE.Object3D): number => {
  let n = 0;
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) n++; });
  return n;
};

describe('lowpoly kit', () => {
  it('uses only the design palette', () => {
    const { tokens } = lowpolyKit();
    expect(tokens.ink).toBe('#1E2420');
    expect(tokens.amber).toBe('#E8A23A');
    expect(tokens.hill2).toBe('#D5C9A4');
    expect(tokens.teal).toBe('#2F7F78');
  });

  it('builds every tile of the real map with its top at the right height', () => {
    const kit = lowpolyKit();
    for (const k of Object.keys(map.cells)) {
      const cell = map.cells[k];
      const tile = kit.tile(cell.terrain, cell.elevation, parseKey(k));
      const box = new THREE.Box3();
      tile.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh && Array.isArray(m.material)) box.expandByObject(m);   // the ground prism
      });
      expect(box.max.y).toBeCloseTo(cell.elevation * 0.5, 5);
      expect(box.max.x).toBeCloseTo(Math.sqrt(3) / 2, 5);   // pointy-top: flat sides east and west
      expect(box.max.z).toBeCloseTo(1, 5);
    }
  });

  it('builds every terrain and unit in the content', () => {
    const kit = lowpolyKit();
    for (const id of Object.keys(TERRAIN)) expect(meshes(kit.tile(id, 1, { q: 0, r: 0 }))).toBeGreaterThan(0);
    for (const id of Object.keys(UNITS)) {
      for (let owner = 0; owner < 4; owner++) {
        const v = kit.unit(id, owner);
        expect(meshes(v.object)).toBeGreaterThan(5);
        for (const s of ['pinned', 'down', 'ready'] as UnitStatus[]) v.setStatus(s);
      }
    }
  });

  it('gives a plain placeholder for ids it does not know', () => {
    const kit = lowpolyKit();
    expect(meshes(kit.tile('marsh', 0, { q: 0, r: 0 }))).toBe(1);
    expect(meshes(kit.tile('marsh', Number.NaN, { q: 0, r: 0 }))).toBe(1);
    const peg = kit.unit('tank', 7);          // unknown type and unknown seat
    expect(meshes(peg.object)).toBeGreaterThan(0);
    for (const s of ['pinned', 'down', 'ready'] as UnitStatus[]) peg.setStatus(s);
    expect(() => kit.unit('constructor', 0).setStatus('pinned')).not.toThrow();
  });

  it('draws every kind of mark, on and off the map', () => {
    const kit = lowpolyKit();
    const a = { q: 2, r: 2 }, b = { q: 3, r: 2 }, off = { q: -9, r: -9 };
    const marks: Mark[] = [
      { kind: 'select', hex: a },
      { kind: 'path', from: a, path: [b, { q: 4, r: 2 }], dash: false },
      { kind: 'path', from: { q: 2, r: 5 }, path: [{ q: 3, r: 5 }, { q: 4, r: 5 }], dash: true },   // up the hill
      { kind: 'path', from: a, path: [], dash: false },
      { kind: 'target', from: a, hex: { q: 5, r: 3 }, blast: 1 },
      { kind: 'target', from: a, hex: off, blast: 0 },
      { kind: 'ambush', hex: a },
      { kind: 'options', hexes: [a, b, off] },
      { kind: 'options', hexes: [] },
    ];
    for (const m of marks) expect(kit.mark(m, ctx)).toBeInstanceOf(THREE.Object3D);
    expect(meshes(kit.mark(marks[0], ctx))).toBeGreaterThan(0);
    expect(kit.mark({ kind: 'nonsense' } as unknown as Mark, ctx)).toBeInstanceOf(THREE.Object3D);
  });

  it('builds objectives, fog and the environment', () => {
    const kit = lowpolyKit();
    const scene = new THREE.Scene();
    kit.environment(scene);
    expect(scene.children.some((c) => (c as THREE.DirectionalLight).isDirectionalLight)).toBe(true);
    expect(meshes(kit.objective(map.objectives[0], null))).toBeGreaterThan(0);
    const fog = kit.fog();
    expect(fog.transparent).toBe(true);
    expect(fog.opacity).toBeCloseTo(0.78);
  });

  it('plays an effect for every event, leaves nothing behind, and ends each unit where the board will put it', async () => {
    const kit = lowpolyKit();
    const scene = new THREE.Scene();
    const from = { q: 2, r: 5 }, to = { q: 3, r: 5 };   // up the hill
    const man = kit.unit('rifleman', 0);
    const peg = kit.unit('tank', 1);
    man.object.position.copy(ctx.hexToWorld(from));
    const marker = kit.objective(map.objectives[0], null);
    scene.add(man.object, peg.object, marker);
    const stage: KitCtx = { ...ctx, scene, unitObject: (id) => (id === '0-0' ? man.object : id === '1-0' ? peg.object : null) };
    const before = scene.children.length;
    const materials = new Map<THREE.Mesh, unknown>();
    man.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) materials.set(o as THREE.Mesh, (o as THREE.Mesh).material); });
    const spotted: Unit = { id: '0-0', owner: 0, type: 'rifleman', name: 'x', pos: from, status: 'ready', pinnedRound: null, revealed: false, posture: 'still', returnRound: null, dugIn: false };
    const events: GameEvent[] = [
      { t: 'phase', phase: 'fire' },
      { t: 'fire', unit: '0-0', from, target: { q: 5, r: 3 }, blast: 0, ambush: false, action: 'rifle' },
      { t: 'fire', unit: '0-0', from, target: { q: 5, r: 3 }, blast: 1, ambush: true, action: 'burst' },
      { t: 'fire', unit: null, from: null, target: from, blast: 0, ambush: false, action: 'rifle' },
      { t: 'launch', unit: '0-0', from, action: 'shell' },
      { t: 'impact', target: { q: 0, r: 0 }, blast: 1, action: 'shell' },          // partly off the map
      { t: 'hit', unit: '0-0', at: from, result: 'cover' },
      { t: 'hit', unit: 'nobody', at: from, result: 'down' },
      { t: 'hit', unit: '1-0', at: from, result: 'pinned' },      // a unit of unknown type
      { t: 'blocked', unit: '0-0', at: from },
      { t: 'blocked', unit: 'nobody', at: from },
      { t: 'spotted', unit: spotted },
      { t: 'treat', unit: '1-0', target: '0-0', action: 'aid' },
      { t: 'recover', unit: 'nobody' },
      { t: 'dig', unit: '0-0' },
      { t: 'dig', unit: 'nobody' },
      { t: 'dig', unit: '1-0' },      // a unit of unknown type
      // an action this kit has no look for, and one it has never heard of: drawn plain
      { t: 'fire', unit: '0-0', from, target: { q: 5, r: 3 }, blast: 0, ambush: false, action: 'no such action' },
      { t: 'launch', unit: '0-0', from, action: 'no such action' },
      { t: 'impact', target: { q: 4, r: 4 }, blast: 0, action: 'no such action' },
      { t: 'treat', unit: '1-0', target: '0-0', action: 'no such action' },
      { t: 'reveal', unit: '0-0', action: 'no such action' },
      { t: 'reveal', unit: 'nobody', action: 'aid' },
      { t: 'capture', objective: map.objectives[0].id, player: 1, from: null },
      { t: 'capture', objective: 'no such objective', player: 0, from: 1 },
      { t: 'score', objective: map.objectives[0].id, player: 0, value: 2 },
      { t: 'score', objective: 'no such objective', player: 0, value: 1 },
      { t: 'eliminated', player: 1 },
      { t: 'over', scores: [1, 0], winners: [0] },
    ];
    expect(man.setDugIn).toBeTypeOf('function');
    await Promise.all(events.map((e) => kit.effect!(e, stage)));
    expect(scene.children.length).toBe(before);
    for (const [mesh, material] of materials) expect(mesh.material).toBe(material);

    // A move ends on the hex; a hit ends in the pose the status gives.
    await kit.effect!({ t: 'move', step: 1, unit: '0-0', from, to }, stage);
    expect(man.object.position.distanceTo(ctx.hexToWorld(to))).toBeLessThan(1e-9);
    await kit.effect!({ t: 'move', step: 3, unit: '0-0', from: to, to: from }, stage);   // a dash step, downhill
    expect(man.object.position.distanceTo(ctx.hexToWorld(from))).toBeLessThan(1e-9);
    const near = (n: number[]) => n.map((x) => x.toFixed(6));
    const pose = () => JSON.stringify(man.object.children.map((c) => [
      c.visible, near(c.position.toArray()), near(c.quaternion.toArray()), near(c.scale.toArray()),
    ]));
    const standing = pose();
    for (const result of ['pinned', 'down'] as const) {
      await kit.effect!({ t: 'hit', unit: '0-0', at: from, result }, stage);
      const shown = pose();
      man.setStatus(result);
      expect(pose()).toBe(shown);
    }
    man.setStatus('pinned');
    await kit.effect!({ t: 'recover', unit: '0-0' }, stage);
    const stood = pose();
    man.setStatus('ready');
    expect(pose()).toBe(stood);
    expect(stood).toBe(standing);
    await kit.effect!({ t: 'lost', unit: '0-0' }, stage);
    expect(man.object.visible).toBe(false);
    expect(scene.children.length).toBe(before);
  });
});

describe('the foxhole (24)', () => {
  // The sandbags are the one child of a unit's object that is a group of eleven meshes and begins hidden.
  const bagsOf = (object: THREE.Object3D) => object.children.find((c) => c.children.length === 11)!;
  const kit = lowpolyKit();

  it('shows a ring of eleven sandbags when dug in, none when not', () => {
    for (const type of ['rifleman', 'gunner', 'sniper', 'mortar', 'medic', 'no such type']) {
      const man = kit.unit(type, 1);
      const bags = bagsOf(man.object);
      expect(bags.visible).toBe(false);
      man.setDugIn!(true);
      expect(bags.visible).toBe(true);
      expect(bags.scale.y).toBe(1);
      man.setDugIn!(false);
      expect(bags.visible).toBe(false);
    }
  });

  it('keeps the ring inside the hex and low enough to see over', () => {
    const man = kit.unit('rifleman', 0);
    man.setDugIn!(true);
    const box = new THREE.Box3().setFromObject(bagsOf(man.object));
    expect(Math.max(box.max.x, box.max.z, -box.min.x, -box.min.z)).toBeLessThan(0.866);
    expect(box.max.y).toBeLessThan(0.3);
  });

  it('a `dig` effect ends with the ring as `setDugIn(true)` leaves it, and a down man shows none', async () => {
    const man = kit.unit('rifleman', 0);
    const scene = new THREE.Scene();
    scene.add(man.object);
    const stage: KitCtx = { ...ctx, scene, unitObject: () => man.object };
    await kit.effect!({ t: 'dig', unit: '0-0' }, stage);
    const bags = bagsOf(man.object);
    expect([bags.visible, bags.scale.y]).toEqual([true, 1]);
    expect(scene.children.length).toBe(1);
  });
});

describe('objectives', () => {
  /** The colours of every flat-coloured mesh in the flag's cloth. */
  const clothColours = (o: THREE.Object3D) => {
    const out: string[] = [];
    (o.userData.sign as THREE.Object3D).traverse((m) => {
      const mat = (m as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if ((m as THREE.Mesh).isMesh && mat?.color) out.push(`#${mat.color.getHexString()}`);
    });
    return out;
  };

  it('washes every hex of the area, each tagged with its hex, and stands a flag on the middle one', () => {
    const kit = lowpolyKit();
    const hill = map.objectives.find((o) => o.kind === 'hill')!;
    const object = kit.objective(hill, null);
    const tagged = object.children.filter((c) => c.userData.hex);
    expect(tagged.map((c) => c.userData.hex)).toEqual([...hill.hexes, hill.hexes[1]]);
    expect(object.userData.flag.userData.hex).toEqual(hill.hexes[1]);
  });

  it('flies the owner\'s colour with their mark, plain bone for nobody, and an HQ\'s flag taller', () => {
    const kit = lowpolyKit();
    const village = map.objectives.find((o) => o.kind === 'village')!;
    const hq = map.objectives.find((o) => o.kind === 'hq')!;
    expect(clothColours(kit.objective(village, null))).toEqual([TOKENS.ink, TOKENS.bone].map((c) => c.toLowerCase()));
    const blue = clothColours(kit.objective(village, 0));
    expect(blue).toContain(TOKENS.blue.toLowerCase());
    expect(blue).toContain(TOKENS.paper.toLowerCase());    // the player mark
    expect(clothColours(kit.objective(village, 1))).toContain(TOKENS.plum.toLowerCase());
    const height = (o: THREE.Object3D) => (o.userData.sign as THREE.Object3D).position.y;
    expect(height(kit.objective(hq, 0))).toBeGreaterThan(height(kit.objective(village, 0)));
  });

  it('turns the cloth over to the new owner on a capture', async () => {
    const kit = lowpolyKit();
    const village = map.objectives.find((o) => o.kind === 'village')!;
    const object = kit.objective(village, 0);
    const scene = new THREE.Scene();
    scene.add(object);
    await kit.effect!({ t: 'capture', objective: village.id, player: 1, from: 0 }, { ...ctx, scene });
    expect(clothColours(object)).toContain(TOKENS.plum.toLowerCase());
    expect(clothColours(object)).not.toContain(TOKENS.blue.toLowerCase());
    expect(scene.children).toEqual([object]);
  });
});

describe('how an action looks', () => {
  it('has a look for every action in the data, by its icon, and draws anything else plain', async () => {
    const { LOOKS, lookFor } = await import('./effects');
    const { ACTIONS } = await import('../../../../content');
    for (const a of Object.values(ACTIONS)) expect(Object.keys(LOOKS), `no look for icon "${a.icon}"`).toContain(a.icon);
    const plain = lookFor('no such action');
    for (const part of ['fire', 'launch', 'impact', 'treat', 'reveal'] as const) expect(typeof plain[part]).toBe('function');
    // A look only replaces what it lists.
    expect(lookFor('aid').fire).toBe(plain.fire);
    expect(lookFor('shell').impact).toBe(LOOKS.shell.impact);
  });
});
