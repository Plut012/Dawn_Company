import { describe, expect, it } from 'vitest';
import { axialToOffset, distance, key, neighbors, offsetToAxial, parseKey, rotate } from '../shared/hex';
import type { ActionDef, GameMap, Hex, OrderKind } from '../shared/types';
import { ACTIONS, DEFAULT_MODE, MAPS, MODES, mapFor, NAMES, OBJECTIVE_KINDS, PRESETS, RULES, TERRAIN, UNITS, WORKS, validateSquad } from './index';
import { TERRAIN_CHARS } from './mapFormat';
import { areaDistance, readMap } from './mapFormat';
import type { MapDrawing } from './mapFormat';

const ORDER_KINDS: OrderKind[] = ['move', 'dash', 'fire', 'ambush', 'special'];

describe('terrain', () => {
  it('has the six terrains of the maps and the three of the works (25), keyed by their own id', () => {
    expect(Object.keys(TERRAIN).sort()).toEqual(['building', 'crops', 'nest', 'open', 'sandbags', 'wall', 'water', 'wire', 'woods']);
    expect(Object.values(TERRAIN_CHARS).sort()).toEqual(['building', 'crops', 'open', 'wall', 'water', 'woods']);
    for (const [id, def] of Object.entries(TERRAIN)) expect(def.id).toBe(id);
  });
  it('matches the terrain table', () => {
    expect(TERRAIN.open).toMatchObject({ cover: false, hide: null, blocksSight: false, passable: true });
    expect(TERRAIN.woods).toMatchObject({ cover: false, hide: { still: 1, moved: 2 }, blocksSight: true, passable: true });
    expect(TERRAIN.building).toMatchObject({ cover: true, hide: { still: 1, moved: null }, blocksSight: true, passable: true });
    expect(TERRAIN.crops).toMatchObject({ cover: false, hide: { still: 1, moved: 2 }, blocksSight: false, passable: true });
    expect(TERRAIN.wall).toMatchObject({ cover: true, hide: null, blocksSight: false, passable: true });
    expect(TERRAIN.water).toMatchObject({ cover: false, hide: null, blocksSight: false, passable: false });
    expect(TERRAIN.sandbags).toMatchObject({ cover: true, hide: null, blocksSight: false, passable: true });
    expect(TERRAIN.wire).toMatchObject({ cover: false, hide: null, blocksSight: false, passable: false });
    expect(TERRAIN.nest).toMatchObject({ cover: true, hide: { still: 1, moved: null }, blocksSight: false, passable: true });
  });
  it('gives no ground everything: only a building both covers and hides, and it hides no mover', () => {
    for (const def of Object.values(TERRAIN)) {
      if (def.cover && def.hide) expect(def.hide.moved, def.id).toBeNull();
    }
  });
});

describe('units', () => {
  it('has the six units, keyed by their own id', () => {
    expect(Object.keys(UNITS).sort()).toEqual(['engineer', 'gunner', 'medic', 'mortar', 'rifleman', 'sniper']);
    for (const [id, def] of Object.entries(UNITS)) expect(def.id).toBe(id);
  });

  it('matches the unit table', () => {
    const row = (id: string) => {
      const u = UNITS[id];
      return [u.rank, u.cost, u.max, u.move, u.sight, u.orders.join(' '), u.fire, u.special];
    };
    expect(row('rifleman')).toEqual(['Pvt.', 2, null, 2, 6, 'move dash fire ambush', 'rifle', null]);
    expect(row('gunner')).toEqual(['Cpl.', 4, 2, 1, 6, 'move fire ambush', 'burst', null]);
    expect(row('sniper')).toEqual(['Pvt.', 4, 1, 2, 8, 'move dash fire ambush', 'snipe', null]);
    expect(row('mortar')).toEqual(['Cpl.', 4, 1, 1, 5, 'move fire', 'shell', null]);
    expect(row('medic')).toEqual(['Pvt.', 2, 2, 2, 6, 'move dash special', null, 'aid']);
    expect(row('engineer')).toEqual(['Spr.', 3, 2, 2, 6, 'move dash special', null, 'build']);
    expect(UNITS.engineer.spotting).toBe(0);
  });

  it.each(Object.values(UNITS))('$id is consistent with itself', (u) => {
    expect(u.name).not.toBe('');
    expect(u.rank).not.toBe('');
    expect(u.blurb.length).toBeGreaterThan(10);
    expect(u.blurb).not.toContain('\n');
    expect(u.cost).toBeGreaterThan(0);
    expect(u.cost).toBeLessThanOrEqual(RULES.budget);
    if (u.max !== null) expect(u.max).toBeGreaterThan(0);
    expect(u.move).toBeGreaterThan(0);
    expect(u.sight).toBeGreaterThan(0);
    expect(new Set(u.orders).size).toBe(u.orders.length);
    for (const o of u.orders) expect(ORDER_KINDS).toContain(o);
    // A unit can be ordered to fire exactly when it has a weapon,
    // and to use a special exactly when it has one.
    expect(u.orders.includes('fire')).toBe(u.fire !== null);
    expect(u.orders.includes('special')).toBe(u.special !== null);
    // Every action a unit names exists, and an ambusher's weapon lands in the fire phase.
    for (const id of [u.fire, u.special]) if (id !== null) expect(Object.keys(ACTIONS)).toContain(id);
    if (u.orders.includes('ambush')) expect(ACTIONS[u.fire ?? '']?.phase).toBe('fire');
  });
});

describe('actions', () => {
  it('has the six actions, keyed by their own id, each used by a unit', () => {
    expect(Object.keys(ACTIONS).sort()).toEqual(['aid', 'build', 'burst', 'rifle', 'shell', 'snipe']);
    for (const [id, def] of Object.entries(ACTIONS)) expect(def.id).toBe(id);
    const used = new Set(Object.values(UNITS).flatMap((u) => [u.fire, u.special]));
    for (const id of Object.keys(ACTIONS)) expect(used.has(id)).toBe(true);
  });

  it('matches the action table: the numbers and rules the five units had before actions were data', () => {
    const row = (id: string) => {
      const a = ACTIONS[id];
      return [a.phase, a.minRange, a.range, a.sight, a.needs, a.affects, a.blast, JSON.stringify(a.effects), a.reveals];
    };
    expect(row('rifle')).toEqual(['fire', 1, 4, 'own', 'any', 'all', 0, '[{"kind":"hit"}]', true]);
    expect(row('burst')).toEqual(['fire', 1, 5, 'own', 'any', 'all', 1, '[{"kind":"hit"}]', true]);
    expect(row('snipe')).toEqual(['fire', 2, 8, 'own', 'any', 'all', 0, '[{"kind":"hit","ignoresCover":true}]', true]);
    expect(row('shell')).toEqual(['mortar', 3, 10, 'squad', 'any', 'all', 1, '[{"kind":"hit"}]', true]);
    expect(row('aid')).toEqual(['treat', 1, 1, 'none', 'friend', 'friends', 0, '[{"kind":"recover"}]', false]);
    expect(row('build')).toEqual(['build', 0, 1, 'none', 'any', 'friends', 0, '[{"kind":"build"}]', false]);
    expect(ACTIONS.build.mobile).toBe(true);
  });

  it.each(Object.values(ACTIONS))('$id is built from the vocabulary', (a: ActionDef) => {
    expect(a.name).not.toBe('');
    expect(a.icon).not.toBe('');
    expect(a.blurb.length).toBeGreaterThan(10);
    expect(['treat', 'fire', 'mortar', 'build']).toContain(a.phase);
    expect(['own', 'squad', 'none']).toContain(a.sight);
    expect(['any', 'friend', 'pinned-friend']).toContain(a.needs);
    expect(['all', 'friends', 'enemies']).toContain(a.affects);
    expect(a.minRange).toBeGreaterThanOrEqual(0);
    expect(a.minRange).toBeLessThanOrEqual(a.range);
    expect([0, 1]).toContain(a.blast);
    expect(a.effects.length).toBeGreaterThan(0);
    for (const e of a.effects) expect(['hit', 'recover', 'reveal', 'build']).toContain(e.kind);
    // (25) A build lands in the build step and nowhere else.
    expect(a.phase === 'build').toBe(a.effects.some((e) => e.kind === 'build'));
  });
});

describe('works (25)', () => {
  it('has sandbags, wire and an MG nest, each with its own terrain and cost', () => {
    expect(Object.keys(WORKS).sort()).toEqual(['nest', 'sandbags', 'wire']);
    for (const [id, w] of Object.entries(WORKS)) {
      expect(w.id).toBe(id);
      expect(w.terrain).toBe(id);
      expect(TERRAIN[w.terrain]).toBeDefined();
      expect(w.name).not.toBe('');
      expect(w.blurb.length).toBeGreaterThan(10);
      expect(Number.isInteger(w.cost) && w.cost > 0).toBe(true);
    }
    // The costs keep the first guess's relation to a rifleman's buy-back: sandbags and wire half of it, a nest all of it.
    const buyBack = UNITS.rifleman.cost * MODES['supply-line'].returns!.buyBack;
    expect([WORKS.sandbags.cost, WORKS.wire.cost, WORKS.nest.cost]).toEqual([buyBack / 2, buyBack / 2, buyBack]);
  });
  it('leaves the engineer out of Last Stand', () => {
    expect(MODES['last-stand'].units).not.toContain('engineer');
  });
});

describe('rules and names', () => {
  it('has the squad-building limits', () => {
    expect(RULES).toEqual({ budget: 20, minUnits: 4, maxUnits: 8 });
  });
  it('has at least 40 distinct surnames', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(NAMES).size).toBe(NAMES.length);
    for (const n of NAMES) expect(n).toMatch(/^[A-Z][a-z]+$/);
  });
});

describe('modes', () => {
  it('has supply-line as the default, and every key is its mode id', () => {
    expect(DEFAULT_MODE).toBe('supply-line');
    for (const [id, m] of Object.entries(MODES)) expect(m.id).toBe(id);
    expect(MODES[DEFAULT_MODE]).toMatchObject({ units: null, supply: true, returns: { rounds: 3, buyBack: 6 }, win: 'supply' });
    expect(MODES['last-stand']).toMatchObject({ supply: false, returns: null, win: 'survival', units: ['rifleman', 'gunner', 'sniper', 'medic'] });
  });
  it('allows only real unit types', () => {
    for (const m of Object.values(MODES)) for (const u of m.units ?? []) expect(UNITS[u]).toBeDefined();
  });
  it('has, for every mode, a preset it allows', () => {
    for (const m of Object.values(MODES)) {
      expect(PRESETS.filter((p) => validateSquad(p.units, m.id).ok).length).toBeGreaterThan(0);
    }
  });
});

describe('validateSquad', () => {
  const r = 'rifleman';

  it('accepts a legal squad and totals its cost', () => {
    expect(validateSquad([r, r, r, 'gunner', 'medic'])).toEqual({ ok: true, cost: 12, errors: [] });
  });
  it('accepts a squad exactly at the budget and the unit limits', () => {
    expect(validateSquad([r, r, r, r, 'sniper', 'gunner', 'medic', 'medic'])).toEqual({ ok: true, cost: 20, errors: [] });   // eight units, all the points
    expect(validateSquad(['gunner', 'gunner', 'sniper', 'mortar', r, r])).toEqual({ ok: true, cost: 20, errors: [] });
    expect(validateSquad([r, r, r, r, r, r, r, r])).toEqual({ ok: true, cost: 16, errors: [] });                     // eight units, points to spare
  });
  it('rejects an unknown unit', () => {
    const v = validateSquad([r, r, r, r, 'tank']);
    expect(v.ok).toBe(false);
    expect(v.cost).toBe(8);
    expect(v.errors).toEqual(['No such unit: "tank".']);
  });
  it('rejects names that only look like units', () => {
    expect(validateSquad([r, r, r, 'toString', 'constructor']).ok).toBe(false);
  });
  it('rejects too few units', () => {
    const v = validateSquad([r, r, r]);
    expect(v.ok).toBe(false);
    expect(v.errors).toHaveLength(1);
    expect(v.errors[0]).toMatch(/too few/i);
  });
  it('rejects an empty squad', () => {
    expect(validateSquad([])).toMatchObject({ ok: false, cost: 0 });
  });
  it('rejects too many units', () => {
    const v = validateSquad([r, r, r, r, r, r, r, 'medic', 'medic']);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => /too many units/i.test(e))).toBe(true);
  });
  it('rejects a squad over budget', () => {
    const v = validateSquad(['gunner', 'gunner', 'sniper', 'mortar', r, r, r]);
    expect(v.ok).toBe(false);
    expect(v.cost).toBe(22);
    expect(v.errors).toHaveLength(1);
    expect(v.errors[0]).toMatch(/over budget/i);
  });
  it('rejects more of a type than its limit', () => {
    const v = validateSquad(['sniper', 'sniper', r, r]);
    expect(v.ok).toBe(false);
    expect(v.errors).toHaveLength(1);
    expect(v.errors[0]).toContain('Sniper');
  });
  it('reports every problem at once', () => {
    const v = validateSquad(['sniper', 'sniper', 'sniper', 'mortar', 'mortar', r, 'tank']);
    expect(v.ok).toBe(false);
    expect(v.errors).toHaveLength(4);   // unknown, over budget, snipers, mortars
  });
});

describe('presets', () => {
  it('offers four, with distinct ids (the Pioneer section, 25)', () => {
    expect(PRESETS).toHaveLength(4);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(4);
    expect(PRESETS.find((p) => p.id === 'pioneers')!.units).toContain('engineer');
  });
  it.each(PRESETS)('$name is a legal squad', (p) => {
    expect(p.name).not.toBe('');
    expect(p.blurb.length).toBeGreaterThan(10);
    expect(validateSquad(p.units)).toMatchObject({ ok: true, errors: [] });
  });
  it.each(PRESETS)('$name spends the whole budget', (p) => {
    expect(validateSquad(p.units).cost).toBe(RULES.budget);
  });
});

// ---- maps

/** How many times a map's turn goes into a full turn: 3 for three seats (a third of a turn), else 2 (a half turn). */
const turnsOf = (map: GameMap): number => (map.spawns.length === 3 ? 3 : 2);
/**
 * The hex a map turns about. A half-turn map: the middle of its drawing. A third-turn map: the mean of its cells
 * (a set of hexes that a third of a turn takes onto itself has its mean at the hex it turns about).
 */
function centre(map: GameMap): Hex {
  if (turnsOf(map) === 2) return offsetToAxial(Math.floor(map.cols / 2), Math.floor(map.rows / 2));
  const cells = Object.keys(map.cells).map(parseKey);
  return { q: cells.reduce((a, h) => a + h.q, 0) / cells.length, r: cells.reduce((a, h) => a + h.r, 0) / cells.length };
}
/** The map's turn about its centre hex (a half turn, or a third for three seats). A true rotation: it keeps every distance. */
function turn(map: GameMap, h: Hex): Hex {
  return rotate(h, centre(map), 6 / turnsOf(map));
}
function onMap(map: GameMap, h: Hex): boolean {
  const { col, row } = axialToOffset(h);
  return col >= 0 && col < map.cols && row >= 0 && row < map.rows;
}

describe('maps', () => {
  it('keys every map by its id', () => {
    for (const [id, map] of Object.entries(MAPS)) expect(map.id).toBe(id);
  });
  it('mapFor gives ford for 2, tripoint for 3 and crossroads for 4, and each map seats only the count it is made for', () => {
    expect([2, 3, 4].map((n) => mapFor(n).id)).toEqual(['ford', 'tripoint', 'crossroads']);
    for (const map of Object.values(MAPS)) expect(Object.keys(map.seatSpawns), map.id).toEqual([String(map.spawns.length)]);
  });
  it('mapFor prefers a map made for exactly that many players, else the first that seats them', () => {
    const { tripoint } = MAPS;
    // A four-zone map with a layout for three, listed after the triangle.
    MAPS.spare = { ...MAPS.crossroads, id: 'spare', seatSpawns: { 3: [0, 1, 2] } };
    try {
      expect(mapFor(3).id).toBe('tripoint');    // made for exactly 3, though another map seats 3 too
      delete MAPS.tripoint;
      expect(mapFor(3).id).toBe('spare');       // else the first in MAPS that has a layout for 3
      expect(mapFor(4).id).toBe('crossroads');  // made for exactly 4
      expect(mapFor(2).id).toBe('ford');        // made for exactly 2
    } finally {
      delete MAPS.spare;
      MAPS.tripoint = tripoint;
    }
  });
  it('mapFor throws when no map seats that many', () => {
    for (const n of [0, 1, 5, 9]) expect(() => mapFor(n)).toThrow();
  });
});

describe.each(Object.values(MAPS))('map $id', (map) => {
  const areaKeys = new Set(map.objectives.flatMap((o) => o.hexes.map(key)));
  const hqs = map.objectives.filter((o) => o.kind === 'hq');
  const sameArea = (a: Hex[], b: Hex[]) => a.map(key).sort().join(' ') === b.map(key).sort().join(' ');

  it('has cells only inside its columns and rows', () => {
    for (const k of Object.keys(map.cells)) expect(onMap(map, parseKey(k)), k).toBe(true);
  });

  it('uses only known terrain and elevations 0 to 2', () => {
    for (const cell of Object.values(map.cells)) {
      expect(TERRAIN[cell.terrain]).toBeDefined();
      expect([0, 1, 2]).toContain(cell.elevation);
    }
  });

  const turns = turnsOf(map);
  const what = turns === 2 ? 'half-turn' : 'third-turn';

  it(`is ${what} symmetric in terrain and elevation`, () => {
    const unpaired: string[] = [];
    for (const [k, cell] of Object.entries(map.cells)) {
      const t = turn(map, parseKey(k));
      if (!onMap(map, t)) {
        expect(turns, `${k}: only a half turn of a rectangle leaves hexes unpaired`).toBe(2);
        // The turned hex falls off the board; see the note at the top of maps.ts.
        unpaired.push(k);
        expect(cell, k).toEqual({ terrain: 'open', elevation: 0 });
        continue;
      }
      expect(map.cells[key(t)], `${k} against ${key(t)}`).toEqual(cell);
    }
    // In odd-r layout only an end hex of every second row can lack a partner: the first hex of the even
    // rows when the centre hex is on an odd row, the last hex of the odd rows when it is on an even row.
    const centreRow = Math.floor(map.rows / 2);
    for (const k of unpaired) {
      const { col, row } = axialToOffset(parseKey(k));
      expect(col).toBe(centreRow % 2 === 1 ? 0 : map.cols - 1);
      expect(row % 2).toBe(centreRow % 2 === 1 ? 0 : 1);
    }
  });

  it(`is ${what} symmetric in objective areas, kinds and values`, () => {
    for (const o of map.objectives) {
      const twin = map.objectives.find((p) => sameArea(p.hexes, o.hexes.map((h) => turn(map, h))));
      expect(twin, `objective ${o.id}`).toBeDefined();
      expect([twin!.kind, twin!.value]).toEqual([o.kind, o.value]);
    }
  });

  /** The zone the map's turn takes zone z to: the one half (or a third of the) way round the HQs. */
  const twin = (z: number) => (z + map.spawns.length / turns) % map.spawns.length;
  const hqOf = (zone: number) => hqs.find((o) => o.zone === zone)!;

  it(`is ${what} symmetric in spawns, hex for hex in placement order, and in HQs`, () => {
    expect(map.spawns.length % turns).toBe(0);
    for (let z = 0; z < map.spawns.length; z++) {
      expect(map.spawns[twin(z)], `zone ${z}`).toEqual(map.spawns[z].map((h) => turn(map, h)));
      expect(sameArea(hqOf(twin(z)).hexes, hqOf(z).hexes.map((h) => turn(map, h))), `HQ of zone ${z}`).toBe(true);
    }
  });

  it('puts each HQ the same number of steps from every objective as its twin is from the other HQ', () => {
    const walk = (h: Hex) => TERRAIN[map.cells[key(h)]?.terrain ?? '']?.passable ?? false;
    const steps = (from: Hex[]) => {
      const d = new Map<string, number>(from.map((h) => [key(h), 0]));
      for (let f = [...from]; f.length > 0;) {
        const next: Hex[] = [];
        for (const h of f) for (const n of neighbors(h)) if (walk(n) && !d.has(key(n))) { d.set(key(n), d.get(key(h))! + 1); next.push(n); }
        f = next;
      }
      return d;
    };
    const into = (d: Map<string, number>, o: { hexes: Hex[] }) => Math.min(...o.hexes.map((h) => d.get(key(h)) ?? Infinity));
    const twinOf = (o: { hexes: Hex[] }) => map.objectives.find((p) => sameArea(p.hexes, o.hexes.map((h) => turn(map, h))))!;
    for (let z = 0; z < map.spawns.length; z++) {
      const here = steps(hqOf(z).hexes);
      const there = steps(hqOf(twin(z)).hexes);
      for (const o of map.objectives) expect(into(there, twinOf(o)), `HQ ${hqOf(z).id} to ${o.id}`).toBe(into(here, o));
    }
  });

  it('has one HQ per spawn zone, numbered in letter order; other objectives have no zone', () => {
    expect(hqs.map((o) => o.zone)).toEqual(map.spawns.map((_, z) => z));
    for (const o of map.objectives) if (o.kind !== 'hq') expect(o.zone, o.id).toBeNull();
  });

  it('puts every spawn hex nearer its own HQ than any other, and each HQ beside its zone', () => {
    for (const o of hqs) {
      const zone = map.spawns[o.zone!];
      for (const h of zone) {
        const own = areaDistance(o.hexes, h);
        for (const other of hqs) if (other !== o) expect(areaDistance(other.hexes, h), `${key(h)} of zone ${o.zone}`).toBeGreaterThan(own);
      }
      expect(Math.min(...zone.map((h) => areaDistance(o.hexes, h))), `HQ ${o.id}`).toBe(1);
    }
  });

  it('has a spawn zone of 8 hexes per HQ: on the map, passable, distinct, in no objective area', () => {
    expect(map.spawns).toHaveLength(hqs.length);
    const seen = new Set<string>();
    for (const zone of map.spawns) {
      expect(zone).toHaveLength(8);
      for (const h of zone) {
        const cell = map.cells[key(h)];
        expect(cell, key(h)).toBeDefined();
        expect(TERRAIN[cell.terrain].passable).toBe(true);
        expect(areaKeys.has(key(h))).toBe(false);
        expect(seen.has(key(h))).toBe(false);
        seen.add(key(h));
      }
    }
    expect(seen.size).toBe(8 * hqs.length);
  });

  it('lists each spawn zone nearest the centre first', () => {
    const c = centre(map);
    for (const zone of map.spawns) {
      const d = zone.map((h) => distance(h, c));
      expect(d).toEqual([...d].sort((a, b) => a - b));
    }
  });

  it('seats each player count it takes in distinct zones, two players opposite each other', () => {
    for (const [n, zones] of Object.entries(map.seatSpawns)) {
      expect(zones, `${n} players`).toHaveLength(Number(n));
      expect(new Set(zones).size).toBe(zones.length);
      for (const z of zones) expect(map.spawns[z]).toBeDefined();
    }
    if (map.seatSpawns[2]) expect(map.seatSpawns[2][1]).toBe(twin(map.seatSpawns[2][0]));
  });

  it('can be walked from end to end: every area hex is passable ground and every passable hex is reachable', () => {
    const walk = (h: Hex) => TERRAIN[map.cells[key(h)]?.terrain ?? '']?.passable ?? false;
    for (const o of map.objectives) for (const h of o.hexes) expect(walk(h), `objective ${o.id} at ${key(h)}`).toBe(true);
    const reached = new Set<string>([key(map.spawns[0][0])]);
    const queue = [map.spawns[0][0]];
    while (queue.length > 0) {
      for (const n of neighbors(queue.shift()!)) {
        if (!walk(n) || reached.has(key(n))) continue;
        reached.add(key(n));
        queue.push(n);
      }
    }
    const passable = Object.keys(map.cells).filter((k) => walk(parseKey(k)));
    expect(reached.size).toBe(passable.length);
  });

  it('has objectives with distinct letter ids, known kinds, and connected areas that do not overlap', () => {
    expect(new Set(map.objectives.map((o) => o.id)).size).toBe(map.objectives.length);
    expect(areaKeys.size).toBe(map.objectives.reduce((n, o) => n + o.hexes.length, 0));
    for (const o of map.objectives) {
      expect(o.id).toMatch(/^[A-Z]$/);
      expect(OBJECTIVE_KINDS[o.kind], o.kind).toBeDefined();
      expect(o.hexes.length).toBeGreaterThan(0);
      for (const h of o.hexes) expect(map.cells[key(h)]).toBeDefined();
      const all = new Set(o.hexes.map(key));
      const reached = new Set([key(o.hexes[0])]);
      const queue = [o.hexes[0]];
      while (queue.length > 0) for (const n of neighbors(queue.shift()!)) if (all.has(key(n)) && !reached.has(key(n))) { reached.add(key(n)); queue.push(n); }
      expect(reached.size, `area ${o.id} is connected`).toBe(all.size);
    }
  });
});

describe('crossroads', () => {
  const map = MAPS.crossroads;
  const c = centre(map);
  const walk = (h: Hex) => TERRAIN[map.cells[key(h)]?.terrain ?? '']?.passable ?? false;
  /** Steps over passable ground from `from` to every hex it can reach: what a unit walking there would take. */
  function steps(from: Hex): Map<string, number> {
    const d = new Map<string, number>([[key(from), 0]]);
    let frontier = [from];
    while (frontier.length > 0) {
      const next: Hex[] = [];
      for (const h of frontier) for (const n of neighbors(h)) {
        if (!walk(n) || d.has(key(n))) continue;
        d.set(key(n), d.get(key(h))! + 1);
        next.push(n);
      }
      frontier = next;
    }
    return d;
  }
  const byKind = (k: string) => map.objectives.filter((o) => o.kind === k);
  const into = (d: Map<string, number>, o: { hexes: Hex[] }) => Math.min(...o.hexes.map((h) => d.get(key(h))!));
  /** For every spawn hex of every zone: steps into the hill, into its nearest village, its nearest depot, and its HQ. */
  const walks = map.spawns.map((zone, z) => zone.map((h) => {
    const d = steps(h);
    const near = (k: string) => Math.min(...byKind(k).map((o) => into(d, o)));
    return { centre: d.get(key(c))!, hill: near('hill'), village: near('village'), depot: near('depot'), hq: into(d, byKind('hq').find((o) => o.zone === z)!) };
  }));

  it('is 17 by 13, every hex on the board, and lasts 15 rounds', () => {
    expect([map.cols, map.rows, map.maxRounds]).toEqual([17, 13, 15]);
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) expect(map.cells[key(offsetToAxial(col, row))], `col ${col}, row ${row}`).toBeDefined();
    }
    expect(Object.keys(map.cells)).toHaveLength(map.cols * map.rows);
  });

  it('uses every terrain and all three elevations', () => {
    const cells = Object.values(map.cells);
    expect(new Set(cells.map((x) => x.terrain))).toEqual(new Set(Object.values(TERRAIN_CHARS)));   // every map terrain; works are built, not drawn
    expect(new Set(cells.map((x) => x.elevation))).toEqual(new Set([0, 1, 2]));
  });

  it('has a hill worth 3 at the centre, four villages worth 2 around it, four depots worth 1 further out, two crossroads worth 1 on the middle row, and four HQs worth 1', () => {
    expect(map.objectives).toHaveLength(15);
    expect(byKind('hill').map((o) => o.value)).toEqual([3]);
    expect(byKind('hill')[0].hexes.map(key)).toContain(key(c));
    expect(byKind('village').map((o) => o.value)).toEqual([2, 2, 2, 2]);
    expect(byKind('depot').map((o) => o.value)).toEqual([1, 1, 1, 1]);
    expect(byKind('crossroads').map((o) => [o.id, o.value])).toEqual([['J', 1], ['K', 1]]);
    for (const o of byKind('crossroads')) for (const h of o.hexes) expect(axialToOffset(h).row, o.id).toBe(c.r);
    expect(byKind('hq').map((o) => [o.id, o.value])).toEqual([['W', 1], ['X', 1], ['Y', 1], ['Z', 1]]);
    const from = (o: { hexes: Hex[] }) => areaDistance(o.hexes, c);
    expect(Math.max(...byKind('village').map(from))).toBeLessThan(Math.min(...byKind('depot').map(from)));
    expect(Math.max(...byKind('depot').map(from))).toBeLessThan(Math.min(...byKind('hq').map(from)));
    expect(Math.max(...byKind('crossroads').map(from))).toBeLessThan(Math.min(...byKind('hq').map(from)));
    for (const o of map.objectives) if (o.kind !== 'hq') expect(o.hexes.length, o.id).toBeLessThanOrEqual(3);
  });

  it('draws each village round its hamlet\'s buildings', () => {
    for (const o of byKind('village')) for (const h of o.hexes) expect(map.cells[key(h)].terrain, o.id).toBe('building');
  });

  it('numbers the zones as before: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left', () => {
    const corner = (zone: Hex[]) => {
      const { col, row } = axialToOffset(zone[0]);
      return `${row < map.rows / 2 ? 'top' : 'bottom'}-${col < map.cols / 2 ? 'left' : 'right'}`;
    };
    expect(map.spawns.map(corner)).toEqual(['top-left', 'top-right', 'bottom-right', 'bottom-left']);
  });

  it('gives each start zone its own nearest village and its own nearest depot', () => {
    for (const k of ['village', 'depot']) {
      const nearest = map.spawns.map((zone) => {
        const reach = (o: { hexes: Hex[] }) => Math.min(...zone.map((h) => into(steps(h), o)));
        const best = Math.min(...byKind(k).map(reach));
        const ids = byKind(k).filter((o) => reach(o) === best).map((o) => o.id);
        expect(ids, `zone, nearest ${k}`).toHaveLength(1);
        return ids[0];
      });
      expect(new Set(nearest).size).toBe(4);
    }
  });

  it('puts the centre of the hill on the highest ground, in the open', () => {
    expect(map.cells[key(c)]).toEqual({ terrain: 'open', elevation: 2 });
  });

  it('is a mirror image north to south and east to west as well as under a half turn, but for the unpaired hexes', () => {
    const mirror = (h: Hex, flip: 'ns' | 'ew'): Hex | null => {
      const { col, row } = axialToOffset(h);
      const to = flip === 'ns' ? { col, row: map.rows - 1 - row } : { col: row % 2 === 0 ? map.cols - 1 - col : map.cols - 2 - col, row };
      return to.col < 0 || to.col >= map.cols ? null : offsetToAxial(to.col, to.row);
    };
    for (const flip of ['ns', 'ew'] as const) {
      for (const [k, cell] of Object.entries(map.cells)) {
        const m = mirror(parseKey(k), flip);
        if (m) expect(map.cells[key(m)], `${k} ${flip}`).toEqual(cell);
      }
      for (const o of map.objectives) {
        const m = o.hexes.map((h) => mirror(h, flip)!);
        const twin = map.objectives.find((p) => p.hexes.map(key).sort().join(' ') === m.map(key).sort().join(' '));
        expect([twin?.kind, twin?.value], `objective ${o.id} ${flip}`).toEqual([o.kind, o.value]);
      }
    }
  });

  it('has only the six end hexes of the odd rows unpaired under the half turn, all open and level', () => {
    const lone = Object.keys(map.cells).filter((k) => !onMap(map, turn(map, parseKey(k)))).map((k) => axialToOffset(parseKey(k)));
    expect(lone.map((o) => [o.col, o.row])).toEqual([1, 3, 5, 7, 9, 11].map((row) => [map.cols - 1, row]));
  });

  it('puts every start zone the same number of steps from the hill, its nearest village and depot, and its HQ, hex for hex in placement order', () => {
    for (let zone = 1; zone < 4; zone++) expect(walks[zone], `zone ${zone}`).toEqual(walks[0]);
    // ...and the best of each zone, which is what the fairness claim rests on.
    const best = (z: number, f: 'centre' | 'hill' | 'village' | 'depot' | 'hq') => Math.min(...walks[z].map((w) => w[f]));
    for (const f of ['centre', 'hill', 'village', 'depot', 'hq'] as const) expect(new Set([0, 1, 2, 3].map((z) => best(z, f))).size).toBe(1);
  });

  it('is four to five rounds of plain rifleman moves from every start hex to the centre, and not more than three into its village', () => {
    const move = UNITS.rifleman.move;
    for (const zone of walks) for (const w of zone) {
      expect(Math.ceil(w.centre / move)).toBeGreaterThanOrEqual(4);
      expect(Math.ceil(w.centre / move)).toBeLessThanOrEqual(5);
      expect(Math.ceil(w.village / move)).toBeLessThanOrEqual(3);
    }
  });

  it('cannot be crossed by a clear line from one start zone to another, so nobody sees the other squads at the start', () => {
    // The test in sight.test.ts does this with the real rules; here the map's own shape is checked: woods stand on
    // the middle row at both ends, and on the top, third, eleventh and bottom rows between the corners.
    const blocks = (col: number, row: number) => TERRAIN[map.cells[key(offsetToAxial(col, row))].terrain].blocksSight;
    for (const col of [0, 1, 2, 3, 4, 12, 13, 14, 15, 16]) expect(blocks(col, 6), `column ${col}, middle row`).toBe(true);
    for (const [col, row] of [[5, 0], [11, 0], [4, 2], [12, 2], [4, 10], [12, 10], [5, 12], [11, 12]]) expect(blocks(col, row), `${col}, ${row}`).toBe(true);
  });

  /** The parts the passable ground falls into once `without` is taken away too. */
  const parts = (without: Set<string>): string[][] => {
    const left = new Set(Object.keys(map.cells).filter((k) => walk(parseKey(k)) && !without.has(k)));
    const out: string[][] = [];
    while (left.size > 0) {
      const first = left.values().next().value!;
      const part = [first];
      left.delete(first);
      for (let i = 0; i < part.length; i++) for (const n of neighbors(parseKey(part[i]))) if (left.delete(key(n))) part.push(key(n));
      out.push(part);
    }
    return out;
  };

  it('has a stream down the middle, crossed only at a north ford, a south ford and the hill', () => {
    const water = Object.entries(map.cells).filter(([, x]) => x.terrain === 'water').map(([k]) => axialToOffset(parseKey(k)));
    for (const w of water) expect(w.col === 8 || (w.row % 2 === 1 && w.col === 7), `${w.col}, ${w.row}`).toBe(true);
    const north = key(offsetToAxial(8, 2));
    const south = key(offsetToAxial(8, 10));
    const hill = byKind('hill')[0].hexes.map(key);
    const slopes = [offsetToAxial(7, 5), offsetToAxial(8, 5), offsetToAxial(7, 7), offsetToAxial(8, 7)].map(key);
    for (const k of [north, south, ...hill, ...slopes]) expect(walk(parseKey(k)), k).toBe(true);
    expect(map.cells[north]).toEqual({ terrain: 'open', elevation: 0 });
    // Shut the three crossings and the map falls in two, a west half with zones 0 and 3, an east half with 1 and 2.
    const halves = parts(new Set([north, south, ...hill, ...slopes]));
    expect(halves).toHaveLength(2);
    const sideOf = (h: Hex) => halves.findIndex((p) => p.includes(key(h)));
    expect(sideOf(map.spawns[0][0])).toBe(sideOf(map.spawns[3][0]));
    expect(sideOf(map.spawns[1][0])).toBe(sideOf(map.spawns[2][0]));
    expect(sideOf(map.spawns[0][0])).not.toBe(sideOf(map.spawns[1][0]));
    // Any one crossing open joins them again.
    for (const open of [[north], [south], [...hill, ...slopes]]) {
      expect(parts(new Set([north, south, ...hill, ...slopes].filter((k) => !open.includes(k)))), open.join(' ')).toHaveLength(1);
    }
  });

  it('rings each hamlet with low walls, with gaps, and stands no wall anywhere else (none at the foot of the hill)', () => {
    const rings = new Set<string>();
    for (const o of byKind('village')) {
      const area = new Set(o.hexes.map(key));
      const ring = [...new Set(o.hexes.flatMap((h) => neighbors(h)).map(key))].filter((k) => !area.has(k));
      const walls = ring.filter((k) => map.cells[k]?.terrain === 'wall');
      const gaps = ring.filter((k) => map.cells[k]?.terrain !== 'wall');
      expect([ring.length, walls.length, gaps.length], o.id).toEqual([8, 5, 3]);
      for (const k of gaps) expect(walk(parseKey(k)), `${o.id} gap ${k}`).toBe(true);
      for (const k of ring) rings.add(k);
    }
    for (const [k, x] of Object.entries(map.cells)) if (x.terrain === 'wall') expect(rings.has(k), `wall at ${k}`).toBe(true);
  });
});

describe('ford', () => {
  const map = MAPS.ford;
  const c = centre(map);
  const walk = (h: Hex) => TERRAIN[map.cells[key(h)]?.terrain ?? '']?.passable ?? false;
  const byKind = (k: string) => map.objectives.filter((o) => o.kind === k);
  const at = (col: number, row: number) => key(offsetToAxial(col, row));
  const fords = { north: at(9, 1), south: at(3, 13), hill: key(c) };
  /** The parts the passable ground falls into once `shut` is taken away too. */
  const parts = (shut: string[]): string[][] => {
    const left = new Set(Object.keys(map.cells).filter((k) => walk(parseKey(k)) && !shut.includes(k)));
    const out: string[][] = [];
    while (left.size > 0) {
      const first = left.values().next().value!;
      const part = [first];
      left.delete(first);
      for (let i = 0; i < part.length; i++) for (const n of neighbors(parseKey(part[i]))) if (left.delete(key(n))) part.push(key(n));
      out.push(part);
    }
    return out;
  };
  const sides = parts(Object.values(fords));
  const sideOf = (o: { hexes: Hex[] }) => sides.findIndex((p) => p.includes(key(o.hexes[0])));
  const hq = (zone: number) => byKind('hq').find((o) => o.zone === zone)!;

  it('is 13 by 15 and lasts 15 rounds, with only the first hex of every second row left off the board', () => {
    expect([map.cols, map.rows, map.maxRounds]).toEqual([13, 15, 15]);
    for (let row = 0; row < map.rows; row++) for (let col = 0; col < map.cols; col++) {
      expect(map.cells[at(col, row)] !== undefined, `col ${col}, row ${row}`).toBe(!(col === 0 && row % 2 === 0));
    }
  });

  it('is made for two: two HQs worth 1, W in the north-west corner (zone 0) and X in the south-east (zone 1)', () => {
    expect(map.seatSpawns).toEqual({ 2: [0, 1] });
    expect(byKind('hq').map((o) => [o.id, o.value, o.zone])).toEqual([['W', 1, 0], ['X', 1, 1]]);
    expect(hq(0).hexes.map(axialToOffset)).toEqual([{ col: 1, row: 0 }, { col: 0, row: 1 }]);
    expect(hq(1).hexes.map(axialToOffset)).toEqual([{ col: 12, row: 13 }, { col: 12, row: 14 }]);
  });

  it('has a river across the other diagonal, crossed at a north ford, a south ford and the hill, and nowhere else', () => {
    for (const k of [fords.north, fords.south]) expect(['open', 'crops']).toContain(map.cells[k].terrain);
    expect(sides).toHaveLength(2);
    expect(sideOf(hq(0))).not.toBe(sideOf(hq(1)));
    for (const open of Object.values(fords)) expect(parts(Object.values(fords).filter((k) => k !== open)), open).toHaveLength(1);
    // The water runs from the top edge near the east corner to the bottom edge near the west one.
    const water = Object.entries(map.cells).filter(([, x]) => x.terrain === 'water').map(([k]) => axialToOffset(parseKey(k)));
    expect(water.find((w) => w.row === 0)?.col).toBeGreaterThan(map.cols / 2);
    expect(water.find((w) => w.row === map.rows - 1)?.col).toBeLessThan(map.cols / 2);
  });

  it('has the hill worth 3 at the centre, where the middle lane crosses, open all round', () => {
    const [hill] = byKind('hill');
    expect(byKind('hill')).toHaveLength(1);
    expect(hill.value).toBe(3);
    expect(hill.hexes.map(key)).toContain(key(c));
    expect(map.cells[key(c)]).toEqual({ terrain: 'open', elevation: 2 });
    expect(new Set(hill.hexes.map((h) => sideOf({ hexes: [h] })).filter((s) => s >= 0)).size).toBe(2);   // its ends are on both banks
    for (const [k, x] of Object.entries(map.cells)) {
      if (areaDistance(hill.hexes, parseKey(k)) <= 2) expect(TERRAIN[x.terrain].blocksSight, k).toBe(false);
    }
  });

  it('has a village on each side of the river by each edge-lane ford, and a depot and a gate (a crossroads) on each side', () => {
    const villages = byKind('village');
    expect(villages.map((o) => o.value)).toEqual([2, 2, 2, 2]);
    for (const o of villages) for (const h of o.hexes) expect(map.cells[key(h)].terrain, o.id).toBe('building');
    for (const f of [fords.north, fords.south]) {
      const near = villages.filter((o) => areaDistance(o.hexes, parseKey(f)) <= 3);
      expect(near.map(sideOf).sort(), f).toEqual([0, 1]);
    }
    expect(byKind('depot').map(sideOf).sort()).toEqual([0, 1]);
    expect(byKind('crossroads').map((o) => [o.id, o.value])).toEqual([['J', 1], ['K', 1]]);
    for (const [o, zone] of [[byKind('crossroads')[0], 0], [byKind('crossroads')[1], 1]] as const) {
      expect(sideOf(o)).toBe(sideOf(hq(zone)));
      expect(areaDistance(o.hexes, hq(zone).hexes[0])).toBeLessThanOrEqual(3);
    }
    expect(map.objectives).toHaveLength(11);
  });
});

describe('tripoint', () => {
  const map = MAPS.tripoint;
  const c = centre(map);
  const walk = (h: Hex) => TERRAIN[map.cells[key(h)]?.terrain ?? '']?.passable ?? false;
  const byKind = (k: string) => map.objectives.filter((o) => o.kind === k);
  const hq = (zone: number) => byKind('hq').find((o) => o.zone === zone)!;
  function steps(from: Hex[]): Map<string, number> {
    const d = new Map<string, number>(from.map((h) => [key(h), 0]));
    for (let f = [...from]; f.length > 0;) {
      const next: Hex[] = [];
      for (const h of f) for (const n of neighbors(h)) if (walk(n) && !d.has(key(n))) { d.set(key(n), d.get(key(h))! + 1); next.push(n); }
      f = next;
    }
    return d;
  }
  const into = (d: Map<string, number>, o: { hexes: Hex[] }) => Math.min(...o.hexes.map((h) => d.get(key(h)) ?? Infinity));
  const fromHq = [0, 1, 2].map((z) => steps(hq(z).hexes));
  /** The seats whose HQ is fewest steps from an objective. */
  const nearestSeats = (o: { hexes: Hex[] }) => {
    const d = fromHq.map((f) => into(f, o));
    return [0, 1, 2].filter((z) => d[z] === Math.min(...d));
  };
  // The three corners: the top, the bottom right, the bottom left.
  const corners = [offsetToAxial(8, 0), offsetToAxial(15, 15), offsetToAxial(0, 15)];
  /** The hexes of the edge from corner a to corner b, in order. */
  const edge = (a: Hex, b: Hex) => {
    const n = distance(a, b);
    return Array.from({ length: n + 1 }, (_, i) => ({ q: a.q + ((b.q - a.q) / n) * i, r: a.r + ((b.r - a.r) / n) * i }));
  };
  const edges = [edge(corners[0], corners[1]), edge(corners[1], corners[2]), edge(corners[2], corners[0])];

  it('is a triangle of 16 hexes a side (3k + 1, so its centre is a hex), point up, everything outside it off the board, 15 rounds', () => {
    expect([map.cols, map.rows, map.maxRounds]).toEqual([16, 16, 15]);
    for (let row = 0; row < map.rows; row++) {
      const cols = Array.from({ length: map.cols }, (_, col) => col).filter((col) => map.cells[key(offsetToAxial(col, row))]);
      expect(cols.length, `row ${row}`).toBe(row + 1);
      expect(cols[cols.length - 1] - cols[0], `row ${row} has no gap`).toBe(row);
    }
    expect(Object.keys(map.cells)).toHaveLength((16 * 17) / 2);
    expect(Number.isInteger(c.q) && Number.isInteger(c.r)).toBe(true);
    for (const corner of corners) expect(distance(corner, c)).toBe(10);
    for (const e of edges) expect(e.every((h) => map.cells[key(h)]), 'every hex of an edge is on the board').toBe(true);
  });

  it('is the same after a third of a turn about the centre hex: terrain, elevation, every objective, the spawns zone to zone in placement order', () => {
    const third = (h: Hex) => rotate(h, c, 2);
    for (const [k, cell] of Object.entries(map.cells)) expect(map.cells[key(third(parseKey(k)))], k).toEqual(cell);
    const areaKey = (hexes: Hex[]) => hexes.map(key).sort().join(' ');
    for (const o of map.objectives) {
      const turned = map.objectives.find((p) => areaKey(p.hexes) === areaKey(o.hexes.map(third)));
      expect([turned?.kind, turned?.value], o.id).toEqual([o.kind, o.value]);
    }
    for (let z = 0; z < 3; z++) {
      expect(map.spawns[(z + 1) % 3], `zone ${z}`).toEqual(map.spawns[z].map(third));
      expect(areaKey(hq((z + 1) % 3).hexes)).toBe(areaKey(hq(z).hexes.map(third)));
    }
  });

  it('is made for three: an HQ worth 1 in each corner, W at the top (zone 0), X bottom right (1), Y bottom left (2), the turn taking each to the next', () => {
    expect(map.seatSpawns).toEqual({ 3: [0, 1, 2] });
    expect(byKind('hq').map((o) => [o.id, o.value, o.zone])).toEqual([['W', 1, 0], ['X', 1, 1], ['Y', 1, 2]]);
    for (let z = 0; z < 3; z++) expect(hq(z).hexes).toEqual([corners[z]]);
    expect(rotate(corners[0], c, 2)).toEqual(corners[1]);
  });

  it('is four to five rounds of plain rifleman moves from every start hex to the centre', () => {
    const move = UNITS.rifleman.move;
    for (const zone of map.spawns) for (const h of zone) {
      const n = Math.ceil(steps([h]).get(key(c))! / move);
      expect(n, key(h)).toBeGreaterThanOrEqual(4);
      expect(n, key(h)).toBeLessThanOrEqual(5);
    }
  });

  it('has the hill worth 3 at the centre, on the highest ground, in the open, its slopes open too', () => {
    const [hill] = byKind('hill');
    expect(byKind('hill')).toHaveLength(1);
    expect(hill.value).toBe(3);
    expect(hill.hexes.map(key)).toContain(key(c));
    expect(map.cells[key(c)]).toEqual({ terrain: 'open', elevation: 2 });
    for (const n of neighbors(c)) expect(map.cells[key(n)]).toEqual({ terrain: 'open', elevation: 1 });
    expect(Math.max(...Object.values(map.cells).filter((x) => x !== map.cells[key(c)]).map((x) => x.elevation))).toBe(1);
  });

  it('has a spoke from each corner to the hill: open ground in a straight line, through the HQ\'s gate (a crossroads worth 1)', () => {
    expect(byKind('crossroads').map((o) => [o.id, o.value])).toEqual([['J', 1], ['K', 1], ['L', 1]]);
    for (let z = 0; z < 3; z++) {
      expect(fromHq[z].get(key(c)), `HQ ${hq(z).id} to the centre`).toBe(distance(corners[z], c));   // nothing in the way
      const gate = byKind('crossroads')[z];
      expect(nearestSeats(gate)).toEqual([z]);
      expect(gate.hexes.every((h) => distance(h, corners[z]) + distance(h, c) === distance(corners[z], c)), `gate ${gate.id} on the spoke`).toBe(true);
      expect(into(fromHq[z], gate)).toBe(4);
    }
  });

  it('makes each edge a lane shared by the two seats at its ends: open but for the village half way along, equally near both', () => {
    const villages = byKind('village');
    expect(villages.map((o) => [o.id, o.value])).toEqual([['D', 2], ['F', 2], ['G', 2]]);
    edges.forEach((e, i) => {
      const ends = [i, (i + 1) % 3].sort();
      const village = villages.filter((o) => o.hexes.every((h) => e.some((x) => key(x) === key(h))));
      expect(village, `edge ${i}`).toHaveLength(1);
      expect(village[0].hexes.map((h) => e.findIndex((x) => key(x) === key(h))).sort(), 'half way along').toEqual([7, 8]);
      expect(nearestSeats(village[0])).toEqual(ends);
      for (const h of village[0].hexes) expect(map.cells[key(h)].terrain).toBe('building');
      for (const h of e) if (!village[0].hexes.some((v) => key(v) === key(h))) expect(map.cells[key(h)].terrain, key(h)).toMatch(/^(open|wall)$/);
    });
  });

  it('puts two farms (depots worth 1) in each jungle, one near each seat that borders it: each seat has two, the same steps out', () => {
    const depots = byKind('depot');
    expect(depots.map((o) => o.value)).toEqual([1, 1, 1, 1, 1, 1]);
    const own = [0, 1, 2].map((z) => depots.filter((o) => nearestSeats(o).length === 1 && nearestSeats(o)[0] === z));
    for (let z = 0; z < 3; z++) {
      expect(own[z], `seat ${z}`).toHaveLength(2);
      expect(own[z].map((o) => into(fromHq[z], o))).toEqual([6, 6]);
    }
    for (const o of depots) expect(map.cells[key(o.hexes[0])].terrain, o.id).toBe('building');
  });

  it('has a pond in each jungle two steps from the hill, and no other water', () => {
    const water = Object.keys(map.cells).filter((k) => map.cells[k].terrain === 'water').map(parseKey);
    expect(water).toHaveLength(3);
    for (const w of water) expect(distance(w, c)).toBe(2);
  });
});

describe('objective kinds', () => {
  it('has hq, village, hill, crossroads and depot, keyed by their own id, each with what it gives (task 21)', () => {
    expect(Object.keys(OBJECTIVE_KINDS).sort()).toEqual(['crossroads', 'depot', 'hill', 'hq', 'village']);
    for (const [id, def] of Object.entries(OBJECTIVE_KINDS)) {
      expect(def.id).toBe(id);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.blurb.length).toBeGreaterThan(0);
    }
    const gives = (id: string) => { const k = OBJECTIVE_KINDS[id]; return [k.sight, k.move, k.supply, k.rally]; };
    expect(gives('hq')).toEqual([0, 0, 0, false]);
    expect(gives('village')).toEqual([0, 0, 1, false]);
    expect(gives('hill')).toEqual([2, 0, 0, false]);
    expect(gives('crossroads')).toEqual([0, 1, 0, false]);
    expect(gives('depot')).toEqual([0, 0, 2, true]);
  });
});

// A small drawing that reads: two HQs (A left, B right) with eight spawn hexes each, and a village C.
const SMALL: MapDrawing = {
  id: 't', name: 'T',
  terrain: [
    '. . . . . . . . . . .',
    ' . . . . . . . . . . .',
    '. . . . . . . . . . x',
  ],
  elevation: [
    '. . . . . . . . . . .',
    ' . . . . . . . . . . .',
    '. . . . . . . . . . x',
  ],
  marks: [
    'A 1 2 3 4 . 1 2 3 4 B',
    ' A 5 6 7 8 C 5 6 7 8 B',
    '. . . . . C . . . . x',
  ],
  objectives: { A: { kind: 'hq', value: 1 }, B: { kind: 'hq', value: 1 }, C: { kind: 'village', value: 2 } },
  seatSpawns: { 2: [0, 1] },
  maxRounds: 1,
};

describe('readMap', () => {
  const with_ = (marks: string[], objectives = SMALL.objectives) => ({ ...SMALL, marks, objectives });

  it('reads areas, HQs and their zones, and leaves an x off the board', () => {
    const map = readMap(SMALL);
    expect(map.objectives.map((o) => [o.id, o.kind, o.hexes.length, o.value, o.zone])).toEqual([
      ['A', 'hq', 2, 1, 0], ['B', 'hq', 2, 1, 1], ['C', 'village', 2, 2, null],
    ]);
    expect(map.objectives[2].hexes).toEqual([offsetToAxial(5, 1), offsetToAxial(5, 2)]);   // drawing order
    expect(map.spawns[0][0]).toEqual(offsetToAxial(1, 0));
    expect(map.spawns[1][0]).toEqual(offsetToAxial(6, 0));
    expect(map.cells[key(offsetToAxial(10, 2))]).toBeUndefined();
    expect(Object.keys(map.cells)).toHaveLength(11 * 3 - 1);
  });

  it('explains what is wrong with a bad drawing', () => {
    expect(() => readMap({ ...SMALL, terrain: ['. w', ' b'] })).toThrow(/terrain row 2 has 1 hexes/);
    expect(() => readMap({ ...SMALL, terrain: SMALL.terrain.map((r) => r.replace('.', 'q')) })).toThrow(/unknown terrain "q"/);
    expect(() => readMap({ ...SMALL, elevation: SMALL.elevation.map((r) => r.replace('.', '3')) })).toThrow(/unknown elevation "3"/);
    expect(() => readMap({ ...SMALL, terrain: SMALL.terrain.map((r) => r.replace(/^\. /, 'x ')) })).toThrow(/not on the board \(x\), so its elevation and mark must be \. or x/);
    expect(() => readMap({ ...SMALL, objectives: { ...SMALL.objectives, C: { kind: 'castle', value: 2 } } })).toThrow(/objective C has an unknown kind "castle"/);
    expect(() => readMap({ ...SMALL, objectives: { A: SMALL.objectives.A, B: SMALL.objectives.B } })).toThrow(/objective C has no entry/);
    expect(() => readMap({ ...SMALL, objectives: { ...SMALL.objectives, D: { kind: 'depot', value: 1 } } })).toThrow(/objective D is not drawn/);
    expect(() => readMap(with_(['A 1 2 3 4 C 1 2 3 4 B', ' A 5 6 7 8 . 5 6 7 8 B', '. . . . . C . . . . x'])))
      .toThrow(/objective C is drawn in more than one piece; an area must be connected/);
    expect(() => readMap(with_(['A 1 2 3 . 4 1 2 3 4 B', ' A 5 6 7 8 C 5 6 7 8 B', '. . . . . C . . . . x'])))
      .toThrow(/spawn hex 4 at row 1, column 6 is as near HQ A as HQ B/);
    expect(() => readMap(with_(['A 1 2 3 . . 1 2 3 4 B', ' A 5 6 7 8 C 5 6 7 8 B', '. . . . . C . . . . x'])))
      .toThrow(/spawn zone 0 \(HQ A\) has no hex numbered 4/);
    expect(() => readMap(with_(['. 1 2 3 4 . 1 2 3 4 .', ' . 5 6 7 8 C 5 6 7 8 .', '. . . . . C . . . . x'], { C: SMALL.objectives.C })))
      .toThrow(/spawn hexes are drawn but there is no HQ/);
  });
});
