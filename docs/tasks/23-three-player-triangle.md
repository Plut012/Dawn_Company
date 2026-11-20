# 23 — Three-player triangle

## Overview
Three seats cannot be fair on a rectangle (task 15 measured the seat opposite
the empty corner winning 0.18 of the time). **`tripoint`** is a triangle of
hexes that looks the same after a third of a turn about its centre, with an
HQ in each corner. Each edge is a lane shared by two players — a border to
fight over, and the third player can always come in on it. A lane runs from
each corner to the centre prize, with jungle in the wedges between.

Read first: `docs/vision.md`; `docs/tasks/00-plan.md` (*v2*: Map drawing);
`src/shared/hex.ts`, `src/content/mapFormat.ts` (`x` = no hex),
`src/content/maps.ts`, `src/content/content.test.ts`, task 22's maps and
eval page for the style.
Depends on: 21 (and read 22 if it has landed).

## The work

- Draw `tripoint` in the map format, `x` outside the triangle,
  `seatSpawns: { 3: [0, 1, 2] }`, three HQs, 15 rounds. Pick the size so the
  centre of the triangle is a hex (a side of 3k + 1 hexes) and a rifleman
  reaches the centre in four to five rounds of plain moves.
- **Symmetry, exactly**: a test that the map is the same — terrain,
  elevation, every objective's area, kind and value, spawn hexes in
  placement order zone to zone — under a turn of 120° about its centre hex
  (axial about the centre, `(q, r) → (−q − r, q)`). Add `rotate(h, centre,
  turns)` to `src/shared/hex.ts` if useful, with tests.
- Edge lanes, centre spokes, a central objective (a hill), villages and depots
  placed by the same symmetry, water if it serves the map.
- `mapFor(3)` returns `tripoint`. `crossroads` drops its 2- and 3-player
  `seatSpawns` if 22 has given two players `ford`.
- The board must frame a triangle well (the camera clamps were made for
  rectangles: check the framing and the pan limits and fix them if the map
  is lost or cut).
- Line of sight is not exactly symmetric under a turn because `line` breaks
  ties with a fixed nudge (Open items). Measure how many hex pairs disagree
  under the 120° turn and report it; do not change `line`.

**Figures.** From 600 seeded three-player matches: mean supply and win share
per seat, units down, captures. The aim is a fair third each; state what it is.

## Out of scope
Changing `line`. New terrain or kinds. 2- and 4-player maps (22).

## Docs and checks
- `docs/tasks/00-plan.md`: Board, Open items (three-seat fairness re-measured);
  tick 23.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run bots -- --matches 200 --players 3` pass.

## Eval page — `eval/23-three-player-triangle.html`
- The real board on `tripoint`, lanes and areas labelled, with a button that
  turns the drawing a third of a turn to show it lands on itself.
- Screenshots (under `eval/assets/23/`) framed at 390 × 844, 844 × 390 and
  1280 × 800.
- The figures above and the sight disagreement count, dated.
- Anything that does not work, stated plainly.
