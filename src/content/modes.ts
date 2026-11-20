// The modes: how a match is played, as data. A mode says which units are
// allowed, whether flags earn supply, whether the downed come back and how the
// winner is found. Which of these the rules read is settled task by task:
// the squad builder reads `units` (17); the rules read `returns` (18), and `supply`
// and `win` (20). Nothing reads a mode's id.
//
// `buyBack` was set from seeded play (`npx tsx scripts/seeded.ts --figures 900`). Task 18 (2026-11-19) made it 4,
// when a seat earned about 4.2 supply a round with two players. The objective kinds (21) and the maps of task 22
// raised income: on the maps of 22 a seat earns about 5.9 supply a round with two players (ford), 4.9 with three and
// 4.5 with four (crossroads), so task 22 (2026-11-19) made it 6: bringing a rifleman (2) back costs 12 supply, about
// two rounds' income for two players and two and a half to two and three quarters for three and four: a choice, not a
// reflex. A gunner, sniper or mortar (4) costs 24, four to five and a half rounds.
// Task 23 gave three players `tripoint`, where a seat earns about 6.5 a round: a rifleman's 12 is 1.85 rounds there.
// Left at 6 on purpose, for play to judge.

import type { ModeDef, ModeId } from '../shared/types';

export const MODES: Record<ModeId, ModeDef> = {
  'supply-line': {
    id: 'supply-line', name: 'Supply Line',
    blurb: "Hold ground, earn supply, bring your men back. Lose your HQ and you're on your own.",
    units: null, supply: true, returns: { rounds: 3, buyBack: 6 }, win: 'supply',
  },
  'last-stand': {
    id: 'last-stand', name: 'Last Stand',
    blurb: 'No one comes back. Ground gives you an edge; only survivors win.',
    units: ['rifleman', 'gunner', 'sniper', 'medic'], supply: false, returns: null, win: 'survival',
  },
};

export const DEFAULT_MODE: ModeId = 'supply-line';
