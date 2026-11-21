// The diorama's ground, and its open tile (woods.ts and buildings.ts stand their own things on the same ground).
// Open ground: A hex prism of turf over earth (the detail is in the ground
// material's shader, in world space, so it runs on from hex to hex without a seam), with tufts of grass and
// a few stones scattered by the hex's own random stream. On it, drawn: the hex grid, the contour rings and
// the stencilled label, in paper so that they read on dark ground.

import * as THREE from 'three';
import type { Hex } from '../../../../shared/types';
import type { Around } from '../../kit';
import { label } from '../../../../shared/hex';
import { TOKENS, layFlat, text } from '../lowpoly/parts';
import type { Look } from './look';
import { hexStream } from './noise';

export const LEVEL = 0.5;
const DEPTH = 0.6;     // how far every prism reaches below level-0 ground, as lowpoly's
/** Phones: tufts of grass a hex (three blades each, one draw call a hex, no shadow cast). 0 turns them off. */
export const TUFTS = 64;

// A corner points along z: a pointy-top hex.
const corner = (i: number, r = 1): [number, number] => [r * Math.sin((i * Math.PI) / 3), r * Math.cos((i * Math.PI) / 3)];

const gridLine = new THREE.LineBasicMaterial({ color: TOKENS.paper, transparent: true, opacity: 0.3, toneMapped: false });
const contourLine = new THREE.LineBasicMaterial({ color: TOKENS.paper, transparent: true, opacity: 0.4, toneMapped: false });

/** What lies on a hex's top: turf; a wood's floor (litter and moss, thinning to the rim); a yard of trodden earth. */
export type Floor = 'turf' | 'wood' | 'yard';
// The ground material's `aFloor` at the hex's middle and at its corners (look.ts reads it: above 0 a wood, below 0 a yard).
const FLOORS: Record<Floor, [number, number]> = { turf: [0, 0], wood: [1, 0.5], yard: [-1, -0.3] };

const prisms = new Map<string, { body: THREE.BufferGeometry; edges: THREE.BufferGeometry }>();
function prism(elevation: number, kind: Floor): { body: THREE.BufferGeometry; edges: THREE.BufferGeometry } {
  let p = prisms.get(`${elevation}/${kind}`);
  if (p) return p;
  const [middle, rim] = FLOORS[kind];
  const floor: number[] = [];
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
    floor.push(middle, rim, rim, 0, 0, 0, 0, 0, 0);
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
  body.setAttribute('aFloor', new THREE.Float32BufferAttribute(floor, 1));
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  p = { body, edges };
  prisms.set(`${elevation}/${kind}`, p);
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
export function inHex(x: number, z: number, r: number): boolean {
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

/** A unit's level, from what the board hands a kit. */
export const levelOf = (elevation: number): number => (Number.isFinite(elevation) ? Math.max(0, elevation) : 0);

/**
 * (28) A hex prism whose top carries a number that varies across it (`aEdge`): `rim` gives it at the six corners and
 * the six edge middles in turn (corner 0, edge 0, corner 1, ...; corner i is at angle 60 i from the south, edge i
 * lies between corners i and i + 1), `inner` on a ring 0.7 out, `middle` at the centre. The ground material reads
 * it as how much of a field is there (a headland where it falls to 0); the water material as how near the bank is.
 * `floor` is the ground material's `aFloor` over the whole top. `top` is the surface's height.
 */
export function ringedPrism(top: number, elevation: number, middle: number, inner: number, rim: number[], floor = 0): { body: THREE.BufferGeometry; edges: THREE.BufferGeometry } {
  const position: number[] = [];
  const normal: number[] = [];
  const depth: number[] = [];
  const edge: number[] = [];
  const floors: number[] = [];
  const lines: number[] = [];
  const at = (j: number, r: number): [number, number] => {      // rim point j of 12, at radius r of the hex's own
    const i = Math.floor(j / 2) % 6;
    const [ax, az] = corner(i, r);
    if (j % 2 === 0) return [ax, az];
    const [bx, bz] = corner(i + 1, r);
    return [(ax + bx) / 2, (az + bz) / 2];
  };
  const tri = (pts: [number, number, number][]) => {
    for (const [x, z, e] of pts) {
      position.push(x, top, z);
      normal.push(0, 1, 0);
      depth.push(0);
      edge.push(e);
      floors.push(floor);
    }
  };
  for (let j = 0; j < 12; j++) {
    const k = (j + 1) % 12;
    const [ax, az] = at(j, 0.7);
    const [bx, bz] = at(k, 0.7);
    const [cx, cz] = at(j, 1);
    const [dx, dz] = at(k, 1);
    tri([[0, 0, middle], [ax, az, inner], [bx, bz, inner]]);
    tri([[ax, az, inner], [cx, cz, rim[j]], [dx, dz, rim[k]]]);
    tri([[ax, az, inner], [dx, dz, rim[k]], [bx, bz, inner]]);
  }
  for (let i = 0; i < 6; i++) {
    const [ax, az] = corner(i);
    const [bx, bz] = corner(i + 1);
    const [nx, nz] = corner(i + 0.5);
    position.push(ax, top, az, ax, -DEPTH, az, bx, -DEPTH, bz, ax, top, az, bx, -DEPTH, bz, bx, top, bz);
    for (let v = 0; v < 6; v++) { normal.push(nx, 0, nz); edge.push(0); floors.push(0); }
    depth.push(0, top + DEPTH, top + DEPTH, 0, top + DEPTH, 0);
    lines.push(ax, top + 0.004, az, bx, top + 0.004, bz);
    if (elevation > 0) lines.push(ax, top, az, ax, 0, az);
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  body.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  body.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  body.setAttribute('aFloor', new THREE.Float32BufferAttribute(floors, 1));
  body.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  return { body, edges };
}

/**
 * (28) The rim numbers for `ringedPrism` from a hex's neighbours: `of(neighbour)` is the number across each edge
 * (edge i faces neighbour (i + 5) mod 6 of `neighbors()`' order); a corner takes the larger of its two edges'.
 */
export function rimFrom(around: Around | undefined, of: (n: Around[number]) => number): number[] {
  const across = Array.from({ length: 6 }, (_, i) => of(around?.[(i + 5) % 6] ?? null));
  return Array.from({ length: 12 }, (_, j) => {
    const i = Math.floor(j / 2);
    return j % 2 === 1 ? across[i] : Math.max(across[i], across[(i + 5) % 6]);
  });
}

/**
 * A tile from a ground prism and what is drawn on it: the grid, the contour rings, the tufts (`tufts` of them; 0
 * for none) and the stencilled label, `labelZ` from the middle (north is negative; null: no label on the ground,
 * the tile puts its own elsewhere). `surface` is where the label and contours lie, if not at the level's top.
 */
export function tileOn(
  look: Look, prismOf: { body: THREE.BufferGeometry; edges: THREE.BufferGeometry }, material: THREE.Material,
  elevation: number, hex: Hex, tufts: number, labelZ: number | null, surface?: number,
): THREE.Group {
  const level = levelOf(elevation);
  const top = surface ?? level * LEVEL;
  const tile = new THREE.Group();
  const mesh = new THREE.Mesh(prismOf.body, material);
  mesh.receiveShadow = true;
  mesh.castShadow = level > 0;
  mesh.name = 'ground';
  tile.add(mesh, new THREE.LineSegments(prismOf.edges, gridLine));

  if (tufts > 0) {
    const growth = new THREE.Mesh(scatter(hex, tufts), look.blades);
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

  const name = labelZ === null ? null : text(label(hex), 0.44, TOKENS.paper, 0.72);
  if (name && labelZ !== null) {
    layFlat(name.geometry);
    (name.material as THREE.Material).toneMapped = false;
    name.position.set(0, top + 0.008, labelZ);
    tile.add(name);
  }
  return tile;
}

/** The ground of a hex with one of the plain floors, and what is drawn on it (see `tileOn`). */
export function groundTile(look: Look, elevation: number, hex: Hex, kind: Floor, tufts: number, labelZ: number | null): THREE.Group {
  return tileOn(look, prism(levelOf(elevation), kind), look.ground, elevation, hex, tufts, labelZ);
}

/** Open ground at a level. The label as lowpoly places it: at the far corner, where no hill in front can cover it. */
export function openTile(look: Look, elevation: number, hex: Hex): THREE.Object3D {
  return groundTile(look, elevation, hex, 'turf', TUFTS, -0.7);
}
