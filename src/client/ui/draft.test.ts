import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAP, MAPS } from '../../content';
import { createMatch, validateOrders, viewFor } from '../../rules';
import { distance, neighbors } from '../../shared/hex';
import type { Hex, Order, PlayerView, Unit } from '../../shared/types';
import {
  allowance, clearDraft, draftSignature, followUpOf, friendlyFire, fromOrders, layRoute, loadDraft, moveOrder, orderBrief, orderLabel, ownUnits,
  ownUnitsUnderFire, plannedEnd, prune, saveDraft, throttled, toOrders, unitName,
} from './draft';
import type { Draft, DraftStore } from './draft';

const map = MAPS[DEFAULT_MAP];
const squad = ['rifleman', 'rifleman', 'gunner', 'mortar', 'medic'];
const state = createMatch(map, [{ player: 0, units: squad }, { player: 1, units: squad }]);
const view = viewFor(state, 0);
const mine = ownUnits(view);
const [rifle, rifle2, gunner, mortar] = mine;

/** The view with some of the player's units put elsewhere or in another status. */
function withUnits(change: Record<string, Partial<Unit>>): PlayerView {
  return { ...view, units: view.units.map((u) => (change[u.id] ? { ...u, ...change[u.id] } : u)) };
}

function memoryStore(): DraftStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

describe('ownUnits', () => {
  it('lists only the viewer\'s units, in squad order', () => {
    expect(mine.map((u) => u.id)).toEqual(['0-0', '0-1', '0-2', '0-3', '0-4']);
    expect(mine.map((u) => u.type)).toEqual(squad);
  });
});

describe('layRoute', () => {
  const from = rifle.pos;
  const open = (h: Hex): Hex => neighbors(h).find((n) => layRoute(map, h, [], n, 1) !== null)!;

  it('finds the shortest route to a tapped hex', () => {
    const a = open(from);
    expect(layRoute(map, from, [], a, 2)).toEqual([a]);
  });

  it('grows hex by hex from the end of the route while allowance is left', () => {
    const a = open(from);
    const b = neighbors(a).find((n) => distance(n, from) === 1 && layRoute(map, a, [], n, 1) !== null)!;
    // b is one step from the unit, but tapped after a it is laid as the second step.
    expect(layRoute(map, from, [a], b, 2)).toEqual([a, b]);
    // With no allowance left the tap starts the route again.
    expect(layRoute(map, from, [a], b, 1)).toEqual([b]);
  });

  it('cuts the route back to a hex already on it', () => {
    const a = open(from);
    const b = neighbors(a).find((n) => distance(n, from) === 2 && layRoute(map, a, [], n, 1) !== null)!;
    expect(layRoute(map, from, [a, b], a, 4)).toEqual([a]);
  });

  it('clears the route on the unit\'s own hex and refuses a hex out of reach', () => {
    expect(layRoute(map, from, [open(from)], from, 2)).toEqual([]);
    const far = ownUnits(viewFor(state, 1))[0].pos;
    expect(layRoute(map, from, [], far, 2)).toBeNull();
  });

  it('only ever makes routes the rules accept', () => {
    let route: Hex[] = [];
    const taps = [open(from), open(open(from)), from, open(from)];
    for (const t of taps) {
      const next = layRoute(map, from, route, t, allowance(rifle, 'dash'));
      if (!next || next.length === 0) { route = []; continue; }
      route = next;
      expect(validateOrders(state, 0, [{ unit: rifle.id, kind: 'dash', path: route }])).toEqual([]);
    }
  });
});

describe('allowance', () => {
  it('is the unit\'s move, doubled for a dash', () => {
    expect(allowance(rifle, 'move')).toBe(2);
    expect(allowance(rifle, 'dash')).toBe(4);
    expect(allowance(gunner, 'move')).toBe(1);
    expect(allowance(rifle, 'fire')).toBe(0);
  });
});

describe('prune', () => {
  const draft: Draft = {
    [rifle.id]: { unit: rifle.id, kind: 'ambush' },
    [mortar.id]: { unit: mortar.id, kind: 'ambush' },           // a mortar cannot ambush
    '1-0': { unit: '1-0', kind: 'ambush' },                     // not ours
    [gunner.id]: { unit: rifle2.id, kind: 'ambush' },           // filed under the wrong unit
  };
  it('keeps what belongs to a living unit of ours that can take the order', () => {
    expect(Object.keys(prune(view, draft))).toEqual([rifle.id]);
  });
  it('drops orders for a unit that is down, keeps them for one that is pinned', () => {
    expect(prune(withUnits({ [rifle.id]: { status: 'down' } }), draft)).toEqual({});
    expect(Object.keys(prune(withUnits({ [rifle.id]: { status: 'pinned' } }), draft))).toEqual([rifle.id]);
  });
  it('leaves targets and paths to the server', () => {
    const odd: Draft = { [rifle.id]: { unit: rifle.id, kind: 'move', path: [{ q: 99, r: 99 }] } };
    expect(prune(view, odd)).toEqual(odd);
    expect(validateOrders(state, 0, toOrders(odd))).toHaveLength(1);
  });
});

describe('friendly fire', () => {
  it('finds own units in the target hex of a rifle', () => {
    expect(ownUnitsUnderFire(view, {}, rifle, rifle2.pos).map((u) => u.id)).toEqual([rifle2.id]);
    expect(ownUnitsUnderFire(view, {}, rifle, { q: 6, r: 5 })).toEqual([]);
  });

  it('counts the blast area of an area weapon, but never the shooter', () => {
    const next = neighbors(rifle.pos)[0];
    const v = withUnits({ [gunner.id]: { pos: neighbors(next)[0] } });
    const g = v.units.find((u) => u.id === gunner.id)!;
    const hit = ownUnitsUnderFire(v, {}, g, next).map((u) => u.id);
    expect(hit).toContain(rifle.id);
    expect(hit).not.toContain(gunner.id);
  });

  it('ignores units that are down', () => {
    expect(ownUnitsUnderFire(withUnits({ [rifle2.id]: { status: 'down' } }), {}, rifle, rifle2.pos)).toEqual([]);
  });

  it('for a mortar, also counts where a unit means to end its move', () => {
    const target: Hex = { q: 6, r: 5 };
    const walk: Order = { unit: rifle.id, kind: 'dash', path: [neighbors(target)[0]] };
    expect(plannedEnd(rifle, { [rifle.id]: walk })).toEqual(neighbors(target)[0]);
    expect(ownUnitsUnderFire(view, { [rifle.id]: walk }, mortar, target).map((u) => u.id)).toEqual([rifle.id]);
    // Direct fire lands before anyone moves.
    expect(ownUnitsUnderFire(view, { [rifle.id]: walk }, gunner, target)).toEqual([]);
  });

  it('lists every fire order in the draft that covers own units', () => {
    const draft: Draft = {
      [rifle.id]: { unit: rifle.id, kind: 'fire', target: rifle2.pos },
      [rifle2.id]: { unit: rifle2.id, kind: 'fire', target: { q: 6, r: 5 } },
      [gunner.id]: { unit: gunner.id, kind: 'ambush' },
    };
    const found = friendlyFire(view, draft);
    expect(found).toHaveLength(1);
    expect(found[0].shooter.id).toBe(rifle.id);
    expect(found[0].victims.map((u) => u.id)).toEqual([rifle2.id]);
    expect(friendlyFire(view, {})).toEqual([]);
  });

  it('does not count a medic treating a friend', () => {
    const medic = mine[4];
    expect(friendlyFire(view, { [medic.id]: { unit: medic.id, kind: 'special', target: rifle.pos } })).toEqual([]);
  });
});

describe('labels', () => {
  it('names a unit with its rank', () => {
    expect(unitName(rifle)).toBe(rifle.name);
    expect(rifle.name).toMatch(/^Pvt\. /);
    expect(gunner.name).toMatch(/^Cpl\. /);
  });
  it('says an order in a couple of words', () => {
    expect(orderLabel(undefined, 'rifleman')).toBe('Hold');
    expect(orderLabel({ unit: 'x', kind: 'move', path: [{ q: 0, r: 0 }, { q: 1, r: 0 }] }, 'rifleman')).toBe('Move B1');
    expect(orderLabel({ unit: 'x', kind: 'dash', path: [{ q: 0, r: 0 }] }, 'rifleman')).toBe('Dash A1');
    expect(orderLabel({ unit: 'x', kind: 'fire', target: { q: 2, r: 1 } }, 'rifleman')).toBe('Fire C2');
    expect(orderLabel({ unit: 'x', kind: 'ambush' }, 'rifleman')).toBe('Ambush');
    expect(orderLabel({ unit: 'x', kind: 'special', target: { q: 0, r: 0 } }, 'medic')).toBe('Treat A1');
  });
});

describe('keeping the draft', () => {
  const draft: Draft = {
    [rifle.id]: { unit: rifle.id, kind: 'move', path: [neighbors(rifle.pos)[0]] },
    [gunner.id]: { unit: gunner.id, kind: 'fire', target: { q: 6, r: 5 } },
  };
  const sig = draftSignature('tok', view);

  it('comes back for the same round of the same match', () => {
    const store = memoryStore();
    saveDraft(store, 'a', sig, draft);
    expect(loadDraft(store, 'a', sig)).toEqual(draft);
    expect(loadDraft(store, 'b', sig)).toEqual({});
  });

  it('does not come back for another round, another seat, or after the squad has moved', () => {
    const store = memoryStore();
    saveDraft(store, 'a', sig, draft);
    expect(loadDraft(store, 'a', draftSignature('tok', { ...view, round: 2 }))).toEqual({});
    expect(loadDraft(store, 'a', draftSignature('other', view))).toEqual({});
    expect(loadDraft(store, 'a', draftSignature('tok', withUnits({ [rifle.id]: { pos: { q: 5, r: 5 } } })))).toEqual({});
  });

  it('is gone once cleared', () => {
    const store = memoryStore();
    saveDraft(store, 'a', sig, draft);
    clearDraft(store, 'a');
    expect(loadDraft(store, 'a', sig)).toEqual({});
  });

  it('survives junk in the store and a missing store', () => {
    const store = memoryStore();
    store.data.set('dawn-squad-draft-a', '{not json');
    expect(loadDraft(store, 'a', sig)).toEqual({});
    store.data.set('dawn-squad-draft-a', JSON.stringify({ signature: sig, draft: { [rifle.id]: { unit: rifle.id, kind: 'move' }, x: 3, [gunner.id]: draft[gunner.id] } }));
    expect(loadDraft(store, 'a', sig)).toEqual({ [gunner.id]: draft[gunner.id] });
    expect(loadDraft(null, 'a', sig)).toEqual({});
    expect(() => saveDraft(null, 'a', sig, draft)).not.toThrow();
  });
});

describe('what the chits and cards call an action', () => {
  it('every action in the data has a chit drawing, and the five units read as before', async () => {
    const { ACTIONS, UNITS } = await import('../../content');
    const { ACTION_ICONS, actionIcon, actionName } = await import('./draft');
    for (const a of Object.values(ACTIONS)) expect(Object.keys(ACTION_ICONS), `no chit drawing for icon "${a.icon}"`).toContain(a.icon);
    expect(Object.keys(UNITS).filter((id) => UNITS[id].fire).map((id) => `${id} ${actionName(id, 'fire')} ${actionIcon(id, 'fire')}`)).toEqual([
      'rifleman Fire fire', 'gunner Fire fire', 'sniper Fire fire', 'mortar Mortar fire',
    ]);
    expect(`${actionName('medic', 'special')} ${actionIcon('medic', 'special')}`).toBe('Treat special');
    // A unit type nobody knows still gets a word and a drawing.
    expect(`${actionName('tank', 'fire')} ${actionIcon('tank', 'special')}`).toBe('Fire special');
  });
});

describe('stance: how hard a unit is to see, in a word', () => {
  it('reads the ground, the posture and whether the unit gave itself away', async () => {
    const { stance } = await import('./draft');
    const { TERRAIN } = await import('../../content');
    const cells = Object.entries(MAPS[DEFAULT_MAP].cells);
    const at = (terrain: string): Hex => {
      const [k] = cells.find(([, c]) => c.terrain === terrain)!;
      const [q, r] = k.split(',').map(Number);
      return { q, r };
    };
    const man = (pos: Hex, extra: Partial<Unit> = {}): Unit =>
      ({ id: '0-0', owner: 0, type: 'rifleman', name: 'x', pos, status: 'ready', pinnedRound: null, revealed: false, posture: 'still', ...extra });
    const map = MAPS[DEFAULT_MAP];
    for (const ground of ['woods', 'crops', 'building']) {
      expect(TERRAIN[ground].hide).not.toBeNull();
      expect(stance(map, man(at(ground)))).toBe('hidden');
      expect(stance(map, man(at(ground), { posture: 'moved' }))).toBe(ground === 'building' ? 'exposed' : 'creeping');
      expect(stance(map, man(at(ground), { posture: 'dashed' }))).toBe('exposed');
      expect(stance(map, man(at(ground), { revealed: true }))).toBe('exposed');
      expect(stance(map, man(at(ground), { posture: 'moved', revealed: true }))).toBe('exposed');
      expect(stance(map, man(at(ground), { status: 'pinned' }))).toBe('hidden');
    }
    for (const posture of ['still', 'moved', 'dashed'] as const) expect(stance(map, man(at('open'), { posture }))).toBe('exposed');
  });
});

describe('a move with a follow-up (task 14)', () => {
  const medic = mine[4];
  const step = neighbors(rifle.pos).find((n) => layRoute(map, rifle.pos, [], n, 1) !== null && !mine.some((u) => u.pos.q === n.q && u.pos.r === n.r))!;
  // A hex d away that none of the squad stands on, so a test about aiming does not hang on where the map puts the start zones.
  const far = (from: Hex, d: number): Hex => Object.keys(map.cells).map((k) => ({ q: Number(k.split(',')[0]), r: Number(k.split(',')[1]) })).find((x) => distance(from, x) === d && !mine.some((u) => u.pos.q === x.q && u.pos.r === x.r))!;

  it('the card names both parts', () => {
    expect(orderLabel({ unit: 'x', kind: 'move', path: [{ q: 1, r: 0 }], then: { kind: 'fire', target: { q: 2, r: 1 } } }, 'rifleman')).toBe('Move B1 · Fire C2');
    expect(orderLabel({ unit: 'x', kind: 'move', path: [{ q: 1, r: 0 }], then: { kind: 'special', target: { q: 0, r: 0 } } }, 'medic')).toBe('Move B1 · Treat A1');
    // The card has room for the two parts and no more; the hexes are on the map and in the strip.
    expect(orderBrief({ unit: 'x', kind: 'move', path: [{ q: 1, r: 0 }], then: { kind: 'fire', target: { q: 2, r: 1 } } }, 'rifleman')).toBe('Move · Fire');
    expect(orderBrief({ unit: 'x', kind: 'move', path: [{ q: 1, r: 0 }], then: { kind: 'special', target: { q: 0, r: 0 } } }, 'medic')).toBe('Move · Treat');
    expect(orderBrief({ unit: 'x', kind: 'move', path: [{ q: 1, r: 0 }] }, 'rifleman')).toBe('Move B1');
    expect(orderBrief(undefined, 'rifleman')).toBe('Hold');
  });

  it('moveOrder keeps a follow-up that is still in range of the new end, and drops one that is not', () => {
    const near = far(step, 3);
    const kept = moveOrder(view, rifle, [step], { kind: 'fire', target: near });
    expect(kept).toEqual({ unit: rifle.id, kind: 'move', path: [step], then: { kind: 'fire', target: near } });
    expect(validateOrders(state, 0, [kept])).toEqual([]);
    expect(followUpOf({ [rifle.id]: kept }, rifle.id)).toEqual({ kind: 'fire', target: near });
    const dropped = moveOrder(view, rifle, [step], { kind: 'fire', target: far(step, 6) });
    expect(dropped).toEqual({ unit: rifle.id, kind: 'move', path: [step] });
    expect(moveOrder(view, rifle, [step], null)).toEqual({ unit: rifle.id, kind: 'move', path: [step] });
    // A heavy weapon never keeps one.
    const g = neighbors(gunner.pos).find((n) => layRoute(map, gunner.pos, [], n, 1) !== null)!;
    expect(moveOrder(view, gunner, [g], { kind: 'fire', target: far(g, 2) })).toEqual({ unit: gunner.id, kind: 'move', path: [g] });
    expect(followUpOf({ [gunner.id]: { unit: gunner.id, kind: 'fire', target: step } }, gunner.id)).toBeNull();
  });

  it('warns of own men under a follow-up where they stand or mean to end up, since it lands after movement', () => {
    const target = far(step, 2);
    const order: Order = { unit: rifle.id, kind: 'move', path: [step], then: { kind: 'fire', target } };
    expect(friendlyFire(view, { [rifle.id]: order })).toEqual([]);
    const walker: Order = { unit: rifle2.id, kind: 'dash', path: [target] };       // drawn, not judged
    const found = friendlyFire(view, { [rifle.id]: order, [rifle2.id]: walker });
    expect(found.map((f) => [f.shooter.id, f.victims.map((u) => u.id)])).toEqual([[rifle.id, [rifle2.id]]]);
    expect(found[0].target).toEqual(target);
    // A plain rifle shot at the same hex lands before he gets there.
    expect(friendlyFire(view, { [rifle.id]: { unit: rifle.id, kind: 'fire', target }, [rifle2.id]: walker })).toEqual([]);
    expect(friendlyFire(view, { [medic.id]: { unit: medic.id, kind: 'move', path: [neighbors(medic.pos)[0]], then: { kind: 'special', target: rifle.pos } } })).toEqual([]);
  });

  it('is kept across a reload, and a malformed one is not', () => {
    const store = memoryStore();
    const sig = draftSignature('tok', view);
    const good: Order = { unit: rifle.id, kind: 'move', path: [step], then: { kind: 'fire', target: far(step, 2) } };
    saveDraft(store, 'a', sig, { [rifle.id]: good });
    expect(loadDraft(store, 'a', sig)).toEqual({ [rifle.id]: good });
    saveDraft(store, 'a', sig, { [rifle.id]: { ...good, then: { kind: 'ambush' } } as unknown as Order });
    expect(loadDraft(store, 'a', sig)).toEqual({});
  });
});

describe('fromOrders', () => {
  it('puts the server\'s held orders back as a draft, follow-ups included', () => {
    const step = neighbors(rifle.pos)[0];
    const far = (from: Hex, d: number): Hex => ({ q: from.q + d, r: from.r });
    const held: Order[] = [
      { unit: rifle.id, kind: 'move', path: [step], then: { kind: 'fire', target: far(step, 2) } },
      { unit: gunner.id, kind: 'ambush' },
    ];
    const draft = fromOrders(held);
    expect(draft[rifle.id]).toEqual(held[0]);
    expect(followUpOf(draft, rifle.id)).toEqual({ kind: 'fire', target: far(step, 2) });
    expect(toOrders(draft)).toEqual(held);
    expect(fromOrders([])).toEqual({});
  });
});

describe('throttled', () => {
  it('sends the first change at once, folds the rest into one send per gap, and can be cancelled', () => {
    vi.useFakeTimers();
    try {
      const sent: number[] = [];
      const t = throttled(() => sent.push(Date.now()), 330);
      const t0 = Date.now();
      t.poke();
      expect(sent).toHaveLength(1);
      vi.advanceTimersByTime(100);
      t.poke(); t.poke(); t.poke();
      expect(sent).toHaveLength(1);                       // waiting for the gap
      vi.advanceTimersByTime(230);
      expect(sent).toEqual([t0, t0 + 330]);               // one send for the three changes
      vi.advanceTimersByTime(1000);
      expect(sent).toHaveLength(2);                       // nothing more without a change
      t.poke();                                           // quiet for a while: at once again
      expect(sent).toHaveLength(3);
      t.poke();
      t.cancel();
      vi.advanceTimersByTime(1000);
      expect(sent).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never sends more than about three times a second', () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const t = throttled(() => n++, 330);
      for (let i = 0; i < 100; i++) { t.poke(); vi.advanceTimersByTime(20); }   // two seconds of busy drawing
      vi.advanceTimersByTime(400);
      expect(n).toBeLessThanOrEqual(8);
      expect(n).toBeGreaterThanOrEqual(6);
    } finally {
      vi.useRealTimers();
    }
  });
});
