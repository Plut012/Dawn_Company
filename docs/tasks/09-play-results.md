# 09 — Play and results screens

## Overview
The game as the player meets it. The play screen puts the 3D board in the
middle of a field kit: pick a unit, pick an order chit, tap the map, pull
the lever. When everyone is ready the round plays back, and it starts again.
The results screen closes the match. After this task Dawn Company is playable
end to end.

Read first: `docs/vision.md` (Pillars, The match), `docs/design.md` (all;
"Screens" is the brief), `docs/design/stylesheet.html`,
`docs/tasks/00-plan.md` (Rules, Protocol, Board, Client UI). Then the code:
`src/client/` from tasks 06–08.
Depends on: 07 (board with playback), 08 (components, net, app shell).
Uses `orderOptions` and `findPath` from `src/rules`, `UNITS` from content.

## The work

Replace the placeholders `src/client/ui/screens/play.ts` and `results.ts`.

**Play screen — layout**
- The board takes as much room as possible. Kit parts sit at the edges and
  never cover the middle of the map.
- Phone portrait (390 px): a thin top bar and a bottom tray. Laptop: the
  same parts may move to a side panel.
- Top: readouts for round (n / max), own score, and plan timer (alert state
  under 10 seconds; hidden when there is no timer); one lamp per player
  showing ready, planning, disconnected or out, with their score.
- Bottom: the squad as a row of unit cards (scrolls sideways on a phone);
  the order chits for the selected unit; the ready lever.
- A report strip shows the latest line; it can be opened to read the round's
  lines.

**Giving orders**
- Select a unit by tapping it on the map or its card. Both show the
  selection (card state; `select` mark). The camera does not jump unless the
  unit is off screen.
- Chits shown are the unit's `orderOptions(...).kinds`, plus a way to clear
  the order. Chit states: idle, selected (choosing a target), issued (this
  unit has this order), disabled.
- Move / dash: the reachable hexes show as an `options` mark. Tapping one
  sets the order using `findPath`; tapping further hexes in turn lets the
  player lay the route hex by hex instead. The route is drawn as a `path`
  mark.
- Fire / special: valid hexes show as `options`; tapping one sets the order,
  drawn as a `target` mark (with the blast area for area weapons).
- Ambush: one tap on the chit sets it; drawn as an `ambush` mark.
- Every unit's current order stays drawn on the map all through planning.
  Each unit card shows its order at a glance.
- A pinned unit's card says so. It may still be given orders (they run only
  if a medic treats it); the screen makes that plain in one short line.
- Orders are kept as a local draft, saved per round in memory so a reconnect
  or reload during planning does not lose them (sessionStorage is fine).

**The ready lever**
- Down: sends `orders` with the draft. On `rejected`, the lever returns up
  and the reasons show in the report strip against the units concerned.
- Up again before the round resolves: sends `recall`; orders are editable.
- Locked during playback.
- While down, order editing is locked and the screen shows who is still
  planning (the lamps).

**Resolving a round** — on `resolve`:
1. Lock the kit. Clear marks.
2. `await board.play(events)`. As events play, the report strip gets one
   plain line per notable event about things this player can see, in the
   voice set by `docs/design.md` (flat, factual, hex labels from `label()`):
   "Pvt. Hale pinned at F4." "Objective C held. +3."
3. `board.setView(view)`; update readouts, lamps and cards; start the timer;
   unlock. If `view.over`, go to results instead.
- A player who is eliminated keeps watching (they see everything) with the
  order kit replaced by a single plain line.
- On `plan` (match start or reconnect): set the view and go straight to
  planning.

**Results screen**
- Final scores for every player, winner(s) marked, each with their player
  mark, units left, and a one-line dry summary.
- Host has a rematch key (`rematch`); others see that the host can start one.
  A `lobby` message returns everyone to the lobby.

**Quality bar**
- Usable one-handed on a phone: every action is a tap; nothing needs hover,
  right-click or a keyboard. Laptop gets keyboard extras only as a bonus.
- Only approved tokens and components. If a new one is truly needed, add it
  to the style sheet, `kit.css` and `docs/design.md`, and say so.

## Out of scope
New rules, units or protocol messages. Sound. Tutorials. The all-seats page
and automated full-match test (task 10).

## Eval page — `eval/09-play-results.html`
Needs `npm run server` and `npm run dev`; opened at
`http://localhost:5173/eval/09-play-results.html`.
- Two iframes of the real client (`/?slot=a` and `/?slot=b`) against the
  real server, one laptop-shaped and one phone-shaped (390 × 844), so a
  whole match can be played by one person from this page.
- A checklist beside them, each line something to do and see: give each kind
  of order; see the marks; lever down and up; a rejected order; playback
  with report lines; fog hiding the other squad; a pinned unit; a unit down;
  scoring; timer alert; reload mid-plan and keep the draft; play to the end;
  results; rematch.
- Screenshots (taken from a real run) of the play screen at phone and laptop
  size, embedded on the page.
