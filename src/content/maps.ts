// The maps. A new map is a new drawing here and an entry in MAPS.
// The drawing format is explained in mapFormat.ts.
//
// Every map must look the same after a turn about its centre hex that takes
// each start zone to the next, so every seat is equal; the tests check this.
// For two and four seats that is a half turn; for three (`tripoint`) a third
// of a turn, (q, r) -> (-q - r, q) about the centre (`rotate` in hex.ts). To
// turn a hex by a half turn by hand:
// count rows from the other end, and columns from the other end too. The
// centre hex of a drawing with an odd number of rows sits on an odd row when
// there are 11 rows, and then on even rows (the 1st, 3rd, ...) the turned hex
// sits one column further right than that, so the first hex of each even row
// has no partner. With 13 rows the centre is on an even row (the 7th), and it
// is the last hex of each odd row (the 2nd, 4th, ... 12th) that has none.
// Such a hex must be left as open, level ground with no mark.

import type { GameMap } from '../shared/types';
import { readMap } from './mapFormat';

// Every map is read like a MOBA map: bases (an HQ and its start zone), lanes
// between them, cover between the lanes, water with crossings, a contested
// centre. One map per player count (`mapFor`): `ford` for two, `tripoint`
// for three, `crossroads` for four.
//
// The playstyles (docs/vision.md) and the ground that favours them:
//   assault        open lanes and fords: quick, seen, short;
//   infiltration   woods and crops between the lanes: slow, hidden;
//   fortress       a village: buildings (cover, a still man hidden) and a flag that pays;
//   fire support   the hill: the long views, more of them with its flag;
//   control        a crossroads: men who start the round there move one further.

// Ford, 13 by 15, for two. HQ W in the north-west corner (zone 0), HQ X in the
// south-east (zone 1). A river runs the other way, from the north-east edge to
// the south-west edge, through the hill at the centre. Three lanes join the
// bases, and each crosses the river once, at a ford, and nowhere else:
//   - the north lane runs east along the top edge from W, fords the river at
//     the north ford (a single open hex, a low wall on each bank) and turns
//     south down the east edge to X. The south lane is its twin: south down the
//     west edge from W, over the south ford, east along the bottom to X.
//   - the middle lane runs straight from each base's gate to the hill, which
//     is the river's third crossing.
// Each edge lane has a village on each side of its ford: on the north lane W's
// village C (6 steps from W) and X's village D (9 from X, guarding X's side of
// the ford); on the south lane their twins, X's G and W's F. So each side has
// a near village on one edge lane (a fortress to hold early) and a far one on
// the other, by the ford it has to cross to raid (an assault). Woods and crops
// fill the ground between the lanes (infiltration); a farm in it on each side
// (depots A and B) pays well and rallies, off the lanes, for whoever creeps
// there. The hill (E) is the only high ground: open all round, the river on
// two sides, so its holder sees across both fords' approaches and down the
// middle lane (fire support, and the hardest flag to keep). The gate (J for W,
// K for X, a crossroads) is where the three lanes part, three steps in front
// of each HQ: the defender's men there move one further (control), and an
// enemy standing in it is at the door.
//
// Steps from each HQ (walking): own gate 3, own depot 5, near village 6, hill
// 8, far village 9, the enemy's far village 12, the enemy's depot 12, the
// enemy's near village 14, the enemy's gate 14, the enemy HQ 18; the same from
// the other HQ to the twins (the tests check this). The drawing is the same
// under a half turn; the first hex of every second row has no partner, so it
// is left off the board (`x`).
const ford = readMap({
  id: 'ford',
  name: 'Ford',
  terrain: [
    'x . . . . . . c . . ~ w w',
    ' . . . . . c b b . . . . w',
    'x . . . . w w c = ~ = c .',
    ' . . . . . . w c ~ . c b .',
    'x . w . . . c c ~ . c b .',
    ' . w w c . . c ~ . . w c .',
    'x . c b . . . ~ . . w . .',
    ' . . w c . . . . . c w . .',
    'x . . w . . ~ . . . b c .',
    ' . c w . . ~ c . . c w w .',
    'x . b c . ~ c c . . . w .',
    ' . b c . ~ c w . . . . . .',
    'x . c = ~ = c w w . . . .',
    ' w . . . . b b c . . . . .',
    'x w w ~ . . c . . . . . .',
  ],
  elevation: [
    'x . . . . . . . . . . . .',
    ' . . . . . . . . . . . . .',
    'x . . . . . . . . . . . .',
    ' . . . . . . . . . . . . .',
    'x . . . . . . . . . . . .',
    ' . . . . . . . . . . . . .',
    'x . . . . . 1 . . . . . .',
    ' . . . . . . 2 . . . . . .',
    'x . . . . . . 1 . . . . .',
    ' . . . . . . . . . . . . .',
    'x . . . . . . . . . . . .',
    ' . . . . . . . . . . . . .',
    'x . . . . . . . . . . . .',
    ' . . . . . . . . . . . . .',
    'x . . . . . . . . . . . .',
  ],
  marks: [
    'x W 6 1 . . . . . . . . .',
    ' W 7 2 . . . C C . . . . .',
    'x 8 3 J . . . . . . . . .',
    ' 5 4 . J . . . . . . . D .',
    'x . . . . . . . . . . D .',
    ' . . . . . . . . . . . . .',
    'x . . A A . E . . . . . .',
    ' . . . . . . E . . . . . .',
    'x . . . . . . E . B B . .',
    ' . . . . . . . . . . . . .',
    'x . F . . . . . . . . . .',
    ' . F . . . . . . . K . 4 5',
    'x . . . . . . . . . K 3 8',
    ' . . . . . G G . . . 2 7 X',
    'x . . . . . . . . . 1 6 X',
  ],
  objectives: {
    A: { kind: 'depot', value: 1 }, B: { kind: 'depot', value: 1 },
    C: { kind: 'village', value: 2 }, D: { kind: 'village', value: 2 }, F: { kind: 'village', value: 2 }, G: { kind: 'village', value: 2 },
    E: { kind: 'hill', value: 3 },
    J: { kind: 'crossroads', value: 1 }, K: { kind: 'crossroads', value: 1 },
    W: { kind: 'hq', value: 1 }, X: { kind: 'hq', value: 1 },
  },
  seatSpawns: { 2: [0, 1] },
  maxRounds: 15,
});

// Crossroads, 17 by 13, for four. A start zone in each corner, its HQ behind
// it. A stream runs north to south down the middle and splits the map into a
// west pair of bases (W, Z) and an east pair (X, Y); it is crossed in three
// places only: the north ford, the south ford (each a single open hex between
// two depots' farms, A and B, H and I) and the hill (E) at the centre, an
// island of open high ground in the stream. The lanes:
//   - the middle lane runs west to east along the middle row, over the hill;
//     where it meets the flank road between the two bases on one side (through
//     the woods that close each end of the middle row) is a crossroads (J in
//     the west, K in the east), the junction to hold to move fast (control);
//   - the north and south roads join the bases on the same edge, over a ford:
//     a quick raid on the next base's depot (assault), in plain view.
// Each base has a hamlet (village C D F G) three or four steps out: two
// buildings behind a ring of low walls with three gaps (towards its base,
// towards the stream and towards its crossroads), a fort to hold (fortress).
// Woods and crops behind the hamlets give hidden ways round (infiltration).
// The hill sees the fords, the crossroads and the hamlets' outer walls, and no
// woods stand near it (fire support).
//
// Objectives are areas: the hilltop ridge (E, hill, 3), each hamlet's two
// buildings (C D F G, village, 2), each farm by a ford (A B H I, depot, 1),
// each crossroads (J K, crossroads, 1) and an HQ of two hexes in each corner
// behind its start zone (W X Y Z, hq, 1). The HQs are lettered so that letter
// order gives the zones in their old order: 0 top-left, 1 top-right, 2
// bottom-right, 3 bottom-left.
//
// The drawing is a mirror image north to south and east to west as well as
// under a half turn (the six unpaired hexes at the end of the odd rows aside,
// which are plain), so the four start zones are the same in every respect and
// the same number of steps from every objective that matters; the tests check
// that too. Two players take opposite corners (0 and 2): they meet on the hill
// or over a ford and then the other base's crossroads.
const crossroads = readMap({
  id: 'crossroads',
  name: 'Crossroads',
  terrain: [
    '. . . . . w . . ~ . . w . . . . .',
    ' . . . . . c b ~ ~ b c . . . . . .',
    '. . . . w = = c . c = = w . . . .',
    ' . . . w . b = ~ ~ = b . w . . . .',
    '. . . w = b . c ~ c . b = w . . .',
    ' . . w w c = . . . . = c w w . . .',
    'w w w w w . . . . . . . w w w w w',
    ' . . w w c = . . . . = c w w . . .',
    '. . . w = b . c ~ c . b = w . . .',
    ' . . . w . b = ~ ~ = b . w . . . .',
    '. . . . w = = c . c = = w . . . .',
    ' . . . . . c b ~ ~ b c . . . . . .',
    '. . . . . w . . ~ . . w . . . . .',
  ],
  elevation: [
    '. . . . . . . . . . . . . . . . .',
    ' . . . . . . . . . . . . . . . . .',
    '. . . . . . . . . . . . . . . . .',
    ' . . . . . . . . . . . . . . . . .',
    '. . . . . . . . . . . . . . . . .',
    ' . . . . . . . 1 1 . . . . . . . .',
    '. . . . . . . 2 2 2 . . . . . . .',
    ' . . . . . . . 1 1 . . . . . . . .',
    '. . . . . . . . . . . . . . . . .',
    ' . . . . . . . . . . . . . . . . .',
    '. . . . . . . . . . . . . . . . .',
    ' . . . . . . . . . . . . . . . . .',
    '. . . . . . . . . . . . . . . . .',
  ],
  marks: [
    'W 8 6 3 . . . . . . . . . 3 6 8 X',
    ' W 7 4 1 . . A . . B . . 1 4 7 X .',
    '. . 5 2 . . . . . . . . . 2 5 . .',
    ' . . . . . C . . . . D . . . . . .',
    '. . . . . C . . . . . D . . . . .',
    ' . . . . . . . . . . . . . . . . .',
    '. . . . . J . E E E . K . . . . .',
    ' . . . . . . . . . . . . . . . . .',
    '. . . . . F . . . . . G . . . . .',
    ' . . . . . F . . . . G . . . . . .',
    '. . 5 2 . . . . . . . . . 2 5 . .',
    ' Z 7 4 1 . . H . . I . . 1 4 7 Y .',
    'Z 8 6 3 . . . . . . . . . 3 6 8 Y',
  ],
  objectives: {
    A: { kind: 'depot', value: 1 }, B: { kind: 'depot', value: 1 },
    C: { kind: 'village', value: 2 }, D: { kind: 'village', value: 2 },
    E: { kind: 'hill', value: 3 },
    F: { kind: 'village', value: 2 }, G: { kind: 'village', value: 2 },
    H: { kind: 'depot', value: 1 }, I: { kind: 'depot', value: 1 },
    J: { kind: 'crossroads', value: 1 }, K: { kind: 'crossroads', value: 1 },
    W: { kind: 'hq', value: 1 }, X: { kind: 'hq', value: 1 }, Y: { kind: 'hq', value: 1 }, Z: { kind: 'hq', value: 1 },
  },
  seatSpawns: { 4: [0, 1, 2, 3] },
  maxRounds: 15,
});

// Tripoint, a triangle of 16 hexes a side, for three. An HQ in each corner: W at the top (zone 0), X bottom
// right (zone 1), Y bottom left (zone 2). The drawing is the same after a third of a turn about the centre hex
// (the hill; clockwise W to X to Y), and it is a mirror image about each line from a corner through the centre
// too, but for the hill's area and the order of the spawn hexes (the tests check the turn). The lanes:
//   - each edge is a lane shared by the two seats at its ends, open all the way: a border to fight over, and the
//     third seat can always come in on it from the middle. Half way along each edge stands a village (D, F, G;
//     two buildings on the lane itself, a low wall on the inner side), equally near both seats: a fortress on the
//     border (fortress, assault);
//   - a spoke runs straight from each corner to the hill, open ground the whole way, through the HQ's gate (J for
//     W, K for X, L for Y; a crossroads, a low wall each side of it, four steps out): control, then the quickest
//     way to the centre;
//   - between each spoke and the edges is jungle, woods and crops (infiltration), and in it, beside the spoke
//     and five steps out, a farm (a depot) on each side of it: each seat has two, one in each jungle it borders,
//     and the farm across the jungle from each is a neighbour's (A B C, S T U).
// The hill (E) is the centre hex, high ground, and three of the six slopes round it; a pond stands two steps
// out from it in each jungle, so the spokes are the open ways up (fire support). Steps from each HQ (walking):
// its gate 4, its two depots 6, its two villages 7, the hill 9, the farms across its two jungles 10, the far
// jungle's farms 14, a neighbour's gate 13, a neighbour's HQ 15; every start hex is 7 to 9 steps from the centre,
// four or five rounds of a rifleman's plain moves. The tests check that every HQ is as many steps from every
// objective as the turned HQ is from the turned objective.
// In odd-r layout a triangle with its point up leaves half of every row off the board (`x`).
const tripoint = readMap({
  id: 'tripoint',
  name: 'Tripoint',
  terrain: [
    'x x x x x x x x . x x x x x x x',
    ' x x x x x x x . . x x x x x x x',
    'x x x x x x x . . . x x x x x x',
    ' x x x x x x . . . . x x x x x x',
    'x x x x x x . = . = . x x x x x',
    ' x x x x x . c . . c . x x x x x',
    'x x x x x . b c . c b . x x x x',
    ' x x x x b w w . . w w b x x x x',
    'x x x x b = w c . c w = b x x x',
    ' x x x . w w ~ . . ~ w w . x x x',
    'x x x . b w c . . . c w b . x x',
    ' x x . c c . . . . . . c c . x x',
    'x x . = . . . c ~ c . . . = . x',
    ' x . . . . c w w w w c . . . . x',
    'x . . . = c b w = w b c = . . .',
    ' . . . . . . . b b . . . . . . .',
  ],
  elevation: [
    'x x x x x x x x . x x x x x x x',
    ' x x x x x x x . . x x x x x x x',
    'x x x x x x x . . . x x x x x x',
    ' x x x x x x . . . . x x x x x x',
    'x x x x x x . . . . . x x x x x',
    ' x x x x x . . . . . . x x x x x',
    'x x x x x . . . . . . . x x x x',
    ' x x x x . . . . . . . . x x x x',
    'x x x x . . . . . . . . . x x x',
    ' x x x . . . . 1 1 . . . . x x x',
    'x x x . . . . 1 2 1 . . . . x x',
    ' x x . . . . . 1 1 . . . . . x x',
    'x x . . . . . . . . . . . . . x',
    ' x . . . . . . . . . . . . . . x',
    'x . . . . . . . . . . . . . . .',
    ' . . . . . . . . . . . . . . . .',
  ],
  marks: [
    'x x x x x x x x W x x x x x x x',
    ' x x x x x x x 7 8 x x x x x x x',
    'x x x x x x x 5 . 6 x x x x x x',
    ' x x x x x x 3 1 2 4 x x x x x x',
    'x x x x x x . . J . . x x x x x',
    ' x x x x x . . . . . . x x x x x',
    'x x x x x . S . . . A . x x x x',
    ' x x x x G . . . . . . D x x x x',
    'x x x x G . . . . . . . D x x x',
    ' x x x . . . . E . . . . . x x x',
    'x x x . C . . . E E . . T . x x',
    ' x x . . . . . E . . . . . . x x',
    'x x 4 . . . . . . . . . . . 3 x',
    ' x 6 2 L . . . . . . . . K 1 5 x',
    'x 8 . 1 . . U . . . B . . 2 . 7',
    ' Y 7 5 3 . . . F F . . . 4 6 8 X',
  ],

  objectives: {
    A: { kind: 'depot', value: 1 }, B: { kind: 'depot', value: 1 }, C: { kind: 'depot', value: 1 },
    S: { kind: 'depot', value: 1 }, T: { kind: 'depot', value: 1 }, U: { kind: 'depot', value: 1 },
    D: { kind: 'village', value: 2 }, F: { kind: 'village', value: 2 }, G: { kind: 'village', value: 2 },
    E: { kind: 'hill', value: 3 },
    J: { kind: 'crossroads', value: 1 }, K: { kind: 'crossroads', value: 1 }, L: { kind: 'crossroads', value: 1 },
    W: { kind: 'hq', value: 1 }, X: { kind: 'hq', value: 1 }, Y: { kind: 'hq', value: 1 },
  },
  seatSpawns: { 3: [0, 1, 2] },
  maxRounds: 15,
});

export const MAPS: Record<string, GameMap> = {
  crossroads,
  ford,
  tripoint,
};

/**
 * The map for a match of `players`: the one made for exactly that many (its
 * `spawns` has one zone per seat), else the first map with a layout for that
 * many seats. Throws when no map seats them. The map is never chosen by hand.
 */
export function mapFor(players: number): GameMap {
  const maps = Object.values(MAPS);
  const found = maps.find((m) => m.spawns.length === players && m.seatSpawns[players])
    ?? maps.find((m) => m.seatSpawns[players]);
  if (!found) throw new Error(`No map seats ${players} players.`);
  return found;
}
