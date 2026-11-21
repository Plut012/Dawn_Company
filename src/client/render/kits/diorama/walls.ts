// The diorama's low wall (28): a Normandy dry-stone wall, knee high, mossy, of uneven stones.
//
// A man stands in the hex, so the wall keeps to the north and the rim. Its line is a shallow bow across the
// north of the hex, behind where his base goes, from near the hex's west corner to near its east corner. Walls
// join at the hexes' corners, which three hexes share:
// - a wall or building to the east or west (`around`): the bow is carried out to that corner, where the
//   neighbour's own bow begins, so a row of wall hexes is one wall with a slight wave in it;
// - one to the north-east or north-west: a spur runs from the top of the bow to the hex's north corner,
//   where that neighbour's bow ends;
// - one to the south-east or south-west: the wall turns down the hex's side to its lower corner, which is
//   that neighbour's north corner, where its own spur comes up to meet it.
// Towards a building the last length is carried on to the house's own wall. With no such neighbour the bow
// stands alone, a short length across the hex. It is lowpoly's height (about 0.22): it hides neither the man's
// base nor his mark, nor the mark of a man in the hex behind. One opaque geometry, one draw call, on the open
// tile's grass.

import * as THREE from 'three';
import type { Hex } from '../../../../shared/types';
import type { Around } from '../../kit';
import type { Look } from './look';
import { hexStream } from './noise';
import { Sculpt } from './sculpt';
import { LEVEL, TUFTS, groundTile, levelOf } from './tiles';

const APEX = -0.76;          // how far north the bow reaches at the hex's middle: behind a unit's base (0.64 and its rim)
const HALF = 0.866;          // from the middle of a hex to its east and west corners (they lie 0.5 north and south)
const SHORT = 0.6;           // where the bow ends when nothing lies that way

const E = 0, NE = 1, NW = 2, W = 3, SW = 4, SE = 5;       // `neighbors()` order
type Join = 'wall' | 'house' | null;
const joinOf = (n: Around[number]): Join => (n === null ? null : n.terrain === 'wall' ? 'wall' : n.terrain === 'building' ? 'house' : null);

/** What a wall hex's wall does, from its neighbours. */
export interface WallRuns {
  east: Join; west: Join;              // the bow is carried to the east or west corner, to a wall or a house there
  northEast: Join; northWest: Join;    // a spur from the top of the bow: to the north corner (a wall), or to that house
  downEast: Join; downWest: Join;      // down the east or west side to the lower corner, to a wall or a house to the south
}

export function wallRuns(around: Around | undefined): WallRuns {
  const j = (dir: number): Join => joinOf(around?.[dir] ?? null);
  return {
    east: j(E),
    west: j(W),
    northEast: j(NE),
    northWest: j(NW),
    downEast: j(SE),
    // The west side is the east side of the hex to the west: if that is a wall, the turn down it is that hex's to draw.
    downWest: j(W) === 'wall' ? null : j(SW),
  };
}

/** The wall's lines on a hex, each a run of points on the ground (x east, z south, from the hex's middle). */
export function wallLines(around: Around | undefined): [number, number][][] {
  const runs = wallRuns(around);
  const lines: [number, number][][] = [];
  // The bow: a parabola through the two corners' height, north of the base in the middle.
  const bowZ = (x: number): number => APEX + (-0.5 - APEX) * (x / HALF) * (x / HALF);
  const toEast = runs.east !== null || runs.downEast !== null;
  const toWest = runs.west !== null || runs.downWest !== null;
  const x0 = toWest ? -HALF : -SHORT;
  const x1 = toEast ? HALF : SHORT;
  const steps = Math.max(4, Math.round((x1 - x0) / 0.14));
  const bow: [number, number][] = Array.from({ length: steps + 1 }, (_, i) => {
    const x = x0 + ((x1 - x0) * i) / steps;
    return [x, bowZ(x)];
  });
  // Into a house standing east or west: on to its end wall.
  if (runs.west === 'house') bow.unshift([-HALF - 0.13, -0.5]);
  if (runs.east === 'house') bow.push([HALF + 0.13, -0.5]);
  lines.push(bow);
  // North: to the corner where a wall's bow ends, or to the cut corner of a house.
  if (runs.northEast === 'wall' || runs.northWest === 'wall') lines.push([[0, APEX], [0, -0.88], [0, -1]]);
  if (runs.northEast === 'house') lines.push([[0.04, APEX], [0.16, -0.86], [0.27, -0.92]]);
  if (runs.northWest === 'house') lines.push([[-0.04, APEX], [-0.16, -0.86], [-0.27, -0.92]]);
  // South: down the side to the lower corner, and on to a house's back wall.
  for (const [side, join] of [[1, runs.downEast], [-1, runs.downWest]] as const) {
    if (join === null) continue;
    const line: [number, number][] = [[side * HALF, -0.5], [side * HALF, -0.25], [side * HALF, 0], [side * HALF, 0.25], [side * HALF, 0.5]];
    if (join === 'house') line.push([side * HALF, 0.68], [side * HALF, 0.85]);
    lines.push(line);
  }
  return lines;
}

const STONES = ['#8d897c', '#9a9282', '#7f7c73', '#a39a86'];
const MOSSY = ['#6f7a52', '#7c8460', '#5f6b47'];
const hex6 = (c: THREE.Color): string => `#${c.getHexString()}`;

/** A wall along a line of points on the ground: two rough courses and a coping of stones on edge. */
function build(s: Sculpt, rnd: () => number, line: THREE.Vector3[]): void {
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const along = b.clone().sub(a);
    const length = along.length();
    if (length < 1e-4) continue;
    const yaw = Math.atan2(-along.z, along.x);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const stone = (y: number, h: number, depth: number, len: number, off: number, paint: string, tilt = 0) => {
      const g = new THREE.BoxGeometry(len, h, depth);
      // Knocked out of square, each corner its own way.
      const at = g.getAttribute('position');
      for (let v = 0; v < at.count; v++) {
        const k = Math.sin(at.getX(v) * 91 + at.getY(v) * 57 + at.getZ(v) * 33 + off * 40);
        at.setXYZ(v, at.getX(v) * (1 + 0.12 * k), at.getY(v) * (1 + 0.1 * k), at.getZ(v) * (1 - 0.1 * k));
      }
      g.computeVertexNormals();
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, yaw + (rnd() - 0.5) * 0.3, tilt, 'YXZ'));
      m.setPosition(mid.x + along.x * off + (rnd() - 0.5) * 0.012, y + h / 2, mid.z + along.z * off + (rnd() - 0.5) * 0.012);
      s.add(g.applyMatrix4(m), paint, 0.95);
    };
    const tone = () => hex6(new THREE.Color(STONES[Math.floor(rnd() * STONES.length)]).multiplyScalar(0.8 + rnd() * 0.35));
    const h1 = 0.07 + rnd() * 0.02;
    const h2 = 0.06 + rnd() * 0.02;
    stone(0, h1, 0.11 + rnd() * 0.02, length * 1.04, 0, tone());
    // The upper course breaks joint with the lower: two shorter stones.
    stone(h1, h2, 0.095 + rnd() * 0.02, length * 0.55, -0.24, tone());
    stone(h1, h2 * (0.85 + rnd() * 0.3), 0.095 + rnd() * 0.02, length * 0.5, 0.26, tone());
    // The coping: flat stones set on edge, leaning on each other, mossed.
    const cope = Math.max(2, Math.round(length / 0.035));
    for (let c = 0; c < cope; c++) {
      const mossy = rnd() < 0.55;
      const paint = mossy ? hex6(new THREE.Color(MOSSY[Math.floor(rnd() * MOSSY.length)]).multiplyScalar(0.8 + rnd() * 0.3)) : tone();
      stone(h1 + h2 - 0.008, 0.055 + rnd() * 0.03, 0.085 + rnd() * 0.02, 0.028, (c + 0.5) / cope - 0.5, paint, 0.25 + rnd() * 0.3);
    }
  }
}

/** The wall of one hex, as one geometry with its origin at the top centre of the hex. */
export function wall(hex: Hex, around: Around | undefined): THREE.BufferGeometry {
  const rnd = hexStream(hex);
  const s = new Sculpt();
  for (const line of wallLines(around)) {
    // A little out of true, but not at its ends, where it meets its neighbour's.
    build(s, rnd, line.map(([x, z], i) => new THREE.Vector3(
      x + (i === 0 || i === line.length - 1 ? 0 : (rnd() - 0.5) * 0.02), 0, z + (i === 0 || i === line.length - 1 ? 0 : (rnd() - 0.5) * 0.02),
    )));
  }
  return s.build();
}

/** A low-wall hex at a level. */
export function wallTile(look: Look, elevation: number, hex: Hex, around?: Around): THREE.Object3D {
  // The label just south of the bow, which stands where the open tile has it.
  const tile = groundTile(look, elevation, hex, 'turf', TUFTS, -0.4);
  const stones = new THREE.Mesh(wall(hex, around), look.paint);
  stones.position.y = levelOf(elevation) * LEVEL;
  stones.castShadow = true;
  stones.receiveShadow = true;
  stones.name = 'wall';
  tile.add(stones);
  return tile;
}
