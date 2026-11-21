// The diorama's one tile: open ground. A hex prism of turf over earth (the detail is in the ground
// material's shader, in world space, so it runs on from hex to hex without a seam), with tufts of grass and
// a few stones scattered by the hex's own random stream. On it, drawn: the hex grid, the contour rings and
// the stencilled label, in paper so that they read on dark ground.

import * as THREE from 'three';
import type { Hex } from '../../../../shared/types';
import { label } from '../../../../shared/hex';
import { TOKENS, layFlat, text } from '../lowpoly/parts';
import type { Look } from './look';
import { hexStream } from './noise';

const LEVEL = 0.5;
const DEPTH = 0.6;     // how far every prism reaches below level-0 ground, as lowpoly's
/** Phones: tufts of grass a hex (three blades each, one draw call a hex, no shadow cast). 0 turns them off. */
export const TUFTS = 64;

// A corner points along z: a pointy-top hex.
const corner = (i: number, r = 1): [number, number] => [r * Math.sin((i * Math.PI) / 3), r * Math.cos((i * Math.PI) / 3)];

const gridLine = new THREE.LineBasicMaterial({ color: TOKENS.paper, transparent: true, opacity: 0.3, toneMapped: false });
const contourLine = new THREE.LineBasicMaterial({ color: TOKENS.paper, transparent: true, opacity: 0.4, toneMapped: false });

const prisms = new Map<number, { body: THREE.BufferGeometry; edges: THREE.BufferGeometry }>();
function prism(elevation: number): { body: THREE.BufferGeometry; edges: THREE.BufferGeometry } {
  let p = prisms.get(elevation);
  if (p) return p;
  const top = elevation * LEVEL;
  const position: number[] = [];
  const normal: number[] = [];
  const depth: number[] = [];
  const lines: number[] = [];
  for (let i = 0; i < 6; i++) {
    const [ax, az] = corner(i);
    const [bx, bz] = corner(i + 1);
    // The top: a fan round the centre.
    position.push(0, top, 0, ax, top, az, bx, top, bz);
    normal.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    depth.push(0, 0, 0);
    // One side: its own flat normal, and how far each corner is below the turf.
    const [nx, nz] = corner(i + 0.5);
    position.push(ax, top, az, ax, -DEPTH, az, bx, -DEPTH, bz, ax, top, az, bx, -DEPTH, bz, bx, top, bz);
    for (let v = 0; v < 6; v++) normal.push(nx, 0, nz);
    depth.push(0, top + DEPTH, top + DEPTH, 0, top + DEPTH, 0);
    // The grid: the rim of the top, and the edge of each step down to level-0 ground.
    lines.push(ax, top + 0.004, az, bx, top + 0.004, bz);
    if (elevation > 0) lines.push(ax, top, az, ax, 0, az);
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  body.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  body.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  p = { body, edges };
  prisms.set(elevation, p);
  return p;
}

const contours = new Map<number, THREE.BufferGeometry>();
function contour(radius: number): THREE.BufferGeometry {
  let g = contours.get(radius);
  if (!g) {
    g = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 6 }, (_, i) => new THREE.Vector3(corner(i, radius)[0], 0, corner(i, radius)[1])),
    );
    contours.set(radius, g);
  }
  return g;
}

/** Is (x, z) inside a hex of this circumradius, corner along z? */
function inHex(x: number, z: number, r: number): boolean {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  return ax <= (Math.sqrt(3) / 2) * r && az <= r - ax / Math.sqrt(3);
}

const BLADE = [new THREE.Color('#566a34'), new THREE.Color('#84804f'), new THREE.Color('#3a4a27')];   // lush, dry, dark
const STONE = new THREE.Color('#77766c');

/**
 * The tufts and stones of one hex, as one geometry: clumps of three-bladed tufts, thicker in some hexes
 * than others, and up to three stones. Every number comes from the hex's stream.
 */
export function scatter(hex: Hex, count = TUFTS): THREE.BufferGeometry {
  const rnd = hexStream(hex);
  const position: number[] = [];
  const color: number[] = [];
  const surface: number[] = [];
  const tint = new THREE.Color();
  const tri = (a: number[], b: number[], c: number[], ca: THREE.Color, cb: THREE.Color, cc: THREE.Color, rough: number) => {
    // Both faces: a blade is seen from either side, and both are lit as the ground is (normals up).
    position.push(...a, ...b, ...c, ...a, ...c, ...b);
    color.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b, ca.r, ca.g, ca.b, cc.r, cc.g, cc.b, cb.r, cb.g, cb.b);
    for (let i = 0; i < 6; i++) surface.push(rough, 0);
  };
  // Where on the hex: clear of the label at the far corner.
  const spot = (cx: number, cz: number, spread: number): [number, number] | null => {
    for (let tries = 0; tries < 6; tries++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * spread;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (inHex(x, z, 0.93) && !(Math.abs(x) < 0.4 && z < -0.44)) return [x, z];
    }
    return null;
  };

  const clumps: [number, number][] = [];
  const nClumps = 5 + Math.floor(rnd() * 5);
  for (let i = 0; i < nClumps; i++) {
    const at = spot(0, 0, 0.95);
    if (at) clumps.push(at);
  }
  const n = Math.round(count * (0.6 + rnd() * 0.8));
  for (let i = 0; i < n && clumps.length > 0; i++) {
    const [cx, cz] = clumps[Math.floor(rnd() * clumps.length)];
    const at = spot(cx, cz, 0.08 + rnd() * 0.2);
    if (!at) continue;
    const [x, z] = at;
    // Short where a base will stand (it is 0.07 high), so that no blade comes up through it.
    const height = Math.hypot(x, z) < 0.68 ? 0.03 + rnd() * 0.025 : 0.045 + rnd() * 0.06;
    const dryness = rnd();
    for (let b = 0; b < 3; b++) {
      const turn = rnd() * Math.PI;
      const lean = (rnd() - 0.5) * 0.09;
      const w = 0.011 + rnd() * 0.009;
      const h = height * (0.7 + rnd() * 0.45);
      const dx = Math.cos(turn) * w;
      const dz = Math.sin(turn) * w;
      tint.copy(BLADE[0]).lerp(BLADE[1], dryness * (0.5 + rnd() * 0.5));
      const root = tint.clone().lerp(BLADE[2], 0.75);
      const tip = tint.clone().multiplyScalar(1.15 + rnd() * 0.25);
      tri([x - dx, 0, z - dz], [x + dx, 0, z + dz], [x + lean - dz * 2, h, z + lean * 0.6 + dx * 2], root, root, tip, 0.85);
    }
  }
  const stones = Math.floor(rnd() * 3.4);
  for (let i = 0; i < stones; i++) {
    const at = spot(0, 0, 0.9);
    if (!at) continue;
    const [x, z] = at;
    const r = 0.022 + rnd() * 0.03;
    const squash = 0.45 + rnd() * 0.3;
    const turn = rnd() * Math.PI;
    const shade = STONE.clone().multiplyScalar(0.7 + rnd() * 0.5);
    const dark = shade.clone().multiplyScalar(0.55);
    const rim = [0, 1, 2, 3, 4].map((j) => {
      const a = turn + (j / 5) * Math.PI * 2;
      const rr = r * (0.75 + rnd() * 0.5);
      return [x + Math.cos(a) * rr, 0, z + Math.sin(a) * rr];
    });
    const peak = [x + (rnd() - 0.5) * r * 0.5, r * squash, z + (rnd() - 0.5) * r * 0.5];
    for (let j = 0; j < 5; j++) tri(rim[j], peak, rim[(j + 1) % 5], dark, shade, dark, 0.7);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setAttribute('aSurface', new THREE.Float32BufferAttribute(surface, 2));
  // Lit as the ground they grow from, not as slivers facing every way.
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(position.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

/** Open ground at a level. */
export function openTile(look: Look, elevation: number, hex: Hex): THREE.Object3D {
  const level = Number.isFinite(elevation) ? Math.max(0, elevation) : 0;
  const top = level * LEVEL;
  const tile = new THREE.Group();
  const { body, edges } = prism(level);
  const mesh = new THREE.Mesh(body, look.ground);
  mesh.receiveShadow = true;
  mesh.castShadow = level > 0;
  tile.add(mesh, new THREE.LineSegments(edges, gridLine));

  if (TUFTS > 0) {
    const growth = new THREE.Mesh(scatter(hex), look.blades);
    growth.position.y = top;
    growth.receiveShadow = true;
    growth.name = 'growth';
    tile.add(growth);
  }

  // Contour rings, as on a printed map: one per level.
  for (let ring = 1; ring <= Math.min(2, level); ring++) {
    const loop = new THREE.LineLoop(contour(ring === 1 ? 0.84 : 0.68), contourLine);
    loop.position.y = top + 0.006;
    tile.add(loop);
  }

  // The label, as lowpoly places it: at the far corner, where no hill in front can cover it.
  const name = text(label(hex), 0.44, TOKENS.paper, 0.72);
  if (name) {
    layFlat(name.geometry);
    (name.material as THREE.Material).toneMapped = false;
    name.position.set(0, top + 0.008, -0.7);
    tile.add(name);
  }
  return tile;
}
