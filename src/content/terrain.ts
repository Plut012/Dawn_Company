// The terrains. No ground does everything: woods and crops hide, buildings
// and walls protect, water is in the way. `cover` (the first hit is ignored)
// and `hide` (how near an enemy must be to see a unit there) are separate
// properties. A new terrain is a new row here, a character in mapFormat.ts
// and a tile in the visual kit.

import type { TerrainDef, TerrainId } from '../shared/types';

export const TERRAIN: Record<TerrainId, TerrainDef> = {
  open: { id: 'open', name: 'Open ground', cover: false, hide: null, blocksSight: false, passable: true },
  // Hides a unit, moving or still, and blocks the line. Stops no bullet.
  woods: { id: 'woods', name: 'Woods', cover: false, hide: { still: 1, moved: 2 }, blocksSight: true, passable: true },
  // The strongpoint: cover, and hides a unit that keeps still. Whoever walks in is seen.
  building: { id: 'building', name: 'Building', cover: true, hide: { still: 1, moved: null }, blocksSight: true, passable: true },
  // Woods one can see over.
  crops: { id: 'crops', name: 'Crops', cover: false, hide: { still: 1, moved: 2 }, blocksSight: false, passable: true },
  // Cover in plain view.
  wall: { id: 'wall', name: 'Low wall', cover: true, hide: null, blocksSight: false, passable: true },
  // Seen across and shot across, never crossed.
  water: { id: 'water', name: 'Water', cover: false, hide: null, blocksSight: false, passable: false },
};
