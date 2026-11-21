// The diorama's crops (28): a wheat field in June, green going to gold, dense, in rows.
//
// The rows are the whole map's (ROWS in look.ts: one direction, one spacing, laid out in world space), and every
// stalk's place comes from where it is on the map, so a field of several hexes is one field. It ends at its
// edge: towards a neighbour that is not crops (`around`) the stalks stop short and the ground material shows a
// headland of trodden earth.
//
// A man in crops is hidden in the rules: he should stand *in* the corn. The tile is two geometries. The *field*
// is everything that may stand whoever is there: the stalks round the rim, to the knee and waist of a man in
// the middle, cut low on the south side so that nothing hides his base or his mark. The *middle* is the corn
// that would hide him or them, standing where the base goes and tall to the south; it is shown while nobody the
// board shows is in the hex and taken away while somebody is (the kit's `occupied` hook, as 27's houses), so
// an empty field, or one with an enemy unseen in it, is whole. Nothing anywhere is so tall so far north that
// it hides the mark of a man in the hex behind (27's sight line).

import * as THREE from 'three';
import { hexToPixel, label } from '../../../../shared/hex';
import type { Hex } from '../../../../shared/types';
import type { Around } from '../../kit';
import { TOKENS, layFlat, text } from '../lowpoly/parts';
import type { Look } from './look';
import { ROWS } from './look';
import { LEVEL, inHex, levelOf, ringedPrism, rimFrom, tileOn } from './tiles';

/**
 * The cost of a field: how far apart the stalks stand along a row (each a tuft of two crossed blades, four
 * triangles). A phone (a coarse pointer) gets the sparser setting; the rows are the same.
 */
export const CROPS = { desktop: { along: 0.05 }, phone: { along: 0.09 } };
const TALL = 0.4;            // wheat to a man's waist (he is 1 tall)
const HEADLAND = 0.14;       // bare ground left along an edge where the field ends
const CLEAR = 0.7;           // the base of a unit, and a little: no stalk of the field stands inside it

const ROOT = new THREE.Color('#3f4d27');
const GREEN = new THREE.Color('#6f8440');
const GOLD = new THREE.Color('#a59c58');

const isCrops = (n: Around[number]): boolean => n === null || n.terrain === 'crops';      // off the board, the field runs on

/** A steady number in 0..1 from two whole numbers: a stalk's own, wherever it is asked from. */
function hash(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) ^ Math.imul(b, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** How high a stalk at (x, z) of a hex may stand without hiding the base or the mark of the man in that hex. */
export function roomFor(x: number, z: number): number {
  const ax = Math.abs(x);
  if (ax >= CLEAR) return TALL;
  // The base's front edge at this x, and his mark's (0.5 south of the middle) where it is nearer.
  const front = Math.sqrt(CLEAR * CLEAR - ax * ax);
  if (z < -front) return TALL;                                // behind him
  return Math.max(0, Math.min(TALL, (z - Math.max(front, ax < 0.38 ? 0.52 : 0)) / 0.7));
}

/** The stalks of one hex: the field (always there) and the middle (there while nobody is). Origins at the top centre of the hex. */
export function corn(hex: Hex, around: Around | undefined, cost = CROPS.desktop): { field: THREE.BufferGeometry; middle: THREE.BufferGeometry } {
  const centre = hexToPixel(hex, 1);
  const n = [Math.sin(ROWS.turn), Math.cos(ROWS.turn)];           // across the rows
  const d = [Math.cos(ROWS.turn), -Math.sin(ROWS.turn)];          // along them
  const open = Array.from({ length: 6 }, (_, i) => !isCrops(around?.[(i + 5) % 6] ?? null));   // edges where the field ends
  const corner = (i: number): [number, number] => [Math.sin((i * Math.PI) / 3), Math.cos((i * Math.PI) / 3)];
  /** How far inside the nearest edge where the field ends (large if none is near). */
  const fromEnd = (x: number, z: number): number => {
    let least = 9;
    for (let i = 0; i < 6; i++) {
      if (!open[i]) continue;
      const [ax, az] = corner(i);
      const [bx, bz] = corner(i + 1);
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      least = Math.min(least, 0.866 - (x * mx + z * mz) / 0.866);
    }
    return least;
  };
  const lists = { field: { position: [] as number[], color: [] as number[] }, middle: { position: [] as number[], color: [] as number[] } };
  const tip = new THREE.Color();
  const stalk = (into: { position: number[]; color: number[] }, x: number, z: number, h: number, gold: number, turn: number, lean: number) => {
    if (h < 0.025) return;
    tip.copy(GREEN).lerp(GOLD, 0.35 + gold * 0.65).multiplyScalar(1.08);
    for (let b = 0; b < 2; b++) {
      const a = turn + b * 1.6;
      const w = 0.024;
      const dx = Math.cos(a) * w;
      const dz = Math.sin(a) * w;
      const tx = x + Math.cos(turn * 3) * lean;
      const tz = z + Math.sin(turn * 3) * lean;
      const A = [x - dx, 0, z - dz];
      const B = [x + dx, 0, z + dz];
      const T = [tx, h, tz];
      into.position.push(...A, ...B, ...T, ...A, ...T, ...B);
      for (const col of [ROOT, ROOT, tip, ROOT, tip, ROOT]) into.color.push(col.r * (0.9 + 0.2 * gold), col.g, col.b);
    }
  };

  // Every stalk of the map's rows that falls in this hex.
  const t0 = (centre.x * n[0] + centre.y * n[1]) / ROWS.apart;
  const s0 = centre.x * d[0] + centre.y * d[1];
  for (let row = Math.floor(t0 - 1 / ROWS.apart) - 1; row <= Math.ceil(t0 + 1 / ROWS.apart) + 1; row++) {
    const across = (row + 0.5) * ROWS.apart;
    for (let i = Math.floor((s0 - 1.05) / cost.along); i <= Math.ceil((s0 + 1.05) / cost.along); i++) {
      const along = (i + (hash(row, i) - 0.5) * 0.7) * cost.along;
      const wx = n[0] * across + d[0] * along + n[0] * (hash(i, row + 7) - 0.5) * 0.02;
      const wz = n[1] * across + d[1] * along + n[1] * (hash(i, row + 7) - 0.5) * 0.02;
      const x = wx - centre.x;
      const z = wz - centre.y;
      if (!inHex(x, z, 1)) continue;
      const edge = fromEnd(x, z);
      if (edge < HEADLAND * (0.6 + 0.8 * hash(row + 3, i))) continue;      // the headland, its edge ragged
      // Ripening in drifts across the field, and stalk by stalk.
      const drift = 0.5 + 0.5 * Math.sin(wx * 0.83 + 1.3) * Math.cos(wz * 0.61 - 0.4);
      const gold = Math.min(1, Math.max(0, drift * 0.7 + hash(row * 3 + 1, i * 5 + 2) * 0.4 - 0.25));
      const tall = TALL * (0.86 + 0.24 * hash(row + 11, i + 5)) * Math.min(1, 0.55 + edge * 2.2);   // shorter at the field's edge
      // 27's sight line: nothing so tall so far north that it hides the mark of a man in the hex behind.
      const cap = Math.max(0, (z - 0.08 + 1.02) / 0.7);      // less the little a stalk leans
      const full = Math.min(tall, cap);
      const turn = hash(row + 5, i + 9) * 6.28;
      const lean = 0.03 + 0.04 * hash(row + 17, i + 3);
      const room = roomFor(x, z - 0.08);
      if (Math.hypot(x, z) < CLEAR) {
        stalk(lists.middle, x, z, full, gold, turn, lean);                  // where the base goes: only while nobody is there
      } else if (room < full) {
        stalk(lists.field, x, z, Math.min(full, room), gold, turn, lean);   // cut low in front of him
        stalk(lists.middle, x, z, full, gold, turn, lean);                  // and whole while nobody is there
      } else {
        stalk(lists.field, x, z, full, gold, turn, lean);
      }
    }
  }
  const build = (list: { position: number[]; color: number[] }): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(list.position, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(list.color, 3));
    g.setAttribute('aSurface', new THREE.Float32BufferAttribute(new Float32Array((list.position.length / 3) * 2).map((_, i) => (i % 2 === 0 ? 0.8 : 0)), 2));
    // Lit as the ground they grow from.
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(list.position.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    return g;
  };
  return { field: build(lists.field), middle: build(lists.middle) };
}

// A crops tile's middle (and its label), by tile (not in userData: the board's veil is a clone, and a clone copies userData as JSON).
const middles = new WeakMap<THREE.Object3D, THREE.Object3D[]>();

/** Somebody the board shows stands in this field, or no longer does: the corn where he stands is taken away, or put back. */
export function standIn(tile: THREE.Object3D, occupied: boolean): void {
  for (const part of middles.get(tile) ?? []) part.visible = !occupied;
}

/** A crops hex at a level: whole until the board says somebody is in it. */
export function cropsTile(look: Look, elevation: number, hex: Hex, around?: Around): THREE.Object3D {
  const level = levelOf(elevation);
  const top = level * LEVEL;
  // The field's ground: tilled all over, falling to a headland along each edge where the field ends.
  const body = ringedPrism(top, level, 1, 1, rimFrom(around, (n) => (isCrops(n) ? 0 : 1)).map((end) => 1 - end));
  const tile = tileOn(look, body, look.ground, elevation, hex, 0, null);
  const { field, middle } = corn(hex, around, look.coarse ? CROPS.phone : CROPS.desktop);
  const mesh = (g: THREE.BufferGeometry, name: string): THREE.Mesh => {
    const m = new THREE.Mesh(g, look.blades);
    m.position.y = top;
    m.receiveShadow = true;
    m.name = name;
    return m;
  };
  const standing = mesh(middle, 'middle');
  tile.add(mesh(field, 'field'), standing);
  // The label lies on top of the corn, moved south by what its height shifts it north on the screen, so that it
  // reads where every hex's label does. With a man in the hex it goes with the corn he stands in (he would cover it).
  const gone: THREE.Object3D[] = [standing];
  const name = text(label(hex), 0.44, TOKENS.paper, 0.78);
  if (name) {
    layFlat(name.geometry);
    (name.material as THREE.Material).toneMapped = false;
    const high = TALL * 1.12;
    name.position.set(0, top + high, -0.7 + 0.7 * high);
    tile.add(name);
    gone.push(name);
  }
  middles.set(tile, gone);
  return tile;
}
