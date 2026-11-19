// The field manual: nineteen lessons, one rule each.
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

import { ACTIONS, TERRAIN, UNITS } from '../content';
import { ambush, dash, fire, move, thenFire, tinyMap, treat } from './lesson';
import type { Lesson } from './lesson';

export * from './lesson';

const rifleman = UNITS.rifleman;
const rifle = ACTIONS[rifleman.fire ?? ''];       // the actions the lessons quote numbers from
const sniper = ACTIONS[UNITS.sniper.fire ?? ''];
const SCORE_VALUE = 2;
// How near an enemy must be to see into woods.
const hide = { still: TERRAIN.woods.hide?.still ?? 0, moved: TERRAIN.woods.hide?.moved ?? 0 };
const hexes = (n: number): string => (n === 1 ? '1 hex' : `${n} hexes`);

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
      objectiveValues: { A: 1 },
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
      move: 'A rifleman walks onto objective A.',
      assault: 'From there he fires, as he was told to: the man at F3 is pinned.',
      mortar: 'The shell lands on E2 and the hexes around it. Both men there are already pinned, so both go down.',
      score: 'Objective A is held when the round ends, and scores.',
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { event: 'treat', count: 1 },
      { event: 'fire', count: 2 },
      { event: 'move', count: 2 },
      { event: 'impact', count: 1 },
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
    text: `A unit standing on an objective when the round ends scores its value. This one is worth ${SCORE_VALUE}, every round it is held.`,
    map: tinyMap({
      id: 'score',
      terrain: [
        '. . . . .',
        ' . . . . .',
        '. . . . .',
      ],
      marks: [
        '. . . . B',
        ' . . A . .',
        '. . . . .',
      ],
      objectiveValues: { A: SCORE_VALUE, B: 1 },
    }),
    units: [
      { owner: 0, type: 'rifleman', at: 'A2' },
      { owner: 1, type: 'rifleman', at: 'E1' },
    ],
    rounds: [[
      [move('0-0', 'B2', 'C2')],
      [move('1-0', 'E2')],
    ]],
    notes: {
      move: 'Blue walks onto A. Plum walks off B.',
      score: 'Only where a unit stands at the end counts: A scores, B does not.',
    },
    viewAs: 'umpire',
    fogMatters: false,
    expect: [
      { unit: '0-0', at: 'C2' },
      { score: [SCORE_VALUE, 0] },
      { event: 'score', count: 1 },
    ],
  },
];

export const lessonById = (id: string | null | undefined): Lesson | undefined => LESSONS.find((l) => l.id === id);
