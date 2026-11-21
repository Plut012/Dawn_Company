# 29 — Diorama: the rest of the squad

## Overview
The diorama kit (26–28) draws its own rifleman; the other five unit types
still fall back to lowpoly's blocky figures, and next to the rifleman they now
clash more than anything on the board. This task gives the kit all five:
`gunner`, `sniper`, `mortar`, `medic`, `engineer`. Nothing else.

Read first: `docs/tasks/26-diorama-trial.md` (the direction, the drawn layer,
the bases dimming with dawn), `src/client/render/kits/diorama/units.ts` and
`sculpt.ts` (the rifleman as built), `src/client/render/kit.ts` (`UnitVisual`,
`setStatus`, `setDugIn`), lowpoly's `unit()` in `kits/lowpoly/units.ts` (each
type's silhouette and what the rigs drive), `src/content/units.ts` and
`src/content/actions.ts` (what each unit does), `docs/design.md` (marks, palette).
Depends on: 28.

## The work
`unit(type, owner)` for the five types, as painted-miniature figures of the
same set as the rifleman: same scale, the same base (player colour and mark
shape, inked, dimming with dawn), the same paint and light response.

- **Each type reads at board scale by silhouette alone**, at dawn 0 in the
  mist and on a phone, before you read anything else:
  - **gunner** — a man behind a light machine gun on a bipod (a Bren or MG-style
    gun, kept generic), belly-down or kneeling; the gun's length is the read.
  - **sniper** — a prone or kneeling man with a long scoped rifle, scrim or
    camouflage on helmet and shoulders; low and lean.
  - **mortar** — a crew of two on one base: a tube on its baseplate and bipod,
    one man at the tube, one with a round or ammo case.
  - **medic** — no rifle; a satchel or two, and a white armband or helmet
    marking with a red cross *small and muted* (Rust and player colours must
    stay the loudest reds on the board; check it).
  - **engineer** — no rifle; a shovel or pick over the shoulder, a coil of wire
    or sandbag on his back.
- **One army per player is not this task:** both players' figures share the
  uniform, as the rifleman does; the base tells them apart.
- **States**, as the rifleman: ready stands (or lies, for prone types);
  pinned crouches flatter, with lowpoly's rust burst; down lies flat, faded;
  `setDugIn` gives the same scrape and sandbags. The rigs lowpoly's effects
  drive must still work, or fall back gracefully: check playback of a move, a
  fire (burst, snipe, shell), an aid and a build with each type.
- **Sight-line rule** holds: nothing on a figure hides the base or mark of the
  man in the hex behind; a figure stays on its base.
- Seeded detail only (no `Math.random`), code-authored geometry and materials,
  no new dependencies; merge per figure, draw calls per unit low. Anything
  costly behind a constant with a phone setting.
- Lowpoly stays unchanged (byte-identical stills).

**Tests.** No diorama unit type falls back to lowpoly any more; each type
gives a figure with a base and responds to `setStatus` and `setDugIn`; an
unknown type still gives a placeholder; `npm test` and `npm run typecheck` pass.

## Eval page — `eval/29-diorama-units.html`
Built on the real `createBoard`, like 26–28:
- **A line-up**: all six types for both players, ready, pinned, down and dug
  in, on open ground, woods and crops, one inside an open house.
- **Side by side** with lowpoly; the dawn slider (0, 0.5, 1); the phone frame;
  playback (each type does its thing: move, fire, aid, build).
- **Stills** in `eval/assets/29/`: the line-up at dawn 0, 0.5, 1, desktop and
  phone; a close-up of each type at dawn 1; the mortar firing and the medic
  aiding mid-playback; a lowpoly still for comparison. Look at them yourself
  and iterate until every type reads by silhouette at phone size.
- An honest **notes** section.

## Not this
Works, effects, terrain, the UI, `docs/design.md`. No change to rules, server,
content or protocol. Do not commit.
