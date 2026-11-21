// The diorama kit (26): a trial of another direction. "The world is real, the information is drawn."
//
// It makes these itself: the light and air (environment, light, renderer, fog), open ground, woods and
// buildings (27), and the rifleman. Everything else it asks of a lowpoly kit it holds, call by call, and then dresses for this
// light (look.dress): lit parts sink into the mist, drawn parts keep the palette's colours.
//
// A kit is made per board, as lowpoly's is: its sun follows the tiles asked for, its air that board's dawn.

import * as THREE from 'three';
import { hexToPixel } from '../../../../shared/hex';
import type { KitCtx, VisualKit } from '../../kit';
import { lowpolyKit } from '../lowpoly';
import { createLook } from './look';
import type { Lights } from './look';
import { buildingTile, openHouse } from './buildings';
import { openTile } from './tiles';
import { woodsTile } from './woods';
import { base, rifleman } from './units';

/** Phones: the side of the sun's one shadow map, in texels (lowpoly's is 2048). */
export const SHADOW_MAP = 2048;
/** Phones: a small sky is rendered once, when the board is made, so that damp grass and steel have something to reflect. */
export const SKY_REFLECTION = true;
/** ACES: deep blacks and a soft shoulder, so the low sun at full day does not burn out the turf it lights. */
const TONE_MAPPING = THREE.ACESFilmicToneMapping;

const SUN_DISTANCE = 60;

/** A plain overcast sky to reflect: paler at the horizon, dark below it. Rendered once into the scene's environment. */
function skyReflection(renderer: THREE.WebGLRenderer): THREE.Texture {
  const sky = new THREE.Scene();
  const dome = new THREE.SphereGeometry(10, 24, 12);
  const at = dome.getAttribute('position');
  const colors: number[] = [];
  const high = new THREE.Color('#5d7186');
  const horizon = new THREE.Color('#c3ccd2');
  const below = new THREE.Color('#1b1d1a');
  const c = new THREE.Color();
  for (let i = 0; i < at.count; i++) {
    const up = at.getY(i) / 10;
    if (up >= 0) c.copy(horizon).lerp(high, Math.min(1, up * 1.6));
    else c.copy(horizon).lerp(below, Math.min(1, -up * 6));
    colors.push(c.r, c.g, c.b);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  sky.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const maker = new THREE.PMREMGenerator(renderer);
  const texture = maker.fromScene(sky, 0.04).texture;
  maker.dispose();
  dome.dispose();
  return texture;
}

export function dioramaKit(): VisualKit {
  const lowpoly = lowpolyKit();
  const look = createLook();
  let renderer: THREE.WebGLRenderer | null = null;
  let lights: Lights | null = null;
  let stage: THREE.Scene | null = null;       // where lowpoly's effects put their props
  const reach = new THREE.Box3();
  let seed = 0;                               // from the hexes asked for: the same map, the same banks of mist
  let covered = '';                           // the ground the mist was last laid over
  const flags: THREE.Object3D[] = [];         // objective markers handed out: an effect may give one new cloth

  /** Aim the sun and its shadow at everything built so far. */
  function aimSun(): void {
    if (!lights || reach.isEmpty()) return;
    const { sun, sunDirection } = lights;
    const sphere = reach.getBoundingSphere(new THREE.Sphere());
    const r = sphere.radius + 3;
    sun.target.position.copy(sphere.center);
    sun.position.copy(sphere.center).addScaledVector(sunDirection, SUN_DISTANCE);
    const cam = sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 1; cam.far = SUN_DISTANCE + r;
    cam.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  }

  return {
    tokens: lowpoly.tokens,

    renderer(r) {
      renderer = r;
      r.toneMapping = TONE_MAPPING;
      r.shadowMap.type = THREE.PCFShadowMap;
    },

    environment(scene) {
      const sky = new THREE.HemisphereLight();
      const sun = new THREE.DirectionalLight();
      sun.castShadow = true;
      sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
      sun.shadow.bias = -0.0005;
      sun.shadow.normalBias = 0.025;
      sun.shadow.radius = 2.5;
      scene.add(sky, sun, sun.target);
      lights = { sun, sky, sunDirection: new THREE.Vector3(-1, 0.33, -0.22).normalize() };
      if (renderer && SKY_REFLECTION) scene.environment = skyReflection(renderer);

      // The board stands in a sea of mist: one plane under it, in the mist every world material shares.
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), look.sea);
      sea.position.y = -0.58;
      scene.add(sea);

      // Effects are lowpoly's, and drawn: what they add to the scene is kept out of the tone mapping.
      stage = new THREE.Scene();
      const add = stage.add.bind(stage);
      stage.add = (...objects: THREE.Object3D[]) => add(...objects.map((o) => look.dressLive(o)));
      scene.add(stage, look.mist);

      look.air(scene, lights, renderer, 1);    // environment() is the full-day look
      aimSun();
    },

    light(scene, dawn) {
      // The board asks for the light once its tiles are built: lay the mist over them if they have changed.
      const ground = `${reach.min.x},${reach.min.z},${reach.max.x},${reach.max.z},${seed}`;
      if (ground !== covered) { covered = ground; look.cover(reach, seed); }
      look.air(scene, lights, renderer, dawn);
      aimSun();
    },

    tile(terrain, elevation, hex) {
      const p = hexToPixel(hex, 1);
      if (!reach.containsPoint(new THREE.Vector3(p.x, 0, p.y))) seed = (Math.imul(seed ^ (hex.q * 31 + hex.r), 2654435761) >>> 0) % 100003;
      reach.expandByPoint(new THREE.Vector3(p.x, 0, p.y));
      aimSun();
      if (terrain === 'open') return openTile(look, elevation, hex);
      if (terrain === 'woods') return woodsTile(look, elevation, hex);
      if (terrain === 'building') return buildingTile(look, elevation, hex);
      return look.dress(lowpoly.tile(terrain, elevation, hex));
    },

    unit(type, owner) {
      if (type === 'rifleman') return rifleman(look, owner);
      const made = lowpoly.unit(type, owner);
      // One set of bases: lowpoly's lit base (the first thing in its unit) gives way to the diorama's drawn one.
      const lit = made.object.children[0];
      if (lit) { made.object.remove(lit); made.object.add(base(look, owner)); }
      look.dress(made.object);
      return {
        object: made.object,
        // Lowpoly gives a figure its own materials back with every status: dress it again.
        setStatus(s) { made.setStatus(s); look.dress(made.object); },
        setDugIn: made.setDugIn ? (dug) => { made.setDugIn!(dug); } : undefined,
      };
    },

    mark: (mark, ctx) => look.dress(lowpoly.mark(mark, ctx)),
    objective(obj, owner) {
      const marker = look.dress(lowpoly.objective(obj, owner));
      flags.push(marker);
      if (flags.length > 64) flags.shift();
      return marker;
    },
    fog: () => look.veil(),

    // (27) A house's roof and front wall come off while somebody the board shows is inside. Other tiles take no notice.
    occupied: (tile, occupied) => openHouse(tile, occupied),

    effect(event, ctx) {
      const on: KitCtx = stage ? { ...ctx, scene: stage } : ctx;
      if (!lowpoly.effect) return Promise.resolve();
      // A capture gives a marker new cloth in lowpoly's own materials: dress the markers again after it.
      return lowpoly.effect(event, on).finally(() => { if (event.t === 'capture') flags.forEach((f) => look.dress(f)); });
    },
  };
}
