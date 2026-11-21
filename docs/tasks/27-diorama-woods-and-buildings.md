# 27 — Diorama: woods and buildings

## Overview
Task 26 approved the diorama direction: *the world is real, the information is
drawn*. Its grass, rifleman and dark misty dawn now sit beside lowpoly's flat,
ink-outlined trees and paper houses, and the clash is the weakest part of
every picture. This task gives the diorama kit its own `woods` and `building`
tiles, and nothing else.

Read first: `docs/tasks/26-diorama-trial.md` (the direction, the light, the
mist, the drawn layer, the second pass), `src/client/render/kits/diorama/`
(the kit as built: `look.ts` for materials, mist and dawn; `tiles.ts` for the
open tile; `noise.ts` for seeded streams), `src/client/render/kit.ts`,
`src/client/render/index.ts` (`makeVeil`: how a veil copies a tile's solid
meshes), lowpoly's `woods` and `building` in `kits/lowpoly/tiles.ts` (where
trees and the house stand, and why), `eval/26-diorama-trial.html`.
Depends on: 26.

## The work

**Woods** — `tile('woods', elevation, hex)`, elevation 0, 1 and 2.
- A believable Normandy wood on a wargame table: a mix of broadleaf trees
  (oak, beech) with the odd conifer; trunks, layered crowns, some undergrowth;
  a dark forest floor of leaf litter and moss that runs on into the open
  ground's look at the hex edge.
- Several woods hexes side by side read as **one wood**, not as islands of
  trees: crowns overlap the hex edges a little, and nothing marks the edge
  but the grid line.
- The middle of the hex stays clear for a unit, as lowpoly keeps it. The
  camera looks from the south, tilted down; trees on the south rim stay low
  or sparse so they never hide the base of a man standing in the hex. A man in
  woods should look tucked in among trunks, with his base and mark plain.
- The crowns stand above the mist; the mist lies among the trunks at dawn 0.
- Shadows: the trees cast them, but a shadow must never hide a hex.

**Buildings** — `tile('building', elevation, hex)`, elevation 0, 1 and 2.
- A Normandy farmhouse or barn: rough stone or weathered render walls,
  slate or old tile roof, a chimney, shutters, a door; two or three variants
  chosen by the hex (size, roof, a lean-to), and weathering (stains, moss on
  the roof, chipped corners).
- As in lowpoly, it stands at the back (north) of the hex, so a unit there
  stands in front of it, base and mark plain. It must not grow so tall that it
  hides the hex behind it.
- Two buildings side by side (a hamlet) must look like neighbours, not twins.

**For both:**
- Everything seeded by the hex key (no `Math.random`); code-authored geometry
  and materials only; no image or model files; no new dependencies.
  Procedural textures made in code are fine, as in 26.
- The grid line and the stencilled hex label stay, as on the open tile.
- **The fog-of-war veil** must cover an unseen woods or building hex so it
  reads as *unknown*, as it does on open ground. `makeVeil` copies only
  opaque, front-faced meshes: if leaves are cut-out or see-through, make sure
  the veiled hex still reads as unseen (and say how).
- **Cost.** Merge or instance per tile; keep draw calls per hex low. Put any
  costly count (trees per hex, leaf cards) behind a constant with a phone
  setting, as `MIST_LAYERS` does.
- Everything else still falls back to lowpoly.

**Tests.** Same hex, same tile (woods and building); woods and building no
longer come from lowpoly; a veiled woods hex and a veiled building hex each
get at least one veil mesh; `npm test` and `npm run typecheck` pass.

## Eval page — `eval/27-diorama-woods-and-buildings.html`
Built on the real `createBoard`, like 26:
- **A scene** with a wood of at least five hexes (some at elevation 1), a
  hamlet of two buildings with open ground between them, riflemen standing in
  the wood and in front of a house, a gunner (fallback) beside them, some of the
  wood and one house unseen (veiled), and one objective on the hamlet.
- **Side by side** with lowpoly; the dawn slider with 0, 0.5 and 1; the phone
  frame; playback (a rifleman walks out of the wood and is hit).
- **Stills** in `eval/assets/27/`: dawn 0, 0.5 and 1 at desktop and phone size,
  a close-up of a man in the wood at dawn 0, a close-up of the hamlet at
  dawn 1, and a veiled wood. Look at them yourself and iterate.
- An honest **notes** section.

## Second pass: houses that open when a man is seen inside (2026-11-21)

The first pass's houses read as a roof strip behind a man (the man's base
covers the hex in front of the house). Decided with the user: **a whole house
on the hex, whose roof and front wall lift off — a clean cut-away, as a
wargame table's buildings have lift-off roofs — while a unit the board shows
stands in it.**

**The hook** (the only interface change; add it to `src/client/render/kit.ts`
and to the Visual kit block of `docs/tasks/00-plan.md`):
```ts
occupied?(tile: THREE.Object3D, occupied: boolean): void;   // (27) a shown unit stands on this hex, or no longer does; the kit may change the tile
```
- The board calls it whenever the set of shown units on a hex changes, from
  false to true or back: on `setView` (after units are placed), and during
  `play` when a unit's piece arrives on or leaves a hex (`move`, `blocked`
  fall-backs, `spotted`, `lost`, `return`, a hit that downs him: a down man
  still shown still counts). Not repeated when nothing changed.
- "Shown" means a unit piece the board is drawing. The board only has the
  player's view, so an enemy the player cannot see never opens a house; own
  units always count.
- A kit without the hook is unaffected (lowpoly). A veiled hex never has a
  shown unit, so it is always closed; make sure a veil made from a tile
  copies the closed house (the roof and front wall), whatever the tile's state
  when the veil is first made.

**The diorama building tile:**
- **Closed** (no shown unit): a whole house that fills the hex on Option C's
  footprint — walls round the rim of the hex, gabled and taller at the back,
  a roof over all. Keep the three kinds and their variety (stone farmhouse
  under slate, rendered barn under tile, cottage with a lean-to), the
  weathering, and the sight-line rule (nothing hides the base or mark of a man
  in the hex behind).
- **Open** (a shown unit inside): the roof and the front (south) walls are
  gone, cut down to a clean sill a little above the floor; the back and side
  walls stand. Inside: a plain floor (boards or flags) and the inner faces of
  the walls, perhaps an inner wall stub or a fireplace on the back wall —
  nothing that crowds the middle. The man stands at the centre on the usual
  base, framed by the walls. A cut-away, not a ruin: no rubble or shell damage.
- The change may be instant, or a short lift (about a quarter second) if it
  costs little; the board draws on demand outside playback, so an animation
  outside `play` must ask for frames itself or not exist.
- The building hex's label goes back where it reads best with the new layout.

**Also:** fix the stale text in `eval/26-diorama-trial.html`, which still says
woods and buildings fall back to lowpoly.

**Tests:** the board calls `occupied` on a view with a unit in a building
and again when he walks out (a `move` in `play`); it is not called for a hex
where only an unseen enemy stands; the diorama building tile changes between
the two states and back; a veil of an opened house still covers the closed
shape. `npm test` and `npm run typecheck` pass.

**Eval:** update `eval/27-diorama-woods-and-buildings.html`: the hamlet with
one house occupied (open), one empty (closed), one with an enemy the viewer
cannot see inside (closed); playback where a man walks into a house (it opens)
and another walks out of one (it closes). New stills: the hamlet at dawn 0 and
dawn 1, close up, and at board scale; keep the first pass's hamlet stills as
`*-pass1.png`. Update the notes.

## Not this
Crops, walls, water, works, other units, effects, the UI, `docs/design.md`.
No change to rules, server, content or protocol; no change to lowpoly beyond a
needed export. Do not commit.
