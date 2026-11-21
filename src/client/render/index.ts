// The board: draws one player's view with a visual kit, and reports taps.
// It knows the map's shape and the camera; it builds no geometry of its own
// and decides nothing about the game. See kit.ts for the world convention.

import * as THREE from 'three';
import { WORKS } from '../../content';
import type { GameEvent, GameMap, Hex, HexKey, Objective, PlayerId, PlayerView, TerrainId, Unit, UnitId } from '../../shared/types';
import { hexToPixel, key, parseKey } from '../../shared/hex';
import type { KitCtx, UnitVisual, VisualKit } from './kit';
import { createOccupancy } from './occupancy';
import { createPlayback } from './playback';
import { createTiling } from './tiling';

export type { VisualKit, UnitVisual, KitCtx, Around } from './kit';

export interface Board {
  setView(view: PlayerView): void;               // snap the board to this view
  setMarks(marks: Mark[]): void;                 // replace all planning marks
  play(events: GameEvent[]): Promise<void>;      // animate one round (see playback.ts)
  onHexTap(cb: (hex: Hex, unit: Unit | null) => void): void;
  focus(hex: Hex): void;                         // centre the camera
  resize(): void;
  dispose(): void;
}

/**
 * (23) `at` itself if it is within `reach` of one of `points` (or there are none), else the point `reach` from the
 * nearest of them on the way to `at`.
 */
export function keepOverMap(points: readonly { x: number; z: number }[], at: { x: number; z: number }, reach: number): { x: number; z: number } {
  let best = Infinity;
  let near: { x: number; z: number } | null = null;
  for (const p of points) {
    const d = Math.hypot(p.x - at.x, p.z - at.z);
    if (d < best) { best = d; near = p; }
  }
  if (!near || best <= reach) return at;
  const f = reach / best;
  return { x: near.x + (at.x - near.x) * f, z: near.z + (at.z - near.z) * f };
}

export type Mark =
  | { kind: 'select'; hex: Hex }
  | { kind: 'path'; from: Hex; path: Hex[]; dash: boolean }
  | { kind: 'target'; from: Hex; hex: Hex; blast: number }
  | { kind: 'ambush'; hex: Hex }
  | { kind: 'options'; hexes: Hex[] };

const LEVEL = 0.5;                       // world units per elevation level
const TILT = (55 * Math.PI) / 180;       // camera angle above the ground
const SIN_TILT = Math.sin(TILT);
const COS_TILT = Math.cos(TILT);
const CAMERA_DISTANCE = 100;
const MAX_PIXEL_RATIO = 2;
const EDGE = 1.2;                        // world units the screen may show beyond the outermost hex centres (a hex and a bit)
const TAP_SLOP = 8;                      // px a finger may wander and still be a tap
/**
 * Pixels per world unit: the smallest comfortable first look. A board with room for the whole map at this
 * scale opens on all of it (the 17 x 13 crossroads on a laptop); a smaller one opens at this scale on the
 * middle and the play screen then moves to the squad. Hex labels are drawn to be readable at it.
 */
export const START_SCALE = 28;
const CLOSEST = 4;                       // world units across the short side at full zoom

interface Tile { object: THREE.Object3D; veil: THREE.Object3D | null }
interface Piece { visual: UnitVisual; type: string; owner: number }

export function createBoard(canvas: HTMLCanvasElement, kit: VisualKit): Board {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  kit.renderer?.(renderer);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4 * CAMERA_DISTANCE);
  const tileLayer = new THREE.Group();
  const veilLayer = new THREE.Group();
  const objectiveLayer = new THREE.Group();
  const unitLayer = new THREE.Group();
  const markLayer = new THREE.Group();
  scene.add(tileLayer, veilLayer, objectiveLayer, unitLayer, markLayer);
  kit.environment(scene);
  const fog = kit.fog();

  let view: PlayerView | null = null;
  let map: GameMap | null = null;
  let mapSign = '';
  let marks: Mark[] = [];
  const tiles = new Map<HexKey, Tile>();
  const tiling = createTiling(kit);        // (28) what is drawn on each hex; it tells every tile its neighbours
  const pieces = new Map<UnitId, Piece>();
  const units = new Map<UnitId, Unit>();   // the board's own copies: playback moves them
  const flags = new Map<string, { object: THREE.Object3D; owner: PlayerId | null }>();   // objective id -> what is drawn
  let tapCb: ((hex: Hex, unit: Unit | null) => void) | null = null;

  // Camera state: the ground point at screen centre, and pixels per world unit.
  const target = new THREE.Vector3();
  let scale = START_SCALE;
  let width = 1;
  let height = 1;
  const bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, top: 0 };
  const centres: { x: number; z: number }[] = [];   // every hex centre on the ground, for `keepOverMap` (23)

  // ---- drawing on demand

  let frame = 0;
  let disposed = false;
  let playing = false;                     // while a round plays, every frame is drawn
  function invalidate(): void {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderer.render(scene, camera);
      if (playing) invalidate();
    });
  }

  // ---- occupied hexes (27): a kit that wants to know is told when a hex gains or loses a shown unit

  const occupied = createOccupancy((k, on) => {
    const tile = tiles.get(k);
    if (tile) kit.occupied?.(tile.object, on);
    invalidate();
  });

  // ---- the dawn (19): the kit's light follows the view's `dawn`, eased over about a second

  const DAWN_EASE = 1000;                  // ms
  let dawnShown: number | null = null;     // what the kit was last told; null = never
  let dawnFrame = 0;
  function setDawn(to: number): void {
    if (!kit.light) return;
    const goal = Math.min(1, Math.max(0, Number.isFinite(to) ? to : 1));
    if (dawnFrame) { cancelAnimationFrame(dawnFrame); dawnFrame = 0; }
    if (dawnShown === null || dawnShown === goal) {
      // The first view sets the light at once; the same light again changes nothing.
      if (dawnShown === null) kit.light(scene, goal);
      dawnShown = goal;
      invalidate();
      return;
    }
    const from = dawnShown;
    const start = performance.now();
    const step = (now: number) => {
      dawnFrame = 0;
      if (disposed) return;
      const k = Math.min(1, (now - start) / DAWN_EASE);
      const eased = k * k * (3 - 2 * k);
      dawnShown = from + (goal - from) * eased;
      kit.light?.(scene, dawnShown);
      invalidate();
      if (k < 1) dawnFrame = requestAnimationFrame(step);
      else dawnShown = goal;
    };
    dawnFrame = requestAnimationFrame(step);
  }

  // ---- geometry of the map

  function hexToWorld(hex: Hex): THREE.Vector3 {
    const p = hexToPixel(hex, 1);
    const cell = map?.cells[key(hex)];
    return new THREE.Vector3(p.x, (cell?.elevation ?? 0) * LEVEL, p.y);
  }

  const ctx: KitCtx = {
    scene,
    hexToWorld,
    unitObject: (id) => pieces.get(id)?.visual.object ?? null,
  };

  // ---- camera

  function fitScale(): number {
    // Hex centres to hex edges, plus room at the back for what stands on the tiles.
    const spanX = bounds.maxX - bounds.minX + 2.2;
    const spanY = (bounds.maxZ - bounds.minZ + 2.2) * SIN_TILT + (bounds.top + 1.6) * COS_TILT;
    return Math.min(width / spanX, height / spanY);
  }

  /**
   * Keep the camera over the map. Along an axis where the map is bigger than the screen, the screen's edge may
   * reach no further than a hex beyond the outermost hexes, so a squad in a corner is not shown in a sea of
   * slate. Along an axis where the whole map fits, the map stays centred and cannot be pushed off the middle.
   */
  function clampAxis(v: number, lo: number, hi: number, half: number, centre: number): number {
    const a = lo - EDGE + half;
    const b = hi + EDGE - half;
    return a <= b ? Math.min(b, Math.max(a, v)) : centre;
  }
  /** Where the camera centres on a map that fits: a little up the screen, so raised ground at the far edge stays in frame. */
  const lift = (): number => ((bounds.top + 1.6) * COS_TILT) / SIN_TILT / 2;
  function clampAxes(x: number, z: number): { x: number; z: number } {
    return {
      x: clampAxis(x, bounds.minX, bounds.maxX, width / 2 / scale, (bounds.minX + bounds.maxX) / 2),
      // Room above the top row for what stands up on it: woods and men on raised ground reach up the screen.
      z: clampAxis(z, bounds.minZ - lift(), bounds.maxZ, height / 2 / (scale * SIN_TILT), (bounds.minZ + bounds.maxZ) / 2 - lift()),
    };
  }
  /**
   * The axes' limits, and then (23) the middle of the screen kept over the map: a map that is not a rectangle (the
   * triangle) leaves corners of its bounds with no hex in them, where the axes alone would let a zoomed-in camera
   * look at nothing but slate.
   */
  function clampTarget(x: number, z: number): { x: number; z: number } {
    const at = clampAxes(x, z);
    const over = keepOverMap(centres, at, EDGE);
    return over === at ? at : clampAxes(over.x, over.z);
  }

  function applyCamera(): void {
    const lo = fitScale();
    const hi = Math.max(lo, Math.min(width, height) / CLOSEST);
    scale = Math.min(hi, Math.max(lo, scale));
    const at = clampTarget(target.x, target.z);
    target.x = at.x;
    target.z = at.z;
    target.y = 0;
    camera.left = -width / 2 / scale;
    camera.right = width / 2 / scale;
    camera.top = height / 2 / scale;
    camera.bottom = -height / 2 / scale;
    camera.position.set(
      target.x,
      target.y + CAMERA_DISTANCE * SIN_TILT,
      target.z + CAMERA_DISTANCE * COS_TILT,
    );
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    invalidate();
  }

  /** Move the ground under the pointer by a screen distance. */
  function pan(dx: number, dy: number): void {
    target.x -= dx / scale;
    target.z -= dy / (scale * SIN_TILT);
    applyCamera();
  }

  /** Zoom by `factor`, keeping the ground under canvas point (x, y) still. */
  function zoomAt(x: number, y: number, factor: number): void {
    const sx = x - width / 2;
    const sy = y - height / 2;
    const before = scale;
    scale *= factor;
    const lo = fitScale();
    scale = Math.min(Math.max(lo, Math.min(width, height) / CLOSEST), Math.max(lo, scale));
    target.x += sx / before - sx / scale;
    target.z += sy / (before * SIN_TILT) - sy / (scale * SIN_TILT);
    applyCamera();
  }

  function frameMap(): void {
    target.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
    // Lift the centre a little so raised ground at the far edge stays in frame.
    target.z -= lift();
    scale = Math.max(fitScale(), START_SCALE);
    applyCamera();
  }

  /** True while the camera sits where `frameMap` puts it: nobody has panned or zoomed since. */
  function isFramed(): boolean {
    if (tiles.size === 0) return false;
    const lo = fitScale();
    const framedScale = Math.min(Math.max(lo, Math.min(width, height) / CLOSEST), Math.max(lo, START_SCALE));
    const framed = { scale, ...clampTarget((bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2 - lift()) };
    return Math.abs(scale - framedScale) < 1e-6 && Math.abs(target.x - framed.x) < 1e-6 && Math.abs(target.z - framed.z) < 1e-6;
  }

  function resize(): void {
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    const wasFramed = isFramed();            // asked with the old size, before it changes
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(w, h, false);
    width = w;
    height = h;
    // A map that was framed stays framed when the box changes shape (a phone turned on its side);
    // one the player has moved the camera on keeps their view.
    if (wasFramed) frameMap(); else applyCamera();
  }

  // ---- tiles and fog

  /** What makes a map a different board: its hexes, their heights and the objectives. Not the terrain: a work (25)
   *  changes a hex's terrain mid-match, and that hex is drawn again on its own (`retile`), the camera left alone. */
  function signature(m: GameMap): string {
    const cells = Object.keys(m.cells).map((k) => `${k}:${m.cells[k].elevation}`);
    const objectives = m.objectives.map((o) => `${o.id}:${o.kind}@${o.hexes.map(key).join('+')}=${o.value}`);
    return `${m.id}|${cells.join(' ')}|${objectives.join(' ')}`;
  }

  function buildMap(m: GameMap): void {
    occupied.reset();                        // new tiles: each unit shown again tells its hex
    tileLayer.clear();
    veilLayer.clear();
    objectiveLayer.clear();
    tiles.clear();
    centres.length = 0;
    map = m;
    let first = true;
    for (const { key: k, object } of tiling.build(m.cells)) {
      const hex = parseKey(k);
      const cell = m.cells[k];
      const p = hexToPixel(hex, 1);
      object.position.set(p.x, 0, p.y);
      object.userData.hex = hex;
      tileLayer.add(object);
      tiles.set(k, { object, veil: null });
      centres.push({ x: p.x, z: p.y });
      if (first) {
        bounds.minX = bounds.maxX = p.x;
        bounds.minZ = bounds.maxZ = p.y;
        bounds.top = 0;
        first = false;
      }
      bounds.minX = Math.min(bounds.minX, p.x);
      bounds.maxX = Math.max(bounds.maxX, p.x);
      bounds.minZ = Math.min(bounds.minZ, p.y);
      bounds.maxZ = Math.max(bounds.maxZ, p.y);
      bounds.top = Math.max(bounds.top, cell.elevation * LEVEL);
    }
    flags.clear();
    for (const objective of m.objectives) drawObjective(objective, null);
    frameMap();
  }

  /**
   * (Re)draw an objective with its flag in the owner's colour. The kit's object stands at the top of the
   * area's first hex; a part it tags with `userData.hex` is lifted to that hex's own height.
   */
  function drawObjective(objective: Objective, owner: PlayerId | null): void {
    const old = flags.get(objective.id);
    if (old) objectiveLayer.remove(old.object);
    const object = kit.objective(objective, owner);
    const origin = hexToWorld(objective.hexes[0]);
    object.position.copy(origin);
    object.traverse((part) => {
      const h = part.userData.hex as Hex | undefined;
      if (h && part !== object) part.position.y += hexToWorld(h).y - origin.y;
    });
    objectiveLayer.add(object);
    flags.set(objective.id, { object, owner });
    invalidate();
  }

  /** Show this owner's flag over the objective, if it is not already. */
  function setFlag(id: string, owner: PlayerId | null): void {
    const objective = map?.objectives.find((o) => o.id === id);
    if (!objective || flags.get(id)?.owner === owner) return;
    drawObjective(objective, owner);
  }

  /**
   * (25) A hex's terrain is not what was drawn there (a work went up): the kit is asked again for it and, (28)
   * since a tile knows its neighbours, for the hexes round it. Each new tile takes the old one's place and keeps
   * its veil's state and whoever stands on it.
   */
  function retile(k: HexKey, terrain: TerrainId): void {
    for (const { key: at, object } of tiling.retile(k, terrain)) {
      const tile = tiles.get(at);
      if (!tile) continue;
      const hex = parseKey(at);
      const p = hexToPixel(hex, 1);
      object.position.set(p.x, 0, p.y);
      object.userData.hex = hex;
      tile.object.removeFromParent();
      tileLayer.add(object);
      const hidden = tile.veil?.visible ?? false;
      tile.veil?.removeFromParent();
      const veil = tile.veil ? makeVeil(object) : null;   // made before the new tile is told of anyone on it
      if (occupied.has(at)) kit.occupied?.(object, true);
      if (veil) { veil.visible = hidden; veilLayer.add(veil); }
      tiles.set(at, { object, veil });
    }
    invalidate();
  }

  /** (25) Every hex of this map whose terrain differs from what was drawn there, drawn again. */
  function retileAll(m: GameMap): void {
    for (const k of tiles.keys()) {
      const cell = m.cells[k];
      if (cell && cell.terrain !== tiling.terrainOf(k)) retile(k, cell.terrain);
    }
  }

  /** A copy of a tile's solid parts, wearing the kit's fog material. */
  function makeVeil(tile: THREE.Object3D): THREE.Object3D {
    const veil = tile.clone(true);
    const drop: THREE.Object3D[] = [];
    veil.traverse((o) => {
      if (o === veil) return;
      const mesh = o as THREE.Mesh;
      const solid = mesh.isMesh && [mesh.material].flat().every(
        (m) => !m.transparent && m.side !== THREE.BackSide,
      );
      if (solid) {
        mesh.material = fog;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = 1;
      } else if (o.children.length === 0) {
        drop.push(o);
      }
    });
    for (const o of drop) o.removeFromParent();
    return veil;
  }

  function applyFog(visible: Set<HexKey>): void {
    for (const [k, tile] of tiles) {
      const hidden = !visible.has(k);
      if (hidden && !tile.veil) {
        // (27) The veil is a copy of the tile as nobody stands on it, whatever stands on it now.
        const open = occupied.has(k) && kit.occupied !== undefined;
        if (open) kit.occupied!(tile.object, false);
        tile.veil = makeVeil(tile.object);
        if (open) kit.occupied!(tile.object, true);
        veilLayer.add(tile.veil);
      }
      if (tile.veil) tile.veil.visible = hidden;
    }
  }

  // ---- units

  /** Put a unit's piece where the unit is, in its status; make the piece if need be. */
  function showUnit(unit: Unit): void {
    let piece = pieces.get(unit.id);
    if (piece && (piece.type !== unit.type || piece.owner !== unit.owner)) {
      piece.visual.object.removeFromParent();
      piece = undefined;
    }
    if (!piece) {
      piece = { visual: kit.unit(unit.type, unit.owner), type: unit.type, owner: unit.owner };
      piece.visual.object.userData.unitId = unit.id;
      unitLayer.add(piece.visual.object);
      pieces.set(unit.id, piece);
    }
    piece.visual.object.position.copy(hexToWorld(unit.pos));
    piece.visual.setStatus(unit.status);
    piece.visual.setDugIn?.(unit.dugIn === true && unit.status !== 'down');   // (24)
    if (kit.occupied) occupied.place(unit.id, key(unit.pos));                 // (27)
    invalidate();
  }

  function hideUnit(id: UnitId): void {
    pieces.get(id)?.visual.object.removeFromParent();
    pieces.delete(id);
    if (kit.occupied) occupied.remove(id);
    invalidate();
  }

  function applyUnits(next: Unit[]): void {
    units.clear();
    for (const unit of next) {
      units.set(unit.id, { ...unit, pos: { ...unit.pos } });
      showUnit(unit);
    }
    for (const id of [...pieces.keys()]) if (!units.has(id)) hideUnit(id);
  }

  // ---- playback: one round at a time

  const playback = createPlayback({
    effect: kit.effect ? (event, c) => {
      // (27) A piece setting off counts on the hex it is going to from its first stride.
      if (kit.occupied && event.t === 'move' && pieces.has(event.unit)) occupied.heading(event.unit, key(event.to));
      return kit.effect!(event, c);
    } : undefined,
    ctx,
    viewer: () => view?.player ?? null,
    units,
    show: showUnit,
    hide: hideUnit,
    flag: setFlag,
    work: (at, work) => retile(key(at), WORKS[work]?.terrain ?? work),
    skip: () => disposed || (typeof document !== 'undefined' && document.hidden),
  });
  let rounds: Promise<void> = Promise.resolve();

  function applyMarks(): void {
    for (const old of [...markLayer.children]) {
      old.removeFromParent();
      old.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    for (const mark of marks) markLayer.add(kit.mark(mark, ctx));
    invalidate();
  }

  // ---- picking

  const raycaster = new THREE.Raycaster();

  function pick(x: number, y: number): Hex | null {
    const ndc = new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1);
    scene.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects([tileLayer, unitLayer], true);
    for (const hit of hits) {
      if (!(hit.object as THREE.Mesh).isMesh) continue;
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
        if (o.userData.hex) return o.userData.hex as Hex;
        const id = o.userData.unitId as UnitId | undefined;
        const unit = id === undefined ? undefined : units.get(id);
        if (unit) return unit.pos;
      }
    }
    return null;
  }

  function unitAt(hex: Hex): Unit | null {
    const here = [...units.values()].filter((u) => u.pos.q === hex.q && u.pos.r === hex.r);
    return here.find((u) => u.status !== 'down') ?? here[0] ?? null;
  }

  // ---- input: one pointer drags, two pinch, a still press is a tap

  const pointers = new Map<number, { x: number; y: number }>();
  let tapStart: { x: number; y: number } | null = null;

  function local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDown(e: PointerEvent): void {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
    const p = local(e);
    pointers.set(e.pointerId, p);
    tapStart = pointers.size === 1 ? p : null;
  }

  function onMove(e: PointerEvent): void {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const p = local(e);
    if (pointers.size === 1) {
      if (tapStart && Math.hypot(p.x - tapStart.x, p.y - tapStart.y) > TAP_SLOP) tapStart = null;
      if (!tapStart) pan(p.x - last.x, p.y - last.y);
      // While it may still be a tap, hold the pointer where the press began,
      // so the map does not jump when the drag starts.
      if (!tapStart) pointers.set(e.pointerId, p);
    } else if (pointers.size === 2) {
      let other = last;
      for (const [id, q] of pointers) if (id !== e.pointerId) other = q;
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(p.x - other.x, p.y - other.y);
      const midBefore = { x: (last.x + other.x) / 2, y: (last.y + other.y) / 2 };
      const mid = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
      pan(mid.x - midBefore.x, mid.y - midBefore.y);
      if (before > 0 && after > 0) zoomAt(mid.x, mid.y, after / before);
      pointers.set(e.pointerId, p);
    }
  }

  function onUp(e: PointerEvent): void {
    if (!pointers.delete(e.pointerId)) return;
    const wasTap = tapStart !== null && e.type === 'pointerup';
    const at = tapStart;
    tapStart = null;
    // After a pinch, the finger left behind must not continue as a jumpy drag.
    for (const [id, p] of pointers) pointers.set(id, { ...p });
    if (!wasTap || !at || !tapCb) return;
    const hex = pick(at.x, at.y);
    if (hex) tapCb(hex, unitAt(hex));
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = local(e);
    const lines = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(p.x, p.y, Math.exp(-lines * 0.0015));
  }

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  resize();

  return {
    setView(next) {
      const sign = signature(next.map);
      if (sign !== mapSign) {
        mapSign = sign;
        buildMap(next.map);
      }
      map = next.map;
      retileAll(next.map);
      view = next;
      applyFog(new Set(next.visible));
      applyUnits(next.units);
      for (const o of next.map.objectives) setFlag(o.id, next.flags?.[o.id] ?? null);
      applyMarks();   // marks sit on the ground, which may be a new map's
      setDawn(next.dawn ?? 1);
    },
    setMarks(next) {
      marks = next;
      applyMarks();
    },
    play(events) {
      // A round waits for the one before it. Playback itself never rejects.
      rounds = rounds.then(async () => {
        playing = true;
        invalidate();
        try {
          await playback(events);
        } finally {
          playing = false;
          invalidate();
        }
      });
      return rounds;
    },
    onHexTap(cb) {
      tapCb = cb;
    },
    focus(hex) {
      const p = hexToWorld(hex);
      // Aim at the hex top, not the ground below it.
      target.set(p.x, 0, p.z - (p.y * COS_TILT) / SIN_TILT);
      applyCamera();
    },
    resize,
    dispose() {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      if (dawnFrame) cancelAnimationFrame(dawnFrame);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      renderer.dispose();
    },
  };
}
