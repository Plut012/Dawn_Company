# 17 — Modes and a map per player count

## Overview
A match is played in a **mode**, chosen by the host in the lobby: **Supply
Line** (the default) or **Last Stand**. A mode is data: which units it
allows, whether flags earn supply, whether downed units return, and how the
winner is decided. This task adds the data, the lobby choice, the match
setting and the map choice by number of players. The rules switches
themselves arrive in 18 (returns) and 20 (Last Stand); here a mode only
restricts the squad builder.

Read first: `docs/vision.md` (*Modes*); `docs/tasks/00-plan.md` (*v2*,
Protocol, Client UI); `src/content/`, `src/rules/match.ts`, `src/server/match.ts`,
`src/shared/protocol.ts`, `src/client/ui/screens/lobby.ts`, `src/client/ui/squad.ts`.
Depends on: 16.

## The work

**Types and content**, verbatim:
```ts
export type ModeId = string;                    // key into MODES
export interface ModeDef {
  id: ModeId; name: string; blurb: string;
  units: UnitTypeId[] | null;                   // unit types allowed; null = all
  supply: boolean;                              // flags earn supply
  returns: { rounds: number; buyBack: number } | null;   // buyBack: multiple of the unit's cost
  win: 'supply' | 'survival';
}
// GameState gains: mode: ModeId     PlayerView gains: mode: ModeId
```
`src/content/modes.ts`, exported from `index.ts`:
```ts
MODES = {
  'supply-line': { id: 'supply-line', name: 'Supply Line',
    blurb: "Hold ground, earn supply, bring your men back. Lose your HQ and you're on your own.",
    units: null, supply: true, returns: { rounds: 3, buyBack: 2 }, win: 'supply' },
  'last-stand': { id: 'last-stand', name: 'Last Stand',
    blurb: 'No one comes back. Ground gives you an edge; only survivors win.',
    units: ['rifleman', 'gunner', 'sniper', 'medic'], supply: false, returns: null, win: 'survival' },
}
DEFAULT_MODE = 'supply-line'
```
(When task 25 adds the engineer it stays out of Last Stand by this list.)
- `validateSquad(units, mode = DEFAULT_MODE)`: a unit type the mode does not
  allow is an error ("Last Stand has no mortar.").
- `mapFor(players: number): GameMap`: the map in `MAPS` made for exactly that
  many players (`spawns.length === players`), else the first in `MAPS` whose
  `seatSpawns` has that count; throws if none. Until 22 and 23 add maps, that
  is `crossroads` for 2, 3 and 4. `DEFAULT_MAP` goes; callers use `mapFor`.
- Each preset is checked against each mode: the lobby offers only presets the
  chosen mode allows (Last Stand needs at least one; add a preset without a
  mortar if none qualifies).

**Rules.** `createMatch(map, squads, mode: ModeId = DEFAULT_MODE)` stores
`mode`; throws on an unknown mode or a squad the mode does not allow.
`viewFor` copies it. Nothing else in the rules reads it yet.

**Protocol and server**, verbatim:
```ts
ClientMsg | { t: 'mode'; mode: ModeId }     // lobby, host only; clears every seat's ready
ServerMsg 'lobby' gains  mode: ModeId
```
- The lobby holds the mode (default `supply-line`, kept across a rematch).
  The host's `mode` message sets it and clears every seat's ready; a seat
  whose squad the new mode does not allow keeps its squad but cannot ready
  until it changes it. `start` refuses a squad the mode does not allow.
- At `start` the server uses `mapFor(seats)` and the mode. `welcome.mapId`
  is the map the match uses once it has started, and until then the map
  `mapFor` gives for the seats so far.
- The match log's start record gains `mode`; a log without one resumes as
  `supply-line`.

**Lobby.** The host sees the two modes as two keys with their names and
blurbs above the squad builder; other players see the chosen mode's name and
blurb. The builder greys out units the mode does not allow, with the reason.
The play and results screens show the mode's name in the header.

**Scripts and tests.** `scripts/bots.ts` and `scripts/seeded.ts` take a mode
(`--mode last-stand`), default supply-line. Tests: `mapFor`, `validateSquad`
per mode, the `mode` message (host only, clears ready, blocks start for a
squad not allowed), resume of an old log. Digests should not move (the mode
changes nothing in resolution yet); if they do, say why.

## Out of scope
Returns and buy-back (18). Last Stand's win rule and supply switch (20). New
maps (22, 23). A map picker: the map is never chosen by hand.

## Docs and checks
- Fold this task's parts of *v2* into the v1 sections of
  `docs/tasks/00-plan.md` (types, Content, Rules API, Protocol, Client UI); tick 17.
- `npm test`, `npm run typecheck`, `npm run build`,
  `npm run bots -- --matches 100` and `npm run bots -- --matches 100 --mode last-stand` pass.

## Eval page — `eval/17-modes-and-map-per-player-count.html`
Needs the game server on a spare port (say how; never stop one on 8080).
- Two real clients side by side in the lobby: the host switches mode, the
  other client's lobby follows, ready lamps clear, and a squad with a mortar
  cannot ready in Last Stand.
- `mapFor(2)`, `mapFor(3)`, `mapFor(4)` called live, with the map each returns.
- Anything that does not work, stated plainly.
