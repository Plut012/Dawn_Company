import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP, MAPS, TERRAIN, UNITS } from '../content';
import { key } from '../shared/hex';
import type { GameMap, GameState, Hex, PlayerId, Posture, Unit, UnitStatus, UnitTypeId } from '../shared/types';
import { blockingHex, canSee, hideRange, spots, viewFor, visibleEnemies, visibleHexes } from './index';

// ---- hand-built maps: one long row of hexes (q, 0), so lines run straight.
type Spec = Record<number, string>;   // q -> 'w2' woods at level 2, 'b', '1' open at level 1, ...
function strip(length: number, spec: Spec = {}): GameMap {
  const cells: GameMap['cells'] = {};
  for (let q = 0; q < length; q++) {
    const s = spec[q] ?? '';
    const GROUND: Record<string, string> = { w: 'woods', b: 'building', c: 'crops', '=': 'wall', '~': 'water' };
    const terrain = GROUND[s[0]] ?? 'open';
    const level = Number(s.replace(/^[wbc=~]/, '') || 0);
    cells[`${q},0`] = { terrain, elevation: level };
  }
  return { id: 'strip', name: 'Strip', cols: length, rows: 1, cells, objectives: [], spawns: [], seatSpawns: {}, maxRounds: 9 };
}
const at = (q: number): Hex => ({ q, r: 0 });

let nextId = 0;
function unit(owner: PlayerId, type: UnitTypeId, pos: Hex, extra: Partial<Unit> = {}): Unit {
  const status: UnitStatus = extra.status ?? 'ready';
  return { id: `${owner}-${nextId++}`, owner, type, name: 'Test', pos, status, pinnedRound: null, revealed: false, posture: 'still', ...extra };
}
function game(map: GameMap, units: Unit[], extra: Partial<GameState> = {}): GameState {
  return {
    map, playerCount: 2, units, round: 3, scores: [4, 7], eliminated: [false, false],
    over: false, winners: [], ...extra,
  };
}

describe('canSee: the line rule', () => {
  it('sees along open flat ground, and itself', () => {
    const m = strip(8);
    expect(canSee(m, at(0), at(7))).toBe(true);
    expect(canSee(m, at(3), at(3))).toBe(true);
    expect(canSee(m, at(0), at(1))).toBe(true);
  });
  it('is blocked by woods between two units on flat ground', () => {
    const m = strip(8, { 3: 'w' });
    expect(canSee(m, at(0), at(6))).toBe(false);
    expect(canSee(m, at(6), at(0))).toBe(false);
    expect(blockingHex(m, at(0), at(6))).toEqual(at(3));
  });
  it('is blocked by a building too', () => {
    expect(canSee(strip(6, { 2: 'b' }), at(0), at(5))).toBe(false);
  });
  it('is not blocked by crops, a low wall or water', () => {
    for (const ground of ['c', '=', '~']) expect(canSee(strip(6, { 2: ground }), at(0), at(5))).toBe(true);
  });
  it('is blocked by a hill between them', () => {
    const m = strip(8, { 3: '1' });
    expect(canSee(m, at(0), at(6))).toBe(false);
    expect(canSee(m, at(6), at(0))).toBe(false);
  });
  it('is not blocked by a hill as high as the line (strictly greater blocks)', () => {
    expect(canSee(strip(8, { 0: '1', 3: '1', 6: '1' }), at(0), at(6))).toBe(true);
    expect(canSee(strip(8, { 0: '1', 3: '2', 6: '1' }), at(0), at(6))).toBe(false);
  });
  it('never blocks at the end hexes: seeing into woods or onto a hill', () => {
    const m = strip(8, { 0: 'w', 6: 'w1' });
    expect(canSee(m, at(0), at(5))).toBe(true);
    expect(canSee(m, at(0), at(6))).toBe(true);
  });
  it('sees over woods on level 0 from a level-2 hill, to ground far enough beyond', () => {
    // Woods stand one hex from the hill: the line is well above them by the time it gets there.
    expect(canSee(strip(8, { 0: '2', 1: 'w' }), at(0), at(5))).toBe(true);
    expect(canSee(strip(8, { 0: '2', 1: 'w' }), at(0), at(3))).toBe(true);
    // Woods next to the target are too close to the ground end of the line: blocked.
    expect(canSee(strip(8, { 0: '2', 4: 'w' }), at(0), at(5))).toBe(false);
    // And woods right beside a level-0 viewer block anything on the flat.
    expect(canSee(strip(8, { 0: '2', 1: 'w' }), at(7), at(0))).toBe(true);
    expect(canSee(strip(8, { 1: 'w' }), at(0), at(5))).toBe(false);
  });
  it('a hex off the map blocks the line; a target off the map cannot be seen', () => {
    const m = strip(8);
    delete m.cells['3,0'];
    expect(canSee(m, at(0), at(6))).toBe(false);
    expect(blockingHex(m, at(0), at(6))).toEqual(at(3));
    expect(canSee(m, at(0), { q: 20, r: 0 })).toBe(false);
    expect(canSee(m, { q: -2, r: 0 }, at(1))).toBe(false);
  });
  it('is true for a hex with itself', () => {
    expect(canSee(strip(3), at(1), at(1))).toBe(true);
  });
});

describe('canSee on the real map', () => {
  const map = MAPS[DEFAULT_MAP];
  const hexes = Object.keys(map.cells).map((k) => {
    const [q, r] = k.split(',').map(Number);
    return { q, r };
  });

  it('is symmetric over many random pairs (and over every pair near the middle)', () => {
    let seed = 12345;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const pick = () => hexes[Math.floor(rand() * hexes.length)];
    let visible = 0;
    for (let i = 0; i < 4000; i++) {
      const a = pick(), b = pick();
      const ab = canSee(map, a, b);
      expect(canSee(map, b, a), `${key(a)} <-> ${key(b)}`).toBe(ab);
      if (ab) visible++;
    }
    expect(visible).toBeGreaterThan(200);          // the test is not trivially all-blocked
    expect(visible).toBeLessThan(4000);            // nor all-clear
    for (const a of hexes.slice(0, 40)) for (const b of hexes) {
      expect(canSee(map, b, a)).toBe(canSee(map, a, b));
    }
  });

  it('has a clear view along the open lane to the neighbouring hex, from every hex', () => {
    for (const a of hexes) for (const d of [{ q: 1, r: 0 }, { q: 0, r: 1 }]) {
      const b = { q: a.q + d.q, r: a.r + d.r };
      if (map.cells[key(b)]) expect(canSee(map, a, b)).toBe(true);
    }
  });
});

describe('visibleHexes', () => {
  it('stops at the unit’s sight range', () => {
    const m = strip(20);
    const r = unit(0, 'rifleman', at(0));            // sight 6
    const v = visibleHexes(game(m, [r]), 0);
    expect(UNITS.rifleman.sight).toBe(6);
    for (let q = 0; q <= 6; q++) expect(v.has(key(at(q)))).toBe(true);
    expect(v.has(key(at(7)))).toBe(false);
    const s = unit(0, 'sniper', at(0));              // sight 8
    const w = visibleHexes(game(m, [s]), 0);
    expect(w.has(key(at(8)))).toBe(true);
    expect(w.has(key(at(9)))).toBe(false);
  });
  it('never includes hexes off the map', () => {
    const v = visibleHexes(game(strip(4), [unit(0, 'sniper', at(1))]), 0);
    expect([...v].sort()).toEqual(['0,0', '1,0', '2,0', '3,0']);
  });
  it('is blocked behind woods but still shows the woods themselves', () => {
    const v = visibleHexes(game(strip(10, { 3: 'w' }), [unit(0, 'rifleman', at(0))]), 0);
    expect(v.has('3,0')).toBe(true);
    expect(v.has('4,0')).toBe(false);
    expect(v.has('2,0')).toBe(true);
  });
  it('is the union over every living unit', () => {
    const m = strip(30);
    const v = visibleHexes(game(m, [unit(0, 'rifleman', at(0)), unit(0, 'rifleman', at(20))]), 0);
    expect(v.has('5,0')).toBe(true);
    expect(v.has('15,0')).toBe(true);
    expect(v.has('12,0')).toBe(false);
  });
  it('a unit always sees its own hex, even when pinned', () => {
    const m = strip(10);
    const v = visibleHexes(game(m, [unit(0, 'rifleman', at(2), { status: 'pinned', pinnedRound: 2 })]), 0);
    expect(v.has('2,0')).toBe(true);
    expect(v.has('8,0')).toBe(true);
    expect(v.has('9,0')).toBe(false);
  });
  it('a pinned unit still sees as far as a ready one', () => {
    const m = strip(12, { 4: 'w' });
    const ready = visibleHexes(game(m, [unit(0, 'sniper', at(0))]), 0);
    const pinned = visibleHexes(game(m, [unit(0, 'sniper', at(0), { status: 'pinned' })]), 0);
    expect([...pinned].sort()).toEqual([...ready].sort());
  });
  it('a down unit sees nothing; neither do enemies’ units help', () => {
    const m = strip(10);
    const s = game(m, [unit(0, 'rifleman', at(0), { status: 'down' }), unit(1, 'rifleman', at(5))]);
    expect(visibleHexes(s, 0).size).toBe(0);
    expect(visibleHexes(s, 1).has('0,0')).toBe(true);
  });
  it('an eliminated player sees every hex', () => {
    const m = strip(10);
    const s = game(m, [unit(1, 'rifleman', at(5))], { eliminated: [true, false] });
    expect(visibleHexes(s, 0).size).toBe(10);
  });
});

describe('visibleEnemies', () => {
  const flat = strip(16);
  const woods = strip(16, { 5: 'w', 12: 'w' });

  it('sees an enemy on open ground within sight with a clear line', () => {
    const s = game(flat, [unit(0, 'rifleman', at(0)), unit(1, 'rifleman', at(6))]);
    expect(visibleEnemies(s, 0).map((u) => u.owner)).toEqual([1]);
  });
  it('does not see an enemy beyond sight range', () => {
    const s = game(flat, [unit(0, 'rifleman', at(0)), unit(1, 'rifleman', at(7))]);
    expect(visibleEnemies(s, 0)).toEqual([]);
  });
  it('does not see an enemy behind blocking ground', () => {
    const s = game(strip(16, { 3: 'w' }), [unit(0, 'rifleman', at(0)), unit(1, 'rifleman', at(5))]);
    expect(visibleEnemies(s, 0)).toEqual([]);
  });
  it('does not count its own side as an enemy', () => {
    const s = game(flat, [unit(0, 'rifleman', at(0)), unit(0, 'rifleman', at(2))]);
    expect(visibleEnemies(s, 0)).toEqual([]);
  });

  describe('stealth', () => {
    const STILL = TERRAIN.woods.hide!.still;
    const MOVED = TERRAIN.woods.hide!.moved!;
    /** A watcher at 0 and one enemy `d` hexes along open ground, standing in `ground`, with nothing in between. */
    const facing = (d: number, ground: string, extra: Partial<Unit> = {}): GameState => {
      const m = strip(16, { [d]: ground });
      expect(canSee(m, at(0), at(d))).toBe(true);
      return game(m, [unit(0, 'rifleman', at(0)), unit(1, 'rifleman', at(d), extra)]);
    };
    const seen = (s: GameState): boolean => visibleEnemies(s, 0).length === 1;

    it('the data: woods and crops hide, a still unit more than a mover; a building hides only a still unit; the rest hide nobody', () => {
      expect(TERRAIN.woods.hide).toEqual({ still: 1, moved: 2 });
      expect(TERRAIN.crops.hide).toEqual({ still: 1, moved: 2 });
      expect(TERRAIN.building.hide).toEqual({ still: 1, moved: null });
      for (const id of ['open', 'wall', 'water']) expect(TERRAIN[id].hide).toBeNull();
      for (const u of Object.values(UNITS)) expect(u.spotting).toBe(0);
    });

    it.each(['w', 'b', 'c'])('still in hiding terrain (%s): seen at exactly the hide distance, unseen one hex further, with a clear line', (ground) => {
      expect(seen(facing(STILL, ground))).toBe(true);
      expect(seen(facing(STILL + 1, ground))).toBe(false);
      for (let d = STILL + 1; d <= 6; d++) expect(seen(facing(d, ground))).toBe(false);
      for (let d = 1; d <= STILL; d++) expect(seen(facing(d, ground))).toBe(true);
    });

    it.each(['w', 'c'])('moved in hiding terrain (%s): seen at exactly the hide distance, unseen one hex further, with a clear line', (ground) => {
      expect(MOVED).toBeGreaterThan(STILL);
      expect(seen(facing(MOVED, ground, { posture: 'moved' }))).toBe(true);
      expect(seen(facing(MOVED + 1, ground, { posture: 'moved' }))).toBe(false);
      for (let d = MOVED + 1; d <= 6; d++) expect(seen(facing(d, ground, { posture: 'moved' }))).toBe(false);
      for (let d = 1; d <= MOVED; d++) expect(seen(facing(d, ground, { posture: 'moved' }))).toBe(true);
      // ...where a still unit at the mover's distance is not seen
      expect(seen(facing(MOVED, ground, { posture: 'still' }))).toBe(false);
    });

    it('moved into a building: seen like a unit in the open', () => {
      for (let d = 1; d <= 6; d++) expect(seen(facing(d, 'b', { posture: 'moved' }))).toBe(true);
      expect(seen(facing(7, 'b', { posture: 'moved' }))).toBe(false);
    });

    it('a low wall hides nobody', () => {
      for (let d = 1; d <= 6; d++) expect(seen(facing(d, '='))).toBe(true);
    });

    it('dashed, or revealed: seen out to sight range like a unit in the open, and no further', () => {
      for (const extra of [{ posture: 'dashed' as Posture }, { revealed: true }, { revealed: true, posture: 'moved' as Posture }]) {
        for (let d = 1; d <= 6; d++) expect(seen(facing(d, 'w', extra)), `${JSON.stringify(extra)} at ${d}`).toBe(true);
        expect(seen(facing(7, 'w', extra))).toBe(false);          // a rifleman sees 6
      }
    });

    it('in the open every posture is seen', () => {
      for (const posture of ['still', 'moved', 'dashed'] as Posture[]) {
        for (let d = 1; d <= 6; d++) expect(seen(facing(d, '', { posture }))).toBe(true);
      }
    });

    it('the whole table, every distance: what hides a unit is its ground, its posture and whether it fired', () => {
      for (const ground of ['', 'w', 'b', 'c', '=']) for (const posture of ['still', 'moved', 'dashed'] as Posture[]) for (const revealed of [false, true]) {
        const hides = ground === 'w' || ground === 'c' || (ground === 'b' && posture === 'still');
        const limit = !hides || revealed || posture === 'dashed' ? 6 : posture === 'moved' ? MOVED : STILL;
        for (let d = 1; d <= 8; d++) {
          expect(seen(facing(d, ground, { posture, revealed })), `${ground || 'open'} ${posture} ${revealed} at ${d}`).toBe(d <= limit);
        }
      }
    });

    it('a unit standing on an objective is hidden by the same rule as anywhere else', () => {
      const m = { ...strip(16, { 4: 'w' }), objectives: [{ id: 'A', hex: at(4), value: 3 }] };
      const s = game(m, [unit(0, 'rifleman', at(0)), unit(1, 'rifleman', at(4))]);
      expect(visibleEnemies(s, 0)).toEqual([]);
      expect(visibleHexes(s, 0).has(key(at(4)))).toBe(true);     // the objective hex itself is in plain sight
    });

    it('a spotter\'s `spotting` is added to the distance, for that spotter only', () => {
      const keen = { ...UNITS.rifleman, id: 'keen', spotting: 2 };
      UNITS.keen = keen;
      try {
        const m = strip(16, { 5: 'w' });
        const s = (type: UnitTypeId, d: number, posture: Posture) => game(m, [unit(0, type, at(5 - d)), unit(0, 'rifleman', at(0)), unit(1, 'rifleman', at(5), { posture })]);
        expect(visibleEnemies(s('keen', STILL + 2, 'still'), 0)).toHaveLength(1);
        expect(visibleEnemies(s('keen', STILL + 3, 'still'), 0)).toEqual([]);
        expect(visibleEnemies(s('keen', MOVED + 2, 'moved'), 0)).toHaveLength(1);
        expect(visibleEnemies(s('keen', MOVED + 3, 'moved'), 0)).toEqual([]);
        expect(visibleEnemies(s('rifleman', STILL + 2, 'still'), 0)).toEqual([]);
      } finally {
        delete UNITS.keen;
      }
    });

    it('the hide distance is measured from any friendly unit that also has the line', () => {
      const s = game(woods, [unit(0, 'rifleman', at(0)), unit(0, 'medic', at(5 - STILL)), unit(1, 'rifleman', at(5))]);
      expect(visibleEnemies(s, 0)).toHaveLength(1);
    });
    it('a friend that is close but has no line does not spot the unit', () => {
      const m = strip(16, { 4: 'w', 5: 'w' });
      // 2 from a mover in woods, but the line passes through woods at 4
      const s = game(m, [unit(0, 'rifleman', at(3)), unit(1, 'rifleman', at(5), { posture: 'moved' })]);
      expect(visibleEnemies(s, 0)).toEqual([]);
    });

    it('`spots` is one unit\'s own eyes and `hideRange` the distance the ground gives', () => {
      const m = strip(16, { 5: 'w' });
      const far = unit(0, 'rifleman', at(1)), near = unit(0, 'rifleman', at(4));
      const man = unit(1, 'rifleman', at(5));
      expect(hideRange(m, man)).toBe(STILL);
      expect(hideRange(m, { ...man, posture: 'moved' })).toBe(MOVED);
      expect(hideRange(m, { ...man, posture: 'dashed' })).toBeNull();
      expect(hideRange(m, { ...man, revealed: true })).toBeNull();
      expect(hideRange(m, { ...man, pos: at(6) })).toBeNull();
      expect(spots(m, near, man)).toBe(true);
      expect(spots(m, far, man)).toBe(false);
      expect(spots(m, far, { ...man, posture: 'dashed' })).toBe(true);
    });
  });

  it('a pinned unit still spots enemies', () => {
    const s = game(flat, [unit(0, 'rifleman', at(0), { status: 'pinned' }), unit(1, 'rifleman', at(6))]);
    expect(visibleEnemies(s, 0)).toHaveLength(1);
  });
  it('a down friendly unit spots nothing', () => {
    const s = game(flat, [unit(0, 'rifleman', at(0), { status: 'down' }), unit(1, 'rifleman', at(3))]);
    expect(visibleEnemies(s, 0)).toEqual([]);
  });
  it('a down enemy is never seen', () => {
    const s = game(flat, [unit(0, 'rifleman', at(0)), unit(1, 'rifleman', at(2), { status: 'down' })]);
    expect(visibleEnemies(s, 0)).toEqual([]);
  });
  it('a pinned enemy is seen like any other', () => {
    const s = game(flat, [unit(0, 'rifleman', at(0)), unit(1, 'rifleman', at(2), { status: 'pinned' })]);
    expect(visibleEnemies(s, 0)).toHaveLength(1);
  });
  it('uses each unit’s own sight range: the sniper sees further', () => {
    const units = (type: UnitTypeId) => [unit(0, type, at(0)), unit(1, 'rifleman', at(8))];
    expect(visibleEnemies(game(flat, units('rifleman')), 0)).toEqual([]);
    expect(visibleEnemies(game(flat, units('sniper')), 0)).toHaveLength(1);
  });
  it('an eliminated player sees every living enemy, even hidden ones, but not down ones', () => {
    const s = game(woods, [
      unit(1, 'rifleman', at(5)), unit(1, 'rifleman', at(15)), unit(1, 'rifleman', at(9), { status: 'down' }),
    ], { eliminated: [true, false] });
    expect(visibleEnemies(s, 0)).toHaveLength(2);
  });
});

describe('viewFor', () => {
  const map = MAPS[DEFAULT_MAP];

  it('carries the public facts across and the player’s own units in every status', () => {
    const own = [
      unit(0, 'rifleman', at(0)), unit(0, 'medic', at(1), { status: 'pinned', pinnedRound: 2 }),
      unit(0, 'sniper', at(2), { status: 'down' }),
    ];
    const s = game(strip(10), [...own, unit(1, 'rifleman', at(9))], { scores: [3, 5], round: 4 });
    const v = viewFor(s, 0);
    expect(v.player).toBe(0);
    expect(v.units.filter((u) => u.owner === 0).map((u) => u.id)).toEqual(own.map((u) => u.id));
    expect(v).toMatchObject({ round: 4, maxRounds: 9, scores: [3, 5], eliminated: [false, false], over: false, winners: [], playerCount: 2 });
    expect(v.map).toBe(s.map);
    expect([...v.visible].sort()).toEqual([...visibleHexes(s, 0)].sort());
  });

  it('copies scores, eliminated and winners rather than sharing them', () => {
    const s = game(strip(5), [unit(0, 'rifleman', at(0))], { over: true, winners: [1] });
    const v = viewFor(s, 0);
    expect(v.over).toBe(true);
    expect(v.winners).toEqual([1]);
    v.scores[0] = 99; v.eliminated[0] = true; v.winners.push(0);
    expect(s.scores[0]).toBe(4); expect(s.eliminated[0]).toBe(false); expect(s.winners).toEqual([1]);
  });

  it('contains only visible enemies, never down ones, and says nothing else about the rest', () => {
    // A busy fight on the real map: four players, every unit type, all statuses, many positions.
    let seed = 7;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const cells = Object.keys(map.cells);
    const types = Object.keys(UNITS);
    const statuses: UnitStatus[] = ['ready', 'ready', 'pinned', 'down'];
    for (let round = 0; round < 60; round++) {
      const taken = new Set<string>();
      const units: Unit[] = [];
      for (let p = 0; p < 4; p++) for (let i = 0; i < 6; i++) {
        let k: string;
        do k = cells[Math.floor(rand() * cells.length)]; while (taken.has(k));
        taken.add(k);
        const [q, r] = k.split(',').map(Number);
        units.push(unit(p, types[Math.floor(rand() * types.length)], { q, r }, {
          status: statuses[Math.floor(rand() * statuses.length)], revealed: rand() < 0.2,
          posture: (['still', 'still', 'moved', 'dashed'] as const)[Math.floor(rand() * 4)],
        }));
      }
      const state: GameState = {
        map, playerCount: 4, units, round: 2, scores: [1, 2, 3, 4],
        eliminated: [false, false, false, false], over: false, winners: [],
      };
      for (let p = 0; p < 4; p++) {
        const v = viewFor(state, p);
        const seen = new Set(visibleEnemies(state, p).map((u) => u.id));
        const vis = new Set(v.visible);
        for (const u of v.units) {
          if (u.owner === p) continue;
          expect(seen.has(u.id)).toBe(true);
          expect(u.status).not.toBe('down');
          expect(vis.has(key(u.pos)) || state.eliminated[p]).toBe(true);
        }
        // exactly: own units + seen enemies
        expect(v.units.length).toBe(units.filter((u) => u.owner === p).length + seen.size);
        // the serialized view mentions no unit it should not
        const text = JSON.stringify(v);
        for (const u of units) {
          if (u.owner !== p && !seen.has(u.id)) expect(text.includes(`"id":"${u.id}"`)).toBe(false);
        }
      }
    }
  });

  it('shows the same enemy to a spotter and hides it from the blind', () => {
    const m = strip(12, { 6: 'w' });
    const s = game(m, [unit(0, 'rifleman', at(0)), unit(1, 'rifleman', at(8))]);
    expect(viewFor(s, 0).units.map((u) => u.owner)).toEqual([0]);       // line blocked by woods at 6
    const open = game(strip(12), [unit(0, 'rifleman', at(2)), unit(1, 'rifleman', at(8))]);
    expect(viewFor(open, 0).units.map((u) => u.owner).sort()).toEqual([0, 1]);
    expect(viewFor(open, 1).units.map((u) => u.owner).sort()).toEqual([0, 1]);   // sight is mutual here
  });

  it('gives an eliminated player the whole board and every living unit', () => {
    const s = game(strip(10, { 4: 'w' }), [
      unit(0, 'rifleman', at(0), { status: 'down' }),
      unit(1, 'rifleman', at(9)), unit(1, 'medic', at(5), { status: 'down' }),
    ], { eliminated: [true, false] });
    const v = viewFor(s, 0);
    expect(v.visible).toHaveLength(10);
    expect(v.units.map((u) => u.owner).sort()).toEqual([0, 1]);   // own down unit + the living enemy
    expect(v.eliminated).toEqual([true, false]);
  });

  it('does not mutate the state', () => {
    const s = game(strip(10), [unit(0, 'rifleman', at(0)), unit(1, 'rifleman', at(3))]);
    const before = JSON.stringify(s);
    viewFor(s, 0); viewFor(s, 1); visibleHexes(s, 0); visibleEnemies(s, 1);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('the real map at the start', () => {
  const map = MAPS[DEFAULT_MAP];

  it('no spawn hex has a clear line to a spawn hex of another zone', () => {
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      for (const ha of map.spawns[a]) for (const hb of map.spawns[b]) {
        expect(canSee(map, ha, hb), `${key(ha)} (zone ${a}) -> ${key(hb)} (zone ${b})`).toBe(false);
      }
    }
  });

  it('with every spawn hex occupied by a sniper, nobody sees an enemy and everybody sees their own zone', () => {
    const units: Unit[] = [];
    map.spawns.forEach((zone, z) => zone.forEach((h) => units.push(unit(z, 'sniper', h))));
    const s: GameState = {
      map, playerCount: 4, units, round: 1, scores: [0, 0, 0, 0],
      eliminated: [false, false, false, false], over: false, winners: [],
    };
    for (let p = 0; p < 4; p++) {
      expect(visibleEnemies(s, p)).toEqual([]);
      const vis = visibleHexes(s, p);
      for (const h of map.spawns[p]) expect(vis.has(key(h))).toBe(true);
    }
  });
});
