# Dawn Squad — Vision & Architecture

## Vision

### The problem
Tactical wargames are either slow at a table (rulebooks, downtime while others
move, no real hidden information) or built for solo/online play. There is
nothing you can start on one laptop and have four friends in the same room
playing two minutes later, each on their own screen.

### What it is
A simultaneous-turn tactical skirmish for **2–4 players in one room**. One
laptop hosts; everyone joins from a browser on a laptop or phone. Each player
commands a small WW2-era squad. Inspirations: Squad Leader, Undaunted, XCOM —
with Go's ideal of few rules and deep consequences.

### Pillars
1. **Simultaneous orders.** Each round every player secretly gives each unit
   one order; all orders then resolve at once. No downtime, and the tension is
   reading the other players.
2. **Fog of war.** You see only what your units see. Terrain (hills,
   buildings, woods) blocks sight, so stealth and positioning matter.
3. **Zero dice.** Outcomes are deterministic. Fire reliably suppresses; kills
   come from catching a unit exposed, pinned, or flanked. Conflicts in
   simultaneous resolution (e.g. two units entering one tile) are settled by a
   fixed, visible rule. Uncertainty comes from opponents, never from chance.
4. **Elegantly clear options.** Every unit has the same four orders —
   **move, dash, fire, ambush** — plus **one** trait or special that defines
   it. That is the whole menu.
5. **Emergent realism.** Fire lanes, suppression, flanking, and combined arms
   arise from the interaction of sight, cover, and the four orders — not from
   a rule written for each.

### The match
- **Build:** each player spends a fixed point budget on a squad of roughly
  4–8 units (and, later, off-map assets). Takes a couple of minutes; nothing
  persists between matches. Preset squads let a newcomer hit "ready" at once.
- **Play:** rounds of plan → resolve → watch the playback.
- **Win:** objectives score points each round and are worth more toward the
  centre of the map, pulling squads into contact. A wiped squad is out, but
  its score stays on the board and can still place. Highest score at the end
  wins.
- **Length:** 30–45 minutes.

### Units (starting roster)
Each unit earns its place by breaking exactly one rule.

| Unit | Its one thing |
|---|---|
| Rifleman | The baseline; cheap, no special |
| Machine gunner | Suppresses an area, not a single target |
| Mortar | Fires without line of sight, but needs a friendly spotter |
| Sniper | Engages beyond normal sight range |
| Sergeant / radio | Shares sight with the squad; calls off-map assets |
| Medic | Recovers pinned or downed units |
| Engineer / sapper | Changes terrain (breach, obstruct) |

All seven are designed on paper; v1 ships the subset that proves the core.
Units and assets (artillery, airstrikes) are **data with a point cost**, so
new ones are added without touching the engine.

### What it deliberately isn't
- No AI opponents.
- No internet play, accounts, or matchmaking — same room, same network.
- No campaign, progression, or persistence between matches.
- No historical simulation; WW2 is the flavour, not a rivet count.
- No dice in v1. If playtests feel too chess-like, one small bounded source
  of variance may be added later.

### Done and delightful
Four friends, one wifi, playing within two minutes of opening a URL. A match
fits in a lunch break. The story told afterwards is about a decision — "I
*knew* you'd come through the orchard, so I put the MG on ambush" — and never
about a roll.

---

## Architecture

### Shape
One TypeScript codebase, four independent parts. The rules know nothing about
networks or pixels; the server knows nothing about three.js; the client is
never sent anything its player shouldn't see.

```
content (data) ──► rules (pure) ◄── server (authoritative) ◄─ws─► client
                                                                 ├─ ui (DOM)
                                                                 └─ render (three.js)
```

### Components

**`rules`** — the game, as pure functions. No I/O, no clock, no randomness.
- `resolve(state, orders) → { state, events }` — one round.
- `viewFor(state, player) → view` and the same filter for events — fog of war
  lives here, in one place.
- `validate(state, player, orders)` — what a player may legally order.
- Fully unit-testable; a whole match can be replayed from its order log.

**`content`** — data only: unit definitions, asset definitions, maps, preset
squads. Adding a unit means adding an entry, not engine code.

**`server`** — a small Node process on the host laptop.
- Serves the client, runs the lobby and seats, collects orders, calls
  `rules`, and sends each player *their* view and *their* events.
- Holds the only copy of the full state, in memory. Appends the order log to
  a file so a crashed or restarted match can be resumed.
- Prints the LAN URL and a QR code on start. Players reconnect to their seat
  with a token kept in the browser.

**`client`** — runs in any modern browser, two halves with a narrow seam:
- **`render`** — three.js. Takes a view plus the round's events and draws the
  board and plays back the resolution. Knows nothing about orders or sockets.
  Inside `render`, *what to draw* is separate from *how it looks*. The scene
  code asks a **visual kit** for things by id and never builds a mesh itself:
  - **tile kit** — terrain id + elevation → a hex tile
  - **unit kit** — unit id + state (ready, pinned, down) → a figure
  - **effect kit** — event type → an animation
  - **tokens** — the palette and line weights from `docs/design.md`

  v1 ships one simple low-poly kit. Better tiles, units or effects later are
  a new kit (or one replaced entry), with no change to rules, server, `ui`,
  or the scene code. An id the kit doesn't know falls back to a plain
  placeholder, so new content never breaks the board.
- **`ui`** — plain DOM over the canvas: lobby, squad builder, order menu,
  score. Touch-first so it works on a phone; mouse is the easy case.

### Data flow (one round)
1. Server sends each client its view. Phase: **plan**.
2. Player assigns orders in `ui`; client submits them. Server validates.
3. When all players are ready (or the plan timer expires), server runs
   `resolve`.
4. Server sends each client its filtered events and new view.
5. `render` plays back the events; then back to step 1.

### Tech choices
| Choice | Reason |
|---|---|
| TypeScript everywhere | One language; client and server share the rules types |
| Node + `ws` | Smallest thing that serves files and holds sockets on a LAN |
| Server-authoritative, filtered views | Fog of war can't be broken by peeking at the client |
| three.js | Chosen for visuals; 3D makes hills, buildings and sight lines legible |
| Code-authored visuals | All geometry, materials and effects are written procedurally with Fable 5.2 — no imported art pipeline |
| Plain DOM for UI | The UI is a few panels; a framework would outweigh it |
| Vite | Boring, fast client build and dev server |
| Vitest | Rules are pure functions, so tests are cheap and thorough |
| Hex grid with per-hex elevation and terrain | Wargame standard; clean distance, facing and line of sight |
| No database | Nothing persists; an order-log file covers crash recovery |

### Constraints that shape everything
- **Phones are first-class.** Maps stay small, the camera is a tilted
  top-down view with pan and pinch-zoom, and every order is reachable by tap.
  Readability beats spectacle.
- **Determinism is a feature of the code, not just the design.** Same state
  plus same orders always yields the same result, on any machine.
- **Looks are replaceable.** Rules and content name things by id only
  (`woods`, `mortar`); maps are plain data (terrain and elevation per hex).
  Tiles, units, effects and maps can each be improved on their own.
- **Solo testing means several tabs.** With no AI, the server must make it
  trivial for one person to occupy every seat.

### Left open for later docs
- The exact resolution order within a round and the tie-break rules.
- Numbers: ranges, costs, budget, map size, round count.
- Which units ship in v1.
- Visual direction — next step, `/design`.
