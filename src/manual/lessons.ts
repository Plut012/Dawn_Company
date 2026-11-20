// The field manual: one rule a lesson.
//
// A new lesson is a new entry in LESSONS and nothing else. Draw the smallest
// map that shows the rule (the drawing format is the one in
// src/content/mapFormat.ts; see `tinyMap`), set down as few units as will do,
// give them their orders, and say in `expect` what must be true afterwards.
// Numbers quoted in a text are read from src/content, so the text follows
// the rules when they are tuned.
//
// Units are named "owner-index" in the order they are listed: the first unit
// of player 0 is "0-0". Player 0 is blue, player 1 is plum.
//
// Pure data: no three.js, no DOM.

import { ACTIONS, MODES, OBJECTIVE_KINDS, SUN, TERRAIN, UNITS, WORKS } from '../content';
import { ambush, build, dash, fire, move, thenFire, tinyMap, treat } from './lesson';
import type { Lesson } from './lesson';

export * from './lesson';

const rifleman = UNITS.rifleman;
const rifle = ACTIONS[rifleman.fire ?? ''];       // the actions the lessons quote numbers from
const sniper = ACTIONS[UNITS.sniper.fire ?? ''];
const SCORE_VALUE = 2;
// How near an enemy must be to see into woods.
const hide = { still: TERRAIN.woods.hide?.still ?? 0, moved: TERRAIN.woods.hide?.moved ?? 0 };
const hexes = (n: number): string => (n === 1 ? '1 hex' : `${n} hexes`);
// Supply Line's return rule (18), quoted by the Supply lessons.
const RETURNS = MODES['supply-line'].returns ?? { rounds: 3, buyBack: 4 };
const BUY_BACK = rifleman.cost * RETURNS.buyBack;     // what a rifleman costs to bring back
const nothing = (rounds: number): [never[], never[]][] => Array.from({ length: rounds }, () => [[], []]);
// The rising sun (19), quoted by the Dawn lesson: a mortar team watching a man 5 hexes off sees him from this round.
const DAWN_GAP = 5;
const DAWN_SEEN = 1 + SUN.findIndex((s) => UNITS.mortar.sight + s >= DAWN_GAP);
const times = (n: number): string => (n === 2 ? 'twice' : `${n} times`);
// What ground gives (21), quoted by the Ground lessons and the Supply lesson's village.
const { village: VILLAGE, hill: HILL, crossroads: CROSSROADS, depot: DEPOT } = OBJECTIVE_KINDS;
const FIRST_LIGHT = Math.max(1, rifleman.sight + (SUN[0] ?? 0));     // a rifleman's sight in round 1
/** Blue's HQ, W, in the top-left corner; a village A in the middle of the next row. */
const supplyMap = (id: string, village = false) => tinyMap({
  id,
  terrain: [
    '. . . . .',
    ' . . . . .',
    '. . . . .',
  ],
  marks: [
    'W . . . .',
    village ? ' W . A . .' : ' W . . . .',
    '. . . . .',
  ],
  objectives: village ? { W: { kind: 'hq', value: 1 }, A: { kind: 'village', value: 2 } } : { W: { kind: 'hq', value: 1 } },
});

// Last Stand (20): a small board, with a village where the lesson needs a flag.
const lastStandMap = (id: string, village = false) => tinyMap({
  id,
  terrain: [
    '. . . . .',
    ' . . . . .',
    '. . . . .',
  ],
  marks: village ? ['. . . . .', ' . . A . .', '. . . . .'] : undefined,
  objectives: village ? { A: { kind: 'village', value: 2 } } : undefined,
});
/** The round a Last Stand lesson on this map starts in: the last one. */
const FINAL_ROUND = lastStandMap('last-round').maxRounds;

export const LESSONS: Lesson[] = [
  // ------------------------------------------------------------ Seeing
  {
    id: 'sight',
    group: 'Seeing',
    title: 'Line of sight',
    text: 'Woods and hills block the line of sight. From high enough ground a unit sees over them.',
    map: tinyMap({
      id: 'sight',
      terrain: [
        '. . . . .',
        ' . . w . .',
        '. . . . .',
      ],
      elevation: [
        '. . 1 . .',
        ' . 2 . . .',
        '. . 1 . .',
      ],
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A2' },
      { owner: 1, type: 'rifleman', at: 'E2' },
    ],
    rounds: [[[move('0-0', 'B2')], []]],
    notes: { move: 'From the hilltop the line clears the woods. The man behind them is seen.' },
    viewAs: 0,
    fogMatters: true,
    expect: [
      { unit: '0-0', at: 'B2' },
      { seenBy: 0, unit: '1-0', seen: true },
    ],
  },
  {
    id: 'stealth',
    group: 'Seeing',
    title: 'Stealth',
    text: `A unit that keeps still in woods, crops or a building is not seen until an enemy is within ${hexes(hide.still)}. The ground it stands on is seen all the same.`,
    map: tinyMap({
      id: 'stealth',
      terrain: [
        '. . . . w',
        ' . . . . w',
        '. . . w .',
      ],
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'B2' },
      { owner: 1, type: 'rifleman', at: 'E2' },
    ],
    rounds: [[[move('0-0', 'C2', 'D2')], []]],
    notes: { move: `One step short he still sees nothing. At ${hexes(hide.still)} the man in the woods is seen.` },
    viewAs: 0,
    fogMatters: true,
    expect: [
      { unit: '0-0', at: 'D2' },
      { seenBy: 0, unit: '1-0', seen: true },
    ],
  },
  {
    id: 'creep',
    group: 'Seeing',
    title: 'Creeping and running',
    text: `A unit that moves through woods or crops without dashing is seen only from ${hexes(hide.moved)} or closer. One that dashes, or moves into a building, is seen as if it were in the open.`,
    map: tinyMap({
      id: 'creep',
      terrain: [
        'w w w w w w',
        ' . . . . . .',
        '. . . . . .',
        ' . . . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'C4' },
      { owner: 1, type: 'rifleman', at: 'F1' },
      { owner: 1, type: 'rifleman', at: 'A1' },
    ],
    rounds: [[[], [dash('1-0', 'E1', 'D1'), move('1-1', 'B1', 'C1')]]],
    notes: {
      fire: 'The man told to dash breaks cover before he takes a step, and is seen.',
      move: 'Both come through the same wood to three hexes from the watcher. Only the runner is seen.',
    },
    viewAs: 0,
    fogMatters: true,
    expect: [
      { unit: '1-0', at: 'D1' },
      { unit: '1-1', at: 'C1' },
      { seenBy: 0, unit: '1-0', seen: true },
      { seenBy: 0, unit: '1-1', seen: false },
    ],
  },
  {
    id: 'reveal',
    group: 'Seeing',
    title: 'Giving the position away',
    text: 'A unit that fires gives itself away: no woods, crops or building hides it for the rest of that round and while the next orders are given. When those orders are carried out it is hidden again, unless it fires again.',
    map: tinyMap({
      id: 'reveal',
      terrain: [
        '. . . . .',
        ' . . . . b',
        '. . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A2' },
      { owner: 1, type: 'rifleman', at: 'E2' },
    ],
    rounds: [
      [[], [fire('1-0', 'A2')]],
      [[], []],
    ],
    notes: { treat: 'Each round begins by hiding again whoever fired the round before.' },
    viewAs: 0,
    fogMatters: true,
    expect: [
      { event: 'fire', count: 1 },
      { seenBy: 0, unit: '1-0', seen: false },
    ],
  },

  {
    id: 'dawn',
    group: 'Seeing',
    title: 'Dawn',
    text: `The match opens at first light, when every unit sees ${hexes(-SUN[0])} less than in full day, and the sun gives the sight back as the rounds go by. A mortar team sees ${hexes(UNITS.mortar.sight)} in full day, so a man ${hexes(DAWN_GAP)} off is out of its sight until round ${DAWN_SEEN}.`,
    map: tinyMap({
      id: 'dawn',
      terrain: [
        '. . . . . . .',
        ' . . . . . . .',
        '. . . . . . .',
      ],
    }),
    round: 1,
    units: [
      { owner: 0, type: 'mortar', at: 'A2' },
      { owner: 1, type: 'rifleman', at: 'F2' },
    ],
    rounds: nothing(DAWN_SEEN - 1),
    notes: { score: 'The round is over and the sun climbs. From the next round everyone sees a little further.' },
    viewAs: 0,
    fogMatters: true,
    expect: [
      { seenBy: 0, unit: '1-0', seen: false, after: 0 },
      { seenBy: 0, unit: '1-0', seen: false, after: DAWN_SEEN - 2 },
      { seenBy: 0, unit: '1-0', seen: true },
    ],
  },

  // ------------------------------------------------------------ Moving
  {
    id: 'move-dash',
    group: 'Moving',
    title: 'Move and dash',
    text: `A rifleman moves up to ${rifleman.move} hexes; a dash takes him up to ${rifleman.move * 2}. Nobody crosses water.`,
    map: tinyMap({
      id: 'move-dash',
      terrain: [
        '. . . . .',
        ' . . . . .',
        '. . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A1' },
      { owner: 1, type: 'rifleman', at: 'A3' },
    ],
    rounds: [[[move('0-0', 'B1', 'C1')], [dash('1-0', 'B3', 'C3', 'D3', 'E3')]]],
    notes: { move: 'One hex a step, everyone together. The dash keeps going after the move has stopped.' },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '0-0', at: 'C1' },
      { unit: '1-0', at: 'E3' },
    ],
  },
  {
    id: 'collide',
    group: 'Moving',
    title: 'Collisions',
    text: 'Units of different squads block each other. Two stepping into the same hex both stop where they are, and neither can enter a hex the other is holding.',
    map: tinyMap({
      id: 'collide',
      terrain: [
        '. . . . .',
        ' . . . . .',
        '. . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A3' },
      { owner: 0, type: 'rifleman', at: 'A1' },
      { owner: 1, type: 'rifleman', at: 'E3' },
      { owner: 1, type: 'rifleman', at: 'B1' },
    ],
    rounds: [[
      [move('0-0', 'B3', 'C3'), move('0-1', 'B1')],
      [move('1-0', 'D3', 'C3')],
    ]],
    notes: { move: 'Top: the hex is held by the enemy, so he stays. Bottom: both want C3 on the second step, so both stop.' },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '0-0', at: 'B3' },
      { unit: '1-0', at: 'D3' },
      { unit: '0-1', at: 'A1' },
      { event: 'blocked', count: 3 },
    ],
  },

  {
    id: 'pass',
    group: 'Moving',
    title: 'Through your own squad',
    text: 'Units of one squad do not block each other: a unit walks through a teammate, and two may swap hexes. But no two units end in one hex: ordered onto a teammate who stays, a unit stops on the last free hex of its path.',
    map: tinyMap({
      id: 'pass',
      terrain: [
        '. . . . .',
        ' . . . . .',
        '. . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A1' },
      { owner: 0, type: 'rifleman', at: 'B1' },
      { owner: 0, type: 'rifleman', at: 'A3' },
      { owner: 0, type: 'rifleman', at: 'C3' },
      { owner: 1, type: 'rifleman', at: 'E2' },
    ],
    rounds: [[
      [move('0-0', 'B1', 'C1'), move('0-2', 'B3', 'C3')],
      [],
    ]],
    notes: { move: 'Top: he walks through the man at B1 and on to C1. Bottom: C3 is where his path ends and the man there stays, so he stops at B3.' },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '0-0', at: 'C1' },
      { unit: '0-1', at: 'B1' },
      { unit: '0-2', at: 'B3' },
      { unit: '0-3', at: 'C3' },
      { event: 'blocked', count: 1 },
    ],
  },

  // ------------------------------------------------------------ Shooting
  {
    id: 'hit',
    group: 'Shooting',
    title: 'Pinned, then down',
    text: 'A hit pins a unit. A hit on a pinned unit puts it down, and two shooters can do both in one round.',
    map: tinyMap({
      id: 'hit',
      terrain: [
        '. . . . .',
        ' . . . . .',
        '. . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A1' },
      { owner: 0, type: 'rifleman', at: 'A3' },
      { owner: 1, type: 'rifleman', at: 'D2' },
    ],
    rounds: [[
      [fire('0-0', 'D2'), fire('0-1', 'D2')],
      [fire('1-0', 'A1')],
    ]],
    notes: { fire: 'All shots are fired together. One hit pins the man at A1; two put the man at D2 down.' },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '0-0', status: 'pinned' },
      { unit: '0-1', status: 'ready' },
      { unit: '1-0', status: 'down' },
      { event: 'hit', count: 3 },
    ],
  },
  {
    id: 'cover',
    group: 'Shooting',
    title: 'Cover',
    text: 'A unit in a building or behind a low wall ignores the first hit on it each round; the second counts. Woods and crops hide a unit but stop nothing.',
    map: tinyMap({
      id: 'cover',
      terrain: [
        '. . . . .',
        ' . . . = =',
        '. . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A1' },
      { owner: 0, type: 'rifleman', at: 'A3' },
      { owner: 1, type: 'rifleman', at: 'D2' },
    ],
    rounds: [[
      [fire('0-0', 'D2'), fire('0-1', 'D2')],
      [],
    ]],
    notes: { fire: 'The same two shots as in the open. The wall takes the first; the second only pins.' },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '1-0', status: 'pinned' },
      { event: 'hit', count: 2 },
    ],
  },
  {
    id: 'dig-in',
    group: 'Shooting',
    title: 'Dig in',
    text: 'A unit that holds still for a whole round digs in, and until its first step it ignores one more hit each round than its ground gives it: on open ground, the first. There is no order for it.',
    map: tinyMap({
      id: 'dig-in',
      terrain: [
        '. . . . .',
        ' . . . . .',
        '. . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A1' },
      { owner: 0, type: 'rifleman', at: 'B1' },
      { owner: 0, type: 'rifleman', at: 'A3' },
      { owner: 0, type: 'rifleman', at: 'B3' },
      { owner: 1, type: 'rifleman', at: 'D1' },
      { owner: 1, type: 'rifleman', at: 'D3', dugIn: true },
    ],
    rounds: [[
      [fire('0-0', 'D1'), fire('0-1', 'D1'), fire('0-2', 'D3'), fire('0-3', 'D3')],
      [],
    ]],
    notes: {
      fire: 'The same two shots at each man, on open ground. D1 is pinned, then down; D3 is dug in, so the foxhole takes the first and the second only pins him.',
      score: 'Everyone who held still all round is dug in now, and stays so until his first step, the four who fired as well. A man who is hit still counts: he is dug in if he held still.',
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '1-0', status: 'down' },
      { unit: '1-1', status: 'pinned' },
      { unit: '1-1', dugIn: true },
      { unit: '1-0', dugIn: false },
      { unit: '0-0', dugIn: true },
      { event: 'hit', count: 4 },
      { event: 'dig', count: 4 },
    ],
  },
  {
    id: 'dash-risk',
    group: 'Shooting',
    title: 'The risk of a dash',
    text: 'A unit ordered to dash has no cover this round and goes down to a single hit. Fire comes before movement, so it is hit where it stands.',
    map: tinyMap({
      id: 'dash-risk',
      terrain: [
        '. . . . .',
        ' . . . b b',
        '. . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A2' },
      { owner: 1, type: 'rifleman', at: 'D2' },
    ],
    rounds: [[
      [fire('0-0', 'D2')],
      [dash('1-0', 'D3', 'C3', 'B3', 'A3')],
    ]],
    notes: { fire: 'One shot. He is in a building, but he has orders to dash: no cover, and down.' },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '1-0', status: 'down' },
      { unit: '1-0', at: 'D2' },
      { event: 'hit', count: 1 },
    ],
  },

  {
    id: 'move-fire',
    group: 'Shooting',
    title: 'Move, then fire',
    text: 'A rifleman may move and then fire from where he ends up: the shot comes in the assault phase, after all movement. It is fired only if he is ready, in range and has a line from the hex he actually reached; a dash leaves no time for it.',
    map: tinyMap({
      id: 'move-fire',
      terrain: [
        'w w . . . . .',
        ' w w . . . . .',
        'w w . . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A2' },
      { owner: 1, type: 'rifleman', at: 'G2' },
    ],
    rounds: [[
      [thenFire(move('0-0', 'B2', 'C2'), 'G2')],
      [],
    ]],
    notes: {
      move: `From A2 the man at G2 is 6 hexes off, and a rifle reaches ${rifle.range}. Two steps out of the woods bring him to ${rifle.range}.`,
      assault: 'He fires from where he stopped. The man at G2 is pinned.',
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '0-0', at: 'C2' },
      { unit: '1-0', status: 'pinned' },
      { event: 'fire', count: 1 },
      { event: 'hit', count: 1 },
    ],
  },

  // ------------------------------------------------------------ Units
  {
    id: 'gunner',
    group: 'Units',
    title: 'Machine gunner',
    text: 'The machine gun hits the target hex and the six hexes around it. It hits everyone there, friends included.',
    map: tinyMap({
      id: 'gunner',
      terrain: [
        '. . . . .',
        ' . . . . .',
        '. . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'gunner', at: 'A2' },
      { owner: 0, type: 'rifleman', at: 'C3' },
      { owner: 1, type: 'rifleman', at: 'C2' },
      { owner: 1, type: 'rifleman', at: 'D1' },
      { owner: 1, type: 'rifleman', at: 'E3' },
    ],
    rounds: [[[fire('0-0', 'C2')], []]],
    notes: { fire: 'Three pinned, one of them the gunner\'s own man. The man at E3 is outside the area.' },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '1-0', status: 'pinned' },
      { unit: '1-1', status: 'pinned' },
      { unit: '0-1', status: 'pinned' },
      { unit: '1-2', status: 'ready' },
      { event: 'hit', count: 3 },
    ],
  },
  {
    id: 'sniper',
    group: 'Units',
    title: 'Sniper',
    text: `The sniper fires out to ${sniper.range} hexes, where a rifle stops at ${rifle.range}. His hit ignores cover.`,
    map: tinyMap({
      id: 'sniper',
      terrain: [
        '. . . . . b',
        ' . . . . . b',
        '. . . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'sniper', at: 'A2' },
      { owner: 1, type: 'rifleman', at: 'F2' },
    ],
    rounds: [[[fire('0-0', 'F2')], []]],
    notes: { fire: 'Five hexes: too far for the rifle to answer. The building does not help; one hit pins.' },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '1-0', status: 'pinned' },
      { event: 'hit', count: 1 },
    ],
  },
  {
    id: 'mortar',
    group: 'Units',
    title: 'Mortar team',
    text: 'The mortar fires at any hex in range that a friend can see. The shell lands after movement, on whoever is there by then.',
    map: tinyMap({
      id: 'mortar',
      terrain: [
        '. w . . . .',
        ' . w . . . .',
        '. w . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'mortar', at: 'A2' },
      { owner: 0, type: 'rifleman', at: 'C1' },
      { owner: 1, type: 'rifleman', at: 'D2' },
      { owner: 1, type: 'rifleman', at: 'D3' },
    ],
    rounds: [[
      [fire('0-0', 'D2')],
      [move('1-0', 'E2', 'F2')],
    ]],
    notes: {
      fire: 'The mortar is behind the woods and sees nothing. The rifleman at C1 sees D2 for it.',
      move: 'The man at D2 walks off before the shell arrives.',
      mortar: 'It lands on D2 and the six hexes around. The man who stayed at D3 is pinned.',
    },
    viewAs: 'umpire',
    fogMatters: true,
    expect: [
      { unit: '1-0', at: 'F2' },
      { unit: '1-0', status: 'ready' },
      { unit: '1-1', status: 'pinned' },
      { event: 'launch', count: 1 },
      { event: 'impact', count: 1 },
      { event: 'hit', count: 1 },
    ],
  },
  {
    id: 'medic',
    group: 'Units',
    title: 'Medic',
    text: 'The medic gets a pinned man next to him back up. Treatment comes first in the round, so the man carries out his order.',
    map: tinyMap({
      id: 'medic',
      terrain: [
        '. . . . .',
        ' . . . . .',
        '. . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'medic', at: 'A2' },
      { owner: 0, type: 'rifleman', at: 'B2', status: 'pinned' },
      { owner: 1, type: 'rifleman', at: 'E2' },
    ],
    rounds: [[
      [treat('0-0', 'B2'), fire('0-1', 'E2')],
      [],
    ]],
    notes: {
      treat: 'The pinned rifleman is back on his feet.',
      fire: 'So his fire order is carried out.',
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { event: 'treat', count: 1 },
      { event: 'fire', count: 1 },
      { unit: '0-1', status: 'ready' },
      { unit: '1-0', status: 'pinned' },
    ],
  },
  {
    id: 'works',
    group: 'Units',
    title: 'Works',
    text: `An engineer builds on his own hex or the next one, at the round's end, paid from supply: sandbags (${WORKS.sandbags.cost}), cover like a low wall; wire (${WORKS.wire.cost}), which nobody crosses; an MG nest (${WORKS.nest.cost}), cover that hides a man who keeps still. A work is ground: it serves whoever stands there, for the rest of the match.`,
    map: tinyMap({
      id: 'works',
      terrain: [
        '. . . . .',
        ' . . . . .',
        '. . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'engineer', at: 'B2' },
      { owner: 0, type: 'rifleman', at: 'B1' },
      { owner: 1, type: 'rifleman', at: 'E1' },
    ],
    supply: [WORKS.sandbags.cost, 0],
    rounds: [
      [[move('0-1', 'C1'), build('0-0', 'C1', 'sandbags')], []],
      [[], [fire('1-0', 'C1')]],
    ],
    notes: {
      move: 'The rifleman steps up to C1, out in the open.',
      score: `The engineer puts sandbags up round him: ${WORKS.sandbags.cost} supply. They stay for the rest of the match.`,
      fire: 'The shot at C1 hits the sandbags. He walked there, so he is not dug in: it is the work that saves him.',
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { event: 'build', count: 1 },
      { score: [0, 0] },
      { event: 'hit', count: 1 },
      { unit: '0-1', status: 'ready' },
      { unit: '0-1', at: 'C1' },
    ],
  },

  // ------------------------------------------------------------ Timing
  {
    id: 'ambush',
    group: 'Timing',
    title: 'Ambush',
    text: 'A unit on ambush holds its fire until an enemy moves where it can see and reach. It fires once, at the nearest such enemy, and the man hit stops there.',
    map: tinyMap({
      id: 'ambush',
      terrain: [
        '. . . . . .',
        ' . . . . . .',
        '. . . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A2' },
      { owner: 1, type: 'rifleman', at: 'F2' },
    ],
    rounds: [[
      [ambush('0-0')],
      [move('1-0', 'E2', 'D2')],
    ]],
    notes: { move: `His first step brings him within ${rifle.range} hexes, rifle range. He is pinned at E2 and goes no further.` },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { event: 'fire', count: 1 },
      { unit: '1-0', status: 'pinned' },
      { unit: '1-0', at: 'E2' },
    ],
  },
  {
    id: 'pinned',
    group: 'Timing',
    title: 'Sitting it out',
    text: 'A pinned unit does nothing for the rest of the round and all of the next. It recovers when that next round ends.',
    map: tinyMap({
      id: 'pinned',
      terrain: [
        '. . . . .',
        ' . . . . .',
        '. . . . .',
      ],
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A2' },
      { owner: 1, type: 'rifleman', at: 'D2' },
    ],
    rounds: [
      [[fire('0-0', 'D2')], [move('1-0', 'D3', 'C3')]],
      [[], [move('1-0', 'D3', 'C3')]],
    ],
    notes: {
      move: 'He has orders to move. He is pinned, so he stays.',
      score: 'A man pinned in an earlier round recovers here. One pinned this round does not.',
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '1-0', at: 'D2' },
      { unit: '1-0', status: 'ready' },
      { event: 'recover', count: 1 },
    ],
  },
  {
    id: 'phases',
    group: 'Timing',
    title: 'The six phases',
    text: 'Every round runs in the same order: treat, fire, movement, assault, mortars, score. Each phase starts from what the one before left.',
    map: tinyMap({
      id: 'phases',
      terrain: [
        '. . . . . .',
        ' . . . . . .',
        '. . . . . .',
      ],
      marks: [
        '. . . . . .',
        ' . . . . . .',
        '. . . A . .',
      ],
      objectives: { A: { kind: 'crossroads', value: 1 } },
    }),
    units: [
      { owner: 0, type: 'medic', at: 'A2' },
      { owner: 0, type: 'rifleman', at: 'B2', status: 'pinned' },
      { owner: 0, type: 'rifleman', at: 'B3' },
      { owner: 0, type: 'mortar', at: 'A1' },
      { owner: 1, type: 'rifleman', at: 'E2' },
      { owner: 1, type: 'rifleman', at: 'F3' },
    ],
    rounds: [[
      [treat('0-0', 'B2'), fire('0-1', 'E2'), thenFire(move('0-2', 'C3', 'D3'), 'F3'), fire('0-3', 'E2')],
      [],
    ]],
    notes: {
      treat: 'The medic gets the pinned rifleman up.',
      fire: 'Now he can fire: the man at E2 is pinned. The mortar launches.',
      move: 'A rifleman walks into objective A.',
      assault: 'From there he fires, as he was told to: the man at F3 is pinned.',
      mortar: 'The shell lands on E2 and the hexes around it. Both men there are already pinned, so both go down.',
      score: 'He is the only one in A when the round ends: Blue takes its flag, and it scores.',
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { event: 'treat', count: 1 },
      { event: 'fire', count: 2 },
      { event: 'move', count: 2 },
      { event: 'impact', count: 1 },
      { event: 'capture', count: 1 },
      { event: 'score', count: 1 },
      { unit: '1-0', status: 'down' },
      { unit: '1-1', status: 'down' },
      { score: [1, 0] },
    ],
  },

  // ------------------------------------------------------------ Winning
  {
    id: 'score',
    group: 'Winning',
    title: 'Holding an objective',
    text: `An objective is an area: the only side in it when a round ends takes its flag. The flag earns its value every round, even after they leave; A is worth ${SCORE_VALUE}.`,
    map: tinyMap({
      id: 'score',
      terrain: [
        '. . . . .',
        ' . . . . .',
        '. . . . .',
      ],
      marks: [
        '. . . . B',
        ' . . A A .',
        '. . . . .',
      ],
      objectives: { A: { kind: 'crossroads', value: SCORE_VALUE }, B: { kind: 'crossroads', value: 1 } },
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A2' },
      { owner: 1, type: 'rifleman', at: 'E2' },
    ],
    rounds: [
      [[move('0-0', 'B2', 'C2')], [move('1-0', 'E1')]],
      [[move('0-0', 'B2', 'A2')], []],
    ],
    notes: {
      move: 'Blue walks into A and, a round later, out again. Plum steps onto B and stays.',
      score: 'Each flag earns for its owner: A for Blue, held or not, B for Plum.',
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '0-0', at: 'A2' },
      { flag: 'A', owner: 0 },
      { flag: 'B', owner: 1 },
      { score: [2 * SCORE_VALUE, 2] },
      { event: 'capture', count: 2 },
      { event: 'score', count: 4 },
    ],
  },
  {
    id: 'flags',
    group: 'Winning',
    title: 'Flags',
    text: 'A flag changes hands only when one side alone has a ready unit in the area at the end of a round. Leave, and it stays yours; share the area, and it stays as it was.',
    map: tinyMap({
      id: 'flags',
      terrain: [
        '. . . . . .',
        ' . . . . . .',
        '. . . . . .',
      ],
      marks: [
        '. . . . . .',
        ' . . A A . .',
        '. . . . . .',
      ],
      objectives: { A: { kind: 'crossroads', value: 1 } },
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A2' },
      { owner: 1, type: 'rifleman', at: 'F2' },
    ],
    rounds: [
      [[move('0-0', 'B2', 'C2')], []],
      [[move('0-0', 'B2')], []],
      [[move('0-0', 'C2')], [move('1-0', 'E2', 'D2')]],
    ],
    notes: {
      move: 'Blue goes in, steps out, and goes back in; in the last round Plum comes in too.',
      score: 'Blue took A in the first round and has held its flag since. With both sides inside, nobody takes it.',
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '0-0', at: 'C2' },
      { unit: '1-0', at: 'D2' },
      { flag: 'A', owner: 0 },
      { event: 'capture', count: 1 },
      { score: [3, 0] },
    ],
  },

  // ------------------------------------------------------------ Supply (18)
  {
    id: 'supply',
    group: 'Supply',
    title: 'Supply',
    text: `Every flag you hold earns its value in supply each round, your HQ's too, and a village ${VILLAGE.supply} more. Supply is the score, and the one thing you can spend.`,
    map: supplyMap('supply', true),
    units: [
      { owner: 0, type: 'rifleman', at: 'B2' },
      { owner: 1, type: 'rifleman', at: 'E3' },
    ],
    flags: { W: 0 },
    rounds: [
      [[move('0-0', 'C2')], []],
      [[], []],
    ],
    notes: {
      move: 'Blue steps into the village A. His HQ, W, has been his from the start.',
      score: `W earns 1 and the village A earns 2 + ${VILLAGE.supply}, every round, for as long as the flags are Blue's.`,
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { flag: 'A', owner: 0 },
      { flag: 'W', owner: 0 },
      { event: 'score', count: 4 },
      { score: [2 * (1 + 2 + VILLAGE.supply), 0] },
    ],
  },
  {
    id: 'coming-back',
    group: 'Supply',
    title: 'Coming back',
    text: `A man who goes down is not gone: ${RETURNS.rounds} rounds later he is back on his feet at his HQ. That holds while his side keeps the HQ's flag.`,
    map: supplyMap('coming-back'),
    units: [
      { owner: 0, type: 'rifleman', at: 'C2', status: 'pinned' },
      { owner: 1, type: 'rifleman', at: 'E2' },
    ],
    flags: { W: 0 },
    rounds: [
      [[], [fire('1-0', 'C2')]],
      ...nothing(RETURNS.rounds),
    ],
    notes: {
      fire: 'A pinned man hit again goes down.',
      score: `${RETURNS.rounds} rounds after he went down, he is back at W.`,
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { event: 'hit', count: 1 },
      { event: 'return', count: 1 },
      { unit: '0-0', status: 'ready' },
      { unit: '0-0', at: 'A1' },
    ],
  },
  {
    id: 'buy-back',
    group: 'Supply',
    title: 'Buying back',
    text: `A man who is down can be bought back for ${times(RETURNS.buyBack)} his cost in supply: a rifleman for ${BUY_BACK}. He is back at the HQ at the end of the round you pay in.`,
    map: supplyMap('buy-back'),
    units: [
      { owner: 0, type: 'rifleman', at: 'C2', status: 'pinned' },
      { owner: 1, type: 'rifleman', at: 'E2' },
    ],
    flags: { W: 0 },
    supply: [BUY_BACK, 0],
    rounds: [
      [[], [fire('1-0', 'C2')]],
      [[], []],
    ],
    purchases: [
      [[], []],
      [[{ kind: 'return', unit: '0-0' }], []],
    ],
    notes: {
      fire: 'Blue\'s man goes down.',
      score: `Blue pays ${BUY_BACK} supply, and his man is back at W at once instead of ${RETURNS.rounds} rounds on.`,
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { event: 'purchase', count: 1 },
      { event: 'return', count: 1 },
      { unit: '0-0', status: 'ready' },
      { unit: '0-0', at: 'A1' },
      { score: [2, 0] },
    ],
  },
  {
    id: 'cut-off',
    group: 'Supply',
    title: 'Cut off',
    text: 'Lose your HQ\'s flag and your line is cut: nobody comes back, however long he has waited. Retake it, and the man who waited is back at once.',
    map: tinyMap({
      id: 'cut-off',
      terrain: [
        '. . . . .',
        ' . . . . .',
        '. . . . .',
        ' . . . . .',
      ],
      marks: [
        'W W . . .',
        ' . . . . .',
        '. . . . .',
        ' . . . . .',
      ],
      objectives: { W: { kind: 'hq', value: 1 } },
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'D3', status: 'pinned' },
      { owner: 0, type: 'rifleman', at: 'A3' },
      { owner: 1, type: 'rifleman', at: 'C1' },
      { owner: 1, type: 'rifleman', at: 'E2' },
    ],
    flags: { W: 0 },
    rounds: [
      [[], [move('1-0', 'B1'), fire('1-1', 'D3')]],
      ...nothing(RETURNS.rounds - 1),
      [[], []],
      [[move('0-1', 'A2', 'A1')], [move('1-0', 'C1')]],
    ],
    notes: {
      move: 'Plum walks into Blue\'s HQ; at the end of the last round Plum is gone and Blue is in.',
      score: 'With W in Plum\'s hands Blue\'s man waits, even when his time is up. The round Blue takes W back, he is back.',
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { flag: 'W', owner: 0 },
      { event: 'capture', count: 2 },
      { event: 'return', count: 1 },
      { unit: '0-0', status: 'ready' },
      { unit: '0-0', at: 'B1' },
    ],
  },

  // ------------------------------------------------------------ Ground (21)
  {
    id: 'hill',
    group: 'Ground',
    title: 'The hill',
    text: `A hill's flag gives its holder's men on it ${HILL.sight} more hexes of sight. At first light a rifleman sees ${hexes(FIRST_LIGHT)}; on his own hill, ${FIRST_LIGHT + HILL.sight}.`,
    map: tinyMap({
      id: 'hill',
      terrain: [
        '. . . . . . .',
        ' . . . . . . .',
        '. . . . . . .',
      ],
      elevation: [
        '. . . . . . .',
        ' . . 1 . . . .',
        '. . . . . . .',
      ],
      marks: [
        '. . . . . . .',
        ' . . H . . . .',
        '. . . . . . .',
      ],
      objectives: { H: { kind: 'hill', value: 1 } },
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'B2' },
      { owner: 1, type: 'rifleman', at: 'G2' },
    ],
    round: 1,
    rounds: [[[move('0-0', 'C2')], []]],
    notes: {
      move: `He climbs the hill. At first light he sees ${hexes(FIRST_LIGHT)}, and the man at G2 is further off than that.`,
      score: `The hill's flag is Blue's now, and from it he sees ${FIRST_LIGHT + HILL.sight}: the man at G2 is seen.`,
    },
    viewAs: 0,
    fogMatters: true,
    expect: [
      { unit: '0-0', at: 'C2' },
      { flag: 'H', owner: 0 },
      { seenBy: 0, unit: '1-0', seen: false, after: 0 },
      { seenBy: 0, unit: '1-0', seen: true },
    ],
  },
  {
    id: 'crossroads',
    group: 'Ground',
    title: 'The crossroads',
    text: `A man who begins the round on his own side's crossroads moves ${CROSSROADS.move} further, and dashes ${2 * CROSSROADS.move} further. A rifleman there moves ${rifleman.move + CROSSROADS.move} instead of ${rifleman.move}.`,
    map: tinyMap({
      id: 'crossroads',
      terrain: [
        '. . . . .',
        ' . . . . .',
        '. . . . .',
      ],
      marks: [
        'X . . . .',
        ' . . . . .',
        '. . . . .',
      ],
      objectives: { X: { kind: 'crossroads', value: 1 } },
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A1' },
      { owner: 0, type: 'rifleman', at: 'A3' },
      { owner: 1, type: 'rifleman', at: 'E2' },
    ],
    flags: { X: 0 },
    rounds: [[[move('0-0', 'B1', 'C1', 'D1'), move('0-1', 'B3', 'C3')], []]],
    notes: {
      move: `Both go as far as they may. The man who started on Blue's crossroads X goes ${rifleman.move + CROSSROADS.move}; the man beside it, ${rifleman.move}.`,
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '0-0', at: 'D1' },
      { unit: '0-1', at: 'C3' },
      { flag: 'X', owner: 0 },
    ],
  },
  {
    id: 'depot',
    group: 'Ground',
    title: 'The depot',
    text: `A depot earns ${DEPOT.supply} more than its value, and a pinned man on his own side's depot is back on his feet when the round ends, even if he was pinned in it.`,
    map: tinyMap({
      id: 'depot',
      terrain: [
        '. . . . .',
        ' . . . . .',
        '. . . . .',
      ],
      marks: [
        '. . . . .',
        ' D . . . .',
        '. . . . .',
      ],
      objectives: { D: { kind: 'depot', value: 1 } },
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A2' },
      { owner: 0, type: 'rifleman', at: 'A3' },
      { owner: 1, type: 'rifleman', at: 'D2' },
      { owner: 1, type: 'rifleman', at: 'D3' },
    ],
    flags: { D: 0 },
    rounds: [[[], [fire('1-0', 'A2'), fire('1-1', 'A3')]]],
    notes: {
      fire: 'Both Blue men are hit in the open and pinned.',
      score: `The depot D earns Blue 1 + ${DEPOT.supply}. The man on it rallies at once; the man beside it stays down in the dirt a round.`,
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { event: 'hit', count: 2 },
      { event: 'recover', count: 1 },
      { unit: '0-0', status: 'ready' },
      { unit: '0-1', status: 'pinned' },
      { score: [1 + DEPOT.supply, 0] },
    ],
  },

  // ------------------------------------------------------------ Last Stand (20)
  {
    id: 'last-stand',
    group: 'Last Stand',
    title: 'Last Stand',
    text: 'In Last Stand nobody comes back, and flags earn nothing: the score is the men still standing. When one squad has men left and the rest have none, it has won.',
    mode: 'last-stand',
    map: lastStandMap('last-stand', true),
    units: [
      { owner: 0, type: 'rifleman', at: 'C2' },
      { owner: 0, type: 'rifleman', at: 'A2' },
      { owner: 1, type: 'rifleman', at: 'E2', status: 'pinned' },
      { owner: 1, type: 'rifleman', at: 'E1' },
    ],
    rounds: [
      [[fire('0-0', 'E2')], []],
      ...nothing(RETURNS.rounds),
    ],
    notes: {
      fire: 'A pinned man hit again goes down, and in Last Stand that is for good.',
      score: 'Blue holds the village A, and it earns nothing. The score is the men standing: Blue 2, Plum 1.',
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '1-0', status: 'down' },
      { event: 'return', count: 0 },
      { event: 'capture', count: 1 },
      { event: 'score', count: 0 },
      { flag: 'A', owner: 0 },
      { score: [2, 1] },
    ],
  },
  {
    id: 'last-stand-tie',
    group: 'Last Stand',
    title: 'Level on men',
    text: `When the last round ends the most men win. Level on men, the squad whose men cost more wins: a gunner (${UNITS.gunner.cost}) outweighs a rifleman (${UNITS.rifleman.cost}).`,
    mode: 'last-stand',
    map: lastStandMap('last-stand-tie'),
    round: FINAL_ROUND,
    units: [
      { owner: 0, type: 'rifleman', at: 'C2' },
      { owner: 0, type: 'rifleman', at: 'A2' },
      { owner: 1, type: 'rifleman', at: 'E2', status: 'pinned' },
      { owner: 1, type: 'gunner', at: 'E1' },
      { owner: 1, type: 'rifleman', at: 'E3' },
    ],
    rounds: [[[fire('0-0', 'E2')], []]],
    notes: {
      fire: 'In the last round Blue puts a man down. Now it is two men each.',
      score: `Level on men, Plum's are worth ${UNITS.gunner.cost + UNITS.rifleman.cost} to Blue's ${2 * UNITS.rifleman.cost}. Plum wins.`,
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '1-0', status: 'down' },
      { event: 'over', count: 1 },
      { score: [2, 2] },
      { winners: [1] },
    ],
  },
];

export const lessonById = (id: string | null | undefined): Lesson | undefined => LESSONS.find((l) => l.id === id);
