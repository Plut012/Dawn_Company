import { describe, expect, it } from 'vitest';
import { mapFor, MAPS, NAMES, PRESETS, UNITS } from '../content';
import { distance } from '../shared/hex';
import type { GameEvent, GameMap, GameState, Hex, Objective, Order, Unit, UnitId, UnitTypeId } from '../shared/types';
import { benefitOf, buyBackCost, canSee, createMatch, moveOf, orderOptions, resolve, sightOf, validateOrders, validatePurchases, viewFor, visibleEnemies } from './index';

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
/** An objective over these hexes. By default a kind that gives nothing (21): an HQ whose zone no seat uses. The kinds' gifts have tests of their own. */
const obj = (id: string, value: number, hexes: Hex[], extra: Partial<Objective> = {}): Objective =>
  ({ id, kind: 'hq', hexes, value, zone: null, ...extra });

function u(id: UnitId, type: UnitTypeId, q: number, r = 0, extra: Partial<Unit> = {}): Unit {
  return { id, owner: Number(id.split('-')[0]), type, name: id, pos: h(q, r), status: 'ready', pinnedRound: null, revealed: false, posture: 'still', returnRound: null, dugIn: false, ...extra };
}
function game(map: GameMap, units: Unit[], extra: Partial<GameState> = {}): GameState {
  const playerCount = extra.playerCount ?? 2;
  return {
    map, playerCount, units, round: 3,
    scores: Array(playerCount).fill(0), eliminated: Array(playerCount).fill(false),
    flags: Object.fromEntries(map.objectives.map((o) => [o.id, null])), mode: 'supply-line', works: {}, over: false, winners: [], ...extra,
  };
}
/** Full day (19): for a test of a v1 rule that needs a unit's whole sight. Most tests here plan round 3, at sight −2. */
const DAY: Partial<GameState> = { round: 7 };
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
  const map = mapFor(4);
  it('puts each seat on its spawn zone in squad order, round 1, nothing scored', () => {
    const map = mapFor(2);
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
    const map = mapFor(2);
    const a = createMatch(map, [{ player: 0, units: PRESETS[0].units }, { player: 1, units: PRESETS[2].units }]);
    const b = createMatch(map, [{ player: 1, units: PRESETS[2].units }, { player: 0, units: PRESETS[0].units }]);
    expect(b).toEqual(a);
  });
});

describe('createMatch and the mode', () => {
  const squad = (units: UnitTypeId[]) => [{ player: 0, units }, { player: 1, units }];
  const noMortar = PRESETS.find((p) => !p.units.includes('mortar'))!.units;
  it('stores the mode (supply-line unless told), and viewFor copies it', () => {
    const map = mapFor(2);
    expect(createMatch(map, squad(noMortar)).mode).toBe('supply-line');
    const s = createMatch(map, squad(noMortar), 'last-stand');
    expect(s.mode).toBe('last-stand');
    expect(viewFor(s, 0).mode).toBe('last-stand');
    expect(resolve(s, [[], []]).state.mode).toBe('last-stand');
  });
  it('throws on an unknown mode, or a unit the mode does not allow', () => {
    const map = mapFor(2);
    expect(() => createMatch(map, squad(noMortar), 'no-such-mode')).toThrow(/Unknown mode/);
    expect(() => createMatch(map, squad(PRESETS[0].units), 'last-stand')).toThrow(/Last Stand has no mortar/);
    expect(() => createMatch(map, squad(PRESETS[0].units))).not.toThrow();
  });
  it('starts the same match in either mode; only what the mode changes (20) differs in the first round', () => {
    const map = mapFor(2);
    const a = createMatch(map, squad(noMortar));
    const b = createMatch(map, squad(noMortar), 'last-stand');
    expect({ ...b, mode: a.mode }).toEqual(a);
    const ra = resolve(a, [[], []]);
    const rb = resolve(b, [[], []]);
    expect(rb.events).toEqual(ra.events.filter((e) => e.t !== 'score'));    // Last Stand's flags earn nothing
    expect(rb.state.scores).toEqual([noMortar.length, noMortar.length]);     // the score is the men standing
    expect({ ...rb.state, mode: ra.state.mode, scores: ra.state.scores }).toEqual(ra.state);
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
    const order = r.events.filter((e) => e.t !== 'dig').map((e) => (e.t === 'phase' ? e.phase : e.t));
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
    const r = run(game(map, [u('0-0', 'gunner', 0), u('1-0', 'rifleman', 3), u('1-1', 'rifleman', 6), u('0-1', 'rifleman', 7)], DAY), [
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
  const objectives = [obj('A', 2, [h(1)]), obj('B', 3, [h(5)]), obj('C', 1, [h(7)])];
  const map = field(9, 1, {}, { objectives, maxRounds: 4 });
  it('a ready unit alone in an area takes its flag; a pinned or down one does not; each flag earns for its owner', () => {
    const start = game(map, [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 5, 0, { status: 'pinned', pinnedRound: 3 }), u('1-1', 'rifleman', 7, 0, { status: 'down' })], { round: 1, scores: [1, 1] });
    const r = run(start, [move('0-0', h(1))]);
    expect(ofType(r.events, 'capture')).toEqual([{ t: 'capture', objective: 'A', player: 0, from: null }]);
    expect(ofType(r.events, 'score')).toEqual([{ t: 'score', objective: 'A', player: 0, value: 2 }]);
    expect(r.state.flags).toEqual({ A: 0, B: null, C: null });
    expect(r.state.scores).toEqual([3, 1]);
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
    const start = game(map, [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 0 + 2), u('1-0', 'rifleman', 4, 0, { status: 'pinned', pinnedRound: 3 })], { round: 7, scores: [0, 9] });
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
    expect(r.events).toEqual([...['treat', 'fire', 'move', 'assault', 'mortar', 'score'].map((phase) => ({ t: 'phase', phase })), { t: 'dig', unit: '0-0' }, { t: 'dig', unit: '1-0' }]);
    expect(r.playerEvents[0]).toEqual(r.events.filter((e) => e.t !== 'dig' || e.unit === '0-0'));   // 1-0 is out of sight
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
    const start = game(field(9, 2, { '6,0': 'w' }, { objectives: [obj('A', 1, [h(1)])] }), [
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
    const map = mapFor(2);
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
    expect(r.playerEvents[1]).toEqual([...ofType(r.events, 'phase'), { t: 'dig', unit: '1-0' }]);
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
    const seen1 = r.playerEvents[1].filter((e) => e.t !== 'phase' && e.t !== 'dig');
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
    const r = run(game(map, [u('0-0', 'rifleman', 2), u('1-0', 'rifleman', 9)], DAY), [move('1-0', h(8), h(7, 1))]);
    const seen0 = r.playerEvents[0].filter((e) => e.t !== 'phase' && e.t !== 'dig');
    expect(seen0).toEqual([
      { t: 'spotted', unit: { ...u('1-0', 'rifleman', 8, 0, { posture: 'moved' }) } },
      { t: 'move', step: 2, unit: '1-0', from: h(8), to: h(7, 1) },
      { t: 'lost', unit: '1-0' },
    ]);
    expect(viewFor(r.state, 0).units.map((x) => x.id)).toEqual(['0-0']);
    // and one seen throughout
    const open = run(game(field(8, 1), [u('0-0', 'rifleman', 1), u('1-0', 'rifleman', 5)]), [move('1-0', h(4))]);
    expect(open.playerEvents[0].filter((e) => e.t !== 'phase' && e.t !== 'dig')).toEqual([{ t: 'move', step: 1, unit: '1-0', from: h(5), to: h(4) }]);
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
    const r = run(game(map, [u('0-0', 'mortar', 0), u('0-1', 'rifleman', 5), u('1-0', 'rifleman', 13), u('2-0', 'rifleman', 4, 0, { status: 'ready' })], { playerCount: 3, ...DAY }), [fire('0-0', 10)]);
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
    expect(r.playerEvents[1].filter((e) => e.t !== 'phase' && e.t !== 'dig')).toEqual([{ t: 'recover', unit: '0-1' }]);
    expect(ofType(r.playerEvents[0], 'treat').length).toBe(1);
    // Two hexes off he still sees only the patient; next to the woods he sees both.
    const two = run(game(map, [u('0-0', 'medic', 0), u('0-1', 'rifleman', 1, 0, { status: 'pinned', pinnedRound: 2 }), u('1-0', 'rifleman', 2)]), [treat('0-0', 1)]);
    expect(two.playerEvents[1].filter((e) => e.t !== 'phase' && e.t !== 'dig')).toEqual([{ t: 'recover', unit: '0-1' }]);
    const wide = field(12, 2, { '0,0': 'w' });
    const near = run(game(wide, [u('0-0', 'medic', 0), u('0-1', 'rifleman', 1, 0, { status: 'pinned', pinnedRound: 2 }), u('1-0', 'rifleman', 0, 1)]), [treat('0-0', 1)]);
    expect(ofType(near.playerEvents[1], 'treat').length).toBe(1);
  });
});

describe('posture: what a unit has done in the round', () => {
  const postures = (s: GameState) => Object.fromEntries(s.units.map((x) => [x.id, x.posture]));

  it('a match starts with everyone still', () => {
    const s = createMatch(mapFor(2), [{ player: 0, units: PRESETS[0].units }, { player: 1, units: PRESETS[1].units }]);
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
    expect(r.playerEvents[0].filter((e) => e.t !== 'phase' && e.t !== 'dig')).toEqual([]);
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
    const told = r.playerEvents[0].map((e) => (e.t === 'phase' ? e.phase : e.t)).filter((t) => t !== 'dig');
    expect(told).toEqual(['treat', 'fire', 'spotted', 'dash', 'move', 'move', 'move', 'assault', 'mortar', 'score']);
    expect(r.playerEvents[0].find((e) => e.t === 'spotted')).toMatchObject({ unit: { id: '1-0', pos: h(8), posture: 'dashed' } });
    // The same walk at a creep is never seen: 3 hexes off all the way, where a mover is seen from 2.
    const crept = run(game(map, [u('0-0', 'rifleman', 6, 3), u('1-0', 'rifleman', 8)]), [move('1-0', h(7), h(6))]);
    expect(crept.playerEvents[0].filter((e) => e.t !== 'phase' && e.t !== 'dig')).toEqual([]);
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
    const told = r.playerEvents[1].filter((e) => e.t !== 'phase' && e.t !== 'dig' && e.t !== 'move').map((e) => e.t);
    expect(told).toEqual(['spotted', 'fire', 'hit']);
    expect(ofType(r.events, 'fire')).toMatchObject([{ unit: '0-0', target: h(4), ambush: true }]);
  });
});

describe('flags', () => {
  // A is a three-hex area; B one hex in woods at the far end.
  const map = field(12, 1, { '10,0': 'w' }, { objectives: [obj('A', 2, [h(3), h(4), h(5)]), obj('B', 3, [h(10)])], maxRounds: 9 });
  const flagsOf = (s: GameState) => s.flags;

  it('a flag stays with its owner after they leave, and earns every round', () => {
    const r1 = run(game(map, [u('0-0', 'rifleman', 2), u('1-0', 'rifleman', 11)]), [move('0-0', h(3))]);
    expect(flagsOf(r1.state)).toEqual({ A: 0, B: null });
    const r2 = run(r1.state, [move('0-0', h(2), h(1))]);
    expect(ofType(r2.events, 'capture')).toEqual([]);
    expect(ofType(r2.events, 'score')).toEqual([{ t: 'score', objective: 'A', player: 0, value: 2 }]);
    expect(flagsOf(r2.state)).toEqual({ A: 0, B: null });
    expect(r2.state.scores).toEqual([4, 0]);
  });

  it('any hex of the area counts; two sides in it leave the flag as it was', () => {
    const held = game(map, [u('0-0', 'rifleman', 3), u('1-0', 'rifleman', 6)], { flags: { A: 0, B: null } });
    const r = run(held, [move('1-0', h(5))]);
    expect(ofType(r.events, 'capture')).toEqual([]);
    expect(flagsOf(r.state)).toEqual({ A: 0, B: null });
    const nobody = run({ ...held, flags: { A: null, B: null } }, [move('1-0', h(5))]);
    expect(flagsOf(nobody.state)).toEqual({ A: null, B: null });
    expect(ofType(nobody.events, 'score')).toEqual([]);
  });

  it('an enemy who is pinned in the area does not contest it; the flag changes hands, from its old owner', () => {
    const start = game(map, [u('0-0', 'rifleman', 3, 0, { status: 'pinned', pinnedRound: 3 }), u('1-0', 'rifleman', 6)], { flags: { A: 0, B: null } });
    const r = run(start, [move('1-0', h(5))]);
    expect(ofType(r.events, 'capture')).toEqual([{ t: 'capture', objective: 'A', player: 1, from: 0 }]);
    expect(ofType(r.events, 'score')).toEqual([{ t: 'score', objective: 'A', player: 1, value: 2 }]);
  });

  it('a unit that is already the owner\'s raises no capture', () => {
    const r = run(game(map, [u('0-0', 'rifleman', 4), u('1-0', 'rifleman', 11)], { flags: { A: 0, B: null } }), []);
    expect(ofType(r.events, 'capture')).toEqual([]);
  });

  it('captures and scores are told to everyone, even of a unit nobody sees; the unit stays hidden', () => {
    // 1-0 lies in the woods on B, out of 0-0's sight.
    const start = game(map, [u('0-0', 'rifleman', 3), u('1-0', 'rifleman', 10)]);
    expect(viewFor(start, 0).units.map((x) => x.id)).toEqual(['0-0']);
    const r = run(start, []);
    const caps = [{ t: 'capture', objective: 'A', player: 0, from: null }, { t: 'capture', objective: 'B', player: 1, from: null }];
    const pts = [{ t: 'score', objective: 'A', player: 0, value: 2 }, { t: 'score', objective: 'B', player: 1, value: 3 }];
    for (const told of [r.events, r.playerEvents[0], r.playerEvents[1]]) {
      expect(ofType(told, 'capture')).toEqual(caps);
      expect(ofType(told, 'score')).toEqual(pts);
    }
    expect(ofType(r.playerEvents[0], 'spotted')).toEqual([]);
    expect(viewFor(r.state, 0).flags).toEqual({ A: 0, B: 1 });
    expect(viewFor(r.state, 0).units.map((x) => x.id)).toEqual(['0-0']);
  });

  it('the score phase runs capture, then supply, then recovery and elimination', () => {
    const start = game(map, [u('0-0', 'rifleman', 3), u('0-1', 'rifleman', 1, 0, { status: 'pinned', pinnedRound: 2 }), u('1-0', 'rifleman', 10)]);
    const r = run(start, []);
    const after = r.events.slice(r.events.findIndex((e) => e.t === 'phase' && e.phase === 'score') + 1).filter((e) => e.t !== 'dig').map((e) => e.t);
    expect(after).toEqual(['capture', 'capture', 'score', 'score', 'recover']);
  });

  it('the flags of an eliminated player go to nobody, with no event, and earn no more', () => {
    const start = game(map, [u('0-0', 'rifleman', 6), u('1-0', 'rifleman', 7, 0, { status: 'pinned', pinnedRound: 3 }), u('2-0', 'rifleman', 0)],
      { playerCount: 3, flags: { A: 1, B: 1 } });
    const r = run(start, [fire('0-0', 7)]);
    expect(ofType(r.events, 'eliminated')).toEqual([{ t: 'eliminated', player: 1 }]);
    expect(ofType(r.events, 'score').map((e) => e.player)).toEqual([1, 1]);   // they earned this round, before going out
    expect(ofType(r.events, 'capture')).toEqual([]);
    expect(r.state.flags).toEqual({ A: null, B: null });
    expect(ofType(run(r.state, []).events, 'score')).toEqual([]);
  });

  it('createMatch gives each HQ to the seat that uses its zone, and nothing else to anybody', () => {
    // No real map leaves a zone empty since 23 (each is made for exactly its count), but the rule stands: crossroads
    // with the layouts for two and three it had before is the fixture.
    const cross: GameMap = { ...MAPS.crossroads, seatSpawns: { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] } };
    const squads = (n: number) => Array.from({ length: n }, (_, p) => ({ player: p, units: ['rifleman'] }));
    const hq = (zone: number) => cross.objectives.find((o) => o.zone === zone)!.id;
    for (const n of [2, 3, 4]) {
      const s = createMatch(cross, squads(n));
      const want: Record<string, number | null> = Object.fromEntries(cross.objectives.map((o) => [o.id, null]));
      cross.seatSpawns[n].forEach((zone, seat) => { want[hq(zone)] = seat; });
      expect(s.flags, `${n} players`).toEqual(want);
      expect(viewFor(s, 0).flags).toEqual(want);
    }
    expect(createMatch(cross, squads(2)).flags).toMatchObject({ W: 0, X: null, Y: 1, Z: null });
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
    const start = game(field(8, 1), [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 1), u('0-2', 'rifleman', 2), u('1-0', 'rifleman', 6)], DAY);
    const r = run(start, [move('0-0', h(1), h(2))]);
    expect(r.playerEvents[1].filter((e) => e.t === 'move' || e.t === 'blocked')).toEqual(r.events.filter((e) => e.t === 'move' || e.t === 'blocked'));
    expect(viewFor(r.state, 1).units.find((x) => x.id === '0-0')!.pos).toEqual(h(0));
  });
});

describe('assault: move, then act', () => {
  it('a rifleman walks into range and fires from where he ends up', () => {
    const start = game(field(10, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 6)]);
    const r = run(start, [then(move('0-0', h(1), h(2)), 'fire', 6)]);
    expect(r.events.filter((e) => e.t !== 'dig').map((e) => (e.t === 'phase' ? e.phase : e.t))).toEqual(['treat', 'fire', 'move', 'move', 'move', 'assault', 'fire', 'hit', 'mortar', 'score']);
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
    expect(r.events.filter((e) => e.t !== 'dig').map((e) => (e.t === 'phase' ? e.phase : e.t))).toEqual(['treat', 'fire', 'fire', 'hit', 'move', 'move', 'move', 'assault', 'treat', 'mortar', 'score']);
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
    const told = r.playerEvents[1].filter((e) => e.t !== 'phase' && e.t !== 'dig').map((e) => e.t);
    expect(told).toEqual(['move', 'lost', 'spotted', 'fire', 'hit']);
    expect(viewFor(r.state, 1).units.some((x) => x.id === '0-0')).toBe(true);
  });
});

describe('Supply Line: coming back, buying back, a cut line (18)', () => {
  // A strip of 12: Blue's HQ W on 0 and 1 (zone 0), Plum's HQ X on 10 and 11 (zone 1); start zones beside them.
  const map = field(12, 1, {}, {
    objectives: [obj('W', 1, [h(0), h(1)], { kind: 'hq', zone: 0 }), obj('X', 1, [h(10), h(11)], { kind: 'hq', zone: 1 })],
    spawns: [[h(2), h(3)], [h(9), h(8)]],
    seatSpawns: { 2: [0, 1] },
    maxRounds: 20,
  });
  const held = { flags: { W: 0, X: 1 } };
  const returns = { rounds: 3, buyBack: 6 };     // what MODES['supply-line'] says; checked below
  const buy = (unit: UnitId) => ({ kind: 'return' as const, unit });
  const downed = (id: UnitId, q: number, returnRound: number) => u(id, 'rifleman', q, 0, { status: 'down', returnRound });

  it('reads its numbers from the mode', async () => {
    const { MODES } = await import('../content');
    expect(MODES['supply-line'].returns).toEqual(returns);
    expect(MODES['last-stand'].returns).toBeNull();
  });

  it('a unit that goes down is due back `rounds` later; in a mode without returns it is not', () => {
    const start = game(map, [u('0-0', 'rifleman', 5, 0, { status: 'pinned', pinnedRound: 2 }), u('0-1', 'rifleman', 4), u('1-0', 'rifleman', 7)], held);
    const r = run(start, [fire('1-0', 5)]);
    expect(unitIn(r.state, '0-0')).toMatchObject({ status: 'down', returnRound: 3 + returns.rounds });
    const last = run({ ...start, mode: 'last-stand' }, [fire('1-0', 5)]);
    expect(unitIn(last.state, '0-0')).toMatchObject({ status: 'down', returnRound: null });
  });

  it('comes back at the end of the round it is due, on the first free hex of the HQ, ready and still', () => {
    const start = game(map, [u('0-0', 'rifleman', 0), downed('0-1', 5, 3), u('1-0', 'rifleman', 9)], held);
    const r = run(start, []);
    expect(ofType(r.events, 'return')).toEqual([{ t: 'return', unit: '0-1', at: h(1) }]);
    expect(unitIn(r.state, '0-1')).toMatchObject({ status: 'ready', pos: h(1), posture: 'still', revealed: false, pinnedRound: null, returnRound: null });
    // Not yet due: it waits.
    expect(ofType(run({ ...start, round: 2 }, []).events, 'return')).toEqual([]);
  });

  it('with the HQ full it comes back in the start zone; with that full too, it waits', () => {
    const start = game(map, [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 1), downed('0-2', 6, 3), u('1-0', 'rifleman', 9)], held);
    expect(ofType(run(start, []).events, 'return')).toEqual([{ t: 'return', unit: '0-2', at: h(2) }]);
    const full = game(map, [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 1), u('0-3', 'rifleman', 2), u('1-1', 'rifleman', 3), downed('0-2', 6, 3), u('1-0', 'rifleman', 9)], held);
    const r = run(full, []);
    expect(ofType(r.events, 'return')).toEqual([]);
    expect(unitIn(r.state, '0-2')).toMatchObject({ status: 'down', returnRound: 3 });
  });

  it('a cut line: nobody comes back, however long due; the round the HQ is retaken, he is back', () => {
    const cut = game(map, [u('0-0', 'rifleman', 4), downed('0-1', 6, 1), u('1-0', 'rifleman', 0)], { flags: { W: 1, X: 1 } });
    const r = run(cut, []);
    expect(ofType(r.events, 'return')).toEqual([]);
    expect(r.state.eliminated).toEqual([false, false]);
    // Blue walks back into W, which Plum has left: captured, and then he returns, in the same score phase.
    const retake = run(game(map, [u('0-0', 'rifleman', 2), downed('0-1', 6, 1), u('1-0', 'rifleman', 5)], { flags: { W: 1, X: 1 } }), [move('0-0', h(1))]);
    expect(ofType(retake.events, 'capture')).toEqual([{ t: 'capture', objective: 'W', player: 0, from: 1 }]);
    expect(ofType(retake.events, 'return')).toEqual([{ t: 'return', unit: '0-1', at: h(0) }]);
    const order = retake.events.filter((e) => e.t === 'capture' || e.t === 'score' || e.t === 'return').map((e) => e.t);
    expect(order).toEqual(['capture', 'score', 'score', 'return']);
  });

  it('a squad with nobody standing is out only when nobody can come back', () => {
    // Line open, a man due: not out.
    const waiting = run(game(map, [downed('0-0', 5, 5), u('1-0', 'rifleman', 9)], held), []);
    expect(waiting.state.eliminated).toEqual([false, false]);
    expect(waiting.state.over).toBe(false);
    // Line cut: out, and the match is over.
    const cut = run(game(map, [downed('0-0', 5, 5), u('1-0', 'rifleman', 0)], { flags: { W: 1, X: 1 } }), []);
    expect(cut.state.eliminated).toEqual([true, false]);
    expect(cut.state.over).toBe(true);
    // Nobody due (Last Stand's dead): out.
    const gone = run(game(map, [u('0-0', 'rifleman', 5, 0, { status: 'down' }), u('1-0', 'rifleman', 9)], held), []);
    expect(gone.state.eliminated).toEqual([true, false]);
  });

  it('buying back: paid after supply, from what is left, and he is back at the end of the round', () => {
    const start = game(map, [u('0-0', 'rifleman', 4), downed('0-1', 6, 5), u('1-0', 'rifleman', 9)], { ...held, scores: [12, 0] });
    expect(validatePurchases(start, 0, [buy('0-1')])).toEqual([]);
    expect(buyBackCost(start, '0-1')).toBe(UNITS.rifleman.cost * returns.buyBack);
    const r = resolve(start, [[], []], [[buy('0-1')], []]);
    expect(ofType(r.events, 'purchase')).toEqual([{ t: 'purchase', player: 0, unit: '0-1', cost: 12 }]);
    expect(ofType(r.playerEvents[1], 'purchase')).toEqual(ofType(r.events, 'purchase'));   // told to everyone
    expect(ofType(r.events, 'return')).toEqual([{ t: 'return', unit: '0-1', at: h(0) }]);
    expect(r.state.scores).toEqual([12 + 1 - 12, 1]);
    const after = r.events.slice(r.events.findIndex((e) => e.t === 'phase' && e.phase === 'score') + 1).filter((e) => e.t !== 'dig').map((e) => e.t);
    expect(after).toEqual(['score', 'score', 'purchase', 'return']);
  });

  it('purchases that cannot be made are dropped, one by one, as orders are', () => {
    const start = game(map, [u('0-0', 'rifleman', 4), downed('0-1', 6, 5), downed('0-2', 7, 5), u('1-0', 'rifleman', 9)], { ...held, scores: [13, 0] });
    expect(validatePurchases(start, 0, [buy('0-1'), buy('0-2')]).map((e) => e.reason)).toEqual(['not enough supply']);
    expect(validatePurchases(start, 0, [buy('0-1'), buy('0-1')]).map((e) => e.reason)).toEqual(['bought back twice']);
    expect(validatePurchases(start, 0, [buy('0-0')]).map((e) => e.reason)).toEqual(['unit is not down']);
    expect(validatePurchases(start, 0, [buy('1-0')]).map((e) => e.reason)).toEqual(['not your unit']);
    expect(validatePurchases({ ...start, flags: { W: 1, X: 1 } }, 0, [buy('0-1')]).map((e) => e.reason)).toEqual(['your line is cut: retake your HQ']);
    expect(validatePurchases({ ...start, mode: 'last-stand' }, 0, [buy('0-1')]).map((e) => e.reason)).toEqual(['No supply in this mode.']);
    expect(buyBackCost({ ...start, round: 5 }, '0-1')).toBeNull();      // due this round anyway
    const r = resolve(start, [[], []], [[buy('0-1'), buy('0-2'), buy('1-0')], [buy('0-1')]]);
    expect(ofType(r.events, 'purchase')).toEqual([{ t: 'purchase', player: 0, unit: '0-1', cost: 12 }]);
    expect(r.state.scores).toEqual([13 + 1 - 12, 1]);
  });

  it('a purchase whose line is cut in the round itself is not paid', () => {
    // Plum walks into W, where Blue has nobody: the line is cut at capture, before purchases.
    const start = game(map, [u('0-0', 'rifleman', 6), downed('0-1', 7, 5), u('1-0', 'rifleman', 2)], { ...held, scores: [12, 0] });
    const r = resolve(start, [[], [move('1-0', h(1))]], [[buy('0-1')], []]);
    expect(r.state.flags.W).toBe(1);
    expect(ofType(r.events, 'purchase')).toEqual([]);
    expect(r.state.scores[0]).toBe(12);
  });

  it('a return is told to its owner and to whoever sees the hex, who then also spot him', () => {
    const start = game(map, [u('0-0', 'rifleman', 5), downed('0-1', 6, 3), u('1-0', 'rifleman', 4)], held);
    const r = run(start, []);
    const ret = { t: 'return', unit: '0-1', at: h(0) };
    expect(ofType(r.playerEvents[0], 'return')).toEqual([ret]);
    expect(ofType(r.playerEvents[1], 'return')).toEqual([ret]);
    expect(ofType(r.playerEvents[1], 'spotted').map((e) => e.unit.id)).toContain('0-1');
    expect(viewFor(r.state, 1).units.map((x) => x.id)).toContain('0-1');
    // Out of sight: Plum is told nothing.
    const far = run(game(map, [u('0-0', 'rifleman', 5), downed('0-1', 6, 3), u('1-0', 'rifleman', 11)], held), []);
    expect(ofType(far.playerEvents[1], 'return')).toEqual([]);
  });
});

describe('Last Stand (20)', () => {
  const map = field(12, 1, {}, { objectives: [obj('V', 3, [h(5)])], maxRounds: 9 });
  const last = (units: Unit[], extra: Partial<GameState> = {}) => game(map, units, { mode: 'last-stand', ...extra });
  const rifle = (id: UnitId, q: number, extra: Partial<Unit> = {}) => u(id, 'rifleman', q, 0, extra);
  const pinned = { status: 'pinned' as const, pinnedRound: 7 };
  const buy = (unit: UnitId) => ({ kind: 'return' as const, unit });

  it('reads its switches from the mode, not from its name', async () => {
    const { MODES } = await import('../content');
    expect(MODES['last-stand']).toMatchObject({ supply: false, returns: null, win: 'survival' });
    MODES['test-mode'] = { ...MODES['last-stand'], id: 'test-mode', name: 'Test' };
    try {
      const r = run(game(map, [rifle('0-0', 5), rifle('1-0', 11)], { mode: 'test-mode' }), []);
      expect(ofType(r.events, 'score')).toEqual([]);
      expect(r.state.scores).toEqual([1, 1]);
    } finally { delete MODES['test-mode']; }
  });

  it('flags are still captured, but nothing earns: no score events, no supply', () => {
    const r = run(last([rifle('0-0', 5), rifle('1-0', 11)]), []);
    expect(ofType(r.events, 'capture')).toEqual([{ t: 'capture', objective: 'V', player: 0, from: null }]);
    expect(r.state.flags.V).toBe(0);
    expect(ofType(r.events, 'score')).toEqual([]);
    const again = run(r.state, []);                     // held, and still nothing
    expect(ofType(again.events, 'score')).toEqual([]);
    // The same board in Supply Line pays.
    expect(ofType(run(game(map, [rifle('0-0', 5), rifle('1-0', 11)]), []).events, 'score')).toHaveLength(1);
  });

  it('every purchase is invalid, and a purchase sent anyway is never paid', () => {
    const start = last([rifle('0-0', 5), rifle('0-1', 4, { status: 'down' }), rifle('1-0', 11)], { scores: [9, 1] });
    expect(validatePurchases(start, 0, [buy('0-1')]).map((e) => e.reason)).toEqual(['No supply in this mode.']);
    expect(validatePurchases(start, 0, [buy('0-0')]).map((e) => e.reason)).toEqual(['No supply in this mode.']);
    expect(buyBackCost(start, '0-1')).toBeNull();
    const r = resolve(start, [[], []], [[buy('0-1')], []]);
    expect(ofType(r.events, 'purchase')).toEqual([]);
    expect(unitIn(r.state, '0-1')).toMatchObject({ status: 'down', returnRound: null });
  });

  it('down is final: nobody returns, and the score is the men standing, with no event', () => {
    const start = last([rifle('0-0', 4), rifle('0-1', 3), rifle('1-0', 6, pinned), rifle('1-1', 11)], DAY);
    const r = run(start, [fire('0-0', 6)]);
    expect(hits(r.events)).toEqual(['1-0 down']);
    expect(unitIn(r.state, '1-0')).toMatchObject({ status: 'down', returnRound: null });
    expect(r.state.scores).toEqual([2, 1]);
    expect(ofType(r.events, 'score')).toEqual([]);
    // Rounds on, he is still down.
    const later = run({ ...r.state, round: 6 }, []);
    expect(unitIn(later.state, '1-0').status).toBe('down');
    expect(ofType(later.events, 'return')).toEqual([]);
  });

  it('a squad with no men left is out and the match is over: the other wins', () => {
    const start = last([rifle('0-0', 0), rifle('1-0', 2, pinned), rifle('1-1', 11)], DAY);
    const alone = run(start, [fire('0-0', 2)]);
    expect(alone.state.eliminated).toEqual([false, false]);          // one man left each: it goes on
    const r = run(last([rifle('0-0', 0), rifle('1-0', 2, pinned)], DAY), [fire('0-0', 2)]);
    expect(r.state.eliminated).toEqual([false, true]);
    expect(r.state.over).toBe(true);
    expect(r.state.winners).toEqual([0]);
    expect(r.state.scores).toEqual([1, 0]);
  });

  it('after maxRounds the most men win', () => {
    const end = { round: map.maxRounds };
    const r = run(last([rifle('0-0', 0), rifle('0-1', 1), rifle('1-0', 10), rifle('1-1', 11), rifle('1-2', 9)], end), []);
    expect(r.state.over).toBe(true);
    expect(r.state.scores).toEqual([2, 3]);
    expect(r.state.winners).toEqual([1]);
    expect(viewFor(r.state, 0).worth).toEqual([2 * UNITS.rifleman.cost, 3 * UNITS.rifleman.cost]);
    // Not over before its time, and no `worth` until it is.
    const mid = run(last([rifle('0-0', 0), rifle('1-0', 11)]), []);
    expect(mid.state.over).toBe(false);
    expect(viewFor(mid.state, 0).worth).toBeUndefined();
    expect(viewFor(run(game(map, [rifle('0-0', 0), rifle('1-0', 11)], end), []).state, 0).worth).toBeUndefined();   // Supply Line
  });

  it('level on men, the dearer men win: a gunner is worth more than a rifleman', () => {
    const end = { round: map.maxRounds };
    const r = run(last([rifle('0-0', 0), rifle('0-1', 1), rifle('1-0', 10), u('1-1', 'gunner', 11)], end), []);
    expect(r.state.scores).toEqual([2, 2]);
    expect(r.state.winners).toEqual([1]);
    expect(viewFor(r.state, 0).worth).toEqual([2 * UNITS.rifleman.cost, UNITS.rifleman.cost + UNITS.gunner.cost]);
  });

  it('level on men and on cost, they share the win', () => {
    const end = { round: map.maxRounds };
    const r = run(last([rifle('0-0', 0), rifle('0-1', 1), rifle('1-0', 10), rifle('1-1', 11)], end), []);
    expect(r.state.winners).toEqual([0, 1]);
  });

  it('the dearer men count only if they stand: the tie-break is of the living', () => {
    const end = { round: map.maxRounds };
    const r = run(last([rifle('0-0', 0), u('0-1', 'gunner', 1, 0, { status: 'down' }), rifle('1-0', 10), rifle('1-1', 11)], end), []);
    expect(r.state.scores).toEqual([1, 2]);
    expect(r.state.winners).toEqual([1]);
  });

  it('if the last squads lose their last men in the same round, every squad not already out shares the win', () => {
    // Two players, both wiped in the same round (two gunners a side, each pair bursting the other's): both share.
    const g = (id: UnitId, q: number, extra: Partial<Unit> = {}) => u(id, 'gunner', q, 0, extra);
    const volley = [fire('0-0', 8), fire('0-1', 8), fire('1-0', 3), fire('1-1', 3)];
    const duel = run(last([g('0-0', 3), g('0-1', 4), g('1-0', 7), g('1-1', 8)], DAY), volley);
    expect(hits(duel.events).filter((x) => x.endsWith('down')).sort()).toEqual(['0-0 down', '0-1 down', '1-0 down', '1-1 down']);
    expect(duel.state.eliminated).toEqual([true, true]);
    expect(duel.state.over).toBe(true);
    expect(duel.state.scores).toEqual([0, 0]);
    expect(duel.state.winners).toEqual([0, 1]);
    expect(viewFor(duel.state, 0).worth).toEqual([0, 0]);
    // Three players, seat 2 already out: the two that fell together share; the one that fell before does not.
    const out = { ...DAY, playerCount: 3, eliminated: [false, false, true] };
    const three = run(last([g('0-0', 3), g('0-1', 4), g('1-0', 7), g('1-1', 8), rifle('2-0', 11, { status: 'down' })], out), volley);
    expect(three.state.over).toBe(true);
    expect(three.state.eliminated).toEqual([true, true, true]);
    expect(three.state.winners).toEqual([0, 1]);
    // Three players, one standing at the end of it: the standing squad wins alone.
    const one = run(last([g('0-0', 3), g('0-1', 4), g('1-0', 7), g('1-1', 8), rifle('2-0', 11)], { ...DAY, playerCount: 3 }), volley);
    expect(one.state.over).toBe(true);
    expect(one.state.winners).toEqual([2]);
  });
});

describe('the rising sun (19)', () => {
  const map = field(12, 1);
  it('a sniper still reaches 8, but fires on his own sight only at what he sees in this light', () => {
    const at = (round: number) => game(map, [u('0-0', 'sniper', 0), u('1-0', 'rifleman', 11)], { round });
    // round 1: sight 5. Range 8 is unchanged, but beyond 5 the `own` rule fails.
    expect(validateOrders(at(1), 0, [fire('0-0', 5)])).toEqual([]);
    expect(validateOrders(at(1), 0, [fire('0-0', 6)]).map((e) => e.reason)).toEqual(['the target is beyond his sight (5)']);
    expect(validateOrders(at(7), 0, [fire('0-0', 8)])).toEqual([]);
    expect(validateOrders(at(7), 0, [fire('0-0', 9)]).map((e) => e.reason)).toEqual(['target is out of range']);
    const fires = (round: number) => orderOptions(viewFor(at(round), 0), '0-0').fire.map((k) => Number(k.split(',')[0])).sort((a, b) => a - b);
    expect(fires(1)).toEqual([2, 3, 4, 5]);
    expect(fires(3)).toEqual([2, 3, 4, 5, 6]);
    expect(fires(7)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });
  it('the mortar\'s `squad` rule follows what the squad sees in this light', () => {
    const s = (round: number) => game(field(14, 1), [u('0-0', 'mortar', 0), u('0-1', 'rifleman', 4), u('1-0', 'rifleman', 13)], { round });
    // A spotter at 4 sees to 7 at first light and to 10 in full day.
    expect(validateOrders(s(1), 0, [fire('0-0', 7)])).toEqual([]);
    expect(validateOrders(s(1), 0, [fire('0-0', 8)]).map((e) => e.reason)).toEqual(['no friendly unit can see the target']);
    expect(validateOrders(s(7), 0, [fire('0-0', 10)])).toEqual([]);
  });
  it('an ambusher sees by the light of the round being resolved', () => {
    // A rifleman on ambush at 0; the enemy steps from 5 to 4. Round 3: sight 4, he fires. Round 1: sight 3, nothing.
    const play = (round: number) => run(game(map, [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 5)], { round }), [ambush('0-0'), move('1-0', h(4))]);
    expect(ofType(play(3).events, 'fire').map((e) => e.unit)).toEqual(['0-0']);
    expect(ofType(play(1).events, 'fire')).toEqual([]);
  });
  it('when the light grows at the round\'s end, what comes into reach is `spotted`, and the events add up to the view', () => {
    // Round 2 is planned at sight 3, round 3 at sight 4: a man standing 4 away is seen only once round 2 is over.
    const start = game(map, [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 4)], { round: 2 });
    expect(viewFor(start, 0).units.map((x) => x.id)).toEqual(['0-0']);
    const r = run(start, []);
    const told = r.playerEvents[0].filter((e) => e.t !== 'phase' && e.t !== 'dig');
    expect(told.map((e) => e.t)).toEqual(['spotted']);
    expect(viewFor(r.state, 0).units.map((x) => x.id)).toEqual(['0-0', '1-0']);
    expect(sightOf(r.state, r.state.units[0])).toBe(4);
  });
});

describe('objective kinds (21)', () => {
  // A row of open ground. Each kind's area is two hexes, 0 and 1; whoever's flag it is benefits standing there.
  const kindMap = (kind: string, value = 1) => field(16, 1, {}, { objectives: [obj('K', value, [h(0), h(1)], { kind })], maxRounds: 20 });
  const held = (kind: string, units: Unit[], owner: number | null = 0, extra: Partial<GameState> = {}) =>
    game(kindMap(kind), units, { ...DAY, flags: { K: owner }, ...extra });
  const rifle = (id: UnitId, q: number, extra: Partial<Unit> = {}) => u(id, 'rifleman', q, 0, extra);
  const path = (from: number, steps: number) => Array.from({ length: steps }, (_, i) => h(from + i + 1));

  it('the table: hq gives nothing; village supply 1; hill sight 2; crossroads move 1; depot supply 2 and rally', async () => {
    const { OBJECTIVE_KINDS } = await import('../content');
    const table = Object.fromEntries(Object.values(OBJECTIVE_KINDS).map((k) => [k.id, [k.sight, k.move, k.supply, k.rally]]));
    expect(table).toEqual({
      hq: [0, 0, 0, false], village: [0, 0, 1, false], hill: [2, 0, 0, false], crossroads: [0, 1, 0, false], depot: [0, 0, 2, true],
    });
  });

  it('hq: a unit on its own HQ gains nothing; the flag earns its value', () => {
    const s = held('hq', [rifle('0-0', 0), rifle('1-0', 15)]);
    expect(benefitOf(s, unitIn(s, '0-0'))?.objective.id).toBe('K');
    expect(sightOf(s, unitIn(s, '0-0'))).toBe(UNITS.rifleman.sight);
    expect(moveOf(s, unitIn(s, '0-0'))).toBe(UNITS.rifleman.move);
    expect(ofType(run(s, []).events, 'score')).toEqual([{ t: 'score', objective: 'K', player: 0, value: 1 }]);
  });

  it('village: the flag earns value + 1, in one score event, whether or not anyone stands there; nothing in Last Stand', () => {
    const s = held('village', [rifle('0-0', 5), rifle('1-0', 15)]);
    expect(ofType(run(s, []).events, 'score')).toEqual([{ t: 'score', objective: 'K', player: 0, value: 2 }]);
    expect(run(s, []).state.scores).toEqual([2, 0]);
    expect(ofType(run({ ...s, mode: 'last-stand' }, []).events, 'score')).toEqual([]);
  });

  it('hill: its holder\'s men on it see 2 further; an enemy on it, or anyone on a hill nobody holds, does not', () => {
    const sight = UNITS.rifleman.sight;
    const s = held('hill', [rifle('0-0', 1), rifle('1-0', 1 + sight + 2)]);
    expect(sightOf(s, unitIn(s, '0-0'))).toBe(sight + 2);
    expect(visibleEnemies(s, 0).map((x) => x.id)).toEqual(['1-0']);
    expect(viewFor(s, 0).visible).toContain(`${1 + sight + 2},0`);
    const nobody = held('hill', s.units, null);
    expect(sightOf(nobody, unitIn(nobody, '0-0'))).toBe(sight);
    expect(visibleEnemies(nobody, 0)).toEqual([]);
    const theirs = held('hill', s.units, 1);
    expect(benefitOf(theirs, unitIn(theirs, '0-0'))).toBeNull();
    expect(sightOf(theirs, unitIn(theirs, '0-0'))).toBe(sight);
    // The hill adds to the light's sight; the light's minimum of 1 is applied first (round 1, sun −3).
    expect(sightOf({ ...s, round: 1 }, unitIn(s, '0-0'))).toBe(Math.max(1, sight - 3) + 2);
  });

  it('crossroads: a unit that begins the round in the area moves one further, and dashes two further', () => {
    const move = UNITS.rifleman.move;
    const s = held('crossroads', [rifle('0-0', 1), rifle('0-1', 2), rifle('1-0', 15)]);
    expect(moveOf(s, unitIn(s, '0-0'))).toBe(move + 1);
    expect(moveOf(s, unitIn(s, '0-1'))).toBe(move);                     // one hex outside: nothing
    expect(validateOrders(s, 0, [{ unit: '0-0', kind: 'move', path: path(1, move + 1) }])).toEqual([]);
    expect(validateOrders(s, 0, [{ unit: '0-0', kind: 'dash', path: path(1, 2 * (move + 1)) }])).toEqual([]);
    expect(validateOrders(s, 0, [{ unit: '0-0', kind: 'move', path: path(1, move + 2) }])).toHaveLength(1);
    expect(validateOrders(s, 0, [{ unit: '0-1', kind: 'move', path: path(2, move + 1) }])).toHaveLength(1);
    const r = run(s, [{ unit: '0-0', kind: 'dash', path: path(1, 2 * (move + 1)) }]);
    expect(unitIn(r.state, '0-0').pos).toEqual(h(1 + 2 * (move + 1)));
    // Not the holder's: nothing.
    const theirs = held('crossroads', s.units, 1);
    expect(validateOrders(theirs, 0, [{ unit: '0-0', kind: 'move', path: path(1, move + 1) }])).toHaveLength(1);
  });

  it('orderOptions on a held crossroads reach one hex (two for a dash) further, from the view', () => {
    const move = UNITS.rifleman.move;
    const s = held('crossroads', [rifle('0-0', 1), rifle('1-0', 15)]);
    const far = (keys: string[]) => Math.max(...keys.map((k) => Number(k.split(',')[0]) - 1));
    const opts = orderOptions(viewFor(s, 0), '0-0');
    expect(far(opts.move)).toBe(move + 1);
    expect(far(opts.dash)).toBe(2 * (move + 1));
    const plain = orderOptions(viewFor(held('crossroads', s.units, null), 0), '0-0');
    expect(far(plain.move)).toBe(move);
    expect(far(plain.dash)).toBe(2 * move);
  });

  it('a unit that walks into a crossroads gets no more that round; one that leaves loses the gift the next round', () => {
    const move = UNITS.rifleman.move;
    // Walks in: judged from where it began, outside. (The rifleman's move is 2.)
    expect(move).toBe(2);
    const s = held('crossroads', [rifle('0-0', 3), rifle('1-0', 15)]);
    expect(validateOrders(s, 0, [{ unit: '0-0', kind: 'move', path: [h(2), h(1), h(0)] }])).toHaveLength(1);
    const inside = run(s, [{ unit: '0-0', kind: 'move', path: [h(2), h(1)] }]).state;
    expect(moveOf(inside, unitIn(inside, '0-0'))).toBe(3);              // from the next round on
    // Leaves: the long move is legal from inside, and once out the next round's allowance is the plain one.
    const start = held('crossroads', [rifle('0-0', 1), rifle('1-0', 15)]);
    const out = run(start, [{ unit: '0-0', kind: 'move', path: path(1, move + 1) }]).state;
    expect(unitIn(out, '0-0').pos).toEqual(h(2 + move));
    expect(out.flags.K).toBe(0);
    expect(moveOf(out, unitIn(out, '0-0'))).toBe(move);
    expect(validateOrders(out, 0, [{ unit: '0-0', kind: 'move', path: path(2 + move, move + 1) }])).toHaveLength(1);
  });

  it('a unit that leaves a hill sees as far as its type again, from the next round', () => {
    const sight = UNITS.rifleman.sight;
    const start = held('hill', [rifle('0-0', 1), rifle('1-0', 15)]);
    const out = run(start, [{ unit: '0-0', kind: 'move', path: [h(2)] }]).state;
    expect(sightOf(out, unitIn(out, '0-0'))).toBe(sight);
  });

  it('depot: earns value + 2; a pinned unit on its holder\'s depot rallies in the round it was pinned', () => {
    // 1-0 fires at 0-0 on the depot: pinned, and back on his feet at the round's end.
    const s = held('depot', [rifle('0-0', 1), rifle('1-0', 4)]);
    const r = run(s, [fire('1-0', 1)]);
    expect(hits(r.events)).toEqual(['0-0 pinned']);
    expect(ofType(r.events, 'recover')).toEqual([{ t: 'recover', unit: '0-0' }]);
    expect(unitIn(r.state, '0-0')).toMatchObject({ status: 'ready', pinnedRound: null });
    expect(ofType(r.events, 'score')).toEqual([{ t: 'score', objective: 'K', player: 0, value: 3 }]);
    // The rally comes after the capture: a pinned man does not take a flag, but he rallies on one already his.
    expect(r.events.findIndex((e) => e.t === 'recover')).toBeGreaterThan(r.events.findIndex((e) => e.t === 'score'));
    // Nobody's depot, or the enemy's: no rally, as before.
    for (const owner of [null, 1]) {
      const other = run(held('depot', s.units, owner), [fire('1-0', 1)]);
      expect(ofType(other.events, 'recover')).toEqual([]);
      expect(unitIn(other.state, '0-0').status).toBe('pinned');
    }
    // Off the area, one hex from it: no rally.
    const beside = run(held('depot', [rifle('0-0', 2), rifle('1-0', 5)]), [fire('1-0', 2)]);
    expect(ofType(beside.events, 'recover')).toEqual([]);
  });
});

describe('dig in (24)', () => {
  // Blue's riflemen fire at one man of Plum, who stands on 3,1 with the ground the test gives him.
  const squad = [u('0-0', 'rifleman', 0, 1), u('0-1', 'rifleman', 1, 0), u('0-2', 'rifleman', 1, 2), u('0-3', 'rifleman', 2, 0)];
  const volley = (n: number) => squad.slice(0, n).map((s) => fire(s.id, 3, 1));
  const shot = (ground: string, dugIn: boolean, n: number) =>
    hits(run(game(field(8, 3, ground ? { '3,1': ground } : {}), [...squad, u('1-0', 'rifleman', 3, 1, { dugIn })]), volley(n)).events);

  it('a man who held still a whole round is dug in at its end, with a `dig` event told to those who see him', () => {
    const start = game(field(10, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 9)]);
    const r = run(start, []);
    expect(ofType(r.events, 'dig')).toEqual([{ t: 'dig', unit: '0-0' }, { t: 'dig', unit: '1-0' }]);
    expect(unitIn(r.state, '0-0').dugIn).toBe(true);
    expect(viewFor(r.state, 0).units.find((x) => x.id === '0-0')?.dugIn).toBe(true);
    // 1-0 is out of sight: Blue is not told, and does not see him.
    expect(ofType(r.playerEvents[0], 'dig')).toEqual([{ t: 'dig', unit: '0-0' }]);
    expect(viewFor(r.state, 0).units.map((x) => x.id)).toEqual(['0-0']);
    // Already dug in: no second event, and he stays dug in.
    const again = run(r.state, []);
    expect(ofType(again.events, 'dig')).toEqual([]);
    expect(unitIn(again.state, '0-0').dugIn).toBe(true);
  });

  it('a pinned man who holds still digs in too; a man who was down at the start of the round does not', () => {
    const start = game(field(10, 1), [u('0-0', 'rifleman', 0, 0, { status: 'pinned', pinnedRound: 3 }), u('0-1', 'rifleman', 1, 0, { status: 'down' }), u('1-0', 'rifleman', 9)]);
    const r = run(start, []);
    expect(ofType(r.events, 'dig').map((e) => e.unit)).toEqual(['0-0', '1-0']);
    expect(unitIn(r.state, '0-1').dugIn).toBe(false);
  });

  it('the hit rule: the ground and the foxhole each turn aside one hit a round', () => {
    expect(shot('', false, 3)).toEqual(['1-0 pinned', '1-0 down']);                        // open ground, not dug in: nothing
    expect(shot('', true, 3)).toEqual(['1-0 cover', '1-0 pinned', '1-0 down']);            // dug in: one
    expect(shot('b', false, 3)).toEqual(['1-0 cover', '1-0 pinned', '1-0 down']);          // a building: one
    expect(shot('b', true, 3)).toEqual(['1-0 cover', '1-0 cover', '1-0 pinned']);          // both: two
    expect(shot('b', true, 4)).toEqual(['1-0 cover', '1-0 cover', '1-0 pinned', '1-0 down']);
    expect(shot('=', true, 2)).toEqual(['1-0 cover', '1-0 cover']);                        // a wall is cover too
    expect(shot('w', true, 2)).toEqual(['1-0 cover', '1-0 pinned']);                       // woods are not
  });

  it('a hit that ignores cover (the sniper\'s) ignores the foxhole too, and uses neither up', () => {
    const map = field(8, 3, { '3,1': 'b' });
    const start = game(map, [u('0-0', 'sniper', 0, 1), u('0-1', 'rifleman', 1, 0), u('0-2', 'rifleman', 1, 2), u('1-0', 'rifleman', 3, 1, { dugIn: true })]);
    const r = run(start, [fire('0-0', 3, 1), fire('0-1', 3, 1), fire('0-2', 3, 1)]);
    expect(hits(r.events)).toEqual(['1-0 pinned', '1-0 cover', '1-0 cover']);
    expect(unitIn(r.state, '1-0').status).toBe('pinned');
  });

  it('the foxhole is back every round', () => {
    const start = game(field(8, 3), [...squad, u('1-0', 'rifleman', 3, 1, { dugIn: true })]);
    const one = run(start, volley(1));
    expect(hits(one.events)).toEqual(['1-0 cover']);
    expect(hits(run(one.state, volley(1)).events)).toEqual(['1-0 cover']);
  });

  it('a runner is never dug in: he gives it up as he breaks into the dash, and goes down from one hit', () => {
    const start = game(field(8, 3), [...squad, u('1-0', 'rifleman', 3, 1, { dugIn: true })]);
    const r = run(start, [...volley(1), dash('1-0', h(4, 1), h(5, 1))]);
    expect(hits(r.events)).toEqual(['1-0 down']);
    expect(unitIn(r.state, '1-0').dugIn).toBe(false);
    const free = run(game(field(8, 1), [u('0-0', 'rifleman', 0, 0, { dugIn: true }), u('1-0', 'rifleman', 7)]), [dash('0-0', h(1), h(2))]);
    expect(unitIn(free.state, '0-0')).toMatchObject({ dugIn: false, posture: 'dashed', pos: h(2) });
    expect(ofType(free.events, 'dig').map((e) => e.unit)).toEqual(['1-0']);
  });

  it('his first step leaves the foxhole: shots of the fire phase still find him in it, later ones in the open', () => {
    const start = game(field(8, 3), [...squad, u('1-0', 'rifleman', 3, 1, { dugIn: true })]);
    const r = run(start, [...volley(1), move('1-0', h(4, 1))]);
    expect(hits(r.events)).toEqual(['1-0 cover']);
    expect(unitIn(r.state, '1-0')).toMatchObject({ dugIn: false, posture: 'moved', pos: h(4, 1) });
    expect(ofType(r.events, 'dig').map((e) => e.unit)).not.toContain('1-0');
    // The follow-up of a rifleman who walks up lands after the step: no foxhole, no cover on open ground.
    const late = run(start, [fire('0-0', 3, 1), then(move('0-1', h(2, 0)), 'fire', 4, 1), move('1-0', h(4, 1))]);
    expect(hits(late.events)).toEqual(['1-0 cover', '1-0 pinned']);
  });

  it('and he digs in again at the end of the next round he holds still', () => {
    const start = game(field(8, 1), [u('0-0', 'rifleman', 0, 0, { dugIn: true }), u('1-0', 'rifleman', 7)]);
    const out = run(start, [move('0-0', h(1))]).state;
    expect(unitIn(out, '0-0').dugIn).toBe(false);
    const again = run(out, []);
    expect(ofType(again.events, 'dig')).toContainEqual({ t: 'dig', unit: '0-0' });
    expect(unitIn(again.state, '0-0').dugIn).toBe(true);
  });

  it('a move that never takes a step (a pinned man, a blocked one) keeps the foxhole', () => {
    const pinned = game(field(8, 1), [u('0-0', 'rifleman', 0, 0, { dugIn: true, status: 'pinned', pinnedRound: 3 }), u('1-0', 'rifleman', 7)]);
    expect(unitIn(run(pinned, [move('0-0', h(1))]).state, '0-0')).toMatchObject({ dugIn: true, pos: h(0) });
    // Two enemies mean to enter the same hex at once: neither steps.
    const blocked = game(field(8, 1), [u('0-0', 'rifleman', 2, 0, { dugIn: true }), u('1-0', 'rifleman', 4)]);
    const r = run(blocked, [move('0-0', h(3)), move('1-0', h(3))]);
    expect(ofType(r.events, 'blocked').length).toBe(2);
    expect(unitIn(r.state, '0-0')).toMatchObject({ dugIn: true, pos: h(2) });
  });

  it('a man who goes down is no longer dug in; one who is back this round is not dug in either', () => {
    const start = game(field(8, 3), [...squad, u('1-0', 'rifleman', 3, 1, { dugIn: true })]);
    const r = run(start, volley(3));
    expect(hits(r.events)).toEqual(['1-0 cover', '1-0 pinned', '1-0 down']);
    expect(unitIn(r.state, '1-0')).toMatchObject({ status: 'down', dugIn: false });
    expect(ofType(r.events, 'dig').map((e) => e.unit)).not.toContain('1-0');

    const strip = field(12, 1, {}, {
      objectives: [obj('W', 1, [h(0), h(1)], { kind: 'hq', zone: 0 }), obj('X', 1, [h(10), h(11)], { kind: 'hq', zone: 1 })],
      spawns: [[h(2), h(3)], [h(9), h(8)]], seatSpawns: { 2: [0, 1] }, maxRounds: 20,
    });
    const back = run(game(strip, [u('0-0', 'rifleman', 5), u('0-1', 'rifleman', 5, 0, { status: 'down', returnRound: 3 }), u('1-0', 'rifleman', 9)], { flags: { W: 0, X: 1 } }), []);
    expect(ofType(back.events, 'return').length).toBe(1);
    expect(ofType(back.events, 'dig').map((e) => e.unit)).not.toContain('0-1');
    expect(unitIn(back.state, '0-1')).toMatchObject({ status: 'ready', dugIn: false });
    expect(unitIn(run(back.state, []).state, '0-1').dugIn).toBe(true);   // he digs in at the end of the next round, if he stays
  });

  it('comes in the score phase after the captures and returns, before the recoveries; Supply Line and Last Stand alike', () => {
    for (const mode of ['supply-line', 'last-stand']) {
      const start = game(field(10, 1), [u('0-0', 'rifleman', 0), u('0-1', 'rifleman', 1, 0, { status: 'pinned', pinnedRound: 2 }), u('1-0', 'rifleman', 9)], { mode });
      const r = run(start, []);
      const after = r.events.slice(r.events.findIndex((e) => e.t === 'phase' && e.phase === 'score') + 1).map((e) => (e.t === 'dig' ? `dig ${e.unit}` : e.t));
      expect(after).toEqual(['dig 0-0', 'dig 0-1', 'dig 1-0', 'recover']);
      expect(unitIn(r.state, '0-1')).toMatchObject({ status: 'ready', dugIn: true });
    }
  });

  it('is part of what a player sees: viewFor shows `dugIn` of every unit it shows', () => {
    const start = game(field(10, 1), [u('0-0', 'rifleman', 0), u('1-0', 'rifleman', 3, 0, { dugIn: true })]);
    expect(viewFor(start, 0).units.map((x) => [x.id, x.dugIn])).toEqual([['0-0', false], ['1-0', true]]);
  });
});
