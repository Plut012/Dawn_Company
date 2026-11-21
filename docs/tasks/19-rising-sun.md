# 19 — The rising sun

## Overview
*Dawn Company*: the match begins in half-light and the sun comes up. Every
unit's sight grows round by round, so the opening favours infiltration and
the end favours firepower, and nobody can hide forever. The board's light
follows the dawn.

Read first: `docs/vision.md` (pillar 2); `docs/tasks/00-plan.md` (Sight,
*v2*); `src/rules/sight.ts` and every use of `UNITS[...].sight` in `src/rules`,
`src/client`, `src/manual`, `scripts/`; `src/client/render/kit.ts` and the
lowpoly kit's `environment`; `docs/design.md` (palette, the dawn light).
Depends on: 16.

## The work

**Content**, verbatim: `SUN: number[] = [-3, -3, -2, -2, -1, -1, 0]` in
`src/content/rules.ts`, exported from `index.ts`. `SUN[i]` is the change to
every unit's sight in round `i + 1`; later rounds use the last entry.

**Rules**, verbatim:
```ts
sightOf(state: GameState, unit: Unit): number   // UNITS[type].sight + SUN[min(round, SUN.length) - 1], at least 1
// PlayerView gains:  sun: number;    // the change to sight in the round being planned
//                    dawn: number;   // 0 in round 1 .. 1 from round SUN.length on: (min(round, SUN.length) - 1) / (SUN.length - 1)
```
Every place the rules use a unit's sight uses `sightOf` with the round being
resolved (`state.round` inside `resolve`) or planned (`viewFor`): visible
hexes, `spots`, ambushes, the `own`/`squad` sight rules of actions and their
options. Action ranges do not change: a sniper still reaches 8, but fires
only at what someone sees. Task 21 will add the objective's `sight` inside
`sightOf`; leave room for it there and nowhere else. Anything in the client
or scripts that shows or works out sight (`orderOptions` callers, the hex
description, bots' sight checks) uses `sightOf` or the view's `sun`.

**Board.** The kit gains, verbatim:
```ts
light?(scene: THREE.Scene, dawn: number): void   // 0 = first light, 1 = full day
```
The lowpoly kit moves its sun low and warm with long shadows and a dimmer
ambient at 0 toward its present light at 1, within the design's palette (no
new colours; the present look is full day). The board calls it on every
`setView`, easing over about a second, and once at creation from the first
view. A kit without `light` is fine.

**Play screen.** The round readout shows the light ("First light · sight −3",
"Full day"). The hex and unit descriptions give sight with the sun.

**Manual.** A lesson, *Dawn*: the same watcher, the same man, round 1 unseen
at 5 hexes, round 7 seen.

**Tests and scripts.** `sightOf` for every round and its floor; visibility at
the edge of reduced sight; the view's `sun` and `dawn`. Re-pin the digests on
purpose. Report from seeded matches: units down per match and the round of
first contact, before and after.

## Out of scope
Weather (a map property, later). Objective sight (21). Night or dusk.
Changing action ranges.

## Docs and checks
- Fold into the v1 sections (Rules: Sight; Rules API; types; Kit); tick 19.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run bots -- --matches 200` pass.

## Eval page — `eval/19-rising-sun.html`
- The real board on `crossroads` with a slider from round 1 to round 8: the
  light changes and a chosen unit's seen hexes grow, both from the real code.
- The *Dawn* lesson running in the real manual player.
- The before and after figures from real runs, dated.
- Screenshots at dawn 0, 0.5 and 1 under `eval/assets/19/`.
- Anything that does not work, stated plainly.
