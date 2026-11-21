// The diorama's figures: the squad as painted miniatures, each on a drawn base.
//
// A man is real: wool tunic and trousers, canvas webbing, steel helmet, boots and anklets. He is seven rigid
// pieces on joints (hips, trunk with arms and whatever he carries, head, two thighs, two shins), each one merged
// geometry with its paint baked into vertex colours the way a miniature is painted: a base coat, lighter where a
// surface faces up (a zenithal highlight), so he reads in poor light. Legs and hips are the same for every man;
// a type is its trunk (what the arms hold, what is on the back), its head, and how it stands:
// - rifleman: standing, rifle at the port;
// - gunner (29): belly down behind a light machine gun on its bipod, the gun's length the thing one reads;
// - sniper (29): kneeling, a long scoped rifle levelled, scrim on helmet and shoulders;
// - mortar (29): two men kneeling at a tube on its baseplate and bipod, one at the muzzle, one with a round;
// - medic (29): standing, no weapon, a satchel on each hip, a pale helmet with a small dull cross and an armband;
// - engineer (29): standing, no weapon, a shovel over the shoulder, a coil of wire on his back, a sandbag in hand.
// Both players' men wear the same uniform; the base tells them apart. The base is drawn: the player's colour and
// mark, inked, unlit, as lowpoly's; only the figure's shadow falls on it.

import * as THREE from 'three';
import type { PlayerId, UnitStatus, UnitTypeId } from '../../../../shared/types';
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
const SCRIM = ['#5a6638', '#857b50', '#3f4a30', '#9a8a5c'];     // hessian strips, green and brown
const WHITE = '#cfc9b8';             // a medic's helmet and armband: off-white, never the brightest thing
const CROSS = '#8a4a3e';             // his cross: small and dull, so that Rust stays the board's red
const WIRE = '#5a5148';
const TUBE = '#5d6649';              // the mortar's barrel: paler than a helmet, so it shows between its crew
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
const UPPER = 0.17;                  // an arm's two lengths
const FORE = 0.17;

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

/** The chest every man has: tunic, belt, collar, shoulders, braces; pouches and a small pack if he is a fighting man. */
function chest(s: Sculpt, fighting: boolean): void {
  const body = new THREE.LatheGeometry([
    new THREE.Vector2(0.116, 0), new THREE.Vector2(0.128, 0.1), new THREE.Vector2(0.146, 0.2),
    new THREE.Vector2(0.134, 0.262), new THREE.Vector2(0.062, 0.3), new THREE.Vector2(0.001, 0.302),
  ], 12).scale(1, 1, 0.66);
  s.add(body, TUNIC, WOOL);
  s.add(new THREE.CylinderGeometry(0.121, 0.121, 0.036, 12).scale(1, 1, 0.68).translate(0, 0.012, 0), WEBBING, CANVAS);
  s.add(new THREE.CylinderGeometry(0.05, 0.058, 0.03, 10).translate(0, 0.3, 0), TUNIC, WOOL);                 // collar
  for (const side of [-1, 1]) {
    s.ball(v(side * SHOULDER.x, SHOULDER.y, 0), 0.056, TUNIC, WOOL);
    s.box([0.03, 0.27, 0.012], v(side * 0.062, 0.155, 0.089), WEBBING, CANVAS, 0, [-0.07, 0, side * -0.06]);   // braces, front
    s.box([0.03, 0.27, 0.012], v(side * 0.062, 0.155, -0.089), WEBBING, CANVAS, 0, [0.07, 0, side * -0.06]);   // and back
    if (fighting) s.box([0.062, 0.07, 0.036], v(side * 0.068, 0.05, 0.088), WEBBING, CANVAS);                  // pouches
  }
  if (fighting) {
    s.box([0.18, 0.15, 0.07], v(0, 0.165, -0.128), PACK, CANVAS, 0, [0.06, 0, 0]);
    s.add(new THREE.CylinderGeometry(0.032, 0.032, 0.2, 8).rotateZ(Math.PI / 2).translate(0, 0.262, -0.118), TROUSERS, WOOL);
  }
}

/** Both arms, from the shoulders to where the hands are (his right hand first), each elbow bent towards its pole. */
function arms(s: Sculpt, right: THREE.Vector3, left: THREE.Vector3, rightPole = v(-0.7, -0.5, -0.35), leftPole = v(0.75, -0.6, 0.1)): void {
  const pairs: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
    [v(-SHOULDER.x, SHOULDER.y, 0), right, rightPole],
    [SHOULDER.clone(), left, leftPole],
  ];
  for (const [shoulder, hand, pole] of pairs) {
    const bend = elbow(shoulder, hand, UPPER, FORE, pole);
    s.limb(shoulder, bend, 0.05, 0.043, TUNIC, WOOL);
    s.limb(bend, hand, 0.043, 0.036, TUNIC, WOOL);
    s.ball(hand, 0.036, SKIN, 0.7);
  }
}

/** A long thing built along a line from `from`, `length` long in the direction `dir`: boxes and rods placed along it. */
function along(from: THREE.Vector3, dir: THREE.Vector3): { at(d: number, up?: number): THREE.Vector3; turn: [number, number, number] } {
  const u = dir.clone().normalize();
  // A side-up for the thing: as near the trunk's up as its direction allows.
  const side = Math.abs(u.y) > 0.9 ? v(0, 0, 1) : v(0, 1, 0);
  const up = side.clone().addScaledVector(u, -side.dot(u)).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u.clone().cross(up).normalize(), u, up));
  const e = new THREE.Euler().setFromQuaternion(q);
  return { at: (d, lift = 0) => from.clone().addScaledVector(u, d).addScaledVector(up, lift), turn: [e.x, e.y, e.z] };
}

type Kind = 'rifleman' | 'gunner' | 'sniper' | 'loader' | 'bomber' | 'medic' | 'engineer';

/** A man's trunk: his chest, his arms, and what he holds and carries. */
function trunkOf(kind: Kind): THREE.BufferGeometry {
  const s = new Sculpt();
  chest(s, kind !== 'medic' && kind !== 'engineer');
  if (kind === 'rifleman') {
    s.box([0.02, 0.17, 0.045], v(0.11, 0.07, -0.1), WOOD, 0.6, 0, [0.1, 0, 0.1]);                               // entrenching tool's helve
    // The rifle, built butt to muzzle along its own length, laid across the chest: muzzle up by the left shoulder.
    const TURN = -0.82;
    const MID = v(-0.005, 0.135, 0.135);
    const dir = v(-Math.sin(TURN), Math.cos(TURN), 0);
    const on = (d: number, lift = 0) => MID.clone().addScaledVector(dir, d).add(v(0, 0, lift));
    const turn: [number, number, number] = [0, 0, TURN];
    s.box([0.05, 0.17, 0.028], on(-0.25), WOOD, 0.55, 0, turn);             // butt
    s.box([0.036, 0.13, 0.03], on(-0.11), STEEL, 0.4, 0.7, turn);           // action
    s.box([0.03, 0.3, 0.026], on(0.1), WOOD, 0.55, 0, turn);                // fore-stock
    s.limb(on(-0.05, 0.002), on(0.34, 0.002), 0.011, 0.009, STEEL, 0.4, 0.7);   // barrel
    s.box([0.012, 0.42, 0.006], on(0.0, -0.02), WEBBING, CANVAS, 0, turn);  // sling
    arms(s, on(-0.15, 0.012), on(0.1, 0.02));
  } else if (kind === 'gunner') {
    // A light machine gun, held as he lies behind it: butt in the right shoulder, the gun running on past his
    // head (the trunk's up is forward when he is prone), a curved magazine on top, a bipod under the muzzle.
    const gun = along(v(-0.1, 0.2, 0.1), v(0.03, 1, 0.02));
    s.box([0.05, 0.15, 0.045], gun.at(0.06), WOOD, 0.55, 0, gun.turn);                     // butt
    s.box([0.055, 0.22, 0.07], gun.at(0.23), STEEL, 0.4, 0.7, gun.turn);                   // body
    s.box([0.03, 0.09, 0.1], gun.at(0.26, 0.07), STEEL, 0.4, 0.7, gun.turn);               // magazine, standing up from it
    s.limb(gun.at(0.3), gun.at(0.66), 0.021, 0.017, STEEL, 0.4, 0.7);                      // barrel
    s.limb(gun.at(0.66), gun.at(0.71), 0.026, 0.02, STEEL, 0.4, 0.7);                      // flash hider
    s.box([0.012, 0.05, 0.04], gun.at(0.36, 0.035), WOOD, 0.55, 0, gun.turn);              // carrying handle
    for (const side of [-1, 1]) s.limb(gun.at(0.58), gun.at(0.6).add(v(side * 0.09, 0, 0.21)), 0.011, 0.01, STEEL, 0.4, 0.7, false);   // bipod
    arms(s, gun.at(0.17).add(v(-0.01, 0, 0.03)), gun.at(0.1).add(v(0.05, 0, 0.02)), v(-1, -0.2, 0.2), v(1, 0.1, 0.3));
  } else if (kind === 'sniper') {
    // A long rifle levelled from the right shoulder (it points a little up from the trunk, which leans forward
    // as he kneels), a scope on it; scrim over his shoulders and down his back.
    const rifle = along(v(-0.1, 0.22, 0.02), v(0.05, Math.sin(0.4), Math.cos(0.4)));
    s.box([0.03, 0.2, 0.05], rifle.at(0.06), WOOD, 0.55, 0, rifle.turn);                   // butt
    s.box([0.03, 0.34, 0.034], rifle.at(0.33), WOOD, 0.55, 0, rifle.turn);                 // stock
    s.limb(rifle.at(0.2, 0.012), rifle.at(0.8, 0.012), 0.012, 0.009, STEEL, 0.4, 0.7);     // barrel
    s.limb(rifle.at(0.2, 0.05), rifle.at(0.4, 0.05), 0.016, 0.016, STEEL, 0.35, 0.7);      // scope
    s.box([0.012, 0.03, 0.03], rifle.at(0.3, 0.03), STEEL, 0.4, 0.7, rifle.turn);
    arms(s, rifle.at(0.16, -0.02), rifle.at(0.44, -0.02), v(-0.8, -0.5, -0.2), v(0.6, -0.8, 0.2));
    const rnd = streamOf(2903);
    for (let i = 0; i < 22; i++) {
      const a = rnd() * Math.PI * 2;
      const back = rnd();
      const at = v(Math.cos(a) * (0.1 + 0.07 * rnd()), 0.3 - back * 0.22, -0.06 - back * 0.07 + Math.sin(a) * 0.05);
      s.add(new THREE.SphereGeometry(0.045 + rnd() * 0.03, 6, 4).scale(1.25, 0.6, 1.1).translate(at.x, at.y, at.z), SCRIM[Math.floor(rnd() * SCRIM.length)], 1);
    }
  } else if (kind === 'loader') {
    // The mortar's number one: both hands up at the muzzle.
    arms(s, v(-0.05, 0.31, 0.3), v(0.07, 0.25, 0.3), v(-0.8, -0.4, 0), v(0.8, -0.4, 0));
  } else if (kind === 'bomber') {
    // Its number two: a round held ready in both hands, a case of them on his back.
    const round = v(0.0, 0.14, 0.2);
    s.limb(round.clone().add(v(0, -0.06, 0)), round.clone().add(v(0, 0.07, 0)), 0.03, 0.022, HELMET, 0.5, 0.3);
    s.limb(round.clone().add(v(0, 0.07, 0)), round.clone().add(v(0, 0.11, 0)), 0.012, 0.02, STEEL, 0.4, 0.7);
    arms(s, round.clone().add(v(-0.04, -0.02, 0)), round.clone().add(v(0.04, 0.02, 0)));
  } else if (kind === 'medic') {
    // No weapon. A satchel on each hip, their straps crossed on his chest; an armband on the left arm.
    for (const side of [-1, 1]) {
      s.box([0.085, 0.13, 0.15], v(side * 0.17, -0.025, 0.0), WEBBING, CANVAS, 0, [0, 0, side * 0.08]);
      s.box([0.088, 0.045, 0.152], v(side * 0.17, 0.045, 0.0), PACK, CANVAS, 0, [0, 0, side * 0.08]);          // the flap
      s.box([0.026, 0.4, 0.012], v(0, 0.15, 0.094), WEBBING, CANVAS, 0, [0, 0, side * 0.72]);
      s.box([0.026, 0.4, 0.012], v(0, 0.15, -0.094), WEBBING, CANVAS, 0, [0, 0, side * -0.72]);
    }
    s.box([0.012, 0.045, 0.014], v(0.215, -0.02, 0.0), CROSS, 0.9);                                             // a cross on the left satchel
    s.box([0.012, 0.014, 0.045], v(0.215, -0.02, 0.0), CROSS, 0.9);
    const right = v(-0.2, -0.0, 0.07);
    const left = v(0.21, 0.02, 0.06);
    arms(s, right, left, v(-0.6, -0.3, -0.7), v(0.6, -0.3, -0.7));
    const bend = elbow(SHOULDER.clone(), left, UPPER, FORE, v(0.6, -0.3, -0.7));
    const mid = SHOULDER.clone().lerp(bend, 0.55);
    s.ball(mid, 0.058, WHITE, 0.9, [1, 0.7, 1]);                                                                // the armband
    s.box([0.012, 0.04, 0.012], mid.clone().add(v(0.05, 0, 0.02)), CROSS, 0.9);
    s.box([0.012, 0.012, 0.04], mid.clone().add(v(0.05, 0, 0.02)), CROSS, 0.9);
  } else {
    // The engineer. No weapon: a shovel over the right shoulder, a coil of wire on his back, a sandbag in his left hand.
    const hand = v(-0.13, 0.12, 0.13);
    const shovel = along(hand.clone().add(v(0, -0.05, 0.03)), v(-0.03, 0.72, -0.5));
    s.limb(shovel.at(0), shovel.at(0.41), 0.012, 0.012, WOOD, 0.6, 0, false);
    s.box([0.11, 0.12, 0.014], shovel.at(0.46), STEEL, 0.45, 0.6, shovel.turn);                                  // the blade, behind his head
    // The coil hangs from his left shoulder, round the arm: seen from in front and from above.
    s.add(new THREE.TorusGeometry(0.125, 0.024, 6, 16).rotateY(1.2).rotateZ(-0.25).translate(0.165, 0.14, 0.0), WIRE, 0.6, 0.5);
    s.add(new THREE.TorusGeometry(0.11, 0.022, 6, 16).rotateY(1.35).rotateZ(-0.2).translate(0.19, 0.13, 0.01), WIRE, 0.6, 0.5);
    const left = v(0.21, -0.02, 0.05);
    s.ball(left.clone().add(v(0.01, -0.09, 0)), 0.075, BURLAP, 1, [0.8, 1.1, 1.3]);
    arms(s, hand, left, v(-0.8, -0.5, 0.1), v(0.6, -0.3, -0.7));
  }
  return s.build();
}

/** A head: neck, face in the helmet's shade, nose, and the helmet, plain, scrimmed (the sniper's) or a medic's. */
function headOf(kind: 'plain' | 'scrim' | 'medic'): THREE.BufferGeometry {
  const HEAD = v(0, 0.088, 0.004);
  const shell = new THREE.LatheGeometry([
    new THREE.Vector2(0.084, -0.03), new THREE.Vector2(0.112, -0.041), new THREE.Vector2(0.112, -0.034), new THREE.Vector2(0.092, -0.02),
    new THREE.Vector2(0.088, 0.008), new THREE.Vector2(0.074, 0.044), new THREE.Vector2(0.045, 0.071), new THREE.Vector2(0.001, 0.08),
  ], 14).scale(1, 1, 1.12).translate(HEAD.x, HEAD.y + 0.034, HEAD.z);
  const s = new Sculpt()
    .add(new THREE.CylinderGeometry(0.034, 0.038, 0.06, 8).translate(0, 0.022, 0), SKIN, 0.7)
    .ball(HEAD, 0.068, SKIN, 0.7, [0.9, 1.08, 0.98], (p) => (p.y > HEAD.y + 0.012 ? 0.55 : 1))
    .ball(v(0, HEAD.y - 0.012, HEAD.z + 0.064), 0.014, SKIN, 0.7)
    .add(shell, kind === 'medic' ? WHITE : HELMET, kind === 'medic' ? 0.7 : 0.5, kind === 'medic' ? 0 : 0.25);
  if (kind === 'scrim') {
    const rnd = streamOf(2917);
    for (let i = 0; i < 12; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 0.035 + rnd() * 0.07;
      s.add(new THREE.SphereGeometry(0.032 + rnd() * 0.022, 6, 4).scale(1.3, 0.55, 1.1).translate(Math.cos(a) * r, HEAD.y + 0.1 - r * 0.6, HEAD.z + Math.sin(a) * r * 1.1), SCRIM[Math.floor(rnd() * SCRIM.length)], 1);
    }
  }
  if (kind === 'medic') {
    // The cross on the crown, where the camera sees it: two short bars, dull.
    const top = v(0, HEAD.y + 0.106, HEAD.z + 0.03);
    s.box([0.05, 0.008, 0.016], top, CROSS, 0.9, 0, [0.5, 0, 0]);
    s.box([0.016, 0.008, 0.05], top, CROSS, 0.9, 0, [0.5, 0, 0]);
  }
  return s.build();
}

interface Legs { pelvis: THREE.BufferGeometry; thigh: THREE.BufferGeometry; shin: THREE.BufferGeometry }
let legs: Legs | null = null;
/** The hips and legs every man has: the tunic's skirt and a water bottle; trousers; anklets and boots. */
function legsOf(): Legs {
  if (legs) return legs;
  const skirt = new THREE.LatheGeometry([
    new THREE.Vector2(0.001, -0.115), new THREE.Vector2(0.132, -0.11), new THREE.Vector2(0.126, -0.02), new THREE.Vector2(0.116, 0.07),
  ], 12).scale(1, 1, 0.7);
  legs = {
    pelvis: new Sculpt().add(skirt, TUNIC, WOOL).ball(v(-0.118, -0.03, -0.03), 0.045, PACK, CANVAS, [0.7, 1.1, 0.9]).build(),
    thigh: new Sculpt().limb(v(0, 0, 0), v(0, -THIGH, 0), 0.064, 0.052, TROUSERS, WOOL).build(),
    shin: new Sculpt()
      .limb(v(0, 0, 0), v(0, -SHIN + 0.03, 0), 0.052, 0.042, TROUSERS, WOOL)
      .add(new THREE.CylinderGeometry(0.047, 0.044, 0.075, 8).translate(0, -SHIN + 0.025, 0), WEBBING, CANVAS)
      .ball(v(0, -SHIN - 0.032, 0.03), 0.05, LEATHER, 0.5, [0.95, 0.76, 1.75])
      .box([0.085, 0.03, 0.07], v(0, -SHIN - 0.055, -0.02), LEATHER, 0.5)
      .build(),
  };
  return legs;
}

const trunks = new Map<Kind, THREE.BufferGeometry>();
const heads = new Map<string, THREE.BufferGeometry>();
const trunk = (kind: Kind): THREE.BufferGeometry => trunks.get(kind) ?? (trunks.set(kind, trunkOf(kind)), trunks.get(kind)!);
const head = (kind: 'plain' | 'scrim' | 'medic'): THREE.BufferGeometry => heads.get(kind) ?? (heads.set(kind, headOf(kind)), heads.get(kind)!);

/** The mortar: a baseplate, the tube leaning away over it, and its bipod. One geometry, standing on the base. */
let mortarGeo: THREE.BufferGeometry | null = null;
function mortar(): THREE.BufferGeometry {
  if (mortarGeo) return mortarGeo;
  const foot = v(0, 0.012, 0);
  const muzzle = v(0.12, 0.56, -0.14);
  const s = new Sculpt()
    .add(new THREE.CylinderGeometry(0.12, 0.13, 0.026, 10).translate(0, 0.013, 0), STEEL, 0.5, 0.5)
    .limb(foot, muzzle, 0.046, 0.043, TUBE, 0.45, 0.35, false)
    .limb(muzzle, muzzle.clone().lerp(foot, -0.04), 0.05, 0.05, STEEL, 0.4, 0.6, false);
  const collar = foot.clone().lerp(muzzle, 0.6);
  s.limb(collar.clone().lerp(foot, 0.06), collar.clone().lerp(muzzle, 0.04), 0.054, 0.054, STEEL, 0.4, 0.6, false);
  for (const side of [-1, 1]) s.limb(collar, v(0.2 + side * 0.13, 0, 0.16), 0.012, 0.011, STEEL, 0.4, 0.6, false);
  mortarGeo = s.build();
  return mortarGeo;
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
  heading: number; tip: number;         // turned about his height, then tipped (negative: onto his back; positive: onto his front)
  roll?: number;                        // or over sideways, onto a shoulder
  spine: number; nod: number; look: number;
  thighL: number; splayL: number; kneeL: number;
  thighR: number; splayR: number; kneeR: number;
}
const FACING = 0.45;   // a quarter turn off the camera, as lowpoly's figures stand, so what a man carries shows in silhouette

// Standing easy, weight on the right leg.
const STAND: Pose = {
  x: 0, y: BASE_H + HIP_Y, z: -0.14, heading: FACING, tip: 0, spine: 0.06, nod: 0.02, look: -0.3,
  thighL: -0.17, splayL: 0.06, kneeL: 0.2, thighR: 0.09, splayR: -0.05, kneeR: 0.1,
};
// Down on his right knee, hunched, head up.
const KNEEL: Pose = {
  x: 0, y: BASE_H + 0.3, z: -0.12, heading: FACING, tip: 0, spine: 0.6, nod: -0.3, look: -0.3,
  thighL: -1.45, splayL: 0.12, kneeL: 1.5, thighR: 0.2, splayR: -0.06, kneeR: 1.38,
};
// Belly down, propped on his elbows, legs apart, looking along the ground.
const PRONE: Pose = {
  x: 0, y: BASE_H + 0.115, z: 0, heading: Math.PI / 2, tip: 1.5, spine: -0.32, nod: -0.6, look: 0,
  thighL: 0.06, splayL: 0.24, kneeL: 0.05, thighR: 0.08, splayR: -0.24, kneeR: 0.04,
};
// Flat on his back across the base, head to the left, one knee up.
const FLAT: Pose = {
  x: 0, y: BASE_H + 0.17, z: -0.06, heading: Math.PI / 2, tip: -Math.PI / 2, spine: -0.04, nod: -0.3, look: 0.5,
  thighL: 0.14, splayL: 0.2, kneeL: 0.12, thighR: -0.55, splayR: -0.12, kneeR: 1.0,
};
const with_ = (pose: Pose, change: Partial<Pose>): Pose => ({ ...pose, ...change });

/** One man of a figure: what he is, and how he is in each status. */
interface ManSpec { trunk: Kind; head: 'plain' | 'scrim' | 'medic'; poses: Record<UnitStatus, Pose> }
/** A figure: its men, and anything that stands on the base beside them. */
interface FigureSpec { men: ManSpec[]; prop?: () => THREE.BufferGeometry; propAt?: [number, number, number] }

const standing = (kind: Kind, headKind: 'plain' | 'medic' = 'plain'): FigureSpec => ({
  men: [{ trunk: kind, head: headKind, poses: { ready: STAND, pinned: KNEEL, down: FLAT } }],
});

const FIGURES: Record<string, FigureSpec> = {
  rifleman: standing('rifleman'),
  medic: standing('medic', 'medic'),
  engineer: standing('engineer'),
  // Lying behind the gun, which points to the right of the picture so that its whole length shows. Pinned, he
  // puts his face in the dirt; down, he is on his back, the gun fallen with him.
  gunner: {
    men: [{
      trunk: 'gunner', head: 'plain',
      poses: {
        ready: with_(PRONE, { x: -0.21, z: -0.04, heading: 1.75 }),
        pinned: with_(PRONE, { x: -0.21, z: -0.04, heading: 1.75, spine: -0.12, nod: 0.25, tip: 1.54, y: BASE_H + 0.1 }),
        down: with_(FLAT, { x: -0.22, heading: 1.75 + Math.PI }),
      },
    }],
  },
  // Kneeling, the long rifle levelled to the right of the picture. Pinned, he doubles over it; down, he lies on his side.
  sniper: {
    men: [{
      trunk: 'sniper', head: 'scrim',
      poses: {
        ready: with_(KNEEL, { x: -0.27, z: -0.1, heading: 1.3, spine: 0.36, nod: -0.2, look: 0.1 }),
        pinned: with_(KNEEL, { x: -0.27, z: -0.1, heading: 1.3, spine: 0.8, nod: 0.1, look: 0.1, y: BASE_H + 0.29 }),
        // Down, he lies on his side, the rifle along the ground (on his back it would point at the sky).
        down: with_(STAND, { x: -0.1, y: BASE_H + 0.16, z: 0.04, heading: Math.PI - 0.55, tip: 0, roll: Math.PI / 2, spine: 0.25, nod: 0.2, look: 0, thighL: -0.5, kneeL: 0.9, thighR: 0.1, kneeR: 0.3 }),
      },
    }],
  },
  // Two men kneeling at the tube: number one on the left with his hands at the muzzle, number two on the right
  // with a round. Pinned, both duck; down, both lie.
  mortar: {
    men: [
      {
        trunk: 'loader', head: 'plain',
        poses: {
          ready: with_(KNEEL, { x: -0.36, z: -0.1, heading: 1.3, spine: 0.3, nod: -0.25, look: 0 }),
          pinned: with_(KNEEL, { x: -0.38, z: -0.1, heading: 1.3, spine: 1.05, nod: 0.2, look: 0 }),
          down: with_(FLAT, { x: -0.05, z: -0.3 }),
        },
      },
      {
        trunk: 'bomber', head: 'plain',
        poses: {
          ready: with_(KNEEL, { x: 0.42, z: -0.22, heading: -0.9, spine: 0.4, nod: -0.25, look: 0.2, thighL: 0.2, kneeL: 1.38, thighR: -1.45, kneeR: 1.5 }),
          pinned: with_(KNEEL, { x: 0.44, z: -0.22, heading: -0.9, spine: 1.05, nod: 0.2, look: 0.2, thighL: 0.2, kneeL: 1.38, thighR: -1.45, kneeR: 1.5 }),
          down: with_(FLAT, { x: 0.08, z: 0.0, heading: -Math.PI / 2, look: -0.5 }),
        },
      },
    ],
    prop: mortar,
    propAt: [0.02, BASE_H, 0.0],
  },
};

/** The unit types this kit has a figure for. */
export const FIGURE_TYPES = Object.keys(FIGURES);

const leanAxis = new THREE.Vector3();

/** A unit of one of the kit's types (see FIGURE_TYPES), on its base. */
export function figure(look: Look, type: UnitTypeId, owner: PlayerId): UnitVisual {
  const spec = FIGURES[type] ?? FIGURES.rifleman;
  const object = new THREE.Group();
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

  // lean > every man's hips > (spine > head, two legs > shins), and the prop. `lean` tips the figure about its feet for a dash.
  const lean = new THREE.Group();
  const common = legsOf();
  const men = spec.men.map((man) => {
    const hips = joint(lean, 0, 0, 0, piece(common.pelvis));
    hips.rotation.order = 'YXZ';
    const spine = joint(hips, 0, SPINE_Y, 0, piece(trunk(man.trunk)));
    const neck = joint(spine, 0, NECK_Y, 0, piece(head(man.head)));
    const thighL = joint(hips, HIP_X, 0, 0, piece(common.thigh));
    const thighR = joint(hips, -HIP_X, 0, 0, piece(common.thigh));
    const shinL = joint(thighL, 0, -THIGH, 0, piece(common.shin));
    const shinR = joint(thighR, 0, -THIGH, 0, piece(common.shin));
    return { poses: man.poses, hips, spine, neck, thighL, thighR, shinL, shinR };
  });
  if (spec.prop) {
    const prop = piece(spec.prop());
    prop.position.set(...(spec.propAt ?? [0, BASE_H, 0]));
    lean.add(prop);
  }

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
    for (const man of men) {
      const a = man.poses[from] ?? man.poses.ready;
      const b = man.poses[to] ?? man.poses.ready;
      const mix = (key: keyof Pose) => (a[key] ?? 0) + ((b[key] ?? 0) - (a[key] ?? 0)) * k;
      man.hips.position.set(mix('x'), mix('y'), mix('z'));
      man.hips.rotation.set(mix('tip'), mix('heading'), mix('roll'));
      man.spine.rotation.x = mix('spine');
      man.neck.rotation.set(mix('nod'), mix('look'), 0);
      man.thighL.rotation.set(mix('thighL'), 0, mix('splayL'));
      man.thighR.rotation.set(mix('thighR'), 0, mix('splayR'));
      man.shinL.rotation.x = mix('kneeL');
      man.shinR.rotation.x = mix('kneeR');
    }
    const size = (from === 'pinned' ? 1 - k : 0) + (to === 'pinned' ? k : 0);
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

  // The rig lowpoly's effects drive: a hit, a stand, a dash's lean and a dig all work on these figures.
  setRig(object, {
    dig,
    status: () => current,
    blend,
    mark: pinnedMark,
    lean(dx, dz, angle) {
      lean.quaternion.setFromAxisAngle(leanAxis.set(dz, 0, -dx).normalize(), angle);
    },
    dashes: (step) => step > (UNITS[type]?.move ?? Infinity),
  });

  setStatus('ready');
  return { object, setStatus, setDugIn: (dug) => dig(dug ? 1 : 0) };
}

/** The rifleman (26): kept by name for those who ask for him. */
export const rifleman = (look: Look, owner: PlayerId): UnitVisual => figure(look, 'rifleman', owner);
