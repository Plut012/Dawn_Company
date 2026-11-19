# 06 — Board

## Overview
The 3D board: given a player's view, draw the map, the units, the fog, and
the planning marks, and report which hex was tapped. It also establishes the
**visual kit**, the seam that lets tiles, units and effects be replaced later
without touching anything else.

Read first: `docs/design.md` (all of it; "The world" especially),
`docs/design/stylesheet.html` (the Map marks section shows the colours and
marks in flat form), `docs/vision.md` (`render`), `docs/tasks/00-plan.md`
(Board, Visual kit).
Depends on: 01 (types, hex maths), 02 (the map, `UNITS`, `TERRAIN`). It does
not depend on the rules or server: it only ever receives a `PlayerView`.

## The work

Add dependency `three` (with types). Create `src/client/render/`:

**`kit.ts`** — the interface, exactly:

```ts
interface VisualKit {
  tokens: Record<string, string>;                       // palette from docs/design.md
  environment(scene: THREE.Scene): void;                // sun, mist, background
  tile(terrain: TerrainId, elevation: number, hex: Hex): THREE.Object3D;
  unit(type: UnitTypeId, owner: PlayerId): UnitVisual;
  mark(mark: Mark, ctx: KitCtx): THREE.Object3D;
  objective(obj: Objective): THREE.Object3D;
  fog(): THREE.Material;                                // veil over unseen hexes
  effect?(event: GameEvent, ctx: KitCtx): Promise<void>;   // added by task 07
}
interface UnitVisual { object: THREE.Object3D; setStatus(s: UnitStatus): void }
interface KitCtx {
  scene: THREE.Scene;
  hexToWorld(hex: Hex): THREE.Vector3;                  // top centre of that hex
  unitObject(id: UnitId): THREE.Object3D | null;
}
```

**`index.ts`** — the board, exactly:

```ts
createBoard(canvas: HTMLCanvasElement, kit: VisualKit): Board

interface Board {
  setView(view: PlayerView): void;               // snap the board to this view
  setMarks(marks: Mark[]): void;                 // replace all planning marks
  play(events: GameEvent[]): Promise<void>;      // task 07; here: resolve at once
  onHexTap(cb: (hex: Hex, unit: Unit | null) => void): void;
  focus(hex: Hex): void;                         // centre the camera
  resize(): void;
  dispose(): void;
}

type Mark =
  | { kind: 'select'; hex: Hex }
  | { kind: 'path'; from: Hex; path: Hex[]; dash: boolean }
  | { kind: 'target'; from: Hex; hex: Hex; blast: number }
  | { kind: 'ambush'; hex: Hex }
  | { kind: 'options'; hexes: Hex[] };
```

**Rules for the board code**
- It builds no geometry of its own. Every visible thing comes from the kit.
- World convention: hex circumradius 1 unit, pointy-top, y up, 0.5 units per
  elevation level.
- `setView` is idempotent and complete: tiles are built once per map; units
  are added, moved, restyled or removed to match the view; hexes not in
  `view.visible` get the fog veil. Units are keyed by id and their objects
  are kept between views (task 07 animates them).
- Camera: tilted top-down (about 55° from the ground), orthographic or
  narrow perspective. One-finger drag or mouse drag pans; pinch or wheel
  zooms; limits keep the map on screen. No rotation in v1.
- A tap (not a drag) calls the `onHexTap` callback with the hex and the unit
  on it, if the view contains one. Picking must be right on raised hexes.
- Renders on demand (when something changes or animates), not in a busy
  loop, to spare phone batteries. Caps pixel ratio at 2.

**`kits/lowpoly/`** — the first kit. Simple and consistent beats detailed.
- Colours only from the palette, terrain tints and player marks in
  `docs/design.md`.
- Tiles: flat-topped hex prisms; hills are taller prisms in the paler tints
  so levels read as steps; woods are a few cone-and-trunk trees; a building
  is a plain block with a pitched roof. A faint grid line and the hex label
  on open ground.
- Units: a simple low-poly soldier (a few boxes and a helmet), with a thin
  ink outline and a clearly visible player mark (colour and shape: bar,
  chevron, diamond, disc) on a base disc. Each of the five types is
  recognisable by one distinguishing prop or pose. `setStatus`: ready
  upright; pinned prone or crouched with a rust marker; down removed or
  flattened and greyed.
- Marks as described in `docs/design.md` ("Map marks").
- Environment: low amber sun with long soft shadows, slate background,
  light mist. Flat shading, no textures.
- Unknown terrain or unit id: a plain khaki prism or a plain peg. No error.

## Out of scope
Animating events (task 07; `play` here just returns). All DOM UI. Any game
logic: the board never decides what is legal or visible.

## Eval page — `eval/06-board.html`
Opened at `http://localhost:5173/eval/06-board.html`. The real board and
kit, fed hand-made views of the real `crossroads` map (no server):
- The board fills the page; pan and zoom work with mouse and touch.
- Buttons switch between several views: full sight; a fogged view from one
  corner; a view with units in every status and all four player marks; an
  empty map.
- Tapping a hex shows its label and the unit on it, and places a `select`
  mark.
- Buttons add each kind of mark.
- A button renders one unknown terrain id and one unknown unit id to show
  the placeholders.
- A "second kit" toggle swaps to a deliberately crude inline kit (plain
  coloured prisms and pegs) defined in the eval page itself, proving the
  board works unchanged with a different kit.
