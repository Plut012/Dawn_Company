# Dawn Company — Vision & Architecture

## Vision

### The problem
Tactical wargames are either slow at a table (rulebooks, downtime while others
move, no real hidden information) or built for solo/online play. There is
nothing you can start on one laptop and have four friends in the same room
playing two minutes later, each on their own screen.

### What it is
A simultaneous-turn tactical skirmish for **2–4 players in one room**. One
laptop hosts; everyone joins from a browser on a laptop or phone. Each player
commands a small WW2-era squad from a fortified base, fighting over ground
that matters. Inspirations: Squad Leader, Undaunted, XCOM for the tactics;
League, Dota and Age of Empires for the clarity of a base, a goal and a map
read at a glance — with Go's ideal of few rules and deep consequences.

**Realistic in cause, MOBA in clarity.** Rules come from how small-unit
combat really works: suppression, observation, digging in, flanking, holding
ground. The look, the goal and the map shapes are as readable as a MOBA.

### Pillars
1. **Simultaneous orders.** Each round every player secretly gives each unit
   one order; all orders then resolve at once. No downtime, and the tension is
   reading the other players.
2. **Fog of war.** You see only what your units see. Terrain blocks sight,
   so stealth and positioning matter. **The sun rises during the match:**
   sight grows round by round, so the opening favours infiltration and the
   end favours firepower — and nobody can hide forever.
3. **No dice on outcomes.** A shot, a hit, a capture are deterministic.
   Uncertainty comes from opponents and fog. Chance may one day *set the
   stage* — revealed before anyone decides — but never decides a shot.
4. **Elegantly clear options.** Every unit has the same four orders —
   **move, dash, fire, ambush** — plus **one** trait or special that defines
   it. That is the whole menu. New systems change what the orders *do*, not
   how many there are.
5. **Many ways to win.** The game must support distinct playstyles, each
   with a counter, and none dominant: **assault** (mass and speed),
   **infiltration** (stealth and flanks), **fortress** (dig in and hold),
   **fire support** (machine gun and mortar), **control** (spread out and
   hold many objectives). Every rule change is checked against this list.

### The battlefield
- **A base.** Each player starts at a fortified **HQ**: a strong building, a
  wall line, a field of fire. The HQ is itself an objective; it can be
  captured and retaken.
- **Objectives are ground, not hexes.** An objective is a small area — a
  village, a hilltop, a crossroads. A side **captures** it by being the only
  side inside it at the end of a round; its **flag** goes up for everyone to
  see, and stays up after the side leaves, until someone else captures it.
- **Each kind of objective gives something,** as that ground did in real war:

  | Objective | Gives |
  |---|---|
  | Hill / observation post | Sees further; spots for mortars |
  | Crossroads / bridge | Controls movement across the map |
  | Depot | Supplies the side that holds it |
  | Village | Strong defensive ground |

- **Fortification.** A unit that holds still for a full round is **dug in**
  and harder to hurt until it moves. Engineers **build works** — sandbags,
  wire, an MG nest — which become part of the map for whoever holds them.
- **Weather belongs to a map:** a foggy river crossing and a clear ridge are
  different maps, not a roll.

### Modes
The same maps and units, two ways to fight. A mode is chosen in the lobby.

**Supply Line** *(first)* — Hold ground, earn supply, bring your men back.
Lose your HQ and you're on your own.
- Every held objective earns **supply** each round. Supply is the one
  currency *and* the score: most supply at the end of the last round wins.
- A downed unit **returns at its HQ** after a few rounds; supply buys it back
  sooner. Supply also pays for works. Spending is an investment against your
  score.
- Your squad never grows beyond what you drafted. A death costs **tempo**,
  not identity.
- Losing your HQ cuts the line: nobody returns until you retake it.

**Last Stand** — No one comes back. Ground gives you an edge; only survivors
win.
- Deaths are permanent. Objectives give their advantages only; there is no
  supply.
- Pure small-arms firefight: a mode lists the units it allows, and Last Stand
  starts without the mortar.
- The last squad standing wins. If the rounds run out, most units standing
  wins, then the most points' worth of them.

### The match
- **Build:** each player spends a fixed point budget on a squad of roughly
  4–8 units. Takes a couple of minutes; nothing persists between matches.
  Preset squads let a newcomer hit "ready" at once.
- **Play:** rounds of plan → resolve → watch the playback.
- **Maps:** one per player count to start — 2, 3 and 4 player free-for-all —
  each fair by symmetry (the 3-player map is a triangle). Lanes, cover between
  them and a contested centre, as a MOBA map reads.
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
| Medic | Gets pinned units back up |
| Engineer / sapper | Builds works (sandbags, wire, MG nest) |

Units, objectives, works and modes are **data**, so new ones are added
without touching the engine.

### Later, by design
- **Asymmetric scenarios:** 1v1 and 2v2 with sides — attacker and defender —
  as new maps that define their own start points and given units.
- **Forward posts:** engineers build a post where returning units arrive.
- **Off-map assets:** smoke, a fire mission — bought with supply.
- **A subtle source of chance,** revealed before players decide.

### What it deliberately isn't
- No AI opponents.
- No internet play, accounts, or matchmaking — same room, same network.
- No campaign, progression, or persistence between matches.
- No unit production. You command the squad you drafted; supply brings men
  *back*, never more of them.
- No rivet counting: realistic in cause and effect, not in detail.

### Done and delightful
Four friends, one wifi, playing within two minutes of opening a URL. A match
fits in a lunch break. Everyone knows where their base is and what they're
fighting for from the first round. The stories afterwards are about
decisions and ground — "I let you have the village, then took your HQ while
you dug in" — and never about a roll.

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
- The game state carries everything a match changes: the mode, each
  objective's flag, each side's supply, units waiting to return (and when),
  who is dug in, and the works built. The map itself stays fixed data; works
  are a layer on top of it.
- A mode's rules are switches in data (returns on or off, supply on or off,
  how the winner is decided), not branches per mode name.

**`content`** — data only: units, actions, terrain, works, objective kinds,
modes, the sun's sight curve, maps and preset squads. Adding a unit, a work,
an objective kind or a mode means adding an entry, not engine code.
- A **map** declares the player count it is for, an HQ per start zone, its
  objectives as areas of hexes with a kind, and its weather.

**`server`** — a small Node process on the host laptop.
- Serves the client, runs the lobby and seats, collects orders, calls
  `rules`, and sends each player *their* view and *their* events.
- The lobby picks the mode; the map follows from the number of players.
- Holds the only copy of the full state, in memory. Appends the order log to
  a file so a crashed or restarted match can be resumed.
- Prints the LAN URL and a QR code on start. Players reconnect to their seat
  with a token kept in the browser.

**`client`** — runs in any modern browser, two halves with a narrow seam:
- **`render`** — three.js. Takes a view plus the round's events and draws the
  board and plays back the resolution. Knows nothing about orders or sockets.
  Inside `render`, *what to draw* is separate from *how it looks*. The scene
  code asks a **visual kit** for things by id and never builds a mesh itself:
  - **tile kit** — terrain id + elevation → a hex tile; work id → a work
  - **unit kit** — unit id + state (ready, pinned, dug in, down) → a figure
  - **effect kit** — event type → an animation
  - **tokens** — the palette, line weights and the light for each stage of
    dawn, from `docs/design.md`

  Better tiles, units or effects later are a new kit (or one replaced entry),
  with no change to rules, server, `ui`, or the scene code. An id the kit
  doesn't know falls back to a plain placeholder, so new content never breaks
  the board.
- **`ui`** — plain DOM over the canvas: lobby (with mode), squad builder,
  order menu, flags and supply. Touch-first so it works on a phone; mouse is
  the easy case.

### Data flow (one round)
1. Server sends each client its view. Phase: **plan**.
2. Player assigns unit orders in `ui` — and, in Supply Line, any purchases
  (buying a unit back). Purchases are a short side list per player, never a
  fifth order. Client submits them. Server validates.
3. When all players are ready (or the plan timer expires), server runs
   `resolve`. The round ends with captures, supply and returns.
4. Server sends each client its filtered events and new view.
5. `render` plays back the events; then back to step 1.

### Tech choices
| Choice | Reason |
|---|---|
| TypeScript everywhere | One language; client and server share the rules types |
| Node + `ws` | Smallest thing that serves files and holds sockets on a LAN |
| Server-authoritative, filtered views | Fog of war can't be broken by peeking at the client |
| three.js | 3D makes hills, buildings, sight lines and the dawn legible |
| Code-authored visuals | All geometry, materials and effects are written procedurally — no imported art pipeline |
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
  plus same orders always yields the same result, on any machine. Any future
  chance is a seed in the state, rolled before players decide.
- **Looks are replaceable.** Rules and content name things by id only
  (`woods`, `mortar`, `sandbags`); maps are plain data. Tiles, units,
  effects and maps can each be improved on their own.
- **Solo testing means several tabs.** With no AI, the server must make it
  trivial for one person to occupy every seat.

### Left open for later docs
- Numbers: the sun's curve, supply per objective, return time, buy-back and
  work costs, objective area sizes, dug-in protection.
- What each objective kind gives in each mode, exactly (the depot in Last
  Stand especially).
- How a work is built: one round or several, and what each work does.
- The three map layouts, and the HQ's shape.
- Visual direction for flags, works, the HQ and the dawn — next step,
  `/design`.
