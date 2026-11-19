// The first visual kit: flat-shaded low-poly pieces in the palette of
// docs/design.md, under a low amber sun. Simple and consistent beats detailed.
//
// A kit is made per board (lowpolyKit()), because its sun follows the tiles
// it has been asked for: the shadow area grows to cover the map.

import * as THREE from 'three';
import { hexToPixel } from '../../../../shared/hex';
import type { VisualKit } from '../../kit';
import { TOKENS } from './parts';
import { tile } from './tiles';
import { unit } from './units';
import { mark, objective } from './marks';
import { effect } from './effects';

export { loadKitFonts } from './parts';

// Where the sun stands: low in the north-west, as on a shaded relief map.
// Faces turned to the viewer are in shade, so each step of a hill shows as a
// dark band, and shadows fall long towards the lower right.
const SUN_DIRECTION = new THREE.Vector3(-1, 0.7, -0.5).normalize();
const SUN_DISTANCE = 60;

const mix = (a: string, b: string, t: number): THREE.Color => new THREE.Color(a).lerp(new THREE.Color(b), t);

export function lowpolyKit(): VisualKit {
  let sun: THREE.DirectionalLight | null = null;
  const reach = new THREE.Box3();
  const markers = new Map<string, THREE.Object3D>();   // objective markers made, for `score`

  /** Aim the sun and its shadow at everything built so far. */
  function aimSun(): void {
    if (!sun || reach.isEmpty()) return;
    const sphere = reach.getBoundingSphere(new THREE.Sphere());
    const r = sphere.radius + 3;
    sun.target.position.copy(sphere.center);
    sun.position.copy(sphere.center).addScaledVector(SUN_DIRECTION, SUN_DISTANCE);
    const cam = sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 1; cam.far = SUN_DISTANCE + r;
    cam.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  }

  return {
    tokens: { ...TOKENS },

    environment(scene) {
      scene.background = new THREE.Color(TOKENS.slate);
      // Cold light from the sky fills the shadows with slate.
      scene.add(new THREE.HemisphereLight(mix(TOKENS.slate, TOKENS.paper, 0.75), mix(TOKENS.slate, TOKENS.khaki, 0.55), 2.85));
      sun = new THREE.DirectionalLight(mix(TOKENS.amber, TOKENS.paper, 0.6), 3.4);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.02;
      sun.shadow.radius = 3;
      sun.shadow.intensity = 0.55;   // soft: a shadow must never hide a hex
      scene.add(sun, sun.target);
      aimSun();
      // Mist lies in the low ground: thin slate layers that hills, houses
      // and men rise out of. Slate is also the background, so the sheets
      // have no visible edge.
      const sheet = new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2);
      const haze = new THREE.MeshBasicMaterial({
        color: TOKENS.slate, transparent: true, opacity: 0.05, depthWrite: false,
      });
      for (const y of [0.03, 0.14, 0.26]) {
        const layer = new THREE.Mesh(sheet, haze);
        layer.position.y = y;
        layer.renderOrder = 2;
        scene.add(layer);
      }
    },

    tile(terrain, elevation, hex) {
      const p = hexToPixel(hex, 1);
      reach.expandByPoint(new THREE.Vector3(p.x, 0, p.y));
      aimSun();
      return tile(terrain, elevation, hex);
    },

    unit,
    mark,

    objective(obj) {
      const marker = objective(obj);
      markers.set(obj.id, marker);
      return marker;
    },

    effect: (event, ctx) => effect(event, ctx, markers),

    fog() {
      return new THREE.MeshBasicMaterial({
        color: TOKENS.slate, transparent: true, opacity: 0.78, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      });
    },
  };
}
