// The proof that behaviour is data: two actions and a unit that exist only in
// this file are played through the real rules and the client's pure helpers.
// Nothing in src/rules or src/client knows them. If this test needs a change
// outside src/content to pass, actions are no longer data.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS, UNITS } from '../../content';
import { actionOf, orderOptions, resolve, validateOrders, viewFor, visibleEnemies } from '../../rules';
import { key } from '../../shared/hex';
import type { ActionDef, GameEvent, GameMap, GameState, Hex, Order, Unit, UnitDef, UnitId, UnitTypeId } from '../../shared/types';
import { actionIcon, actionName, friendlyFire, orderLabel, ownUnitsUnderFire } from './draft';
import { teller } from './lines';
import { actionLines } from './squad';

const FLARE: ActionDef = {
  id: 'flare', name: 'Flare', blurb: 'Lights up a hex and the six around it. Whoever is there is seen.',
  icon: 'flare', phase: 'treat',
  range: 4, minRange: 1, sight: 'none', needs: 'any', affects: 'all', blast: 1,
  effects: [{ kind: 'reveal' }],
  reveals: false, mobile: true,
};
const SHOCK: ActionDef = {
  id: 'shock', name: 'Shock round', blurb: 'One heavy round onto a hex he can see. It lands after movement and hits twice.',
  icon: 'shock', phase: 'mortar',
  range: 6, minRange: 2, sight: 'own', needs: 'any', affects: 'all', blast: 0,
  effects: [{ kind: 'hit' }, { kind: 'hit' }],
  reveals: true, mobile: true,
};
const PIONEER: UnitDef = {
  id: 'pioneer', name: 'Pioneer', rank: 'Spr.', blurb: 'A test unit: a flare pistol and a heavy tube.',
  cost: 3, max: 1, move: 2, sight: 6, spotting: 0,
  orders: ['move', 'fire', 'ambush', 'special'],     // `ambush` is listed, but his weapon lands late: he may not
  fire: 'shock', special: 'flare',
};

beforeAll(() => {
  ACTIONS.flare = FLARE;
  ACTIONS.shock = SHOCK;
  UNITS.pioneer = PIONEER;
});
afterAll(() => {
  delete ACTIONS.flare;
  delete ACTIONS.shock;
  delete ACTIONS.scratch;
  delete UNITS.pioneer;
});

// ---- a strip of open ground; `spec` overrides hexes by "q,r": w = woods, b = building
function field(cols: number, rows: number, spec: Record<string, string> = {}): GameMap {
  const cells: GameMap['cells'] = {};
  for (let q = 0; q < cols; q++) {
    for (let r = 0; r < rows; r++) cells[`${q},${r}`] = { terrain: spec[`${q},${r}`] === 'w' ? 'woods' : spec[`${q},${r}`] === 'b' ? 'building' : 'open', elevation: 0 };
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
function run(state: GameState, orders: Order[]) {
  const bySeat: Order[][] = [[], []];
  for (const o of orders) bySeat[Number(o.unit.split('-')[0])].push(o);
  for (const p of [0, 1]) expect(validateOrders(state, p, bySeat[p])).toEqual([]);
  return resolve(state, bySeat);
}
const names = (events: GameEvent[]): string[] => events.map((e) => (e.t === 'phase' ? `(${e.phase})` : e.t === 'hit' ? `hit ${e.unit} ${e.result}` : e.t));
const unitIn = (s: GameState, id: UnitId) => s.units.find((x) => x.id === id)!;

describe('a new action is a new entry in the data', () => {
  it('the rules find the unit\'s actions by its orders, and refuse an ambush with a weapon that lands late', () => {
    expect(actionOf('pioneer', 'fire')).toBe(SHOCK);
    expect(actionOf('pioneer', 'special')).toBe(FLARE);
    expect(actionOf('pioneer', 'ambush')).toBeNull();
    const state = game(field(9, 1), [u('0-0', 'pioneer', 0), u('1-0', 'rifleman', 8)]);
    expect(orderOptions(viewFor(state, 0), '0-0').kinds).toEqual(['move', 'fire', 'special']);
    expect(validateOrders(state, 0, [{ unit: '0-0', kind: 'ambush' }]).map((e) => e.unit)).toEqual(['0-0']);
  });

  it('flare: lands before anyone fires, needs no sight, and shows whoever is under it', () => {
    // Two enemies lie in two woods next to each other, 3 and 4 hexes from the nearest watcher.
    const map = field(9, 2, { '4,0': 'w', '3,1': 'w' });
    const state = game(map, [u('0-0', 'pioneer', 0), u('0-1', 'rifleman', 1), u('1-0', 'rifleman', 4), u('1-1', 'rifleman', 3, 1)]);
    expect(visibleEnemies(state, 0).map((x) => x.id)).toEqual([]);          // both lie hidden in the woods

    const opts = orderOptions(viewFor(state, 0), '0-0');
    // Every hex 1 to 4 away, in sight or not: the far side of the woods included.
    expect(opts.special).toContain(key(h(4)));
    expect(opts.special).not.toContain(key(h(0)));
    expect(opts.special).not.toContain(key(h(5)));
    expect(opts.special.length).toBe(4 + 4);                                 // two rows of a strip

    const r = run(state, [
      { unit: '0-0', kind: 'special', target: h(4) },
      { unit: '0-1', kind: 'fire', target: h(4) },                           // a rifle, at the hex the flare lights
    ]);
    // The flare lands in the first phase; the rifleman, who planned blind, then fires at a man everyone can see.
    expect(names(r.events).slice(0, 4)).toEqual(['(treat)', 'reveal', 'reveal', '(fire)']);
    expect(r.events.filter((e) => e.t === 'reveal')).toEqual([
      { t: 'reveal', unit: '1-0', action: 'flare' },
      { t: 'reveal', unit: '1-1', action: 'flare' },
    ]);
    expect(unitIn(r.state, '1-0').revealed).toBe(true);
    expect(unitIn(r.state, '1-1').revealed).toBe(true);
    expect(unitIn(r.state, '0-0').revealed).toBe(false);                     // the flare does not give its user away
    // Player 0 is told of each as it comes into view, with the flare named; player 1 that its own men are lit.
    const mine = r.playerEvents[0].filter((e) => e.t === 'spotted' || e.t === 'reveal');
    expect(mine.map((e) => e.t)).toEqual(['spotted', 'reveal', 'spotted', 'reveal']);
    expect(mine[0]).toMatchObject({ t: 'spotted', unit: { id: '1-0', revealed: true } });
    expect(r.playerEvents[1].filter((e) => e.t === 'reveal').length).toBe(2);
    expect(visibleEnemies(r.state, 0).map((x) => x.id)).toEqual(['1-0', '1-1']);
    // Next round the light is gone.
    expect(visibleEnemies(resolve(r.state, [[], []]).state, 0)).toEqual([]);
  });

  it('shock round: launched in the fire phase, lands after movement, two hits on one hex, own line of sight needed', () => {
    const map = field(9, 2, { '3,1': 'w', '5,0': 'b' });
    const state = game(map, [u('0-0', 'pioneer', 0), u('0-1', 'rifleman', 0, 1), u('1-0', 'rifleman', 4), u('1-1', 'rifleman', 5)]);
    const opts = orderOptions(viewFor(state, 0), '0-0');
    expect(opts.fire).toContain(key(h(4)));
    expect(opts.fire).not.toContain(key(h(1)));                              // under its minimum range
    expect(opts.fire).not.toContain(key(h(7)));                              // out of range
    expect(opts.fire).not.toContain(key(h(6)));                              // behind the building at 5: no line of his own
    expect(validateOrders(state, 0, [{ unit: '0-0', kind: 'fire', target: h(6) }]).map((e) => e.reason)).toEqual(['no line of sight to the target']);

    const open = run(state, [{ unit: '0-0', kind: 'fire', target: h(4) }]);
    expect(names(open.events)).toEqual(['(treat)', '(fire)', 'launch', '(move)', '(assault)', '(mortar)', 'impact', 'hit 1-0 pinned', 'hit 1-0 down', '(score)', 'dig', 'dig', 'dig']);
    expect(open.events.find((e) => e.t === 'launch')).toEqual({ t: 'launch', unit: '0-0', from: h(0), action: 'shock' });
    expect(open.events.find((e) => e.t === 'impact')).toEqual({ t: 'impact', target: h(4), blast: 0, action: 'shock' });
    expect(unitIn(open.state, '1-0').status).toBe('down');
    expect(unitIn(open.state, '1-1').status).toBe('ready');                  // next to it: no blast
    expect(unitIn(open.state, '0-0').revealed).toBe(true);

    // In cover the first hit is taken by the cover and the second pins.
    const cover = run(state, [{ unit: '0-0', kind: 'fire', target: h(5) }]);
    expect(names(cover.events).filter((n) => n.startsWith('hit'))).toEqual(['hit 1-1 cover', 'hit 1-1 pinned']);
    // It lands after movement: the man who walks off the hex is missed.
    const moved = run(state, [{ unit: '0-0', kind: 'fire', target: h(4) }, { unit: '1-0', kind: 'move', path: [h(3)] }]);
    expect(names(moved.events).filter((n) => n.startsWith('hit'))).toEqual([]);
  });

  it('the vocabulary\'s other words work too: who is affected, and what the order needs', () => {
    const map = field(6, 1);
    const units = () => [u('0-0', 'pioneer', 0), u('0-1', 'rifleman', 2, 0, { status: 'pinned', pinnedRound: 2 }), u('0-2', 'rifleman', 3), u('1-0', 'rifleman', 4)];
    const scratch = (a: Partial<ActionDef>): void => { ACTIONS.scratch = { ...FLARE, id: 'scratch', name: 'Scratch', ...a }; UNITS.pioneer = { ...PIONEER, special: 'scratch' }; };
    try {
      // needs a pinned friend on the hex; recovers friends only, at a distance of 2
      scratch({ range: 3, needs: 'pinned-friend', affects: 'friends', blast: 1, effects: [{ kind: 'recover' }] });
      expect(orderOptions(viewFor(game(map, units()), 0), '0-0').special).toEqual([key(h(2))]);
      const r = run(game(map, units()), [{ unit: '0-0', kind: 'special', target: h(2) }]);
      expect(r.events.filter((e) => e.t === 'treat')).toEqual([{ t: 'treat', unit: '0-0', target: '0-1', action: 'scratch' }]);
      expect(unitIn(r.state, '0-1').status).toBe('ready');

      // needs any friend; hits enemies only; in the fire phase it is announced as a shot is
      scratch({ phase: 'fire', range: 3, needs: 'friend', affects: 'enemies', blast: 1, effects: [{ kind: 'hit' }], reveals: true });
      expect(orderOptions(viewFor(game(map, units()), 0), '0-0').special.sort()).toEqual([key(h(2)), key(h(3))]);
      const f = run(game(map, units()), [{ unit: '0-0', kind: 'special', target: h(3) }]);
      expect(names(f.events).filter((n) => n.startsWith('hit'))).toEqual(['hit 1-0 pinned']);       // 0-1 and 0-2 are in the area and spared
      expect(f.events.find((e) => e.t === 'fire')).toMatchObject({ unit: '0-0', target: h(3), blast: 1, action: 'scratch', ambush: false });

      // a quiet action that gives its user away says so
      scratch({ reveals: true, effects: [{ kind: 'reveal' }], affects: 'enemies', blast: 0 });
      const q = run(game(map, units()), [{ unit: '0-0', kind: 'special', target: h(1) }]);
      expect(q.events.filter((e) => e.t === 'reveal')).toEqual([{ t: 'reveal', unit: '0-0', action: 'scratch' }]);
      expect(unitIn(q.state, '0-0').revealed).toBe(true);

      // an effect of a kind the rules have no function for does nothing, and nothing breaks
      scratch({ effects: [{ kind: 'teleport' } as never, { kind: 'reveal' }], affects: 'enemies', range: 4, blast: 0 });
      const t = run(game(map, units()), [{ unit: '0-0', kind: 'special', target: h(4) }]);
      expect(t.events.filter((e) => e.t === 'reveal')).toEqual([{ t: 'reveal', unit: '1-0', action: 'scratch' }]);
    } finally {
      UNITS.pioneer = PIONEER;
    }
  });
});

describe('the client\'s helpers take a new action as it comes', () => {
  const map = field(9, 2, { '5,0': 'w' });
  const state = () => game(map, [u('0-0', 'pioneer', 0, 0, { name: 'Spr. Vane' }), u('0-1', 'rifleman', 4, 0, { name: 'Pvt. Hale' }), u('0-2', 'rifleman', 2, 1, { name: 'Pvt. Moss' }), u('1-0', 'rifleman', 5)]);

  it('chit, card and builder take name and icon from the action', () => {
    expect(actionName('pioneer', 'fire')).toBe('Shock round');
    expect(actionName('pioneer', 'special')).toBe('Flare');
    expect(actionName('rifleman', 'fire')).toBe(ACTIONS.rifle.name);
    expect(actionName('medic', 'special')).toBe(ACTIONS.aid.name);
    // No drawing for `shock` or `flare`: the plain icon of the kind of order.
    expect(actionIcon('pioneer', 'fire')).toBe('fire');
    expect(actionIcon('pioneer', 'special')).toBe('special');
    expect(actionIcon('medic', 'special')).toBe('special');
    expect(orderLabel({ unit: '0-0', kind: 'special', target: h(4) }, 'pioneer')).toBe('Flare E1');
    expect(orderLabel({ unit: '0-0', kind: 'fire', target: h(4) }, 'pioneer')).toBe('Shock round E1');
    expect(actionLines('pioneer')).toEqual([
      `Shock round, 2 to 6 hexes. ${SHOCK.blurb} Can follow a move.`,
      `Flare, 1 to 4 hexes. ${FLARE.blurb} Can follow a move.`,
    ]);
    expect(actionLines('medic')).toEqual([`Treat, 1 hex. ${ACTIONS.aid.blurb} Can follow a move.`]);
    expect(actionLines('rifleman')).toEqual([`Fire, 1 to 4 hexes. ${ACTIONS.rifle.blurb} Can follow a move.`]);
    expect(actionLines('gunner')).toEqual([`Fire, 1 to 5 hexes. ${ACTIONS.burst.blurb}`]);        // a heavy weapon: not after a move
  });

  it('the own-fire warning reads the action: it hits, lands late, and the flare does not hit at all', () => {
    const view = viewFor(state(), 0);
    const pioneer = view.units.find((x) => x.id === '0-0')!;
    // The shock round lands after movement: Hale stands on E1 now, Moss means to end there.
    expect(ownUnitsUnderFire(view, {}, pioneer, h(4), 'fire').map((x) => x.id)).toEqual(['0-1']);
    const draft = { '0-1': { unit: '0-1', kind: 'move', path: [h(3)] } as Order, '0-2': { unit: '0-2', kind: 'move', path: [h(3, 1), h(4)] } as Order };
    expect(ownUnitsUnderFire(view, draft, pioneer, h(4), 'fire').map((x) => x.id)).toEqual(['0-1', '0-2']);
    expect(ownUnitsUnderFire(view, {}, pioneer, h(4), 'special')).toEqual([]);
    expect(friendlyFire(view, { '0-0': { unit: '0-0', kind: 'special', target: h(4) } })).toEqual([]);
    expect(friendlyFire(view, { '0-0': { unit: '0-0', kind: 'fire', target: h(4) } }).map((f) => f.victims.map((x) => x.id))).toEqual([['0-1']]);
  });

  it('report lines name the action', () => {
    const s = state();
    const r = run(s, [{ unit: '0-0', kind: 'fire', target: h(4) }]);
    expect(teller(viewFor(s, 0), ['Ann', 'Bo']).tell(r.playerEvents[0]).map((l) => l.text)).toEqual([
      'Spr. Vane: shock round. Rounds in the air.',
      'Shock round lands at E1.',
      'Pvt. Hale pinned at E1.',
      'Pvt. Hale down at E1.',
      "Bo's rifleman lost from sight.",              // Hale was the only one near enough to see into the woods
      'Dug in: Spr. Vane, Pvt. Moss.',
    ]);
    const f = run(s, [{ unit: '0-0', kind: 'special', target: h(4) }]);
    const told = teller(viewFor(s, 0), ['Ann', 'Bo']).tell(f.playerEvents[0]);
    expect(told.map((l) => l.text)).toEqual([
      'Pvt. Hale given away: flare.',
      "Bo's rifleman given away: flare.",
      "Dug in: Spr. Vane, Pvt. Hale, Pvt. Moss, Bo's rifleman.",
    ]);
    expect(told.map((l) => l.danger)).toEqual([true, false, false]);
    // An action this client has never heard of still gets a line.
    expect(teller(viewFor(s, 0), ['Ann', 'Bo']).tell([
      { t: 'fire', unit: '0-0', from: h(0), target: h(4), blast: 0, ambush: false, action: 'nope' },
      { t: 'impact', target: h(4), blast: 0, action: 'nope' },
    ]).map((l) => l.text)).toEqual(['Spr. Vane: fire at E1.', 'Fire lands at E1.']);
  });
});

// Task 14: either may follow a move, because its data says `mobile`. Nothing in the rules knows which.
describe('a new action as a move\'s follow-up', () => {
  const walk = (unit: UnitId, path: Hex[], kind: 'fire' | 'special', target: Hex): Order => ({ unit, kind: 'move', path, then: { kind, target } });

  it('an action that lands late is launched in the assault phase and lands in the mortar phase', () => {
    const state = game(field(12, 1), [u('0-0', 'pioneer', 0), u('1-0', 'rifleman', 8)]);
    expect(validateOrders(state, 0, [{ unit: '0-0', kind: 'fire', target: h(8) }]).length).toBe(1);       // 8 hexes: out of range from where he stands
    const r = run(state, [walk('0-0', [h(1), h(2)], 'fire', h(8))]);
    expect(names(r.events)).toEqual([
      '(treat)', '(fire)', '(move)', 'move', 'move', '(assault)', 'launch', '(mortar)', 'impact', 'hit 1-0 pinned', 'hit 1-0 down', '(score)', 'eliminated', 'over',
    ]);
    expect(r.events.find((e) => e.t === 'launch')).toEqual({ t: 'launch', unit: '0-0', from: h(2), action: 'shock' });
    expect(unitIn(r.state, '0-0')).toMatchObject({ pos: h(2), revealed: true, posture: 'moved' });
    // It needs his own line from where he ends up: woods in the way, and nothing is launched.
    const blind = run(game(field(12, 1, { '5,0': 'w' }), [u('0-0', 'pioneer', 0), u('1-0', 'rifleman', 8)]), [walk('0-0', [h(1), h(2)], 'fire', h(8))]);
    expect(blind.events.filter((e) => e.t === 'unable')).toEqual([{ t: 'unable', unit: '0-0', action: 'shock', reason: 'sight' }]);
    expect(blind.events.some((e) => e.t === 'launch' || e.t === 'impact')).toBe(false);
  });

  it('an action of the quiet phase takes effect in the assault phase, where he ends up', () => {
    // An enemy lies hidden in woods 6 hexes off: out of the flare's reach until the pioneer has walked two.
    const state = game(field(9, 1, { '6,0': 'w' }), [u('0-0', 'pioneer', 0), u('1-0', 'rifleman', 6)]);
    expect(visibleEnemies(state, 0)).toEqual([]);
    const r = run(state, [walk('0-0', [h(1), h(2)], 'special', h(6))]);
    expect(names(r.events)).toEqual(['(treat)', '(fire)', '(move)', 'move', 'move', '(assault)', 'reveal', '(mortar)', '(score)', 'dig']);
    expect(r.playerEvents[0].filter((e) => e.t === 'spotted' || e.t === 'reveal').map((e) => e.t)).toEqual(['spotted', 'reveal']);
    expect(visibleEnemies(r.state, 0).map((x) => x.id)).toEqual(['1-0']);
    expect(unitIn(r.state, '0-0').revealed).toBe(false);
  });

  it('take away `mobile` and the same order is refused', () => {
    const state = game(field(12, 1), [u('0-0', 'pioneer', 0), u('1-0', 'rifleman', 8)]);
    ACTIONS.shock = { ...SHOCK, mobile: false };
    try {
      expect(validateOrders(state, 0, [walk('0-0', [h(1), h(2)], 'fire', h(8))]).map((e) => e.reason)).toEqual(['this unit cannot fire after a move']);
      expect(validateOrders(state, 0, [walk('0-0', [h(1), h(2)], 'special', h(6))])).toEqual([]);
    } finally {
      ACTIONS.shock = SHOCK;
    }
  });

  it('the client names both parts and warns of own men under it where they will be', () => {
    const map = field(9, 2);
    const s = game(map, [u('0-0', 'pioneer', 0, 0, { name: 'Spr. Vane' }), u('0-1', 'rifleman', 3, 1, { name: 'Pvt. Hale' }), u('1-0', 'rifleman', 8)]);
    const view = viewFor(s, 0);
    const order = walk('0-0', [h(1), h(2)], 'fire', h(6));
    expect(orderLabel(order, 'pioneer')).toBe('Move C1 · Shock round G1');
    // Hale means to walk onto the target hex: the follow-up lands after movement.
    const draft = { '0-0': order, '0-1': { unit: '0-1', kind: 'move', path: [h(4, 1), h(5, 1)] } as Order };
    expect(friendlyFire(view, draft)).toEqual([]);
    const onto = { ...draft, '0-1': { unit: '0-1', kind: 'move', path: [h(4, 1), h(6, 0)] } as Order };
    expect(friendlyFire(view, onto).map((f) => f.victims.map((x) => x.id))).toEqual([['0-1']]);
    const r = run(game(field(12, 1, { '5,0': 'w' }), [u('0-0', 'pioneer', 0, 0, { name: 'Spr. Vane' }), u('1-0', 'rifleman', 8)]), [walk('0-0', [h(1), h(2)], 'fire', h(8))]);
    expect(teller(view, ['Ann', 'Bo']).tell(r.playerEvents[0]).map((l) => l.text)).toEqual(['Spr. Vane: shock round called off, no line.']);
  });
});
