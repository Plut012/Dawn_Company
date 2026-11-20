# 21 — Objective kinds

## Overview
Ground matters for what it gives, as it did in real war. The owner of a
hill's flag sees further from it; the owner of a crossroads moves faster from
it; a depot supplies and rallies; a village earns. Each kind is data in
`OBJECTIVE_KINDS` (16 added it with zeros); this task gives the numbers and
makes the rules read them.

Read first: `docs/vision.md` (*The battlefield*); `docs/tasks/00-plan.md`
(*v2*: Objective kinds); `src/content/objectives.ts`, `src/rules/` (`sight.ts`
`sightOf`, `orders.ts` move limits and `orderOptions`, `resolve.ts` score
phase), `src/client/ui/screens/play.ts` (hex description).
Depends on: 18.

## The work

**Content**, verbatim (names and blurbs as you see fit, one line each):
| Kind | sight | move | supply | rally |
|---|---|---|---|---|
| hq | 0 | 0 | 0 | false |
| village | 0 | 0 | 1 | false |
| hill | 2 | 0 | 0 | false |
| crossroads | 0 | 1 | 0 | false |
| depot | 0 | 0 | 2 | true |

**Rules.** A unit **benefits** from an objective when it stands on a hex of its
area and its owner holds the flag.
- `sightOf` adds the benefiting objective's `sight`.
- Verbatim: `moveOf(state: GameState | PlayerView, unit: Unit): number` —
  `UNITS[type].move` plus the `move` of the objective the unit benefits from
  where it stands when the round begins (orders are judged from there; a dash
  is twice `moveOf`). `validateOrders`, `orderOptions`, `findPath` callers and
  the play screen's reach use it.
- Supply: a flag earns `value + kind.supply` in modes with supply (one `score`
  event with the total).
- Rally: at the end of the score phase, a pinned unit benefiting from a depot
  recovers even if it was pinned this round (a `recover` event as usual).
- Areas never overlap, so a unit benefits from at most one objective.

**Screens.** The hex description gives the kind and what it gives its owner,
from the data. A unit card shows a benefit it has ("Hill: sight +2").

**Manual.** Update or add lessons so each kind's gift is shown once: a hill
seeing over what flat ground cannot, a crossroads move, a depot rally.

**Tests and scripts.** One test per kind; `orderOptions` with a crossroads; a
unit leaving the area loses the gift next round. Re-pin the digests. Report
from seeded matches: how often each kind is held, and by whom at the end.

## Out of scope
New kinds. Map changes (22, 23). Giving kinds anything that is not a number
or flag in the table.

## Docs and checks
- Fold into the v1 sections (Rules, Content, Rules API); tick 21.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run bots -- --matches 200` pass.

## Eval page — `eval/21-objective-kinds.html`
- The real board with each kind on `crossroads` highlighted; for a chosen
  unit standing in each area, its reach and seen hexes drawn from the real
  code, owned and not.
- The new lessons running in the real manual player.
- The figures above, dated.
- Anything that does not work, stated plainly.
