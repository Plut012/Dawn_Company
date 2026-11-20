// Units: a low-poly soldier on a base disc that carries the player mark.
// Each type is told apart by one prop or piece of dress.

import * as THREE from 'three';
import type { PlayerId, UnitStatus, UnitTypeId } from '../../../../shared/types';
import type { UnitVisual } from '../../kit';
import { UNITS } from '../../../../content';
import { TOKENS, box, flat, layFlat, lit, outline, solid } from './parts';

// ---- player marks: colour and shape, always together

export type MarkShape = 'bar' | 'chevron' | 'diamond' | 'disc';
export const PLAYERS: { color: string; shape: MarkShape }[] = [
  { color: TOKENS.blue, shape: 'bar' },
  { color: TOKENS.plum, shape: 'chevron' },
  { color: TOKENS.teal, shape: 'diamond' },
  { color: TOKENS.bone, shape: 'disc' },
];

export function outlineOf(shape: MarkShape, grow: number): THREE.Shape {
  const s = new THREE.Shape();
  if (shape === 'bar') {
    const w = 0.3 + grow, h = 0.085 + grow;
    s.moveTo(-w, -h); s.lineTo(w, -h); s.lineTo(w, h); s.lineTo(-w, h);
  } else if (shape === 'chevron') {
    const g = grow * 1.4;
    s.moveTo(-0.3 - g, -0.13 - g); s.lineTo(0, 0.07 - g * 0.2); s.lineTo(0.3 + g, -0.13 - g);
    s.lineTo(0.3 + g, 0.02 + g * 0.4); s.lineTo(0, 0.2 + g); s.lineTo(-0.3 - g, 0.02 + g * 0.4);
  } else if (shape === 'diamond') {
    const w = 0.21 + grow * 1.3, h = 0.17 + grow * 1.3;
    s.moveTo(-w, 0); s.lineTo(0, -h); s.lineTo(w, 0); s.lineTo(0, h);
  } else {
    s.absarc(0, 0, 0.15 + grow, 0, Math.PI * 2, false);
  }
  s.closePath();
  return s;
}

const markGeo = new Map<string, THREE.BufferGeometry>();
function markShape(shape: MarkShape, grow: number): THREE.BufferGeometry {
  const id = `${shape}/${grow}`;
  let g = markGeo.get(id);
  if (!g) {
    g = layFlat(new THREE.ShapeGeometry(outlineOf(shape, grow), 10));
    markGeo.set(id, g);
  }
  return g;
}

const BASE_R = 0.6;
const BASE_H = 0.07;
const baseGeo = new THREE.CylinderGeometry(BASE_R, BASE_R, BASE_H, 24).translate(0, BASE_H / 2, 0);
const baseRimGeo = new THREE.CylinderGeometry(BASE_R + 0.04, BASE_R + 0.04, BASE_H - 0.015, 24)
  .translate(0, (BASE_H - 0.015) / 2, 0);

/** The base disc in the player's colour, the mark shape in paper at its front. */
function base(owner: PlayerId): THREE.Group {
  const g = new THREE.Group();
  const player = PLAYERS[owner];
  const disc = solid(baseGeo, player?.color ?? TOKENS.khaki);
  disc.castShadow = false;
  g.add(disc, new THREE.Mesh(baseRimGeo, flat(TOKENS.ink)));   // ink rim
  if (player) {
    const edge = new THREE.Mesh(markShape(player.shape, 0.035), flat(TOKENS.ink));
    edge.position.set(0, BASE_H + 0.004, 0.3);
    const fill = new THREE.Mesh(markShape(player.shape, 0), flat(TOKENS.paper));
    fill.position.set(0, BASE_H + 0.008, 0.3);
    g.add(edge, fill);
  }
  return g;
}

// ---- the figure

const helmetGeo = new THREE.SphereGeometry(0.125, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.85, 1.1);
const brimGeo = new THREE.CylinderGeometry(0.15, 0.16, 0.025, 7).scale(1, 1, 1.1);
const tubeGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.62, 6).translate(0, 0.31, 0);

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.x += x; o.position.y += y; o.position.z += z;
  return o;
}

/** Legs, body, arms, head. Faces +z; feet at the origin; about 1 unit tall. */
function body(dress: { helmet: string | null; coat: string }): THREE.Group {
  const f = new THREE.Group();
  for (const side of [-1, 1]) {
    f.add(box(0.13, 0.07, 0.19, TOKENS.ink, side * 0.085, 0, 0.02, false));        // boot
    f.add(box(0.12, 0.36, 0.13, TOKENS.olive, side * 0.085, 0.07, 0));             // leg
    f.add(box(0.09, 0.33, 0.11, dress.coat, side * 0.215, 0.43, 0));               // arm
  }
  f.add(box(0.33, 0.36, 0.19, dress.coat, 0, 0.42, 0));                            // chest
  f.add(box(0.34, 0.05, 0.2, TOKENS.khaki, 0, 0.42, 0, false));                    // belt
  f.add(box(0.15, 0.15, 0.15, TOKENS.paper, 0, 0.78, 0.005));                      // head
  if (dress.helmet) {
    f.add(at(outline(solid(helmetGeo, dress.helmet)), 0, 0.9, 0));
    f.add(at(solid(brimGeo, dress.helmet), 0, 0.9, 0));
  }
  return f;
}

interface Kit { figure: THREE.Group; standing?: THREE.Object3D }

const builders: Record<string, () => Kit> = {
  // Rifle slung across the chest.
  rifleman() {
    const figure = body({ helmet: TOKENS.slate, coat: TOKENS.olive });
    const rifle = box(0.05, 0.72, 0.05, TOKENS.ink, 0, -0.36, 0, false);
    rifle.rotation.z = -0.9;
    rifle.position.set(0.02, 0.56, 0.14);
    figure.add(rifle);
    return { figure };
  },
  // A heavy gun carried at the hip, bipod down, ammunition box on the back.
  gunner() {
    const figure = body({ helmet: TOKENS.slate, coat: TOKENS.olive });
    const gun = new THREE.Group();
    gun.add(box(0.1, 0.12, 0.34, TOKENS.ink, 0, -0.06, 0.02, false));              // receiver
    gun.add(box(0.06, 0.06, 0.5, TOKENS.ink, 0, -0.02, 0.42, false));              // barrel
    gun.add(box(0.03, 0.26, 0.03, TOKENS.ink, -0.07, -0.28, 0.6, false));          // bipod
    gun.add(box(0.03, 0.26, 0.03, TOKENS.ink, 0.07, -0.28, 0.6, false));
    gun.position.set(0.2, 0.5, 0.1);
    figure.add(gun);
    figure.add(box(0.26, 0.24, 0.13, TOKENS.khaki, 0, 0.5, -0.17));                // ammunition
    return { figure };
  },
  // No helmet: a soft cap and a cape, and a rifle taller than he is.
  sniper() {
    const figure = body({ helmet: null, coat: TOKENS.khaki });
    figure.add(box(0.19, 0.06, 0.2, TOKENS.olive, 0, 0.93, 0.02));                 // cap
    figure.add(box(0.46, 0.3, 0.08, TOKENS.khaki, 0, 0.44, -0.13));                // cape
    figure.add(box(0.045, 1.2, 0.045, TOKENS.ink, 0.3, 0, 0.08, false));           // long rifle
    figure.add(box(0.05, 0.05, 0.16, TOKENS.ink, 0.3, 0.82, 0.12, false));         // scope
    return { figure };
  },
  // The tube stands beside him on its plate.
  mortar() {
    const figure = body({ helmet: TOKENS.slate, coat: TOKENS.olive });
    figure.position.x = -0.16;
    const standing = new THREE.Group();
    standing.add(box(0.24, 0.04, 0.24, TOKENS.ink, 0, 0, 0, false));               // plate
    const tube = outline(solid(tubeGeo, TOKENS.slate));
    tube.rotation.z = -0.6;                                                        // leaning away from him
    standing.add(tube);
    for (const side of [-1, 1]) {
      const leg = box(0.03, 0.44, 0.03, TOKENS.ink, 0.36, 0, side * 0.09, false);  // bipod
      leg.rotation.z = 0.3;
      standing.add(leg);
    }
    standing.position.set(0.2, BASE_H, 0.02);
    return { figure, standing };
  },
  // Paper helmet with an ink band, a satchel with a cross, and no weapon.
  medic() {
    const figure = body({ helmet: TOKENS.paper, coat: TOKENS.olive });
    figure.add(box(0.27, 0.035, 0.29, TOKENS.ink, 0, 0.915, 0, false));            // helmet band
    figure.add(box(0.2, 0.2, 0.1, TOKENS.paper, 0.17, 0.3, 0.13));                 // satchel
    figure.add(box(0.13, 0.04, 0.012, TOKENS.ink, 0.17, 0.38, 0.185, false));      // cross
    figure.add(box(0.04, 0.13, 0.012, TOKENS.ink, 0.17, 0.335, 0.185, false));
    for (const side of [-1, 1]) figure.add(box(0.1, 0.07, 0.12, TOKENS.paper, side * 0.215, 0.62, 0, false));
    return { figure };
  },
};

const pegGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8).translate(0, 0.35, 0);

/** Unknown types fall back to a plain peg. */
function peg(): Kit {
  const figure = new THREE.Group();
  figure.add(outline(solid(pegGeo, TOKENS.khaki)));
  return { figure };
}

// ---- status

const burstGeo = (() => {
  const s = new THREE.Shape();
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const r = i % 2 ? 0.68 : 0.93;
    if (i === 0) s.moveTo(r * Math.cos(a), r * Math.sin(a));
    else s.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  s.closePath();
  return layFlat(new THREE.ShapeGeometry(s));
})();

/** The rust burst under a pinned unit. */
function burst(): THREE.Group {
  const g = new THREE.Group();
  const edge = new THREE.Mesh(burstGeo, flat(TOKENS.ink, 1, true));
  edge.scale.setScalar(1.06);
  edge.position.y = 0.014;
  const fill = new THREE.Mesh(burstGeo, flat(TOKENS.rust, 1, true));
  fill.position.y = 0.022;
  g.add(edge, fill);
  return g;
}

// ---- the foxhole (24): a low ring of sandbags round the base, paper with an ink outline, as the wall tile is

const BAGS = 11;
const BAG_RING = 0.7;      // the hex is 0.866 across from its middle to a side: the ring fits inside it
const bagGeo = new THREE.BoxGeometry(0.36, 0.15, 0.17);

/** Eleven bags round the figure, each tangent to the ring, the gaps left alone; it grows from the ground. */
function sandbags(): THREE.Group {
  const ring = new THREE.Group();
  for (let i = 0; i < BAGS; i++) {
    const a = (i / BAGS) * Math.PI * 2 + 0.2;
    const bag = outline(solid(bagGeo, TOKENS.paper), 0.02);
    bag.position.set(Math.sin(a) * BAG_RING, 0.075, Math.cos(a) * BAG_RING);
    bag.rotation.y = a + (i % 2 ? 0.06 : -0.05);
    ring.add(bag);
  }
  ring.visible = false;
  return ring;
}

const FACING = 0.45;   // a quarter turn off the camera, so props show in silhouette

/**
 * The moving parts of a unit made by this kit, for the kit's effects: the
 * board hands an effect only the unit's object, and this finds the rest.
 */
export interface Rig {
  status(): UnitStatus;                                    // as last set by the board
  blend(from: UnitStatus, to: UnitStatus, k: number): void;   // the figure part-way between two statuses, k in 0..1
  mark: THREE.Object3D;                                    // the rust burst under a pinned unit
  lean(dx: number, dz: number, angle: number): void;       // tip a standing figure towards (dx, dz)
  dashes(step: number): boolean;                           // is this step of a move beyond a walk?
  dig(k: number): void;                                    // (24) the sandbags part-way up, k in 0..1 (1 is as `setDugIn(true)` leaves them)
}
const rigs = new WeakMap<THREE.Object3D, Rig>();
export const rigOf = (object: THREE.Object3D | null): Rig | null => (object && rigs.get(object)) || null;
const leanAxis = new THREE.Vector3();

export function unit(type: UnitTypeId, owner: PlayerId): UnitVisual {
  const object = new THREE.Group();
  const build = Object.hasOwn(builders, type) ? builders[type] : peg;
  const { figure, standing } = build();
  const isPeg = build === peg;

  // pose > turn > figure: `turn` spins the man about his own height,
  // `pose` then stands him up or lays him down.
  const pose = new THREE.Group();
  const turn = new THREE.Group();
  turn.add(figure);
  pose.add(turn);
  const stand = base(owner);
  const pinnedMark = burst();
  const bags = sandbags();
  object.add(stand, pose, pinnedMark, bags);
  if (standing) object.add(standing);

  // Remember each part's own material, so "down" can grey it and undo it.
  const tinted: { mesh: THREE.Mesh; own: THREE.Material | THREE.Material[] }[] = [];
  for (const root of standing ? [pose, standing] : [pose]) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.Material).side !== THREE.BackSide) {
        tinted.push({ mesh, own: mesh.material });
      }
    });
  }
  const grey = lit(TOKENS.slate);

  // Each status is a pose; an effect may show any point between two of them.
  const poseOf = (status: UnitStatus) => {
    const lying = status !== 'ready' && !isPeg;
    return {
      // Pinned lies face down, head to the right; down lies on his back.
      turn: lying ? (status === 'pinned' ? Math.PI / 2 : -Math.PI / 2) : FACING,
      rotY: lying ? 0.25 : 0,
      rotZ: lying ? -Math.PI / 2 : 0,
      x: lying ? -0.48 : 0,
      y: lying ? BASE_H + 0.11 : BASE_H,
      z: lying ? 0.05 : -0.16,
      long: lying && status === 'down' ? 0.6 : 1,
      // A peg cannot lie down: it sinks when pinned and is cut short when down.
      tall: isPeg && status !== 'ready' ? (status === 'down' ? 0.25 : 0.6) : 1,
      mark: status === 'pinned' ? 1 : 0,
    };
  };

  let current: UnitStatus = 'ready';

  function blend(from: UnitStatus, to: UnitStatus, k: number): void {
    const a = poseOf(from);
    const b = poseOf(to);
    const mix = (key: keyof typeof a) => a[key] + (b[key] - a[key]) * k;
    turn.rotation.y = mix('turn');
    pose.rotation.set(0, mix('rotY'), mix('rotZ'));
    pose.position.set(mix('x'), mix('y'), mix('z'));
    pose.scale.set(mix('long'), mix('tall'), 1);
    const size = mix('mark');
    pinnedMark.visible = size > 0.01;
    pinnedMark.scale.setScalar(Math.max(size, 0.01));
    const greyed = (k < 0.5 ? from : to) === 'down';
    for (const t of tinted) t.mesh.material = greyed ? grey : t.own;
  }

  function setStatus(status: UnitStatus): void {
    current = status;
    blend(status, status, 1);
  }

  function dig(k: number): void {
    bags.visible = k > 0.01;
    bags.scale.set(1, Math.max(k, 0.01), 1);
  }

  function setDugIn(dug: boolean): void {
    dig(dug ? 1 : 0);
  }

  rigs.set(object, {
    dig,
    status: () => current,
    blend,
    mark: pinnedMark,
    lean(dx, dz, angle) {
      pose.quaternion.setFromAxisAngle(leanAxis.set(dz, 0, -dx).normalize(), angle);
    },
    dashes: (step) => step > (UNITS[type]?.move ?? Infinity),
  });

  setStatus('ready');
  return { object, setStatus, setDugIn };
}
