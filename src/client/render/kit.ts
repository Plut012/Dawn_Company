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
// - unit(), objective(): local origin is where it stands. The board puts it
//   at the top centre of its hex.
// - mark(): built in world space with ctx.hexToWorld. The board adds it as is.
// - fog(): the board drapes this material over a copy of every solid mesh
//   (opaque, not back-faced) of each unseen tile, so the veil takes the
//   tile's shape. Lines and see-through parts are left as they are.
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
  objective(obj: Objective): THREE.Object3D;
  fog(): THREE.Material;                                // veil over unseen hexes
  effect?(event: GameEvent, ctx: KitCtx): Promise<void>;   // added by task 07
}

export interface UnitVisual { object: THREE.Object3D; setStatus(s: UnitStatus): void }

export interface KitCtx {
  scene: THREE.Scene;
  hexToWorld(hex: Hex): THREE.Vector3;                  // top centre of that hex
  unitObject(id: UnitId): THREE.Object3D | null;
}
