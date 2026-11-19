# 03 — Sight

## Overview
Who can see what. This is the fog of war, and it lives in one place: every
other part of the game asks these functions and never works out visibility
itself. The server uses `viewFor` to decide what each player is sent, so a
mistake here leaks hidden information.

Read first: `docs/tasks/00-plan.md` (Rules: Sight; Interfaces).
Depends on: 01 (types, hex maths), 02 (`TERRAIN`, `UNITS`, `RULES`, the map).

## The work

Create `src/rules/sight.ts` and export from `src/rules/index.ts`:

```ts
canSee(map: GameMap, from: Hex, to: Hex): boolean         // line only, no range; symmetric
visibleHexes(state: GameState, player: PlayerId): Set<HexKey>
visibleEnemies(state: GameState, player: PlayerId): Unit[]
viewFor(state: GameState, player: PlayerId): PlayerView
```
Pure functions: no DOM, Node APIs, clock or randomness. Types are in
`src/shared/types.ts`.

**`canSee` — the line rule**
- Take `line(from, to)` from `hex.ts`. The two end hexes never block.
- The eye and the target are each at their hex's elevation. The sight line's
  height at the i-th of n steps is the straight interpolation between them.
- A hex in between has height = its elevation, plus 1 if its terrain has
  `blocksSight`.
- The line is blocked if any in-between hex's height is **strictly greater**
  than the line's height at that hex.
- A hex off the map blocks. `canSee(a, a)` is true.
- Results: woods between two units on flat ground block; a hill between
  them blocks; a unit on a level-2 hill sees over woods on level 0 to ground
  far enough beyond.

**`visibleHexes`** — union over the player's living units (ready or pinned):
every hex within that unit's `sight` distance that it `canSee`. A unit always
sees its own hex. An eliminated player sees every hex.

**`visibleEnemies`** — an enemy unit that is not down is visible if some
living friendly unit F has it within F's `sight`, `canSee`s its hex, and one
of these holds:
- the enemy's hex is not cover terrain, or
- the enemy is `revealed`, or
- the enemy is within `RULES.stealthRange` of F.

An eliminated player sees every living unit.

**`viewFor`** — builds the `PlayerView`: the player's own units in every
status, plus `visibleEnemies`; `visible` from `visibleHexes`; map, round,
`maxRounds` (from the map), scores, eliminated, over and winners copied
across. It must contain nothing about enemy units that are not visible.
Down enemy units are never included.

**Tests** (hand-built small maps, not only the real one): each line-rule
result above; symmetry of `canSee` over many random pairs on the real map;
range limits; the three stealth cases; a pinned unit still sees; a down unit
does not; `viewFor` leaks no hidden unit (compare against the full state);
the eliminated-player case.

## Out of scope
Orders, hits, movement, scoring (task 04). Filtering of events (task 04,
which calls these functions).

## Eval page — `eval/03-sight.html`
Opened at `http://localhost:5173/eval/03-sight.html`. A flat 2D drawing of
the real `crossroads` map running the real functions:
- Drag a friendly unit anywhere; visible hexes stay bright, the rest are
  veiled, updating live.
- Choose the unit's type (sight range changes).
- A few enemy units that can also be dragged, with a toggle for `revealed`;
  each is drawn only when `visibleEnemies` returns it, with a ghost outline
  when hidden so the rule can be checked.
- Hover any hex to draw the sight line to it, marking the hex that blocks.
- A side-by-side "what player 2 is sent" panel showing the unit list from
  `viewFor`.
