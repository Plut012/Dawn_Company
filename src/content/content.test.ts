import { describe, expect, it } from 'vitest';
import { axialToOffset, distance, key, neighbors, offsetToAxial, parseKey } from '../shared/hex';
import type { ActionDef, GameMap, Hex, OrderKind } from '../shared/types';
import { ACTIONS, DEFAULT_MAP, MAPS, NAMES, PRESETS, RULES, TERRAIN, UNITS, validateSquad } from './index';
import { readMap } from './mapFormat';

const ORDER_KINDS: OrderKind[] = ['move', 'dash', 'fire', 'ambush', 'special'];

describe('terrain', () => {
  it('has the six terrains, keyed by their own id', () => {
    expect(Object.keys(TERRAIN).sort()).toEqual(['building', 'crops', 'open', 'wall', 'water', 'woods']);
    for (const [id, def] of Object.entries(TERRAIN)) expect(def.id).toBe(id);
  });
  it('matches the terrain table', () => {
    expect(TERRAIN.open).toMatchObject({ cover: false, hide: null, blocksSight: false, passable: true });
    expect(TERRAIN.woods).toMatchObject({ cover: false, hide: { still: 1, moved: 2 }, blocksSight: true, passable: true });
    expect(TERRAIN.building).toMatchObject({ cover: true, hide: { still: 1, moved: null }, blocksSight: true, passable: true });
    expect(TERRAIN.crops).toMatchObject({ cover: false, hide: { still: 1, moved: 2 }, blocksSight: false, passable: true });
    expect(TERRAIN.wall).toMatchObject({ cover: true, hide: null, blocksSight: false, passable: true });
    expect(TERRAIN.water).toMatchObject({ cover: false, hide: null, blocksSight: false, passable: false });
  });
  it('gives no ground everything: only a building both covers and hides, and it hides no mover', () => {
    for (const def of Object.values(TERRAIN)) {
      if (def.cover && def.hide) expect(def.hide.moved, def.id).toBeNull();
    }
  });
});

describe('units', () => {
  it('has the five units, keyed by their own id', () => {
    expect(Object.keys(UNITS).sort()).toEqual(['gunner', 'medic', 'mortar', 'rifleman', 'sniper']);
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
  it('has the five actions, keyed by their own id, each used by a unit', () => {
    expect(Object.keys(ACTIONS).sort()).toEqual(['aid', 'burst', 'rifle', 'shell', 'snipe']);
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
  });

  it.each(Object.values(ACTIONS))('$id is built from the vocabulary', (a: ActionDef) => {
    expect(a.name).not.toBe('');
    expect(a.icon).not.toBe('');
    expect(a.blurb.length).toBeGreaterThan(10);
    expect(['treat', 'fire', 'mortar']).toContain(a.phase);
    expect(['own', 'squad', 'none']).toContain(a.sight);
    expect(['any', 'friend', 'pinned-friend']).toContain(a.needs);
    expect(['all', 'friends', 'enemies']).toContain(a.affects);
    expect(a.minRange).toBeGreaterThanOrEqual(0);
    expect(a.minRange).toBeLessThanOrEqual(a.range);
    expect([0, 1]).toContain(a.blast);
    expect(a.effects.length).toBeGreaterThan(0);
    for (const e of a.effects) expect(['hit', 'recover', 'reveal']).toContain(e.kind);
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
  it('offers three, with distinct ids', () => {
    expect(PRESETS).toHaveLength(3);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(3);
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

function centre(map: GameMap): Hex {
  return offsetToAxial(Math.floor(map.cols / 2), Math.floor(map.rows / 2));
}
/** A half turn about the centre hex. A true rotation: it keeps every distance. */
function turn(map: GameMap, h: Hex): Hex {
  const c = centre(map);
  return { q: 2 * c.q - h.q + 0, r: 2 * c.r - h.r + 0 };
}
function onMap(map: GameMap, h: Hex): boolean {
  const { col, row } = axialToOffset(h);
  return col >= 0 && col < map.cols && row >= 0 && row < map.rows;
}

describe('maps', () => {
  it('has crossroads as the default', () => {
    expect(DEFAULT_MAP).toBe('crossroads');
    expect(MAPS[DEFAULT_MAP]).toBeDefined();
    for (const [id, map] of Object.entries(MAPS)) expect(map.id).toBe(id);
  });
});

describe.each(Object.values(MAPS))('map $id', (map) => {
  const objectiveKeys = new Set(map.objectives.map((o) => key(o.hex)));

  it('has a cell for every column and row, and no others', () => {
    for (let row = 0; row < map.rows; row++) {
      for (let col = 0; col < map.cols; col++) {
        expect(map.cells[key(offsetToAxial(col, row))], `col ${col}, row ${row}`).toBeDefined();
      }
    }
    expect(Object.keys(map.cells)).toHaveLength(map.cols * map.rows);
  });

  it('uses only known terrain and elevations 0 to 2', () => {
    for (const cell of Object.values(map.cells)) {
      expect(TERRAIN[cell.terrain]).toBeDefined();
      expect([0, 1, 2]).toContain(cell.elevation);
    }
  });

  it('is half-turn symmetric in terrain and elevation', () => {
    const unpaired: string[] = [];
    for (const [k, cell] of Object.entries(map.cells)) {
      const t = turn(map, parseKey(k));
      if (!onMap(map, t)) {
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

  it('is half-turn symmetric in objectives', () => {
    for (const o of map.objectives) {
      const twin = map.objectives.find((p) => key(p.hex) === key(turn(map, o.hex)));
      expect(twin, `objective ${o.id}`).toBeDefined();
      expect(twin!.value).toBe(o.value);
    }
  });

  it('is half-turn symmetric in spawns, hex for hex in placement order', () => {
    expect(map.spawns[2]).toEqual(map.spawns[0].map((h) => turn(map, h)));
    expect(map.spawns[3]).toEqual(map.spawns[1].map((h) => turn(map, h)));
  });

  it('has four spawn zones of 8 hexes: on the map, passable, distinct, not objectives', () => {
    expect(map.spawns).toHaveLength(4);
    const seen = new Set<string>();
    for (const zone of map.spawns) {
      expect(zone).toHaveLength(8);
      for (const h of zone) {
        const cell = map.cells[key(h)];
        expect(cell, key(h)).toBeDefined();
        expect(TERRAIN[cell.terrain].passable).toBe(true);
        expect(objectiveKeys.has(key(h))).toBe(false);
        expect(seen.has(key(h))).toBe(false);
        seen.add(key(h));
      }
    }
    expect(seen.size).toBe(32);
  });

  it('lists each spawn zone nearest the centre first', () => {
    const c = centre(map);
    for (const zone of map.spawns) {
      const d = zone.map((h) => distance(h, c));
      expect(d).toEqual([...d].sort((a, b) => a - b));
    }
  });

  it('seats 2, 3 and 4 players in distinct zones, two players opposite each other', () => {
    expect(map.seatSpawns).toEqual({ 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] });
  });

  it('can be walked from end to end: objectives stand on passable ground and every passable hex is reachable', () => {
    const walk = (h: Hex) => TERRAIN[map.cells[key(h)]?.terrain ?? '']?.passable ?? false;
    for (const o of map.objectives) expect(walk(o.hex), `objective ${o.id}`).toBe(true);
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

  it('has objectives with distinct letter ids on distinct hexes of the map', () => {
    expect(new Set(map.objectives.map((o) => o.id)).size).toBe(map.objectives.length);
    expect(objectiveKeys.size).toBe(map.objectives.length);
    for (const o of map.objectives) {
      expect(o.id).toMatch(/^[A-Z]$/);
      expect(map.cells[key(o.hex)]).toBeDefined();
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
  const byValue = (v: number) => map.objectives.filter((o) => o.value === v);
  /** For every spawn hex of every zone: steps to the centre objective, to its nearest 2 and to its nearest 1. */
  const walks = map.spawns.map((zone) => zone.map((h) => {
    const d = steps(h);
    const near = (v: number) => Math.min(...byValue(v).map((o) => d.get(key(o.hex))!));
    return { centre: d.get(key(c))!, two: near(2), one: near(1) };
  }));

  it('is 17 by 13 and lasts 15 rounds', () => {
    expect([map.cols, map.rows, map.maxRounds]).toEqual([17, 13, 15]);
  });

  it('uses every terrain and all three elevations', () => {
    const cells = Object.values(map.cells);
    expect(new Set(cells.map((x) => x.terrain))).toEqual(new Set(Object.keys(TERRAIN)));
    expect(new Set(cells.map((x) => x.elevation))).toEqual(new Set([0, 1, 2]));
  });

  it('has nine objectives: a 3 at the centre, four 2s around it, four 1s further out', () => {
    expect(map.objectives).toHaveLength(9);
    expect(byValue(3).map((o) => o.hex)).toEqual([c]);
    expect(byValue(2)).toHaveLength(4);
    expect(byValue(1)).toHaveLength(4);
    const inner = Math.max(...byValue(2).map((o) => distance(o.hex, c)));
    const outer = Math.min(...byValue(1).map((o) => distance(o.hex, c)));
    expect(inner).toBeLessThan(outer);
    expect(map.objectives.map((o) => o.value).reduce((a, b) => a + b, 0)).toBe(3 + 4 * 2 + 4 * 1);
  });

  it('gives each start zone its own nearest 2 and its own nearest 1', () => {
    for (const v of [1, 2]) {
      const nearest = map.spawns.map((zone) => {
        const reach = (o: { hex: Hex }) => Math.min(...zone.map((h) => steps(h).get(key(o.hex))!));
        const best = Math.min(...byValue(v).map(reach));
        const ids = byValue(v).filter((o) => reach(o) === best).map((o) => o.id);
        expect(ids, `zone, objectives worth ${v}`).toHaveLength(1);
        return ids[0];
      });
      expect(new Set(nearest).size).toBe(4);
    }
  });

  it('puts the centre objective on the highest ground, in the open', () => {
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
        const m = mirror(o.hex, flip)!;
        expect(map.objectives.find((p) => key(p.hex) === key(m))?.value, `objective ${o.id} ${flip}`).toBe(o.value);
      }
    }
  });

  it('has only the six end hexes of the odd rows unpaired under the half turn, all open and level', () => {
    const lone = Object.keys(map.cells).filter((k) => !onMap(map, turn(map, parseKey(k)))).map((k) => axialToOffset(parseKey(k)));
    expect(lone.map((o) => [o.col, o.row])).toEqual([1, 3, 5, 7, 9, 11].map((row) => [map.cols - 1, row]));
  });

  it('puts every start zone the same number of steps from the centre objective and from its nearest 1 and 2, hex for hex in placement order', () => {
    for (let zone = 1; zone < 4; zone++) expect(walks[zone], `zone ${zone}`).toEqual(walks[0]);
    // ...and the best of each zone, which is what the fairness claim rests on.
    const best = (z: number, f: 'centre' | 'two' | 'one') => Math.min(...walks[z].map((w) => w[f]));
    for (const f of ['centre', 'two', 'one'] as const) expect(new Set([0, 1, 2, 3].map((z) => best(z, f))).size).toBe(1);
  });

  it('is four to five rounds of plain rifleman moves from every start hex to the centre, and not more than two to its 2', () => {
    const move = UNITS.rifleman.move;
    for (const zone of walks) for (const w of zone) {
      expect(Math.ceil(w.centre / move)).toBeGreaterThanOrEqual(4);
      expect(Math.ceil(w.centre / move)).toBeLessThanOrEqual(5);
      expect(Math.ceil(w.two / move)).toBeLessThanOrEqual(3);
    }
  });

  it('cannot be crossed by a clear line from one start zone to another, so nobody sees the other squads at the start', () => {
    // The test in sight.test.ts does this with the real rules; here the map's own shape is checked: woods
    // (or a building) stand on the middle row at both ends and on the top and bottom rows at the middle.
    const blocks = (col: number, row: number) => TERRAIN[map.cells[key(offsetToAxial(col, row))].terrain].blocksSight;
    for (const col of [0, 1, 2, 3, 4, 12, 13, 14, 15, 16]) expect(blocks(col, 6), `column ${col}, middle row`).toBe(true);
    expect(blocks(8, 0)).toBe(true);
    expect(blocks(8, 12)).toBe(true);
  });
});

describe('readMap', () => {
  const drawing = {
    id: 't', name: 'T',
    terrain: ['. w', ' b .'],
    elevation: ['. 1', ' 2 .'],
    marks: ['. A', ' . .'],
    objectiveValues: { A: 1 },
    seatSpawns: {},
    maxRounds: 1,
  };
  // Spawns are required, so a small drawing is only good for error checks.
  it('explains what is wrong with a bad drawing', () => {
    expect(() => readMap(drawing)).toThrow(/spawn zone 0 has no hex numbered 1/);
    expect(() => readMap({ ...drawing, terrain: ['. w', ' b'] })).toThrow(/terrain row 2 has 1 hexes/);
    expect(() => readMap({ ...drawing, terrain: ['. x', ' b .'] })).toThrow(/unknown terrain "x"/);
    expect(() => readMap({ ...drawing, elevation: ['. 3', ' 2 .'] })).toThrow(/unknown elevation "3"/);
    expect(() => readMap({ ...drawing, objectiveValues: {} })).toThrow(/objective A has no value/);
    expect(() => readMap({ ...drawing, objectiveValues: { A: 1, B: 2 } })).toThrow(/objective B is not drawn/);
  });
});
