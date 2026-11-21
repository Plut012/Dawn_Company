# 28 — Diorama: water, crops and walls

## Overview
The diorama kit (26, 27) draws its own grass, woods, houses and rifleman; water,
crops and low walls still fall back to lowpoly's flat pieces and clash with
the rest. This task gives the kit those three tiles. All three read better when
a tile knows its neighbours (a wall runs to the next wall, a field ends at its
edge), so the board starts telling a tile what is around it.

Read first: `docs/tasks/26-diorama-trial.md` and `docs/tasks/27-diorama-woods-and-buildings.md`
(the direction, the light and mist, the drawn layer, the sight-line rule, the
`occupied` hook), `src/client/render/kits/diorama/` as built, `src/client/render/kit.ts`,
`src/client/render/index.ts` (`buildMap`, `retile`, `makeVeil`), lowpoly's
`crops`, `wall` and `water` in `kits/lowpoly/tiles.ts`, `src/content/terrain.ts`
(what each terrain does in the rules), and the maps in `src/content/maps.ts`
(how walls ring the hamlets, how streams and rivers run, where the fords are).
Depends on: 27.

## The work

**1. Neighbours** (the only interface change; put it in `src/client/render/kit.ts`
and the Visual kit block of `docs/tasks/00-plan.md`):
```ts
tile(terrain: TerrainId, elevation: number, hex: Hex, around?: Around): THREE.Object3D;
// (28) Around: the six neighbours, in `neighbors()` order (E, NE, NW, W, SW, SE); null = no hex there
type Around = ({ terrain: TerrainId; elevation: number } | null)[];
```
- The board passes `around` from the match's map wherever it asks for a tile.
- When a hex's terrain changes (a work, through `retile`), the board also
  re-asks its six neighbours, keeping their veils and `occupied` state as
  `retile` already does.
- Lowpoly ignores the argument and looks exactly as before (check a lowpoly
  still against the committed one).

**2. Water** — `tile('water', elevation, hex, around)`:
- Dark, still, cold water; a faint reflection of the sky the kit already has;
  a little below the ground's top, so that land next to it shows its earth
  side as a bank and a run of water hexes reads as one stream or pond, with no
  seam between water hexes.
- Banks may soften where water meets land (reeds, mud, a stone or two), using
  `around`; nothing on the water crowds a hex that matters.
- The mist lies thickest over water at dawn 0 (it already pools in low ground;
  check it reads).
- Water is never entered, so it has no man to keep clear; the hex label and grid stay.

**3. Crops** — `tile('crops', elevation, hex, around)`:
- A June wheat field in Normandy: green going to gold, dense, in rows. Rows
  are laid out in world space (one direction for the whole map, or per field),
  so a field of several hexes reads as one field; it ends at its edge with a
  headland or a trodden margin where `around` says the next hex is not crops.
- A man in crops is hidden in the rules (`hide.still` 1, `moved` 2): he should
  look *in the corn*, stalks round him to the knee or waist, the middle
  thinned so his base and mark read plainly, and nothing on the south side
  tall enough to hide them. The sight-line rule of 27 holds (nothing hides the
  mark of a man in the hex behind).
- Cheap: crops cover large areas. One geometry per hex (or instancing), a
  count constant with a phone setting, like `WOODS`.

**4. Walls** — `tile('wall', elevation, hex, around)` (a low wall: cover, no hide):
- A Normandy dry-stone wall, low, mossy, uneven stones. It runs from near
  the hex's centre towards each neighbour that is a wall or a building, so the
  rings round the hamlets join up and leave gaps where the map does. With no
  such neighbour it stands as a short length across the hex.
- A man stands in the hex behind it: keep the wall to the edges and the
  north, low enough (as lowpoly's, about 0.2 to 0.26 high) that it never hides
  his base or mark; the hex's open ground is the diorama grass.
- Walls that meet a building hex meet its house's wall, not a gap.

**For all three:** seeded by the hex key (no `Math.random`); code-authored
geometry and materials only, no new dependencies; the grid line and hex label
stay; an unseen hex reads as *unknown* under the veil, as the others do; draw
calls per hex stay low; anything costly behind a constant with a phone
setting.

**Tests.** `around` reaches the kit with the right neighbours (order, edges of
the map, `null` off the map); a work's `retile` re-asks the neighbours;
lowpoly gives the same tile with or without `around`; same hex and
neighbours give the same tile; a wall's runs follow its wall and building
neighbours; crops and water no longer come from lowpoly. `npm test` and
`npm run typecheck` pass.

## Eval page — `eval/28-diorama-water-crops-walls.html`
Built on the real `createBoard`, like 26 and 27:
- **A scene**: a stream of several water hexes winding past a ford (open
  ground or crops between water hexes), a field of crops of at least six hexes,
  a hamlet of two houses ringed by low walls with two gaps, riflemen standing
  in the crops, behind a wall and on the ford, a gunner (fallback), some of it
  unseen. Or use a real map's corner (`crossroads` has walled hamlets and a
  stream with fords) if it shows all three better.
- **Side by side** with lowpoly; the dawn slider (0, 0.5, 1); the phone frame;
  playback (a rifleman walks through the field and is hit behind a wall).
- **Stills** in `eval/assets/28/`: dawn 0, 0.5, 1 at desktop and phone size;
  close-ups of the stream at dawn 0, the field with a man in it at dawn 1, the
  walled hamlet at dawn 1; a lowpoly still for comparison. Look at them yourself
  and iterate.
- An honest **notes** section.

## Not this
Works (sandbags, wire, nest), units other than the rifleman, effects, the UI,
`docs/design.md`. No change to rules, server, content or protocol. Do not commit.
