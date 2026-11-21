# Dawn Company — Master Plan

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

**v2 — the revised vision (`docs/vision.md`, 2026-11-19).** Rules and interfaces for these tasks are in the
section *v2* below; each task folds what it changes into the v1 sections when it lands.

- [x] 16 Objective areas, flags and HQs — objectives are areas with a kind; flags captured at the round's end and kept; an HQ per start zone; `x` = no hex in the map format (needs 15)
- [x] 17 Modes and a map per player count — `MODES` in content, the host picks the mode in the lobby, `mapFor(players)`, squads checked against the mode (needs 16)
- [x] 18 Supply Line — held flags earn supply (the score); downed units return at their HQ; buying back; a lost HQ cuts the line (needs 17)
- [x] 19 The rising sun — sight grows round by round; the board's light follows (needs 16)
- [x] 20 Last Stand — permanent death, no supply, last squad standing wins (needs 18)
- [x] 21 Objective kinds — what a hill, a crossroads, a depot and a village give their owner (needs 18)
- [x] 22 Two-player map and four-player refit — `ford` for two; walls round the hamlets and a stream with fords on `crossroads` (needs 21)
- [x] 23 Three-player triangle — `tripoint`, the same after a third of a turn (needs 21)
- [x] 24 Dig in — a unit that held still a whole round is harder to hurt until it moves (needs 16)
- [x] 25 Engineer and works — the engineer builds sandbags, wire and MG nests for supply (needs 18, 24)

**Visual trial (jig, 2026-11-21).** A second kit beside `lowpoly`, chosen by `?kit=`; render only.

- [x] 26 Diorama trial — "the world is real, the information is drawn": one realistic rifleman, one grass tile, a dark foggy dawn; everything else falls back to lowpoly (needs 25)
- [x] 27 Diorama woods and buildings — the diorama kit's own `woods` and `building` tiles (needs 26)
- [x] 28 Diorama water, crops and walls — the kit's own `water`, `crops` and `wall` tiles; tiles learn their neighbours (needs 27)

## Dependencies

```
01 ─► 02 ─┬─► 03 ─► 04 ─► 05 ─► 08 ─┐
          └─► 06 ─► 07 ─────────────┴─► 09 ─► 10
```
Two tracks run independently after 02: rules/server (03, 04, 05, 08) and
visuals (06, 07). They meet at 09.

v2, built in number order (every rules task re-pins the seeded digests, so two
at once would collide in `src/rules` and `src/rules/digest.test.ts`):
```
16 ─┬─► 17 ─► 18 ─┬─► 20
    │             ├─► 21 ─┬─► 22
    │             │       └─► 23
    │             └──────────────► 25
    ├─► 19                         ▲
    └─► 24 ────────────────────────┘
```

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

**Board.** Pointy-top hex grid, axial coordinates. One map per player count, read like a MOBA map (bases, lanes, cover between them, water with crossings, a contested centre; each map's comment in `src/content/maps.ts` says what each lane is for and which playstyle each part favours), 15 rounds each (`maxRounds` on the map; the manual's lesson maps have their own). **`ford`** (22; `mapFor(2)`): 13 × 15, the first hex of every second row off the board; HQs W (north-west, zone 0) and X (south-east, zone 1); a river from the north-east edge to the south-west edge crossed only at a north ford, a south ford and the hill at the centre; three lanes (two along the edges, one through the middle); eleven objectives: the hill E, 3; four villages, 2, one each side of each edge-lane ford; two depots, 1, one each side; two gates J and K (crossroads, 1) three steps in front of each HQ; two HQs, 1. **`tripoint`** (23; `mapFor(3)`): a triangle of 16 hexes a side, point up (a 16 × 16 drawing, the rest `x`), 136 hexes, the same after a third of a turn about its centre hex (`rotate(h, centre, 2)`, a test checks terrain, elevation, every objective and the spawns zone to zone) and a mirror image about each line from a corner through the centre but for the hill's area and the spawn order; an HQ in each corner: W top (zone 0), X bottom right (1), Y bottom left (2); each edge an open lane shared by the two seats at its ends, with a village (2) of two buildings half way along it; a spoke of open ground from each corner straight to the hill through the HQ's gate (J K L, crossroads, 1, four steps out); woods and crops between, with two farms (depots, 1) in each jungle, one six steps from each seat that borders it (A B C, S T U); a pond two steps from the hill in each jungle; the hill E (3) the centre hex at height 2 and three of its six slopes (height 1); sixteen objectives; every start hex 7 to 9 steps from the centre (four or five rounds of rifleman moves). **`crossroads`** (15, refitted by 22; `mapFor(4)`, its only layout since 23): 17 × 13, a start zone in each corner; a stream down the middle crossed only at a north ford, a south ford and the hilltop plateau; each hamlet's two buildings ringed by low walls with three gaps; fifteen objectives: the hill, 3; four villages, 2; four depots, 1 (a farm by a ford); two crossroads J and K, 1, where the middle lane meets the flank roads; four HQs, 1. Each cell has a terrain
(`open`, `woods`, `building`, `crops`, `wall`, `water`; and, put up during a match by an engineer (25), `sandbags`, `wire`,
`nest`) and an elevation (0, 1, 2). One unit per hex. A map may leave hexes out (no cell). A match's `state.map` is its own
copy: a work replaces its hex's terrain there (copied on write by `resolve`), never in `MAPS`.

**Objectives (16).** An objective is an **area** of one or more connected hexes with a kind (`hq`, `village`, `hill`,
`crossroads`, `depot`; `OBJECTIVE_KINDS`) and a `value`. Every objective has a **flag**: a
player or nobody, public to everyone. At the start each HQ's flag belongs to the seat whose start zone it is (an HQ
whose zone no seat uses: nobody); every other flag to nobody.

**Objective kinds (21).** A unit **benefits** from an objective when it stands on a hex of its area and its owner holds
the flag (`benefitOf`; areas never overlap, so at most one; a down unit never). What each kind gives, as data:
| Kind | sight | move | supply | rally |
|---|---|---|---|---|
| hq | 0 | 0 | 0 | false |
| village | 0 | 0 | 1 | false |
| hill | 2 | 0 | 0 | false |
| crossroads | 0 | 1 | 0 | false |
| depot | 0 | 0 | 2 | true |
- `sight` is added by `sightOf` after the sun's minimum of 1: `max(1, type + sun) + sight`.
- `move` is added by `moveOf`, from where the unit stands when the round begins (orders are judged there; walking in
  gives nothing that round, walking out keeps it that round and loses it the next). A dash is twice `moveOf`.
  `validateOrders`, `resolve`'s order check, `orderOptions`, the play screen's `allowance` and the scripts use it.
- `supply`: in a mode with supply a flag earns `value + supply`, in one `score` event with the total.
- `rally`: at the end of the score phase, a pinned unit benefiting from a depot recovers even if it was pinned this
  round (a `recover` event as usual). A pinned man does not take a flag, but he rallies on one already his.
- Screens: the hex description gives what the kind gives its holder ("hill E, 3 a round, gives its holder sight +2, your
  flag"); a unit card shows a benefit he has ("Hill: sight +2"); the sight sum names it ("sight 5 (6 −3, first light;
  hill +2)") (`src/client/ui/ground.ts`). Manual group *Ground*: `hill`, `crossroads`, `depot`; the *Supply* lesson
  quotes the village. Every map has `crossroads`-kind objectives since 22.
- Figures (2026-11-19, `scripts/seeded.ts --figures 900`, which now prints `kinds`): flags held after a round's
  captures, share of flag-rounds: hq 0.75, village 0.51, hill 0.43, depot 0.50; at the end, villages and depots are held
  by the seat whose HQ is nearest about two times in three and the hill by nobody 0.23 of the time; a depot rallies
  about one man a match.

**Modes (17).** A match is played in a mode (`MODES`, `DEFAULT_MODE` in `src/content/modes.ts`), chosen by the host in the
lobby: `supply-line` (default) or `last-stand`. A mode is data: the unit types it allows (`units`, null = all), whether
flags earn supply, whether the downed return, and the win rule. Squad checking (`validateSquad`, `createMatch`) reads
`units`; `resolve` reads `returns` (18), `supply` and `win` (20). The map is never chosen by hand: `mapFor(players)` gives it. Last
Stand has no mortar; the Scout section is the preset it allows.

**Last Stand (20).** `supply: false`, `returns: null`, `win: 'survival'`; the rules read these fields, never the mode's id.
- Flags are still captured (`capture` events) but nothing earns: no `score` events, and every purchase is invalid ("No supply
  in this mode."; `buyBackCost` is null). Down is final (`returnRound` stays null).
- In the score phase, after the captures, `scores[p]` is set to the number of player `p`'s living units: a live tally, no
  events. A squad with no living unit is out. The match ends after `maxRounds` or when fewer than two squads are not out.
- Winners (`src/rules/survival.ts`): the most living units; among those the greatest total `cost` of living units; still
  equal, they share. If the last squads lose their last men in the same round, every squad that was not out when the round
  began shares the win. `viewFor` of a finished survival match carries `worth` (each squad's total cost standing), so a
  client can say why a tie-break was decided.
- Screens: the score is labelled *Supply* or *Standing* by the mode (`scoreWord`); the results screen says who stood with
  how many men and, level on men, whose were worth more; the log says "down ... For good.". Manual group *Last Stand*: two
  lessons (`last-stand`, `last-stand-tie`); a lesson may set `mode` and expect `winners`. Scripts: `--mode last-stand` on
  `scripts/bots.ts` and `scripts/seeded.ts` (figures for rounds, men left, early ends, ties decided by cost); ten Last Stand
  digests (seeds 2001 to 2010) are pinned in `src/rules/digest.test.ts`; `scripts/last-stand-log.ts` makes the eval's match.

**Supply Line (18).** `scores` **is supply**: what held flags earn, the score, and the one currency. Only in a mode with
`returns` (Supply Line: `{ rounds: 3, buyBack: 6 }` (4 until 22); Last Stand: null, and then none of this happens):
- A unit that goes down in round `r` gets `returnRound = r + returns.rounds`: it is due back at the end of that round.
- A player's **HQ** is the objective of kind `hq` whose zone their seat uses (`map.seatSpawns[n][seat]`). Their **line is
  open** while its flag is theirs.
- **Buying back** (`Purchase`, a side list per player, never an order): a down unit of one's own with a `returnRound`
  may be bought back for `UNITS[type].cost × returns.buyBack` supply while the line is open, unless it is due back at the
  end of this round anyway (or already waiting for room); `buyBackCost` says the price or null. `validatePurchases`: no
  unit twice, the running total within the player's supply. Invalid purchases are dropped one by one, as orders are.
- **Returns**: every down unit whose line is open and whose `returnRound` ≤ this round comes back, in id order, on the
  first free passable hex of its HQ's area (drawing order), else of its start zone (placement order): ready, posture
  `still`, not revealed, `pinnedRound` and `returnRound` null; a `return` event. No free hex, or the line cut: it waits.
  He is a new arrival to everyone's sight (`spotted`/`lost` as usual).
- **Out**: a squad is eliminated when it has no living units and none can come back (its line is cut, or it has no down
  unit with a `returnRound`).
- Tuning (2026-11-19, `scripts/seeded.ts --figures 900`): a seat earns about 4.2 supply a round with two players, 3.5 with
  three, 3.1 with four; a rifleman's buy-back (8) is two to two and a half rounds of that. Since 21 (villages and depots
  earn more): 6.7, 5.6 and 4.8, so a buy-back is 1.2 to 1.7 rounds. Not retuned.

**Units.** Status is `ready`, `pinned`, or `down` (out of the match).
Six types: rifleman, machine gunner, sniper, mortar, medic, engineer (25; Supply Line only: not in Last Stand's `units`).

**Orders.** One per unit per round: `move` (path up to `moveOf` hexes: the type's `move`, plus a held crossroads', 21), `dash`
(path up to 2 × `moveOf`), `fire` (at a hex), `ambush`, `special` (at a hex),
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
5. **Score and recover.** In this order: **build** (25) — first, in unit id order, every ready engineer with a build
   ordered (a `special` whose action has a `build` effect, or such a follow-up that the assault let through) builds if
   he is in range, the hex may still take the work (`blocked` otherwise) and his owner's supply covers its cost now,
   before this round's income (`supply` otherwise; always in a mode without supply): the cost leaves `scores`,
   `works[key] = work`, and the hex's cell in the match's map gets the work's terrain; a `build` event (to the owner and
   whoever sees the hex), else an `unable` (to whoever sees the engineer) with `supply`, `blocked`, `down`, `pinned` or
   `range`. Then **capture** — for each objective in id
   order, the players with a *ready* unit on any hex of its area: exactly one,
   and the flag is theirs (a `capture` event, to everyone, if it changed hands);
   none or several, and it stays as it was. **Supply** — each flag's owner scores
   the objective's value plus its kind's `supply` (21) (a `score` event per flag, to everyone); in a mode without `supply` (20) nobody earns, and in a
   `survival` mode `scores[p]` is then set to the men standing, with no event. **Purchases** (18) —
   each player's buy-backs in seat order, each in the order given and checked again
   against what is left (line still open, supply enough): paid ones subtract the cost,
   set `returnRound` to this round and emit `purchase` (to everyone). **Returns** (18) —
   see Supply Line above. **Dig in** (24) — every living unit (ready or pinned) whose posture is `still`, that is not
   dug in and did not come back this round, becomes dug in: a `dig` event each (to its owner and whoever sees it). Then units pinned in an earlier round recover, and (21) any pinned unit on a depot its owner
   holds (`rally`); squads that
   are out (no living units and, with returns, nobody who can come back) are
   eliminated (their score stays, their flags go to nobody, with no event).

**Hits.** No dice.
- A unit in cover (a building, a low wall; sandbags or an MG nest, 25) ignores the first hit on it each round. Woods and crops hide but give no cover.
- **Dug in** (24): a unit that held still a whole round is dug in from the score phase until its first step (a dash, a
  fall, or going down also ends it; a move that never takes a step, a pinned man's, does not). It ignores one more hit a
  round: so one hit on open ground, two in a building or behind a wall. A dasher is never dug in. The foxhole, like cover,
  is used up by the round's first hits, in any phase; a shot that lands after he stepped (ambush, follow-up) finds him in the open.
- A unit with a dash order this round has no cover and goes down from one hit.
- Otherwise a hit pins a ready unit and downs a pinned unit.
- A hit unit stops moving and loses its ambush.
- Area fire (machine gun, mortar) hits every unit in the area, either side.
- A sniper's hit ignores cover, and the foxhole, and uses neither up.

**Sight.** A unit sees a hex within its sight range if the line to it is
clear. Its sight range in a round is `sightOf`: its type's `sight` plus the
sun's change for that round, `SUN[min(round, SUN.length) - 1]` with
`SUN = [-3, -3, -2, -2, -1, -1, 0]`, at least 1 (19), plus the `sight` of a held objective the unit stands on (a
hill: +2, 21). Inside `resolve` the
round is the one being resolved; the last update of who sees what, after the
round's end, is in the next round's light, so a unit the rising sun brings
into reach is `spotted` then, and the events still add up to `viewFor`.
Ranges of actions do not change with the light. Hills and blocking terrain stop the line; higher ground sees over
lower obstacles. Whether an enemy unit on a seen hex is itself seen depends
on the ground it stands on and what it has done in the round (its `posture`):

| The unit, in the last resolved round | In hiding terrain (woods, crops, building) | In the open (and open ground, walls, water) |
|---|---|---|
| stayed still (held, ambushed, was pinned, used a non-revealing action) | seen from `hide.still` (1) hexes or closer | seen |
| moved, but did not dash | seen from `hide.moved` (2) hexes or closer; in a building (`moved: null`) seen | seen |
| dashed | seen | seen |
| used a revealing action (fired) | seen, until the next round begins to resolve | seen |

The distances are the terrain's (`TerrainDef.hide`); a spotter's `spotting`
is added to them. While a round resolves the posture is what the unit has
done so far in it: everyone is `still` when the round begins, a ready unit
with a dash order is `dashed` from the start of the fire phase, and a unit
is `moved` from its first step. An ambusher must see its target itself, by
this rule, in the light of the round. There is no exception for objectives: a unit in an area is hidden or
seen like any other. Captures and scores are told to everyone and name the
objective, but say nothing of the unit that took it. A mortar may fire at
any hex in range that any friendly unit can see. An action whose sight rule is
`own` may be used only on a hex the unit itself sees: within its `sightOf` and
with a clear line (19; before, the line only, which was the same while every
range was within its unit's sight).

**Actions.** What a unit does under a `fire`, `ambush` or `special` order is
an action: an entry in `ACTIONS` built from a fixed vocabulary (phase, range,
sight, what the target hex needs, who is affected, blast, effects, whether it
gives the user away). The rules know the vocabulary and the four kinds of
effect (`hit`, `recover`, `reveal`, and `build` (25), which acts once on the target hex rather than on the units there:
`ON_HEX` in `src/rules/effects.ts`), never a unit or an action by name.

**Works (25).** The engineer's special, `build` (phase `build`, range 1, minRange 0, sight `none`, needs `any`, mobile),
puts up a work (`WORKS`) on his own hex or a neighbour: `sandbags` (6 supply; cover, no hide, seen and walked through),
`wire` (6; no cover, no hide, seen through, cannot be crossed), `nest` (12; cover, hides a still man from beyond 1 like a
building, a mover is seen, does not block sight). A `special` order or follow-up whose action builds must name a `work`;
the target must be on the map, passable, not water, outside every objective area and without a work (`workProblem`,
`src/rules/works.ts`): `validateOrders` judges that much; that nobody living stands where wire goes, and the supply, are
judged when it lands. Everything that reads terrain (sight, hiding, cover, movement, returns) reads `state.map` and so
sees the work. A man already down may lie on a hex that wire is later put over. Costs: the first guesses (2, 2, 4) were
set when a rifleman's buy-back was 4; scaled with `buyBack` (x 3) so that sandbags or wire cost half a rifleman's buy-back
(about a round of a seat's income) and a nest a whole one (about two), measured below.
- Screens: the Build chit aims at a hex, then the chit row turns into one key per work with its cost ("Sandbags · 6"),
  greyed when the supply left after the draft's buy-backs and other works does not cover it, and wire where a man stands
  or means to end up; 1-3 pick one, Cancel or Escape backs out. The supply readout counts the draft's works. The order
  chit and card name the work ("Build sandbags F3", "Move F3 · Build wire G3"); the log says "Spr. Webb builds MG nest at
  F4 for 12 supply." / "The enemy builds sandbags at F4." / "...: build called off, not enough supply." (or "no room for
  it there."); a hex's description says "F4: sandbags, a work, cover, ...". Preset *Pioneer section* (two engineers, a
  gunner, a medic, four riflemen). Manual lesson *Works* (Units).
- Figures (2026-11-19, `scripts/seeded.ts --figures 900`, which now prints `works_*`, `worksAMatch`, `workSpent`,
  `buildNot_*`, `workCoverHits`, `engineers`): a seat earns 5.9 supply a round (6.1 / 6.9 / 4.8 with 2 / 3 / 4 players);
  1.47 engineers dealt a match (56% of matches have one); works built a match 3.71 (sandbags 1.67, wire 1.04, nest 1.00),
  about 2.5 per engineer, 28 supply a match spent on them against 58 on buy-backs; builds that did not happen 1.0 a match
  (pinned 0.61, down 0.22, blocked 0.10, range 0.08; the script never orders one it cannot pay for); hits taken by a work
  0.38 a match (the script does not seek them out). `npm run bots` builds every work and checks supply, works and the
  map's terrain from each seat's events.

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

**End.** After `maxRounds`, or when fewer than two squads are not out (18; before, "have living units", which is the
same thing in a mode without returns). Highest score (most supply) wins; ties share the win. In a mode whose `win` is
`survival` (20) the winner is found as under *Last Stand* above instead. An eliminated player sees the whole
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
export type WorkId = string;                          // key into WORKS (25)
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
  hide: { still: number; moved: number | null } | null;   // moved: null = a unit that moved here is seen (a building)
  blocksSight: boolean;  // adds 1 to the hex's height for lines passing through
  passable: boolean;
}
// What an action does to each unit it affects. The rules engine has one
// function per kind (src/rules/effects.ts) and knows nothing else about actions.
export type Effect =
  | { kind: 'hit'; ignoresCover?: boolean }    // the hit rule
  | { kind: 'recover' }                        // a pinned unit becomes ready
  | { kind: 'reveal' }                         // the unit counts as having fired
  | { kind: 'build' };                         // (25) the work named by the order goes up on the target hex; acts on the hex
export interface ActionDef {
  id: ActionId; name: string; blurb: string;
  icon: string;                                // UI and kit look-up key
  phase: 'treat' | 'fire' | 'mortar' | 'build';   // when its effects land; 'build' (25): the score phase, before captures
  range: number; minRange: number;             // distance to the target hex
  sight: 'own' | 'squad' | 'none';             // the unit sees the target hex itself (within its sightOf, clear line; 19); any friendly unit sees the hex; no need
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
export type ObjectiveKindId = string;           // key into OBJECTIVE_KINDS (16)
export type ModeId = string;                    // key into MODES (17)
export interface Objective {                    // (16; was { id; hex; value })
  id: string;                                   // 'A'..'Z'
  kind: ObjectiveKindId;
  hexes: Hex[];                                 // the area, at least one hex, in drawing order (row, then column)
  value: number;                                // supply per round to the flag's owner
  zone: number | null;                          // an HQ: the index into `spawns` of its start zone; else null
}
export interface ObjectiveKindDef {             // (16 adds it with zeros; 21 fills the numbers)
  id: ObjectiveKindId; name: string; blurb: string;
  sight: number; move: number; supply: number; rally: boolean;
}
export interface ModeDef {                      // (17)
  id: ModeId; name: string; blurb: string;
  units: UnitTypeId[] | null;                   // unit types allowed; null = all
  supply: boolean;                              // flags earn supply
  returns: { rounds: number; buyBack: number } | null;   // buyBack: multiple of the unit's cost
  win: 'supply' | 'survival';
}
export interface WorkDef { id: WorkId; name: string; blurb: string; cost: number; terrain: TerrainId }   // (25)
export interface GameMap {
  id: string; name: string; cols: number; rows: number;
  cells: Record<HexKey, Cell>;            // a hex with no cell is not on the board (16)
  objectives: Objective[];
  spawns: Hex[][];                        // one zone per HQ, in the order of the HQs' `zone`; 8 hexes each, in placement order
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
  returnRound: number | null;   // (18) round at whose end it is due back; null = not coming back
  dugIn: boolean;               // (24) held still a whole round: ignores one more hit a round, until its first step
}
export interface GameState {
  map: GameMap; playerCount: number; units: Unit[];
  round: number;                // 1-based: the round now being planned
  scores: number[]; eliminated: boolean[];
  flags: Record<string, PlayerId | null>;   // (16) objective id -> owner
  mode: ModeId;                             // (17)
  works: Record<HexKey, WorkId>;            // (25) works built so far; already applied to map.cells (the match's own copy)
  over: boolean; winners: PlayerId[];
  sun: number;                              // (19) the change to every unit's sight in the round being planned
  dawn: number;                             // (19) 0 in round 1 .. 1 from round SUN.length on: (min(round, SUN.length) - 1) / (SUN.length - 1)
}
export interface PlayerView {
  player: PlayerId; map: GameMap; playerCount: number;
  round: number; maxRounds: number;
  units: Unit[];                // own units (all statuses) + visible enemy units
  visible: HexKey[];            // hexes this player can see now
  scores: number[]; eliminated: boolean[];
  flags: Record<string, PlayerId | null>;   // (16) objective id -> owner; public
  mode: ModeId;                             // (17)
  works: Record<HexKey, WorkId>;            // (25) public: a work is ground; map.cells already shows it
  over: boolean; winners: PlayerId[];
  worth?: number[];             // (20) only when a survival match is over: the total cost of each squad's men standing
}

// ---- orders
// What a unit does where its move ends, in the assault phase. Only a `move` carries one.
export type FollowUp =
  | { kind: 'fire'; target: Hex }
  | { kind: 'special'; target: Hex; work?: WorkId };   // (25) work: required when the action builds
export type Order =
  | { unit: UnitId; kind: 'move'; path: Hex[]; then?: FollowUp }   // path excludes the start hex
  | { unit: UnitId; kind: 'dash'; path: Hex[] }
  | { unit: UnitId; kind: 'fire'; target: Hex }
  | { unit: UnitId; kind: 'ambush' }
  | { unit: UnitId; kind: 'special'; target: Hex; work?: WorkId };   // (25) work: required when the action builds
export interface OrderError { unit: UnitId | null; reason: string }
export type Purchase = { kind: 'return'; unit: UnitId };   // (18) never an order: a side list per player

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
  | { t: 'unable'; unit: UnitId; action: ActionId; reason: 'down' | 'pinned' | 'range' | 'sight' | 'needs' | 'supply' | 'blocked' }   // (25) a build's too
  | { t: 'spotted'; unit: Unit }                     // an enemy comes into view
  | { t: 'lost'; unit: UnitId }                      // an enemy leaves view
  | { t: 'recover'; unit: UnitId }
  | { t: 'capture'; objective: string; player: PlayerId; from: PlayerId | null }   // (16) a flag changes hands; told to everyone
  | { t: 'score'; objective: string; player: PlayerId; value: number }             // a flag earns; told to everyone
  | { t: 'purchase'; player: PlayerId; unit: UnitId; cost: number }   // (18) a buy-back paid; told to everyone
  | { t: 'return'; unit: UnitId; at: Hex }                            // (18) owner, and whoever sees `at` after
  | { t: 'dig'; unit: UnitId }                                        // (24) a unit dug in at the round's end; owner, and whoever sees the unit
  | { t: 'build'; unit: UnitId; at: Hex; work: WorkId }               // (25) a work goes up; owner, and whoever sees `at`
  | { t: 'eliminated'; player: PlayerId }
  | { t: 'over'; scores: number[]; winners: PlayerId[] };
```
In a `fire` event, `unit` and `from` are null when the receiving player sees
the target hex but not the shooter. `capture` and `score` events are the same
for every player (flags are public).

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

Task 20 changed this block: `PlayerView` gained `worth` (optional; only a finished survival match).

Task 25 changed this block: `WorkId`, `WorkDef` and the event `build` are new; `Effect` gained `build`, `ActionDef.phase`
gained `'build'`, the `special` order and follow-up gained `work?`, `GameState` and `PlayerView` gained `works`, `unable`
gained the reasons `supply` and `blocked` (and, for a build, is told in the score phase).

Task 24 changed this block: `Unit` gained `dugIn`; the event `dig` is new (`viewFor` shows `dugIn` for every unit it shows, and `spotted` carries it).

Task 17 changed this block: `ModeId`, `ModeDef` are new; `GameState` and `PlayerView` gained `mode`.

Task 18 changed this block: `Unit` gained `returnRound` (the owner's view shows it; a client derives it on a `hit` down
as `round + returns.rounds`, on a `purchase` as `round`); `Purchase` and the events `purchase` and `return` are new. An
enemy's `return` is followed by its `spotted` for a player who sees it.

Task 16 changed this block: `Objective` is an area with a kind and an HQ
`zone`; `ObjectiveKindId`, `ObjectiveKindDef` are new; `GameState` and
`PlayerView` gained `flags`; the event `capture` is new; `score.objective`
is never null again (one `score` per flag that earns, told to everyone).

### Hex maths — `src/shared/hex.ts` (01)

```ts
key(h: Hex): HexKey
parseKey(k: HexKey): Hex
eq(a: Hex, b: Hex): boolean
neighbors(h: Hex): Hex[]                 // 6, fixed order: E, NE, NW, W, SW, SE
distance(a: Hex, b: Hex): number
line(a: Hex, b: Hex): Hex[]              // inclusive; line(a,b) is line(b,a) reversed
within(h: Hex, radius: number): Hex[]    // includes h
rotate(h: Hex, centre: Hex, sixths: number): Hex   // (23) clockwise on screen, 60° a sixth; 2 = (q, r) -> (-q - r, q) about centre
offsetToAxial(col: number, row: number): Hex   // odd-r offset: odd rows shifted right
axialToOffset(h: Hex): { col: number; row: number }
label(h: Hex): string                    // "F4": column letter, row number from 1
hexToPixel(h: Hex, size: number): { x: number; y: number }   // size = circumradius
pixelToHex(x: number, y: number, size: number): Hex
```

### Content — `src/content/index.ts` (02)

```ts
UNITS: Record<UnitTypeId, UnitDef>       // rifleman, gunner, sniper, mortar, medic, engineer (25: Spr., cost 3, max 2, move 2, sight 6, move dash special, special build)
ACTIONS: Record<ActionId, ActionDef>     // rifle, burst, snipe, shell, aid (12), build (25)
WORKS: Record<WorkId, WorkDef>           // (25) sandbags 6, wire 6, nest 12, each with its own terrain
TERRAIN: Record<TerrainId, TerrainDef>   // open, woods, building, crops, wall, water; `hide` says how near a unit there is seen from (12; terrain rework 2026-11-18); sandbags, wire, nest (25: works only, no map character)
OBJECTIVE_KINDS: Record<ObjectiveKindId, ObjectiveKindDef>   // hq, village, hill, crossroads, depot (16); the numbers of *Objective kinds* (21)
MAPS: Record<string, GameMap>            // crossroads: 17 × 13, 15 objective areas (4 HQs W X Y Z), for 4 (15, 16, 22); ford: 13 × 15, 11 areas (2 HQs W X), for 2 (22); 15 rounds each
MODES: Record<ModeId, ModeDef>           // supply-line (default; returns { rounds: 3, buyBack: 6 }, 18; buyBack 4 → 6 by 22), last-stand (17)
DEFAULT_MODE: ModeId                     // 'supply-line' (17)
mapFor(players: number): GameMap         // the map made for exactly that many (spawns.length === players), else the first in MAPS with seatSpawns for that many; throws if none (17; replaces DEFAULT_MAP)
PRESETS: Preset[]                        // line, support, scouts; pioneers (25: two engineers; Supply Line only)
RULES: RulesConfig                       // budget 20, minUnits 4, maxUnits 8 (`stealthRange` removed by 12; budget 16 → 20 by 15)
SUN: number[]                            // (19) [-3, -3, -2, -2, -1, -1, 0]: SUN[i] is the change to sight in round i + 1; later rounds use the last
NAMES: string[]                          // surname pool for unit names
validateSquad(units: UnitTypeId[], mode: ModeId = DEFAULT_MODE): { ok: boolean; cost: number; errors: string[] }   // a unit the mode does not allow is an error: "Last Stand has no mortar." (17)
```

### Rules — `src/rules/index.ts` (03 and 04)

```ts
// 03 — sight
canSee(map: GameMap, from: Hex, to: Hex): boolean         // line only, no range; symmetric
visibleHexes(state: GameState, player: PlayerId): Set<HexKey>
visibleEnemies(state: GameState, player: PlayerId): Unit[]
viewFor(state: GameState, player: PlayerId): PlayerView

// 04 — the game
createMatch(map: GameMap, squads: Squad[], mode: ModeId = DEFAULT_MODE): GameState   // flags: each HQ to the seat on its zone (16); stores `mode`, throws on an unknown mode or a unit it does not allow (17); nothing else reads the mode yet
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
spots(state: GameState, spotter: Unit, target: Unit): boolean   // one unit's own eyes: sightOf, line and stealth (19: took the map before)

// 14 — added; `validateOrders` and `resolve` take the new order shape
followUpOptions(view: PlayerView, unit: UnitId, end: Hex): {    // for the UI: where a move ending on `end` may aim its follow-up
  fire: HexKey[]; special: HexKey[];                            // empty unless the action is `mobile`; range only
}

// 19 — added (src/rules/sight.ts)
sightOf(state: GameState | PlayerView, unit: Unit): number      // max(1, UNITS[type].sight + SUN of state.round) + the held objective's sight (21); the one place a sight range is worked out
sunOf(round: number): number; dawnOf(round: number): number     // what viewFor puts in `sun` and `dawn`

// 18 — added; `resolve` takes purchases (src/rules/supply.ts)
resolve(state, orders: Order[][], purchases?: Purchase[][])     // purchases indexed by player; left out = none
validatePurchases(state: GameState, player: PlayerId, purchases: Purchase[]): OrderError[]   // empty = all may be made
buyBackCost(state: GameState | PlayerView, unit: UnitId): number | null   // null = cannot be bought back now
hqOf(state, player): Objective | null; lineOpen(state, player): boolean   // state: GameState or PlayerView

// 21 — added (src/rules/kinds.ts)
moveOf(state: GameState | PlayerView, unit: Unit): number       // UNITS[type].move + the held objective's move, where the unit stands now
benefitOf(state: GameState | PlayerView, unit: Unit): { objective: Objective; kind: ObjectiveKindDef } | null   // the objective it benefits from, or null
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
  | { t: 'ready'; ready: boolean }                // lobby: needs a squad that is valid in the mode
  | { t: 'mode'; mode: ModeId }                   // lobby: host only; sets the mode, clears every seat's ready (17)
  | { t: 'start' }                                // lobby: host only, 2+ seats, all ready
  | { t: 'orders'; orders: Order[]; purchases?: Purchase[] }   // playing: commit (lever down); purchases (18)
  | { t: 'draft'; orders: Order[]; purchases?: Purchase[] }    // playing: the orders as they stand; does not commit (15)
  | { t: 'recall' }                               // playing: lever up, before resolve
  | { t: 'rematch' };                             // over: host only, back to lobby

export type ServerMsg =
  | { t: 'welcome'; seat: PlayerId; token: string; host: boolean; mapId: string; squad: UnitTypeId[] }
  | { t: 'lobby'; seats: SeatStatus[]; mode: ModeId }   // (17)
  | { t: 'plan'; view: PlayerView; seats: SeatStatus[]; timer: number | null; orders: Order[] | null; purchases: Purchase[] | null }   // what the server holds for this seat this round (15, 18)
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
- **Modes (task 17).** The room holds the mode (default `supply-line`, kept across a rematch). `mode` is refused from
  a non-host, for an unknown id and outside the lobby; otherwise it sets the mode, clears every seat's ready, and a
  `lobby` goes to everyone (a newcomer's `lobby` carries it too). A seat whose squad the new mode does not allow keeps
  it, cannot `ready` (the error names the reason) until it sends a `squad` the mode allows; `squad` and `start` check
  against the mode. At `start` the server uses `mapFor(seats)` and the mode; `welcome.mapId` is the match's map once
  started, else the map `mapFor` gives for the seats so far (for one seat: for two). The log's start line has
  `mode`; a log without one resumes as `supply-line`.
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
- **Purchases (task 18).** Held with the orders under the same rules: `orders` and `draft` are validated with their
  `purchases` together (an `orders` with a bad purchase is `rejected`, the error naming the unit); an invalid draft is
  dropped whole, orders and purchases. `plan.purchases` is what is held (null if nothing). Each round line of the match
  log gains `purchases: Purchase[][]`; resume replays them (a line without them buys nothing).
- **Play screen (task 18).** The score readout is labelled *Supply* and shows what is left after the draft's buy-backs; a
  down man's card says "Back in N", "Back at round's end", "Bought back" or "Cut off", and carries a key "Buy back · N
  supply" when he can be bought back (press again to take it back); the log strip says purchases and returns; the results
  screen says supply.

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
  tile(terrain: TerrainId, elevation: number, hex: Hex, around?: Around): THREE.Object3D;   // (28) around: the six neighbours
  unit(type: UnitTypeId, owner: PlayerId): UnitVisual;
  mark(mark: Mark, ctx: KitCtx): THREE.Object3D;
  objective(obj: Objective, owner: PlayerId | null): THREE.Object3D;   // (16) the area washed amber, a flag in the owner's colour and mark (plain bone for nobody; an HQ's taller)
  fog(): THREE.Material;                                // veil over unseen hexes
  effect?(event: GameEvent, ctx: KitCtx): Promise<void>;   // 07; `capture` (16): the flag turns over to the new owner's colour
  light?(scene: THREE.Scene, dawn: number): void;       // (19) 0 = first light, 1 = full day; environment() is full day
  renderer?(r: THREE.WebGLRenderer): void;              // (26) called once by createBoard, before environment() and the first render: tone mapping, shadow type, exposure
  occupied?(tile: THREE.Object3D, occupied: boolean): void;   // (27) a shown unit stands on this hex, or no longer does; the kit may change the tile
}
type Around = ({ terrain: TerrainId; elevation: number } | null)[];   // (28) in `neighbors()` order (E, NE, NW, W, SW, SE); null = no hex there
interface UnitVisual { object: THREE.Object3D; setStatus(s: UnitStatus): void; setDugIn?(dug: boolean): void }   // (24) a ring of sandbags
interface KitCtx {
  scene: THREE.Scene;
  hexToWorld(hex: Hex): THREE.Vector3;                  // top centre of that hex
  unitObject(id: UnitId): THREE.Object3D | null;
}
```
The board (19) calls `light` with the view's `dawn` on every `setView`, easing from the light shown over about a
second, and at once for the first view; a kit without `light` keeps its environment. The lowpoly kit moves its sun
from low, warm and weaker with a dimmer sky fill (0) to its full-day light (1), in mixes of its own tokens.
An objective's object (16) has its origin at the top centre of the area's first hex; the board lifts any part tagged
`userData.hex` to that hex's height, and asks the kit again with the new owner when a view or a `capture` (playback's
`Stage.flag`) changes a flag.
Dug in (24): the board calls `setDugIn(unit.dugIn && not down)` whenever it shows a unit (a view, `spotted`); playback sets
`dugIn` on a `dig` (after the kit's effect, which raises the ring), and clears it before the effect of a unit's `move` or
`dash`, and on a `hit` that downs him and a `return`. The lowpoly unit is a ring of eleven paper sandbags with ink outlines
(radius 0.7, 0.15 high) beside its pinned burst; `rigOf(...).dig(k)` raises it for the effect. `dig` is a `stand` moment in playback.
Works (25): the board remembers the terrain it drew on each hex and asks the kit for a new tile (keeping its veil) when a
view's cell differs from it, and on a `build` during playback (`Stage.work`, after the kit's effect: dust and a paper
ring); the board is rebuilt (and reframed) only when the map's hexes, heights or objectives change, not its terrain.
The lowpoly kit draws `sandbags` as two courses of paper bags where the wall tile has its stones, `wire` as ink crosses
on ink posts with two strands, `nest` as most of a ring of paper bags with a khaki roof slab on two posts at the back.
The v1 kit lives in `src/client/render/kits/lowpoly/`. An unknown terrain or
unit id returns a plain placeholder, never an error.
Kits (26): `src/client/render/kits/index.ts` has `type KitId = 'lowpoly' | 'diorama'`, `kitFromUrl(search?)` (`?kit=diorama`; anything else is
`lowpoly`) and `makeKit(id)`; the play screen and the manual call `makeKit(kitFromUrl())`, and `dev.html?kit=diorama` passes the query to every frame.
The board calls `kit.renderer?.(renderer)` once, right after it makes its renderer (which asks for `PCFShadowMap`) and before `environment()`.
The diorama kit (`kits/diorama/`, a trial) makes the light and air, `tile('open', ...)` and `unit('rifleman', ...)` itself and asks a `lowpolyKit()` it holds
for everything else, then dresses what comes back for its light (`look.dress`: lit parts take the mist, unlit parts skip tone mapping). Its figure registers a
rig with lowpoly's `setRig`, so lowpoly's effects drive it; lowpoly's `burst` is exported for it. Its grid and labels are paper, not ink.
Second pass (26): the mist is `MIST_LAYERS` sheets (`diorama/look.ts`: 9, or 4 for a coarse pointer) drawn first in the see-through pass, over a thin haze by
height on world materials; every drawn piece is in that pass after them (the kit's own copies of lowpoly's unlit materials: lowpoly's are not changed), so the
mist never covers information. Every unit of the kit, lowpoly's fallbacks too, stands on the diorama's base, whose disc and mark dim with the dawn (hue kept).
Woods and buildings (27): the diorama kit makes `woods` (`diorama/woods.ts`: clump trees and undergrowth, one opaque geometry a hex; `WOODS` is the cost, 7
trees a hex or 5 for a coarse pointer) and `building` (`diorama/buildings.ts`: three kinds by `(q + 2r) mod 3`, so no two neighbours alike; one opaque geometry)
itself, on the ground material's wood floor or yard. A woods hex keeps a lane clear for the man, his mark and the label, and caps its growth so that it does not
hide the mark of a man in the hex behind. Being opaque, both are wholly covered by the board's veil.
Occupied hexes (27, second pass): the board keeps `createOccupancy` (`src/client/render/occupancy.ts`) for a kit that has `occupied`, fed by its own `showUnit`
(place), `hideUnit` (remove) and its wrapper round the kit's `effect` (a `move`: heading); a hex is occupied while a piece the board draws stands on it or is on
its way to it, and the kit is told only on a change. Pieces are the view's units, so an unseen enemy opens nothing. The veil of an unseen hex is copied with the
tile told unoccupied. The diorama's house fills its hex and is a shell and a lid (roof and front walls); `occupied` hides the lid. Its label is on the roof, or
on the ground at the hex's south point when open. `playback.ts` is unchanged.
Neighbours (28): the board keeps what it has drawn in `createTiling(kit)` (`src/client/render/tiling.ts`), which passes every `tile()` its `around` (from the
terrain drawn, not the last view's map) and, on a change of terrain (`retile`: a work), asks again for the hex and its six neighbours; the board keeps each
one's veil and occupied state. Lowpoly ignores `around`. The diorama kit makes `water` (`diorama/water.ts`: 0.14 below the ground, shallows and reeds along
banks; `REEDS`), `crops` (`diorama/crops.ts`: stalks in the map's rows, `ROWS` in `look.ts`, a headland where the field ends; a field and a middle, the middle
hidden by `occupied` while a shown unit stands there; `CROPS`) and `wall` (`diorama/walls.ts`: a bow across the north of the hex, joined to wall and building
neighbours at the hexes' corners). Only the works and the units other than the rifleman still fall back to lowpoly.

### Client UI — `src/client/` (08, used by 09 and 10)

```ts
// net.ts
connect(slot?: string): Net
interface Net {
  send(msg: ClientMsg): void;
  on<T extends ServerMsg['t']>(t: T, cb: (msg: Extract<ServerMsg, { t: T }>) => void): () => void;
  onStatus(cb: (online: boolean) => void): void;
}
// The seat token is kept in localStorage under `dawn-company-token-${slot}`.
// `slot` comes from the `?slot=` URL parameter, default "default".

// ui/components.ts — each returns an HTMLElement; state is set by attribute or method
panel, chit, key, lever, lamp, readout, unitCard, stepper, report

// ui/screens/*.ts
interface Screen { mount(root: HTMLElement, app: App): () => void }   // returns unmount
interface App { net: Net; seat: PlayerId; host: boolean; data?: unknown; go(screen: 'lobby' | 'play' | 'results', data?: unknown): void }
```
Task 17: the lobby has a Mode panel above the builder (the host: one key per mode with its blurb; others: the chosen
mode's name and blurb), presets the mode does not allow are hidden, the roster greys out (`barred`) a unit the mode
does not allow with the reason (`rosterRow(squad, id, mode)`, `barredReason`), and the play header shows the mode's name
and the results panel is labelled with it.
`go(screen, data)` stores `data` on `app.data` before mounting, so a screen
can read the message that caused it to mount (added by task 08).
CSS tokens and component classes come from `docs/design/stylesheet.html`,
ported to `src/client/ui/kit.css`.

## v2 — Supply Line, Last Stand, the battlefield (tasks 16–25)

Pinned here before any of it is built. A task copies its part into its own doc, builds it, then folds it into the
v1 sections above (types block, Rules, Content, Rules API, Protocol, Kit) and ticks its box. Numbers are first
guesses, in `src/content`, tuned by playing.

### Rules

**Objectives are areas (16).** An objective is one or more hexes with a kind (`hq`, `village`, `hill`,
`crossroads`, `depot`) and a `value`. Every objective has a **flag**: a player or nobody. Flags are public: every
player sees every flag. At the start, each HQ's flag belongs to the seat whose start zone it is (an HQ whose zone
no seat uses starts with nobody's flag); every other flag starts with nobody.

**The score phase (5) becomes, in this order:**
1. **Build** (25): works ordered this round are built.
2. **Capture** (16): for each objective, the players who have at least one *ready* unit standing in its area. If
   exactly one, the flag becomes theirs (a `capture` event if it changed hands). If none or several, it stays
   as it was. The flags of a player who has been eliminated go to nobody.
3. **Supply** (16; switched by mode in 17/20): each flag's owner scores the objective's `value` (plus its kind's
   `supply`, 21). `scores` **is** supply: there is one currency.
4. **Purchases** (18): buy-backs paid this round, in the order given.
5. **Returns** (18): downed units due back come back at their HQ.
6. **Dig in** (24): units that held still the whole round are dug in.
7. **Recover, eliminate, end** as before, with the mode's win rule (17, 18, 20).

**Modes (17).** Chosen by the host in the lobby; the map follows from the number of players.
- **Supply Line** (`supply-line`, the default): flags earn supply; a downed unit returns at its HQ 3 rounds after
  it went down, if its owner holds that HQ's flag (otherwise it waits until they do); a down unit may be bought
  back for six times its unit cost (`buyBack: 6`, set by 22 from income measured on the maps of 22: two to three rounds of a
  seat's income for a rifleman; 18 had set 4, first guess was 2), and then returns
  at the end of the round it was paid for; most supply at the end wins. A squad is eliminated when it has no living units and none that can come back (its HQ flag is not its
  own, or nobody is waiting to return).
- **Last Stand** (`last-stand`, 20): no supply, down is final, no mortar. `scores` counts living units, updated
  every score phase. The match ends after `maxRounds` or when at most one squad has living units; most living
  units wins, then the greater total unit cost of them; ties share.

**The sun (19).** A unit's sight in round `r` is `UNITS[type].sight + SUN[min(r, SUN.length) - 1]`, at least 1
(plus its objective's `sight`, 21). Ranges of actions do not change. `SUN = [-3, -3, -2, -2, -1, -1, 0]`.

**Objective kinds (21).** What owning a flag gives the owner's units standing in its area, as data:
| Kind | sight | move | supply | rally |
|---|---|---|---|---|
| hq | 0 | 0 | 0 | false |
| village | 0 | 0 | 1 | false |
| hill | +2 | 0 | 0 | false |
| crossroads | 0 | +1 (units that begin the round in the area) | 0 | false |
| depot | 0 | 0 | 2 | true (a pinned unit in the area recovers at this round's end) |

**Dig in (24).** A living unit that did not move or dash in a round (any posture `still` at the end of it) is
**dug in** from the end of that round until its first step. A dug-in unit ignores one more hit each round than its
ground gives (a building or wall: the first two; open ground: the first). A hit that ignores cover ignores both.
*Built (24).* Not dug in at the start of a match; digs in at the end of round 1 if still. Played: the manual's *Dig in* lesson (Shooting),
the play screen's card ("Dug in"), hex description, order line and Move/Dash tooltip, the report's one "Dug in: ..." line a round.
Figures (2026-11-19, `scripts/seeded.ts --figures 900`, which now prints `digsAMatch`, `dugPerRound`, `dugShare`, `coverHits`, `foxholeHits`): about 45% of
the men standing at a round's start are dug in (8.7 a round), 74 `dig` events a match; men going down a match 13.92 -> 12.57 (-10%), at the end 2.57 -> 2.38
(before = the same script with the digging switched off); of the hits turned aside by cover or a foxhole (17.5 a match), 13.3 fell on a man who was dug in at the round's start.
Not retuned.

**Works (25).** An engineer's special `build` puts a work on its own hex or a neighbour: `sandbags` (cover, like a
wall), `wire` (cannot be crossed), `nest` (cover, and hides a still unit like a building). A work is terrain: it
replaces the hex's terrain in the match's copy of the map, for everyone, for the rest of the match. It costs
supply, paid when it is built in the score phase; not enough supply, a unit or a work already there (wire, which
cannot be stood in), water, or an objective area → `unable`. *Built (25)*: see *Works* in the v1 Rules above.

### Interfaces

```ts
// ---- src/shared/types.ts
export type ObjectiveKindId = string;           // key into OBJECTIVE_KINDS (16)
export type ModeId = string;                    // key into MODES (17)
export type WorkId = string;                    // key into WORKS (25)

export interface Objective {                    // replaces { id; hex; value } (16)
  id: string;                                   // 'A'..'Z'
  kind: ObjectiveKindId;
  hexes: Hex[];                                 // the area, at least one hex, in drawing order (row, then column)
  value: number;                                // supply per round to the flag's owner
  zone: number | null;                          // an HQ: the index into `spawns` of its start zone; else null
}
// GameMap: unchanged fields, but `spawns` has one zone per HQ, in the order of the HQs' `zone`, and a map may
// leave hexes out (no cell). `seatSpawns` stays: player count -> zone per seat.

export interface ObjectiveKindDef {             // (16 adds the type with zeros; 21 fills the numbers)
  id: ObjectiveKindId; name: string; blurb: string;
  sight: number; move: number; supply: number; rally: boolean;
}
export interface ModeDef {                      // (17)
  id: ModeId; name: string; blurb: string;
  units: UnitTypeId[] | null;                   // unit types allowed; null = all
  supply: boolean;                              // flags earn supply
  returns: { rounds: number; buyBack: number } | null;   // buyBack: multiple of the unit's cost
  win: 'supply' | 'survival';
}
export interface WorkDef { id: WorkId; name: string; blurb: string; cost: number; terrain: TerrainId }   // (25)

// Unit gains:
  returnRound: number | null;                   // (18) round at whose end it is due back; null = not coming back
  dugIn: boolean;                               // (24)
// GameState gains:
  mode: ModeId;                                 // (17)
  flags: Record<string, PlayerId | null>;       // (16) objective id -> owner
  works: Record<HexKey, WorkId>;                // (25) also already applied to state.map.cells
// PlayerView gains: mode (17), flags (16), sun: number (19, the change to sight this round),
//   dawn: number (19, 0 at the first round of SUN .. 1 at its last), works (25).

export type Purchase = { kind: 'return'; unit: UnitId };   // (18) never an order: a side list per player

// Effect gains (25):   | { kind: 'build' }      the work comes from the order
// ActionDef.phase gains (25): 'build'           lands in the score phase, step 1
// The `special` order and the `special` FollowUp gain (25):  work?: WorkId

// Events gain:
  | { t: 'capture'; objective: string; player: PlayerId; from: PlayerId | null }   // (16) told to everyone
  | { t: 'purchase'; player: PlayerId; unit: UnitId; cost: number }              // (18) told to everyone
  | { t: 'return'; unit: UnitId; at: Hex }                                       // (18) owner, and whoever sees `at` after
  | { t: 'dig'; unit: UnitId }                                                   // (24) whoever sees the unit
  | { t: 'build'; unit: UnitId; at: Hex; work: WorkId }                          // (25) owner, and whoever sees `at`
// `score` (16): `objective` is always named (flags are public); one event per flag that earns.
// `unable.reason` gains 'supply' and 'blocked' (25).
```

```ts
// ---- src/content/index.ts
OBJECTIVE_KINDS: Record<ObjectiveKindId, ObjectiveKindDef>   // hq, village, hill, crossroads, depot (16, 21)
MODES: Record<ModeId, ModeDef>; DEFAULT_MODE: ModeId          // supply-line, last-stand (17)
mapFor(players: number): GameMap   // the map made for exactly that many (spawns.length === players), else the first that seats them (17)
SUN: number[]                                                // (19)
WORKS: Record<WorkId, WorkDef>                               // sandbags, wire, nest (25); TERRAIN gains their terrains
validateSquad(units, mode?: ModeId)                          // also: a unit the mode does not allow is an error (17)
// UNITS gains engineer (25); ACTIONS gains build (25)

// ---- src/rules/index.ts
createMatch(map, squads, mode: ModeId = DEFAULT_MODE): GameState                      // (17)
resolve(state, orders: Order[][], purchases?: Purchase[][]): { state; events; playerEvents }   // (18)
validatePurchases(state, player, purchases: Purchase[]): OrderError[]               // (18)
buyBackCost(state, unit: UnitId): number | null                                     // (18) null = cannot be bought back now
sightOf(state: GameState | PlayerView, unit: Unit): number                         // (19, built: widened to a view as moveOf is; kinds 21)
moveOf(state: GameState | PlayerView, unit: Unit): number                           // (21)
```

```ts
// ---- src/shared/protocol.ts
ClientMsg | { t: 'mode'; mode: ModeId }                 // (17) lobby, host only; clears every seat's ready
ClientMsg 'orders' and 'draft' gain  purchases?: Purchase[]          // (18)
ServerMsg 'lobby' gains  mode: ModeId                   // (17)
ServerMsg 'plan' gains  purchases: Purchase[] | null    // (18) what the server holds, like `orders`
// The match log's start record gains `mode`; a log without one resumes as supply-line (17). Each round's record
// gains the purchases that ran (18).

// ---- src/client/render/kit.ts
objective(obj: Objective, owner: PlayerId | null): THREE.Object3D   // (16) the area outlined, a flag in the owner's colour
light?(scene: THREE.Scene, dawn: number): void                       // (19) 0 = first light, 1 = full day
UnitVisual.setDugIn?(dug: boolean): void                             // (24)
tile(...) is asked again for a hex whose terrain a work changed      // (25; built: `retile` in the board, `Stage.work`)
```

### Map drawing (16, built)
`readMap` and the manual's `tinyMap` share `readAreas` (`src/content/mapFormat.ts`).
`readMap` takes `{ id, name, terrain, elevation, marks, objectives, maxRounds, seatSpawns }` where `objectives`
is `Record<id, { kind; value }>` (replacing `objectiveValues`). In `terrain`, `x` is a hex that is not on the
board (`.` or `x` in the other layers there). In `marks`, a letter on several hexes is one objective's area; an
`hq` objective is a start zone's HQ; a digit 1–8 is a spawn hex of the zone whose HQ area is nearest (a tie is an
error), in placement order; zones are numbered by their HQs in letter order. The tiny maps of the manual
(`src/manual/lesson.ts`) follow the same marks.

## Open items (not blocking)
- All numbers are first guesses; tune after task 10.
- Deferred units: sergeant/radio, sapper, off-map assets.
- `crossroads` (17 × 13, task 15, refitted by 22) is a mirror image north-south and east-west as well as under a half
  turn, so the four start zones are the same hex for hex (a test pins the steps to the centre, to the nearest 2 and to the
  nearest 1), but for six hexes: under a half turn the last hex of every second row (Q2, Q4, … Q12) has no partner, and
  is plain open ground (the test says so). A rectangle of hexes cannot do better. `ford` leaves its unpaired hexes (the
  first of every second row) off the board instead.
- **Seat fairness on the maps of 22** (`npx tsx scripts/seeded.ts --figures 900 [--same line]`, 300 matches a player
  count, 2026-11-19; figures on `eval/22-two-player-map-and-four-player-refit.html`). The script now heads for an
  objective by walking steps, ties at random (a beeline with ties in list order before). `ford`, two players, random
  squads: seat 0 (W) +3.0 ± 2.7 points against the other (mean about 68, so ±4%), win share 0.51 / 0.49; with the Line
  section for both, +0.7 ± 2.6 — within noise (on the old `crossroads` it was ±13). `crossroads`, four players: every
  seat within 2.3 points of the others' mean (about 45), win shares 0.21–0.29 with random squads and 0.21–0.28 with
  the Line section; none further from level than 1.3 standard errors. Three players on `crossroads` are still not fair
  (zone 1, opposite the empty corner: −22 points, 0.16 of the wins); task 23's triangle is the fix.
- **Three-seat fairness on `tripoint`, re-measured by task 23** (`npx tsx scripts/seeded.ts --figures 1800 [--same line]`,
  the 600 three-player matches, 2026-11-19; figures on `eval/23-three-player-triangle.html`). Random squads: mean supply
  71.4 / 74.1 / 69.9 (W / X / Y), against the other two −0.7 ± 1.8 / +3.5 ± 1.8 / −2.9 ± 1.8, win shares 0.33 / 0.35 /
  0.32; the Line section for all: +2.2 / −2.9 / +0.7 (± 1.8), win shares 0.37 / 0.30 / 0.33. A fair third each within
  the noise: no seat further than two standard errors, and the seat ahead changes with the squads. Per match 2.6 units
  down at the end, 13.9 times a man went down, 12.0 captures. A seat earns 6.5 supply a round there (4.9 on `crossroads`
  for three), so a rifleman's buy-back (12) is 1.85 rounds of income, under the two to three rounds 22 aimed at;
  `buyBack` was left at 6 for play to judge.
- **Sight is not exactly the same under `tripoint`'s turn**: `line` breaks a tie (a line along hex edges) with a fixed
  nudge, so 172 of the 9180 hex pairs see differently from the pair turned a third of a turn on (all an even distance
  apart; pinned in `src/rules/sight.test.ts`). `line` was left as it is.
- **The camera on a map that is not a rectangle (23)**: the board keeps the middle of the screen within a hex of the
  map (`keepOverMap` in `src/client/render/index.ts`) as well as the old per-axis limits, so a zoomed-in camera cannot
  be dragged into an empty corner of the triangle's bounding box.
- **Edge villages on `ford` are seldom held by the script** (held 0.21 of flag-rounds, nobody's at the end 0.66): its
  men head for a random objective each round and so hang about the middle; real players who send a section down a lane
  will hold them. Whether the edge lanes are worth walking is for play to show.
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
- `dev.html` is served by Vite only; it is not in the build. The client's
  `auto` and `name` URL parameters work only for slots starting with `dev`
  (`src/client/dev.ts`).
