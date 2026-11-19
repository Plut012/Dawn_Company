# 10 — Match in a box

## Overview
Make the whole game provable and testable by one person. There are no AI
opponents, so this task adds the two tools that stand in for a room of
friends: a page that shows every seat at once, and a script of mindless bots
that plays full matches against the real server. Then it uses them to shake
out what breaks when the parts meet.

Read first: `docs/vision.md` ("Done and delightful", constraints),
`docs/tasks/00-plan.md` (Protocol, Rules). Then the code from tasks 05–09.
Depends on: 09 (everything).

## The work

**`dev.html` — all seats on one screen**
- A grid of 2, 3 or 4 iframes of the real client, each with its own slot
  (`/?slot=dev1` …), so each holds its own seat token.
- Controls: number of seats; one switch for phone-shaped or laptop-shaped
  frames; a key to clear the dev slots' saved tokens.
- A "quick start" key that brings every frame into the lobby with a name and
  a preset squad, readied, so a match is one press from starting. Do this by
  passing URL parameters the client honours **only** when `slot` starts with
  `dev` (e.g. `&auto=preset-id`), not by reaching into the frames.

**`scripts/bots.ts` — the smoke test** (`npm run bots`)
- Starts the real server on a spare port with no timer, connects 2–4
  WebSocket clients, and plays complete matches using only the protocol.
- Each bot, each round, gives every unit a random legal order chosen with
  `orderOptions` from its own view. These are test tools, not opponents:
  no cleverness, and they never ship in the client.
- Random choices come from a seeded generator; the seed is printed so a
  failing match can be re-run.
- It checks, every round, for every bot: the view contains no enemy unit
  that the bot's own units could not see (recomputed from the view); every
  order `orderOptions` offered was accepted (no `rejected`); events refer
  only to units known to that bot; scores never go down; the match ends.
- At the end it replays the server's `matches/*.jsonl` log through
  `createMatch` and `resolve` and checks the final scores match.
- Options: `--matches N`, `--players N`, `--seed N`. Exit code is non-zero
  on any failure. Run at least 200 matches across 2, 3 and 4 players.

**Fix what these find.** Bugs in any earlier task's code are in scope here;
list each one fixed, with the file, in the eval page. If a fix needs an
interface in `00-plan.md` to change, change the plan too and say so.

**Checks by hand**, using `dev.html`, recorded on the eval page:
- A full 4-seat match played to the end.
- Reconnect: reload one frame mid-plan and mid-playback; stop and restart
  the server with `--resume` mid-match.
- Timer: one seat does nothing; the round still resolves.
- A real phone on the same wifi, joined by scanning the QR code: note the
  device, and anything hard to tap or read.
- Time from opening the URL to the first round, for a new player using a
  preset (the vision's target is under two minutes).

**`README.md`** — short: what this is, how to host a match (`npm install`,
`npm start`, share the URL), how to develop (`dev`, `server`, `test`,
`bots`, `dev.html`), where the docs are.

Tick the boxes in `docs/tasks/00-plan.md` and add, under "Open items", any
balance or feel observations from playing (first-guess numbers that look
wrong, rules that confused), without changing the numbers.

## Out of scope
AI opponents. Balance changes. New features, units or maps. Visual polish
beyond fixing something broken.

## Eval page — `eval/10-match-in-a-box.html`
Needs `npm run server` and `npm run dev`; opened at
`http://localhost:5173/eval/10-match-in-a-box.html`.
- A link to `dev.html` and an embedded copy of it at 2 seats, ready to
  quick-start and play.
- The bot run: the exact command, the seed, matches played per player
  count, and the pass/fail output, pasted from a real run with the date.
- The list of bugs found and fixed.
- The hand-check results above, each with what was seen, including the
  phone used and the measured time to first round.
- Anything that still fails or was skipped, stated plainly.
