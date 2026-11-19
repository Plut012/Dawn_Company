# Dawn Squad

A simultaneous-turn tactical skirmish for 2–4 players in one room. One laptop
hosts; everyone joins from a browser on a laptop or phone on the same wifi.
Each round every player secretly gives each unit one order (move, dash, fire,
ambush), then all orders resolve at once. Fog of war, no dice, about fifteen
rounds.

## Host a match

```
npm install
npm start
```

`npm start` builds the client and serves it on port 8080. The terminal prints
the address (and a QR code) for the others, e.g. `http://192.168.1.120:8080`.
Everyone opens it, types a name, picks a squad (a preset is one tap) and
throws the ready lever. The first to join is the host and presses Start.

Server options, after `--`:

```
npm run server -- --port 8091 --timer 30
```

- `--port <n>` — listen port (default 8080)
- `--timer <seconds>` — time to plan each round (default 90, 0 = no timer)
- `--matches <dir>` — where order logs are written (default `./matches`)
- `--resume <file>` — pick a match up again from its log after a crash or
  restart; players get their seats back by reloading the page

`npm run server` does not build; it serves whatever is in `dist/`.

## Develop

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 5173 (the port must be free: it does not fall back to another). Proxies `/ws` to the game server on 8080. |
| `npm run server` | The game server on 8080. Run it next to `npm run dev`. |
| `npm test` | Unit and integration tests (Vitest). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run bots` | Smoke test: mindless bots play whole matches against a real server on a spare port and check fog of war, orders, events, scores and the order log. `npm run bots -- --matches 300 --seed 20261117`; also `--players 2`. Exit code is non-zero on any failure. |
| `npm run build` | Client build into `dist/`. |

With `npm run dev` and `npm run server` running:

- `http://localhost:5173/` — the game.
- `http://localhost:5173/dev.html` — every seat on one screen (2, 3 or 4
  frames, phone- or laptop-shaped). "Quick start" seats and readies them all;
  press Start in the first frame. A dev tool: it is not in the build.
- `http://localhost:5173/eval/NN-name.html` — one evaluation page per task.

## Docs

- `docs/vision.md` — what the game is and how the code is laid out.
- `docs/design.md`, `docs/design/` — how it looks.
- `docs/tasks/00-plan.md` — the plan: rules, interfaces, open items.
- `docs/tasks/NN-name.md` — one doc per task.
