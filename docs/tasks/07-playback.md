# 07 — Playback

## Overview
Make a resolved round watchable. `board.play(events)` takes one player's
event list and plays it on the board in order: shots, hits, movement step by
step, mortar impacts, scoring. This is where a player sees what their plan
did, so clarity matters more than spectacle.

Read first: `docs/design.md`, `docs/tasks/00-plan.md` (the `GameEvent` type,
Rules: the five phases, Board, Visual kit), then the code in
`src/client/render/` from task 06.
Depends on: 06. The event shapes are in `src/shared/types.ts`.

## The work

**Complete `Board.play(events: GameEvent[]): Promise<void>`** in
`src/client/render/` (a `playback.ts` beside the board is a good shape).
- Plays events in order and resolves when the last one finishes.
- Events sharing a moment play together: all `fire` events of the fire
  phase; all `move` events with the same `step`; the `hit` events that
  follow them.
- The board drives timing and unit state; the kit supplies the look. For
  each event the board calls `kit.effect(event, ctx)` if the kit has it and
  waits for it. With no `effect`, playback still works, with units simply
  jumping.
- The board itself applies lasting changes: a `move` leaves the unit on the
  new hex; a `hit` sets the unit's status; `spotted` adds a unit; `lost`
  removes one; `recover` and `treat` set status to ready.
- Fog does not change during playback. After `play` resolves, the caller
  calls `setView` with the new view, which must cause no visible jump when
  the events were complete.
- Whole-round length: aim for 6–12 seconds for a busy round; an empty round
  takes under 2. A `phase` event gives a short beat.
- A second call to `play` while one is running waits for the first.
- If the tab is hidden or an effect throws, playback skips ahead and still
  resolves; it must never hang.

**Add `effect` to the low-poly kit** (`kits/lowpoly/`):

| Event | Effect |
|---|---|
| `fire` | A quick tracer from `from` to `target`; with `blast` 1, a spray over the neighbours. If `from` is null, tracers arrive from off toward the target with no source shown. A small muzzle flash at the shooter. |
| `launch` | A puff at the mortar and a shell rising out of view. |
| `impact` | A shell falling in, a low burst over the hex and its neighbours, brief dust. |
| `hit` | `cover`: a small spark and no change. `pinned`: the rust burst from the style sheet and the unit drops. `down`: the unit falls and fades. |
| `move` | The unit travels to the next hex, climbing or dropping with elevation. Dashing reads faster. |
| `blocked` | A short recoil at the hex. |
| `spotted` / `lost` | The unit fades in or out. |
| `treat` / `recover` | The unit stands; a brief paper-coloured pulse. |
| `score` | The objective marker pulses amber; a small "+N" rises. |
| `eliminated`, `over`, `phase` | No in-world effect. |

Colours only from `docs/design.md`: amber for fire and scoring, rust for
harm, paper for recovery. Simple shapes; no textures or particle libraries.

## Out of scope
The report strip and any DOM text about events (task 09 reads the same
events). Sound. Changing the board API or event shapes.

## Eval page — `eval/07-playback.html`
Opened at `http://localhost:5173/eval/07-playback.html`. The real board,
kit and playback. Event lists come from the **real rules** when available
(`resolve` from `src/rules`, run in the page on scripted orders); if task 04
has not landed, from hand-written lists, and the page says which it is using.
- A set of named scenarios, each with a play button: a rifle duel in the
  open; machine-gun blast on a group; a mortar landing on units that stayed
  and missing one that moved; an ambush catching a dasher; a movement
  collision; a sniper against cover; a medic treating; a scoring round.
- A "view as" switch plays the same round as each player sees it, including
  a shot from an unseen shooter.
- A full busy round with a timer showing its length.
- A toggle to the crude second kit with no `effect`, showing playback still
  completes.
