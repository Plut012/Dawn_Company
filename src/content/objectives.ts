// The kinds of objective, and what each gives its flag's owner (21). A unit
// benefits from an objective when it stands in its area and its owner holds
// the flag: `sight` is added to its sight range, `move` to its move (from where
// it stands when the round begins; a dash is twice that), `supply` to what the
// flag earns each round in a mode with supply, and `rally` lets a pinned unit
// there recover at the end of the round it was pinned in.

import type { ObjectiveKindDef, ObjectiveKindId } from '../shared/types';

export const OBJECTIVE_KINDS: Record<ObjectiveKindId, ObjectiveKindDef> = {
  hq: { id: 'hq', name: 'HQ', blurb: 'A start zone\'s base: the downed come back here while its seat holds it.', sight: 0, move: 0, supply: 0, rally: false },
  village: { id: 'village', name: 'Village', blurb: 'Houses and stores: it earns more for the side that holds it.', sight: 0, move: 0, supply: 1, rally: false },
  hill: { id: 'hill', name: 'Hill', blurb: 'An observation post: the holder\'s men on it see further.', sight: 2, move: 0, supply: 0, rally: false },
  crossroads: { id: 'crossroads', name: 'Crossroads', blurb: 'Roads out in every direction: the holder\'s men move further from it.', sight: 0, move: 1, supply: 0, rally: false },
  depot: { id: 'depot', name: 'Depot', blurb: 'Stores and an aid post: it earns more, and pinned men there rally.', sight: 0, move: 0, supply: 2, rally: true },
};
