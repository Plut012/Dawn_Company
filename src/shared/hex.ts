// Hex maths. Axial coordinates (q, r), pointy-top hexes, r grows downwards.
// Pure functions; no state.

import type { Hex, HexKey } from './types';

const SQRT3 = Math.sqrt(3);

// Fixed order: E, NE, NW, W, SW, SE.
const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function key(h: Hex): HexKey {
  return `${h.q},${h.r}`;
}

export function parseKey(k: HexKey): Hex {
  const [q, r] = k.split(',');
  return { q: Number(q), r: Number(r) };
}

export function eq(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

/** The six neighbours, always in the order E, NE, NW, W, SW, SE. */
export function neighbors(h: Hex): Hex[] {
  return DIRECTIONS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Round fractional axial coordinates to the hex that contains them. */
function round(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  // "+ 0" turns -0 into 0, so results compare and print cleanly.
  return { q: rq + 0, r: rr + 0 };
}

// A tiny fixed push off the exact centre line, so a line that runs exactly
// along a hex edge always falls on the same side.
const NUDGE_Q = 1e-6;
const NUDGE_R = 2e-6;

/**
 * Hexes from a to b, both included. Always distance(a, b) + 1 hexes, each
 * adjacent to the next. Symmetric: line(a, b) is line(b, a) reversed, because
 * the line is always computed from the endpoint that sorts first (by q, then
 * r) and reversed when that is not `a`.
 */
export function line(a: Hex, b: Hex): Hex[] {
  const swap = a.q > b.q || (a.q === b.q && a.r > b.r);
  const from = swap ? b : a;
  const to = swap ? a : b;
  const n = distance(from, to);
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    out.push(
      round(
        from.q + NUDGE_Q + (to.q - from.q) * t,
        from.r + NUDGE_R + (to.r - from.r) * t,
      ),
    );
  }
  return swap ? out.reverse() : out;
}

/**
 * Every hex at most `radius` away from h, including h: 1, 7, 19, ... hexes.
 * Order: q ascending, then r ascending.
 */
export function within(h: Hex, radius: number): Hex[] {
  const out: Hex[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const lo = Math.max(-radius, -dq - radius);
    const hi = Math.min(radius, -dq + radius);
    for (let dr = lo; dr <= hi; dr++) out.push({ q: h.q + dq, r: h.r + dr });
  }
  return out;
}

/** Odd-r offset (odd rows shifted right by half a hex) to axial. */
export function offsetToAxial(col: number, row: number): Hex {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

export function axialToOffset(h: Hex): { col: number; row: number } {
  return { col: h.q + (h.r - (h.r & 1)) / 2, row: h.r };
}

/**
 * Map label such as "F4": offset column as a letter (0 = "A"), offset row as
 * a number from 1 (0 = "1"). Columns past 25 continue AA, AB, ... A hex left
 * of column A or above row 1 is off every map; its column shows as "?".
 */
export function label(h: Hex): string {
  const { col, row } = axialToOffset(h);
  if (col < 0) return `?${row + 1}`;
  let letters = '';
  for (let n = col; n >= 0; n = Math.floor(n / 26) - 1) {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
  }
  return `${letters}${row + 1}`;
}

/** Centre of a hex. `size` is the circumradius (centre to corner). */
export function hexToPixel(h: Hex, size: number): { x: number; y: number } {
  return { x: size * SQRT3 * (h.q + h.r / 2), y: size * 1.5 * h.r };
}

/** The hex containing the point (x, y); the inverse of hexToPixel. */
export function pixelToHex(x: number, y: number, size: number): Hex {
  const r = y / (size * 1.5);
  const q = x / (size * SQRT3) - r / 2;
  return round(q, r);
}
