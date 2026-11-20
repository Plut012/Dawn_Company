// The unit roster. Starting numbers, to be tuned by playing.
// A new unit is a new entry here and nothing else: what it does when told to
// fire or use its special is an action from ./actions.

import type { UnitDef, UnitTypeId } from '../shared/types';

export const UNITS: Record<UnitTypeId, UnitDef> = {
  rifleman: {
    id: 'rifleman', name: 'Rifleman', rank: 'Pvt.',
    blurb: 'Goes where he is told and shoots what he can see. Most of any squad.',
    cost: 2, max: null,
    move: 2, sight: 6, spotting: 0,
    orders: ['move', 'dash', 'fire', 'ambush'],
    fire: 'rifle', special: null,
  },
  gunner: {
    id: 'gunner', name: 'Machine gunner', rank: 'Cpl.',
    blurb: 'Fires at a place, not a person. Everyone in that place gets down. Slow to shift.',
    cost: 4, max: 2,
    move: 1, sight: 6, spotting: 0,
    orders: ['move', 'fire', 'ambush'],
    fire: 'burst', special: null,
  },
  sniper: {
    id: 'sniper', name: 'Sniper', rank: 'Pvt.',
    blurb: 'Sees further than anyone and is not put off by cover. No use up close.',
    cost: 4, max: 1,
    move: 2, sight: 8, spotting: 0,
    orders: ['move', 'dash', 'fire', 'ambush'],
    fire: 'snipe', special: null,
  },
  mortar: {
    id: 'mortar', name: 'Mortar team', rank: 'Cpl.',
    blurb: 'Needs someone to tell it where. Lands late, and on whoever is there by then.',
    cost: 4, max: 1,
    move: 1, sight: 5, spotting: 0,
    orders: ['move', 'fire'],
    fire: 'shell', special: null,
  },
  medic: {
    id: 'medic', name: 'Medic', rank: 'Pvt.',
    blurb: 'Carries no rifle. Gets a pinned man next to him back on his feet.',
    cost: 2, max: 2,
    move: 2, sight: 6, spotting: 0,
    orders: ['move', 'dash', 'special'],
    fire: null, special: 'aid',
  },
  engineer: {
    id: 'engineer', name: 'Engineer', rank: 'Spr.',
    blurb: 'Carries no rifle. Digs, wires and sandbags a hex for supply; whoever holds it after gets the use of it.',
    cost: 3, max: 2,
    move: 2, sight: 6, spotting: 0,
    orders: ['move', 'dash', 'special'],
    fire: null, special: 'build',
  },
};
