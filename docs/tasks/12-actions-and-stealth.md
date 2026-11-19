# 12 — Actions as data, and stronger stealth

## Overview
Two changes to the rules, done in two stages.

**Stage A — behaviour becomes data.** Today a unit's numbers are data but its
behaviours are code: the medic's treat is hard-wired in three places, and
direct fire, the mortar and the sniper are flags the engine special-cases.
After this stage every action a unit can take is an entry in `src/content`,
built from a small fixed vocabulary, and the rules engine knows only the
vocabulary, never a unit or an ability by name. This is the project's
philosophy applied to the rules: simple, robust, modular, moddable.

**Stage B — stealth gets stronger and becomes data too.** How hard a unit is
to see depends on the terrain it is in and on what it did, so that lying in
ambush in a wood, or creeping along cover, is a real way to play.

Read first: `docs/vision.md` (Pillars), `docs/tasks/00-plan.md` (Rules,
Interfaces), then all of `src/shared/`, `src/content/`, `src/rules/`, and how
`src/client/ui/` (play screen, `lines.ts`, `draft.ts`), `src/client/render/`
(effects), `src/manual/`, `src/server/` and `scripts/bots.ts` use them.
Depends on: 01–11.

## Stage A — actions as data

**The vocabulary** (`src/shared/types.ts`; adjust names only if the code
gives a strong reason, and say so):

```ts
export type ActionId = string;                 // key into ACTIONS
export type Effect =
  | { kind: 'hit'; ignoresCover?: boolean }    // the existing hit rule
  | { kind: 'recover' }                        // a pinned unit becomes ready
  | { kind: 'reveal' };                        // units there count as having fired
export interface ActionDef {
  id: ActionId; name: string; blurb: string;
  icon: string;                                // UI and kit look-up key
  phase: 'treat' | 'fire' | 'mortar';          // when its effects land
  range: number; minRange: number;
  sight: 'own' | 'squad' | 'none';             // own line to the target hex; any friendly unit sees the hex; no need
  needs: 'any' | 'friend' | 'pinned-friend';   // what must stand on the target hex for the order to be legal
  affects: 'all' | 'friends' | 'enemies';      // who in the area the effects apply to (never the user itself)
  blast: number;                               // 0 = the hex, 1 = plus its neighbours
  effects: Effect[];
  reveals: boolean;                            // using it gives the user away
}
export interface UnitDef {
  // id, name, rank, blurb, cost, max, move, sight, orders: unchanged
  fire: ActionId | null;        // what the `fire` order (and its ambush shot) does
  special: ActionId | null;     // what the `special` order does
  spotting: number;             // stage B
  // removed: range, minRange, blast, ignoresCover, indirect, special: 'treat'
}
```
- `src/content` gains `ACTIONS: Record<ActionId, ActionDef>` with five
  entries reproducing today's behaviour exactly: rifle, machine-gun burst,
  sniper shot, mortar round (phase `mortar`, sight `squad`), treat (phase
  `treat`, range 1, needs `pinned-friend`... see the note on legality below).
- The `Order` type does not change: `fire` uses the unit's `fire` action,
  `special` its `special` action, `ambush` its `fire` action against a mover.
  A unit may ambush only if it has `ambush` in `orders` and a `fire` action
  in phase `fire`.
- An action in phase `mortar` is announced in the fire phase (the existing
  `launch` event) and lands in the mortar phase, as now.
- Effects are implemented once, in one table in `src/rules`
  (`kind` → function). Adding a new kind of effect later means one new
  function there and one new variant in the `Effect` type; nothing else.
- Events: keep the existing event types so playback, report lines and the
  manual keep working, and add the action id to the events that announce an
  action (`fire`, `launch`, `impact`, `treat`), so the UI and kit can look
  things up by action. If `treat` cannot honestly carry a general
  treat-phase action, replace it with a general event and update every
  consumer; say what you chose.
- Legality note: today treat may target any adjacent friendly unit that is
  not down, and only has an effect on a pinned one. Keep behaviour identical
  unless the vocabulary makes that impossible; if so, choose the reading
  closest to today's and report it.
- `validateOrders`, `orderOptions`, `resolve` and `playerEvents` contain no
  unit id, action id or effect-specific branch outside the effects table.
  Grep for the five unit ids and action ids in `src/rules` (tests aside):
  there must be none.
- The client: chits take their label and icon from the action; report lines
  name the action; the kit picks its effect by the action's `icon` with a
  plain fallback for an unknown one. The squad builder shows a unit's
  actions from data.

**Proof.** In tests only, define two extra actions and a unit that has them,
without touching `src/rules`:
- a "flare": phase `treat`, range 4, sight `none`, blast 1, effect `reveal`;
- a "shock round": phase `mortar`, sight `own`, blast 0, two `hit` effects.
Play them through `resolve` and assert they work, and that the client's
pure helpers (`orderOptions`, report lines) handle them.

**Stage A must not change how the game plays.** Before starting, record the
final state hash of a fixed set of seeded matches (a small script or test
that plays, say, 50 seeded matches with scripted orders and prints a digest).
After stage A the digests must be identical. Keep this check as a test.

## Stage B — stealth

**Rule.** Whether an enemy can see a unit depends on where it stands and
what it last did:

| The unit, in the last resolved round | In hiding terrain | In the open |
|---|---|---|
| stayed still (held, ambushed, was pinned, used a non-revealing action) | seen from `hide.still` hexes or closer | seen |
| moved, but did not dash | seen from `hide.moved` hexes or closer | seen |
| dashed | seen | seen |
| used a revealing action (fired) | seen, until the next round begins to resolve | seen |

- Data: `TerrainDef` gains `hide: { still: number; moved: number } | null`.
  Woods and buildings: `{ still: 1, moved: 2 }`. Open: `null`. `cover`
  (ignoring the first hit) stays a separate property.
- A spotter's `spotting` (on `UnitDef`, 0 for all five units for now) is
  added to those distances for that spotter.
- `RULES.stealthRange` is removed.
- State: `Unit` gains `posture: 'still' | 'moved' | 'dashed'`. A match starts
  with everyone `still`. During a round: a unit with a dash order that is
  ready at the fire phase is `dashed` from then; a unit becomes `moved` when
  it takes its first step; everyone else becomes `still` at the start of
  the round. So visibility inside a round (ambush triggers, `playerEvents`)
  uses the posture as it stands at that moment.
- Everything else about sight is unchanged: range, line of sight, squad
  sharing, `revealed`, the eliminated player's full view.
- An ambusher still needs to see its target itself, by this rule. A unit
  creeping through woods is therefore not shot by an ambusher 3 hexes away.
- **No objective exception.** A unit standing on an objective is hidden or
  seen by the same rule as anywhere else.
- **Scoring must not give a hidden holder away.** Scores stay public, but a
  `score` event sent to another player names the objective only if that
  player can see the unit holding it; otherwise `objective` is null and the
  UI says only that the player scored. (`objective: string | null` in the
  event type.) The report line and the kit effect handle null.

**Field manual.** Lessons must stay truthful: fix `stealth` and `reveal` for
the new rule and add one lesson, `creep` (group Seeing): a unit moving
through woods stays unseen at 3 hexes while one dashing the same route is
seen. Lesson text takes its numbers from content.

**Play screen.** Each of the player's own unit cards shows in a word whether
the unit is currently hidden, creeping or exposed (from terrain, posture and
`revealed`), using existing card text styles; no new component.

## Both stages

- Update `docs/tasks/00-plan.md`: the "Rules (v1)" Sight paragraph, the
  shared types block, the Content exports, and tick this task. Keep the
  rest as it is.
- Update every consumer and every test. `npm test`, `npm run typecheck`,
  `npm run build` and `npm run bots -- --matches 300` must pass. The fog
  checks in the property test and the bots must be updated to the new rule,
  not loosened.
- Add the missing boundary tests: a unit seen at exactly the hide distance
  and unseen one hex further, with a clear line of sight, for `still` and
  for `moved`.
- Report, from a fixed set of seeded bot or scripted matches run before and
  after stage B: units down per match, ambushes sprung per match, and score
  per match. This is for the designer's tuning, not a pass/fail.

## Out of scope
New units, off-map assets, player-level orders, terrain-changing effects
(design so they could be added; do not build them). Tuning costs, ranges or
objective values. Map changes. Visual restyling.

## Eval page — `eval/12-actions-and-stealth.html`
Opened through Vite; no game server needed.
- **Actions:** a table generated from `ACTIONS` and `UNITS`, and a small
  live sandbox on a tiny map where the page defines an extra action in its
  own script (not in `src/`), gives it to a unit, and resolves a round with
  the real `resolve`, showing the events.
- **Stealth:** a flat or 3D map with one watcher and one hider that can be
  dragged; controls for the hider's posture and `revealed`; the hider is
  drawn solid when `visibleEnemies` returns it and as a ghost when not, with
  the reason in words.
- The before/after digest result for stage A and the before/after figures
  for stage B, from real runs, with the date.
- Links to the three manual lessons.
