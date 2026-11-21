// The diorama's woods (27): a Normandy wood on a wargame table. Oak and beech, the odd fir; trunks, crowns
// built of clumps as a modeller builds them of foliage on a wire frame, low undergrowth; on the ground
// material's wood floor (leaf litter and moss).
//
// Where things stand, and why (the camera looks from the south, 55 degrees down, so a thing y high hides the
// ground 0.7 y to its north):
// - the middle of the hex is clear for a unit, and so is a lane north of it for the label;
// - the tall trees stand at the two sides, a little south of the middle line, their crowns out over the
//   hex's edge, so neighbouring woods hexes close up into one wood and a man stands between trunks;
// - lower trees stand at the back corners, kept low enough not to hide the mark of a
//   man in the hex behind;
// - the south corners have a low tree each, clear of the base; between them only undergrowth, knee high, so
//   the base and mark of the man in the hex are plain.
// Everything is one opaque geometry in one draw call (so the board's veil covers every leaf of an unseen
// wood), and every number comes from the hex's own stream.

import * as THREE from 'three';
import type { Hex } from '../../../../shared/types';
import type { Look } from './look';
import { hexStream } from './noise';
import { Sculpt, v } from './sculpt';
import { LEVEL, groundTile, inHex, levelOf } from './tiles';

/**
 * The cost of a wood: trees a hex at most, and clumps a crown at most (a clump is 80 triangles). A phone (a
 * coarse pointer) gets the cheap setting. One draw call a hex either way, and one more in the shadow pass.
 */
export const WOODS = { desktop: { trees: 7, clumps: 7 }, phone: { trees: 5, clumps: 4 } };

type Kind = 'oak' | 'beech' | 'fir';
const LEAF: Record<Kind, [string, string]> = {       // a crown's colour in shade and in light
  oak: ['#25331c', '#4f6230'],
  beech: ['#2f3f20', '#66763a'],
  fir: ['#1c2b20', '#3d5438'],
};
const BARK: Record<Kind, string> = { oak: '#4b4135', beech: '#74736a', fir: '#4a3a2e' };
const BRUSH: [string, string] = ['#243119', '#4d5f2c'];

// One clump: a ball of twenty corners, eighty faces.
const BALL = new THREE.IcosahedronGeometry(1, 1).getAttribute('position');

/**
 * A clump of foliage at `at`: a lumpy ball, darker beneath. Its normals lean out from `heart` (the middle of
 * the crown it belongs to), so that a crown is lit as one rounded mass with lumps on it, not as a pile of balls.
 */
function clump(s: Sculpt, at: THREE.Vector3, r: number, squash: number, heart: THREE.Vector3, paint: [string, string], seed: number, tint: number): void {
  const shade = new THREE.Color(paint[0]);
  const light = new THREE.Color(paint[1]);
  const position: number[] = [];
  const normal: number[] = [];
  const color: number[] = [];
  const d = new THREE.Vector3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < BALL.count; i++) {
    d.fromBufferAttribute(BALL, i);
    // The same corner always moves the same way, whichever face it is met on: no cracks.
    const lump = 1 + 0.3 * Math.sin(d.x * 5.1 + seed) * Math.sin(d.y * 6.3 + seed * 1.7) * Math.sin(d.z * 4.7 + seed * 0.6)
      + 0.12 * Math.sin(d.x * 11 + d.z * 9 + seed * 2.3);
    p.set(d.x * r * lump, d.y * r * lump * squash, d.z * r * lump).add(at);
    n.copy(p).sub(heart).normalize().multiplyScalar(0.6).addScaledVector(d, 0.4).normalize();
    const up = Math.min(1, Math.max(0, n.y * 0.5 + 0.5));
    c.copy(shade).lerp(light, up * up * (0.75 + 0.5 * tint)).multiplyScalar(0.85 + 0.3 * tint);
    position.push(p.x, p.y, p.z);
    normal.push(n.x, n.y, n.z);
    color.push(c.r, c.g, c.b);
  }
  s.raw(position, normal, color, 0.95);
}

/** A tree at (x, z), `tall` to its top, its crown `wide` across at most. */
function tree(s: Sculpt, rnd: () => number, kind: Kind, x: number, z: number, tall: number, wide: number, clumps: number): void {
  const lean = (rnd() - 0.5) * 0.08;
  const girth = 0.028 + tall * 0.022;
  if (kind === 'fir') {
    // A straight stem and tiers of drooping boughs, each a ragged cone.
    s.limb(v(x, 0, z), v(x + lean, tall * 0.9, z), girth * 0.8, girth * 0.25, BARK.fir, 0.9, 0, false);
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const k = i / (tiers - 1);
      const y = tall * (0.3 + 0.52 * k);
      const r = wide * 0.5 * (1 - 0.68 * k);
      const cone = new THREE.ConeGeometry(r, tall * 0.34, 7, 1, true).rotateY(rnd() * Math.PI).translate(x + lean * k, y + tall * 0.1, z).toNonIndexed();
      const at = cone.getAttribute('position');
      const seed = rnd() * 40;
      for (let j = 0; j < at.count; j++) {
        const a = Math.atan2(at.getZ(j) - z, at.getX(j) - x);
        const ragged = 1 + 0.22 * Math.sin(a * 5 + seed) + 0.1 * Math.sin(a * 9 + seed * 2);
        at.setXYZ(j, x + lean * k + (at.getX(j) - x - lean * k) * ragged, at.getY(j), z + (at.getZ(j) - z) * ragged);
      }
      cone.computeVertexNormals();
      const tint = rnd();
      s.add(cone, LEAF.fir[1], 0.95, 0, (p) => (0.45 + 0.75 * Math.min(1, Math.hypot(p.x - x, p.z - z) / Math.max(r, 0.01))) * (0.8 + 0.3 * tint));
    }
    return;
  }
  // A broadleaf: a trunk to the crown's underside, a fork, and the crown: one clump at its heart and the rest round it.
  const oak = kind === 'oak';
  const r = wide * 0.5;
  const squash = oak ? 0.78 : 1.05;
  const heart = v(x + lean * 3, tall - r * squash * 0.95, z + (rnd() - 0.5) * 0.04);
  const fork = heart.y - r * squash * 0.55;
  s.limb(v(x, 0, z), v(x + lean, fork * 0.55, z), girth * 1.25, girth * 0.85, BARK[kind], 0.9, 0, false);
  s.limb(v(x + lean, fork * 0.55, z), v(heart.x, fork + 0.05, heart.z), girth * 0.85, girth * 0.55, BARK[kind], 0.9, 0, false);
  clump(s, heart, r * 0.72, squash, heart, LEAF[kind], rnd() * 50, rnd());
  for (let i = 1; i < clumps; i++) {
    const a = (i / (clumps - 1)) * Math.PI * 2 + rnd() * 0.9;
    const rise = (rnd() - 0.35) * 0.9;                 // more of them above the heart than below
    const out = r * (0.5 + rnd() * 0.28);
    const at = v(heart.x + Math.cos(a) * out, heart.y + rise * r * squash * 0.6, heart.z + Math.sin(a) * out);
    // A bough to carry it, seen from below the crown.
    if (i % 2 === 0) s.limb(v(heart.x, fork, heart.z), at, girth * 0.4, girth * 0.2, BARK[kind], 0.9, 0, false);
    clump(s, at, r * (0.4 + rnd() * 0.2), squash * (0.85 + rnd() * 0.3), heart, LEAF[kind], rnd() * 50, rnd());
  }
}

/** Everything that grows on one woods hex, as one geometry with its origin at the top centre of the hex. */
export function wood(hex: Hex, cost: { trees: number; clumps: number } = WOODS.desktop): THREE.BufferGeometry {
  const rnd = hexStream(hex);
  const s = new Sculpt();
  const pick = (): Kind => { const k = rnd(); return k < 0.14 ? 'fir' : k < 0.6 ? 'oak' : 'beech'; };
  const jig = (spread: number) => (rnd() - 0.5) * spread;

  // The two tall ones at the sides; then the back corners; a fifth, if there is one, at one side further north.
  const stands: { x: number; z: number; tall: [number, number]; wide: [number, number] }[] = [
    { x: -0.7, z: 0.2, tall: [0.96, 1.12], wide: [0.74, 0.9] },
    { x: 0.7, z: 0.16, tall: [0.96, 1.12], wide: [0.74, 0.9] },
    // The back corners: a tree here stands in front of the mark of a man in the hex to the north-east or
    // north-west (1.05 + z south of it), so it is no taller than that over 0.7.
    { x: -0.58, z: -0.42, tall: [0.5, 0.62], wide: [0.48, 0.58] },
    { x: 0.58, z: -0.4, tall: [0.5, 0.62], wide: [0.48, 0.58] },
    { x: rnd() < 0.5 ? -0.86 : 0.86, z: -0.12, tall: [0.76, 0.9], wide: [0.46, 0.56] },     // one more at a side
    { x: -0.74, z: 0.42, tall: [0.5, 0.66], wide: [0.4, 0.5] },                          // the south corners: low
    { x: 0.74, z: 0.4, tall: [0.5, 0.66], wide: [0.4, 0.5] },
  ];
  // Every stand is asked for its numbers whether or not it is planted, so the cheap setting has the same trees, fewer.
  stands.forEach((stand, i) => {
    const kind = pick();
    const x = stand.x + jig(0.12);
    const z = stand.z + jig(0.14);
    const tall = stand.tall[0] + rnd() * (stand.tall[1] - stand.tall[0]);
    const wide = (stand.wide[0] + rnd() * (stand.wide[1] - stand.wide[0])) * (kind === 'fir' ? 0.8 : 1);
    const clumps = Math.max(3, Math.round(cost.clumps * (0.75 + rnd() * 0.25)));
    const sub = hexStream({ q: hex.q * 7 + i + 1, r: hex.r * 13 - i });     // a tree's own stream: planting one fewer leaves the others as they were
    if (i < cost.trees) tree(s, sub, kind, x, z, tall, wide, clumps);
  });

  // Undergrowth: bramble and hazel, knee high along the south rim and at the corners, a little taller at the back.
  const brush = 7 + Math.floor(rnd() * 4);
  for (let i = 0; i < brush; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 0.7 + rnd() * 0.22;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d * 0.95;
    const r = 0.07 + rnd() * 0.06;
    const tint = rnd();
    const seed = rnd() * 60;
    // Not in the lane to the north (the label), and not outside the hex.
    if (!inHex(x, z, 0.95) || (Math.abs(x) < 0.42 && z < 0)) continue;
    const high = z < -0.2 ? 1.7 : 1;
    const at = v(x, r * 0.5 * high, z);
    clump(s, at, r * high, 0.75, v(x, 0, z), BRUSH, seed, tint);
  }
  // Last, the rule the stands were chosen for, made sure of leaf by leaf: nothing is so high so far north that it
  // would hide the mark of a man in the hex behind (his mark's front is 1.02 north of this hex's middle).
  const g = s.build();
  const at = g.getAttribute('position');
  for (let i = 0; i < at.count; i++) {
    const z = at.getZ(i);
    const x = at.getX(i);
    const y = Math.min(at.getY(i), Math.max(0, (z + 1.02) / 0.7));       // a sloping cap: the crown is trimmed, not torn
    at.setY(i, y);
    // ...and nothing leans in over the lane: not in front of this hex's own man, nor of his mark (its front edge 0.5
    // south of the middle), nor so high that it would hide the label (its near edge 0.57 north). A leaf that would
    // is moved out sideways to the lane's edge, which trims the crown to a face along the lane.
    const side = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const low = y <= Math.max(0, (z - 0.52) / 0.7);
    if (!low && ax < 0.38 && z > 0.1) at.setX(i, side * 0.38);
    else if (!low && ax < 0.2 && z > -0.14) at.setX(i, side * 0.2);
    else if (ax < 0.3 && z > -0.57 && y > (z + 0.55) / 0.7) at.setX(i, side * 0.3);
  }
  return g;
}

/** A woods hex at a level. */
export function woodsTile(look: Look, elevation: number, hex: Hex): THREE.Object3D {
  const tile = groundTile(look, elevation, hex, 'wood', 0, -0.7);
  const trees = new THREE.Mesh(wood(hex, look.coarse ? WOODS.phone : WOODS.desktop), look.leaves);
  trees.position.y = levelOf(elevation) * LEVEL;
  trees.castShadow = true;
  trees.receiveShadow = true;
  trees.name = 'wood';
  tile.add(trees);
  return tile;
}
