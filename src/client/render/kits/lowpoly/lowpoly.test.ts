// The kit's promises that can be checked without a screen: everything it is
// asked for comes back as an object, known id or not.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { lowpolyKit } from './index';
import { MAPS, DEFAULT_MAP, TERRAIN, UNITS } from '../../../../content';
import { hexToPixel, key, parseKey } from '../../../../shared/hex';
import type { GameEvent, Hex, Unit, UnitStatus } from '../../../../shared/types';
import type { KitCtx } from '../../kit';
import type { Mark } from '../../index';

const map = MAPS[DEFAULT_MAP];
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
    expect(meshes(kit.objective(map.objectives[0]))).toBeGreaterThan(0);
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
    scene.add(man.object, peg.object, kit.objective(map.objectives[0]));
    const stage: KitCtx = { ...ctx, scene, unitObject: (id) => (id === '0-0' ? man.object : id === '1-0' ? peg.object : null) };
    const before = scene.children.length;
    const materials = new Map<THREE.Mesh, unknown>();
    man.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) materials.set(o as THREE.Mesh, (o as THREE.Mesh).material); });
    const spotted: Unit = { id: '0-0', owner: 0, type: 'rifleman', name: 'x', pos: from, status: 'ready', pinnedRound: null, revealed: false, posture: 'still' };
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
      // an action this kit has no look for, and one it has never heard of: drawn plain
      { t: 'fire', unit: '0-0', from, target: { q: 5, r: 3 }, blast: 0, ambush: false, action: 'no such action' },
      { t: 'launch', unit: '0-0', from, action: 'no such action' },
      { t: 'impact', target: { q: 4, r: 4 }, blast: 0, action: 'no such action' },
      { t: 'treat', unit: '1-0', target: '0-0', action: 'no such action' },
      { t: 'reveal', unit: '0-0', action: 'no such action' },
      { t: 'reveal', unit: 'nobody', action: 'aid' },
      { t: 'score', objective: map.objectives[0].id, player: 0, value: 2 },
      { t: 'score', objective: 'no such objective', player: 0, value: 1 },
      { t: 'eliminated', player: 1 },
      { t: 'over', scores: [1, 0], winners: [0] },
    ];
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
