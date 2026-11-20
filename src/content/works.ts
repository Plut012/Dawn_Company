// Works (25): what an engineer's `build` puts up. A work is terrain: once
// built it replaces the hex's terrain in the match's copy of the map, for
// everyone, for the rest of the match. `cost` is supply, paid when it goes up.
//
// Costs (2026-11-19): the first guesses were 2, 2 and 4, made when a rifleman's
// buy-back cost 4 (`buyBack` 2): sandbags half a man, a nest a whole one. Since
// task 22 `buyBack` is 6, so a rifleman comes back for 12 and a seat earns about
// 5 to 7 supply a round; at 2 a work would cost a third of a round and never be
// a choice. Scaled with the buy-back (× 3) to keep the first guess's relation:
// sandbags or wire for half a rifleman's buy-back (about a round's income), a
// nest for a whole one (about two).

import type { WorkDef, WorkId } from '../shared/types';

export const WORKS: Record<WorkId, WorkDef> = {
  sandbags: { id: 'sandbags', name: 'Sandbags', blurb: 'Cover in plain view, like a low wall.', cost: 6, terrain: 'sandbags' },
  wire: { id: 'wire', name: 'Wire', blurb: 'Nobody crosses it. It hides nothing and stops no shot.', cost: 6, terrain: 'wire' },
  nest: { id: 'nest', name: 'MG nest', blurb: 'Cover, and hides a man who keeps still, like a building; it does not block sight.', cost: 12, terrain: 'nest' },
};
