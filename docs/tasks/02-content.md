# 02 — Content

## Overview
Everything the game is *made of*, as data: the five units, the three
terrains, one map, preset squads, and the squad-building limits. No game
logic lives here except checking that a squad is legal. Adding a unit or a
map later must be a new entry in this folder and nothing else.

Read first: `docs/vision.md`, `docs/tasks/00-plan.md` (Rules, Interfaces).
Depends on: 01 (`src/shared/types.ts`, `src/shared/hex.ts`).

## The work

Create `src/content/` with one file per kind of thing and an `index.ts` that
exports exactly:

```ts
UNITS: Record<UnitTypeId, UnitDef>       // rifleman, gunner, sniper, mortar, medic
TERRAIN: Record<TerrainId, TerrainDef>   // open, woods, building
MAPS: Record<string, GameMap>            // crossroads
DEFAULT_MAP: string                      // "crossroads"
PRESETS: Preset[]
RULES: RulesConfig
NAMES: string[]                          // at least 40 surnames
validateSquad(units: UnitTypeId[]): { ok: boolean; cost: number; errors: string[] }
```
The types are already in `src/shared/types.ts`.

**Terrain**

| id | cover | blocksSight | passable |
|---|---|---|---|
| open | no | no | yes |
| woods | yes | yes | yes |
| building | yes | yes | yes |

**Units** — starting numbers, to be tuned later.

| id | rank | cost | max | move | sight | range | minRange | blast | ignoresCover | indirect | orders | special |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rifleman | Pvt. | 2 | – | 2 | 6 | 4 | 1 | 0 | no | no | move, dash, fire, ambush | – |
| gunner | Cpl. | 4 | 2 | 1 | 6 | 5 | 1 | 1 | no | no | move, fire, ambush | – |
| sniper | Pvt. | 4 | 1 | 2 | 8 | 8 | 2 | 0 | yes | no | move, dash, fire, ambush | – |
| mortar | Cpl. | 4 | 1 | 1 | 5 | 10 | 3 | 1 | no | yes | move, fire | – |
| medic | Pvt. | 2 | 2 | 2 | 6 | 0 | 0 | 0 | no | no | move, dash, special | treat |

Each gets a one-line `blurb` in the game's voice (dry, factual; see the
Realness dial in `docs/design.md`).

**Rules config:** `budget` 16, `minUnits` 4, `maxUnits` 8, `stealthRange` 2.

**`validateSquad`:** every id exists; count within min and max; total cost
within budget; no type over its `max`. Returns the total cost and a list of
plain-language errors.

**Presets:** three legal squads, each with a name and blurb, e.g. a balanced
one, a fire-support one, and a fast one.

**Map: `crossroads`**
- 13 columns × 11 rows, authored as rows of characters in odd-r offset
  layout and converted with `offsetToAxial`. Keep the authoring format
  readable so a person can edit a map by hand.
- All three terrains and elevations 0–2 are used. A hill near the centre,
  woods and buildings giving covered approaches from every corner.
- **Symmetric under a half turn** about the centre hex, so opposite seats
  are equal.
- Objectives: one at the centre worth 3, two inner ones worth 2, four outer
  ones worth 1 (one nearer each corner). Ids are letters.
- `spawns`: four zones (corners), 8 hexes each, all passable, in placement
  order (first hex is nearest the centre). Zone 2 is zone 0 turned half a
  turn; zone 3 is zone 1 turned.
- `seatSpawns`: `{ 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] }`.
- `maxRounds`: 12.

**Tests:** every unit and preset passes its own checks; `validateSquad`
rejects each kind of illegal squad; the map has a cell for every column and
row, is half-turn symmetric in terrain, elevation, objectives and spawns;
spawn hexes are passable, distinct, and not objectives.

## Out of scope
Line of sight, order handling, anything visual beyond the eval page.
Sergeant, sapper and off-map assets.

## Eval page — `eval/02-content.html`
Opened at `http://localhost:5173/eval/02-content.html`. Reads the real
exports:
- The map drawn flat in 2D: terrain by colour, elevation by stepped tint,
  objectives with id and value, the four spawn zones numbered in order.
- A table of all units generated from `UNITS`.
- The presets, each with its cost from `validateSquad`.
- A small squad picker (plus/minus per unit type) showing the live
  `validateSquad` result, including its error messages.
