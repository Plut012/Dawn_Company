import { describe, expect, it } from 'vitest';
import { mapFor, MAPS, PRESETS, UNITS } from '../content';
import { distance, key, parseKey } from '../shared/hex';
import type { GameMap, GameState, Hex, Order, Unit, UnitId, UnitTypeId } from '../shared/types';
import { createMatch, findPath, followUpOptions, orderOptions, validateOrders, viewFor } from './index';

function field(cols: number, rows: number, spec: Record<string, string> = {}): GameMap {
  const cells: GameMap['cells'] = {};
  for (let q = 0; q < cols; q++) {
    for (let r = 0; r < rows; r++) {
      const s = spec[`${q},${r}`] ?? '';
      const terrain = s.startsWith('w') ? 'woods' : s.startsWith('b') ? 'building' : s.startsWith('x') ? 'water' : 'open';
      cells[`${q},${r}`] = { terrain, elevation: Number(s.replace(/^[wbx]/, '') || 0) };
    }
  }
  return { id: 'field', name: 'Field', cols, rows, cells, objectives: [], spawns: [], seatSpawns: {}, maxRounds: 9 };
}
const h = (q: number, r = 0): Hex => ({ q, r });
function u(id: UnitId, type: UnitTypeId, q: number, r = 0, extra: Partial<Unit> = {}): Unit {
  return { id, owner: Number(id.split('-')[0]), type, name: id, pos: h(q, r), status: 'ready', pinnedRound: null, revealed: false, posture: 'still', returnRound: null, dugIn: false, ...extra };
}
function game(map: GameMap, units: Unit[]): GameState {
  return { map, playerCount: 2, units, round: 7,   // full day (19): the rules below are the v1 ones, in full light
    scores: [0, 0], eliminated: [false, false], flags: {}, mode: 'supply-line', works: {}, over: false, winners: [] };
}
const reasons = (state: GameState, player: number, orders: Order[]) => validateOrders(state, player, orders).map((e) => e.unit);

describe('validateOrders', () => {
  const map = field(12, 3, { '6,1': 'w' });
  const state = game(map, [
    u('0-0', 'rifleman', 0, 1), u('0-1', 'gunner', 1, 1), u('0-2', 'medic', 0, 0), u('0-3', 'mortar', 0, 2),
    u('0-4', 'sniper', 2, 0), u('0-5', 'rifleman', 3, 2, { status: 'down' }), u('0-6', 'rifleman', 1, 0, { status: 'pinned', pinnedRound: 3 }),
    u('1-0', 'rifleman', 11, 1),
  ]);
  it('accepts no orders, and a legal order of every kind', () => {
    expect(validateOrders(state, 0, [])).toEqual([]);
    expect(validateOrders(state, 0, [
      { unit: '0-0', kind: 'move', path: [h(0, 2), h(1, 2)] },
      { unit: '0-1', kind: 'ambush' },
      { unit: '0-2', kind: 'special', target: h(1, 0) },
      { unit: '0-3', kind: 'fire', target: h(5, 2) },
      { unit: '0-4', kind: 'dash', path: [h(3, 0), h(4, 0), h(5, 0), h(6, 0)] },
    ])).toEqual([]);
  });
  it('allows orders for a pinned unit', () => {
    expect(validateOrders(state, 0, [{ unit: '0-6', kind: 'fire', target: h(3, 0) }])).toEqual([]);
  });
  it('rejects a second order for the same unit', () => {
    const errors = validateOrders(state, 0, [{ unit: '0-0', kind: 'ambush' }, { unit: '0-0', kind: 'ambush' }]);
    expect(errors.length).toBe(1);
    expect(errors[0].unit).toBe('0-0');
  });
  it('rejects units that are not the player\'s, do not exist, or are down', () => {
    expect(reasons(state, 0, [{ unit: '1-0', kind: 'ambush' }])).toEqual(['1-0']);
    expect(reasons(state, 1, [{ unit: '0-0', kind: 'ambush' }])).toEqual(['0-0']);
    expect(reasons(state, 0, [{ unit: '0-9', kind: 'ambush' }])).toEqual(['0-9']);
    expect(reasons(state, 0, [{ unit: '0-5', kind: 'ambush' }])).toEqual(['0-5']);
  });
  it('rejects a kind the unit type does not list', () => {
    expect(reasons(state, 0, [{ unit: '0-1', kind: 'dash', path: [h(2, 1)] }])).toEqual(['0-1']);       // gunner cannot dash
    expect(reasons(state, 0, [{ unit: '0-3', kind: 'ambush' }])).toEqual(['0-3']);                     // mortar cannot ambush
    expect(reasons(state, 0, [{ unit: '0-2', kind: 'fire', target: h(1, 0) }])).toEqual(['0-2']);      // medic cannot fire
    expect(reasons(state, 0, [{ unit: '0-0', kind: 'special', target: h(1, 1) }])).toEqual(['0-0']);   // rifleman has no special
  });
  it('move and dash: path length, on the map, connected', () => {
    const mv = (path: Hex[], kind: 'move' | 'dash' = 'move'): Order => ({ unit: '0-0', kind, path });
    expect(reasons(state, 0, [mv([])])).toEqual(['0-0']);
    expect(reasons(state, 0, [mv([h(0, 2), h(1, 2), h(2, 2)])])).toEqual(['0-0']);            // 3 > move 2
    expect(reasons(state, 0, [mv([h(0, 2), h(1, 2), h(2, 2), h(3, 2)], 'dash')])).toEqual([]);   // 4 = 2 x move
    expect(reasons(state, 0, [mv([h(0, 2), h(1, 2), h(2, 2), h(3, 2), h(4, 2)], 'dash')])).toEqual(['0-0']);
    expect(reasons(state, 0, [mv([h(-1, 1)])])).toEqual(['0-0']);                             // off the map
    expect(reasons(state, 0, [mv([h(2, 1)])])).toEqual(['0-0']);                              // not next to the unit
    expect(reasons(state, 0, [mv([h(0, 2), h(2, 2)])])).toEqual(['0-0']);                     // gap
    expect(reasons(state, 0, [mv([h(0, 1)])])).toEqual(['0-0']);                              // its own hex is not a step
    expect(reasons(state, 0, [mv([h(1, 1), h(2, 1)])])).toEqual([]);                          // through a friend: units are ignored
  });
  it('move: impassable terrain is refused', () => {
    // x = water. An unknown terrain id counts as impassable too.
    const walled = game(field(4, 1, { '1,0': 'x' }), [u('0-0', 'rifleman', 0)]);
    expect(reasons(walled, 0, [{ unit: '0-0', kind: 'move', path: [h(1)] }])).toEqual(['0-0']);
  });
  it('direct fire: range, minimum range, and a clear line', () => {
    const f = (unit: UnitId, q: number, r: number): Order => ({ unit, kind: 'fire', target: h(q, r) });
    expect(reasons(state, 0, [f('0-0', 4, 1)])).toEqual([]);           // 4 away, empty hex
    expect(reasons(state, 0, [f('0-0', 5, 1)])).toEqual(['0-0']);      // 5 > range 4
    expect(reasons(state, 0, [f('0-0', 0, 1)])).toEqual(['0-0']);      // itself: under minRange 1
    expect(reasons(state, 0, [f('0-4', 3, 0)])).toEqual(['0-4']);      // sniper minRange 2
    expect(reasons(state, 0, [f('0-4', 4, 0)])).toEqual([]);
    expect(reasons(state, 0, [f('0-1', 6, 1)])).toEqual([]);           // into the woods: end hexes do not block
    const wooded = game(field(8, 1, { '2,0': 'w' }), [u('0-0', 'rifleman', 0)]);
    expect(reasons(wooded, 0, [f('0-0', 3, 0)])).toEqual(['0-0']);     // woods in the way
    expect(reasons(wooded, 0, [f('0-0', 2, 0)])).toEqual([]);
    expect(reasons(state, 0, [f('0-0', 20, 1)])).toEqual(['0-0']);     // off the map
  });
  it('indirect fire: range and any friendly eye on the hex, not the mortar\'s own line', () => {
    const blind = game(field(14, 1, { '2,0': 'w' }), [u('0-0', 'mortar', 0), u('0-1', 'rifleman', 5), u('1-0', 'rifleman', 13)]);
    const f = (q: number): Order => ({ unit: '0-0', kind: 'fire', target: h(q) });
    expect(reasons(blind, 0, [f(8)])).toEqual([]);          // behind the woods from the mortar, seen by the rifleman
    expect(reasons(blind, 0, [f(2)])).toEqual(['0-0']);     // under minRange 3
    expect(reasons(blind, 0, [f(11)])).toEqual(['0-0']);    // 11 > range 10
    expect(reasons(blind, 0, [f(12)])).toEqual(['0-0']);
    const alone = game(field(14, 1, { '2,0': 'w' }), [u('0-0', 'mortar', 0), u('1-0', 'rifleman', 13)]);
    expect(reasons(alone, 0, [f(8)])).toEqual(['0-0']);     // no one sees it
  });
  it('treat: next to the medic, on a friendly unit that is not down', () => {
    const t = (q: number, r: number): Order => ({ unit: '0-2', kind: 'special', target: h(q, r) });
    expect(reasons(state, 0, [t(1, 0)])).toEqual([]);          // pinned friend
    expect(reasons(state, 0, [t(0, 1)])).toEqual([]);          // ready friend: legal, does nothing
    expect(reasons(state, 0, [t(1, 1)])).toEqual(['0-2']);     // two away
    expect(reasons(state, 0, [t(-1, 1)])).toEqual(['0-2']);    // empty, off the map
    expect(reasons(state, 0, [t(0, 0)])).toEqual(['0-2']);     // itself
    const s2 = game(field(4, 1), [u('0-0', 'medic', 0), u('0-1', 'rifleman', 1, 0, { status: 'down' }), u('1-0', 'rifleman', 1)]);
    expect(reasons(s2, 0, [{ unit: '0-0', kind: 'special', target: h(1) }])).toEqual(['0-0']);   // a down friend and an enemy
  });
  it('never throws on rubbish, and reports each bad order', () => {
    const junk = [null, 7, 'x', {}, { unit: '0-0' }, { unit: '0-0', kind: 'fly' }, { unit: '0-0', kind: 'move' },
      { unit: '0-0', kind: 'move', path: [null] }, { unit: '0-0', kind: 'move', path: [{ q: 0.5, r: 1 }] },
      { unit: '0-0', kind: 'fire' }, { unit: '0-0', kind: 'fire', target: { q: '1', r: 1 } }, { unit: 5, kind: 'ambush' }] as unknown as Order[];
    expect(validateOrders(state, 0, junk).length).toBe(junk.length);
    expect(validateOrders(state, 0, 'nope' as unknown as Order[]).length).toBe(1);
  });
  it('refuses every order once the match is over', () => {
    expect(reasons({ ...state, over: true }, 0, [{ unit: '0-0', kind: 'ambush' }])).toEqual(['0-0']);
  });
});

describe('findPath', () => {
  const map = field(6, 4, { '2,1': 'x', '2,2': 'x', '2,0': 'x' });
  it('returns the shortest path without the start hex', () => {
    const p = findPath(field(6, 1), h(0), h(3), 5);
    expect(p).toEqual([h(1), h(2), h(3)]);
    expect(findPath(field(6, 1), h(3), h(3), 2)).toEqual([]);
  });
  it('goes round impassable ground', () => {
    const p = findPath(map, h(1, 1), h(3, 1), 10)!;
    expect(p.length).toBe(5);
    let prev = h(1, 1);
    for (const x of p) {
      expect(distance(prev, x)).toBe(1);
      expect(map.cells[key(x)].terrain).toBe('open');
      prev = x;
    }
    expect(p[p.length - 1]).toEqual(h(3, 1));
  });
  it('returns null when out of steps, off the map, or impassable', () => {
    expect(findPath(map, h(1, 1), h(3, 1), 4)).toBeNull();
    expect(findPath(map, h(1, 1), h(9, 9), 30)).toBeNull();
    expect(findPath(map, h(1, 1), h(2, 1), 30)).toBeNull();
    expect(findPath(field(6, 1), h(0), h(3), 2)).toBeNull();
  });
  it('breaks ties the same way every time', () => {
    const open = field(8, 8);
    const a = findPath(open, h(1, 5), h(5, 1), 9);
    expect(a).toEqual(findPath(open, h(1, 5), h(5, 1), 9));
    expect(a!.length).toBe(4);
    expect(findPath(open, h(2, 2), h(3, 4), 9)).toEqual(findPath(open, h(2, 2), h(3, 4), 5));
  });
});

describe('orderOptions', () => {
  const map = mapFor(4);
  const state = createMatch(map, [0, 1, 2, 3].map((player) => ({ player, units: PRESETS[player % PRESETS.length].units })));
  // Bring the squads into contact so there is something to see and treat.
  state.units.find((x) => x.id === '1-0')!.pos = { q: 3, r: 4 };
  state.units.find((x) => x.id === '0-1')!.status = 'pinned';
  state.units.find((x) => x.id === '1-1')!.status = 'down';

  it('lists exactly what validateOrders accepts, for every unit of both seats', () => {
    for (const player of [0, 1]) {
      const view = viewFor(state, player);
      for (const unit of state.units.filter((x) => x.owner === player)) {
        const def = UNITS[unit.type];
        const opts = orderOptions(view, unit.id);
        if (unit.status === 'down') {
          expect(opts).toEqual({ kinds: [], move: [], dash: [], fire: [], special: [] });
          continue;
        }
        expect(opts.kinds).toEqual(def.orders);
        const ok = (o: Order) => validateOrders(state, player, [o]).length === 0;
        // every hex on the board, tried as a fire and a special target
        const fire: string[] = [];
        const special: string[] = [];
        for (const k of Object.keys(map.cells)) {
          if (ok({ unit: unit.id, kind: 'fire', target: parseKey(k) })) fire.push(k);
          if (ok({ unit: unit.id, kind: 'special', target: parseKey(k) })) special.push(k);
        }
        expect([...opts.fire].sort()).toEqual(fire.sort());
        expect([...opts.special].sort()).toEqual(special.sort());
        // every move and dash end hex has a legal path, and nothing further does
        for (const [kind, list, allowance] of [['move', opts.move, def.move], ['dash', opts.dash, def.move * 2]] as const) {
          if (!def.orders.includes(kind)) { expect(list).toEqual([]); continue; }
          expect(new Set(list).size).toBe(list.length);
          expect(list).not.toContain(key(unit.pos));
          for (const k of Object.keys(map.cells)) {
            const path = findPath(map, unit.pos, parseKey(k), allowance);
            const reachable = path !== null && path.length > 0;
            expect(list.includes(k)).toBe(reachable);
            if (reachable) expect(ok({ unit: unit.id, kind, path: path! })).toBe(true);
          }
        }
      }
    }
  });
  it('has something to offer: the medic can treat its neighbours, the rifleman can fire', () => {
    const view = viewFor(state, 0);
    const medic = state.units.find((x) => x.owner === 0 && x.type === 'medic')!;
    expect(orderOptions(view, medic.id).special.length).toBeGreaterThan(0);
    expect(orderOptions(view, '0-0').fire.length).toBeGreaterThan(10);
    expect(orderOptions(view, '0-0').move.length).toBeGreaterThan(3);
    expect(orderOptions(view, '0-0').dash.length).toBeGreaterThan(orderOptions(view, '0-0').move.length);
  });
  it('gives nothing for an enemy unit, an unknown unit, or a finished match', () => {
    const none = { kinds: [], move: [], dash: [], fire: [], special: [] };
    const view = viewFor(state, 0);
    expect(orderOptions(view, '1-0')).toEqual(none);
    expect(orderOptions(view, '9-9')).toEqual(none);
    expect(orderOptions({ ...view, over: true }, '0-0')).toEqual(none);
  });
});

describe('follow-ups: a move that ends in an action', () => {
  const map = field(12, 3, { '4,1': 'w' });
  const state = game(map, [
    u('0-0', 'rifleman', 0, 1), u('0-1', 'gunner', 0, 0), u('0-2', 'medic', 0, 2), u('0-3', 'mortar', 1, 0), u('0-4', 'sniper', 1, 2),
    u('1-0', 'rifleman', 11, 1),
  ]);
  const path = [h(1, 1), h(2, 1)];
  const why = (order: Order) => validateOrders(state, 0, [order]).map((e) => e.reason);
  it('is legal for a mobile action within range of the end of the path, whatever is seen or stands there', () => {
    expect(why({ unit: '0-0', kind: 'move', path, then: { kind: 'fire', target: h(6, 1) } })).toEqual([]);     // 4 from the end, behind woods
    expect(why({ unit: '0-0', kind: 'move', path, then: { kind: 'fire', target: h(3, 1) } })).toEqual([]);
    expect(why({ unit: '0-2', kind: 'move', path: [h(1, 2)], then: { kind: 'special', target: h(2, 2) } })).toEqual([]);   // nobody there now
  });
  it('range is measured from the end of the path, both ways', () => {
    expect(why({ unit: '0-0', kind: 'move', path, then: { kind: 'fire', target: h(7, 1) } })).toEqual(['follow-up target is out of range from the end of the path']);
    expect(why({ unit: '0-0', kind: 'move', path, then: { kind: 'fire', target: h(2, 1) } })).toEqual(['follow-up target is out of range from the end of the path']);
    expect(why({ unit: '0-0', kind: 'move', path, then: { kind: 'fire', target: h(4, 1) } })).toEqual([]);     // 4 from where he stands now would be fine too
    expect(why({ unit: '0-0', kind: 'move', path: [h(1, 1)], then: { kind: 'fire', target: h(5, 1) } })).toEqual([]);
    expect(why({ unit: '0-0', kind: 'move', path, then: { kind: 'fire', target: h(40, 1) } })).toEqual(['follow-up target is off the map']);
  });
  it('only a move takes one, only for a kind the unit has, only with a mobile action', () => {
    expect(why({ unit: '0-0', kind: 'dash', path, then: { kind: 'fire', target: h(3, 1) } } as unknown as Order)).toEqual(['a dash takes no follow-up']);
    expect(why({ unit: '0-1', kind: 'move', path: [h(1, 0)], then: { kind: 'fire', target: h(3, 0) } })).toEqual(['this unit cannot fire after a move']);
    expect(why({ unit: '0-3', kind: 'move', path: [h(2, 0)], then: { kind: 'fire', target: h(8, 0) } })).toEqual(['this unit cannot fire after a move']);
    expect(why({ unit: '0-4', kind: 'move', path: [h(2, 2)], then: { kind: 'fire', target: h(6, 2) } })).toEqual(['this unit cannot fire after a move']);
    expect(why({ unit: '0-0', kind: 'move', path, then: { kind: 'special', target: h(3, 1) } })).toEqual(['this unit cannot be ordered to special']);
    expect(why({ unit: '0-2', kind: 'move', path: [h(1, 2)], then: { kind: 'fire', target: h(2, 2) } })).toEqual(['this unit cannot be ordered to fire']);
  });
  it('never throws on a rubbish follow-up', () => {
    for (const junk of [null, 7, 'fire', {}, { kind: 'ambush' }, { kind: 'fire' }, { kind: 'fire', target: { q: 'a', r: 1 } }, { kind: 'move', path }]) {
      expect(why({ unit: '0-0', kind: 'move', path, then: junk } as unknown as Order).length, JSON.stringify(junk)).toBe(1);
    }
    expect(why({ unit: '0-0', kind: 'move', path, then: undefined })).toEqual([]);
  });
  it('followUpOptions lists exactly the targets validateOrders accepts from that end', () => {
    const view = viewFor(state, 0);
    for (const unit of state.units.filter((x) => x.owner === 0)) {
      const end = h(unit.pos.q + 1, unit.pos.r);
      const opts = followUpOptions(view, unit.id, end);
      for (const kind of ['fire', 'special'] as const) {
        const accepted = Object.keys(map.cells).filter((k) =>
          validateOrders(state, 0, [{ unit: unit.id, kind: 'move', path: [end], then: { kind, target: parseKey(k) } }]).length === 0);
        expect([...opts[kind]].sort(), `${unit.id} ${kind}`).toEqual(accepted.sort());
      }
    }
    expect(followUpOptions(view, '0-0', h(1, 1)).fire.length).toBeGreaterThan(10);
    expect(followUpOptions(view, '0-2', h(1, 2)).special.length).toBeGreaterThan(2);
    expect(followUpOptions(view, '0-1', h(1, 0))).toEqual({ fire: [], special: [] });
    expect(followUpOptions(view, '1-0', h(10, 1))).toEqual({ fire: [], special: [] });      // not the viewer's unit
    expect(followUpOptions(view, 'nobody', h(1, 1))).toEqual({ fire: [], special: [] });
  });
});
