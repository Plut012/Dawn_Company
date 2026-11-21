// Kit selection, and the diorama kit's promises that can be checked without a screen.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { kitFromUrl, makeKit } from './index';
import { dioramaKit } from './diorama';
import { lowpolyKit } from './lowpoly';
import { rigOf } from './lowpoly/units';
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

  it('hands woods and the gunner to lowpoly: the same shapes', () => {
    const kit = dioramaKit();
    const low = lowpolyKit();
    const hex = { q: 3, r: 2 };
    expect(shape(kit.tile('woods', 1, hex))).toEqual(shape(low.tile('woods', 1, hex)));
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
