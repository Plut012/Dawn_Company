# 25 — Engineer and works

## Overview
The engineer joins the roster. Its one special is **build**: sandbags, wire or
an MG nest on its own hex or a neighbour, paid for with supply. A work is
terrain: it changes the hex for everyone for the rest of the match, so a
position you fortify can be taken and used against you. Supply Line only (the
engineer is not in Last Stand's unit list).

Read first: `docs/vision.md` (*The battlefield*, units); `docs/tasks/00-plan.md`
(Actions, *v2*: Works, the score phase, Interfaces); `src/content/` (units,
actions, terrain, modes), `src/rules/` (`effects.ts`, `orders.ts`,
`resolve.ts`), `src/client/render/` (board tiles), `src/client/ui/screens/play.ts`
and `draft.ts` (the order flow), `src/manual/`.
Depends on: 18, 24.

## The work

**Types**, verbatim:
```ts
export type WorkId = string;                    // key into WORKS
export interface WorkDef { id: WorkId; name: string; blurb: string; cost: number; terrain: TerrainId }
// Effect gains:          | { kind: 'build' }      // the work comes from the order
// ActionDef.phase gains: 'build'                 // lands in the score phase, before captures
// The `special` order and the `special` FollowUp gain:  work?: WorkId
// GameState gains:  works: Record<HexKey, WorkId>      PlayerView gains: works
// GameEvent gains:  | { t: 'build'; unit: UnitId; at: Hex; work: WorkId }   // owner, and whoever sees `at`
// `unable.reason` gains 'supply' | 'blocked'
```

**Content.**
- `TERRAIN` gains `sandbags` (cover, no hide, does not block sight,
  passable), `wire` (no cover, no hide, does not block sight, not passable),
  `nest` (cover, hide `{ still: 1, moved: null }`, does not block sight,
  passable).
- `WORKS`: `sandbags` cost 2, `wire` cost 2, `nest` cost 4, each with its
  terrain.
- `ACTIONS.build`: phase `build`, range 1, minRange 0, sight `none`, needs
  `any`, affects `friends` (no one is affected; the effect acts on the hex),
  blast 0, effects `[{ kind: 'build' }]`, reveals false, mobile true.
- `UNITS.engineer`: Spr. rank, cost 3, max 2, move 2, sight 6, spotting 0,
  orders move, dash, special; fire null; special `build`. Not added to Last
  Stand's `units`. A preset may include one.

**Rules.**
- A `special` order or follow-up whose action has a `build` effect must name
  a `work`; the target hex must be on the map, passable, not water, not in an
  objective area, without a work; for `wire`, nobody may stand there.
  `validateOrders` judges what it can at planning; the rest is judged when it
  lands.
- In the score phase, first, in unit id order: each ready engineer with a
  build order builds if the hex is still allowed and its owner's supply
  covers the cost: the cost leaves `scores`, `works[key] = work`, and the
  hex's terrain in `state.map.cells` becomes the work's terrain (the state's
  map is a per-match copy: never change `MAPS`). A `build` event. Otherwise an
  `unable` event with `supply`, `blocked` or the usual reasons.
- Everything that reads terrain (sight, hiding, cover, movement) sees the
  work with no further change, because it reads `state.map`. `viewFor` copies
  `works` and the changed cells.

**Board.** The board asks the kit for a new tile when a view's cell differs
from what it drew, and on a `build` event during playback. The lowpoly kit
draws `sandbags` like the wall tile, `wire` as ink crosses on posts, `nest` as
a ring of sandbags with a low roof line — existing palette only.

**Play screen.** Ordering a build: choose the target hex as for any special,
then one of the works with its cost (greyed when supply is short counting the
draft's purchases and other builds). The order chit names the work.

**Manual.** A lesson, *Works*: an engineer puts sandbags in front of a
rifleman, and the next round's shot is taken by the cover. The lesson tests'
"every unit" check now includes the engineer.

**Tests and scripts.** Each work's effect on sight, cover and movement; a
build refused for each reason; the cost; the map copy left untouched in
`MAPS`. Bots and seeded matches build sometimes. Re-pin the digests. Report
from seeded matches: works built per match, by kind.

## Out of scope
Destroying works. Forward posts. Works in Last Stand. Restyling.

## Docs and checks
- Fold into the v1 sections (types, Rules: Actions and score phase, Content,
  Kit); tick 25.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run bots -- --matches 300` pass.

## Eval page — `eval/25-engineer-and-works.html`
Needs the game server on a spare port (say how).
- A real client orders an engineer to build each work in turn; the board
  shows the new tiles and supply drops.
- The *Works* lesson running in the real manual player.
- The figures above, dated.
- Anything that does not work, stated plainly.
