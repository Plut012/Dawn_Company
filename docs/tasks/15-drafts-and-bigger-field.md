# 15 — Unsent orders count, and a bigger field

## Overview
Two independent changes from the first real play session.

1. **Unsent orders go through.** When the clock runs out, a player's orders
   run as they stood on their screen, lever pulled or not.
2. **A bigger field and bigger squads.** The map grows to 17 × 13 and the
   squad budget to 20.

Read first: `docs/tasks/00-plan.md` (Rules, Protocol, Content), then
`src/shared/protocol.ts`, `src/server/`, `src/client/net.ts`,
`src/client/ui/` (play screen, `draft.ts`, `session.ts`), `src/content/`,
`scripts/`.
Depends on: 01–14.

## 1 — Unsent orders go through

Today the server runs only what a player committed with the lever; anything
still being drawn is lost at the deadline.

**Protocol** (`src/shared/protocol.ts`):

```ts
ClientMsg  | { t: 'draft'; orders: Order[] }      // playing: the orders as they stand; does not commit
ServerMsg  plan: { ...; orders: Order[] | null }  // what the server holds for this seat this round
```

- The client sends `draft` whenever its draft changes while the lever is
  up, at most about three times a second, and always sends the latest.
- The server validates a draft like `orders`. A valid draft replaces what
  it holds for the seat and leaves `ready` alone. An invalid one is dropped
  without a `rejected` message and what it held before stays.
- `orders` (lever down) and `recall` (lever up) work as now. A `draft`
  from a seat that is ready is ignored.
- At the deadline the server runs what it holds for each seat. So does a
  round that ends because everyone else is ready? No: a round ends early
  only when every living seat has pulled the lever, as now.
- A seat that reconnects or reloads mid-round gets its held orders back in
  `plan.orders` and the play screen shows them as the draft, so what is on
  the screen is always what will run.
- Remove any client-side attempt to send orders in the last second; the
  server holding the draft replaces it.
- The match log is unchanged: it records the orders that ran.

Tests: a draft runs at the deadline without the lever; an invalid draft
does not displace a valid one; a draft does not mark the seat ready or end
the round; recall then a new draft runs the new draft; reconnect returns
the held orders; over real sockets in `server.test.ts` once.

## 2 — A bigger field and bigger squads

- `RULES.budget` 16 → 20. `minUnits` 4 and `maxUnits` 8 stay.
- Rounds per match 12 → 15.
- The `crossroads` map is redrawn at 17 × 13 in the hand-editable format,
  same id, same character (a crossroads village, woods, hills), with
  **nine objectives**: one of 3 at the centre, four of 2 around it, four of
  1 further out.
- Fair for two, three and four squads. Under a half-turn the map is as
  symmetric as the grid allows; every start zone is the same number of
  steps from the centre objective and from its nearest 1- and 2-point
  objectives, and a test asserts it. Start zones hold eight units. State
  any asymmetry that remains.
- Cover should let a squad reach the middle ring of objectives mostly
  unseen by more than one route, and the centre should be open enough to
  be dangerous. A rifleman reaches the centre in four to five rounds of
  plain moves.
- Presets are rebuilt to spend 20 points within the unit limits.
- Text that states the numbers (lobby, manual, README) takes them from
  content, or is corrected.
- The board must frame the new map on a phone in both orientations and on a
  laptop; hex labels and objectives stay legible at the framed zoom, and
  the closest zoom is unchanged.

## Docs and checks

- Update `docs/tasks/00-plan.md`: Protocol, the numbers in Rules and
  Content, Open items (the old crossroads asymmetry note); add and tick
  this task. Update the 30-second line if any doc still has it.
- `npm test`, `npm run typecheck`, `npm run build`,
  `npm run bots -- --matches 300` must pass.
- Report from the bots or seeded scripted matches on the new map: rounds
  played, units down per match, score per match and per seat (for seat
  fairness with 2, 3 and 4 squads), and how long a match of 15 rounds
  takes at the 90-second clock if every round runs to the bell.

## Out of scope
Rules of movement and fire (task 14). Unit costs, ranges, objective values
beyond the nine above. A map picker. Restyling.

## Eval page — `eval/15-drafts-and-bigger-field.html`
Opened through Vite; the drafts part needs the game server (say how to
start one on a spare port; never stop a server already on 8080).
- Two real clients side by side on a short clock: one draws orders and
  never pulls the lever; the round ends at the bell and its orders run.
  A reload button on that client shows the draft coming back.
- The new map drawn by the real board, with start zones and objective
  values marked, and the measured step distances from each start zone.
- Screenshots (under `eval/assets/15/`) of the map framed at 390 × 844,
  844 × 390 and 1280 × 800.
- The seat-fairness figures, from real runs, with the date.
- Anything that does not work, stated plainly.
