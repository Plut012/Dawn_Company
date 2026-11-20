import { describe, expect, it } from 'vitest';
import type { Hex } from './types';
import {
  axialToOffset, distance, eq, hexToPixel, key, label, line, neighbors,
  offsetToAxial, parseKey, pixelToHex, rotate, within,
} from './hex';

// Small seeded generator, so "random" tests are the same on every run.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
function randomHex(rand: () => number, span = 20): Hex {
  return {
    q: Math.floor(rand() * (2 * span + 1)) - span,
    r: Math.floor(rand() * (2 * span + 1)) - span,
  };
}

describe('key, parseKey, eq', () => {
  it('formats and parses keys', () => {
    expect(key({ q: 3, r: -2 })).toBe('3,-2');
    expect(parseKey('3,-2')).toEqual({ q: 3, r: -2 });
    expect(parseKey(key({ q: -7, r: 0 }))).toEqual({ q: -7, r: 0 });
  });
  it('compares hexes by value', () => {
    expect(eq({ q: 1, r: 2 }, { q: 1, r: 2 })).toBe(true);
    expect(eq({ q: 1, r: 2 }, { q: 2, r: 1 })).toBe(false);
  });
});

describe('neighbors', () => {
  it('returns six hexes in the order E, NE, NW, W, SW, SE', () => {
    expect(neighbors({ q: 0, r: 0 })).toEqual([
      { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
      { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
    ]);
  });
  it('matches the compass on screen (x right, y down)', () => {
    const at = neighbors({ q: 2, r: 3 }).map((n) => hexToPixel(n, 1));
    const c = hexToPixel({ q: 2, r: 3 }, 1);
    const [e, ne, nw, w, sw, se] = at.map((p) => ({ dx: p.x - c.x, dy: p.y - c.y }));
    expect(e.dx).toBeGreaterThan(0); expect(e.dy).toBeCloseTo(0);
    expect(ne.dx).toBeGreaterThan(0); expect(ne.dy).toBeLessThan(0);
    expect(nw.dx).toBeLessThan(0); expect(nw.dy).toBeLessThan(0);
    expect(w.dx).toBeLessThan(0); expect(w.dy).toBeCloseTo(0);
    expect(sw.dx).toBeLessThan(0); expect(sw.dy).toBeGreaterThan(0);
    expect(se.dx).toBeGreaterThan(0); expect(se.dy).toBeGreaterThan(0);
  });
  it('are all at distance 1', () => {
    const h = { q: -4, r: 9 };
    for (const n of neighbors(h)) expect(distance(h, n)).toBe(1);
  });
});

describe('distance', () => {
  it('knows fixed cases', () => {
    expect(distance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    expect(distance({ q: 0, r: 0 }, { q: 3, r: 0 })).toBe(3);
    expect(distance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3);
    expect(distance({ q: 0, r: 0 }, { q: 2, r: 2 })).toBe(4);
    expect(distance({ q: -1, r: -1 }, { q: 1, r: 1 })).toBe(4);
    expect(distance({ q: 1, r: -2 }, { q: -2, r: 3 })).toBe(5);
  });
  it('is symmetric', () => {
    const rand = rng(1);
    for (let i = 0; i < 200; i++) {
      const a = randomHex(rand), b = randomHex(rand);
      expect(distance(a, b)).toBe(distance(b, a));
    }
  });
});

describe('line', () => {
  it('of a hex to itself is that hex', () => {
    expect(line({ q: 2, r: 2 }, { q: 2, r: 2 })).toEqual([{ q: 2, r: 2 }]);
  });
  it('runs straight along a row', () => {
    expect(line({ q: 0, r: 0 }, { q: 3, r: 0 })).toEqual([
      { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 },
    ]);
  });
  it('is symmetric, contiguous and distance + 1 long over 2000 random pairs', () => {
    const rand = rng(42);
    for (let i = 0; i < 2000; i++) {
      const a = randomHex(rand), b = randomHex(rand);
      const ab = line(a, b);
      const ba = line(b, a);
      expect(ab).toEqual([...ba].reverse());
      expect(ab.length).toBe(distance(a, b) + 1);
      expect(ab[0]).toEqual(a);
      expect(ab[ab.length - 1]).toEqual(b);
      for (let j = 1; j < ab.length; j++) expect(distance(ab[j - 1], ab[j])).toBe(1);
    }
  });
  it('picks the same side when the line runs exactly along a hex edge', () => {
    // (0,0) -> (1,1) passes exactly between (1,0) and (0,1); so does every
    // translation and rotation of it. Whatever side is picked must be stable
    // and the same in both directions.
    const edgeCases: [Hex, Hex][] = [
      [{ q: 0, r: 0 }, { q: 1, r: 1 }],
      [{ q: 0, r: 0 }, { q: 2, r: -1 }],
      [{ q: 0, r: 0 }, { q: 1, r: -2 }],
      [{ q: 0, r: 0 }, { q: 3, r: 3 }],
      [{ q: 5, r: -3 }, { q: 1, r: 5 }],
    ];
    for (const [a, b] of edgeCases) {
      const first = line(a, b);
      expect(first.length).toBe(distance(a, b) + 1);
      expect(line(a, b)).toEqual(first);
      expect(line(b, a)).toEqual([...first].reverse());
    }
    // The choice does not depend on where on the board the line is.
    const base = line({ q: 0, r: 0 }, { q: 1, r: 1 });
    const moved = line({ q: 7, r: -4 }, { q: 8, r: -3 });
    expect(moved.map((h) => ({ q: h.q - 7, r: h.r + 4 }))).toEqual(base);
  });
});

describe('within', () => {
  it('counts 1, 7, 19 for radius 0, 1, 2', () => {
    const h = { q: 4, r: -1 };
    expect(within(h, 0)).toEqual([h]);
    expect(within(h, 1).length).toBe(7);
    expect(within(h, 2).length).toBe(19);
    expect(within(h, 3).length).toBe(37);
  });
  it('holds exactly the hexes within the radius, with no repeats', () => {
    const h = { q: -2, r: 5 };
    const got = within(h, 3);
    expect(new Set(got.map(key)).size).toBe(got.length);
    for (const g of got) expect(distance(h, g)).toBeLessThanOrEqual(3);
    expect(got.some((g) => eq(g, h))).toBe(true);
  });
  it('is ordered by q, then r', () => {
    expect(within({ q: 0, r: 0 }, 1)).toEqual([
      { q: -1, r: 0 }, { q: -1, r: 1 },
      { q: 0, r: -1 }, { q: 0, r: 0 }, { q: 0, r: 1 },
      { q: 1, r: -1 }, { q: 1, r: 0 },
    ]);
  });
});

describe('offset coordinates (odd-r)', () => {
  it('converts fixed cases', () => {
    expect(offsetToAxial(0, 0)).toEqual({ q: 0, r: 0 });
    expect(offsetToAxial(0, 1)).toEqual({ q: 0, r: 1 });
    expect(offsetToAxial(0, 2)).toEqual({ q: -1, r: 2 });
    expect(offsetToAxial(5, 3)).toEqual({ q: 4, r: 3 });
  });
  it('shifts odd rows right by half a hex', () => {
    const even = hexToPixel(offsetToAxial(2, 0), 1);
    const odd = hexToPixel(offsetToAxial(2, 1), 1);
    const next = hexToPixel(offsetToAxial(3, 0), 1);
    expect(odd.x - even.x).toBeCloseTo((next.x - even.x) / 2);
    expect(hexToPixel(offsetToAxial(2, 2), 1).x).toBeCloseTo(even.x);
  });
  it('round trips, negatives included', () => {
    for (let col = -6; col <= 14; col++) {
      for (let row = -6; row <= 12; row++) {
        expect(axialToOffset(offsetToAxial(col, row))).toEqual({ col, row });
      }
    }
    const rand = rng(7);
    for (let i = 0; i < 200; i++) {
      const h = randomHex(rand);
      const o = axialToOffset(h);
      expect(offsetToAxial(o.col, o.row)).toEqual(h);
    }
  });
});

describe('label', () => {
  it('uses a column letter and a row number from 1', () => {
    expect(label(offsetToAxial(0, 0))).toBe('A1');
    expect(label(offsetToAxial(5, 3))).toBe('F4');
    expect(label(offsetToAxial(12, 10))).toBe('M11');
    expect(label(offsetToAxial(25, 0))).toBe('Z1');
    expect(label(offsetToAxial(26, 0))).toBe('AA1');
  });
});

describe('pixels', () => {
  it('places hexes for a pointy-top grid', () => {
    expect(hexToPixel({ q: 0, r: 0 }, 10)).toEqual({ x: 0, y: 0 });
    const e = hexToPixel({ q: 1, r: 0 }, 10);
    expect(e.x).toBeCloseTo(10 * Math.sqrt(3)); expect(e.y).toBeCloseTo(0);
    const se = hexToPixel({ q: 0, r: 1 }, 10);
    expect(se.x).toBeCloseTo(5 * Math.sqrt(3)); expect(se.y).toBeCloseTo(15);
  });
  it('round trips hex centres', () => {
    const rand = rng(99);
    for (let i = 0; i < 500; i++) {
      const h = randomHex(rand);
      const size = 1 + rand() * 40;
      const p = hexToPixel(h, size);
      expect(pixelToHex(p.x, p.y, size)).toEqual(h);
    }
  });
  it('maps any point inside a hex back to that hex', () => {
    const rand = rng(5);
    const size = 24;
    const inradius = (size * Math.sqrt(3)) / 2;
    for (let i = 0; i < 500; i++) {
      const h = randomHex(rand);
      const p = hexToPixel(h, size);
      const angle = rand() * Math.PI * 2;
      const d = rand() * inradius * 0.98;
      expect(pixelToHex(p.x + Math.cos(angle) * d, p.y + Math.sin(angle) * d, size)).toEqual(h);
    }
  });
});

describe('rotate', () => {
  const c = { q: 3, r: 10 };
  it('turns E to SE (clockwise on the screen), one sixth at a time', () => {
    const ring = neighbors(c);   // E, NE, NW, W, SW, SE
    // Clockwise on the screen: E -> SE -> SW -> W -> NW -> NE.
    const order = [0, 5, 4, 3, 2, 1].map((i) => ring[i]);
    for (let i = 0; i < 6; i++) expect(rotate(order[i], c, 1)).toEqual(order[(i + 1) % 6]);
  });
  it('is (q, r) -> (-q - r, q) about the centre for a third of a turn, and (-q, -r) for a half', () => {
    const rand = rng(7);
    for (let i = 0; i < 200; i++) {
      const h = randomHex(rand);
      const [a, b] = [h.q - c.q, h.r - c.r];
      expect(rotate(h, c, 2)).toEqual({ q: -a - b + c.q + 0, r: a + c.r + 0 });
      expect(rotate(h, c, 3)).toEqual({ q: -a + c.q + 0, r: -b + c.r + 0 });
    }
  });
  it('keeps distances, leaves the centre where it is, comes back after six sixths, and undoes itself turned back', () => {
    const rand = rng(8);
    expect(rotate(c, c, 2)).toEqual(c);
    for (let i = 0; i < 200; i++) {
      const a = randomHex(rand), b = randomHex(rand);
      const n = Math.floor(rand() * 13) - 6;
      expect(distance(rotate(a, c, n), rotate(b, c, n))).toBe(distance(a, b));
      expect(distance(rotate(a, c, n), c)).toBe(distance(a, c));
      expect(rotate(a, c, 6)).toEqual(a);
      expect(rotate(rotate(a, c, n), c, -n)).toEqual(a);
    }
  });
});
