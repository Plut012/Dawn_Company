// Map marks: amber grease pencil on the map. Meanings are fixed by
// docs/design.md; this file only decides how they are drawn.
//   select  - bold amber ring
//   path    - dashed amber stroke with an arrowhead (two heads for a dash)
//   target  - thin dashed line of fire to a crosshair; blast hexes outlined
//   ambush  - broken ring with an eye above it
//   options - thin amber hex outlines
// Every mark is drawn twice: once properly in the world, and once faintly
// through whatever stands in front, so a tree or a house never hides an order.

import * as THREE from 'three';
import type { Hex, Objective, PlayerId } from '../../../../shared/types';
import { hexToPixel, within } from '../../../../shared/hex';
import type { KitCtx } from '../../kit';
import type { Mark } from '../../index';
import { FACE_CAMERA, TOKENS, flat, layFlat, text } from './parts';
import { hexWash } from './tiles';
import { PLAYERS, outlineOf } from './units';
import type { MarkShape } from './units';

const LIFT = 0.05;                   // marks float just above the ground
const pencil = flat(TOKENS.amber, 1, true);
const ghost = new THREE.MeshBasicMaterial({
  color: TOKENS.amber, transparent: true, opacity: 0.28, depthTest: false, depthWrite: false,
});

function drawn(geometry: THREE.BufferGeometry, at?: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const through = new THREE.Mesh(geometry, ghost);
  through.renderOrder = 5;
  g.add(new THREE.Mesh(geometry, pencil), through);
  if (at) g.position.set(at.x, at.y + LIFT, at.z);
  return g;
}

// ---- strokes

/** Collects flat quads and triangles into one geometry. */
class Strokes {
  private v: number[] = [];
  quad(a: THREE.Vector3, b: THREE.Vector3, halfWidth: number): void {
    const side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x);
    if (side.lengthSq() < 1e-9) return;
    side.normalize().multiplyScalar(halfWidth);
    const p = [a.clone().add(side), a.clone().sub(side), b.clone().sub(side), b.clone().add(side)];
    this.tri(p[0], p[1], p[2]);
    this.tri(p[0], p[2], p[3]);
  }
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
    // Wind every triangle to face up, whichever way it was given.
    const up = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x) < 0;
    for (const p of up ? [a, b, c] : [a, c, b]) this.v.push(p.x, p.y + LIFT, p.z);
  }
  /** An arrowhead with its tip at `tip`, pointing along `dir` (flat). */
  head(tip: THREE.Vector3, dir: THREE.Vector3, length: number, halfWidth: number): void {
    const back = tip.clone().addScaledVector(dir, -length);
    const side = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(halfWidth);
    this.tri(tip, back.clone().add(side), back.clone().sub(side));
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.v, 3));
    return g;
  }
}

/** Dashes along a run of points, between distances `from` and `to` along it. */
function dashes(
  out: Strokes, pts: THREE.Vector3[], from: number, to: number,
  halfWidth: number, on: number, off: number,
): void {
  let travelled = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = a.distanceTo(b);
    if (Math.hypot(b.x - a.x, b.z - a.z) > 1e-6) {       // a step straight up is not drawn
      const first = Math.floor((travelled - from) / (on + off));
      for (let n = Math.max(0, first); ; n++) {
        const s = Math.max(from + n * (on + off), travelled, from);
        const e = Math.min(from + n * (on + off) + on, travelled + len, to);
        if (from + n * (on + off) >= Math.min(travelled + len, to)) break;
        if (e > s) out.quad(a.clone().lerp(b, (s - travelled) / len), a.clone().lerp(b, (e - travelled) / len), halfWidth);
      }
    }
    travelled += len;
  }
}

function pathMark(from: Hex, path: Hex[], dash: boolean, ctx: KitCtx): THREE.Object3D {
  const centres = [from, ...path].map((h) => ctx.hexToWorld(h));
  // Follow the ground: where the level changes, climb at the shared edge.
  const pts: THREE.Vector3[] = [];
  centres.forEach((c, i) => {
    if (i > 0 && Math.abs(c.y - centres[i - 1].y) > 1e-6) {
      const p = centres[i - 1];
      pts.push(new THREE.Vector3((p.x + c.x) / 2, p.y, (p.z + c.z) / 2));
      pts.push(new THREE.Vector3((p.x + c.x) / 2, c.y, (p.z + c.z) / 2));
    }
    pts.push(c);
  });
  const out = new Strokes();
  if (pts.length >= 2) {
    let total = 0;
    for (let i = 0; i + 1 < pts.length; i++) total += pts[i].distanceTo(pts[i + 1]);
    const tip = pts[pts.length - 1];
    const before = centres[centres.length - 2];
    const dir = new THREE.Vector3(tip.x - before.x, 0, tip.z - before.z).normalize();
    const headLen = 0.5;
    const heads = dash ? 2 : 1;
    dashes(out, pts, 0.7, total - headLen * (heads === 2 ? 1.55 : 0.8), 0.085, 0.36, 0.2);
    for (let n = 0; n < heads; n++) {
      out.head(tip.clone().addScaledVector(dir, -n * headLen * 0.75), dir, headLen, 0.3);
    }
  }
  return drawn(out.geometry());
}

const hexLine = (inner: number, outer: number): THREE.BufferGeometry =>
  layFlat(new THREE.RingGeometry(inner, outer, 6, 1, Math.PI / 6));
const ringGeo = layFlat(new THREE.RingGeometry(0.66, 0.82, 40));
const optionGeo = hexLine(0.8, 0.88);
const blastGeo = hexLine(0.74, 0.9);
const dotGeo = layFlat(new THREE.CircleGeometry(0.09, 12));

const reticleGeo = (() => {
  const out = new Strokes();
  const o = new THREE.Vector3();
  for (let i = 0; i < 4; i++) {
    const d = new THREE.Vector3(Math.cos((i * Math.PI) / 2), 0, Math.sin((i * Math.PI) / 2));
    out.quad(o.clone().addScaledVector(d, 0.42), o.clone().addScaledVector(d, 0.95), 0.055);
  }
  const g = out.geometry().translate(0, -LIFT, 0);
  return g;
})();
const reticleRing = layFlat(new THREE.RingGeometry(0.6, 0.7, 40));

function targetMark(from: Hex, hex: Hex, blast: number, ctx: KitCtx): THREE.Object3D {
  const g = new THREE.Group();
  const a = ctx.hexToWorld(from).add(new THREE.Vector3(0, 0.75, 0));
  const b = ctx.hexToWorld(hex);
  g.add(drawn(reticleGeo, b), drawn(reticleRing, b));
  for (const h of within(hex, Math.max(0, blast))) {
    if (h.q === hex.q && h.r === hex.r) continue;
    g.add(drawn(blastGeo, ctx.hexToWorld(h)));
  }
  // The line of fire runs through the air, from chest height to the ground.
  const line = new Strokes();
  const len = a.distanceTo(b);
  if (len > 1.2) dashes(line, [a, b], 0.5, len - 0.75, 0.035, 0.22, 0.16);
  g.add(drawn(line.geometry()));
  return g;
}

const eyeGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.34, 0);
  s.quadraticCurveTo(0, 0.3, 0.34, 0);
  s.quadraticCurveTo(0, -0.3, -0.34, 0);
  const pupil = new THREE.Path();
  pupil.absarc(0, 0, 0.085, 0, Math.PI * 2, true);
  s.holes.push(pupil);
  return new THREE.ShapeGeometry(s, 10);
})();
const eyeEdge = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.41, 0);
  s.quadraticCurveTo(0, 0.38, 0.41, 0);
  s.quadraticCurveTo(0, -0.38, -0.41, 0);
  return new THREE.ShapeGeometry(s, 10);
})();
const brokenRing = (() => {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    out.push(new THREE.RingGeometry(0.68, 0.82, 6, 1, (i * Math.PI) / 4 + 0.12, Math.PI / 4 - 0.24));
  }
  const v: number[] = [];
  for (const g of out) {
    const flatG = g.toNonIndexed();
    v.push(...(flatG.getAttribute('position').array as Float32Array));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return layFlat(g);
})();

function ambushMark(hex: Hex, ctx: KitCtx): THREE.Object3D {
  const at = ctx.hexToWorld(hex);
  const g = new THREE.Group();
  g.add(drawn(brokenRing, at));
  // The eye floats over the unit's head, leaning back to face the camera.
  const eye = new THREE.Group();
  const edge = new THREE.Mesh(eyeEdge, flat(TOKENS.ink));
  edge.position.z = -0.01;
  eye.add(edge, new THREE.Mesh(eyeGeo, flat(TOKENS.amber)));
  eye.position.set(at.x, at.y + 1.55, at.z - 0.16);
  eye.rotation.x = FACE_CAMERA;
  g.add(eye);
  return g;
}

/** Unknown kinds draw nothing. */
export function mark(m: Mark, ctx: KitCtx): THREE.Object3D {
  switch (m.kind) {
    case 'select': return drawn(ringGeo, ctx.hexToWorld(m.hex));
    case 'path': return pathMark(m.from, m.path, m.dash, ctx);
    case 'target': return targetMark(m.from, m.hex, m.blast, ctx);
    case 'ambush': return ambushMark(m.hex, ctx);
    case 'options': {
      const g = new THREE.Group();
      for (const h of m.hexes) {
        const at = ctx.hexToWorld(h);
        g.add(drawn(optionGeo, at), drawn(dotGeo, at));
      }
      return g;
    }
    default: return new THREE.Group();
  }
}

// ---- objective: an amber wash over each hex of the area, and a flag
//
// The flag stands on the middle hex of the area (in drawing order). Its cloth
// is the owner's player colour with their mark on it, as on a unit's base; a
// plain bone cloth for nobody. An HQ's flag is taller. The objective's letter
// is on an amber tag on the pole.
//
// The object's origin is the top of the area's first hex. Each wash and the
// flag carry `userData.hex`, and the board lifts them to their own hex's height.

const tagGeo = new THREE.CircleGeometry(0.22, 20);
const tagEdge = new THREE.CircleGeometry(0.26, 20);
const postGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 5).translate(0, 0.5, 0);
const CLOTH_W = 0.62;
const CLOTH_H = 0.4;
const clothGeo = new THREE.PlaneGeometry(CLOTH_W, CLOTH_H).translate(CLOTH_W / 2, -CLOTH_H / 2, 0);
const clothEdge = new THREE.PlaneGeometry(CLOTH_W + 0.06, CLOTH_H + 0.06).translate(CLOTH_W / 2, -CLOTH_H / 2, 0);
const faceGeo = new Map<string, THREE.BufferGeometry>();
function face(shape: MarkShape, grow: number): THREE.BufferGeometry {
  const id = `${shape}/${grow}`;
  let g = faceGeo.get(id);
  if (!g) {
    g = new THREE.ShapeGeometry(outlineOf(shape, grow), 10).scale(0.62, 0.62, 1);
    faceGeo.set(id, g);
  }
  return g;
}

/** The cloth of a flag in the owner's colour and mark: its top left corner at the origin, facing +z. */
function cloth(owner: PlayerId | null): THREE.Group {
  const g = new THREE.Group();
  const player = owner === null ? undefined : PLAYERS[owner];
  const edge = new THREE.Mesh(clothEdge, flat(TOKENS.ink));
  edge.position.set(-0.03, 0.03, -0.01);
  g.add(edge, new THREE.Mesh(clothGeo, flat(player?.color ?? TOKENS.bone)));
  if (player) {
    const ink = new THREE.Mesh(face(player.shape, 0.035), flat(TOKENS.ink));
    ink.position.set(CLOTH_W / 2, -CLOTH_H / 2, 0.005);
    const fill = new THREE.Mesh(face(player.shape, 0), flat(TOKENS.paper));
    fill.position.set(CLOTH_W / 2, -CLOTH_H / 2, 0.01);
    g.add(ink, fill);
  }
  g.userData.owner = owner;
  return g;
}

export function objective(obj: Objective, owner: PlayerId | null): THREE.Object3D {
  const g = new THREE.Group();
  const origin = hexToPixel(obj.hexes[0], 1);
  const at = (h: Hex) => { const p = hexToPixel(h, 1); return { x: p.x - origin.x, z: p.y - origin.y }; };
  for (const h of obj.hexes) {
    const wash = hexWash(0.42);
    const p = at(h);
    wash.position.set(p.x, 0.012, p.z);
    wash.userData.hex = h;
    g.add(wash);
  }

  const hq = obj.zone !== null;
  const HEIGHT = hq ? 2.05 : 1.45;
  const stand = obj.hexes[Math.floor(obj.hexes.length / 2)];
  const flag = new THREE.Group();
  const p = at(stand);
  flag.position.set(p.x, 0, p.z);
  flag.userData.hex = stand;
  const post = new THREE.Mesh(postGeo, flat(TOKENS.ink));
  post.scale.y = HEIGHT;
  post.position.z = -0.45;
  post.castShadow = true;
  // The cloth hangs from the top of the pole, leaning back to face the camera like every sign.
  const banner = new THREE.Group();
  banner.position.set(0.03, HEIGHT, -0.45);
  banner.rotation.x = FACE_CAMERA;
  let current = cloth(owner);
  banner.add(current);
  const tag = new THREE.Group();
  const edge = new THREE.Mesh(tagEdge, flat(TOKENS.ink));
  edge.position.z = -0.01;
  tag.add(edge, new THREE.Mesh(tagGeo, flat(TOKENS.amber)));
  const letter = text(obj.id, 0.36, TOKENS.ink);
  if (letter) {
    letter.position.z = 0.01;
    tag.add(letter);
  }
  tag.position.set(0, 0.62, -0.42);
  tag.rotation.x = FACE_CAMERA;
  flag.add(post, banner, tag);
  g.add(flag);

  g.userData.sign = banner;   // the part that pulses when the flag earns or changes hands (effects.ts)
  g.userData.flag = flag;     // where the flag stands
  g.userData.setOwner = (next: PlayerId | null) => {
    banner.remove(current);
    current = cloth(next);
    banner.add(current);
  };
  return g;
}
