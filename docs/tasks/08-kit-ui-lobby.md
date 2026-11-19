# 08 — Kit UI, lobby and builder

## Overview
The start of the real client: the approved components turned into reusable
code, the connection to the server, and the first screen, where players
join, build a squad, and ready up. After this task, people on the same wifi
can open the URL, see each other in the lobby, and start a match (which
lands on a placeholder until task 09).

Read first: `docs/design.md` (all; note "Screens"), and open
`docs/design/stylesheet.html` — it is the approved look and the source for
the CSS. Then `docs/tasks/00-plan.md` (Protocol, Client UI).
Depends on: 05 (the server), 02 (`UNITS`, `PRESETS`, `RULES`,
`validateSquad`).

## The work

**Fonts and CSS**
- Copy the four font files from `docs/design/fonts/` to `public/fonts/`
  (with the two licence files). No network fonts.
- `src/client/ui/kit.css`: the tokens (CSS custom properties) and component
  styles ported from the style sheet. Same names, same values. Do not
  restyle; if something must change, change the style sheet and
  `docs/design.md` too and say so.

**`src/client/ui/components.ts`** — small functions returning an
`HTMLElement`, one per component in `docs/design.md`: `panel`, `chit`,
`key`, `lever`, `lamp`, `readout`, `unitCard`, `stepper`, `report`. Each
exposes its states (as listed in the design doc) through an attribute or a
small method, and takes a callback where it is operable. Plain DOM, no
framework. Touch targets at least 40 px.

**`src/client/net.ts`**

```ts
connect(slot?: string): Net
interface Net {
  send(msg: ClientMsg): void;
  on<T extends ServerMsg['t']>(t: T, cb: (msg: Extract<ServerMsg, { t: T }>) => void): () => void;
  onStatus(cb: (online: boolean) => void): void;
}
```
- Connects to `/ws` on the page's own host.
- Keeps the seat token from `welcome` in localStorage under
  `dawn-squad-token-${slot}`; `slot` defaults to the `?slot=` URL parameter,
  or `"default"`. Also remembers the player's name.
- Reconnects by itself with a short back-off and re-sends `join` with the
  token. Messages sent while offline are dropped, not queued.

**`index.html` and `src/client/main.ts`** — the app shell.

```ts
interface Screen { mount(root: HTMLElement, app: App): () => void }   // returns unmount
interface App { net: Net; seat: PlayerId; host: boolean; go(screen: 'lobby' | 'play' | 'results', data?: unknown): void }
```
- Shows the lobby on `lobby` messages, the play screen on `plan`, and stays
  put otherwise. `src/client/ui/screens/play.ts` and `results.ts` are
  placeholders here (a panel saying the match has started, with the view's
  round and unit count), to be replaced by task 09.
- A lamp or strip shows when the connection is lost.

**`src/client/ui/screens/lobby.ts`** — one screen, two jobs.
- **Join:** a name field and a join key. Remembered name is pre-filled.
- **Signals:** one lamp per seat with name and state (planning = building,
  ready, disconnected), from `lobby` messages.
- **Squad builder:** a stepper per unit type with its cost and blurb; a
  points readout (spent / budget) that alerts when over; preset keys that
  fill the squad in one press; the squad listed as unit cards in order, with
  a way to reorder them (order decides where each unit starts). Uses
  `validateSquad` live; its errors appear as a report strip. Each change
  sends `squad`.
- **Ready lever:** down sends `ready: true`; locked until the squad is legal.
- **Start key:** host only; disabled until at least 2 seats and all ready.
- Server `error` messages show in the report strip.
- Works on a phone in portrait (390 px wide) and on a laptop. Clean,
  tasteful, weighty, per "Screens" in `docs/design.md`.

## Out of scope
The play and results screens (09). The board (06, 07) — this task does not
import three.js. Server changes, beyond fixing a bug found on the way (say so).

## Eval page — `eval/08-kit-ui-lobby.html`
Needs `npm run server` and `npm run dev`; opened at
`http://localhost:5173/eval/08-kit-ui-lobby.html`.
- **Components:** every component from `components.ts` in every state, built
  by the real functions, beside a link to `docs/design/stylesheet.html` for
  comparison. Operable ones respond.
- **Lobby, live:** three iframes of the real client (`/?slot=a`, `b`, `c`)
  side by side against the real server: join each, build squads, ready up,
  and start. One iframe is phone-sized (390 × 844).
- **Reconnect:** a note of what to do (stop and restart the server, or
  reload an iframe) and the observed result.
