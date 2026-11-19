# 11 — Field manual

## Overview
A tutorial that is also a mechanics browser. A list of short lessons, each
showing one rule of the game in a tiny staged situation, drawn by the real
board and resolved by the real rules. A player reads it while waiting in the
lobby; the designer flicks through it to check how each mechanic behaves.
Watch-only: the orders are preset, and the viewer plays or steps through them.

Read first: `docs/vision.md` (Pillars), `docs/design.md` (all; "Screens" is
the brief), `docs/tasks/00-plan.md` (Rules, Interfaces). Then the code:
`src/rules/index.ts`, `src/client/render/`, `src/client/ui/`, and
`eval/07-playback.html`, which already stages small scenarios through the
real `resolve` and is the model for how to do it.
Depends on: 01–09.

## The work

**Lessons are data** — `src/manual/lessons.ts` (and helpers beside it). No
three.js or DOM in this folder.

```ts
interface Lesson {
  id: string;                    // url-safe, e.g. "cover"
  group: 'Seeing' | 'Moving' | 'Shooting' | 'Units' | 'Timing' | 'Winning';
  title: string;                 // a few words
  text: string;                  // one or two sentences: the rule, plainly
  map: GameMap;                  // tiny, about 5 × 5 hexes, purpose-built
  units: { owner: PlayerId; type: UnitTypeId; at: string; status?: UnitStatus }[];  // `at` is a hex label
  rounds: Order[][][];           // one entry per round: orders indexed by player
  notes?: Partial<Record<Phase, string>>;   // a short line shown as that phase plays
  viewAs: PlayerId | 'umpire';   // default viewpoint; 'umpire' sees everything
  fogMatters: boolean;           // show the viewpoint switch
  expect: Expectation[];         // what must be true after the last round
}
type Expectation =
  | { unit: string; status: UnitStatus }          // unit named by "owner-index"
  | { unit: string; at: string }
  | { event: GameEvent['t']; count?: number }     // such an event occurred
  | { score: number[] }
  | { seenBy: PlayerId; unit: string; seen: boolean };

stageLesson(lesson: Lesson): GameState           // the starting state
runLesson(lesson: Lesson): { states: GameState[]; results: ReturnType<typeof resolve>[] }
checkLesson(lesson: Lesson): string[]            // failed expectations, empty = holds
```
- Tiny maps use the same hand-editable authoring format as
  `src/content/mapFormat.ts`. They are not added to `MAPS`.
- Adding a lesson must need only a new entry here.

**The sixteen lessons.** Each stages the smallest situation that shows its
claim, with as few units as possible. The `text` states the rule; the
`expect` list proves it.

| Group | id | Shows |
|---|---|---|
| Seeing | `sight` | Woods and hills block the line; from high ground you see over them. |
| Seeing | `stealth` | A unit in cover is unseen until an enemy is within 2 hexes. |
| Seeing | `reveal` | Firing from cover gives the shooter away until the next round ends. |
| Moving | `move-dash` | Move goes so far; dash goes twice as far. |
| Moving | `collide` | Two units stepping into one hex both stop; a unit cannot enter a held hex. |
| Shooting | `hit` | A hit pins. A hit on a pinned unit puts it down. Two shooters do it in one round. |
| Shooting | `cover` | A unit in cover ignores the first hit on it each round. |
| Shooting | `dash-risk` | A dashing unit has no cover and goes down to one hit. |
| Units | `gunner` | The machine gun hits the target hex and all six around it, friends included. |
| Units | `sniper` | The sniper outranges the rifle and its hit ignores cover. |
| Units | `mortar` | The mortar needs a friend who sees the target; the shell lands after movement, so a unit that moved away is missed. |
| Units | `medic` | The medic gets an adjacent pinned unit back up in time to act this round. |
| Timing | `ambush` | A unit on ambush fires at the first enemy to move into its sight and range. |
| Timing | `pinned` | A pinned unit sits out the next round, then recovers. (Two rounds.) |
| Timing | `phases` | One round with all five phases in order: treat, fire, movement, mortars, score. |
| Winning | `score` | A unit standing on an objective at the end of the round scores its value. |

**The screen** — `src/client/ui/screens/manual.ts`.
- Opens at `/?manual` and at `/?manual=<lesson id>`; needs no server and
  opens no socket. Also reached by a "Field manual" key in the lobby, with a
  key to go back. The current lesson is kept in the URL.
- Layout: the board has most of the room. Laptop: the lesson list (grouped)
  in a side panel. Phone (390 px): the list is a strip or drawer that does
  not cover the board while a lesson plays; previous / next keys step
  through lessons in order.
- For the chosen lesson: title and text; the board showing the starting
  state with the preset orders drawn as marks (`path`, `target`, `ambush`).
- Controls, all kit components:
  - **Play** — plays the whole lesson (every round) through `board.play`.
  - **Step** — plays one phase at a time (split the event list at `phase`
    events), showing that phase's name and note. At a round boundary the
    next round's orders are drawn before its first step.
  - **Restart** — back to the starting state.
  - **Viewpoint** (only when `fogMatters`): each side, and umpire.
- The viewpoint decides which view and which `playerEvents` are shown.
  Umpire shows every unit and the full event list with no fog.
- The camera frames the whole tiny map; no panning is needed.
- After the last step, a one-line outcome in plain words (from the state,
  e.g. "Pvt. Hale: pinned.").
- Only approved tokens and components. Text in the game's voice: dry, flat,
  factual (see the Realness dial).

**Tests** — `src/manual/lessons.test.ts`.
- Every lesson: its orders pass `validateOrders` for each round; `checkLesson`
  returns nothing; ids are unique; text is at most two sentences.
- Across all lessons: every order kind, every unit type, every hit result
  (`cover`, `pinned`, `down`) and every phase appears at least once.

## Out of scope
Hands-on tutorials where the learner gives orders. Changes to rules, numbers,
the board API or the server. New components. Sound.

If a lesson cannot be staged because the rules do not behave as its row says,
do not bend the rules or the lesson: report it.

## Eval page — `eval/11-field-manual.html`
Opened through Vite; no game server needed.
- The real manual embedded twice: laptop-shaped and phone-shaped (390 × 844).
- A table of all sixteen lessons with each one's `checkLesson` result,
  computed live in the page, and a link that opens that lesson.
- Real screenshots (under `eval/assets/11/`) of at least four lessons
  mid-playback and of the phone layout.
- Anything that does not work, stated plainly.
