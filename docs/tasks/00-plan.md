# Dawn Squad — Master Plan

Source of truth for project state. Read with `docs/vision.md` (what and why)
and `docs/design.md` (how it looks). Every cross-task interface is pinned
here; a task that needs to change one updates this file first and says so.

## Tasks

- [x] 01 Foundation — project setup, shared types, hex maths
- [x] 02 Content — units, terrain, one map, presets, squad validation
- [x] 03 Sight — line of sight, stealth, `viewFor`
- [x] 04 Resolution — `createMatch`, `validateOrders`, `resolve`, `orderOptions`
- [x] 05 Server — lobby, seats, rounds, timer, log and resume
- [x] 06 Board — three.js board, visual kit, camera, picking, marks
- [x] 07 Playback — effect kit, `board.play(events)`
- [x] 08 Kit UI, lobby and builder — components, net client, lobby screen
- [x] 09 Play and results screens — giving orders, playback, results
- [x] 10 Match in a box — all-seats page, bot smoke test, phone pass
- [x] 11 Field manual — sixteen watch-only lessons on the real engine (added after 10; needs 01–09)
- [x] 12 Actions as data, and stronger stealth — action vocabulary in content; terrain and posture decide who is seen (needs 01–11)
- [x] 13 Phone landscape layout — board left and full height, the kit in one column right, on every screen; safe areas; rotation keeps the match and the lesson (needs 01–12)
- [x] 14 Move then act, and moving through your own squad — a move may carry a follow-up shot or special, resolved in a new assault phase; teammates do not block each other (needs 01–13)
- [x] 15 Unsent orders count, and a bigger field — drafts held by the server run at the bell; 17 × 13 map, nine objectives, budget 20, 15 rounds (needs 01–14)

## Dependencies

```
01 ─► 02 ─┬─► 03 ─► 04 ─► 05 ─► 08 ─┐
          └─► 06 ─► 07 ─────────────┴─► 09 ─► 10
```
Two tracks run independently after 02: rules/server (03, 04, 05, 08) and
visuals (06, 07). They meet at 09.

## Conventions

- **One package**, TypeScript, ES modules, strict mode. No framework.
- **Layout**
  ```
  index.html                 client entry (08)
  dev.html                   all-seats page (10)
  public/fonts/              bundled fonts (08)
  src/shared/types.ts        every shared data shape (01)
  src/shared/protocol.ts     client/server messages (01)
  src/shared/hex.ts          hex maths (01)
  src/content/               data only (02)
  src/rules/                 pure functions (03, 04)
  src/server/                Node process (05)
  src/client/render/         three.js (06, 07)
  src/client/ui/             DOM components and screens (08, 09)
  src/client/net.ts          socket client (08)
  scripts/                   dev tools (10)
  eval/NN-name.html          one evaluation page per task
  matches/                   order logs, git-ignored (05)
  ```
- **Imports go one way:** `shared` ← `content` ← `rules` ← `server`;
  `client` may import `shared`, `content`, and `rules` (for `orderOptions`),
  never `server`. `rules` never imports three.js, DOM, Node APIs, `Date`, or
  `Math.random`.
- **Scripts:** `npm run dev` (Vite, port 5173, proxies `/ws` to 8080),
  `npm test` (Vitest), `npm run typecheck`, `npm run build`,
  `npm run server` (05), `npm start` (05: build, then serve on 8080).
- **Eval pages** are real: they import the task's actual modules and are
  opened through Vite at `http://localhost:5173/eval/NN-name.html`. Pages for
  tasks 05 and later also need `npm run server`. No mock-ups.
- **Status:** the implementer ticks its box here when its eval page works.

## Rules (v1)

All numbers live in `src/content` and are meant to be tuned by playing.

**Board.** Pointy-top hex grid, axial coordinates. The one map, `crossroads`, is 17 × 13 hexes with nine objectives (a 3 at the centre, four 2s, four 1s) and 15 rounds (`maxRounds` on the map; the manual's lesson maps have their own). Each cell has a terrain
(`open`, `woods`, `building`) and an elevation (0, 1, 2). One unit per hex.

**Units.** Status is `ready`, `pinned`, or `down` (out of the match).
Five types: rifleman, machine gunner, sniper, mortar, medic.

**Orders.** One per unit per round: `move` (path up to `move` hexes), `dash`
(path up to 2 × `move`), `fire` (at a hex), `ambush`, `special` (at a hex),
or nothing (hold). A unit type lists which orders it may take. Orders for a
pinned unit are legal but only run if the unit is ready when its turn comes.
A `move` (never a `dash`) may carry a **follow-up**: a `fire` or `special` to
be carried out from where the move ends. It may be ordered when the unit has
that order kind, its action is `mobile`, and the target hex is within the
action's range of the last hex of the path; sight and what stands on the
target are not judged until the move is over. `mobile` is data, a tuning
lever: true for the rifle and the medic's aid, false for the machine-gun
burst, the sniper shot and the mortar round.

**A round resolves in six fixed phases:**
0. **Treat.** Each medic's special makes an adjacent pinned friendly ready.
1. **Fire.** All fire orders are worked out from the same starting
   positions, then all hits land. A unit hit this phase still fires. Mortars
   launch here but land in phase 4.
2. **Movement.** Movers advance one hex per step, all together. After each
   step, each waiting ambusher fires once at the nearest enemy that moved
   this step and is now in its sight and range.
3. **Assault.** Every follow-up is judged from the positions movement
   left, all together, then all effects land (a unit hit in this phase still
   acts). One runs only if the unit is ready, the target is in range of the
   hex it actually stands on, the action's sight rule holds from there, and
   what the action needs is on the target hex; otherwise nothing happens and
   an `unable` event gives the reason. Everything else is as in the fire
   phase: the hit rule, cover taking the first hit of the round, a dasher
   down to one hit, giving the user away. An action that lands late is
   launched here and lands in phase 4.
4. **Mortars land** on their target hex and the six around it.
5. **Score and recover.** A living unit standing on an objective scores its
   value for its owner. Units pinned in an earlier round recover. Squads with
   no living units are eliminated; their score stays.

**Hits.** No dice.
- A unit in cover (woods, building) ignores the first hit on it each round.
- A unit with a dash order this round has no cover and goes down from one hit.
- Otherwise a hit pins a ready unit and downs a pinned unit.
- A hit unit stops moving and loses its ambush.
- Area fire (machine gun, mortar) hits every unit in the area, either side.
- A sniper's hit ignores cover.

**Sight.** A unit sees a hex within its `sight` range if the line to it is
clear. Hills and blocking terrain stop the line; higher ground sees over
lower obstacles. Whether an enemy unit on a seen hex is itself seen depends
on the ground it stands on and what it has done in the round (its `posture`):

| The unit, in the last resolved round | In hiding terrain (woods, building) | In the open |
|---|---|---|
| stayed still (held, ambushed, was pinned, used a non-revealing action) | seen from `hide.still` (1) hexes or closer | seen |
| moved, but did not dash | seen from `hide.moved` (2) hexes or closer | seen |
| dashed | seen | seen |
| used a revealing action (fired) | seen, until the next round begins to resolve | seen |

The distances are the terrain's (`TerrainDef.hide`); a spotter's `spotting`
is added to them. While a round resolves the posture is what the unit has
done so far in it: everyone is `still` when the round begins, a ready unit
with a dash order is `dashed` from the start of the fire phase, and a unit
is `moved` from its first step. An ambusher must see its target itself, by
this rule. There is no exception for objectives: a unit on one is hidden or
seen like any other, and a score is reported to another player without the
objective's name unless that player sees the holder. A mortar may fire at
any hex in range that any friendly unit can see.

**Actions.** What a unit does under a `fire`, `ambush` or `special` order is
an action: an entry in `ACTIONS` built from a fixed vocabulary (phase, range,
sight, what the target hex needs, who is affected, blast, effects, whether it
gives the user away). The rules know the vocabulary and the three kinds of
effect (`hit`, `recover`, `reveal`), never a unit or an action by name.

**Movement conflicts.** Units of different squads block each other: two
stepping into the same hex both stop; two swapping hexes both stop; a unit
cannot enter a hex whose occupant is not leaving that step. Units of one
squad do not: a mover walks into and through a teammate's hex, and teammates
may swap. But no unit ever rests in a hex with another, so:
- A mover does not take the LAST step of its path into a hex where a
  teammate is staying, or where another teammate also ends its path that
  step; it stops where it is (`blocked`), as before.
- After each step, units that have come to rest (path walked, blocked, or
  pinned by an ambush) and share a hex settle it: a unit back on its start
  hex with nothing left to walk back keeps the hex; otherwise the one that
  has been in the hex longest keeps it; the others, and all of them if two
  have been there equally long, fall back one hex along the way they came,
  and the hexes are looked at again. A unit still on its way through is not
  contested. A unit that never moved is never displaced; a unit only ever
  stands on its start hex or a hex of its own path. A fall back is told as
  `blocked` (once a round) and `move` events and springs no ambush.
- While two units share a hex mid-movement, fire that covers the hex hits both.
The algorithm and why it ends are stated above the movement phase in
`src/rules/resolve.ts`.

**End.** After `maxRounds`, or when fewer than two squads have living units.
Highest score wins; ties share the win. An eliminated player sees the whole
board.

## Interfaces

### Shared types — `src/shared/types.ts` (written by 01, verbatim; changed by 12 and 14)

```ts
// ---- geometry
export interface Hex { q: number; r: number }        // axial, pointy-top
export type HexKey = string;                          // `${q},${r}`

// ---- ids
export type PlayerId = number;                        // seat index 0..3
export type UnitId = string;                          // `${owner}-${index}`, e.g. "0-3"
export type UnitTypeId = string;                      // key into UNITS
export type TerrainId = string;                       // key into TERRAIN
export type ActionId = string;                        // key into ACTIONS
export type OrderKind = 'move' | 'dash' | 'fire' | 'ambush' | 'special';
export type UnitStatus = 'ready' | 'pinned' | 'down';
export type Posture = 'still' | 'moved' | 'dashed';   // what a unit has done in the round, so far

// ---- content
export interface TerrainDef {
  id: TerrainId; name: string;
  cover: boolean;        // a unit here ignores the first hit on it each round
  // A unit here that did not fire is seen only from this many hexes or closer:
  // `still` if it has not moved this round, `moved` if it moved without dashing.
  // null = the ground hides nobody. A unit that dashed or fired is never hidden.
  hide: { still: number; moved: number } | null;
  blocksSight: boolean;  // adds 1 to the hex's height for lines passing through
  passable: boolean;
}
// What an action does to each unit it affects. The rules engine has one
// function per kind (src/rules/effects.ts) and knows nothing else about actions.
export type Effect =
  | { kind: 'hit'; ignoresCover?: boolean }    // the hit rule
  | { kind: 'recover' }                        // a pinned unit becomes ready
  | { kind: 'reveal' };                        // the unit counts as having fired
export interface ActionDef {
  id: ActionId; name: string; blurb: string;
  icon: string;                                // UI and kit look-up key
  phase: 'treat' | 'fire' | 'mortar';          // when its effects land
  range: number; minRange: number;             // distance to the target hex
  sight: 'own' | 'squad' | 'none';             // own line to the target hex; any friendly unit sees the hex; no need
  needs: 'any' | 'friend' | 'pinned-friend';   // what must stand on the target hex for the order to be legal
  affects: 'all' | 'friends' | 'enemies';      // who in the area the effects apply to (never the user itself)
  blast: number;                               // 0 = the hex, 1 = plus its neighbours
  effects: Effect[];
  reveals: boolean;                            // using it gives the user away
  mobile: boolean;                             // may be used after a move, as its follow-up
}
export interface UnitDef {
  id: UnitTypeId; name: string; rank: string; blurb: string;
  cost: number; max: number | null;      // max per squad, null = no limit
  move: number; sight: number;
  spotting: number;                      // added to the distance it sees a hidden unit from
  orders: OrderKind[];
  fire: ActionId | null;                 // what the `fire` order (and its ambush shot) does
  special: ActionId | null;              // what the `special` order does
}
export interface Cell { terrain: TerrainId; elevation: number }
export interface Objective { id: string; hex: Hex; value: number }
export interface GameMap {
  id: string; name: string; cols: number; rows: number;
  cells: Record<HexKey, Cell>;
  objectives: Objective[];
  spawns: Hex[][];                        // 4 zones, 8 hexes each, in placement order
  seatSpawns: Record<number, number[]>;   // playerCount -> spawn zone per seat
  maxRounds: number;
}
export interface Preset { id: string; name: string; blurb: string; units: UnitTypeId[] }
export interface Squad { player: PlayerId; units: UnitTypeId[] }
export interface RulesConfig { budget: number; minUnits: number; maxUnits: number }

// ---- state
export interface Unit {
  id: UnitId; owner: PlayerId; type: UnitTypeId; name: string;
  pos: Hex; status: UnitStatus;
  pinnedRound: number | null;   // round in which it was pinned
  revealed: boolean;            // fired in the last resolved round
  posture: Posture;             // still, moved or dashed in the last resolved round
}
export interface GameState {
  map: GameMap; playerCount: number; units: Unit[];
  round: number;                // 1-based: the round now being planned
  scores: number[]; eliminated: boolean[];
  over: boolean; winners: PlayerId[];
}
export interface PlayerView {
  player: PlayerId; map: GameMap; playerCount: number;
  round: number; maxRounds: number;
  units: Unit[];                // own units (all statuses) + visible enemy units
  visible: HexKey[];            // hexes this player can see now
  scores: number[]; eliminated: boolean[];
  over: boolean; winners: PlayerId[];
}

// ---- orders
// What a unit does where its move ends, in the assault phase. Only a `move` carries one.
export type FollowUp =
  | { kind: 'fire'; target: Hex }
  | { kind: 'special'; target: Hex };
export type Order =
  | { unit: UnitId; kind: 'move'; path: Hex[]; then?: FollowUp }   // path excludes the start hex
  | { unit: UnitId; kind: 'dash'; path: Hex[] }
  | { unit: UnitId; kind: 'fire'; target: Hex }
  | { unit: UnitId; kind: 'ambush' }
  | { unit: UnitId; kind: 'special'; target: Hex };
export interface OrderError { unit: UnitId | null; reason: string }

// ---- events (one resolved round, in order)
export type Phase = 'treat' | 'fire' | 'move' | 'assault' | 'mortar' | 'score';
export type GameEvent =
  | { t: 'phase'; phase: Phase }
  | { t: 'treat'; unit: UnitId; target: UnitId; action: ActionId }   // a `recover` effect got `target` back up
  | { t: 'fire'; unit: UnitId | null; from: Hex | null; target: Hex; blast: number; ambush: boolean; action: ActionId }
  | { t: 'launch'; unit: UnitId; from: Hex; action: ActionId }
  | { t: 'impact'; target: Hex; blast: number; action: ActionId }
  | { t: 'reveal'; unit: UnitId; action: ActionId }                  // given away by an action other than its own shot
  | { t: 'hit'; unit: UnitId; at: Hex; result: 'cover' | 'pinned' | 'down' }
  | { t: 'dash'; unit: UnitId }                                      // breaks into a run: `dashed` from now
  | { t: 'move'; step: number; unit: UnitId; from: Hex; to: Hex }
  | { t: 'blocked'; unit: UnitId; at: Hex }
  // A follow-up that did not happen: the unit is down or pinned, the target is out of range from
  // where it stands, the action's sight rule fails, or what the action needs is not on the target hex.
  | { t: 'unable'; unit: UnitId; action: ActionId; reason: 'down' | 'pinned' | 'range' | 'sight' | 'needs' }
  | { t: 'spotted'; unit: Unit }                     // an enemy comes into view
  | { t: 'lost'; unit: UnitId }                      // an enemy leaves view
  | { t: 'recover'; unit: UnitId }
  | { t: 'score'; objective: string | null; player: PlayerId; value: number }   // null: the holder is out of your sight
  | { t: 'eliminated'; player: PlayerId }
  | { t: 'over'; scores: number[]; winners: PlayerId[] };
```
In a `fire` event, `unit` and `from` are null when the receiving player sees
the target hex but not the shooter. In a `score` event sent to a player,
`objective` is null when that player cannot see the unit holding it; the full
event list always names it.

Task 12 changed this block: `ActionId`, `Effect`, `ActionDef` and `Posture`
are new; `UnitDef` lost `range`, `minRange`, `blast`, `ignoresCover`,
`indirect` and gained `fire`, `special` (action ids) and `spotting`;
`TerrainDef` gained `hide`; `RulesConfig` lost `stealthRange`; `Unit` gained
`posture`; the events `treat`, `fire`, `launch`, `impact` gained `action`;
`score.objective` may be null; the events `reveal` and `dash` are new.

Task 14 changed this block: `FollowUp` is new; a `move` order may carry
`then`; `ActionDef` gained `mobile`; `Phase` gained `assault`; the event
`unable` is new (told to whoever sees the unit; a unit that is down is seen
by its owner only). The `step` of a `move` event now counts the moments of
movement in the round, fall backs included, so it can exceed the length of
the unit's path; moves with the same `step` still happen together.

### Hex maths — `src/shared/hex.ts` (01)

```ts
key(h: Hex): HexKey
parseKey(k: HexKey): Hex
eq(a: Hex, b: Hex): boolean
neighbors(h: Hex): Hex[]                 // 6, fixed order: E, NE, NW, W, SW, SE
distance(a: Hex, b: Hex): number
line(a: Hex, b: Hex): Hex[]              // inclusive; line(a,b) is line(b,a) reversed
within(h: Hex, radius: number): Hex[]    // includes h
offsetToAxial(col: number, row: number): Hex   // odd-r offset: odd rows shifted right
axialToOffset(h: Hex): { col: number; row: number }
label(h: Hex): string                    // "F4": column letter, row number from 1
hexToPixel(h: Hex, size: number): { x: number; y: number }   // size = circumradius
pixelToHex(x: number, y: number, size: number): Hex
```

### Content — `src/content/index.ts` (02)

```ts
UNITS: Record<UnitTypeId, UnitDef>       // rifleman, gunner, sniper, mortar, medic
ACTIONS: Record<ActionId, ActionDef>     // rifle, burst, snipe, shell, aid (12)
TERRAIN: Record<TerrainId, TerrainDef>   // open, woods, building; `hide` says how near a unit there is seen from (12)
MAPS: Record<string, GameMap>            // crossroads: 17 × 13, nine objectives, 15 rounds (15)
DEFAULT_MAP: string
PRESETS: Preset[]
RULES: RulesConfig                       // budget 20, minUnits 4, maxUnits 8 (`stealthRange` removed by 12; budget 16 → 20 by 15)
NAMES: string[]                          // surname pool for unit names
validateSquad(units: UnitTypeId[]): { ok: boolean; cost: number; errors: string[] }
```

### Rules — `src/rules/index.ts` (03 and 04)

```ts
// 03 — sight
canSee(map: GameMap, from: Hex, to: Hex): boolean         // line only, no range; symmetric
visibleHexes(state: GameState, player: PlayerId): Set<HexKey>
visibleEnemies(state: GameState, player: PlayerId): Unit[]
viewFor(state: GameState, player: PlayerId): PlayerView

// 04 — the game
createMatch(map: GameMap, squads: Squad[]): GameState
validateOrders(state: GameState, player: PlayerId, orders: Order[]): OrderError[]   // empty = legal
resolve(state: GameState, orders: Order[][]): {           // orders indexed by player
  state: GameState;
  events: GameEvent[];            // everything, for logs and tests
  playerEvents: GameEvent[][];    // what each player may see, indexed by player
}
orderOptions(view: PlayerView, unit: UnitId): {           // for the UI
  kinds: OrderKind[];
  move: HexKey[]; dash: HexKey[];   // reachable end hexes
  fire: HexKey[]; special: HexKey[];
}
findPath(map: GameMap, from: Hex, to: Hex, maxSteps: number): Hex[] | null   // excludes `from`

// 12 — added, nothing above changed
actionOf(type: UnitTypeId, kind: OrderKind): ActionDef | null   // the action behind a fire, special or ambush order
hideRange(map: GameMap, unit: Unit): number | null              // how near an enemy must be to see it; null = not hidden
spots(map: GameMap, spotter: Unit, target: Unit): boolean       // one unit's own eyes: range, line and stealth

// 14 — added; `validateOrders` and `resolve` take the new order shape
followUpOptions(view: PlayerView, unit: UnitId, end: Hex): {    // for the UI: where a move ending on `end` may aim its follow-up
  fire: HexKey[]; special: HexKey[];                            // empty unless the action is `mobile`; range only
}
```
Effects live in `src/rules/effects.ts`: one function per `Effect` kind, the
only place that knows what an effect does.
`resolve` never mutates its input. Same input, same output, everywhere.

### Protocol — `src/shared/protocol.ts` (written by 01, served by 05)

JSON text frames over a WebSocket at `/ws`.

```ts
export interface SeatStatus { seat: PlayerId; name: string; connected: boolean; ready: boolean; out: boolean }

export type ClientMsg =
  | { t: 'join'; name: string; token?: string }   // token reclaims a seat
  | { t: 'squad'; units: UnitTypeId[] }           // lobby: set squad, clears ready
  | { t: 'ready'; ready: boolean }                // lobby: needs a valid squad
  | { t: 'start' }                                // lobby: host only, 2+ seats, all ready
  | { t: 'orders'; orders: Order[] }              // playing: commit (lever down)
  | { t: 'draft'; orders: Order[] }               // playing: the orders as they stand; does not commit (15)
  | { t: 'recall' }                               // playing: lever up, before resolve
  | { t: 'rematch' };                             // over: host only, back to lobby

export type ServerMsg =
  | { t: 'welcome'; seat: PlayerId; token: string; host: boolean; mapId: string; squad: UnitTypeId[] }
  | { t: 'lobby'; seats: SeatStatus[] }
  | { t: 'plan'; view: PlayerView; seats: SeatStatus[]; timer: number | null; orders: Order[] | null }   // orders: what the server holds for this seat this round (15)
  | { t: 'seats'; seats: SeatStatus[] }
  | { t: 'resolve'; events: GameEvent[]; view: PlayerView; seats: SeatStatus[]; timer: number | null }
  | { t: 'rejected'; errors: OrderError[] }
  | { t: 'error'; message: string };
```
- `timer` is milliseconds left to plan when the message was sent; null = no timer.
- `plan` is sent at match start and to a player who reconnects mid-match.
- `resolve` carries the round just played and the view for the next plan.
  If `view.over`, the match is finished.
- Seat 0 is the host.
- **Drafts (task 15).** The server holds one list of orders per seat per round: whatever `orders` or a valid
  `draft` last put there. At the deadline it runs what it holds for every seat, lever pulled or not (a seat that
  holds nothing holds). A round still ends early only when every living seat has pulled the lever; a draft never
  ends a round and never sets `ready`. `draft` is validated like `orders`; an invalid one is dropped silently
  (no `rejected`) and what was held stays; one from a seat that is ready, out, or out of turn is ignored.
  `recall` keeps the held orders. The client sends `draft` on every change while the lever is up, at most about
  three times a second, always the latest; it no longer sends anything in the last second. `plan.orders` is what
  is held (null if nothing), sent on a reconnect or reload so the screen shows what will run; `plan` is never
  sent at a round change (that is `resolve`), where the held orders are cleared. The match log is unchanged:
  it records the orders that ran.

### Board — `src/client/render/index.ts` (06, `play` completed by 07)

```ts
createBoard(canvas: HTMLCanvasElement, kit: VisualKit): Board

interface Board {
  setView(view: PlayerView): void;               // snap the board to this view
  setMarks(marks: Mark[]): void;                 // replace all planning marks
  play(events: GameEvent[]): Promise<void>;      // animate one round (07)
  onHexTap(cb: (hex: Hex, unit: Unit | null) => void): void;
  focus(hex: Hex): void;                         // centre the camera
  resize(): void;
  dispose(): void;
}

type Mark =
  | { kind: 'select'; hex: Hex }                          // amber ring
  | { kind: 'path'; from: Hex; path: Hex[]; dash: boolean }   // grease-pencil stroke
  | { kind: 'target'; from: Hex; hex: Hex; blast: number }
  | { kind: 'ambush'; hex: Hex }
  | { kind: 'options'; hexes: Hex[] };                    // where the current order may go
```
World convention: hex circumradius 1 unit, pointy-top, y up, 0.5 units per
elevation level.

Camera (changed by 15; the interface above is not). The board opens at
`START_SCALE` (28 px per world unit, exported) or at the scale that fits the
map if that is larger; the play screen moves to the squad when the whole map
does not fit at that scale. The camera may not show more than a hex and a bit
beyond the outermost hexes along an axis where the map is bigger than the
screen, and keeps the map centred along an axis where it fits. The closest
zoom (4 world units across the short side) is as before. Hex labels are drawn
0.44 units tall (0.26 before) so that they read at the opening scale.

### Visual kit — `src/client/render/kit.ts` (06, `effect` added by 07)

```ts
interface VisualKit {
  tokens: Record<string, string>;                       // palette from docs/design.md
  environment(scene: THREE.Scene): void;                // sun, mist, background
  tile(terrain: TerrainId, elevation: number, hex: Hex): THREE.Object3D;
  unit(type: UnitTypeId, owner: PlayerId): UnitVisual;
  mark(mark: Mark, ctx: KitCtx): THREE.Object3D;
  objective(obj: Objective): THREE.Object3D;
  fog(): THREE.Material;                                // veil over unseen hexes
  effect?(event: GameEvent, ctx: KitCtx): Promise<void>;   // 07
}
interface UnitVisual { object: THREE.Object3D; setStatus(s: UnitStatus): void }
interface KitCtx {
  scene: THREE.Scene;
  hexToWorld(hex: Hex): THREE.Vector3;                  // top centre of that hex
  unitObject(id: UnitId): THREE.Object3D | null;
}
```
The v1 kit lives in `src/client/render/kits/lowpoly/`. An unknown terrain or
unit id returns a plain placeholder, never an error.

### Client UI — `src/client/` (08, used by 09 and 10)

```ts
// net.ts
connect(slot?: string): Net
interface Net {
  send(msg: ClientMsg): void;
  on<T extends ServerMsg['t']>(t: T, cb: (msg: Extract<ServerMsg, { t: T }>) => void): () => void;
  onStatus(cb: (online: boolean) => void): void;
}
// The seat token is kept in localStorage under `dawn-squad-token-${slot}`.
// `slot` comes from the `?slot=` URL parameter, default "default".

// ui/components.ts — each returns an HTMLElement; state is set by attribute or method
panel, chit, key, lever, lamp, readout, unitCard, stepper, report

// ui/screens/*.ts
interface Screen { mount(root: HTMLElement, app: App): () => void }   // returns unmount
interface App { net: Net; seat: PlayerId; host: boolean; data?: unknown; go(screen: 'lobby' | 'play' | 'results', data?: unknown): void }
```
`go(screen, data)` stores `data` on `app.data` before mounting, so a screen
can read the message that caused it to mount (added by task 08).
CSS tokens and component classes come from `docs/design/stylesheet.html`,
ported to `src/client/ui/kit.css`.

## Open items (not blocking)
- All numbers are first guesses; tune after task 10.
- Deferred units: sergeant/radio, sapper, off-map assets.
- `crossroads` (17 × 13, task 15) is a mirror image north-south and east-west as well as under a half turn, so
  the four start zones are the same hex for hex (a test pins the steps to the centre, to the nearest 2 and to the
  nearest 1), but for six hexes: under a half turn the last hex of every second row (Q2, Q4, … Q12) has no
  partner, and is plain open ground (the test says so). A rectangle of hexes cannot do better.
- **Seat fairness on `crossroads`, measured in task 15** (seeded scripted matches, `npx tsx scripts/seeded.ts
  --figures 1800 [--same line|support|scouts]`, 600 matches a player count, 2026-11-18; figures on
  `eval/15-drafts-and-bigger-field.html`). Four players: every seat within about a point of a mean score of 8 to 11
  (Line section for all: NW +1.05, SW −1.11, ± 0.3, and it follows the zone when the seats are swapped; other
  deals show less). Two players: the NW zone is about a point ahead of the SE with the Line section or random
  squads, level with the Weapons and Scout sections. Three players (zones 0, 1, 2) is not fair: the NE seat, opposite
  the empty corner, scores 3 to 5 points per match less than the other two and wins about 0.18 of the matches (0.33
  would be even), because the two others each have an empty corner beside them. Nothing in a four-corner map fixes
  three players; a different placement of the third seat, or objectives that shift with the seat count, would.
- **Sight is not exactly symmetric on a symmetric map.** `line` in `src/shared/hex.ts` breaks exact ties with a fixed
  nudge, so on `crossroads` 3.8% of the hex pairs within 6 disagree about whether they see each other under a
  north-south mirror and 5.9% under a half turn. The NW zone's small edge above is probably this; that is not
  proven. Making it symmetric is a change to the line, which is rules (digests would move).
- **Phone landscape (task 13), left awkward:** the lobby is still a scrolling page (the builder is about 1700 px
  tall at 844 wide; the lever and Start stay put at the left); at 667 x 375 the chits are icons only, the lever is
  56 x 92, and four seats with the clock leave two squad cards in view; the manual's lesson text scrolls in its box
  on the longest lessons there; a notched phone gets about 54% of the width for the board. No physical phone has
  been tried: steps are in `eval/13-landscape.html`.

Observations from task 10 (7,800 bot matches and scripted matches through
`dev.html`; no person has played yet). Numbers were not changed.
- **Focus fire kills in one round.** All hits of the fire phase land one after
  another, so two rifles on a man in the open, or three on a man in cover,
  put him down before he can act. In the four-seat match 19 of 25 units were
  down by round 12. Pins rarely last long enough for a medic to matter (the
  bots treated a man about once in 75 rounds). Consider one status step per
  unit per phase, or cheaper cover.
- **A wiped squad can win, and did.** The Scout section dashed eight men onto
  D in two rounds, took 3 a round, lost every man by round 10 and still won 19
  to 6, 6 and 4. The rule is as written ("its score stays"), but D at 3 a
  round outweighs staying alive. Look at objective values against 12 rounds.
- **The plan timer runs during playback.** The next round's clock starts when
  the round resolves; a busy four-seat playback takes 8 to 10 seconds of it.
  Fine at 90 s, plain at `--timer 20`. Starting the clock after playback would
  need the server to know when clients have finished watching.
- **Match length.** 15 rounds (task 15) at 90 s is 22.5 minutes of clock if every round runs to the bell (the
  next round's clock starts as the round resolves, so playback is inside it); with the lobby and the result screen
  about 25 minutes. Still under the vision's 30 to 45. Probably right for a lunch break; say which.
- **Squads jam in their own spawn zone.** (Addressed by task 14: teammates no
  longer block each other. As it was:) Paths ignore units and a unit cannot
  enter a hex whose occupant stays, so back-row men ordered through a man who
  holds can be "blocked" on round 1 and lose the round. The strip says so only
  afterwards; an eight-man squad fills all eight spawn hexes.
- **A seat that reloads during playback** lands in the next plan and never
  sees the round it missed; the log strip is empty for it.
- **Phone (emulated 390 x 844 only):** the builder's minus and plus keys are
  40 px, the words on the order chits 11 px, and an eight-man squad shows about
  one and a half cards at a time in the squad row. A real phone has not been
  tried: steps are in `eval/10-match-in-a-box.html`.
- three.js r187 warns on every board that `PCFSoftShadowMap` is gone and it
  uses `PCFShadowMap`; `src/client/render/index.ts` could ask for that directly.
- `dev.html` is served by Vite only; it is not in the build. The client's
  `auto` and `name` URL parameters work only for slots starting with `dev`
  (`src/client/dev.ts`).
