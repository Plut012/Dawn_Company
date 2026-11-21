// (27) Which hexes have a shown unit on them, and telling whoever cares when that changes.
//
// The board keeps one of these and feeds it what it does with its pieces: a piece put on a hex, a piece
// taken off, a piece setting off for the next hex. A hex is occupied while a shown piece stands on it or is
// on its way to it (so a house is open before the man walks in, and shuts once he has walked out). `tell`
// is called only when a hex's answer changes.

import type { HexKey, UnitId } from '../../shared/types';

export interface Occupancy {
  place(id: UnitId, at: HexKey): void;      // this unit's piece is shown on this hex (it may have been elsewhere)
  remove(id: UnitId): void;                 // its piece is taken off the board
  heading(id: UnitId, to: HexKey): void;    // its piece sets off for this hex; it counts on both until it is placed
  has(key: HexKey): boolean;                // as last told
  reset(): void;                            // forget everything, telling nobody: the hexes themselves are new
}

export function createOccupancy(tell: (key: HexKey, occupied: boolean) => void): Occupancy {
  const at = new Map<UnitId, HexKey>();
  const bound = new Map<UnitId, HexKey>();
  const told = new Set<HexKey>();

  function settle(): void {
    const now = new Set<HexKey>([...at.values(), ...bound.values()]);
    for (const key of [...told]) {
      if (!now.has(key)) { told.delete(key); tell(key, false); }
    }
    for (const key of now) {
      if (!told.has(key)) { told.add(key); tell(key, true); }
    }
  }

  return {
    place(id, key) {
      const wasBound = bound.delete(id);
      if (!wasBound && at.get(id) === key && told.has(key)) return;
      at.set(id, key);
      settle();
    },
    remove(id) {
      if (!at.delete(id) && !bound.delete(id)) return;
      bound.delete(id);
      settle();
    },
    heading(id, to) {
      if (!at.has(id) || bound.get(id) === to) return;      // only a piece on the board sets off
      bound.set(id, to);
      settle();
    },
    has: (key) => told.has(key),
    reset() {
      at.clear();
      bound.clear();
      told.clear();
    },
  };
}
