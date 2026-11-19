# 04 — Resolution

## Overview
The game itself: start a match, check a player's orders, and resolve a round
of everyone's orders at once into a new state and a list of events. Pure and
deterministic, so a whole match can be replayed from its orders.

Read first: `docs/vision.md` (Pillars), `docs/tasks/00-plan.md` (Rules,
Interfaces).
Depends on: 01, 02, 03 (`canSee`, `visibleHexes`, `visibleEnemies`, `viewFor`).

## The work

Add to `src/rules/` and export from `src/rules/index.ts`:

```ts
createMatch(map: GameMap, squads: Squad[]): GameState
validateOrders(state: GameState, player: PlayerId, orders: Order[]): OrderError[]   // empty = legal
resolve(state: GameState, orders: Order[][]): {           // orders indexed by player
  state: GameState;
  events: GameEvent[];            // everything, for logs and tests
  playerEvents: GameEvent[][];    // what each player may see, indexed by player
}
orderOptions(view: PlayerView, unit: UnitId): {
  kinds: OrderKind[];
  move: HexKey[]; dash: HexKey[];   // reachable end hexes
  fire: HexKey[]; special: HexKey[];
}
findPath(map: GameMap, from: Hex, to: Hex, maxSteps: number): Hex[] | null   // excludes `from`
```
No DOM, Node APIs, clock or randomness. Never mutate inputs. Wherever order
matters, sort by unit id so results are identical everywhere.

**`createMatch`** — seat `i` uses spawn zone `map.seatSpawns[n][i]`; its
units go on that zone's hexes in squad order. Unit id is `${owner}-${index}`.
Name is the unit type's `rank` plus a surname from `NAMES`, picked by a fixed
formula so no two units share one. Round 1, scores 0, everyone ready.

**`validateOrders`** — at most one order per unit; the unit is the player's
and not down; the kind is in its type's `orders`. Pinned units may be given
orders.
- move / dash: path length 1 to `move` (dash: 2 × `move`); each hex is on the
  map, passable, and next to the one before. Other units are ignored here.
- fire: distance from `minRange` to `range`. Direct fire needs
  `canSee(unit, target)`. Indirect fire needs the target in the player's
  `visibleHexes`. The hex may be empty.
- special (treat): target is adjacent and holds a friendly unit that is not
  down.

**`resolve`** — the round, in five phases. Emit a `phase` event at the start
of each.

0. **Treat.** For each medic with a special order that is ready: if the
   target hex holds a pinned friendly, it becomes ready (`treat` event).
   First: clear every unit's `revealed` flag.
1. **Fire.** A unit *acts* in a phase only if it is ready at that moment.
   Units with a dash order that are ready now are *dashing* for the whole
   round. Work out every fire order from the starting positions, then apply
   all hits.
   - Direct: `fire` event; a hit on every unit (either side, not the
     shooter) in the target hex, plus its neighbours if `blast` is 1.
   - Indirect: `launch` event; the impact waits for phase 3.
   - Any unit that fires or launches becomes `revealed`.
2. **Movement.** Movers are units with a move or dash order that are still
   ready. Ambushers are units with an ambush order that are still ready.
   Repeat for step 1, 2, … until no one is moving:
   - Each mover intends its next path hex. It **stops for the round**
     (`blocked` event) if: another mover intends the same hex (all of them
     stop); it would swap hexes with another mover (both stop); or the hex
     is held by a unit that is not successfully leaving this step. Work this
     out to a stable answer before anyone moves.
   - The rest move (`move` events with this step number).
   - Then each ambusher that has not fired picks the nearest enemy that
     moved this step and is now within its range, in its line of sight, and
     visible to it under the stealth rule (ties: lowest unit id). It fires
     at that hex with its normal profile (`fire` event, `ambush: true`) and
     becomes `revealed`. Apply all of this step's ambush hits together.
3. **Mortars land.** For each launch, in unit-id order: `impact` event; a
   hit on every unit in the target hex and its neighbours.
4. **Score and recover.**
   - Each objective with a living unit on it: that unit's owner scores its
     value (`score` event).
   - Units whose `pinnedRound` is earlier than this round become ready
     (`recover` event).
   - Players with no living units become eliminated (`eliminated` event).
   - Round goes up by one. The match is over if the round passed
     `map.maxRounds` or fewer than two players have living units; winners
     are everyone on the top score (`over` event).

**Applying a hit** to a unit, one hit at a time, in shooter-id order:
1. Down already: nothing.
2. In cover terrain, not dashing, the hit does not ignore cover, and the
   unit has not used its cover this round: cover is used up, nothing else
   happens (`hit` with `cover`).
3. Dashing, or already pinned: down (`hit` with `down`).
4. Otherwise: pinned, `pinnedRound` = this round (`hit` with `pinned`).

A unit that is pinned or downed stops moving and loses its ambush.

**`playerEvents`** — for each player, the events they may see, judged at the
moment each happens using the task-03 functions:
- Events about the player's own units: always.
- `phase`, `score`, `eliminated`, `over`: always.
- `fire`: if the player sees the shooter, the whole event. If they see only
  the target hex, the event with `unit` and `from` set to null. Otherwise
  nothing. `launch`: only if they see the mortar. `impact`: if the target
  hex is visible.
- `hit`, `treat`, `recover`, `blocked`: if the unit is visible to them.
- Enemy `move`: included if the unit was visible before or after the step.
  If it was not visible before and is after, send `spotted` (with the unit
  at its new hex) instead. If it was visible before and not after, send the
  `move` then `lost`.
- Also send `spotted` / `lost` when the player's own movement or a `reveal`
  changes what they see.
The final view from `viewFor` is the authority; events are for showing what
happened and may err only toward showing less.

**`orderOptions`** — works from a `PlayerView` (the client has no full
state). `kinds` is empty for a down unit. `move` and `dash` are end hexes
reachable within the allowance over passable terrain, ignoring units.
`fire` and `special` are the hexes `validateOrders` would accept.
**`findPath`** — shortest path over passable terrain, ties broken the same
way every time.

**Tests:** each hit rule; two rifles down a unit in the open in one phase;
cover absorbs one; sniper ignores cover; dash dies to one hit; a hit unit
still fires in phase 1 but does not move; machine-gun blast hits friends;
mortar misses a unit that moved away; ambush fires once at the first mover;
each movement conflict; a column of units following each other moves;
pinned unit sits out one round then recovers; treat lets a pinned unit act;
scoring; elimination; both end conditions; `resolve` does not mutate;
replaying a recorded order list gives the same final state; `playerEvents`
never mentions a unit the player could not see.

## Out of scope
Networking, timers, logs (task 05). Any drawing beyond the eval page.

## Eval page — `eval/04-resolution.html`
Opened at `http://localhost:5173/eval/04-resolution.html`. A flat 2D
hot-seat of the real rules, all players on one screen, no fog:
- Starts a 2-player match on `crossroads` from two presets (a control
  switches to 4 players).
- Click a unit, pick an order from `orderOptions`, click a hex; the order is
  drawn on the map.
- "Resolve" runs `resolve` and steps through the events one by one with a
  plain-text log beside the map; the board updates per event.
- A "view as player N" switch shows that player's `viewFor` and their
  `playerEvents` instead.
- Scores and round are shown; the match can be played to the end.
- "Replay" re-runs the whole recorded order list from `createMatch` and
  reports whether the final state is identical.
