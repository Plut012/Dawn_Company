# Dawn Company — Design Direction

Source of truth for every screen. The live reference is
`docs/design/stylesheet.html` (tokens as CSS custom properties, every
component in every state). If this doc and the style sheet disagree, the
style sheet wins and this doc gets fixed.

**In one line:** Squad Leader's printed military map, drawn in Undaunted's
flat inked colour, operated through a field kit. Mostly realistic; the vibe
comes from dawn light, not stylised shapes.

## Dials
- **Realness: mostly grave, with a soldier's dry humour at the edges.** The
  map and the fight are sober; wry notes live only in text outside the fight.
  - Lobby: "Waiting on 2 more. Kettle's on."
  - Squad builder: "Mortar team — 3 pts. Needs someone to tell it where."
  - Play: "Pvt. Hale pinned at F4." (flat and factual; no jokes mid-fight)
  - Results: "Objective C held to the last round. Barely."
- **Cartoon: 2 of 5.** Grounded proportions, muted colour, flat fills, clean
  ink outlines. No textures.

## Tokens

**Palette** — flat colour; cold ground, warm light, one accent.

| Name | Hex | Role |
|---|---|---|
| Ink | `#1E2420` | Outlines, text, frames, inset panels |
| Paper | `#E9DFC6` | Text on dark, chits, cards, buildings, low walls |
| Khaki | `#B7A77A` | Open ground, keys, secondary surfaces |
| Olive | `#5E6B45` | Woods, kit panels |
| Slate | `#3D4F5C` | Page background, dawn shadow, fog of war, water |
| Rust | `#9A4B32` | Danger only: pinned, down, under fire, alerts |
| **Amber** | `#E8A23A` | The accent: selection, active order, objectives, sunlight |

- **Terrain tints:** hill level 1 `#C6B88E`, level 2 `#D5C9A4` (paler =
  higher). Terrain only; never in the UI.
- **Player marks** — colour *and* shape, always together: blue `#3F6E8C` bar,
  plum `#6B4E7A` chevron, teal `#2F7F78` diamond, bone `#E9DFC6` disc. Never
  red or amber.

**Type** — both faces bundled in `docs/design/fonts/` (SIL OFL); no network.
- Display: **Stardos Stencil** — labels, headings, numerals. Uppercase,
  letter-spacing 0.06–0.12em.
- Text: **Courier Prime** — names, reports, descriptions.
- Scale: 12, 14, 18, 24, 36 px.

**Spacing:** 4, 8, 16, 32 px.

**Linework** — all Ink. Frames 3 px, component outlines 2 px, dividers 1 px.
Corner radius 2 px maximum. Depth is a hard offset shadow (3–4 px Ink), never
a blur.

**Ornament**
- Yes: stencilled panel labels; a screw in each top corner of a panel;
  grease-pencil strokes in Amber for planned orders on the map.
- No: anything decorative over the map view; gradients; soft shadows;
  roundels (the objective marker is the one exception).

## Components
The UI is a field kit: each part is a piece of equipment, and its state is
shown by the part itself.

| Component | What it is | States |
|---|---|---|
| Panel | Olive plate, ink frame, stencil label, corner screws | plain · inset (Ink, for readouts and lamps) |
| Order chit | 72 px cardboard square: icon + label | idle · selected (Amber, lifted) · issued (Khaki, pressed, tick) · disabled |
| Key | Push button for secondary actions | idle · pressed (Amber, sunk) · disabled |
| Ready lever | Two-position lever that commits the round's orders | up (planning) · down (ready, Amber) · locked (resolving) |
| Lamp | One status light per player | planning (Paper) · ready (Amber) · disconnected (Rust, blinking) · out (dark, struck through) |
| Readout | Stencil numerals on a dark plate: round, score, timer | normal · alert (Rust) |
| Unit card | Silhouette, name, role, player mark | ready · selected (Amber outline) · pinned (Rust) · down (faded, struck through) |
| Stepper | − count + with point cost, for the squad builder | idle · at-limit · unaffordable (Rust) |
| Report strip | One typed line of what just happened | normal · danger (Rust edge) |
| Map marks | In-world marks, below | per mark |

Touch targets are at least 40 px.

## The world
- **Board:** 3D hex map, tilted top-down. Hills are flat stepped levels,
  buildings plain blocks, woods clumps of simple trees, crops pale rows
  (hill tint 2), low walls short paper blocks, water a slate top. Hex grid is 1 px Ink
  at 25% opacity with stencilled coordinates.
- **Units:** simple low-poly figures with a thin ink outline, each carrying
  its player mark. Effects are equally simple.
- **Light:** a low amber sun, long shadows, mist in low ground. This is where
  the "vibe" lives.
- **Map marks (meanings are fixed):** Amber ring = selected unit · Amber
  dashed stroke with arrowhead = planned order · Amber disc with letter =
  objective · Rust burst = under fire / pinned · Slate veil at ~78% = not in
  sight.

**Visuals are a replaceable kit.** What stays fixed across kits is this doc:
palette roles, player marks, and the meaning of each map mark. The v1
low-poly tiles, figures and effects are the *first* kit, not the definition;
better ones can replace them piece by piece (see `render` in
`docs/vision.md`).

## Screens
There are no per-screen design docs, on purpose: screens are composed from
the components above by whoever builds them, and are expected to be iterated
on after playing. The brief for every screen:
- **Clean.** The map gets the most room; few parts, each doing something.
- **Tasteful.** Only these tokens and components. A screen that needs a new
  one adds it here and to the style sheet first.
- **Weighty.** Parts feel like equipment: solid frames, hard offset shadows,
  controls that visibly travel when operated. Nothing floats or fades in.

## Not this
- Flat "app" UI: soft shadows, rounded cards, gradients.
- Text pop-ups where a part could show the state instead.
- Decorative controls that do nothing.
- Rust or Amber used for anything but danger and selection.
- Colour as the only cue for which player owns a unit.
- Photoreal textures, neon glow, or Mucha-style ornament (dropped for this
  project).
- Jokes in the play screen.

**Approved:** 2026-11-17
