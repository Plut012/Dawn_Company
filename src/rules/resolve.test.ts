import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP, MAPS, NAMES, PRESETS, UNITS } from '../content';
import { distance } from '../shared/hex';
import type { GameEvent, GameMap, GameState, Hex, Order, Unit, UnitId, UnitTypeId } from '../shared/types';
import { canSee, createMatch, resolve, viewFor } from './index';

// ---- hand-built boards: a parallelogram of open, level ground; `spec` overrides hexes by "q,r".
function field(cols: number, rows: number, spec: Record<string, string> = {}, extra: Partial<GameMap> = {}): GameMap {
  const cells: GameMap['cells'] = {};
  for (let q = 0; q < cols; q++) {
    for (let r = 0; r < rows; r++) {
      const s = spec[`${q},${r}`] ?? '';
      const terrain = s.startsWith('w') ? 'woods' : s.startsWith('b') ? 'building' : s.startsWith('=') ? 'wall' : s.startsWith('c') ? 'crops' : 'open';
      cells[`${q},${r}`] = { terrain, elevation: Number(s.replace(/^[wb=c]/, '') || 0) };
    }
  }
  return { id: 'field', name: 'Field', cols, rows, cells, objectives: [], spawns: [], seatSpawns: {}, maxRounds: 9, ...extra };
}
const h = (q: number, r = 0): Hex => ({ q, r });

function u(id: UnitId, type: UnitTypeId, q: number, r = 0, extra: Partial<Unit> = {}): Unit {
  return { id, owner: Number(id.split('-')[0]), type, name: id, pos: h(q, r), status: 'ready', pinnedRound: null, revealed: false, posture: 'still', ...extra };
}
function game(map: GameMap, units: Unit[], extra: Partial<GameState> = {}): GameState {
  const playerCount = extra.playerCount ?? 2;
  return {
    map, playerCount, units, round: 3,
    scores: Array(playerCount).fill(0), eliminated: Array(playerCount).fill(false), over: false, winners: [], ...extra,
  };
}
/** Resolve a flat list of orders, sorted into seats by the unit's owner. */
function run(state: GameState, orders: Order[]) {
  const bySeat: Order[][] = Array.from({ length: state.playerCount }, () => []);
  for (const o of orders) bySeat[Number(o.unit.split('-')[0])].push(o);
  return resolve(state, bySeat);
}
const fire = (unit: UnitId, q: number, r = 0): Order => ({ unit, kind: 'fire', target: h(q, r) });
const move = (unit: UnitId, ...path: Hex[]): Order => ({ unit, kind: 'move', path });
const dash = (unit: UnitId, ...path: Hex[]): Order => ({ unit, kind: 'dash', path });
const ambush = (unit: UnitId): Order => ({ unit, kind: 'ambush' });
const treat = (unit: UnitId, q: number, r = 0): Order => ({ unit, kind: 'special', target: h(q, r) });

const unitIn = (s: GameState, id: UnitId) => s.units.find((x) => x.id === id)!;
const hits = (events: GameEvent[]) =>
  events.flatMap((e) => (e.t === 'hit' ? [`${e.unit} ${e.result}`] : []));
const ofType = <T extends GameEvent['t']>(events: GameEvent[], t: T) =>
  events.filter((e): e is Extract<GameEvent, { t: T }> => e.t === t);

describe('createMatch', () => {
  const map = MAPS[DEFAULT_MAP];
  it('puts each seat on its spawn zone in squad order, round 1, nothing scored', () => {
    const s = createMatch(map, [
      { player: 0, units: PRESETS[0].units },
      { player: 1, units: PRESETS[1].units },
    ]);
    expect(s.round).toBe(1);
    expect(s.playerCount).toBe(2);
    expect(s.scores).toEqual([0, 0]);
    expect(s.eliminated).toEqual([false, false]);
    expect(s.over).toBe(false);
    expect(s.winners).toEqual([]);
    expect(s.units.length).toBe(PRESETS[0].units.length + PRESETS[1].units.length);
    for (const seat of [0, 1]) {
      const zone = map.spawns[map.seatSpawns[2][seat]];
      const mine = s.units.filter((x) => x.owner === seat);
      mine.forEach((x, i) => {
        expect(x.id).toBe(`${seat}-${i}`);
        expect(x.type).toBe(PRESETS[seat].units[i]);
        expect(x.pos).toEqual(zone[i]);
        expect(x.status).toBe('ready');
        expect(x.pinnedRound).toBeNull();
        expect(x.revealed).toBe(false);
        expect(x.name.startsWith(`${UNITS[x.type].rank} `)).toBe(true);
        expect(NAMES).toContain(x.name.slice(UNITS[x.type].rank.length + 1));
      });
    }
  });
  it('gives every unit a different name, even with four full squads', () => {
    const scouts = PRESETS.find((p) => p.units.length === 8)!.units;
    const s = createMatch(map, [0, 1, 2, 3].map((player) => ({ player, units: scouts })));
    const surnames = s.units.map((x) => x.name.split(' ').pop());
    expect(s.units.length).toBe(32);
    expect(new Set(surnames).size).toBe(32);
    expect(new Set(s.units.map((x) => `${x.pos.q},${x.pos.r}`)).size).toBe(32);
    for (const x of s.units) expect(x.pos).toEqual(map.spawns[map.seatSpawns[4][x.owner]][Number(x.id.split('-')[1])]);
  });
  it('is the same every time and takes squads in any order', () => {
    const a = createMatch(map, [{ player: 0, units: PRESETS[0].units }, { player: 1, units: PRESETS[2].units }]);
    const b = createMatch(map, [{ player: 1, units: PRESETS[2].units }, { player: 0, units: PRESETS[0].units }]);
    expect(b).toEqual(a);
  });
});

describe('hits', () => {
  it('pins a ready unit in the open', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 3)]), [fire('0-0', 3)]);
    expect(hits(r.events)).toEqual(['1-0 pinned']);
    expect(unitIn(r.state, '1-0').status).toBe('pinned');
    expect(unitIn(r.state, '1-0').pinnedRound).toBe(3);
  });
  it('downs a unit that is already pinned', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 3, 0, { status: 'pinned', pinnedRound: 3 })]), [fire('0-0', 3)]);
    expect(hits(r.events)).toEqual(['1-0 down']);
    expect(unitIn(r.state, '1-0').status).toBe('down');
  });
  it('does nothing to a unit that is down, or to an empty hex', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 3, 0, { status: 'down' }), u('1-1', 'rifleman', 7)]), [fire('0-0', 3)]);
    expect(ofType(r.events, 'fire').length).toBe(1);
    expect(hits(r.events)).toEqual([]);
  });
  it('two rifles down a unit in the open in one phase', () => {
    const r = run(game(field(8, 2), [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 0, 1), u('1-0', 'rifleman', 3)]), [fire('0-0', 3), fire('0-1', 3)]);
    expect(hits(r.events)).toEqual(['1-0 pinned', '1-0 down']);
    expect(unitIn(r.state, '1-0').status).toBe('down');
  });
  it('cover absorbs one hit a round, and only one', () => {
    const map = field(8, 3, { '3,1': 'b' });
    const squad = [u('0-0', 'rifleman', 0, 1), u('0-1', 'rifleman', 1, 0), u('0-2', 'rifleman', 1, 2)];
    const target = u('1-0', 'rifleman', 3, 1);
    const one = run(game(map, [...squad, target]), [fire('0-0', 3, 1)]);
    expect(hits(one.events)).toEqual(['1-0 cover']);
    expect(unitIn(one.state, '1-0').status).toBe('ready');
    const two = run(game(map, [...squad, target]), [fire('0-0', 3, 1), fire('0-1', 3, 1)]);
    expect(hits(two.events)).toEqual(['1-0 cover', '1-0 pinned']);
    const three = run(game(map, [...squad, target]), [fire('0-0', 3, 1), fire('0-1', 3, 1), fire('0-2', 3, 1)]);
    expect(hits(three.events)).toEqual(['1-0 cover', '1-0 pinned', '1-0 down']);
    // The cover is back the next round.
    const again = run(one.state, [fire('0-0', 3, 1)]);
    expect(hits(again.events)).toEqual(['1-0 cover']);
  });
  it('a low wall is cover too, and woods and crops are not', () => {
    const shot = (ground: string) => hits(run(game(field(8, 1, { '3,0': ground }), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 3)]), [fire('0-0', 3)]).events);
    expect(shot('=')).toEqual(['1-0 cover']);
    expect(shot('w')).toEqual(['1-0 pinned']);
    expect(shot('c')).toEqual(['1-0 pinned']);
  });
  it('a sniper ignores cover and does not use it up', () => {
    const map = field(8, 2, { '4,0': 'b' });
    const r = run(game(map, [u('0-0', 'sniper', 0), u('0-1', 'rifleman', 1, 0), u('1-0', 'rifleman', 4)]), [fire('0-0', 4), fire('0-1', 4)]);
    expect(hits(r.events)).toEqual(['1-0 pinned', '1-0 cover']);
    expect(unitIn(r.state, '1-0').status).toBe('pinned');
  });
  it('a dashing unit goes down from one hit and never moves', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 3)]), [fire('0-0', 3), dash('1-0', h(4), h(5), h(6))]);
    expect(hits(r.events)).toEqual(['1-0 down']);
    expect(ofType(r.events, 'move')).toEqual([]);
    expect(unitIn(r.state, '1-0').pos).toEqual(h(3));
  });
  it('a dashing unit has no cover', () => {
    const r = run(game(field(8, 1, { '3,0': 'b' }), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 3)]), [fire('0-0', 3), dash('1-0', h(4), h(5))]);
    expect(hits(r.events)).toEqual(['1-0 down']);
  });
  it('a pinned unit with a dash order is not dashing: cover still counts', () => {
    const start = game(field(8, 1, { '3,0': 'b' }), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 3, 0, { status: 'pinned', pinnedRound: 3 })]);
    const r = run(start, [fire('0-0', 3), dash('1-0', h(4), h(5))]);
    expect(hits(r.events)).toEqual(['1-0 cover']);
    expect(ofType(r.events, 'move')).toEqual([]);
  });
  it('a hit unit still fires in phase 1 but does not move', () => {
    const map = field(8, 1);
    const both = run(game(map, [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 3)]), [fire('0-0', 3), fire('1-0', 0)]);
    expect(ofType(both.events, 'fire').map((e) => e.unit)).toEqual(['0-0', '1-0']);
    expect(hits(both.events)).toEqual(['1-0 pinned', '0-0 pinned']);
    const mover = run(game(map, [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 3)]), [fire('0-0', 3), move('1-0', h(4), h(5))]);
    expect(hits(mover.events)).toEqual(['1-0 pinned']);
    expect(ofType(mover.events, 'move')).toEqual([]);
    expect(ofType(mover.events, 'blocked')).toEqual([]);
    expect(unitIn(mover.state, '1-0').pos).toEqual(h(3));
  });
  it('machine-gun blast hits everyone around the target, friends included, but not the gunner', () => {
    const r = run(game(field(8, 1), [u('0-0', 'gunner', 0), u('0-1', 'rifleman', 2), u('1-0', 'rifleman', 3), u('1-1', 'rifleman', 4), u('1-2', 'rifleman', 5)]), [fire('0-0', 3)]);
    expect(ofType(r.events, 'fire')[0]).toEqual({ t: 'fire', unit: '0-0', from: h(0), target: h(3), blast: 1, ambush: false, action: 'burst' });
    expect(hits(r.events)).toEqual(['0-1 pinned', '1-0 pinned', '1-1 pinned']);
    const close = run(game(field(8, 1), [u('0-0', 'gunner', 0), u('1-0', 'rifleman', 1)]), [fire('0-0', 1)]);
    expect(hits(close.events)).toEqual(['1-0 pinned']);
    expect(unitIn(close.state, '0-0').status).toBe('ready');
  });
  it('firing marks the shooter as revealed, and the flag is cleared at the start of the next round', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 7, 0, { revealed: true })]), [fire('0-0', 3)]);
    expect(unitIn(r.state, '0-0').revealed).toBe(true);
    expect(unitIn(r.state, '1-0').revealed).toBe(false);
    expect(unitIn(run(r.state, []).state, '0-0').revealed).toBe(false);
  });
});

describe('mortar', () => {
  const map = field(12, 1);
  const squad = () => [u('0-0', 'mortar', 0), u('0-1', 'rifleman', 4)];
  it('launches in phase 1, lands in the mortar phase on the hex and its neighbours', () => {
    const r = run(game(map, [...squad(), u('1-0', 'rifleman', 7), u('1-1', 'rifleman', 8), u('1-2', 'rifleman', 10)]), [fire('0-0', 8)]);
    const order = r.events.map((e) => (e.t === 'phase' ? e.phase : e.t));
    expect(order).toEqual(['treat', 'fire', 'launch', 'move', 'assault', 'mortar', 'impact', 'hit', 'hit', 'score']);
    expect(ofType(r.events, 'impact')[0]).toEqual({ t: 'impact', target: h(8), blast: 1, action: 'shell' });
    expect(hits(r.events)).toEqual(['1-0 pinned', '1-1 pinned']);
    expect(unitIn(r.state, '0-0').revealed).toBe(true);
  });
  it('misses a unit that moved away, and hits one that walked in', () => {
    const r = run(game(map, [...squad(), u('1-0', 'rifleman', 8), u('1-1', 'rifleman', 11)]), [
      fire('0-0', 8), move('1-0', h(7), h(6)), move('1-1', h(10), h(9)),
    ]);
    expect(hits(r.events)).toEqual(['1-1 pinned']);
    expect(unitIn(r.state, '1-0').status).toBe('ready');
  });
  it('still lands if the mortar is hit after launching', () => {
    const r = run(game(map, [...squad(), u('1-0', 'rifleman', 3), u('1-1', 'rifleman', 8)]), [fire('0-0', 8), fire('1-0', 0)]);
    expect(hits(r.events)).toEqual(['0-0 pinned', '1-1 pinned']);
  });
});

describe('ambush', () => {
  it('fires once, at the first enemy to move into range', () => {
    const r = run(game(field(10, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 6), u('1-1', 'rifleman', 7)]), [
      ambush('0-0'), move('1-0', h(5), h(4)), move('1-1', h(6), h(5)),
    ]);
    const shots = ofType(r.events, 'fire');
    expect(shots).toEqual([{ t: 'fire', unit: '0-0', from: h(0), target: h(4), blast: 0, ambush: true, action: 'rifle' }]);
    expect(hits(r.events)).toEqual(['1-0 pinned']);
    expect(unitIn(r.state, '0-0').revealed).toBe(true);
    // It comes after the step-2 moves.
    const i = r.events.indexOf(shots[0]);
    expect(r.events[i - 1]).toMatchObject({ t: 'move', step: 2 });
  });
  it('stops the unit it pins where it stands', () => {
    const r = run(game(field(10, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 5)]), [ambush('0-0'), move('1-0', h(4), h(3))]);
    expect(hits(r.events)).toEqual(['1-0 pinned']);
    expect(unitIn(r.state, '1-0').pos).toEqual(h(4));
    expect(ofType(r.events, 'move').length).toBe(1);
  });
  it('downs a dashing unit', () => {
    const r = run(game(field(10, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 6)]), [ambush('0-0'), dash('1-0', h(5), h(4), h(3), h(2))]);
    expect(hits(r.events)).toEqual(['1-0 down']);
    expect(unitIn(r.state, '1-0').pos).toEqual(h(4));
  });
  it('picks the nearest mover; ties go to the lowest unit id', () => {
    const map = field(8, 5);
    // Ambusher at (2,2). 1-1 ends next to it, 1-0 two away.
    const near = run(game(map, [u('0-0', 'rifleman', 2, 2), u('1-0', 'rifleman', 5, 2), u('1-1', 'rifleman', 2, 0)]), [
      ambush('0-0'), move('1-0', h(4, 2)), move('1-1', h(2, 1)),
    ]);
    expect(ofType(near.events, 'fire')[0].target).toEqual(h(2, 1));
    // Both end two away.
    const tie = run(game(map, [u('0-0', 'rifleman', 2, 2), u('1-0', 'rifleman', 5, 2), u('1-1', 'rifleman', 0, 2, { owner: 1 })]), [
      ambush('0-0'), move('1-0', h(4, 2)),
    ]);
    expect(ofType(tie.events, 'fire')[0].target).toEqual(h(4, 2));
    const tie2 = run(game(map, [u('0-0', 'rifleman', 2, 2), u('1-0', 'rifleman', 5, 2), u('1-1', 'rifleman', 2, 5 - 2 - 2)]), [
      ambush('0-0'), move('1-1', h(2, 0)), move('1-0', h(4, 2)),
    ]);
    // 1-1 moved to (2,0): two away, same as 1-0 at (4,2). Lowest id wins.
    expect(ofType(tie2.events, 'fire')[0].target).toEqual(h(4, 2));
  });
  it('ignores enemies that did not move, friends that did, and movers out of range or sight', () => {
    const map = field(10, 3, { '3,1': 'w' });
    const r = run(game(map, [u('0-0', 'rifleman', 0, 1), u('0-1', 'rifleman', 1, 0), u('1-0', 'rifleman', 2, 1), u('1-1', 'rifleman', 8, 1), u('1-2', 'rifleman', 5, 1)]), [
      ambush('0-0'), move('0-1', h(2, 0)), move('1-1', h(7, 1)), move('1-2', h(4, 1)),   // 1-2 ends behind the woods
    ]);
    expect(ofType(r.events, 'fire')).toEqual([]);
  });
  it('does not see a mover in woods beyond stealth range, but does up close', () => {
    const far = run(game(field(8, 1, { '3,0': 'w' }), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 4)]), [ambush('0-0'), move('1-0', h(3))]);
    expect(ofType(far.events, 'fire')).toEqual([]);
    const close = run(game(field(8, 1, { '2,0': 'w' }), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 3)]), [ambush('0-0'), move('1-0', h(2))]);
    expect(ofType(close.events, 'fire').length).toBe(1);
    expect(hits(close.events)).toEqual(['1-0 pinned']);
  });
  it('a sniper on ambush respects its minimum range', () => {
    const r = run(game(field(10, 1), [u('0-0', 'sniper', 0), u('1-0', 'rifleman', 2)]), [ambush('0-0'), move('1-0', h(1))]);
    expect(ofType(r.events, 'fire')).toEqual([]);
  });
  it('is lost when the ambusher is hit first', () => {
    const r = run(game(field(10, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 4), u('1-1', 'rifleman', 6)]), [
      ambush('0-0'), fire('1-0', 0), move('1-1', h(5), h(4 + 0)),
    ]);
    expect(ofType(r.events, 'fire').map((e) => e.unit)).toEqual(['1-0']);
  });
  it('two ambushers fire in the same step even if one pins the other; a machine gun on ambush keeps its blast', () => {
    const map = field(8, 1);
    const r = run(game(map, [u('0-0', 'gunner', 0), u('1-0', 'rifleman', 3), u('1-1', 'rifleman', 6), u('0-1', 'rifleman', 7)]), [
      ambush('0-0'), ambush('1-0'), move('1-1', h(5), h(4)), move('0-1', h(6)),
    ]);
    // Step 1: 0-1 moves to 6 (seen by 1-0, three away): 1-0 fires. 1-1 moves to 5: the gunner fires at 5, blast reaches 6.
    const shots = ofType(r.events, 'fire');
    expect(shots.map((e) => [e.unit, e.target.q, e.ambush, e.blast])).toEqual([['0-0', 5, true, 1], ['1-0', 6, true, 0]]);
    expect(hits(r.events)).toEqual(['0-1 pinned', '1-1 pinned', '0-1 down']);
  });
});

describe('movement', () => {
  it('moves one hex per step, all together', () => {
    const r = run(game(field(8, 2), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 7, 1)]), [move('0-0', h(1), h(2)), dash('1-0', h(6, 1), h(5, 1), h(4, 1), h(3, 1))]);
    expect(ofType(r.events, 'move').map((e) => `${e.step} ${e.unit} ${e.to.q}`)).toEqual([
      '1 0-0 1', '1 1-0 6', '2 0-0 2', '2 1-0 5', '3 1-0 4', '4 1-0 3',
    ]);
    expect(unitIn(r.state, '0-0').pos).toEqual(h(2));
    expect(unitIn(r.state, '1-0').pos).toEqual(h(3, 1));
  });
  it('two units stepping into the same hex both stop for the round', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 3)]), [move('0-0', h(1), h(2)), move('1-0', h(2), h(1))]);
    // Step 1 is free (1 and 2). Step 2: they would swap.
    expect(ofType(r.events, 'move').length).toBe(2);
    expect(ofType(r.events, 'blocked').map((e) => e.unit)).toEqual(['0-0', '1-0']);
    const s = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 2)]), [move('0-0', h(1), h(2)), move('1-0', h(1), h(0))]);
    expect(ofType(s.events, 'move')).toEqual([]);
    expect(ofType(s.events, 'blocked')).toEqual([
      { t: 'blocked', unit: '0-0', at: h(0) }, { t: 'blocked', unit: '1-0', at: h(2) },
    ]);
    expect(unitIn(s.state, '0-0').pos).toEqual(h(0));
    expect(unitIn(s.state, '1-0').pos).toEqual(h(2));
  });
  it('units of different squads swapping hexes both stop', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 3), u('1-0', 'rifleman', 4)]), [move('0-0', h(4)), move('1-0', h(3))]);
    expect(ofType(r.events, 'move')).toEqual([]);
    expect(ofType(r.events, 'blocked').map((e) => e.unit)).toEqual(['0-0', '1-0']);
  });
  it('a unit cannot enter a hex whose occupant stays', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 2)]), [move('0-0', h(1), h(2))]);
    expect(ofType(r.events, 'move').length).toBe(1);
    expect(ofType(r.events, 'blocked')).toEqual([{ t: 'blocked', unit: '0-0', at: h(1) }]);
    expect(unitIn(r.state, '0-0').pos).toEqual(h(1));
  });
  it('a column of units following each other moves', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 2), u('0-1', 'rifleman', 1), u('0-2', 'rifleman', 0)]), [
      move('0-0', h(3), h(4)), move('0-1', h(2), h(3)), move('0-2', h(1), h(2)),
    ]);
    expect(ofType(r.events, 'blocked')).toEqual([]);
    expect(r.state.units.map((x) => x.pos.q)).toEqual([4, 3, 2]);
  });
  it('a column stops behind a blocked head, to the last unit', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 2), u('0-1', 'rifleman', 1), u('0-2', 'rifleman', 0), u('1-0', 'rifleman', 3)]), [
      move('0-0', h(3)), move('0-1', h(2)), move('0-2', h(1)),
    ]);
    expect(ofType(r.events, 'move')).toEqual([]);
    expect(ofType(r.events, 'blocked').map((e) => e.unit)).toEqual(['0-0', '0-1', '0-2']);
  });
  it('a follower stops when the unit ahead has finished its move', () => {
    const r = run(game(field(8, 1), [u('0-0', 'gunner', 2), u('0-1', 'rifleman', 1)]), [move('0-0', h(3)), move('0-1', h(2), h(3))]);
    expect(unitIn(r.state, '0-0').pos).toEqual(h(3));
    expect(unitIn(r.state, '0-1').pos).toEqual(h(2));
    expect(ofType(r.events, 'blocked')).toEqual([{ t: 'blocked', unit: '0-1', at: h(2) }]);
  });
  it('three units turning in a ring all move', () => {
    const r = run(game(field(4, 4), [u('0-0', 'rifleman', 1, 1), u('0-1', 'rifleman', 2, 1), u('0-2', 'rifleman', 1, 2)]), [
      move('0-0', h(2, 1)), move('0-1', h(1, 2)), move('0-2', h(1, 1)),
    ]);
    expect(ofType(r.events, 'blocked')).toEqual([]);
    expect(r.state.units.map((x) => x.pos)).toEqual([h(2, 1), h(1, 2), h(1, 1)]);
  });
  it('a unit heading for a contested hex stops, and so does the one behind it', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 1), u('1-0', 'rifleman', 3)]), [
      move('0-0', h(1)), move('0-1', h(2)), move('1-0', h(2)),
    ]);
    expect(ofType(r.events, 'move')).toEqual([]);
    expect(ofType(r.events, 'blocked').map((e) => e.unit)).toEqual(['0-0', '0-1', '1-0']);
  });
  it('a down unit does not hold its hex', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 1, 0, { status: 'down' }), u('1-1', 'rifleman', 7)]), [move('0-0', h(1))]);
    expect(unitIn(r.state, '0-0').pos).toEqual(h(1));
  });
});

describe('pinned, recover, treat', () => {
  it('a pinned unit sits out one round, then recovers', () => {
    const start = game(field(8, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 3)]);
    const r3 = run(start, [fire('0-0', 3)]);
    expect(unitIn(r3.state, '1-0').status).toBe('pinned');
    expect(ofType(r3.events, 'recover')).toEqual([]);
    expect(r3.state.round).toBe(4);
    const r4 = run(r3.state, [move('1-0', h(4)), fire('1-0', 0)]);
    expect(ofType(r4.events, 'move')).toEqual([]);
    expect(ofType(r4.events, 'fire')).toEqual([]);
    expect(ofType(r4.events, 'recover')).toEqual([{ t: 'recover', unit: '1-0' }]);
    expect(unitIn(r4.state, '1-0')).toMatchObject({ status: 'ready', pinnedRound: null, pos: h(3) });
    const r5 = run(r4.state, [move('1-0', h(4))]);
    expect(unitIn(r5.state, '1-0').pos).toEqual(h(4));
  });
  it('treat lets a pinned unit act this round', () => {
    const start = game(field(8, 1), [u('0-0', 'medic', 0), u('0-1', 'rifleman', 1, 0, { status: 'pinned', pinnedRound: 2 }), u('1-0', 'rifleman', 4)]);
    const r = run(start, [treat('0-0', 1), fire('0-1', 4)]);
    expect(ofType(r.events, 'treat')).toEqual([{ t: 'treat', unit: '0-0', target: '0-1', action: 'aid' }]);
    expect(ofType(r.events, 'fire').map((e) => e.unit)).toEqual(['0-1']);
    expect(hits(r.events)).toEqual(['1-0 pinned']);
    expect(unitIn(r.state, '0-1')).toMatchObject({ status: 'ready', pinnedRound: null });
    const order = r.events.map((e) => (e.t === 'phase' ? e.phase : e.t));
    expect(order.slice(0, 3)).toEqual(['treat', 'treat', 'fire']);
  });
  it('treating a unit that is not pinned does nothing; a pinned medic treats no one', () => {
    const a = run(game(field(8, 1), [u('0-0', 'medic', 0), u('0-1', 'rifleman', 1), u('1-0', 'rifleman', 7)]), [treat('0-0', 1)]);
    expect(ofType(a.events, 'treat')).toEqual([]);
    const b = run(game(field(8, 1), [u('0-0', 'medic', 0, 0, { status: 'pinned', pinnedRound: 3 }), u('0-1', 'rifleman', 1, 0, { status: 'pinned', pinnedRound: 3 }), u('1-0', 'rifleman', 7)]), [treat('0-0', 1)]);
    expect(ofType(b.events, 'treat')).toEqual([]);
    expect(unitIn(b.state, '0-1').status).toBe('pinned');
  });
  it('medics all act from how things stood at the start of the phase', () => {
    // 0-0 treats 0-1 (a pinned medic), whose own order is to treat 0-2. 0-1 was not ready at the start, so it does not.
    const start = game(field(8, 1), [
      u('0-0', 'medic', 0), u('0-1', 'medic', 1, 0, { status: 'pinned', pinnedRound: 2 }),
      u('0-2', 'rifleman', 2, 0, { status: 'pinned', pinnedRound: 3 }), u('1-0', 'rifleman', 7),
    ]);
    const r = run(start, [treat('0-0', 1), treat('0-1', 2)]);
    expect(ofType(r.events, 'treat')).toEqual([{ t: 'treat', unit: '0-0', target: '0-1', action: 'aid' }]);
    expect(unitIn(r.state, '0-2').status).toBe('pinned');
  });
});

describe('score and the end', () => {
  const objectives = [{ id: 'A', hex: h(1), value: 2 }, { id: 'B', hex: h(5), value: 3 }, { id: 'C', hex: h(7), value: 1 }];
  const map = field(9, 1, {}, { objectives, maxRounds: 4 });
  it('a living unit on an objective scores its value for its owner, pinned or not', () => {
    const start = game(map, [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 5, 0, { status: 'pinned', pinnedRound: 3 }), u('1-1', 'rifleman', 7, 0, { status: 'down' })], { round: 1, scores: [1, 1] });
    const r = run(start, [move('0-0', h(1))]);
    expect(ofType(r.events, 'score')).toEqual([
      { t: 'score', objective: 'A', player: 0, value: 2 }, { t: 'score', objective: 'B', player: 1, value: 3 },
    ]);
    expect(r.state.scores).toEqual([3, 4]);
    expect(r.state.over).toBe(false);
    expect(r.state.round).toBe(2);
  });
  it('the match ends after maxRounds; the top score wins', () => {
    const start = game(map, [u('0-0', 'rifleman', 1), u('1-0', 'rifleman', 8)], { round: 4, scores: [0, 1] });
    const r = run(start, []);
    expect(r.state).toMatchObject({ over: true, winners: [0], scores: [2, 1], round: 5 });
    expect(r.events[r.events.length - 1]).toEqual({ t: 'over', scores: [2, 1], winners: [0] });
    const before = run({ ...start, round: 3 }, []);
    expect(before.state.over).toBe(false);
  });
  it('ties share the win', () => {
    const r = run(game(map, [u('0-0', 'rifleman', 1), u('1-0', 'rifleman', 8)], { round: 4, scores: [0, 2] }), []);
    expect(r.state.winners).toEqual([0, 1]);
  });
  it('a squad with no living units is eliminated, keeps its score, and the match ends when one squad is left', () => {
    const start = game(map, [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 0 + 2), u('1-0', 'rifleman', 4, 0, { status: 'pinned', pinnedRound: 3 })], { round: 2, scores: [0, 9] });
    const r = run(start, [fire('0-0', 4)]);
    expect(hits(r.events)).toEqual(['1-0 down']);
    expect(ofType(r.events, 'eliminated')).toEqual([{ t: 'eliminated', player: 1 }]);
    expect(r.state).toMatchObject({ eliminated: [false, true], over: true, winners: [1], scores: [0, 9] });
    expect(r.events.slice(-2).map((e) => e.t)).toEqual(['eliminated', 'over']);
  });
  it('with three squads, one going out does not end the match, and it then sees the whole board', () => {
    const start = game(field(12, 1, { '11,0': 'w' }), [
      u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 3, 0, { status: 'pinned', pinnedRound: 3 }), u('2-0', 'rifleman', 11),
    ], { playerCount: 3 });
    const r = run(start, [fire('0-0', 3)]);
    expect(r.state).toMatchObject({ eliminated: [false, true, false], over: false });
    // Player 1 loses sight of 0-0 when its last unit goes down, then is shown everyone,
    // the unit hidden in the far woods included.
    expect(r.playerEvents[1].filter((e) => e.t === 'lost')).toEqual([{ t: 'lost', unit: '0-0' }]);
    expect(ofType(r.playerEvents[1], 'spotted').map((e) => e.unit.id)).toEqual(['0-0', '2-0']);
    expect(viewFor(r.state, 1).units.map((x) => x.id).sort()).toEqual(['0-0', '1-0', '2-0']);
    // Later rounds: no second `eliminated`.
    expect(ofType(run(r.state, []).events, 'eliminated')).toEqual([]);
  });
  it('resolving a finished match changes nothing', () => {
    const done = run(game(map, [u('0-0', 'rifleman', 1), u('1-0', 'rifleman', 8)], { round: 4 }), []).state;
    const again = run(done, [move('0-0', h(2))]);
    expect(again.state).toEqual(done);
    expect(again.events).toEqual([]);
  });
});

describe('resolve: shape of a round', () => {
  it('emits the six phases in order, even with no orders', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 7)]), []);
    expect(r.events).toEqual(['treat', 'fire', 'move', 'assault', 'mortar', 'score'].map((phase) => ({ t: 'phase', phase })));
    expect(r.playerEvents[0]).toEqual(r.events);
  });
  it('ignores illegal orders, orders for the wrong seat, and all but the first order for a unit', () => {
    const start = game(field(8, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 7)]);
    const r = resolve(start, [
      [move('0-0', h(5)), move('0-0', h(1)), move('0-0', h(1), h(2)), fire('1-0', 0)],
      [{ unit: '0-0', kind: 'fire', target: h(1) }, { unit: '1-0', kind: 'dash', path: [h(6), h(5), h(4), h(3), h(2)] }],
    ]);
    expect(ofType(r.events, 'move')).toEqual([{ t: 'move', step: 1, unit: '0-0', from: h(0), to: h(1) }]);
    expect(ofType(r.events, 'fire')).toEqual([]);
    expect(() => resolve(start, [])).not.toThrow();
    expect(() => resolve(start, [null, [null, 7, { unit: 3 }, { unit: '1-0', kind: 'move', path: 'x' }]] as unknown as Order[][])).not.toThrow();
  });
  it('does not mutate its input', () => {
    const deepFreeze = <T>(o: T): T => {
      if (typeof o === 'object' && o !== null && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
      }
      return o;
    };
    const start = game(field(9, 2, { '6,0': 'w' }, { objectives: [{ id: 'A', hex: h(1), value: 1 }] }), [
      u('0-0', 'rifleman', 0), u('0-1', 'gunner', 0, 1), u('0-2', 'medic', 1, 1, { revealed: true }),
      u('1-0', 'rifleman', 4), u('1-1', 'rifleman', 6), u('1-2', 'mortar', 8, 1, { status: 'pinned', pinnedRound: 2 }),
    ]);
    const orders: Order[][] = [
      [move('0-0', h(1), h(2)), fire('0-1', 4, 0), dash('0-2', h(2, 1), h(3, 1))],
      [ambush('1-0'), move('1-1', h(5))],
    ];
    const snapshot = structuredClone({ start, orders });
    deepFreeze(start);
    deepFreeze(orders);
    const r = resolve(start, orders);
    expect(start).toEqual(snapshot.start);
    expect(orders).toEqual(snapshot.orders);
    expect(r.state).not.toBe(start);
    expect(r.state.units[0]).not.toBe(start.units[0]);
    expect(ofType(r.events, 'move').length).toBeGreaterThan(0);
  });
  it('replaying a recorded order list gives the same final state', () => {
    const map = MAPS[DEFAULT_MAP];
    const squads = [{ player: 0, units: PRESETS[0].units }, { player: 1, units: PRESETS[1].units }];
    const script: Order[][][] = [
      [[dash('0-0', h(2, 1), h(3, 1)), move('0-3', h(2, 2))], [ambush('1-0')]],
      [[move('0-0', h(4, 1)), ambush('0-1')], []],
      [[], []],
    ];
    const play = () => {
      let s = createMatch(map, squads);
      const all: GameEvent[][] = [];
      for (const round of script) { const r = resolve(s, round); s = r.state; all.push(r.events); }
      return { s, all };
    };
    const a = play();
    const b = play();
    expect(b.s).toEqual(a.s);
    expect(b.all).toEqual(a.all);
    expect(JSON.stringify(b.s)).toBe(JSON.stringify(a.s));
    expect(a.s.round).toBe(4);
  });
});

describe('playerEvents: what each player is told', () => {
  it('own events always; the enemy is told only what it sees', () => {
    // 0-0 is alone on the far side of a wood from 1-0.
    const map = field(10, 1, { '4,0': 'w' });
    const r = run(game(map, [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 8)]), [move('0-0', h(1), h(2))]);
    expect(ofType(r.playerEvents[0], 'move').length).toBe(2);
    expect(r.playerEvents[1]).toEqual(ofType(r.events, 'phase'));
  });
  it('fire: full if the shooter is seen, without the shooter if only the target hex is, else nothing', () => {
    // Shooter 0-0 fires out of woods at an empty hex. 1-0 is 3 away from it (sees the hex, but firing reveals the shooter).
    const map = field(12, 1, { '2,0': 'w', '9,0': 'w' });
    const hidden = u('0-0', 'sniper', 2);
    // 1-0 at 9 in woods, sight 6: sees hexes 3..9 but not hex 2 (7 away). Target hex 5.
    const r = run(game(map, [hidden, u('1-0', 'rifleman', 9), u('2-0', 'rifleman', 11)], { playerCount: 3 }), [fire('0-0', 5)]);
    const full = { t: 'fire', unit: '0-0', from: h(2), target: h(5), blast: 0, ambush: false, action: 'snipe' };
    expect(ofType(r.events, 'fire')).toEqual([full]);
    expect(ofType(r.playerEvents[0], 'fire')).toEqual([full]);
    expect(ofType(r.playerEvents[1], 'fire')).toEqual([{ ...full, unit: null, from: null }]);
    expect(ofType(r.playerEvents[2], 'fire')).toEqual([]);   // behind the woods at 9: sees neither
  });
  it('firing reveals a hidden shooter: `spotted`, then the full fire event', () => {
    const map = field(8, 1, { '0,0': 'w' });
    const r = run(game(map, [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 4)]), [fire('0-0', 4)]);
    const seen1 = r.playerEvents[1].filter((e) => e.t !== 'phase');
    expect(seen1.map((e) => e.t)).toEqual(['spotted', 'fire', 'hit']);
    expect(seen1[0]).toMatchObject({ t: 'spotted', unit: { id: '0-0', revealed: true, pos: h(0) } });
    expect(viewFor(r.state, 1).units.map((x) => x.id)).toContain('0-0');
    // Next round it does not fire: the flag clears and it is lost again.
    const r2 = run(r.state, []);
    expect(r2.playerEvents[1].slice(0, 2)).toEqual([{ t: 'phase', phase: 'treat' }, { t: 'lost', unit: '0-0' }]);
  });
  it('an enemy move: seen all the way is `move`; coming into view is `spotted`; leaving it is `move` then `lost`', () => {
    const map = field(12, 2, { '7,1': 'w' });
    // 0-0 at (2,0) sees 6 hexes. 1-0 starts 7 away, steps to 6 away in the open (seen),
    // then into woods, still 6 away (a mover there is hidden beyond 2).
    const r = run(game(map, [u('0-0', 'rifleman', 2), u('1-0', 'rifleman', 9)]), [move('1-0', h(8), h(7, 1))]);
    const seen0 = r.playerEvents[0].filter((e) => e.t !== 'phase');
    expect(seen0).toEqual([
      { t: 'spotted', unit: { ...u('1-0', 'rifleman', 8, 0, { posture: 'moved' }) } },
      { t: 'move', step: 2, unit: '1-0', from: h(8), to: h(7, 1) },
      { t: 'lost', unit: '1-0' },
    ]);
    expect(viewFor(r.state, 0).units.map((x) => x.id)).toEqual(['0-0']);
    // and one seen throughout
    const open = run(game(field(8, 1), [u('0-0', 'rifleman', 1), u('1-0', 'rifleman', 5)]), [move('1-0', h(4))]);
    expect(open.playerEvents[0].filter((e) => e.t !== 'phase')).toEqual([{ t: 'move', step: 1, unit: '1-0', from: h(5), to: h(4) }]);
  });
  it('the player\'s own movement brings enemies into view and loses them', () => {
    const map = field(12, 1, { '5,0': 'w' });
    const r = run(game(map, [u('0-0', 'rifleman', 3), u('1-0', 'rifleman', 8)]), [move('0-0', h(4), h(5))]);
    // From 4 the woods at 5 block the line; from 5 (in the woods) it sees out.
    expect(r.playerEvents[0].filter((e) => e.t === 'spotted' || e.t === 'lost')).toEqual([{ t: 'spotted', unit: u('1-0', 'rifleman', 8) }]);
    const back = run(r.state, [move('0-0', h(4))]);
    expect(back.playerEvents[0].filter((e) => e.t === 'spotted' || e.t === 'lost')).toEqual([{ t: 'lost', unit: '1-0' }]);
  });
  it('a unit seen going down gets its `hit` and no `lost`', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 1), u('1-0', 'rifleman', 4), u('1-1', 'rifleman', 5, 0, { status: 'pinned', pinnedRound: 3 })]), [
      fire('0-0', 4), fire('0-1', 4), fire('1-0', 5 - 4),
    ]);
    // 1-0 goes down in view of player 0.
    expect(r.playerEvents[0].filter((e) => e.t === 'hit' || e.t === 'lost')).toEqual([
      { t: 'hit', unit: '1-0', at: h(4), result: 'pinned' },
      { t: 'hit', unit: '1-0', at: h(4), result: 'down' },
      { t: 'hit', unit: '0-1', at: h(1), result: 'pinned' },   // 1-0 still fired: all shots are worked out first
    ]);
    expect(viewFor(r.state, 0).units.map((x) => x.id)).toEqual(['0-0', '0-1', '1-1']);
  });
  it('launch only if the mortar is seen; impact if the target hex is seen, and always for the mortar\'s owner', () => {
    const map = field(14, 1);
    const r = run(game(map, [u('0-0', 'mortar', 0), u('0-1', 'rifleman', 5), u('1-0', 'rifleman', 13), u('2-0', 'rifleman', 4, 0, { status: 'ready' })], { playerCount: 3 }), [fire('0-0', 10)]);
    expect(ofType(r.playerEvents[0], 'launch').length).toBe(1);
    expect(ofType(r.playerEvents[1], 'launch').length).toBe(0);   // 13 away
    expect(ofType(r.playerEvents[2], 'launch').length).toBe(1);   // 4 away, in the open
    expect(ofType(r.playerEvents[0], 'impact').length).toBe(1);
    expect(ofType(r.playerEvents[1], 'impact').length).toBe(1);   // sees hex 10
    expect(ofType(r.playerEvents[2], 'impact').length).toBe(1);   // 6 away: sees it
    const blind = run(game(map, [u('0-0', 'mortar', 0), u('0-1', 'rifleman', 5), u('1-0', 'rifleman', 13), u('2-0', 'rifleman', 0 + 1)], { playerCount: 3 }), [fire('0-0', 10)]);
    expect(ofType(blind.playerEvents[2], 'impact').length).toBe(0);   // 9 away
  });
  it('treat: seen in full only with both in view; with only the patient in view it is a `recover`', () => {
    const map = field(12, 1, { '0,0': 'w' });
    // Medic lying still in woods at 0 (hidden beyond 1), patient in the open at 1. Enemy at 5.
    const r = run(game(map, [u('0-0', 'medic', 0), u('0-1', 'rifleman', 1, 0, { status: 'pinned', pinnedRound: 2 }), u('1-0', 'rifleman', 5)]), [treat('0-0', 1)]);
    expect(r.playerEvents[1].filter((e) => e.t !== 'phase')).toEqual([{ t: 'recover', unit: '0-1' }]);
    expect(ofType(r.playerEvents[0], 'treat').length).toBe(1);
    // Two hexes off he still sees only the patient; next to the woods he sees both.
    const two = run(game(map, [u('0-0', 'medic', 0), u('0-1', 'rifleman', 1, 0, { status: 'pinned', pinnedRound: 2 }), u('1-0', 'rifleman', 2)]), [treat('0-0', 1)]);
    expect(two.playerEvents[1].filter((e) => e.t !== 'phase')).toEqual([{ t: 'recover', unit: '0-1' }]);
    const wide = field(12, 2, { '0,0': 'w' });
    const near = run(game(wide, [u('0-0', 'medic', 0), u('0-1', 'rifleman', 1, 0, { status: 'pinned', pinnedRound: 2 }), u('1-0', 'rifleman', 0, 1)]), [treat('0-0', 1)]);
    expect(ofType(near.playerEvents[1], 'treat').length).toBe(1);
  });
});

describe('posture: what a unit has done in the round', () => {
  const postures = (s: GameState) => Object.fromEntries(s.units.map((x) => [x.id, x.posture]));

  it('a match starts with everyone still', () => {
    const s = createMatch(MAPS[DEFAULT_MAP], [{ player: 0, units: PRESETS[0].units }, { player: 1, units: PRESETS[1].units }]);
    expect(new Set(s.units.map((x) => x.posture))).toEqual(new Set(['still']));
  });

  it('holding, ambushing, firing and being pinned are still; a move is moved; a dash is dashed', () => {
    const map = field(12, 3);
    const start = game(map, [
      u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 0, 1), u('0-2', 'rifleman', 0, 2),
      u('1-0', 'rifleman', 9), u('1-1', 'rifleman', 9, 1), u('1-2', 'rifleman', 9, 2, { status: 'pinned', pinnedRound: 3 }),
    ]);
    const r = run(start, [move('0-0', h(1)), dash('0-1', h(1, 1), h(2, 1)), ambush('0-2'), fire('1-0', 8), dash('1-2', h(8, 2))]);
    expect(postures(r.state)).toEqual({ '0-0': 'moved', '0-1': 'dashed', '0-2': 'still', '1-0': 'still', '1-1': 'still', '1-2': 'still' });
    // The one pinned when the fire phase came did not dash, and is not told to have.
    expect(ofType(r.events, 'dash')).toEqual([{ t: 'dash', unit: '0-1' }]);
    expect(r.events.findIndex((e) => e.t === 'dash')).toBe(r.events.findIndex((e) => e.t === 'phase' && e.phase === 'fire') + 1);
    // Postures last through the planning that follows, and are wiped when the next round begins to resolve.
    const next = run(r.state, []);
    expect(new Set(Object.values(postures(next.state)))).toEqual(new Set(['still']));
  });

  it('a unit that was told to move and never took a step stayed still; one told to dash is dashed all the same', () => {
    const map = field(6, 1);
    // 0-1 holds at 1: both men behind and in front of it are blocked on their first step.
    const r = run(game(map, [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 1), u('0-2', 'rifleman', 2)]), [move('0-0', h(1)), dash('0-2', h(1), h(0))]);
    expect(ofType(r.events, 'blocked').map((e) => e.unit)).toEqual(['0-0', '0-2']);
    expect(postures(r.state)).toEqual({ '0-0': 'still', '0-1': 'still', '0-2': 'dashed' });
  });

  it('a mover becomes `moved` on its first step, not before: in the fire phase it is still hidden where it lay', () => {
    const map = field(10, 1, { '6,0': 'w', '5,0': 'w' });
    // 1-0 lies in woods 4 from the watcher and creeps one hex nearer, still in woods: 3 away, a mover's 2 not reached.
    const r = run(game(map, [u('0-0', 'rifleman', 2), u('1-0', 'rifleman', 6)]), [move('1-0', h(5))]);
    expect(r.playerEvents[0].filter((e) => e.t !== 'phase')).toEqual([]);
    expect(unitIn(r.state, '1-0')).toMatchObject({ posture: 'moved', pos: h(5) });
    // At 2 hexes a mover in woods is seen, where a man lying there is not.
    const lying = game(field(10, 1, { '4,0': 'w' }), [u('0-0', 'rifleman', 2), u('1-0', 'rifleman', 4)]);
    expect(viewFor(lying, 0).units.map((x) => x.id)).toEqual(['0-0']);
    expect(viewFor({ ...lying, units: lying.units.map((x) => ({ ...x, posture: 'moved' as const })) }, 0).units.length).toBe(2);
  });

  it('a creeper seen at 2 is lost again when the next round begins, unless it moves again', () => {
    const map = field(10, 1, { '4,0': 'w', '5,0': 'w' });
    const r = run(game(map, [u('0-0', 'rifleman', 2), u('1-0', 'rifleman', 5)]), [move('1-0', h(4))]);
    expect(viewFor(r.state, 0).units.map((x) => x.id)).toEqual(['0-0', '1-0']);
    const held = run(r.state, []);
    expect(held.playerEvents[0].slice(0, 2)).toEqual([{ t: 'phase', phase: 'treat' }, { t: 'lost', unit: '1-0' }]);
    expect(viewFor(held.state, 0).units.map((x) => x.id)).toEqual(['0-0']);
  });

  it('a dasher breaks cover in the fire phase: seen from afar before it takes a step, and all the way', () => {
    // A wood along the top row; the watcher three rows below it, 3 hexes from each of its hexes, the line clear.
    const map = field(12, 4, { '8,0': 'w', '7,0': 'w', '6,0': 'w' });
    for (const q of [6, 7, 8]) expect([distance(h(6, 3), h(q)), canSee(map, h(6, 3), h(q))]).toEqual([3, true]);
    const r = run(game(map, [u('0-0', 'rifleman', 6, 3), u('1-0', 'rifleman', 8)]), [dash('1-0', h(7), h(6))]);
    const told = r.playerEvents[0].map((e) => (e.t === 'phase' ? e.phase : e.t));
    expect(told).toEqual(['treat', 'fire', 'spotted', 'dash', 'move', 'move', 'move', 'assault', 'mortar', 'score']);
    expect(r.playerEvents[0].find((e) => e.t === 'spotted')).toMatchObject({ unit: { id: '1-0', pos: h(8), posture: 'dashed' } });
    // The same walk at a creep is never seen: 3 hexes off all the way, where a mover is seen from 2.
    const crept = run(game(map, [u('0-0', 'rifleman', 6, 3), u('1-0', 'rifleman', 8)]), [move('1-0', h(7), h(6))]);
    expect(crept.playerEvents[0].filter((e) => e.t !== 'phase')).toEqual([]);
  });

  it('a dasher in woods goes down from one hit', () => {
    const map = field(8, 1, { '4,0': 'w', '5,0': 'w' });
    const r = run(game(map, [u('0-0', 'rifleman', 3), u('1-0', 'rifleman', 4)]), [fire('0-0', 4), dash('1-0', h(5))]);
    expect(hits(r.events)).toEqual(['1-0 down']);
    expect(unitIn(r.state, '1-0').posture).toBe('dashed');
  });
});

describe('ambush and stealth', () => {
  // The ambusher at (5,3) in the open. Three woods: (8,0) and (7,0) are 3 hexes from him, (7,1) is 2.
  // His line to (7,0) and to (7,1) is clear, and both are inside rifle range.
  const map = field(10, 4, { '8,0': 'w', '7,0': 'w', '7,1': 'w' });
  const A = h(5, 3);
  it('the ground is as the tests below need it', () => {
    expect([distance(A, h(7)), canSee(map, A, h(7))]).toEqual([3, true]);
    expect([distance(A, h(7, 1)), canSee(map, A, h(7, 1))]).toEqual([2, true]);
  });

  it('a unit creeping through woods 3 hexes from an ambusher is not shot; at 2 it is', () => {
    const three = run(game(map, [u('0-0', 'rifleman', 5, 3), u('1-0', 'rifleman', 8)]), [ambush('0-0'), move('1-0', h(7))]);
    expect(ofType(three.events, 'fire')).toEqual([]);
    expect(unitIn(three.state, '1-0')).toMatchObject({ pos: h(7), status: 'ready', posture: 'moved' });
    const two = run(three.state, [ambush('0-0'), move('1-0', h(7, 1))]);
    expect(ofType(two.events, 'fire')).toMatchObject([{ unit: '0-0', target: h(7, 1), ambush: true }]);
    expect(hits(two.events)).toEqual(['1-0 pinned']);
  });

  it('a unit dashing the same way is shot at 3, and has no cover', () => {
    const r = run(game(map, [u('0-0', 'rifleman', 5, 3), u('1-0', 'rifleman', 8)]), [ambush('0-0'), dash('1-0', h(7))]);
    expect(ofType(r.events, 'fire')).toMatchObject([{ unit: '0-0', target: h(7), ambush: true }]);
    expect(hits(r.events)).toEqual(['1-0 down']);
  });

  it('the ambusher must see its target itself: a friend who sees the creeper does not spring the ambush', () => {
    // 0-1 stands next to the hex the creeper comes to; the ambusher is 3 away from it.
    const start = game(map, [u('0-0', 'rifleman', 5, 3), u('0-1', 'rifleman', 6, 1), u('1-0', 'rifleman', 8)]);
    const r = run(start, [ambush('0-0'), move('1-0', h(7))]);
    expect(viewFor(r.state, 0).units.map((x) => x.id)).toContain('1-0');     // the squad sees him
    expect(ofType(r.events, 'fire')).toEqual([]);                             // the ambusher does not
  });

  it('an ambusher lying still in woods stays hidden until it fires', () => {
    const lane = field(10, 1, { '0,0': 'w' });
    const start = game(lane, [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 6)]);
    expect(viewFor(start, 1).units.map((x) => x.id)).toEqual(['1-0']);
    const r = run(start, [ambush('0-0'), move('1-0', h(5), h(4))]);
    // Walking up to 2 hexes from him the mover sees nothing; then the shot gives the ambusher away.
    const told = r.playerEvents[1].filter((e) => e.t !== 'phase' && e.t !== 'move').map((e) => e.t);
    expect(told).toEqual(['spotted', 'fire', 'hit']);
    expect(ofType(r.events, 'fire')).toMatchObject([{ unit: '0-0', target: h(4), ambush: true }]);
  });
});

describe('scoring does not give a hidden holder away', () => {
  const map = field(12, 1, { '8,0': 'w' }, { objectives: [{ id: 'A', hex: h(3), value: 2 }, { id: 'B', hex: h(8), value: 3 }], maxRounds: 9 });
  const scores = (events: GameEvent[]) => ofType(events, 'score');

  it('the objective is named to its holder and to a player who sees the holder; to anyone else it is null', () => {
    // 0-0 on A in the open; 1-0 on B, lying in woods 5 hexes from the nearest enemy: unseen.
    const start = game(map, [u('0-0', 'rifleman', 3), u('1-0', 'rifleman', 8)]);
    expect(viewFor(start, 0).units.map((x) => x.id)).toEqual(['0-0']);
    expect(viewFor(start, 1).units.map((x) => x.id)).toEqual(['0-0', '1-0']);
    const r = run(start, []);
    const a = { t: 'score', objective: 'A', player: 0, value: 2 }, b = { t: 'score', objective: 'B', player: 1, value: 3 };
    expect(scores(r.events)).toEqual([a, b]);                              // the full list always names it
    expect(scores(r.playerEvents[0])).toEqual([a, { ...b, objective: null }]);
    expect(scores(r.playerEvents[1])).toEqual([a, b]);                     // 1-0 sees the man on A across the open
    expect(r.state.scores).toEqual([2, 3]);                                // the scores themselves are public
    expect(viewFor(r.state, 0).scores).toEqual([2, 3]);
    expect(JSON.stringify(r.playerEvents[0])).not.toContain('"B"');
  });

  it('once the holder is seen (next to it, or because it fired) the objective is named', () => {
    const near = game(map, [u('0-0', 'rifleman', 7), u('1-0', 'rifleman', 8)]);
    expect(scores(run(near, []).playerEvents[0])).toEqual([{ t: 'score', objective: 'B', player: 1, value: 3 }]);
    const fired = game(map, [u('0-0', 'rifleman', 5), u('1-0', 'rifleman', 8)]);
    expect(scores(run(fired, []).playerEvents[0])).toEqual([{ t: 'score', objective: null, player: 1, value: 3 }]);
    expect(scores(run(fired, [fire('1-0', 5)]).playerEvents[0])).toEqual([{ t: 'score', objective: 'B', player: 1, value: 3 }]);
  });

  it('a holder that crept on is named from 2 hexes, one that lay there only from 1', () => {
    const lane = field(12, 1, { '8,0': 'w', '9,0': 'w' }, { objectives: [{ id: 'B', hex: h(8), value: 3 }], maxRounds: 9 });
    const start = game(lane, [u('0-0', 'rifleman', 6), u('1-0', 'rifleman', 9)]);
    const crept = run(start, [move('1-0', h(8))]);
    expect(scores(crept.playerEvents[0])).toEqual([{ t: 'score', objective: 'B', player: 1, value: 3 }]);
    const held = run(crept.state, []);
    expect(scores(held.playerEvents[0])).toEqual([{ t: 'score', objective: null, player: 1, value: 3 }]);
  });

  it('an eliminated player, who sees the whole board, is told every objective', () => {
    const start = game(map, [u('0-0', 'rifleman', 1, 0, { status: 'down' }), u('1-0', 'rifleman', 8), u('2-0', 'rifleman', 11)], { playerCount: 3, eliminated: [true, false, false] });
    const r = run(start, []);
    expect(scores(r.playerEvents[0])).toEqual([{ t: 'score', objective: 'B', player: 1, value: 3 }]);
    // The third player, still in the match and 3 hexes from the holder, is not.
    expect(scores(r.playerEvents[2])).toEqual([{ t: 'score', objective: null, player: 1, value: 3 }]);
  });
});

// ---- task 14
const then = (order: Order, kind: 'fire' | 'special', q: number, r = 0): Order =>
  (order.kind === 'move' ? { ...order, then: { kind, target: h(q, r) } } : order);
const where = (s: GameState) => Object.fromEntries(s.units.map((x) => [x.id, x.pos.q]));

describe('friends do not block', () => {
  it('a unit walks through a teammate who stays', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 1), u('1-0', 'rifleman', 7)]), [move('0-0', h(1), h(2))]);
    expect(ofType(r.events, 'blocked')).toEqual([]);
    expect(where(r.state)).toEqual({ '0-0': 2, '0-1': 1, '1-0': 7 });
  });
  it('teammates swap hexes', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 3), u('0-1', 'rifleman', 4)]), [move('0-0', h(4)), move('0-1', h(3))]);
    expect(ofType(r.events, 'blocked')).toEqual([]);
    expect(where(r.state)).toEqual({ '0-0': 4, '0-1': 3 });
  });
  it('ordered onto a teammate who stays, it stops on the hex before, without ever entering', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 2)]), [move('0-0', h(1), h(2))]);
    expect(ofType(r.events, 'move')).toEqual([{ t: 'move', step: 1, unit: '0-0', from: h(0), to: h(1) }]);
    expect(ofType(r.events, 'blocked')).toEqual([{ t: 'blocked', unit: '0-0', at: h(1) }]);
    expect(where(r.state)).toEqual({ '0-0': 1, '0-1': 2 });
  });
  it('ordered onto a teammate who leaves, it takes the hex', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 2)]), [move('0-0', h(1), h(2)), move('0-1', h(3))]);
    expect(ofType(r.events, 'blocked')).toEqual([]);
    expect(where(r.state)).toEqual({ '0-0': 2, '0-1': 3 });
  });
  it('two teammates ending their paths in one hex in the same step both stop one hex short', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 1), u('0-1', 'rifleman', 5)]), [move('0-0', h(2), h(3)), move('0-1', h(4), h(3))]);
    expect(ofType(r.events, 'blocked').map((e) => [e.unit, e.at.q])).toEqual([['0-0', 2], ['0-1', 4]]);
    expect(where(r.state)).toEqual({ '0-0': 2, '0-1': 4 });
  });
  it('two teammates crossing in one hex in the same step both go on', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 2), u('0-1', 'rifleman', 4)]), [move('0-0', h(3), h(4)), move('0-1', h(3), h(2))]);
    expect(ofType(r.events, 'blocked')).toEqual([]);
    expect(where(r.state)).toEqual({ '0-0': 4, '0-1': 2 });
  });
  it('one ending in a hex and a teammate passing through it in the same step: the first keeps it', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 2), u('0-1', 'rifleman', 5)]), [move('0-0', h(3)), dash('0-1', h(4), h(3), h(2), h(1))]);
    expect(ofType(r.events, 'blocked')).toEqual([]);
    expect(where(r.state)).toEqual({ '0-0': 3, '0-1': 1 });
  });
  it('stopped short while standing in a teammate\'s hex, it falls back along its own path to the last free hex', () => {
    // 0-1 and 0-2 stay. 0-0 passes into 0-1's hex, cannot end on 0-2's, and cannot rest where it is.
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 1), u('0-2', 'rifleman', 2)]), [move('0-0', h(1), h(2))]);
    expect(r.events.filter((e) => e.t === 'move' || e.t === 'blocked')).toEqual([
      { t: 'move', step: 1, unit: '0-0', from: h(0), to: h(1) },
      { t: 'blocked', unit: '0-0', at: h(1) },
      { t: 'move', step: 3, unit: '0-0', from: h(1), to: h(0) },
    ]);
    expect(where(r.state)).toEqual({ '0-0': 0, '0-1': 1, '0-2': 2 });
  });
  it('blocked by an enemy while standing in a teammate\'s hex, it falls back too', () => {
    const r = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 1), u('1-0', 'rifleman', 2)]), [move('0-0', h(1), h(2))]);
    expect(ofType(r.events, 'blocked')).toEqual([{ t: 'blocked', unit: '0-0', at: h(1) }]);
    expect(where(r.state)).toEqual({ '0-0': 0, '0-1': 1, '1-0': 2 });
  });
  it('enemies block as before, with teammates in the way or not', () => {
    // an enemy holding a hex stops the mover; an enemy heading for the same hex stops both
    const held = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 1)]), [move('0-0', h(1), h(2))]);
    expect(where(held.state)).toEqual({ '0-0': 0, '1-0': 1 });
    const same = run(game(field(8, 1), [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 1), u('1-0', 'rifleman', 4)]), [
      move('0-0', h(1), h(2)), move('0-1', h(2), h(3)), move('1-0', h(3)),
    ]);
    // step 1: 0-1 goes to 2 and 1-0 to 3; step 2: 0-1 wants 3, held by the enemy, and 0-0 ends on 2, where 0-1 now stays.
    expect(where(same.state)).toEqual({ '0-0': 1, '0-1': 2, '1-0': 3 });
  });
  it('an ambush shot at a hex two teammates share hits both; the one passing through falls back, pinned', () => {
    const map = field(8, 1);
    const r = run(game(map, [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 1), u('1-0', 'rifleman', 4)]), [move('0-0', h(1), h(2)), ambush('1-0')]);
    expect(hits(r.events)).toEqual(['0-0 pinned', '0-1 pinned']);
    expect(r.events.filter((e) => e.t === 'move' || e.t === 'blocked' || e.t === 'hit').map((e) => e.t)).toEqual(['move', 'hit', 'hit', 'blocked', 'move']);
    expect(where(r.state)).toEqual({ '0-0': 0, '0-1': 1, '1-0': 4 });
    expect(unitIn(r.state, '0-0').status).toBe('pinned');
  });
  it('a unit that never moved is never displaced; one pushed all the way home takes its hex back', () => {
    for (const follower of ['0-3', '1-0']) {
      // The follower steps into 0-0's hex as 0-0 leaves it. 0-0 walks into 0-1, cannot end on 0-2, and has nowhere to stand but home.
      const r = run(game(field(8, 1), [u(follower, 'rifleman', 0), u('0-0', 'rifleman', 1), u('0-1', 'rifleman', 2), u('0-2', 'rifleman', 3)]), [
        move('0-0', h(2), h(3)), move(follower, h(1)),
      ]);
      expect(where(r.state), follower).toEqual({ [follower]: 0, '0-0': 1, '0-1': 2, '0-2': 3 });
      expect(r.events.filter((e) => e.t === 'move' || e.t === 'blocked').map((e) => (e.t === 'move' ? `${e.unit} ${e.from.q}>${e.to.q} @${e.step}` : `${e.unit} blocked`))).toEqual([
        `0-0 1>2 @1`, `${follower} 0>1 @1`, '0-0 blocked', '0-0 2>1 @3', `${follower} blocked`, `${follower} 1>0 @4`,
      ]);
    }
  });
  it('is told to each player as any movement is, and the events add up to the view', () => {
    const start = game(field(8, 1), [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 1), u('0-2', 'rifleman', 2), u('1-0', 'rifleman', 6)]);
    const r = run(start, [move('0-0', h(1), h(2))]);
    expect(r.playerEvents[1].filter((e) => e.t === 'move' || e.t === 'blocked')).toEqual(r.events.filter((e) => e.t === 'move' || e.t === 'blocked'));
    expect(viewFor(r.state, 1).units.find((x) => x.id === '0-0')!.pos).toEqual(h(0));
  });
});

describe('assault: move, then act', () => {
  it('a rifleman walks into range and fires from where he ends up', () => {
    const start = game(field(10, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 6)]);
    const r = run(start, [then(move('0-0', h(1), h(2)), 'fire', 6)]);
    expect(r.events.map((e) => (e.t === 'phase' ? e.phase : e.t))).toEqual(['treat', 'fire', 'move', 'move', 'move', 'assault', 'fire', 'hit', 'mortar', 'score']);
    expect(ofType(r.events, 'fire')).toEqual([{ t: 'fire', unit: '0-0', from: h(2), target: h(6), blast: 0, ambush: false, action: 'rifle' }]);
    expect(hits(r.events)).toEqual(['1-0 pinned']);
    expect(unitIn(r.state, '0-0')).toMatchObject({ pos: h(2), posture: 'moved', revealed: true });
    // Without the move he could not have been told to: 6 hexes is out of rifle range.
    expect(run(start, [fire('0-0', 6)]).events.some((e) => e.t === 'fire')).toBe(false);
  });
  it('stopped short, the target is out of range: nothing happens, and an event says so', () => {
    const r = run(game(field(10, 1), [u('0-0', 'rifleman', 0), u('1-1', 'rifleman', 2), u('1-0', 'rifleman', 6)]), [then(move('0-0', h(1), h(2)), 'fire', 6)]);
    expect(unitIn(r.state, '0-0').pos).toEqual(h(1));
    expect(ofType(r.events, 'unable')).toEqual([{ t: 'unable', unit: '0-0', action: 'rifle', reason: 'range' }]);
    expect(ofType(r.events, 'fire')).toEqual([]);
    expect(unitIn(r.state, '0-0').revealed).toBe(false);
  });
  it('no line from where he stands: nothing happens', () => {
    const map = field(10, 1, { '4,0': 'w' });
    const r = run(game(map, [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 6)]), [then(move('0-0', h(1), h(2)), 'fire', 6)]);
    expect(ofType(r.events, 'unable')).toEqual([{ t: 'unable', unit: '0-0', action: 'rifle', reason: 'sight' }]);
    expect(hits(r.events)).toEqual([]);
  });
  it('pinned on the way, he does not fire; down, neither, and only his owner is told', () => {
    const start = game(field(10, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 4)]);
    const pinned = run(start, [then(move('0-0', h(1), h(2)), 'fire', 4), ambush('1-0')]);
    expect(ofType(pinned.events, 'unable')).toEqual([{ t: 'unable', unit: '0-0', action: 'rifle', reason: 'pinned' }]);
    expect(ofType(pinned.playerEvents[1], 'unable').length).toBe(1);        // the enemy sees him fail to fire
    const down = run(game(field(10, 1), [u('0-0', 'rifleman', 0, 0, { status: 'pinned', pinnedRound: 2 }), u('0-1', 'medic', 0, 0), u('1-0', 'rifleman', 4)].map((x, i) => (i === 1 ? { ...x, pos: h(1) } : x))), [
      then(move('0-0', h(1), h(2)), 'fire', 4), fire('1-0', 0),
    ]);
    // pinned from before and not treated: he never moves, is hit again and goes down
    expect(unitIn(down.state, '0-0').status).toBe('down');
    expect(ofType(down.events, 'unable')).toEqual([{ t: 'unable', unit: '0-0', action: 'rifle', reason: 'down' }]);
    expect(ofType(down.playerEvents[0], 'unable').length).toBe(1);
    expect(ofType(down.playerEvents[1], 'unable').length).toBe(0);
  });
  it('a pinned unit with a move-then-fire order that is still pinned does not fire', () => {
    const r = run(game(field(10, 1), [u('0-0', 'rifleman', 0, 0, { status: 'pinned', pinnedRound: 2 }), u('1-0', 'rifleman', 4)]), [then(move('0-0', h(1)), 'fire', 4)]);
    expect(ofType(r.events, 'unable')).toEqual([{ t: 'unable', unit: '0-0', action: 'rifle', reason: 'pinned' }]);
  });
  it('a mover that never took a step still acts from where it stands, if it can', () => {
    const r = run(game(field(10, 1), [u('0-0', 'rifleman', 0), u('1-1', 'rifleman', 1), u('1-0', 'rifleman', 4)]), [then(move('0-0', h(1)), 'fire', 4)]);
    expect(unitIn(r.state, '0-0')).toMatchObject({ pos: h(0), posture: 'still', revealed: true });
    expect(hits(r.events)).toEqual(['1-0 pinned']);
  });
  it('all follow-ups are worked out together: two men who pin each other both fire', () => {
    const r = run(game(field(10, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 6)]), [then(move('0-0', h(1)), 'fire', 5), then(move('1-0', h(5)), 'fire', 1)]);
    expect(ofType(r.events, 'fire').length).toBe(2);
    expect(hits(r.events)).toEqual(['1-0 pinned', '0-0 pinned']);
  });
  it('cover takes the first hit of the round, not of the phase', () => {
    const map = field(10, 1, { '6,0': 'b' });
    const r = run(game(map, [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 5), u('1-0', 'rifleman', 6)]), [then(move('0-0', h(1), h(2)), 'fire', 6), fire('0-1', 6)]);
    expect(hits(r.events)).toEqual(['1-0 cover', '1-0 pinned']);
    const alone = run(game(map, [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 5), u('1-0', 'rifleman', 6)]), [then(move('0-0', h(1), h(2)), 'fire', 6)]);
    expect(hits(alone.events)).toEqual(['1-0 cover']);
  });
  it('a man who dashed this round is still down to one hit in the assault phase', () => {
    const r = run(game(field(12, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 10)]), [then(move('0-0', h(1), h(2)), 'fire', 6), dash('1-0', h(9), h(8), h(7), h(6))]);
    expect(hits(r.events)).toEqual(['1-0 down']);
  });
  it('a medic walks up and treats a man pinned this very round', () => {
    const start = game(field(10, 1), [u('0-0', 'medic', 0), u('0-1', 'rifleman', 3), u('1-0', 'rifleman', 6)]);
    const r = run(start, [then(move('0-0', h(1), h(2)), 'special', 3), fire('1-0', 3)]);
    expect(r.events.map((e) => (e.t === 'phase' ? e.phase : e.t))).toEqual(['treat', 'fire', 'fire', 'hit', 'move', 'move', 'move', 'assault', 'treat', 'mortar', 'score']);
    expect(ofType(r.events, 'treat')).toEqual([{ t: 'treat', unit: '0-0', target: '0-1', action: 'aid' }]);
    expect(unitIn(r.state, '0-1')).toMatchObject({ status: 'ready', pinnedRound: null });
    expect(unitIn(r.state, '0-0').revealed).toBe(false);
    // Nobody on the hex when he gets there: what the action needs is missing.
    const gone = run(start, [then(move('0-0', h(1), h(2)), 'special', 3), move('0-1', h(4), h(5))]);
    expect(ofType(gone.events, 'unable')).toEqual([{ t: 'unable', unit: '0-0', action: 'aid', reason: 'needs' }]);
  });
  it('the order is refused outright if it could never be legal: resolve ignores it, move and all', () => {
    const start = game(field(12, 1), [u('0-0', 'rifleman', 0), u('0-1', 'gunner', 0, 0), u('1-0', 'rifleman', 9)].map((x, i) => (i === 1 ? { ...x, pos: h(11) } : x)));
    const far = run(start, [then(move('0-0', h(1), h(2)), 'fire', 9)]);          // 7 from the end of the path
    expect(far.events.some((e) => e.t === 'move')).toBe(false);
    const heavy = run(start, [then(move('0-1', h(10)), 'fire', 9)]);             // a machine gun is not mobile
    expect(heavy.events.some((e) => e.t === 'move')).toBe(false);
    const run2 = run(start, [{ unit: '0-0', kind: 'dash', path: [h(1), h(2)], then: { kind: 'fire', target: h(4) } } as unknown as Order]);
    expect(run2.events.some((e) => e.t === 'move' || e.t === 'dash')).toBe(false);
  });
  it('fog: a follow-up shot is told like any shot, and the events still add up to the view', () => {
    const map = field(12, 1, { '2,0': 'w' });
    const start = game(map, [u('0-0', 'rifleman', 3), u('1-0', 'rifleman', 6)]);
    expect(viewFor(start, 1).units.map((x) => x.id)).toEqual(['0-0', '1-0']);
    const r = run(start, [then(move('0-0', h(2)), 'fire', 6)]);
    // He creeps back into the woods, 4 hexes off, and is lost; firing gives him away again.
    const told = r.playerEvents[1].filter((e) => e.t !== 'phase').map((e) => e.t);
    expect(told).toEqual(['move', 'lost', 'spotted', 'fire', 'hit']);
    expect(viewFor(r.state, 1).units.some((x) => x.id === '0-0')).toBe(true);
  });
});
