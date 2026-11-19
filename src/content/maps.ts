// The maps. A new map is a new drawing here and an entry in MAPS.
// The drawing format is explained in mapFormat.ts.
//
// Every map must look the same after a half turn about its centre hex, so
// opposite seats are equal; the tests check this. To turn a hex by hand:
// count rows from the other end, and columns from the other end too. The
// centre hex of a drawing with an odd number of rows sits on an odd row when
// there are 11 rows, and then on even rows (the 1st, 3rd, ...) the turned hex
// sits one column further right than that, so the first hex of each even row
// has no partner. With 13 rows the centre is on an even row (the 7th), and it
// is the last hex of each odd row (the 2nd, 4th, ... 12th) that has none.
// Such a hex must be left as open, level ground with no mark.

import type { GameMap } from '../shared/types';
import { readMap } from './mapFormat';

// Crossroads, 17 by 13. Two lanes cross on a bare hill, the 3-point ground:
// one runs west-east along the middle row, the other north-south over two
// wooded rises, each with a pond at its foot to walk round. Low walls stand at
// the four feet of the hill. A hamlet (a 2) lies a few steps from each start
// zone on the way in, with fields of crops on its outer side and woods behind;
// a farm (a 1) stands at the foot of each wooded rise, nearer the corner.
// Woods close both ends of the middle row, so that no start zone has a clear
// line to another.
//
// The drawing is a mirror image north to south and east to west as well as
// under a half turn (the six unpaired hexes at the end of the odd rows aside,
// which are plain), so the four start zones are the same in every respect and
// the same number of steps from every objective that matters; the tests check
// that too. From each zone there is more than one way to its hamlet through
// crops and woods, which hide a walking unit until an enemy is within two
// hexes; the hill and the ground round it are open.
const crossroads = readMap({
  id: 'crossroads',
  name: 'Crossroads',
  terrain: [
    '. . . . . . . w w w . . . . . . .',
    ' . . . . . . b w w b . . . . . . .',
    '. . . . c c . . w . . c c . . . .',
    ' . . . w c c . ~ ~ . c c w . . . .',
    '. . . w c b . = . = . b c w . . .',
    ' . . w w c b c . . c b c w w . . .',
    'w w w w w . . . . . . . w w w w w',
    ' . . w w c b c . . c b c w w . . .',
    '. . . w c b . = . = . b c w . . .',
    ' . . . w c c . ~ ~ . c c w . . . .',
    '. . . . c c . . w . . c c . . . .',
    ' . . . . . . b w w b . . . . . . .',
    '. . . . . . . w w w . . . . . . .',
  ],
  elevation: [
    '. . . . . . . 1 1 1 . . . . . . .',
    ' . . . . . . . 1 1 . . . . . . . .',
    '. . . . . . . . 1 . . . . . . . .',
    ' . . . . . . . . . . . . . . . . .',
    '. . . . . . . . . . . . . . . . .',
    ' . . . . . . . 1 1 . . . . . . . .',
    '. . . . . . . 1 2 1 . . . . . . .',
    ' . . . . . . . 1 1 . . . . . . . .',
    '. . . . . . . . . . . . . . . . .',
    ' . . . . . . . . . . . . . . . . .',
    '. . . . . . . . 1 . . . . . . . .',
    ' . . . . . . . 1 1 . . . . . . . .',
    '. . . . . . . 1 1 1 . . . . . . .',
  ],
  marks: [
    '. 8 6 3 . . . . . . . . . 3 6 8 .',
    ' . 7 4 1 . . A . . B . . 1 4 7 . .',
    '. . 5 2 . . . . . . . . . 2 5 . .',
    ' . . . . . . . . . . . . . . . . .',
    '. . . . . C . . . . . D . . . . .',
    ' . . . . . . . . . . . . . . . . .',
    '. . . . . . . . E . . . . . . . .',
    ' . . . . . . . . . . . . . . . . .',
    '. . . . . F . . . . . G . . . . .',
    ' . . . . . . . . . . . . . . . . .',
    '. . 5 2 . . . . . . . . . 2 5 . .',
    ' . 7 4 1 . . H . . I . . 1 4 7 . .',
    '. 8 6 3 . . . . . . . . . 3 6 8 .',
  ],
  objectiveValues: { A: 1, B: 1, C: 2, D: 2, E: 3, F: 2, G: 2, H: 1, I: 1 },
  seatSpawns: { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] },
  maxRounds: 15,
});

export const MAPS: Record<string, GameMap> = {
  crossroads,
};

export const DEFAULT_MAP: string = 'crossroads';
