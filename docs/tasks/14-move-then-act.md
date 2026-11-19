# 14 — Move then act, and moving through your own squad

## Overview
Two rule changes from the first real play session, both aimed at making
attack and manoeuvre worth doing.

1. **Move then act.** A unit may walk and then fire (or use its special)
   from where it ends up, in one round.
2. **Friends do not block.** Units of one squad pass through each other, and
   a unit may be ordered onto a hex a teammate is standing on.

Read first: `docs/vision.md` (Pillars), `docs/tasks/00-plan.md` (Rules,
Interfaces), then all of `src/shared/`, `src/content/`, `src/rules/`, and how
`src/client/ui/` (play screen, `draft.ts`, `lines.ts`), `src/client/render/`
(playback, effects), `src/manual/`, `src/server/` and `scripts/` use them.
Depends on: 01–13.

## 1 — Move then act

**Order shape** (`src/shared/types.ts`):

```ts
export type FollowUp =
  | { kind: 'fire'; target: Hex }
  | { kind: 'special'; target: Hex };
export type Order =
  | { unit: UnitId; kind: 'move'; path: Hex[]; then?: FollowUp }
  | ...                                   // dash, fire, ambush, special: unchanged
export interface ActionDef { ...; mobile: boolean }   // may be used after a move
export type Phase = 'treat' | 'fire' | 'move' | 'assault' | 'mortar' | 'score';
```

- Only `move` takes a follow-up. `dash` never does: that is its price.
  `ambush` is not a follow-up: an ambush needs the whole round still.
- A follow-up is legal to order when the unit has that order kind in
  `orders`, its action for that kind is `mobile`, and the target hex is
  within the action's `range` / `minRange` **of the last hex of the path**.
  Sight and `needs` are not checked when ordering: nobody knows what will
  be there.
- Data: `mobile` is true for the rifle and the medic's aid, false for the
  machine-gun burst, the sniper shot and the mortar round (heavy weapons
  fire from where they are set up). This is a tuning lever, not a rule.

**Resolution.** A new phase, `assault`, between movement and the mortars:
0. treat · 1. fire · 2. movement · **3. assault** · 4. mortars land · 5. score.

- In the assault phase every follow-up is worked out from the positions as
  movement left them, all together, then all effects land (the same
  simultaneity as the fire phase; a unit hit in this phase still acts).
- A follow-up runs only if, at that moment: the unit is `ready`; the target
  is within range of the hex the unit actually stands on (it may have been
  stopped short); the action's `sight` rule holds from there; and the
  action's `needs` holds. Otherwise nothing happens and an event says so.
- A follow-up with a `mortar`-phase action would launch here and land in
  the mortar phase. (No shipped action does; cover it in the proof test.)
- A follow-up with a `treat`-phase action takes effect here.
- Everything else is the existing rule: the hit rule, cover ignoring the
  first hit of the **round** (not of the phase), a dashing unit going down
  to one hit, `reveals`, area effects.
- The mover's posture is `moved`; firing gives it away as any shot does.
- Events: a `phase` event for `assault`; the existing action events
  (`fire`, `launch`, `treat`…) carry the follow-up as they carry any
  action; one new event for a follow-up that did not happen, with a reason
  the report line can state plainly ("no line", "out of range", "pinned",
  "nothing to treat"). `playerEvents` filters them by the usual rule.
- `validateOrders`, `orderOptions`, `resolve`, `playerEvents` stay free of
  unit ids, action ids and effect-specific branches.

## 2 — Friends do not block

- A moving unit may step into and through a hex holding a unit of its own
  squad. Friendly units may swap hexes.
- **No unit ever rests in a hex with another unit.** When movement is over
  there is at most one living unit per hex, as now. Fire, blasts, scoring
  and the board keep relying on that.
- A path may end on a hex a teammate stands on. If the teammate has left by
  the time the mover gets there, the mover takes the hex. If not, the mover
  stops on the last free hex of its own path (possibly where it started).
- A unit stopped mid-path while sharing a hex (hit by an ambush, blocked by
  an enemy) likewise falls back along its own path to the last free hex.
- Settling must be deterministic and must always end: a unit that never
  moved is never displaced; where two units contest a hex the one that has
  been there longest keeps it; two teammates arriving at one hex in the
  same step both stop one hex short, as two units do today. Design the
  algorithm, state it in a comment, and property-test the invariants: one
  unit per hex after movement; no unit beyond the end of its path or off
  it; no unit that held still has moved.
- Enemies block exactly as before: all three existing conflict rules stand
  between units of different squads.
- While two teammates share a hex mid-movement, an ambush blast that covers
  the hex hits both.

## The client

- **Play screen.** With a unit selected and Move active, tapping a hex that
  holds a teammate extends or ends the path there; it does not select the
  teammate. (Tapping a teammate with no path being drawn still selects it.)
- After a move path is set, the Fire and special chits of a unit whose
  action is `mobile` stay available: one tap on the chit, one tap on a
  target, and the order becomes move-then-act. Target marks are worked out
  from the end of the path. The unit card names both parts
  ("MOVE · FIRE"). Clearing the move clears the follow-up. No new
  components; landscape and portrait both stay within the task 13 layout.
- Marks: the path mark and the target mark together, the target drawn from
  the path's end.
- Playback and report lines handle the `assault` phase and the
  did-not-happen event. The kit needs no new effect.
- **Field manual.** Fix every lesson the changes make untrue (`collide`,
  `phases`, any that say a unit cannot enter a held hex). Add two lessons:
  `move-fire` (group Shooting: a rifleman walks out of the woods and pins a
  man it could not reach before) and `pass` (group Moving: one unit walks
  through a teammate; another, ordered onto a teammate who stays, stops
  short).
- `scripts/bots.ts`: bots use move-then-act and friendly pass-through some
  of the time, so the 300-match run exercises both.

## Docs and checks

- Update `docs/tasks/00-plan.md`: Orders, the phase list, Movement
  conflicts, the shared types block; add and tick this task.
- Update every consumer and every test. `npm test`, `npm run typecheck`,
  `npm run build`, `npm run bots -- --matches 300` must pass. Fog and
  one-unit-per-hex property checks are extended, not loosened.
- The stage-A digest test from task 12 will change, because the rules
  change. Regenerate it, and say so.
- Report, from the same seeded scripted matches before and after: units
  down per match, ambushes sprung, score per match, and how often a
  follow-up ran versus did not.

## Out of scope
Map, budget, round count, the turn clock, protocol messages (task 15).
Tuning ranges or costs. Ambush after a move. Two units resting in one hex.
Restyling.

## Eval page — `eval/14-move-then-act.html`
Opened through Vite; no game server needed.
- A live sandbox on a small map, resolved by the real `resolve`, with
  buttons that stage: move-then-fire that lands; one that does not (stopped
  short, out of range); walking through a teammate; ordered onto a teammate
  who stays; ordered onto a teammate who leaves; a friendly swap; an enemy
  still blocking. Each shows the events and the board before and after.
- The real play screen embedded (phone portrait, phone landscape, laptop)
  against a scripted feed, where move-then-act can be ordered by hand.
- The before/after figures, from real runs, with the date.
- Links to the new and changed manual lessons.
- Anything that does not work, stated plainly.
