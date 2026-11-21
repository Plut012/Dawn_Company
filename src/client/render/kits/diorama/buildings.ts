// The diorama's buildings (27): a Normandy farm, one whole house to a hex, with a roof that lifts off.
//
// The house fills the hex: its walls run round the rim (an eight-sided plan: long front and back, the gable
// ends at the sides, the corners cut along the hex's edges), its ridge runs east-west set back towards the
// north, so it is tallest at the back and its long front slope faces the camera. Three kinds, chosen by the
// hex so that no two neighbours are the same kind: a stone farmhouse under slate, a rendered barn under old
// tile with a cart door, and a cottage with a low boarded lean-to at one end. Each is then its own: mirrored
// or not, its own heights, stone, roof and shutter colour.
//
// It is two geometries. The *shell* always stands: the back and side walls inside and out, a sill where the
// front walls were, the floor, the hearth and the chimney. The *lid* is the roof and the front walls above
// the sill; it is shown while nobody the board shows is inside, and taken off while somebody is (the kit's
// `occupied` hook), leaving a clean cut-away, as a wargame table's houses have lift-off roofs. The label is
// stencilled on the front slope of the roof, and small on the ground at the hex's south point when the lid is off.
//
// Sight lines (the camera looks from the south, 55 degrees down: a thing y high hides the ground 0.7 y to its
// north): nothing of the house is so high so far north that it hides the mark of a man in the hex behind.
// The stones, render, slates, moss and streaks are drawn by the masonry material (look.ts) from each point's
// place on its wall or roof (`aMat`).

import * as THREE from 'three';
import type { Hex } from '../../../../shared/types';
import { label } from '../../../../shared/hex';
import { TOKENS, layFlat, text } from '../lowpoly/parts';
import type { Look } from './look';
import { hexStream } from './noise';
import { LEVEL, groundTile, levelOf } from './tiles';

const WALL = 0;       // aMat kinds, as look.ts reads them; a wall's fraction is how much render is left on it
const ROOF = 1;
const BOARDS = 2;
const PLAIN = 3;

const STONE = ['#b3a88f', '#bfae8e', '#a8a08f'];           // Caen stone, weathered: warm grey to buff
const SLATE = ['#5a626d', '#666a72'];
const TILE = ['#96593d', '#a06645'];                       // old clay tile, gone brown
const SHUTTER = ['#56707a', '#6b7458', '#7a5a4a', '#8a8a80'];   // faded blue, green, oxblood, grey
const TIMBER = '#5b4a3a';
const PLASTER = '#b9b2a0';                                 // the walls inside
const FLAGS = '#6f6a5f';                                   // a stone floor
const DARK = '#15171a';                                    // a window's glass, a hearth

// The plan: half the house's length and depth, and how far in from the hex's corners the cut corners lie.
const HALF_W = 0.76;
const HALF_D = 0.68;
const CUT = 0.95;          // the corners are cut along a hex of this circumradius
const THICK = 0.065;       // a wall's thickness
const SILL = 0.07;         // what is left of the front walls when the lid is off: as high as a unit's base
const RIDGE_Z = -0.2;      // the ridge is set back: the house is tallest towards the north
const SQRT3 = Math.sqrt(3);

const P = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Surfaces of a house, gathered into one geometry. */
class Mason {
  private position: number[] = [];
  private normal: number[] = [];
  private color: number[] = [];
  private surface: number[] = [];
  private mat: number[] = [];

  /**
   * A flat, convex face through `points` (anticlockwise seen from outside). u runs along `along` (the first
   * edge if not given) and v across it, in world units from `u0`, `v0`, so a pattern runs on round a corner.
   */
  poly(points: THREE.Vector3[], kind: number, paint: THREE.Color, rough: number, u0 = 0, v0 = 0, along?: THREE.Vector3): this {
    const [a, b] = points;
    const n = new THREE.Vector3();
    for (let i = 1; i + 1 < points.length; i++) {
      n.add(points[i].clone().sub(a).cross(points[i + 1].clone().sub(a)));
    }
    if (n.lengthSq() < 1e-12) return this;       // nothing to draw: a wall of no height
    n.normalize();
    const U = (along ?? b.clone().sub(a)).clone();
    U.addScaledVector(n, -U.dot(n)).normalize();
    const V = n.clone().cross(U);
    for (let i = 1; i + 1 < points.length; i++) {
      for (const p of [a, points[i], points[i + 1]]) {
        const rel = p.clone().sub(a);
        this.position.push(p.x, p.y, p.z);
        this.normal.push(n.x, n.y, n.z);
        this.color.push(paint.r, paint.g, paint.b);
        this.surface.push(rough, 0);
        this.mat.push(u0 + rel.dot(U), v0 + rel.dot(V), kind);
      }
    }
    return this;
  }

  /** A box from `lo` to `hi`, every face the same kind; no bottom. The pattern runs round its four sides. */
  box(lo: THREE.Vector3, hi: THREE.Vector3, kind: number, paint: THREE.Color, rough: number, top = kind, topPaint = paint): this {
    const [x0, x1] = [Math.min(lo.x, hi.x), Math.max(lo.x, hi.x)];
    const [y0, y1] = [Math.min(lo.y, hi.y), Math.max(lo.y, hi.y)];
    const [z0, z1] = [Math.min(lo.z, hi.z), Math.max(lo.z, hi.z)];
    const w = x1 - x0;
    const d = z1 - z0;
    this.poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], kind, paint, rough, 0);            // south
    this.poly([P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)], kind, paint, rough, w);            // east
    this.poly([P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)], kind, paint, rough, w + d);        // north
    this.poly([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], kind, paint, rough, 2 * w + d);    // west
    this.poly([P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)], top, topPaint, rough);
    return this;
  }

  /** The geometry; `mirror` -1 turns the house left for right (and every face the right way out again). */
  build(mirror: number): THREE.BufferGeometry {
    // Mirrored: x the other way, and each triangle's second and third corners changed over.
    const lay = (list: number[], size: number, negate: boolean): number[] => {
      if (mirror >= 0) return list;
      const out: number[] = [];
      for (let t = 0; t < list.length; t += 3 * size) {
        for (const corner of [0, 2, 1]) {
          for (let k = 0; k < size; k++) out.push(negate && k === 0 ? -list[t + corner * size + k] : list[t + corner * size + k]);
        }
      }
      return out;
    };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(lay(this.position, 3, true), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(lay(this.normal, 3, true), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(lay(this.color, 3, false), 3));
    g.setAttribute('aSurface', new THREE.Float32BufferAttribute(lay(this.surface, 2, false), 2));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(lay(this.mat, 3, false), 3));
    return g;
  }
}

/** The kind of house a hex has: its six neighbours all have another. 0 farmhouse, 1 barn, 2 cottage with a lean-to. */
export const kindOf = (hex: Hex): 0 | 1 | 2 => ((((hex.q + 2 * hex.r) % 3) + 3) % 3) as 0 | 1 | 2;

/** What a hex's house is like: every number its stream gives it. */
export interface Plan {
  kind: 0 | 1 | 2;
  mirror: 1 | -1;
  ridge: number; back: number; front: number;     // heights: the ridge, the back wall's top, the front wall's top
  lean: number | null;                            // the cottage: where (x, before mirroring) the low lean-to begins
}

export function planOf(hex: Hex): Plan {
  const rnd = hexStream(hex);
  const kind = kindOf(hex);
  const mirror = rnd() < 0.5 ? -1 : 1;
  const vary = () => (rnd() - 0.5) * 0.05;
  if (kind === 0) return { kind, mirror, ridge: 0.8 + vary(), back: 0.42, front: 0.32 + vary() * 0.6, lean: null };
  if (kind === 1) return { kind, mirror, ridge: 0.76 + vary(), back: 0.42, front: 0.4 + vary() * 0.6, lean: null };
  return { kind, mirror, ridge: 0.74 + vary(), back: 0.42, front: 0.33 + vary() * 0.6, lean: 0.34 + vary() };
}

interface Built { shell: THREE.BufferGeometry; lid: THREE.BufferGeometry; plan: Plan; slope: number }

/** The house of one hex: its shell and its lid, origin at the top centre of the hex. */
export function house(hex: Hex): Built {
  const plan = planOf(hex);
  const rnd = hexStream({ q: hex.q * 5 + 2, r: hex.r * 3 - 7 });     // its looks, apart from its plan
  const shell = new Mason();
  const lid = new Mason();
  const tone = 0.86 + rnd() * 0.3;
  const stone = new THREE.Color(STONE[Math.floor(rnd() * STONE.length)]).multiplyScalar(tone);
  const shutter = new THREE.Color(SHUTTER[Math.floor(rnd() * SHUTTER.length)]);
  const timber = new THREE.Color(TIMBER).multiplyScalar(0.8 + rnd() * 0.4);
  const roofPaint = plan.kind === 1
    ? new THREE.Color(TILE[Math.floor(rnd() * TILE.length)]).multiplyScalar(0.85 + rnd() * 0.3)
    : new THREE.Color(SLATE[Math.floor(rnd() * SLATE.length)]).multiplyScalar(0.9 + rnd() * 0.25);
  const render = plan.kind === 0 ? 0 : plan.kind === 1 ? 0.45 + rnd() * 0.3 : 0.6 + rnd() * 0.25;
  const plaster = new THREE.Color(PLASTER).multiplyScalar(0.85 + rnd() * 0.2);
  const pale = stone.clone().multiplyScalar(1.3);
  const dark = new THREE.Color(DARK);
  const hang = rnd();

  // Heights. The roof's underside over a point: two slopes from the ridge; the cottage's lean-to is a third,
  // falling away outwards from the height of the front wall, so it meets neither slope.
  const { ridge, back, front, lean } = plan;
  const profile = (z: number): number => (z >= RIDGE_Z
    ? ridge + ((z - RIDGE_Z) / (HALF_D - RIDGE_Z)) * (front - ridge)
    : ridge + ((RIDGE_Z - z) / (HALF_D + RIDGE_Z)) * (back - ridge));
  const leanTop = (x: number): number => front - ((x - (lean ?? 0)) / (HALF_W + 0.04 - (lean ?? 0))) * 0.12;
  const top = (x: number, z: number): number => (lean !== null && x > lean + 1e-6 ? Math.min(leanTop(x), profile(z)) : profile(z));
  const inLean = (x: number): boolean => lean !== null && x > lean + 1e-6;

  // The plan's corners, anticlockwise seen from above starting at the front left; then the walls between them,
  // cut where the roof changes over them (under the ridge; where the lean-to begins).
  const cx = (CUT - HALF_D) * SQRT3;           // where the front and back walls end and the cut corners begin
  const cz = CUT - HALF_W / SQRT3;
  const corners: [number, number][] = [[-cx, HALF_D], [cx, HALF_D], [HALF_W, cz], [HALF_W, -cz], [cx, -HALF_D], [-cx, -HALF_D], [-HALF_W, -cz], [-HALF_W, cz]];
  const inset = ([x, z]: [number, number]): [number, number] => [x * (1 - THICK / HALF_W), z * (1 - THICK / HALF_D)];
  interface Run { a: [number, number]; b: [number, number]; front: boolean; u: number }
  const runs: Run[] = [];
  let u = 0;
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length];
    const cuts: number[] = [0, 1];
    if ((a[1] - RIDGE_Z) * (b[1] - RIDGE_Z) < 0) cuts.push((RIDGE_Z - a[1]) / (b[1] - a[1]));
    if (lean !== null && (a[0] - lean) * (b[0] - lean) < 0) cuts.push((lean - a[0]) / (b[0] - a[0]));
    cuts.sort((p, q) => p - q);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const at = (t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      // The front walls: the long south wall and the two cut corners beside it.
      runs.push({ a: at(cuts[k]), b: at(cuts[k + 1]), front: i === 0 || i === 1 || i === 7, u: u + length * cuts[k] });
    }
    u += length;
  });

  for (const run of runs) {
    const mid: [number, number] = [(run.a[0] + run.b[0]) / 2, (run.a[1] + run.b[1]) / 2];
    const boards = inLean(mid[0]);
    const kind = boards ? BOARDS : WALL + render;
    const paint = boards ? timber : stone;
    // A point of a run takes its height from the run's own side of a change in the roof.
    const eps = (p: [number, number]): [number, number] => [p[0] + (mid[0] - p[0]) * 1e-4, p[1] + (mid[1] - p[1]) * 1e-4];
    const ha = top(...eps(run.a));
    const hb = top(...eps(run.b));
    const [ia, ib] = [inset(run.a), inset(run.b)];
    const outer = (lo: number, m: Mason) => m.poly(
      [P(run.a[0], lo, run.a[1]), P(run.b[0], lo, run.b[1]), P(run.b[0], hb, run.b[1]), P(run.a[0], ha, run.a[1])], kind, paint, 0.92, run.u, lo);
    if (run.front) {
      // The sill stays; the wall above it is the lid's.
      outer(SILL, lid);
      shell.poly([P(run.a[0], 0, run.a[1]), P(run.b[0], 0, run.b[1]), P(run.b[0], SILL, run.b[1]), P(run.a[0], SILL, run.a[1])], kind, paint, 0.92, run.u, 0);
      shell.poly([P(ib[0], 0, ib[1]), P(ia[0], 0, ia[1]), P(ia[0], SILL, ia[1]), P(ib[0], SILL, ib[1])], boards ? BOARDS : WALL + 0.9, boards ? timber : plaster, 0.9, run.u, 0);
      shell.poly([P(run.a[0], SILL, run.a[1]), P(run.b[0], SILL, run.b[1]), P(ib[0], SILL, ib[1]), P(ia[0], SILL, ia[1])], PLAIN, pale, 0.9);
    } else {
      outer(0, shell);
      shell.poly([P(ib[0], 0, ib[1]), P(ia[0], 0, ia[1]), P(ia[0], ha, ia[1]), P(ib[0], hb, ib[1])], boards ? BOARDS : WALL + 0.9, boards ? timber : plaster, 0.9, run.u, 0);
      // The wall's top, where the lid sat.
      shell.poly([P(run.a[0], ha, run.a[1]), P(run.b[0], hb, run.b[1]), P(ib[0], hb, ib[1]), P(ia[0], ha, ia[1])], PLAIN, boards ? timber.clone().multiplyScalar(1.2) : pale, 0.9);
    }
  }

  // The floor: flags in a house, boards in a barn.
  const floorPaint = plan.kind === 1 ? timber.clone().multiplyScalar(1.15) : new THREE.Color(FLAGS).multiplyScalar(0.85 + rnd() * 0.3);
  shell.poly(corners.map(inset).map(([x, z]) => P(x, 0.012, z)), plan.kind === 1 ? BOARDS : PLAIN, floorPaint, 0.85, 0, 0, P(1, 0, 0));

  // The roof: a front and a back slope over the main block, with eaves and verges; the lean-to's single slope.
  const EAVE = 0.045;
  const T = 0.024;
  const x0 = -HALF_W - EAVE;
  const x1 = lean !== null ? lean : HALF_W + EAVE;
  const zf = HALF_D + EAVE;
  const roofAt = (x: number, z: number): THREE.Vector3 => P(x, profile(z) + T, z);
  const clip = (x: number): number => Math.min(zf, CUT + 0.03 - Math.abs(x) / SQRT3);      // the eaves follow the cut corners
  const under = roofPaint.clone().multiplyScalar(0.4);
  const slopes: THREE.Vector3[][] = [];
  const xb = (CUT + 0.03 - zf) * SQRT3;                                                 // where the eave's straight run ends
  const frontPts = [roofAt(x0, clip(x0)), roofAt(-xb, zf)];
  if (x1 > xb) frontPts.push(roofAt(xb, zf), roofAt(x1, clip(x1))); else frontPts.push(roofAt(x1, zf));
  frontPts.push(roofAt(x1, RIDGE_Z), roofAt(x0, RIDGE_Z));
  const backPts = [roofAt(x1, -clip(x1))];
  if (x1 > xb) backPts.push(roofAt(xb, -zf)); else backPts[0] = roofAt(x1, -zf);
  backPts.push(roofAt(-xb, -zf), roofAt(x0, -clip(x0)), roofAt(x0, RIDGE_Z), roofAt(x1, RIDGE_Z));
  lid.poly(frontPts, ROOF, roofPaint, 0.78, 0, 0, P(1, 0, 0));
  lid.poly(backPts, ROOF, roofPaint, 0.78, 0, 0, P(-1, 0, 0));
  slopes.push(frontPts, backPts);
  if (lean !== null) {
    const lx = HALF_W + EAVE;
    const lz = (x: number) => clip(x);
    const at = (x: number, z: number) => P(x, leanTop(x) + T, z);
    const leanPts = [at(lean, lz(lean)), at(xb, zf), at(lx, lz(lx)), at(lx, -lz(lx)), at(xb, -zf), at(lean, -lz(lean))];
    if (lean >= xb) leanPts.splice(1, 1), leanPts.splice(3, 1);
    lid.poly(leanPts, ROOF, roofPaint, 0.78, 0, 0, P(0, 0, -1));
    slopes.push(leanPts);
    // The main block's own gable above the lean-to: the lid's, since nothing would hold it up.
    const g: THREE.Vector3[] = [P(lean, leanTop(lean), HALF_D * 0.98), P(lean, leanTop(lean), -HALF_D * 0.98), P(lean, profile(-HALF_D * 0.98), -HALF_D * 0.98), P(lean, ridge, RIDGE_Z), P(lean, profile(HALF_D * 0.98), HALF_D * 0.98)];
    lid.poly(g, WALL + render, stone, 0.92, 0, leanTop(lean));
  }
  // The roof's edge all round each slope (the thickness of slates and battens), and a ridge.
  for (const pts of slopes) {
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      if (Math.abs(a.z - RIDGE_Z) < 1e-6 && Math.abs(b.z - RIDGE_Z) < 1e-6) return;
      const down = P(0, -T, 0);
      lid.poly([a.clone().add(down), b.clone().add(down), b, a], PLAIN, under, 0.8);
    });
  }
  lid.box(P(x0, ridge + T - 0.012, RIDGE_Z - 0.022), P(x1, ridge + T + 0.014, RIDGE_Z + 0.022), PLAIN, roofPaint.clone().multiplyScalar(0.7), 0.7);

  // The front: a door and windows (the lid's, above the sill), and a step that stays.
  const zs = HALF_D;
  const opening = (m: Mason, x: number, y0: number, w: number, h: number, kind: number, paint: THREE.Color, proud = 0.008) =>
    m.box(P(x - w / 2, y0, zs), P(x + w / 2, y0 + h, zs + proud), kind, paint, 0.8);
  const windowAt = (x: number, y: number, w: number, h: number, swing: number) => {
    if (y + h + 0.03 > top(x, zs)) return;                    // no room under the eave here
    opening(lid, x, y, w, h, PLAIN, dark, 0.005);
    lid.box(P(x - w / 2 - 0.015, y + h, zs), P(x + w / 2 + 0.015, y + h + 0.022, zs + 0.012), PLAIN, pale, 0.9);
    lid.box(P(x - w / 2 - 0.01, y - 0.014, zs), P(x + w / 2 + 0.01, y, zs + 0.016), PLAIN, pale, 0.9);
    for (const side of [-1, 1]) {
      const sw = w * 0.52;
      const sx = x + side * (w / 2 + sw / 2 + 0.004);
      const s = side === 1 ? swing : 0;                       // one hangs a little open
      lid.box(P(sx - sw / 2, y - 0.004 - s * 0.01, zs), P(sx + sw / 2, y + h + 0.004 - s * 0.01, zs + 0.012 + s * 0.02), BOARDS, shutter, 0.8);
    }
  };
  const doorAt = (x: number, w: number, h: number, paint: THREE.Color) => {
    const high = Math.min(h, top(x, zs) - 0.04);
    opening(lid, x, SILL, w, high - SILL, BOARDS, paint, 0.01);
    lid.box(P(x - w / 2 - 0.02, high, zs), P(x + w / 2 + 0.02, high + 0.024, zs + 0.014), PLAIN, pale, 0.9);
    shell.box(P(x - w / 2 - 0.02, 0, zs), P(x + w / 2 + 0.02, 0.018, zs + 0.05), PLAIN, pale.clone().multiplyScalar(0.8), 0.9);
  };
  if (plan.kind === 0) {
    doorAt(0.08, 0.12, 0.25, shutter.clone().multiplyScalar(0.8));
    windowAt(-0.26, 0.13, 0.09, 0.12, hang);
    windowAt(0.34, 0.13, 0.09, 0.12, 0);
  } else if (plan.kind === 1) {
    doorAt(-0.08, 0.3, 0.3, timber);                                                       // the cart door
    opening(lid, 0.3, 0.2, 0.09, 0.11, BOARDS, timber.clone().multiplyScalar(0.85), 0.01);     // the loft hatch
  } else {
    doorAt(-0.02, 0.11, 0.24, shutter.clone().multiplyScalar(0.8));
    windowAt(-0.3, 0.13, 0.085, 0.115, hang);
  }

  // The gable end the chimney stands on (the house's left, before mirroring): a window in it, the hearth inside
  // against it and the stack above it. They stay when the lid is off. A barn has an air slit and no fire.
  const gx = -HALF_W;
  if (plan.kind === 1) {
    shell.box(P(gx - 0.006, back + 0.06, RIDGE_Z - 0.014), P(gx, back + 0.16, RIDGE_Z + 0.014), PLAIN, dark, 0.4);
  } else {
    const ix = gx + THICK;
    shell.box(P(ix, 0, RIDGE_Z - 0.12), P(ix + 0.055, 0.24, RIDGE_Z + 0.12), WALL, stone, 0.92, PLAIN, pale);          // the chimney breast
    shell.box(P(ix + 0.055, 0.02, RIDGE_Z - 0.06), P(ix + 0.06, 0.15, RIDGE_Z + 0.06), PLAIN, dark, 0.5);                // the hearth
    shell.box(P(ix, 0.24, RIDGE_Z - 0.07), P(ix + 0.04, ridge - 0.02, RIDGE_Z + 0.07), WALL, stone, 0.92);               // the flue up the wall
    const cxm = gx + 0.075;
    shell.box(P(cxm - 0.05, ridge - 0.04, RIDGE_Z - 0.045), P(cxm + 0.05, ridge + 0.11, RIDGE_Z + 0.045), WALL, stone, 0.92, PLAIN, stone.clone().multiplyScalar(0.5));
    shell.box(P(cxm - 0.06, ridge + 0.11, RIDGE_Z - 0.055), P(cxm + 0.06, ridge + 0.126, RIDGE_Z + 0.055), PLAIN, pale, 0.9);
    shell.box(P(cxm - 0.022, ridge + 0.126, RIDGE_Z - 0.022), P(cxm + 0.022, ridge + 0.17, RIDGE_Z + 0.022), PLAIN, new THREE.Color('#7b4b36'), 0.8, PLAIN, dark);
    shell.box(P(gx - 0.006, 0.16, 0.2), P(gx, 0.27, 0.28), PLAIN, dark, 0.4);                                           // a small window in the gable
  }

  // Two small windows in the back wall, seen from inside when the lid is off: glass, and a pale reveal round it.
  const zi = -HALF_D + THICK;
  for (const wx of [-0.36, 0.36]) {
    if (inLean(wx)) continue;
    shell.box(P(wx - 0.05, 0.15, zi), P(wx + 0.05, 0.29, zi + 0.004), PLAIN, pale, 0.9);
    shell.box(P(wx - 0.036, 0.165, zi), P(wx + 0.036, 0.275, zi + 0.008), PLAIN, dark, 0.3);
    shell.box(P(wx - 0.036, 0.165, -HALF_D - 0.005), P(wx + 0.036, 0.275, -HALF_D), PLAIN, dark, 0.3);
  }

  return { shell: shell.build(plan.mirror), lid: lid.build(plan.mirror), plan, slope: Math.atan2(ridge - front, HALF_D - RIDGE_Z) };
}

// A building tile's parts, by tile (not in its userData: the board's veil is a clone of the tile, and a clone copies userData as JSON).
const houses = new WeakMap<THREE.Object3D, { lid: THREE.Object3D[]; inside: THREE.Object3D[] }>();

/** Show a building tile with its lid off (somebody the board shows is inside) or on. */
export function openHouse(tile: THREE.Object3D, open: boolean): void {
  const parts = houses.get(tile);
  if (!parts) return;
  for (const part of parts.lid) part.visible = !open;
  for (const part of parts.inside) part.visible = open;
}

/** A building hex at a level: closed until the board says somebody is in it. */
export function buildingTile(look: Look, elevation: number, hex: Hex): THREE.Object3D {
  // The ground's own label is left out: the house covers the hex. It is stencilled on the house instead.
  const tile = groundTile(look, elevation, hex, 'yard', 0, null);
  const y = levelOf(elevation) * LEVEL;
  const built = house(hex);
  const mesh = (g: THREE.BufferGeometry, name: string): THREE.Mesh => {
    const m = new THREE.Mesh(g, look.masonry);
    m.position.y = y;
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = name;
    return m;
  };
  const shell = mesh(built.shell, 'house');
  const lid = mesh(built.lid, 'lid');
  tile.add(shell, lid);
  const parts = { lid: [lid] as THREE.Object3D[], inside: [] as THREE.Object3D[] };

  // The label: on the long front slope of the roof, facing the camera.
  const onRoof = text(label(hex), 0.44, TOKENS.paper, 0.8);
  if (onRoof) {
    (onRoof.material as THREE.Material).toneMapped = false;
    const z = 0.3;
    const up = built.plan.ridge + ((z - RIDGE_Z) / (HALF_D - RIDGE_Z)) * (built.plan.front - built.plan.ridge);
    onRoof.rotation.x = -Math.PI / 2 + built.slope;
    // Over the main block, not the lean-to.
    onRoof.position.set(built.plan.lean === null ? 0 : -0.2 * built.plan.mirror, y + up + 0.04, z);
    tile.add(onRoof);
    parts.lid.push(onRoof);
  }
  // With the lid off the man covers the floor and the back wall behind his head: the label lies small on the
  // ground at the hex's south point, in front of the sill, the one place nothing stands.
  const onGround = text(label(hex), 0.27, TOKENS.paper, 0.8);
  if (onGround) {
    (onGround.material as THREE.Material).toneMapped = false;
    layFlat(onGround.geometry);
    onGround.position.set(0, y + 0.008, 0.83);
    onGround.visible = false;
    tile.add(onGround);
    parts.inside.push(onGround);
  }
  houses.set(tile, parts);
  return tile;
}
