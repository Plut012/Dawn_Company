# 05 — Server

## Overview
The small Node process on the host's laptop. It seats players, collects each
round's orders, calls the rules, and sends every player only their own view
and events. It holds the only full copy of the game and never sends it.

Read first: `docs/vision.md` (Architecture), `docs/tasks/00-plan.md`
(Protocol, Rules interfaces).
Depends on: 01–04. Uses `createMatch`, `validateOrders`, `resolve`,
`viewFor`, and `validateSquad`, `MAPS`, `DEFAULT_MAP` from content.

## The work

Add dependencies `ws` and `qrcode-terminal` (with types). Add scripts:
`server` (`tsx src/server/main.ts`) and `start` (build, then `server`).

Split in two so the logic is testable without sockets:

**`src/server/match.ts`** — a state machine with no network code. It takes
"seat X sent message M" and "the timer fired", and returns the messages to
send to each seat. Stages: `lobby` → `playing` → `over` → (rematch) `lobby`.

**`src/server/main.ts`** — HTTP and WebSocket.
- Listens on `0.0.0.0:8080` (`--port` to change).
- Serves `dist/` (the built client) as static files.
- WebSocket at `/ws`, JSON text frames, messages exactly as in
  `src/shared/protocol.ts`.
- On start, prints every LAN address as a URL and a QR code for the first.

**Behaviour**
- **join:** with a known token, reclaim that seat (works in any stage).
  Otherwise, in the lobby, take the lowest free seat (max 4) and get a fresh
  random token; outside the lobby or when full, reply `error`. Reply
  `welcome`, then `lobby` or `plan` as the stage requires. Seat 0 is host.
- **squad / ready:** lobby only. `squad` is checked with `validateSquad`
  (reply `error` if illegal) and clears ready. `ready` needs a legal squad.
  Every change broadcasts `lobby`.
- **start:** host only, at least 2 seats, all ready. Creates the match on
  `DEFAULT_MAP`; sends each seat its `plan`. Empty seats are dropped, and
  seats are renumbered 0..n−1 in order before `createMatch`; send a fresh
  `welcome` if a seat number changed.
- **orders:** playing only. Check with `validateOrders`; if illegal, reply
  `rejected`. Otherwise store them, mark the seat ready, broadcast `seats`.
- **recall:** un-readies the seat (orders are kept as a draft server-side
  only until re-sent), broadcast `seats`.
- **Round end:** when every seat that is connected and not eliminated is
  ready, or the timer fires. Seats with nothing submitted hold. Call
  `resolve`, append to the log, send each seat `resolve` with its
  `playerEvents`, its new view, and the new timer. If the match is over,
  stage becomes `over`.
- **Timer:** `--timer <seconds>`, default 90, 0 = none. Restarts each round.
  A round does not end early because a player is disconnected; it waits for
  the timer (or, with no timer, for them to return).
- **rematch:** host only, stage `over`. Back to the lobby with seats, names
  and squads kept.
- **Disconnect:** the seat stays, marked not connected; broadcast `seats` or
  `lobby`. In the lobby a disconnected seat is freed after 5 minutes.
- Malformed or out-of-stage messages get `error` and are otherwise ignored.
  Nothing a client sends may crash the server.

**Log and resume**
- On start of a match, create `matches/<timestamp>.jsonl`. First line: map
  id, squads, seat names and tokens. Then one line per resolved round: the
  orders by seat.
- `--resume <file>` rebuilds the state by replaying the log through
  `createMatch` and `resolve`, then waits for players to rejoin with their
  tokens.

**Tests** (against `match.ts`, no sockets): join and seat order; token
reclaim; illegal squad refused; start conditions; orders rejected and
accepted; round resolves when all ready; timer path with a missing player;
each seat receives only its own view and events; elimination no longer
blocks the round; rematch; resume gives the same state as the live match.
One integration test starts `main.ts` on a spare port and plays one round
over real sockets.

## Out of scope
The client and its UI (08, 09). Any change to rules. Internet play,
accounts, multiple simultaneous matches.

## Eval page — `eval/05-server.html`
Needs `npm run server` and `npm run dev`; opened at
`http://localhost:5173/eval/05-server.html`. A plain protocol console
talking to the real server through `/ws`:
- Four columns, one per seat, each with its own socket and a join button.
- Per seat: buttons for a preset squad, ready, start (host), "hold all"
  orders, a sample move order for the first unit, recall, rematch.
- Per seat: a live log of every message received, with the unit count in
  each view so it is plain that seats receive different data.
- A disconnect / reconnect button per seat, showing the seat reclaimed by
  token mid-match.
- A note of the commands used to test resume, with the observed result.
