// Everything a unit can do besides walking, as data. An action is built from
// a small fixed vocabulary (see ActionDef and Effect in shared/types); the
// rules know the vocabulary and never an action by name. A new action is a
// new entry here, and a unit that names it in `fire` or `special`.
// `mobile` (may follow a move in the same round) is a tuning lever: light
// weapons have it, weapons that must be set up do not.

import type { ActionDef, ActionId } from '../shared/types';

export const ACTIONS: Record<ActionId, ActionDef> = {
  rifle: {
    id: 'rifle', name: 'Fire', blurb: 'One shot at one hex he can see.',
    icon: 'rifle', phase: 'fire',
    range: 4, minRange: 1, sight: 'own', needs: 'any', affects: 'all', blast: 0,
    effects: [{ kind: 'hit' }],
    reveals: true, mobile: true,
  },
  burst: {
    id: 'burst', name: 'Fire', blurb: 'A burst over a hex he can see and the six around it. Hits everyone there.',
    icon: 'burst', phase: 'fire',
    range: 5, minRange: 1, sight: 'own', needs: 'any', affects: 'all', blast: 1,
    effects: [{ kind: 'hit' }],
    reveals: true, mobile: false,
  },
  snipe: {
    id: 'snipe', name: 'Fire', blurb: 'One long shot at a hex he can see. Cover does not stop it.',
    icon: 'snipe', phase: 'fire',
    range: 8, minRange: 2, sight: 'own', needs: 'any', affects: 'all', blast: 0,
    effects: [{ kind: 'hit', ignoresCover: true }],
    reveals: true, mobile: false,
  },
  shell: {
    id: 'shell', name: 'Mortar', blurb: 'Rounds onto any hex a friendly unit can see. They land after movement, on the hex and the six around it.',
    icon: 'shell', phase: 'mortar',
    range: 10, minRange: 3, sight: 'squad', needs: 'any', affects: 'all', blast: 1,
    effects: [{ kind: 'hit' }],
    reveals: true, mobile: false,
  },
  aid: {
    id: 'aid', name: 'Treat', blurb: 'Gets a pinned friendly unit next to him ready again, before anyone fires.',
    icon: 'aid', phase: 'treat',
    range: 1, minRange: 1, sight: 'none', needs: 'friend', affects: 'friends', blast: 0,
    effects: [{ kind: 'recover' }],
    reveals: false, mobile: true,
  },
};
