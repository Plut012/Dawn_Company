# 01 — Foundation

## Overview
Set up the project and write the three shared files every other task builds
on: the data shapes, the message protocol, and the hex maths. After this
task, any later task can start from a working `npm test` and `npm run dev`.

Read first: `docs/vision.md` (Architecture), `docs/tasks/00-plan.md`.

## The work

**Project setup**
- `git init`; `.gitignore` with `node_modules`, `dist`, `matches`.
- One `package.json`, `"type": "module"`. Dev dependencies: `typescript`,
  `vite`, `vitest`, `tsx`, `@types/node`. Nothing else yet.
- `tsconfig.json`: strict, ES2022, `moduleResolution: bundler`, `noEmit`.
- `vite.config.ts`: project root is the repo root; dev server on 5173,
  listening on all interfaces; proxy `/ws` (WebSocket) to `localhost:8080`.
- Scripts: `dev` (vite), `build` (vite build), `test` (vitest run),
  `typecheck` (tsc --noEmit).
- A placeholder `index.html` at the root that says the client arrives in
  task 08.
- Empty folders are not needed; later tasks create their own.

**`src/shared/types.ts`** — copy the block under "Shared types" in
`00-plan.md` exactly. Types only, no logic.

**`src/shared/protocol.ts`** — copy the block under "Protocol" in
`00-plan.md` exactly, importing what it needs from `types.ts`.

**`src/shared/hex.ts`** — implement:

```ts
key(h: Hex): HexKey
parseKey(k: HexKey): Hex
eq(a: Hex, b: Hex): boolean
neighbors(h: Hex): Hex[]                 // 6, fixed order: E, NE, NW, W, SW, SE
distance(a: Hex, b: Hex): number
line(a: Hex, b: Hex): Hex[]              // inclusive; line(a,b) is line(b,a) reversed
within(h: Hex, radius: number): Hex[]    // includes h
offsetToAxial(col: number, row: number): Hex   // odd-r offset: odd rows shifted right
axialToOffset(h: Hex): { col: number; row: number }
label(h: Hex): string                    // "F4": column letter, row number from 1
hexToPixel(h: Hex, size: number): { x: number; y: number }   // size = circumradius
pixelToHex(x: number, y: number, size: number): Hex
```
- Axial coordinates, pointy-top hexes.
- `line` must be symmetric. Always compute it from the endpoint that sorts
  first (by `q`, then `r`) and reverse if needed. Use cube-coordinate
  interpolation with a small fixed nudge so a line running exactly along a
  hex edge always picks the same side.
- `within` returns hexes in a fixed, documented order.
- `label`: offset column 0 is "A"; offset row 0 is "1".

**Tests** (`src/shared/hex.test.ts`): distance, neighbour order, line
symmetry over many random pairs, line length = distance + 1, offset round
trip, pixel round trip, `within` counts (1, 7, 19).

## Out of scope
Content, rules, server, rendering, UI. No three.js.

## Eval page — `eval/01-foundation.html`
Opened at `http://localhost:5173/eval/01-foundation.html`. Uses the real
`hex.ts`, drawn on a 2D canvas or SVG:
- A 13 × 11 hex grid (odd-r offset), each hex showing its `label`.
- Hover shows axial coordinates, offset coordinates and label.
- Click two hexes: the page draws `line(a, b)`, shows `distance(a, b)`, and
  confirms `line(b, a)` is the same hexes reversed.
- A radius control highlights `within(hovered, radius)`.
- A line stating the Vitest result count, taken from a real `npm test` run
  and pasted in with the date.
