# 16 — Objective areas, flags and HQs

## Overview
Holding ground stops meaning "a unit stands on one hex". An objective becomes
an **area** with a **kind**; whoever is the only side with a ready unit in it at
the end of a round raises their **flag**, and the flag stays after they leave
until someone else captures it. Each start zone gets an **HQ**, an objective
like any other, which its seat owns from the start. Flags earn their
objective's value every round. This is the foundation of the v2 battlefield
(`docs/vision.md`, *The battlefield*).

Read first: `docs/vision.md`; `docs/tasks/00-plan.md` (Rules, Interfaces, and
the whole *v2* section); then `src/shared/types.ts`, `src/content/mapFormat.ts`,
`src/content/maps.ts`, `src/rules/` (`match.ts`, `resolve.ts` phase 4/score,
`sight.ts` `viewFor`), `src/manual/lesson.ts`, `src/client/render/` (kit and
board objectives), `src/client/ui/screens/play.ts`, `scripts/`.
Depends on: 01–15.

## The work

**Types and content.** Add to `src/shared/types.ts`, verbatim:
```ts
export type ObjectiveKindId = string;           // key into OBJECTIVE_KINDS
export interface Objective {                    // replaces { id; hex; value }
  id: string;                                   // 'A'..'Z'
  kind: ObjectiveKindId;
  hexes: Hex[];                                 // the area, at least one hex, in drawing order (row, then column)
  value: number;                                // supply per round to the flag's owner
  zone: number | null;                          // an HQ: the index into `spawns` of its start zone; else null
}
export interface ObjectiveKindDef {
  id: ObjectiveKindId; name: string; blurb: string;
  sight: number; move: number; supply: number; rally: boolean;
}
// GameState gains:  flags: Record<string, PlayerId | null>;   // objective id -> owner
// PlayerView gains: flags: Record<string, PlayerId | null>;
// GameEvent gains:  | { t: 'capture'; objective: string; player: PlayerId; from: PlayerId | null }
// `score.objective` becomes `string` (never null): flags are public.
```
`src/content/objectives.ts` exports `OBJECTIVE_KINDS` (from `index.ts`) with
`hq`, `village`, `hill`, `crossroads`, `depot`: names and blurbs as in the vision,
every number 0 and `rally` false. Task 21 fills in what each gives; nothing in
the rules reads those fields yet.

**Map drawing** (`src/content/mapFormat.ts`). `readMap` takes
`{ id, name, terrain, elevation, marks, objectives, maxRounds, seatSpawns }`,
`objectives: Record<string, { kind: ObjectiveKindId; value: number }>` replacing
`objectiveValues`.
- `x` in `terrain` is a hex that is not on the board: no cell. The other layers
  must have `.` or `x` there.
- In `marks`, a letter repeated on several hexes is one objective's area (it
  need not be connected, but say so in an error if it is not — areas must be
  connected). An objective of kind `hq` is an HQ.
- A digit 1–8 is a spawn hex of the zone whose HQ area is nearest (distance to
  its nearest hex); a tie is an error. Zones are numbered by their HQs in
  letter order; each HQ's `zone` is that number. Every zone still has spawn
  hexes 1–8; a zone with no HQ is an error.
- Unknown kinds, a kind without a drawn letter or a letter without an entry are
  errors, as now.
The manual's `tinyMap` (`src/manual/lesson.ts`) reads the same marks: letters
for areas (with `objectives` in place of `objectiveValues`), no spawns.

**Crossroads** is converted, same layout and size. Each 1-, 2- and 3-point
objective becomes a small area around where it is now (keep the centre's 3 on
the hilltop; a hamlet's area takes in its buildings; one to three hexes each).
Kinds: centre `hill`, the four 2s `village`, the four 1s `depot`. Four HQs of
value 1, one by each start zone, drawn so that letter order gives zones in the
old order (0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left) and
`seatSpawns` is unchanged. The map stays symmetric as the tests require; extend
the symmetry and fairness tests to areas and HQs.

**Rules.**
- `createMatch` sets `flags`: each HQ belongs to the seat that uses its zone
  (`seatSpawns[n]`), unused HQs and other objectives to nobody.
- The score phase, in order: **capture** (for each objective in id order, the
  players with a *ready* unit standing on any hex of its area: exactly one →
  the flag is theirs, a `capture` event, told to everyone, if it changed;
  otherwise unchanged), then **supply** (each flag's owner scores `value`, a
  `score` event per objective, told to everyone), then recover, eliminate and
  end as before. A flag whose owner has been eliminated goes to nobody, with
  no event, when the elimination happens. The old rule (a unit on the hex
  scores) is gone.
- `viewFor` copies `flags`. Nothing about flags is hidden.
- Anything that used `objective.hex` uses the area now (sight, the hide
  rule's "no exception for objectives", lessons, scripts).

**Board and play screen.** The kit's `objective(obj, owner)` draws the area —
an amber wash over each hex as now — and a flag in the owner's player colour
(the player mark's colour and shape on the flag; a plain bone flag for
nobody). An HQ's flag is taller. The board redraws an objective's flag when a
view arrives and during playback on a `capture` event (`effect` for `capture`:
the flag changes colour). The play screen's score line and log strip say
captures in words ("Bo took the village C"). The hex description names the
objective's kind and owner.

**Manual.** Update the score lesson (an area, a flag, held after leaving) and
any lesson that drew an objective. Add one lesson, *Flags*: a unit enters an
area, captures it, leaves, and the flag stays; a contested area stays as it
was.

**Scripts.** `scripts/seeded.ts` and `scripts/bots.ts` follow the new shapes
(bots move toward areas; the bots' event checks know `capture`). Re-pin the
seeded digests on purpose, with a line of history in `digest.test.ts`.

## Out of scope
Modes, map selection (17). Returns, buy-back (18). What a kind gives (21). New
maps (22, 23). Restyling: use the existing tokens and kit style.

## Docs and checks
- Fold the v2 parts this task built into the v1 sections of
  `docs/tasks/00-plan.md` (types block, Rules: board and score phase, Content,
  Kit); tick 16.
- `npm test`, `npm run typecheck`, `npm run build`,
  `npm run bots -- --matches 200` pass.

## Eval page — `eval/16-objective-areas-flags-hq.html`
Real modules through Vite, no mock-ups.
- Crossroads drawn by the real board with every area, its kind and value,
  and the four HQs with their owners' flags.
- A scripted two-round match (real `resolve`) on the real map where a unit
  captures a village, leaves, and the flag stays; then two sides stand in one
  area and it stays unchanged. Show the events and the flags after each round.
- The *Flags* lesson running in the real manual player.
- `readMap` errors for a bad drawing (unknown kind, a split area, a spawn hex
  equally near two HQs), shown live.
- Anything that does not work, stated plainly.
