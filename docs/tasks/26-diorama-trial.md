# 26 — Diorama trial: one rifleman, one grass tile, the dark dawn

## Overview
A trial of a new visual direction, as a second visual kit beside `lowpoly`. It
builds two pieces and the light they sit in, so we can judge the direction
before committing to it. Nothing outside `src/client/render/` changes, apart from
the two lines that pick the kit and the eval page.

**The direction, in one line:** *the world is real, the information is drawn.*
- **The world is real**: a miniature wargame table photographed at first light.
  Physically based materials with procedural detail (damp grass, worn earth),
  tone-mapped light, height fog lying in low ground, believable shadows.
  Grounded, grim and dark at the start; not cartoon, not photoreal humans
  either: a well-painted miniature.
- **The information is drawn**: everything that carries game meaning stays
  graphic, crisp and inked, in the palette of `docs/design.md`: the unit's base
  with its player colour and mark shape, the selection ring, planned orders,
  targets, objective washes and discs, hex grid and labels, and the fog-of-war
  veil. These must pop against the muted world.
- **The light tells the match** (`dawn` 0 → 1, rounds 1 → 7):
  - 0 — blue-black, almost moonlit; thick milky ground fog; a stealth-mission start.
  - ~0.5 — grey, the fog lifting off high ground first.
  - 1 — a low sun breaking through, cold-warm, long shadows. Still grim, never cheerful.

Read first: `src/client/render/kit.ts` (the kit contract), `src/client/render/index.ts`
(how the board uses a kit: on-demand drawing, veils, `light` easing),
`src/client/render/kits/lowpoly/` (the current kit: `index.ts`, `tiles.ts`,
`units.ts`, `parts.ts`), `docs/design.md` (palette roles, player marks, map-mark
meanings — these stay fixed), `eval/19-rising-sun.html` and `eval/24-dig-in.html`
(eval page style).
Depends on: 25.

## The work

**1. Kit selection** — `src/client/render/kits/index.ts`:
```ts
export type KitId = 'lowpoly' | 'diorama';
export function kitFromUrl(search?: string): KitId   // `?kit=diorama`; anything else (or none) = 'lowpoly'
export function makeKit(id: KitId): VisualKit
```
`src/client/ui/screens/play.ts` and `manual.ts` call `makeKit(kitFromUrl())` where
they now call `lowpolyKit()`. `loadKitFonts` stays where it is. Check that
`dev.html`'s frames pass `?kit=` through to the game (a query on `dev.html`
should reach every frame); if not, make it.

**2. One optional hook on `VisualKit`** (the only interface change; add it to
`src/client/render/kit.ts` and to the Visual kit block of `docs/tasks/00-plan.md`):
```ts
renderer?(r: THREE.WebGLRenderer): void;   // (26) called once by createBoard, before the first render: tone mapping, shadow type, exposure
```
`lowpoly` does not implement it, and so looks exactly as it does now. While
there, `createBoard` asks for `THREE.PCFShadowMap` directly (r187 warns that
`PCFSoftShadowMap` is gone) — an open item in the plan; remove it from there.

**3. The diorama kit** — `src/client/render/kits/diorama/`, `dioramaKit(): VisualKit`.
It replaces exactly three things and hands everything else to a `lowpolyKit()`
it holds (by delegation, per call; never copy lowpoly code):
- **`environment`, `light`, `renderer`, `fog`** — the light and atmosphere above.
  Tone mapping (ACES or AgX), exposure, sky/fill and sun follow `dawn`. Height
  fog that pools in low ground and thins with dawn (a shader chunk on the
  diorama materials, or layered sheets — your choice; say why). The board draws
  **on demand**, not every frame: the look must be right as a still frame, with
  no idle animation.
- **`tile('open', elevation, hex)`** for elevation 0, 1 and 2 — realistic grass
  ground: varied colour, damp and worn patches, some short grass or tufts,
  stepped hill sides that read as earth and turf. Detail is seeded by the hex
  key, so the same hex looks the same on every screen and every reload (no
  `Math.random` in the kit). Keep the information layer on it: the 1 px ink hex
  grid and the stencilled hex label, as lowpoly draws them, readable at dawn 0.
  Every other terrain falls back to lowpoly.
- **`unit('rifleman', owner)`** — a realistic WW2 rifleman, a painted-miniature
  figure (wool tunic, webbing, steel helmet, rifle), on a **graphic base** that
  carries the player colour and mark shape, inked (reuse lowpoly's `PLAYERS`
  and mark outlines). `setStatus`: ready stands; pinned crouches, with lowpoly's
  rust burst; down lies flat, faded as lowpoly fades it. `setDugIn`: a scrape of
  earth and sandbags round him. Other unit types fall back to lowpoly. The
  rigs lowpoly's effects drive (`rigOf` in `units.ts`) must still work on the
  new figure, or the effect must fall back gracefully — check playback of a
  move, a hit and a dig with the diorama rifleman.

All geometry and materials are written in code: no image files, no model files,
no new npm dependencies (three's own `examples/jsm` addons are fine).
Procedural textures made in code (canvas, `DataTexture`, shader noise) are fine.

**Fixed, whatever the kit:** Amber means selection and objectives, Rust means
danger; a player is shown by colour *and* shape; the fog-of-war veil must never
be confused with the atmospheric fog — unseen hexes read as *unknown*
(darker, desaturated, hard hex edge), mist reads as *weather* (soft, milky, low).

**Phones.** It must run on a phone. Keep the shadow map and the fog cheap; if
something is costly, put it behind one constant and say which.

**4. Tests.** `kitFromUrl` and `makeKit`; the diorama kit gives a placeholder,
never an error, for an unknown terrain or unit id; it delegates `woods` and
`gunner` to lowpoly; the same hex gives the same open tile twice (same
geometry/attributes). `npm test` and `npm run typecheck` pass.

## Eval page — `eval/26-diorama-trial.html`
A gallery, built on the real `createBoard`, both kits and real views:
- **Side by side**: the same small scene drawn by `lowpoly` (left) and `diorama`
  (right). The scene: a hand-made `GameMap` of about 7 × 5 hexes (open ground at
  elevation 0, 1 and 2, plus a few woods, a building, water and crops to show
  the fallback), riflemen of two players in each state (ready, pinned, down, dug
  in) and a gunner (fallback), a selection ring, a planned path and a target
  mark, one objective, and a few hexes left unseen (veiled). Build the state
  with `createMatch` and `viewFor`, adjusted by hand where needed.
- **A dawn slider** (0 to 1) driving both boards, with buttons for 0, 0.5 and 1.
- **A phone frame** toggle: both boards at 844 × 390.
- **Playback**: a button that plays a short round on both (a rifleman moves, is
  hit and pinned, another digs in), using `board.play`.
- **Screenshots**: stills of the diorama board at dawn 0, 0.5 and 1, desktop and
  phone size, saved in `eval/assets/26/` and shown on the page. A headless
  Chrome is at `~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`
  (try `--use-angle=swiftshader --enable-unsafe-swiftshader --screenshot=... --window-size=...`
  against the Vite dev server). **Look at your own screenshots** and iterate
  until round 1 is dark and foggy yet the base marks, grid and labels read.
- How to see it in a real match: `npm run dev` + `npm run server`, then
  `http://localhost:5173/dev.html?kit=diorama`.
- An honest **notes** section: what you judged, what you could not (real phone,
  frame rate), what fell short of the direction and what you would do next.

## Second pass (2026-11-21, after the first stills were approved in direction)

**1. The mist becomes air.** The first pass tints surfaces by height; it reads as
blue haze, not fog. Wanted: soft, milky, low-lying fog that sits *in the air*:
- pooled in low ground (elevation 0 and water), thinner on level 1, the hilltop
  (level 2) rising clear out of it;
- it lies in front of the figures and fallback pieces, so a man in the low
  ground is half-swallowed: you see that someone is there, his outline soft;
- it breaks up irregularly (banks and gaps, seeded by the map, deterministic),
  never a uniform sheet, and it never shows a straight edge where it meets a
  hillside or the board's edge;
- by dawn: thick at 0, lifting off the high ground first around 0.5, wisps in
  the hollows at 1;
- correct as a still frame (the board draws on demand; no idle animation).

The drawn layer stays above it: bases, marks, grid, labels, veil, objective
discs and effects are never fogged, so the information always reads even when
the man is swallowed. The fog-of-war veil and the mist must still never be
confused. Technique is yours (instanced soft sprites or slabs lying low, a
depth-aware screen pass, or both); say why. Cost behind one constant, with a
cheap setting for phones.

**2. The bases calm down at first light.** At dawn 0 the unlit player bases are
the brightest thing in the picture. Dim them with the dawn (keep the hue: the
player colour and mark shape must stay clearly readable at phone size; the
selection ring and rust burst are not dimmed: Amber and Rust must still be the
loudest things). Also make the fallback gunner's base match the rifleman's
(same light response), so the two bases look like one set.

**Eval.** Update `eval/26-diorama-trial.html` and the stills in `eval/assets/26/`
(keep the first-pass stills as `*-pass1.png` for comparison and show both on the
page). Add a still of a rifleman standing in the low-ground mist at dawn 0,
close up. Update the notes.

## Not this
Other terrains, other units, works, objectives, effects, the UI, `docs/design.md`
(rewritten only once the direction is approved). No change to rules, server,
content or protocol. Do not commit.
