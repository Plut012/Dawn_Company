// Works (25): an engineer's build, what a work does as ground, and every reason a build does not happen.

import { describe, expect, it } from 'vitest';
import { MAPS, WORKS } from '../content';
import { key } from '../shared/hex';
import type { GameEvent, GameMap, GameState, Hex, Objective, Order, Unit, UnitId, UnitTypeId } from '../shared/types';
import { canSee, createMatch, findPath, orderOptions, resolve, validateOrders, viewFor, visibleEnemies } from './index';

/** Open, level ground, `cols` by `rows`; `spec` overrides a hex's terrain by "q,r". */
function field(cols: number, rows: number, spec: Record<string, string> = {}, objectives: Objective[] = []): GameMap {
  const cells: GameMap['cells'] = {};
  for (let q = 0; q < cols; q++) for (let r = 0; r < rows; r++) cells[`${q},${r}`] = { terrain: spec[`${q},${r}`] ?? 'open', elevation: 0 };
  return { id: 'field', name: 'Field', cols, rows, cells, objectives, spawns: [], seatSpawns: {}, maxRounds: 9 };
}
const h = (q: number, r = 0): Hex => ({ q, r });
function u(id: UnitId, type: UnitTypeId, at: Hex, extra: Partial<Unit> = {}): Unit {
  return { id, owner: Number(id.split('-')[0]), type, name: id, pos: at, status: 'ready', pinnedRound: null, revealed: false, posture: 'still', returnRound: null, dugIn: false, ...extra };
}
function game(map: GameMap, units: Unit[], extra: Partial<GameState> = {}): GameState {
  return {
    map, playerCount: 2, units, round: 7, scores: [20, 20], eliminated: [false, false],
    flags: Object.fromEntries(map.objectives.map((o) => [o.id, null])), mode: 'supply-line', works: {}, over: false, winners: [], ...extra,
  };
}
const build = (unit: UnitId, at: Hex, work: string): Order => ({ unit, kind: 'special', target: at, work });
const of = <T extends GameEvent['t']>(events: GameEvent[], t: T) => events.filter((e): e is Extract<GameEvent, { t: T }> => e.t === t);
/** One round with these orders for player 0, nothing for player 1. */
const round = (s: GameState, mine: Order[], theirs: Order[] = []) => resolve(s, [mine, theirs]);

describe('building a work', () => {
  it('puts the work up in the score phase, first: the cost leaves supply, the hex becomes the work, a build event', () => {
    const map = field(8, 2);
    const s = game(map, [u('0-0', 'engineer', h(1)), u('1-0', 'rifleman', h(7, 1))]);
    const r = round(s, [build('0-0', h(2), 'sandbags')]);
    expect(of(r.events, 'build')).toEqual([{ t: 'build', unit: '0-0', at: h(2), work: 'sandbags' }]);
    expect(r.state.scores).toEqual([20 - WORKS.sandbags.cost, 20]);
    expect(r.state.works).toEqual({ [key(h(2))]: 'sandbags' });
    expect(r.state.map.cells[key(h(2))]).toEqual({ terrain: 'sandbags', elevation: 0 });
    // The first thing in the score phase.
    const score = r.events.findIndex((e) => e.t === 'phase' && e.phase === 'score');
    expect(r.events[score + 1]).toMatchObject({ t: 'build' });
    // The input is never changed: the old state and its map are as they were.
    expect(s.works).toEqual({});
    expect(s.map.cells[key(h(2))].terrain).toBe('open');
    expect(r.state.map).not.toBe(s.map);
  });

  it('builds on his own hex (range 0) and on a neighbour, never two away', () => {
    const map = field(8, 2);
    const s = game(map, [u('0-0', 'engineer', h(1)), u('1-0', 'rifleman', h(7, 1))]);
    expect(validateOrders(s, 0, [build('0-0', h(1), 'nest')])).toEqual([]);
    expect(validateOrders(s, 0, [build('0-0', h(3), 'nest')])).toEqual([{ unit: '0-0', reason: 'target is out of range' }]);
    expect(orderOptions(viewFor(s, 0), '0-0').special.sort()).toEqual(['0,0', '0,1', '1,0', '1,1', '2,0'].sort());
  });

  it('never touches MAPS: a match on a real map changes its own copy', () => {
    const map = MAPS.ford;
    const before = JSON.stringify(map.cells);
    let s = createMatch(map, [{ player: 0, units: ['engineer', 'rifleman', 'rifleman', 'rifleman'] }, { player: 1, units: ['rifleman', 'rifleman', 'rifleman', 'rifleman'] }]);
    s = { ...s, scores: [30, 0] };
    const eng = s.units.find((x) => x.type === 'engineer')!;
    const target = viewFor(s, 0) && orderOptions(viewFor(s, 0), eng.id).special.map((k) => ({ q: Number(k.split(',')[0]), r: Number(k.split(',')[1]) }))
      .find((x) => key(x) !== key(eng.pos) && !s.units.some((y) => key(y.pos) === key(x)))!;
    const r = resolve(s, [[build(eng.id, target, 'wire')], []]);
    expect(of(r.events, 'build')).toHaveLength(1);
    expect(r.state.map.cells[key(target)].terrain).toBe('wire');
    expect(JSON.stringify(MAPS.ford.cells)).toBe(before);
    expect(s.map).toBe(MAPS.ford);
    // The next round carries the work on.
    const r2 = resolve(r.state, [[], []]);
    expect(r2.state.map.cells[key(target)].terrain).toBe('wire');
    expect(r2.state.works).toEqual(r.state.works);
  });

  it('may be a move\'s follow-up: built from where the move ends, at the round\'s end', () => {
    const map = field(8, 2);
    const s = game(map, [u('0-0', 'engineer', h(1)), u('1-0', 'rifleman', h(7, 1))]);
    const order: Order = { unit: '0-0', kind: 'move', path: [h(2), h(3)], then: { kind: 'special', target: h(4), work: 'sandbags' } };
    expect(validateOrders(s, 0, [order])).toEqual([]);
    const r = round(s, [order]);
    expect(of(r.events, 'build')).toEqual([{ t: 'build', unit: '0-0', at: h(4), work: 'sandbags' }]);
    // Judged in the assault phase (nothing to say there), built in the score phase.
    const assault = r.events.findIndex((e) => e.t === 'phase' && e.phase === 'assault');
    const score = r.events.findIndex((e) => e.t === 'phase' && e.phase === 'score');
    const at = r.events.findIndex((e) => e.t === 'build');
    expect(at).toBeGreaterThan(score);
    expect(assault).toBeLessThan(score);
  });

  it('two engineers, in id order: the second finds the hex taken and is blocked', () => {
    const map = field(8, 2);
    const s = game(map, [u('0-0', 'engineer', h(1)), u('0-1', 'engineer', h(3)), u('1-0', 'rifleman', h(7, 1))]);
    const r = round(s, [build('0-0', h(2), 'sandbags'), build('0-1', h(2), 'nest')]);
    expect(of(r.events, 'build')).toHaveLength(1);
    expect(of(r.events, 'unable')).toEqual([{ t: 'unable', unit: '0-1', action: 'build', reason: 'blocked' }]);
    expect(r.state.works[key(h(2))]).toBe('sandbags');
    expect(r.state.scores[0]).toBe(20 - WORKS.sandbags.cost);
  });

  it('is told to its owner and to whoever sees the hex; viewFor carries the works and the changed cells', () => {
    const map = field(10, 1);
    const s = game(map, [u('0-0', 'engineer', h(1)), u('1-0', 'rifleman', h(9))], { round: 1 });   // first light: sight 3
    const r = round(s, [build('0-0', h(2), 'sandbags')]);
    expect(of(r.playerEvents[0], 'build')).toHaveLength(1);
    expect(of(r.playerEvents[1], 'build')).toHaveLength(0);   // h(2) is 7 off: out of his sight
    const near = game(map, [u('0-0', 'engineer', h(1)), u('1-0', 'rifleman', h(4))]);
    expect(of(round(near, [build('0-0', h(2), 'sandbags')]).playerEvents[1], 'build')).toHaveLength(1);
    const v = viewFor(r.state, 1);
    expect(v.works).toEqual({ [key(h(2))]: 'sandbags' });
    expect(v.map.cells[key(h(2))].terrain).toBe('sandbags');
  });
});

describe('what a work does as ground', () => {
  /** A state with this work already built at h(4), by an engineer at h(3). */
  function withWork(work: string, units: Unit[], cols = 9, rows = 2): GameState {
    const s = game(field(cols, rows), [u('0-0', 'engineer', h(3)), ...units]);
    const r = round(s, [build('0-0', h(4), work)]);
    expect(of(r.events, 'build')).toHaveLength(1);
    return { ...r.state, round: 7, scores: [20, 20], units: r.state.units.map((x) => ({ ...x, dugIn: false })) };
  }

  it('sandbags: cover, like a wall; they hide nobody and block no line', () => {
    const s = withWork('sandbags', [u('1-0', 'rifleman', h(4)), u('0-1', 'rifleman', h(1)), u('0-2', 'rifleman', h(1, 1))]);
    expect(canSee(s.map, h(1), h(8))).toBe(true);
    expect(visibleEnemies(s, 0).map((x) => x.id)).toEqual(['1-0']);
    const r = round(s, [{ unit: '0-1', kind: 'fire', target: h(4) }, { unit: '0-2', kind: 'fire', target: h(4) }]);
    expect(of(r.events, 'hit').map((e) => e.result)).toEqual(['cover', 'pinned']);
  });

  it('wire: nobody crosses it, a path round it is found, no cover, no line blocked', () => {
    const s = withWork('wire', [u('0-1', 'rifleman', h(5)), u('1-0', 'rifleman', h(8, 1))]);
    expect(validateOrders(s, 0, [{ unit: '0-1', kind: 'move', path: [h(4)] }])).toEqual([{ unit: '0-1', reason: 'path crosses impassable ground' }]);
    expect(findPath(s.map, h(5), h(3), 4)?.some((x) => key(x) === key(h(4)))).toBe(false);
    expect(orderOptions(viewFor(s, 0), '0-1').move).not.toContain(key(h(4)));
    expect(canSee(s.map, h(3), h(6))).toBe(true);
  });

  it('an MG nest: cover, and hides a man who keeps still like a building, but blocks no line', () => {
    const s = withWork('nest', [u('1-0', 'gunner', h(4)), u('0-1', 'rifleman', h(1)), u('0-2', 'rifleman', h(2, 1))]);
    expect(canSee(s.map, h(1), h(8))).toBe(true);
    // Still in the nest: seen only from 1 hex. 0-0 stands next to him; 0-1 at 3 off does not see him on its own.
    expect(visibleEnemies(s, 0).map((x) => x.id)).toEqual(['1-0']);
    const far = { ...s, units: s.units.filter((x) => x.id !== '0-0') };
    expect(visibleEnemies(far, 0)).toEqual([]);
    // Walked in: seen, as in a building.
    const walked = { ...far, units: far.units.map((x) => (x.id === '1-0' ? { ...x, posture: 'moved' as const } : x)) };
    expect(visibleEnemies(walked, 0).map((x) => x.id)).toEqual(['1-0']);
    const r = round(s, [{ unit: '0-1', kind: 'fire', target: h(4) }, { unit: '0-2', kind: 'fire', target: h(4) }]);
    expect(of(r.events, 'hit').map((e) => e.result)).toEqual(['cover', 'pinned']);
  });
});

describe('a build that does not happen', () => {
  const map = field(8, 2, { '1,1': 'water' }, [{ id: 'A', kind: 'village', hexes: [h(0, 1)], value: 2, zone: null }]);
  const base = () => game(map, [u('0-0', 'engineer', h(1)), u('0-1', 'rifleman', h(2)), u('1-0', 'rifleman', h(7, 1))]);

  it('is refused when ordered: no work named, an unknown work, water, an objective, off the map, a work already there', () => {
    const s = base();
    const why = (o: Order) => validateOrders(s, 0, [o]).map((e) => e.reason);
    expect(why({ unit: '0-0', kind: 'special', target: h(1) })).toEqual(['a build must name a work']);
    expect(why(build('0-0', h(1), 'trench'))).toEqual(['no such work']);
    expect(why(build('0-0', h(1, 1), 'sandbags'))).toEqual(['nothing can be built there']);
    expect(why(build('0-0', h(0, 1), 'sandbags'))).toEqual(['nothing can be built in an objective']);
    expect(why(build('0-0', h(1, -1), 'sandbags'))).toEqual(['target is off the map']);
    const done = round(s, [build('0-0', h(1), 'sandbags')]).state;
    expect(validateOrders(done, 0, [build('0-0', h(1), 'nest')]).map((e) => e.reason)).toEqual(['there is a work there already']);
    expect(orderOptions(viewFor(done, 0), '0-0').special).not.toContain(key(h(1)));
    // A follow-up is held to the same.
    expect(validateOrders(s, 0, [{ unit: '0-0', kind: 'move', path: [h(0)], then: { kind: 'special', target: h(0, 1) } }]).map((e) => e.reason))
      .toEqual(['a build must name a work']);
    // And so is the order, when the round resolves: an illegal one is not run at all.
    expect(of(round(s, [build('0-0', h(0, 1), 'sandbags')]).events, 'unable')).toEqual([]);
  });

  it('supply: not enough when it lands, checked before the round\'s income; nothing paid', () => {
    const s = { ...base(), scores: [WORKS.nest.cost - 1, 0], flags: { A: 0 } };
    const r = round(s, [build('0-0', h(1), 'nest')]);
    expect(of(r.events, 'unable')).toEqual([{ t: 'unable', unit: '0-0', action: 'build', reason: 'supply' }]);
    expect(r.state.works).toEqual({});
    expect(r.state.scores[0]).toBe(WORKS.nest.cost - 1 + 3);   // the village's 2 + 1 came after
    // Exactly enough is enough.
    const just = round({ ...s, scores: [WORKS.nest.cost, 0] }, [build('0-0', h(1), 'nest')]);
    expect(of(just.events, 'build')).toHaveLength(1);
    expect(just.state.scores[0]).toBe(3);
  });

  it('supply: in a mode without supply nothing can be built', () => {
    const s = { ...base(), mode: 'last-stand', scores: [99, 99] };
    expect(of(round(s, [build('0-0', h(1), 'sandbags')]).events, 'unable')).toEqual([{ t: 'unable', unit: '0-0', action: 'build', reason: 'supply' }]);
  });

  it('blocked: wire where a man stands when it lands, his own engineer included', () => {
    const s = base();
    expect(validateOrders(s, 0, [build('0-0', h(2), 'wire')])).toEqual([]);   // who stands there is judged when it lands
    expect(of(round(s, [build('0-0', h(2), 'wire')]).events, 'unable')).toEqual([{ t: 'unable', unit: '0-0', action: 'build', reason: 'blocked' }]);
    expect(of(round(s, [build('0-0', h(1), 'wire')]).events, 'unable')).toEqual([{ t: 'unable', unit: '0-0', action: 'build', reason: 'blocked' }]);
    // The man walked off: then it goes up.
    const off = round(s, [build('0-0', h(2), 'wire'), { unit: '0-1', kind: 'move', path: [h(3)] }]);
    expect(of(off.events, 'build')).toHaveLength(1);
    // Sandbags may go where a man stands.
    expect(of(round(s, [build('0-0', h(2), 'sandbags')]).events, 'build')).toHaveLength(1);
  });

  it('pinned or down: the engineer must be on his feet when it lands', () => {
    const s = game(map, [u('0-0', 'engineer', h(1)), u('1-0', 'rifleman', h(4)), u('1-1', 'rifleman', h(4, 1))]);
    const pinned = round(s, [build('0-0', h(2), 'sandbags')], [{ unit: '1-0', kind: 'fire', target: h(1) }]);
    expect(of(pinned.events, 'unable')).toEqual([{ t: 'unable', unit: '0-0', action: 'build', reason: 'pinned' }]);
    const down = round(s, [build('0-0', h(2), 'sandbags')], [{ unit: '1-0', kind: 'fire', target: h(1) }, { unit: '1-1', kind: 'fire', target: h(1) }]);
    expect(of(down.events, 'unable')).toEqual([{ t: 'unable', unit: '0-0', action: 'build', reason: 'down' }]);
    expect(down.state.scores[0]).toBe(20);
  });

  it('range: a follow-up from a move cut short', () => {
    const s = game(map, [u('0-0', 'engineer', h(1)), u('1-0', 'rifleman', h(3, 1))]);
    // He means to reach h(3) and build at h(4); the enemy at h(3, 1) wants h(3) too, so both stop.
    const r = round(s, [{ unit: '0-0', kind: 'move', path: [h(2), h(3)], then: { kind: 'special', target: h(4), work: 'sandbags' } }],
      [{ unit: '1-0', kind: 'move', path: [h(3)] }]);
    expect(of(r.events, 'unable')).toEqual([{ t: 'unable', unit: '0-0', action: 'build', reason: 'range' }]);
    expect(r.state.works).toEqual({});
  });
});
