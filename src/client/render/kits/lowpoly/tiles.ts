// Tiles: stepped hex prisms, bare or with trees, a house, crops, a low wall or water on top; and (25) the works an
// engineer puts up: sandbags, wire, an MG nest. Existing palette only: paper bags and ink lines, as the wall is.

import * as THREE from 'three';
import type { Hex, TerrainId } from '../../../../shared/types';
import { label } from '../../../../shared/hex';
import { TOKENS, box, flat, layFlat, lit, outline, solid, text } from './parts';

const LEVEL = 0.5;
const DEPTH = 0.6;     // how far every prism reaches below level-0 ground

const GROUND = [TOKENS.khaki, TOKENS.hill1, TOKENS.hill2];   // paler = higher
const groundTint = (elevation: number): string =>
  GROUND[Math.min(GROUND.length - 1, Math.max(0, Math.round(elevation)))];

const gridLine = new THREE.LineBasicMaterial({ color: TOKENS.ink, transparent: true, opacity: 0.25 });
const contourLine = new THREE.LineBasicMaterial({ color: TOKENS.ink, transparent: true, opacity: 0.35 });
const inkLine = new THREE.LineBasicMaterial({ color: TOKENS.ink });

const prisms = new Map<number, { body: THREE.BufferGeometry; edges: THREE.BufferGeometry }>();
function prism(elevation: number): { body: THREE.BufferGeometry; edges: THREE.BufferGeometry } {
  let p = prisms.get(elevation);
  if (!p) {
    const h = DEPTH + elevation * LEVEL;
    // Six sides, a corner pointing along z: a pointy-top hex. Groups: 0 sides, 1 top, 2 bottom.
    const body = new THREE.CylinderGeometry(1, 1, h, 6).translate(0, elevation * LEVEL - h / 2, 0);
    p = { body, edges: new THREE.EdgesGeometry(body) };
    prisms.set(elevation, p);
  }
  return p;
}

const contours = new Map<number, THREE.BufferGeometry>();
function contour(radius: number): THREE.BufferGeometry {
  let g = contours.get(radius);
  if (!g) {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (i * Math.PI) / 3;
      return new THREE.Vector3(radius * Math.sin(a), 0, radius * Math.cos(a));
    });
    g = new THREE.BufferGeometry().setFromPoints(pts);
    contours.set(radius, g);
  }
  return g;
}

/** The bare stepped ground of a hex. */
function ground(elevation: number, top: string): THREE.Group {
  const tile = new THREE.Group();
  const { body, edges } = prism(elevation);
  const side = lit(groundTint(elevation));
  const mesh = new THREE.Mesh(body, [side, lit(top), side]);
  mesh.receiveShadow = true;
  mesh.castShadow = elevation > 0;
  tile.add(mesh, new THREE.LineSegments(edges, gridLine));
  // Contour rings, as on a printed map: one per level.
  for (let level = 1; level <= Math.min(2, elevation); level++) {
    const ring = new THREE.LineLoop(contour(level === 1 ? 0.84 : 0.68), contourLine);
    ring.position.y = elevation * LEVEL + 0.006;
    tile.add(ring);
  }
  return tile;
}

/** A small steady random stream per hex, so a map always looks the same. */
function stream(hex: Hex): () => number {
  let s = (Math.imul(hex.q, 73856093) ^ Math.imul(hex.r, 19349663) ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const trunkGeo = new THREE.CylinderGeometry(0.045, 0.06, 0.24, 5).translate(0, 0.12, 0);
const skirtGeo = new THREE.ConeGeometry(0.3, 0.52, 6).translate(0, 0.44, 0);
const crownGeo = new THREE.ConeGeometry(0.21, 0.44, 6).translate(0, 0.8, 0);

function tree(size: number, turn: number): THREE.Group {
  const t = new THREE.Group();
  t.add(solid(trunkGeo, TOKENS.ink), outline(solid(skirtGeo, TOKENS.olive)), outline(solid(crownGeo, TOKENS.olive)));
  t.scale.setScalar(size);
  t.rotation.y = turn;
  return t;
}

// Trees stand round the rim, leaving the middle clear for a unit.
const TREE_SPOTS: [number, number][] = [[-0.5, -0.42], [0.42, -0.5], [-0.6, 0.2], [0.62, 0.12], [0, -0.68]];

function woods(elevation: number, hex: Hex): THREE.Group {
  const tile = ground(elevation, TOKENS.olive);
  const rnd = stream(hex);
  const skip = Math.floor(rnd() * TREE_SPOTS.length);
  TREE_SPOTS.forEach(([x, z], i) => {
    if (i === skip) return;
    const t = tree(0.85 + rnd() * 0.4, rnd() * Math.PI);
    t.position.set(x + (rnd() - 0.5) * 0.14, elevation * LEVEL, z + (rnd() - 0.5) * 0.14);
    tile.add(t);
  });
  return tile;
}

// A triangular prism lying along x, apex up, base at y = 0.
const roofGeo = new THREE.CylinderGeometry(1, 1, 1, 3)
  .rotateZ(Math.PI / 2).rotateX(-Math.PI / 2)
  .translate(0, 0.5, 0).scale(1.1, 0.3 / 1.5, 0.72 / 1.732);
const roofEdges = new THREE.EdgesGeometry(roofGeo);
const wallGeo = new THREE.BoxGeometry(1, 0.5, 0.6);
const wallEdges = new THREE.EdgesGeometry(wallGeo);

// The house stands at the back of the hex, so a unit there stands in front of it.
function building(elevation: number, hex: Hex): THREE.Group {
  const tile = ground(elevation, groundTint(elevation));
  const rnd = stream(hex);
  const house = new THREE.Group();
  const walls = outline(solid(wallGeo, TOKENS.paper), 0.025);
  walls.position.y = 0.25;
  walls.add(new THREE.LineSegments(wallEdges, inkLine));
  const roof = outline(solid(roofGeo, TOKENS.paper), 0.025);
  roof.position.y = 0.5;
  roof.add(new THREE.LineSegments(roofEdges, inkLine));
  const door = box(0.13, 0.26, 0.02, TOKENS.ink, (rnd() - 0.5) * 0.5, 0, 0.3, false);
  door.castShadow = false;
  house.add(walls, roof, door);
  house.position.set((rnd() - 0.5) * 0.12, elevation * LEVEL, -0.42);
  tile.add(house);
  return tile;
}

// Crops: short pale rows across the hex, low enough to see a unit over.
const ROWS = [-0.52, -0.26, 0, 0.26, 0.52];
function crops(elevation: number, hex: Hex): THREE.Group {
  const tile = ground(elevation, groundTint(elevation));
  const rnd = stream(hex);
  for (const z of ROWS) {
    const half = (Math.sqrt(3) / 2) * (1 - Math.abs(z) / 2) - 0.14;   // the hex is narrower away from its middle
    const row = box(half * 2, 0.13 + rnd() * 0.05, 0.1, TOKENS.hill2, 0, elevation * LEVEL, z, false);
    row.castShadow = false;
    tile.add(row);
  }
  return tile;
}

// A low wall: three stone lengths in front of where a unit stands, with a gap to step through.
const STONES: [number, number, number][] = [[-0.47, 0.4, 0.34], [0.02, 0.46, 0.5], [0.5, 0.4, 0.3]];   // x, z, length
function wall(elevation: number, hex: Hex): THREE.Group {
  const tile = ground(elevation, groundTint(elevation));
  const rnd = stream(hex);
  for (const [x, z, length] of STONES) {
    tile.add(box(length, 0.2 + rnd() * 0.06, 0.13, TOKENS.paper, x, elevation * LEVEL, z));
  }
  return tile;
}

// Water: the ground's own prism with a slate top, and ink ripples on it.
const rippleGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.2, 0, 0), new THREE.Vector3(0.2, 0, 0)]);
const RIPPLES: [number, number][] = [[-0.25, -0.35], [0.3, -0.05], [-0.1, 0.3]];
function water(elevation: number, hex: Hex): THREE.Group {
  const tile = ground(elevation, TOKENS.slate);
  const rnd = stream(hex);
  for (const [x, z] of RIPPLES) {
    const ripple = new THREE.Line(rippleGeo, contourLine);
    ripple.position.set(x + (rnd() - 0.5) * 0.2, elevation * LEVEL + 0.006, z + (rnd() - 0.5) * 0.12);
    tile.add(ripple);
  }
  return tile;
}

// ---- works (25)

// Sandbags: two courses of paper bags in front of where a unit stands, drawn as the wall is, a gap left at one end.
const bagGeo = new THREE.BoxGeometry(0.3, 0.13, 0.17);
function bag(x: number, y: number, z: number, turn: number): THREE.Mesh {
  const b = outline(solid(bagGeo, TOKENS.paper), 0.02);
  b.position.set(x, y + 0.065, z);
  b.rotation.y = turn;
  return b;
}
function sandbags(elevation: number, hex: Hex): THREE.Group {
  const tile = ground(elevation, groundTint(elevation));
  const rnd = stream(hex);
  const y = elevation * LEVEL;
  for (let i = 0; i < 4; i++) tile.add(bag(-0.5 + i * 0.32, y, 0.42, (rnd() - 0.5) * 0.12));
  for (let i = 0; i < 3; i++) tile.add(bag(-0.34 + i * 0.32, y + 0.13, 0.42, (rnd() - 0.5) * 0.12));
  return tile;
}

// Wire: ink crosses on posts across the hex, a strand between them. Nothing to hide behind.
const postGeo = new THREE.BoxGeometry(0.035, 0.34, 0.035);
const crossGeo = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-0.12, 0, 0), new THREE.Vector3(0.12, 0.28, 0),
  new THREE.Vector3(-0.12, 0.28, 0), new THREE.Vector3(0.12, 0, 0),
]);
const WIRE_POSTS: [number, number][] = [[-0.62, 0.05], [-0.2, -0.12], [0.2, 0.12], [0.62, -0.05]];
function wire(elevation: number, hex: Hex): THREE.Group {
  const tile = ground(elevation, groundTint(elevation));
  const rnd = stream(hex);
  const y = elevation * LEVEL;
  const strand: THREE.Vector3[] = [];
  for (const [x, z] of WIRE_POSTS) {
    const post = solid(postGeo, TOKENS.ink);
    post.position.set(x, y + 0.17, z);
    const cross = new THREE.LineSegments(crossGeo, inkLine);
    cross.position.set(x, y, z);
    cross.rotation.y = (rnd() - 0.5) * 0.6;
    tile.add(post, cross);
    strand.push(new THREE.Vector3(x, y + 0.22, z), new THREE.Vector3(x, y + 0.1, z));
  }
  const strands: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < strand.length; i += 2) strands.push(strand[i], strand[i + 2], strand[i + 1], strand[i + 3]);
  tile.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(strands), inkLine));
  return tile;
}

// An MG nest: a ring of sandbags round where a unit stands, with a low roof line over the back of it.
const NEST_BAGS = 9;
const NEST_RING = 0.6;
const slabGeo = new THREE.BoxGeometry(0.95, 0.05, 0.42);
const slabEdges = new THREE.EdgesGeometry(slabGeo);
function nest(elevation: number, hex: Hex): THREE.Group {
  const tile = ground(elevation, groundTint(elevation));
  const rnd = stream(hex);
  const y = elevation * LEVEL;
  for (let i = 0; i < NEST_BAGS; i++) {
    // Most of a ring, open at the back where the roof is propped.
    const a = Math.PI * 0.2 + (i / (NEST_BAGS - 1)) * Math.PI * 1.6;
    const b = bag(Math.sin(a) * NEST_RING, y, Math.cos(a) * NEST_RING, a + Math.PI / 2 + (rnd() - 0.5) * 0.1);
    tile.add(b);
    if (i % 2 === 0) tile.add(bag(Math.sin(a) * NEST_RING, y + 0.13, Math.cos(a) * NEST_RING, a + Math.PI / 2));
  }
  const roof = outline(solid(slabGeo, TOKENS.khaki), 0.02);
  roof.position.set(0, y + 0.36, -0.42);
  roof.rotation.x = 0.12;
  roof.add(new THREE.LineSegments(slabEdges, inkLine));
  for (const x of [-0.42, 0.42]) {
    const post = solid(postGeo, TOKENS.ink);
    post.position.set(x, y + 0.17, -0.3);
    tile.add(post);
  }
  tile.add(roof);
  return tile;
}

function open(elevation: number, hex: Hex): THREE.Group {
  const tile = ground(elevation, groundTint(elevation));
  // Tall enough to read at the board's framed zoom (28 px a unit, the tilt taking a fifth off): the capitals
  // are about 0.6 of this, so 0.44 gives about 6 px of cap height there and 25 px at the closest zoom.
  const name = text(label(hex), 0.44, TOKENS.ink, 0.75);
  if (name) {
    layFlat(name.geometry);
    // At the far corner: no hill in front can ever cover it there.
    name.position.set(0, elevation * LEVEL + 0.008, -0.7);
    tile.add(name);
  }
  return tile;
}

/** Unknown ids fall back to a plain khaki prism. */
export function tile(terrain: TerrainId, elevation: number, hex: Hex): THREE.Object3D {
  const level = Number.isFinite(elevation) ? Math.max(0, elevation) : 0;
  if (terrain === 'open') return open(level, hex);
  if (terrain === 'woods') return woods(level, hex);
  if (terrain === 'building') return building(level, hex);
  if (terrain === 'crops') return crops(level, hex);
  if (terrain === 'wall') return wall(level, hex);
  if (terrain === 'water') return water(level, hex);
  if (terrain === 'sandbags') return sandbags(level, hex);
  if (terrain === 'wire') return wire(level, hex);
  if (terrain === 'nest') return nest(level, hex);
  const plain = new THREE.Group();
  const mesh = new THREE.Mesh(prism(level).body, lit(TOKENS.khaki));
  mesh.receiveShadow = true;
  plain.add(mesh);
  return plain;
}

/** A see-through amber wash over a hex top: where an objective is. */
export function hexWash(opacity: number): THREE.Mesh {
  return new THREE.Mesh(layFlat(new THREE.CircleGeometry(0.93, 6, Math.PI / 6)), flat(TOKENS.amber, opacity, true));
}
