# 22 — Two-player map and four-player refit

## Overview
One map per player count, read like a MOBA map: bases, lanes, cover between
them, a river with crossings, a contested centre. This task draws **`ford`**,
made for two, and refits **`crossroads`** to be the four-player map. The
three-player triangle is 23.

Read first: `docs/vision.md` (*The battlefield*, *The match*: maps);
`docs/tasks/00-plan.md` (Board, *v2*: Map drawing, Objective kinds, Open items
on seat fairness); `src/content/maps.ts`, `src/content/mapFormat.ts`,
`src/content/terrain.ts`, `src/content/content.test.ts` (the map tests),
`scripts/seeded.ts`.
Depends on: 21.

## The work

**`ford`, for two** (`seatSpawns: { 2: [0, 1] }`, two HQs, 15 rounds; size
your call, about 13 × 15 or so, portrait or landscape — the board frames
either):
- The League shape: HQs in opposite corners, three lanes between them (two
  along the edges, one through the middle), a river of `water` across the
  other diagonal with **fords** (open or crops hexes through it) where the
  lanes cross it and nowhere else.
- Woods and crops between the lanes; a village on each side of the river on
  each edge lane; a depot each side; the centre a hill where the middle lane
  meets the river.
- Half-turn symmetric (the tests already do this for every map: extend them
  to `ford`); every passable hex reachable; each HQ the same number of steps
  from every objective as its twin is from the other HQ.

**`crossroads`, for four** (`seatSpawns: { 4: [0, 1, 2, 3] }` plus the 2 and 3
entries until 23 lands; same size):
- Low walls ring the hamlets (the villages) as a perimeter with gaps, instead
  of standing at the feet of the hill, so a village reads as a fort: buildings
  with cover, hiding and a flag, behind a wall line.
- The two decorative ponds become a stream of `water` across the map with
  fords, so water shapes the approaches.
- Keep its mirror symmetries and what the tests pin, updated for the new
  drawing.

**Both.** Every objective's area and kind deliberate: say in the map's comment
what each lane is for and which playstyles (assault, infiltration, fortress,
fire support, control — `docs/vision.md`) each part of the map favours.
`mapFor(2)` returns `ford` now.

**Carried over from 21 (measured there, 2026-11-19).**
- No map has a `crossroads`-kind objective yet: each map gets at least one
  (where lanes meet).
- The hill on `crossroads` gains almost nothing (40 hexes seen with the flag
  against 38), because woods surround it: give each map's hill real sight
  lines to make holding it worth it.
- Income rose with the kinds (about 6.7 / 5.6 / 4.8 supply per seat per round
  for 2 / 3 / 4 players), so a rifleman's buy-back is now only 1.2–1.7 rounds
  of income. On the new maps, measure again and set `returns.buyBack` (in
  `MODES`; update the plan's *v2* text) so it is two to three rounds again.
- The two-player seat gap on `crossroads` grew to ±13 points (about 15% of
  the mean): `ford` must do better; state its gap.

**Figures.** From 300+ seeded matches on each map (`scripts/seeded.ts`, its
player count): seat fairness (mean supply per seat, win share), units down,
captures per match, and the number of steps from each HQ to every objective.
State any asymmetry.

## Out of scope
The triangle (23). New terrain or kinds. Weather. Restyling tiles.

## Docs and checks
- `docs/tasks/00-plan.md`: Board (maps), Content, Open items (seat fairness,
  re-measured); tick 22.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run bots -- --matches 200 --players 2` and `--players 4` pass.

## Eval page — `eval/22-two-player-map-and-four-player-refit.html`
- Both maps drawn by the real board, with lanes, fords, areas, kinds and HQs
  labelled, and the step table from each HQ.
- Screenshots (under `eval/assets/22/`) of each map framed at 390 × 844,
  844 × 390 and 1280 × 800.
- The figures above, dated.
- Anything that does not work, stated plainly.
