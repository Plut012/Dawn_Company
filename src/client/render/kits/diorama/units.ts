// The diorama's one figure: a rifleman as a painted miniature, on a drawn base.
//
// The man is real: wool tunic and trousers, canvas webbing and pack, steel helmet, boots and anklets, a
// rifle at the port. He is seven rigid pieces on joints (hips, trunk with arms and rifle, head, two thighs,
// two shins), each one merged geometry with its paint baked into vertex colours the way a miniature is
// painted: a base coat, lighter where a surface faces up (a zenithal highlight), so he reads in poor light.
// The base is drawn: the player's colour and mark, inked, unlit, as lowpoly's; only the man's shadow falls on it.

import * as THREE from 'three';
import type { PlayerId, UnitStatus } from '../../../../shared/types';
import type { UnitVisual } from '../../kit';
import { UNITS } from '../../../../content';
import { TOKENS, layFlat } from '../lowpoly/parts';
import { PLAYERS, burst, outlineOf, setRig } from '../lowpoly/units';
import type { Look } from './look';
import { streamOf } from './noise';
import { Sculpt, v } from './sculpt';

// ---- the paint box

const TUNIC = '#7a744b';
const TROUSERS = '#6c6846';
const WEBBING = '#b9b086';
const PACK = '#8d855a';
const HELMET = '#47513a';
const SKIN = '#c79f83';
const LEATHER = '#2c2521';
const WOOD = '#6e4728';
const STEEL = '#34373b';
const BURLAP = '#a69873';
const SPOIL = '#4e3d2a';
const WOOL = 0.96;
const CANVAS = 0.85;

// ---- the man, standing, facing +z (his left is +x); lengths in world units, about 1 tall

const HIP_Y = 0.495;                 // hips above his soles
const HIP_X = 0.075;
const THIGH = 0.23;
const SHIN = 0.2;
const SPINE_Y = 0.05;                // trunk's root above the hips
const NECK_Y = 0.3;                  // neck above the trunk's root
const SHOULDER = v(0.15, 0.255, 0);  // his left one, from the trunk's root

/** The elbow of an arm of two lengths from shoulder to hand, bent towards `pole`. */
function elbow(shoulder: THREE.Vector3, hand: THREE.Vector3, upper: number, fore: number, pole: THREE.Vector3): THREE.Vector3 {
  const to = hand.clone().sub(shoulder);
  const d = Math.min(to.length(), upper + fore - 0.001);
  const u = to.normalize();
  const a = (upper * upper - fore * fore + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  const out = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
  return shoulder.clone().addScaledVector(u, a).addScaledVector(out, h);
}

interface Pieces { pelvis: THREE.BufferGeometry; trunk: THREE.BufferGeometry; head: THREE.BufferGeometry; thigh: THREE.BufferGeometry; shin: THREE.BufferGeometry }
let pieces: Pieces | null = null;

function sculpt(): Pieces {
  if (pieces) return pieces;

  // Pelvis: the skirt of the tunic, a water bottle on the right hip.
  const skirt = new THREE.LatheGeometry([
    new THREE.Vector2(0.001, -0.115), new THREE.Vector2(0.132, -0.11), new THREE.Vector2(0.126, -0.02), new THREE.Vector2(0.116, 0.07),
  ], 12).scale(1, 1, 0.7);
  const pelvis = new Sculpt()
    .add(skirt, TUNIC, WOOL)
    .ball(v(-0.118, -0.03, -0.03), 0.045, PACK, CANVAS, [0.7, 1.1, 0.9])
    .build();

  // Trunk: chest, belt and braces, pouches, the small pack with a rolled cape, both arms, and the rifle they hold.
  const chest = new THREE.LatheGeometry([
    new THREE.Vector2(0.116, 0), new THREE.Vector2(0.128, 0.1), new THREE.Vector2(0.146, 0.2),
    new THREE.Vector2(0.134, 0.262), new THREE.Vector2(0.062, 0.3), new THREE.Vector2(0.001, 0.302),
  ], 12).scale(1, 1, 0.66);
  const trunk = new Sculpt().add(chest, TUNIC, WOOL);
  trunk.add(new THREE.CylinderGeometry(0.121, 0.121, 0.036, 12).scale(1, 1, 0.68).translate(0, 0.012, 0), WEBBING, CANVAS);
  trunk.add(new THREE.CylinderGeometry(0.05, 0.058, 0.03, 10).translate(0, 0.3, 0), TUNIC, WOOL);                 // collar
  for (const side of [-1, 1]) {
    trunk.ball(v(side * SHOULDER.x, SHOULDER.y, 0), 0.056, TUNIC, WOOL);
    trunk.box([0.03, 0.27, 0.012], v(side * 0.062, 0.155, 0.089), WEBBING, CANVAS, 0, [-0.07, 0, side * -0.06]);   // braces, front
    trunk.box([0.03, 0.27, 0.012], v(side * 0.062, 0.155, -0.089), WEBBING, CANVAS, 0, [0.07, 0, side * -0.06]);   // and back
    trunk.box([0.062, 0.07, 0.036], v(side * 0.068, 0.05, 0.088), WEBBING, CANVAS);                                // pouches
  }
  trunk.box([0.18, 0.15, 0.07], v(0, 0.165, -0.128), PACK, CANVAS, 0, [0.06, 0, 0]);
  trunk.add(new THREE.CylinderGeometry(0.032, 0.032, 0.2, 8).rotateZ(Math.PI / 2).translate(0, 0.262, -0.118), TROUSERS, WOOL);
  trunk.box([0.02, 0.17, 0.045], v(0.11, 0.07, -0.1), WOOD, 0.6, 0, [0.1, 0, 0.1]);                               // entrenching tool's helve

  // The rifle, built butt to muzzle along its own length, then laid across the chest: muzzle up by the left shoulder.
  const RIFLE_TURN = -0.82;
  const RIFLE_MID = v(-0.005, 0.135, 0.135);
  const along = v(-Math.sin(RIFLE_TURN), Math.cos(RIFLE_TURN), 0);
  const onRifle = (d: number, lift = 0) => RIFLE_MID.clone().addScaledVector(along, d).add(v(0, 0, lift));
  const turn: [number, number, number] = [0, 0, RIFLE_TURN];
  trunk.box([0.05, 0.17, 0.028], onRifle(-0.25), WOOD, 0.55, 0, turn);             // butt
  trunk.box([0.036, 0.13, 0.03], onRifle(-0.11), STEEL, 0.4, 0.7, turn);           // action
  trunk.box([0.03, 0.3, 0.026], onRifle(0.1), WOOD, 0.55, 0, turn);                // fore-stock
  trunk.limb(onRifle(-0.05, 0.002), onRifle(0.34, 0.002), 0.011, 0.009, STEEL, 0.4, 0.7);   // barrel
  trunk.box([0.012, 0.42, 0.006], onRifle(0.0, -0.02), WEBBING, CANVAS, 0, turn);  // sling
  // Arms: the right hand at the small of the butt, the left under the fore-stock; elbows found from the hands.
  const UPPER = 0.17;
  const FORE = 0.17;
  const hands: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
    [v(-SHOULDER.x, SHOULDER.y, 0), onRifle(-0.15, 0.012), v(-0.7, -0.5, -0.35)],
    [SHOULDER.clone(), onRifle(0.1, 0.02), v(0.75, -0.6, 0.1)],
  ];
  for (const [shoulder, hand, pole] of hands) {
    const bend = elbow(shoulder, hand, UPPER, FORE, pole);
    trunk.limb(shoulder, bend, 0.05, 0.043, TUNIC, WOOL);
    trunk.limb(bend, hand, 0.043, 0.036, TUNIC, WOOL);
    trunk.ball(hand, 0.036, SKIN, 0.7);
  }

  // Head: neck, face (in the helmet's shade above the brow), nose, and the helmet with its rim.
  const HEAD = v(0, 0.088, 0.004);
  const shell = new THREE.LatheGeometry([
    new THREE.Vector2(0.084, -0.03), new THREE.Vector2(0.112, -0.041), new THREE.Vector2(0.112, -0.034), new THREE.Vector2(0.092, -0.02),
    new THREE.Vector2(0.088, 0.008), new THREE.Vector2(0.074, 0.044), new THREE.Vector2(0.045, 0.071), new THREE.Vector2(0.001, 0.08),
  ], 14).scale(1, 1, 1.12).translate(HEAD.x, HEAD.y + 0.034, HEAD.z);
  const head = new Sculpt()
    .add(new THREE.CylinderGeometry(0.034, 0.038, 0.06, 8).translate(0, 0.022, 0), SKIN, 0.7)
    .ball(HEAD, 0.068, SKIN, 0.7, [0.9, 1.08, 0.98], (p) => (p.y > HEAD.y + 0.012 ? 0.55 : 1))
    .ball(v(0, HEAD.y - 0.012, HEAD.z + 0.064), 0.014, SKIN, 0.7)
    .add(shell, HELMET, 0.5, 0.25)
    .build();

  // Legs: the same thigh and shin on both sides. The shin wears the anklet and the boot.
  const thigh = new Sculpt().limb(v(0, 0, 0), v(0, -THIGH, 0), 0.064, 0.052, TROUSERS, WOOL).build();
  const shin = new Sculpt()
    .limb(v(0, 0, 0), v(0, -SHIN + 0.03, 0), 0.052, 0.042, TROUSERS, WOOL)
    .add(new THREE.CylinderGeometry(0.047, 0.044, 0.075, 8).translate(0, -SHIN + 0.025, 0), WEBBING, CANVAS)
    .ball(v(0, -SHIN - 0.032, 0.03), 0.05, LEATHER, 0.5, [0.95, 0.76, 1.75])
    .box([0.085, 0.03, 0.07], v(0, -SHIN - 0.055, -0.02), LEATHER, 0.5)
    .build();

  pieces = { pelvis, trunk: trunk.build(), head, thigh, shin };
  return pieces;
}

// ---- the foxhole (24): a scrape of earth round him and two courses of sandbags to his front

const BAG_RING = 0.72;      // the hex is 0.866 from its middle to a side: the bags stay inside it
let scrapeGeo: THREE.BufferGeometry | null = null;

function scrape(): THREE.BufferGeometry {
  if (scrapeGeo) return scrapeGeo;
  const rnd = streamOf(2426);
  const s = new Sculpt();
  // Spoil thrown up round the hole: a low lumpy ring.
  const ring = new THREE.TorusGeometry(BAG_RING, 0.1, 5, 26).rotateX(Math.PI / 2).scale(1, 0.55, 1).toNonIndexed();
  const at = ring.getAttribute('position');
  const lump = new Map<string, number>();
  for (let i = 0; i < at.count; i++) {
    const id = `${at.getX(i).toFixed(3)}/${at.getY(i).toFixed(3)}/${at.getZ(i).toFixed(3)}`;
    if (!lump.has(id)) lump.set(id, 0.82 + rnd() * 0.4);
    const k = lump.get(id)!;
    at.setXYZ(i, at.getX(i) * (0.97 + (k - 1) * 0.12), Math.max(0, at.getY(i)) * k, at.getZ(i) * (0.97 + (k - 1) * 0.12));
  }
  ring.computeVertexNormals();
  s.add(ring, SPOIL, 1, 0, () => 0.8 + rnd() * 0.35);
  // Bags: a lower course most of the way round, open behind him, and an upper course to the front.
  const bag = (a: number, y: number, r: number) => {
    const shade = 0.82 + rnd() * 0.3;
    const g = new THREE.SphereGeometry(1, 9, 6).scale(0.165, 0.062, 0.092)
      .rotateY(a + (rnd() - 0.5) * 0.16).translate(Math.sin(a) * r, y, Math.cos(a) * r);
    s.add(g, BURLAP, 1, 0, () => shade);
  };
  const LOWER = 10;
  for (let i = 0; i < LOWER; i++) bag(-Math.PI * 0.72 + (i / (LOWER - 1)) * Math.PI * 1.44, 0.1, BAG_RING);
  const UPPER = 6;
  for (let i = 0; i < UPPER; i++) bag(-Math.PI * 0.4 + (i / (UPPER - 1)) * Math.PI * 0.8, 0.2, BAG_RING - 0.015);
  scrapeGeo = s.build();
  return scrapeGeo;
}

// ---- the base: drawn

const BASE_R = 0.6;
const BASE_H = 0.07;
const baseGeo = new THREE.CylinderGeometry(BASE_R, BASE_R, BASE_H, 32).translate(0, BASE_H / 2, 0);
const baseRimGeo = new THREE.CylinderGeometry(BASE_R + 0.04, BASE_R + 0.04, BASE_H - 0.015, 32).translate(0, (BASE_H - 0.015) / 2, 0);
const baseTopGeo = layFlat(new THREE.CircleGeometry(BASE_R, 32));
const shadowOnBase = new THREE.ShadowMaterial({ opacity: 0.42, depthWrite: false });
const markGeo = new Map<string, THREE.BufferGeometry>();
function markShape(owner: PlayerId, grow: number): THREE.BufferGeometry {
  const id = `${owner}/${grow}`;
  let g = markGeo.get(id);
  if (!g) {
    g = layFlat(new THREE.ShapeGeometry(outlineOf(PLAYERS[owner].shape, grow), 10));
    markGeo.set(id, g);
  }
  return g;
}

/**
 * The disc in the player's colour with an ink rim, the player's mark in paper at its front; the man's shadow
 * falls on it. Drawn, so never in the mist; the disc and the mark follow the dawn (dimmer at first light, the
 * hue kept), so that Amber and Rust stay the loudest things on a dark board. Every unit of this kit stands on one.
 */
export function base(look: Look, owner: PlayerId): THREE.Group {
  const g = new THREE.Group();
  const player = PLAYERS[owner];
  const disc = new THREE.Mesh(baseGeo, look.drawn(player?.color ?? TOKENS.khaki, 1));
  const shade = new THREE.Mesh(baseTopGeo, shadowOnBase);
  shade.position.y = BASE_H + 0.002;
  shade.receiveShadow = true;
  shade.renderOrder = 1;             // after the disc it lies on
  g.add(disc, new THREE.Mesh(baseRimGeo, look.drawn(TOKENS.ink)), shade);
  if (player) {
    const edge = new THREE.Mesh(markShape(owner, 0.035), look.drawn(TOKENS.ink));
    edge.position.set(0, BASE_H + 0.004, 0.3);
    const fill = new THREE.Mesh(markShape(owner, 0), look.drawn(TOKENS.paper, 0.45));
    fill.position.set(0, BASE_H + 0.008, 0.3);
    g.add(edge, fill);
  }
  return g;
}

// ---- poses: every number a status sets; an effect may show any point between two

interface Pose {
  x: number; y: number; z: number;      // where his hips are, above the unit's origin
  heading: number; tip: number;         // turned about his height, then tipped back (negative: onto his back)
  spine: number; nod: number; look: number;
  thighL: number; splayL: number; kneeL: number;
  thighR: number; splayR: number; kneeR: number;
  mark: number;                         // the rust burst's size
}
const FACING = 0.45;   // a quarter turn off the camera, as lowpoly's figures stand, so the rifle shows in silhouette

const POSES: Record<UnitStatus, Pose> = {
  // Standing easy, weight on the right leg, rifle at the port.
  ready: {
    x: 0, y: BASE_H + HIP_Y, z: -0.14, heading: FACING, tip: 0, spine: 0.06, nod: 0.02, look: -0.3,
    thighL: -0.17, splayL: 0.06, kneeL: 0.2, thighR: 0.09, splayR: -0.05, kneeR: 0.1, mark: 0,
  },
  // Down on his right knee, hunched over the rifle, head up.
  pinned: {
    x: 0, y: BASE_H + 0.3, z: -0.12, heading: FACING, tip: 0, spine: 0.6, nod: -0.3, look: -0.3,
    thighL: -1.45, splayL: 0.12, kneeL: 1.5, thighR: 0.2, splayR: -0.06, kneeR: 1.38, mark: 1,
  },
  // Flat on his back across the base, head to the left, one knee up.
  down: {
    x: 0, y: BASE_H + 0.17, z: -0.06, heading: Math.PI / 2, tip: -Math.PI / 2, spine: -0.04, nod: -0.3, look: 0.5,
    thighL: 0.14, splayL: 0.2, kneeL: 0.12, thighR: -0.55, splayR: -0.12, kneeR: 1.0, mark: 0,
  },
};

const leanAxis = new THREE.Vector3();

export function rifleman(look: Look, owner: PlayerId): UnitVisual {
  const object = new THREE.Group();
  const geo = sculpt();
  const parts: THREE.Mesh[] = [];
  const piece = (g: THREE.BufferGeometry): THREE.Mesh => {
    const m = new THREE.Mesh(g, look.paint);
    m.castShadow = true;
    m.receiveShadow = true;
    parts.push(m);
    return m;
  };
  const joint = (parent: THREE.Object3D, x: number, y: number, z: number, ...children: THREE.Object3D[]): THREE.Group => {
    const j = new THREE.Group();
    j.position.set(x, y, z);
    j.add(...children);
    parent.add(j);
    return j;
  };

  // lean > hips > (spine > head, two legs > shins). `lean` tips him about his feet for a dash.
  const lean = new THREE.Group();
  const hips = joint(lean, 0, 0, 0, piece(geo.pelvis));
  hips.rotation.order = 'YXZ';
  const spine = joint(hips, 0, SPINE_Y, 0, piece(geo.trunk));
  const head = joint(spine, 0, NECK_Y, 0, piece(geo.head));
  const thighL = joint(hips, HIP_X, 0, 0, piece(geo.thigh));
  const thighR = joint(hips, -HIP_X, 0, 0, piece(geo.thigh));
  const shinL = joint(thighL, 0, -THIGH, 0, piece(geo.shin));
  const shinR = joint(thighR, 0, -THIGH, 0, piece(geo.shin));

  const stand = base(look, owner);
  const pinnedMark = burst();
  const hole = new THREE.Mesh(scrape(), look.paint);
  hole.castShadow = true;
  hole.receiveShadow = true;
  hole.visible = false;
  object.add(stand, lean, pinnedMark, hole);
  look.dress(object);

  let current: UnitStatus = 'ready';

  function blend(from: UnitStatus, to: UnitStatus, k: number): void {
    const a = POSES[from] ?? POSES.ready;
    const b = POSES[to] ?? POSES.ready;
    const mix = (key: keyof Pose) => a[key] + (b[key] - a[key]) * k;
    hips.position.set(mix('x'), mix('y'), mix('z'));
    hips.rotation.set(mix('tip'), mix('heading'), 0);
    spine.rotation.x = mix('spine');
    head.rotation.set(mix('nod'), mix('look'), 0);
    thighL.rotation.set(mix('thighL'), 0, mix('splayL'));
    thighR.rotation.set(mix('thighR'), 0, mix('splayR'));
    shinL.rotation.x = mix('kneeL');
    shinR.rotation.x = mix('kneeR');
    const size = mix('mark');
    pinnedMark.visible = size > 0.01;
    pinnedMark.scale.setScalar(Math.max(size, 0.01));
    // Down: the paint goes to slate, as lowpoly greys its figure.
    const paint = (k < 0.5 ? from : to) === 'down' ? look.faded : look.paint;
    for (const part of parts) part.material = paint;
  }

  function setStatus(status: UnitStatus): void {
    current = status;
    blend(status, status, 1);
  }

  function dig(k: number): void {
    hole.visible = k > 0.01;
    hole.scale.set(1, Math.max(k, 0.01), 1);
  }

  // The rig lowpoly's effects drive: a hit, a stand, a dash's lean and a dig all work on this figure.
  setRig(object, {
    dig,
    status: () => current,
    blend,
    mark: pinnedMark,
    lean(dx, dz, angle) {
      lean.quaternion.setFromAxisAngle(leanAxis.set(dz, 0, -dx).normalize(), angle);
    },
    dashes: (step) => step > (UNITS.rifleman?.move ?? Infinity),
  });

  setStatus('ready');
  return { object, setStatus, setDugIn: (dug) => dig(dug ? 1 : 0) };
}
