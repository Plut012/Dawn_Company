// Effects: what each event of a resolved round looks like in this kit.
//
// One function per event. Each builds a few flat shapes, moves them for a
// fraction of a second, takes them away again and resolves. Amber is fire
// and scoring, rust is harm, paper is recovery; ink edges keep the shapes
// readable on khaki ground. The board applies whatever lasts (see
// ../../playback.ts): an effect that moves or poses a unit must end exactly
// where the board will then put it.

import * as THREE from 'three';
import { ACTIONS } from '../../../../content';
import { neighbors } from '../../../../shared/hex';
import type { GameEvent, Hex, UnitId } from '../../../../shared/types';
import type { KitCtx } from '../../kit';
import { FACE_CAMERA, TOKENS, layFlat, text } from './parts';
import { rigOf } from './units';

type Event<T extends GameEvent['t']> = Extract<GameEvent, { t: T }>;

// ---- time

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The next frame; or, where frames have stopped (a hidden tab), a little later. */
function nextFrame(): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, 200);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { clearTimeout(timer); done(); });
    }
  });
}

/** Call `draw` with k from 0 to 1 over `ms`. The first call is made at once. */
async function tween(ms: number, draw: (k: number) => void): Promise<void> {
  const start = now();
  draw(0);
  for (let k = 0; k < 1;) {
    await nextFrame();
    k = Math.min(1, (now() - start) / ms);
    draw(k);
  }
}

const pause = (ms: number): Promise<void> => tween(ms, () => {});
const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x));
/** The part of 0..1 between a and b, stretched back to 0..1. */
const span = (k: number, a: number, b: number): number => clamp((k - a) / (b - a));
const out = (k: number): number => 1 - (1 - k) * (1 - k);          // fast, then settling
const smooth = (k: number): number => k * k * (3 - 2 * k);
const arc = (k: number): number => Math.sin(Math.PI * clamp(k));   // 0, up to 1, back to 0

// ---- shapes

function starShape(points: number, inner: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points + Math.PI / 2;
    const r = i % 2 ? inner : 1;
    if (i === 0) s.moveTo(r * Math.cos(a), r * Math.sin(a));
    else s.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  s.closePath();
  return s;
}

const flashGeo = new THREE.ShapeGeometry(starShape(6, 0.45));            // upright, faces the camera
const burstGeo = layFlat(new THREE.ShapeGeometry(starShape(9, 0.7)));    // lies on the ground
const ringGeo = layFlat(new THREE.RingGeometry(0.8, 1, 40));
const boltGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5);    // from its origin back along -z
const puffGeo = new THREE.IcosahedronGeometry(1, 0);
const shellGeo = new THREE.ConeGeometry(0.09, 0.42, 6);

const TOP = 3;   // drawn after the fog veil, so an effect shows on unseen ground too

/** The props of one effect: made through here, all taken away by `strike`. */
class Props {
  private made: THREE.Mesh[] = [];
  constructor(private scene: THREE.Scene) {}

  mesh(geometry: THREE.BufferGeometry, color: string, at?: THREE.Vector3): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = TOP;
    if (at) mesh.position.copy(at);
    this.scene.add(mesh);
    this.made.push(mesh);
    return mesh;
  }

  /** A shape with an ink edge: two meshes that are moved together. */
  edged(geometry: THREE.BufferGeometry, color: string, at: THREE.Vector3, flatOnGround: boolean): Edged {
    const edge = this.mesh(geometry, TOKENS.ink, at);
    const fill = this.mesh(geometry, color, at);
    if (flatOnGround) {
      edge.position.y += 0.03;
      fill.position.y += 0.04;
      for (const m of [edge, fill]) {
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -3;
        mat.polygonOffsetUnits = -3;
      }
    } else {
      edge.rotation.x = fill.rotation.x = FACE_CAMERA;
      fill.renderOrder = TOP + 1;
      fill.position.z += 0.01;
    }
    return {
      set(size, opacity = 1) {
        fill.scale.setScalar(Math.max(size, 0.001));
        edge.scale.setScalar(Math.max(size + 0.07, 0.001));
        show(fill, opacity);
        show(edge, opacity);
      },
    };
  }

  strike(): void {
    for (const mesh of this.made) {
      mesh.removeFromParent();
      (mesh.material as THREE.Material).dispose();
    }
    this.made = [];
  }
}
interface Edged { set(size: number, opacity?: number): void }

function show(mesh: THREE.Mesh, opacity: number): void {
  (mesh.material as THREE.MeshBasicMaterial).opacity = clamp(opacity);
  mesh.visible = opacity > 0.01;
}

/** Run an effect with its own props, and clear them away however it ends. */
async function staged(ctx: KitCtx, run: (props: Props) => Promise<unknown>): Promise<void> {
  const props = new Props(ctx.scene);
  try {
    await run(props);
  } finally {
    props.strike();
  }
}

const up = (v: THREE.Vector3, dy: number): THREE.Vector3 => v.clone().setY(v.y + dy);

/** A star that jumps out and is gone: muzzle flashes, sparks, the moment of a hit. */
function flash(props: Props, color: string, at: THREE.Vector3, size: number, ms: number): Promise<void> {
  const star = props.edged(flashGeo, color, at, false);
  return tween(ms, (k) => star.set(size * (0.4 + 0.6 * out(span(k, 0, 0.4))), k < 1 ? 1 : 0));
}

/** A ring on the ground that widens and fades. */
function pulse(props: Props, color: string, at: THREE.Vector3, from: number, to: number, ms: number): Promise<void> {
  const edge = props.mesh(ringGeo, TOKENS.ink, up(at, 0.03));
  const ring = props.mesh(ringGeo, color, up(at, 0.04));
  return tween(ms, (k) => {
    const size = from + (to - from) * out(k);
    ring.scale.setScalar(size);
    edge.scale.setScalar(size + 0.05);
    show(ring, 1 - k * k);
    show(edge, 0.7 * (1 - k * k));
  });
}

/** Low-poly clouds that swell, rise a little and thin out. */
function dust(props: Props, color: string, at: THREE.Vector3, count: number, spread: number, size: number, ms: number): Promise<void> {
  const puffs = Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + 0.6;
    const mesh = props.mesh(puffGeo, color, at);
    mesh.rotation.set(i, i * 2, 0);
    return { mesh, dx: Math.cos(a) * spread, dz: Math.sin(a) * spread * 0.7, lift: 0.25 + (i % 3) * 0.12 };
  });
  return tween(ms, (k) => {
    for (const p of puffs) {
      p.mesh.position.set(at.x + p.dx * out(k), at.y + 0.1 + p.lift * out(k), at.z + p.dz * out(k));
      p.mesh.scale.setScalar(size * (0.45 + 0.55 * out(k)));
      show(p.mesh, 0.85 * (1 - span(k, 0.3, 1)));
    }
  });
}

// ---- fire

const UNSEEN = new THREE.Vector3(0.9, 1.5, -2.6).normalize();   // from high at the back, over the fog

/** One tracer: an amber bolt in an ink sleeve, leaving a line that fades. */
async function tracer(props: Props, from: THREE.Vector3, to: THREE.Vector3, sourceShown: boolean): Promise<void> {
  const dist = from.distanceTo(to);
  const length = Math.min(1.1, dist * 0.45);
  const sleeve = props.mesh(boltGeo, TOKENS.ink, from);
  const bolt = props.mesh(boltGeo, TOKENS.amber, from);
  const trail = props.mesh(boltGeo, TOKENS.amber, from);
  bolt.renderOrder = TOP + 1;
  for (const m of [sleeve, bolt, trail]) m.lookAt(to);
  const head = new THREE.Vector3();
  await tween(clamp(dist * 32, 140, 300), (k) => {
    head.lerpVectors(from, to, k);
    const visible = sourceShown ? 1 : span(k, 0.15, 0.6);   // out of nowhere: it fades in
    const len = Math.min(length, dist * k + 0.05);
    bolt.position.copy(head);
    sleeve.position.copy(head);
    bolt.scale.set(0.075, 0.075, len);
    sleeve.scale.set(0.15, 0.15, len + 0.06);
    show(bolt, visible);
    show(sleeve, visible);
    trail.position.copy(head);
    trail.scale.set(0.03, 0.03, Math.max(0.01, dist * k));
    show(trail, sourceShown ? 0.6 : 0);
  });
  show(bolt, 0);
  show(sleeve, 0);
  await Promise.all([
    flash(props, TOKENS.amber, to, 0.2, 130),
    tween(200, (k) => show(trail, sourceShown ? 0.6 * (1 - k) : 0)),
  ]);
}

function fire(e: Event<'fire'>, ctx: KitCtx): Promise<void> {
  return staged(ctx, async (props) => {
    const hexes: Hex[] = e.blast > 0 ? [e.target, ...neighbors(e.target)] : [e.target];
    const ends = hexes.map((h, i) => up(ctx.hexToWorld(h), i === 0 ? 0.45 : 0.2));
    let muzzle: THREE.Vector3 | null = null;
    if (e.from) {
      muzzle = up(ctx.hexToWorld(e.from), 0.62);
      const reach = ends[0].clone().sub(muzzle);
      if (reach.length() > 0.8) muzzle.addScaledVector(reach.normalize(), 0.4);
    }
    const shots: Promise<void>[] = [];
    if (muzzle) shots.push(flash(props, TOKENS.amber, muzzle, 0.3, e.blast > 0 ? 420 : 150));
    ends.forEach((end, i) => {
      const from = muzzle ?? end.clone().addScaledVector(UNSEEN, 4.5);
      shots.push(pause(i * 48).then(() => tracer(props, from, end, muzzle !== null)));
    });
    await Promise.all(shots);
  });
}

// ---- mortar

const SKY = 18;   // world units up: well out of the picture

function launch(e: Event<'launch'>, ctx: KitCtx): Promise<void> {
  return staged(ctx, async (props) => {
    const tube = up(ctx.hexToWorld(e.from), 0.6);
    tube.x += 0.42;
    const shell = props.mesh(shellGeo, TOKENS.ink, tube);
    const smoke = props.mesh(boltGeo, TOKENS.paper, tube);
    smoke.rotation.x = Math.PI / 2;   // the box runs down from the shell
    await Promise.all([
      flash(props, TOKENS.amber, tube, 0.32, 160),
      dust(props, TOKENS.paper, tube, 4, 0.35, 0.2, 520),
      tween(520, (k) => {
        const rise = SKY * k * k + 0.6 * k;
        shell.position.set(tube.x + 0.5 * k, tube.y + rise, tube.z);
        smoke.position.copy(shell.position);
        smoke.scale.set(0.05, 0.05, Math.min(rise, 2.2));
        show(smoke, 0.7 * (1 - span(k, 0.5, 1)));
      }),
    ]);
  });
}

function impact(e: Event<'impact'>, ctx: KitCtx): Promise<void> {
  return staged(ctx, async (props) => {
    const centre = ctx.hexToWorld(e.target);
    const shell = props.mesh(shellGeo, TOKENS.ink, centre);
    shell.rotation.x = Math.PI;       // nose down
    const smoke = props.mesh(boltGeo, TOKENS.paper, centre);
    smoke.rotation.x = -Math.PI / 2;  // the box runs up from the shell
    await tween(380, (k) => {
      const height = SKY * (1 - k) * (1 - k * 0.5) + 0.2;
      shell.position.set(centre.x - 0.5 * (1 - k), centre.y + height, centre.z);
      smoke.position.copy(shell.position);
      smoke.scale.set(0.05, 0.05, 2.2);
      show(smoke, 0.7 * span(k, 0, 0.3));
    });
    show(shell, 0);
    show(smoke, 0);
    // A low burst on each hex of the area, the middle first; then dust.
    const hexes: Hex[] = e.blast > 0 ? [e.target, ...neighbors(e.target)] : [e.target];
    await Promise.all(hexes.map(async (hex, i) => {
      const at = ctx.hexToWorld(hex);
      if (i > 0) await pause(70);
      const burst = props.edged(burstGeo, TOKENS.amber, at, true);
      const size = i === 0 ? 0.95 : 0.7;
      await Promise.all([
        tween(520, (k) => burst.set(size * (0.3 + 0.7 * out(span(k, 0, 0.3))), 1 - span(k, 0.5, 1))),
        i === 0 ? flash(props, TOKENS.amber, up(at, 0.5), 0.6, 200) : Promise.resolve(),
        dust(props, i === 0 ? TOKENS.paper : TOKENS.khaki, at, i === 0 ? 5 : 2, 0.5, i === 0 ? 0.3 : 0.2, 700),
      ]);
    }));
  });
}

// ---- units

function hit(e: Event<'hit'>, ctx: KitCtx): Promise<void> {
  return staged(ctx, async (props) => {
    const object = ctx.unitObject(e.unit);
    const at = object ? object.position.clone() : ctx.hexToWorld(e.at);
    if (e.result === 'cover') {
      await flash(props, TOKENS.amber, up(at, 0.75).setX(at.x + 0.35), 0.2, 260);
      return;
    }
    const rig = rigOf(object);
    const from = rig?.status() ?? 'ready';
    const down = e.result === 'down';
    await Promise.all([
      flash(props, TOKENS.rust, up(at, 1.15), down ? 0.5 : 0.36, down ? 300 : 240),
      rig ? tween(down ? 560 : 340, (k) => {
        rig.blend(from, e.result as 'pinned' | 'down', smooth(k));
        // The burst jumps out a little too far, then settles.
        if (!down) rig.mark.scale.setScalar(Math.max(0.01, out(span(k, 0, 0.5)) * 1.15 - 0.15 * span(k, 0.5, 1)));
      }) : pause(200),
    ]);
  });
}

function move(e: Event<'move'>, ctx: KitCtx): Promise<void> {
  return staged(ctx, async (props) => {
    const object = ctx.unitObject(e.unit);
    if (!object) return;
    const a = ctx.hexToWorld(e.from);
    const b = ctx.hexToWorld(e.to);
    const rig = rigOf(object);
    const dash = rig?.dashes(e.step) ?? false;
    const climbing = b.y > a.y;
    const parts: Promise<void>[] = [tween(dash ? 210 : 360, (k) => {
      const along = dash ? k : smooth(k);
      // Up a step: gain the height before the edge. Down: keep it until past the edge.
      const rise = b.y === a.y ? 0 : smooth(climbing ? span(k, 0, 0.5) : span(k, 0.5, 1));
      object.position.set(
        a.x + (b.x - a.x) * along,
        a.y + (b.y - a.y) * rise + arc(k) * (dash ? 0.07 : 0.14),
        a.z + (b.z - a.z) * along,
      );
      if (dash && rig?.status() === 'ready') rig.lean(b.x - a.x, b.z - a.z, 0.4 * arc(k * 0.98));
    })];
    if (dash) parts.push(dust(props, TOKENS.khaki, a, 2, 0.25, 0.14, 300));
    await Promise.all(parts);
    if (dash && rig?.status() === 'ready') rig.lean(1, 0, 0);
  });
}

function blocked(e: Event<'blocked'>, ctx: KitCtx): Promise<void> {
  return staged(ctx, async (props) => {
    const object = ctx.unitObject(e.unit);
    if (!object) return;
    const home = ctx.hexToWorld(e.at);
    await Promise.all([
      dust(props, TOKENS.khaki, home, 3, 0.55, 0.13, 340),
      tween(340, (k) => {
        // A start forward, a jolt back, and still. (The event does not say which way he was going.)
        object.position.set(home.x + 0.3 * Math.sin(k * Math.PI * 3) * (1 - k), home.y + 0.1 * arc(k * 2), home.z);
      }),
    ]);
    object.position.copy(home);
  });
}

/** Show a unit at an opacity from one value to another, then give it its own materials back. */
async function fade(object: THREE.Object3D, from: number, to: number, ms: number): Promise<void> {
  const own: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[]; shadow: boolean }[] = [];
  const ghosts = new Map<THREE.Material, THREE.Material>();
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    own.push({ mesh, material: mesh.material, shadow: mesh.castShadow });
    let ghost = ghosts.get(mesh.material);
    if (!ghost) {
      ghost = mesh.material.clone();
      ghost.transparent = true;
      ghost.userData.full = mesh.material.opacity;
      ghosts.set(mesh.material, ghost);
    }
    mesh.material = ghost;
    mesh.castShadow = false;
  });
  try {
    await tween(ms, (k) => {
      for (const ghost of ghosts.values()) ghost.opacity = ghost.userData.full * (from + (to - from) * k);
    });
  } finally {
    if (to === 0) object.visible = false;   // gone: the board takes it off next
    for (const o of own) {
      o.mesh.material = o.material;
      o.mesh.castShadow = o.shadow;
    }
    for (const ghost of ghosts.values()) ghost.dispose();
  }
}

async function sight(id: UnitId, ctx: KitCtx, appear: boolean): Promise<void> {
  const object = ctx.unitObject(id);
  if (object) await fade(object, appear ? 0 : 1, appear ? 1 : 0, 280);
}

/** A unit gets back on its feet, in a ring of paper. `helper` is the medic, if one came. */
function stand(id: UnitId, helper: UnitId | null, ctx: KitCtx): Promise<void> {
  return staged(ctx, async (props) => {
    const object = ctx.unitObject(id);
    if (!object) return;
    const rig = rigOf(object);
    const from = rig?.status() ?? 'ready';
    const medic = helper ? ctx.unitObject(helper) : null;
    await Promise.all([
      pulse(props, TOKENS.paper, object.position, 0.45, 1.05, 520),
      medic ? pulse(props, TOKENS.paper, medic.position, 0.3, 0.7, 380) : Promise.resolve(),
      rig && from !== 'ready' ? tween(360, (k) => rig.blend(from, 'ready', smooth(k))) : Promise.resolve(),
    ]);
  });
}

// ---- scoring

function score(e: Event<'score'>, ctx: KitCtx, marker: THREE.Object3D | undefined): Promise<void> {
  return staged(ctx, async (props) => {
    if (!marker) return;
    const sign = marker.userData.sign as THREE.Object3D | undefined;
    const top = up(marker.position, 2.05);
    top.z -= 0.5;
    // The number is cut twice: amber, on a hard ink shadow.
    const label = `+${e.value}`;
    const shadow = text(label, 0.8, TOKENS.ink);
    const number = text(label, 0.8, TOKENS.amber);
    const figures = [shadow, number].filter((m): m is THREE.Mesh => m !== null);
    for (const m of figures) {
      m.rotation.x = FACE_CAMERA;
      m.renderOrder = TOP + (m === number ? 2 : 1);
      ctx.scene.add(m);
    }
    try {
      await Promise.all([
        pulse(props, TOKENS.amber, marker.position, 0.5, 1.15, 600),
        pause(260).then(() => pulse(props, TOKENS.amber, marker.position, 0.5, 1.15, 600)),
        tween(950, (k) => {
          sign?.scale.setScalar(1 + 0.45 * arc(span(k, 0, 0.35)) + 0.3 * arc(span(k, 0.35, 0.7)));
          const rise = 0.7 * out(k);
          number?.position.set(top.x, top.y + rise, top.z);
          shadow?.position.set(top.x + 0.05, top.y + rise - 0.05, top.z - 0.01);
          for (const m of figures) show(m, Math.min(span(k, 0, 0.12), 1 - span(k, 0.75, 1)));
        }),
      ]);
    } finally {
      sign?.scale.setScalar(1);
      for (const m of figures) {
        m.removeFromParent();
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    }
  });
}

/** A unit given away by an action: a ring of amber where it stands. */
function lit(e: Event<'reveal'>, ctx: KitCtx): Promise<void> {
  return staged(ctx, async (props) => {
    const object = ctx.unitObject(e.unit);
    if (object) await pulse(props, TOKENS.amber, object.position.clone(), 0.3, 0.95, 420);
  });
}

// ---- actions

/** What this kit can draw for an action: one function per event that speaks of it. */
interface Look {
  fire(e: Event<'fire'>, ctx: KitCtx): Promise<void>;
  launch(e: Event<'launch'>, ctx: KitCtx): Promise<void>;
  impact(e: Event<'impact'>, ctx: KitCtx): Promise<void>;
  treat(e: Event<'treat'>, ctx: KitCtx): Promise<void>;
  reveal(e: Event<'reveal'>, ctx: KitCtx): Promise<void>;
}

/** The plain look: what an action gets when the kit has nothing of its own for it. */
const PLAIN: Look = {
  fire, launch, impact,
  treat: (e, ctx) => stand(e.target, e.unit, ctx),
  reveal: lit,
};

/**
 * Looks by an action's `icon` (see ACTIONS in src/content). A look lists only
 * what differs from the plain one. An icon that is not here is drawn plain.
 */
export const LOOKS: Record<string, Partial<Look>> = {
  rifle: { fire },
  burst: { fire },
  snipe: { fire },
  shell: { launch, impact },
  aid: { treat: (e, ctx) => stand(e.target, e.unit, ctx) },
};

/** The look for the action an event names; the plain one for an action or icon this kit does not know. */
export function lookFor(action: string): Look {
  const icon = Object.hasOwn(ACTIONS, action) ? ACTIONS[action].icon : '';
  return { ...PLAIN, ...(Object.hasOwn(LOOKS, icon) ? LOOKS[icon] : {}) };
}

// ---- the kit's `effect`

/**
 * `markers` are the objective markers this kit has made, by objective id: a
 * `score` event names its objective, and the marker is what pulses.
 */
export function effect(event: GameEvent, ctx: KitCtx, markers: Map<string, THREE.Object3D>): Promise<void> {
  switch (event.t) {
    case 'fire': return lookFor(event.action).fire(event, ctx);
    case 'launch': return lookFor(event.action).launch(event, ctx);
    case 'impact': return lookFor(event.action).impact(event, ctx);
    case 'treat': return lookFor(event.action).treat(event, ctx);
    case 'reveal': return lookFor(event.action).reveal(event, ctx);
    case 'hit': return hit(event, ctx);
    case 'move': return move(event, ctx);
    case 'blocked': return blocked(event, ctx);
    case 'spotted': return sight(event.unit.id, ctx, true);
    case 'lost': return sight(event.unit, ctx, false);
    case 'recover': return stand(event.unit, null, ctx);
    // A score whose objective is not named (its holder is out of sight) shows nothing on the map.
    case 'score': return score(event, ctx, event.objective === null ? undefined : markers.get(event.objective));
    default: return Promise.resolve();   // eliminated, over, phase, dash: nothing in the world
  }
}
