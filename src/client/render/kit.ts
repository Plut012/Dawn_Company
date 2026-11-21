// The visual kit: everything the board can show, asked for by id.
// The board (index.ts) builds no geometry of its own; a kit decides how every
// tile, unit, mark and light looks. A new look is a new kit, or one entry of
// an existing kit replaced.
//
// World convention, shared by the board and every kit:
// - Hex circumradius 1 unit, pointy-top. A hex centre is at
//   (x, z) = hexToPixel(hex, 1); y is up; 0.5 units per elevation level.
// - The camera looks from the south (+z) down at the board and never turns.
// - tile(): local origin is the hex centre at level-0 ground (y = 0). The
//   kit raises the top to elevation * 0.5 itself. The board only sets x, z.
// - unit(): local origin is where it stands. The board puts it at the top
//   centre of its hex.
// - objective(): local origin is the top centre of the area's first hex
//   (`hexes[0]`); the board puts it there, and lifts any part tagged with
//   `userData.hex` by the difference in height to that hex. The board asks
//   again, with the new owner, when a flag changes hands.
// - mark(): built in world space with ctx.hexToWorld. The board adds it as is.
// - light(): the board calls it with the view's `dawn` (0 = first light,
//   1 = full day), easing between values over about a second, and once when
//   the first view arrives. It changes only lights already in the scene;
//   environment() is the full-day look. A kit without it is never dimmed.
// - fog(): the board drapes this material over a copy of every solid mesh
//   (opaque, not back-faced) of each unseen tile, so the veil takes the
//   tile's shape. Lines and see-through parts are left as they are.
// - renderer(): the board calls it once, right after it makes its renderer and
//   before environment(). A kit without it gets the renderer as three makes it.
// - occupied(): the board calls it with a tile it got from tile() when a unit it is drawing comes to stand on
//   that hex (or sets off for it during playback), and again when the last one has gone; never twice the same.
//   A tile starts unoccupied. The veil of an unseen hex is always a copy of the tile as unoccupied.
// An id the kit does not know must give a plain placeholder, never an error.

import type * as THREE from 'three';
import type {
  GameEvent, Hex, Objective, PlayerId, TerrainId, UnitId, UnitStatus, UnitTypeId,
} from '../../shared/types';
import type { Mark } from './index';

export interface VisualKit {
  tokens: Record<string, string>;                       // palette from docs/design.md
  environment(scene: THREE.Scene): void;                // sun, mist, background
  tile(terrain: TerrainId, elevation: number, hex: Hex): THREE.Object3D;
  unit(type: UnitTypeId, owner: PlayerId): UnitVisual;
  mark(mark: Mark, ctx: KitCtx): THREE.Object3D;
  objective(obj: Objective, owner: PlayerId | null): THREE.Object3D;   // the area, and a flag in the owner's colour
  fog(): THREE.Material;                                // veil over unseen hexes
  effect?(event: GameEvent, ctx: KitCtx): Promise<void>;   // added by task 07
  light?(scene: THREE.Scene, dawn: number): void;       // (19) 0 = first light, 1 = full day; the board eases it
  renderer?(r: THREE.WebGLRenderer): void;              // (26) called once by createBoard, before the first render: tone mapping, shadow type, exposure
  occupied?(tile: THREE.Object3D, occupied: boolean): void;   // (27) a shown unit stands on this hex, or no longer does; the kit may change the tile
}

export interface UnitVisual {
  object: THREE.Object3D;
  setStatus(s: UnitStatus): void;
  setDugIn?(dug: boolean): void;                        // (24) a ring of sandbags round the figure, or none; a kit without it shows nothing
}

export interface KitCtx {
  scene: THREE.Scene;
  hexToWorld(hex: Hex): THREE.Vector3;                  // top centre of that hex
  unitObject(id: UnitId): THREE.Object3D | null;
}
