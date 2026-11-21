// The diorama's water (28): a stream or a pond, dark, still and cold.
//
// Its surface lies a little below the ground's top, so the land beside it shows its earth side as a bank, and
// the water material is drawn from world position, so a run of water hexes is one water with no seam. Where a
// neighbour is land (`around`) the water shallows towards that edge, to mud at the very edge, and reeds and
// the odd stone stand along it. Where the neighbour is water, or the board ends, it simply runs on.
// Nobody enters water, so nothing is kept clear but the label; reeds stay low enough to hide nothing that matters.

import * as THREE from 'three';
import type { Hex } from '../../../../shared/types';
import type { Around } from '../../kit';
import type { Look } from './look';
import { hexStream } from './noise';
import { LEVEL, levelOf, ringedPrism, rimFrom, tileOn } from './tiles';

/** How far the water lies below the top of the ground at its level. */
export const WATER_DROP = 0.14;
/** Phones: clumps of reed along each bank of a hex at most (four blades a clump, one draw call a hex). 0 for none. */
export const REEDS = { desktop: 9, phone: 5 };

const isLand = (n: Around[number]): boolean => n !== null && n.terrain !== 'water';

const REED = [new THREE.Color('#3f4a26'), new THREE.Color('#77723f'), new THREE.Color('#2a3320')];   // green, dry, root
const STONE = new THREE.Color('#6f6e66');

/** Which of the six edges have land across them (edge i lies between corners i and i + 1; see tiles.ts). */
export function banks(around: Around | undefined): boolean[] {
  return Array.from({ length: 6 }, (_, i) => isLand(around?.[(i + 5) % 6] ?? null));
}

const prisms = new Map<string, ReturnType<typeof ringedPrism>>();

/** Reeds and stones along the banks of one hex: one geometry, its origin at the water's surface at the hex's middle. */
export function reeds(hex: Hex, around: Around | undefined, most = REEDS.desktop): THREE.BufferGeometry {
  const rnd = hexStream(hex);
  const position: number[] = [];
  const color: number[] = [];
  const surface: number[] = [];
  const tri = (a: number[], b: number[], c: number[], ca: THREE.Color, cb: THREE.Color, cc: THREE.Color, rough: number) => {
    // Both faces, lit from above as the ground is.
    position.push(...a, ...b, ...c, ...a, ...c, ...b);
    color.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b, ca.r, ca.g, ca.b, cc.r, cc.g, cc.b, cb.r, cb.g, cb.b);
    for (let i = 0; i < 6; i++) surface.push(rough, 0);
  };
  const corner = (i: number): [number, number] => [Math.sin((i * Math.PI) / 3), Math.cos((i * Math.PI) / 3)];
  banks(around).forEach((land, i) => {
    // Every edge takes its numbers, bank or not, so a hex's reeds do not move when a neighbour changes.
    const clumps = 3 + Math.floor(rnd() * (most - 2));
    const spots = Array.from({ length: most + 1 }, () => [rnd(), rnd(), rnd(), rnd(), rnd()]);
    const stone = [rnd(), rnd(), rnd(), rnd()];
    if (!land) return;
    const [ax, az] = corner(i);
    const [bx, bz] = corner(i + 1);
    const inward = [-(ax + bx) / 2, -(az + bz) / 2];
    const len = Math.hypot(inward[0], inward[1]);
    for (let c = 0; c < Math.min(clumps, most); c++) {
      const [along, off, tall, dry, turn] = spots[c];
      const t = 0.08 + along * 0.84;
      const d = 0.05 + off * off * 0.2;
      const x = ax + (bx - ax) * t + (inward[0] / len) * d;
      const z = az + (bz - az) * t + (inward[1] / len) * d;
      if (Math.abs(x) < 0.42 && z < -0.44) continue;                 // the label
      // No taller than keeps clear the mark of a man on the land to the north (27's rule), measured from the land's top.
      const h = Math.min(0.2 + tall * 0.16, Math.max(0.08, (z + 1.02) / 0.7 + WATER_DROP - 0.02));
      const tint = REED[0].clone().lerp(REED[1], dry * 0.8);
      for (let b = 0; b < 4; b++) {
        const a = turn * 6 + b * 1.7;
        const w = 0.011;
        const lean = 0.05 + 0.04 * ((b * 7919) % 5) / 5;
        const dx = Math.cos(a) * w;
        const dz = Math.sin(a) * w;
        const hb = h * (0.7 + 0.3 * ((b * 31) % 4) / 3);
        tri([x - dx, 0, z - dz], [x + dx, 0, z + dz], [x + Math.cos(a + 1) * lean, hb, z + Math.sin(a + 1) * lean],
          REED[2], REED[2], tint.clone().multiplyScalar(1.15), 0.8);
      }
    }
    if (stone[0] < 0.6) {
      // A stone at the waterline.
      const t = 0.15 + stone[1] * 0.7;
      const x = ax + (bx - ax) * t + (inward[0] / len) * 0.06;
      const z = az + (bz - az) * t + (inward[1] / len) * 0.06;
      const r = 0.03 + stone[2] * 0.035;
      const shade = STONE.clone().multiplyScalar(0.7 + stone[3] * 0.5);
      const dark = shade.clone().multiplyScalar(0.5);
      const rim = [0, 1, 2, 3, 4].map((j) => [x + Math.cos(j * 1.2566 + stone[3] * 3) * r, 0, z + Math.sin(j * 1.2566 + stone[3] * 3) * r]);
      for (let j = 0; j < 5; j++) tri(rim[j], [x, r * 0.6, z], rim[(j + 1) % 5], dark, shade, dark, 0.5);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setAttribute('aSurface', new THREE.Float32BufferAttribute(surface, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(position.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

/** A water hex at a level. */
export function waterTile(look: Look, elevation: number, hex: Hex, around?: Around): THREE.Object3D {
  const level = levelOf(elevation);
  const surface = level * LEVEL - WATER_DROP;
  const land = banks(around);
  const id = `${level}/${land.map((b) => (b ? 1 : 0)).join('')}`;
  let body = prisms.get(id);
  if (!body) {
    body = ringedPrism(surface, level, 0, 0, rimFrom(around, (n) => (isLand(n) ? 1 : 0)));
    prisms.set(id, body);
  }
  const tile = tileOn(look, body, look.water, elevation, hex, 0, -0.7, surface);
  const most = look.coarse ? REEDS.phone : REEDS.desktop;
  if (most > 0 && land.some(Boolean)) {
    const growth = new THREE.Mesh(reeds(hex, around, most), look.blades);
    growth.position.y = surface;
    growth.receiveShadow = true;
    growth.name = 'reeds';
    tile.add(growth);
  }
  return tile;
}
