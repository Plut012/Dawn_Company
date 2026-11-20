# 18 — Supply Line

## Overview
The first full mode. Held flags already earn their value every round (16);
that number, `scores`, is now **supply**, the one currency and the score. A
downed unit is not gone: it **returns at its HQ** a few rounds later, or
sooner if its player **buys it back** with supply. A player who loses their
HQ's flag is **cut off**: nobody comes back until they retake it. Your squad
never grows beyond what you drafted; death costs tempo, not identity.

Read first: `docs/vision.md` (*Modes*, Supply Line); `docs/tasks/00-plan.md`
(Rules, Protocol, *v2*); `src/rules/` (`resolve.ts` score phase, `orders.ts`,
`match.ts`), `src/server/match.ts`, `src/shared/protocol.ts`,
`src/client/ui/screens/play.ts`, `src/client/ui/draft.ts`, `src/client/net.ts`, `scripts/`.
Depends on: 17.

## The work

**Types**, verbatim:
```ts
export type Purchase = { kind: 'return'; unit: UnitId };   // never an order: a side list per player
// Unit gains:  returnRound: number | null;   // round at whose end it is due back; null = not coming back
// GameEvent gains:
  | { t: 'purchase'; player: PlayerId; unit: UnitId; cost: number }   // told to everyone
  | { t: 'return'; unit: UnitId; at: Hex }                            // owner, and whoever sees `at` after
```

**Rules** (only when the match's mode has `returns`; with `returns: null`
nothing here happens):
- A unit that goes down in round `r` gets `returnRound = r + returns.rounds`.
- A player's **HQ** is the objective of kind `hq` whose zone their seat uses.
  The line is **open** while its flag is theirs.
- `validatePurchases(state, player, purchases)`: each purchase must name one
  of the player's own down units with a `returnRound`, no unit twice, the line
  open, and the running total of costs within the player's supply.
  `buyBackCost(state, unit)` = `UNITS[type].cost × returns.buyBack`, or null
  when it cannot be bought back now.
- `resolve(state, orders, purchases?)`. Invalid purchases are dropped, as
  invalid orders are. The score phase, after supply: **purchases** (in the
  order given, each checked again against what is left: the line must still
  be open and the supply enough; paid ones subtract the cost from `scores`,
  set `returnRound` to this round and emit `purchase`), then **returns**:
  every down unit of a player whose line is open with `returnRound` ≤ this
  round comes back, in unit id order, on the first free hex of its HQ's area
  (drawing order), else of its start zone (placement order). Ready, posture
  `still`, not revealed, `pinnedRound` and `returnRound` null; a `return`
  event. No free hex: it waits. A line that is not open: it waits.
- **Elimination** in a mode with returns: a squad is out when it has no living
  units and none can come back (its line is not open, or it has no unit with
  a `returnRound`). Ending: after `maxRounds`, or when fewer than two squads
  are not out; most supply wins.
- A unit that returns is a new arrival to everyone's sight: the usual
  `spotted`/`lost` handling covers who sees it.

**Protocol and server**, verbatim:
```ts
ClientMsg 'orders' and 'draft' gain  purchases?: Purchase[]
ServerMsg 'plan' gains  purchases: Purchase[] | null     // what the server holds for this seat, like `orders`
```
The server holds purchases with the orders under the same draft rules
(task 15): validated together; an invalid draft is dropped whole. The match
log records the purchases that ran with each round's orders, and resume
replays them.

**Play screen.** The squad row shows a down unit with "back in N" (or "cut
off" when the line is not open). When it can be bought back, its card has a
key "Buy back · N supply"; pressing it adds the purchase to the draft (press
again to take it back), and the supply readout shows what is left after the
purchases in the draft. The score line is labelled *Supply*. Playback shows a
return (the unit appears at the HQ; use an existing effect style) and the log
strip says it in words. The results screen says supply.

**Manual.** Lessons: *Supply* (a flag earns each round), *Coming back* (a man
goes down, returns at the HQ three rounds later), *Buying back*, *Cut off*
(the HQ is taken and the man waits). Lessons may need purchases: extend the
lesson format with them.

**Scripts.** `scripts/seeded.ts` and `scripts/bots.ts` sometimes buy back
(bots: through the protocol; their checks know `purchase` and `return`).
Re-pin the digests. Report from 300+ seeded matches per player count: supply
per match, units down, returns, buy-backs, HQs lost, and rounds to the end.

**Tune the scale (added after 16).** Since 16, thirteen flags earn every round
and HQs earn from round 1: seeded matches average about 158 supply in total.
At that scale a buy-back at 2 × unit cost is nearly free. Measure a typical
seat's income per round and set `returns.buyBack` (and, if needed, objective
`value`s on `crossroads`) so that buying back a rifleman costs about two to
three rounds of a typical seat's income: a real choice, not a reflex. Update
`MODES`, the *v2* section of the plan and this doc's numbers to what you set,
and say why in the report.

*Set (2026-11-19):* `returns: { rounds: 3, buyBack: 4 }`; objective values unchanged. Measured with
`npx tsx scripts/seeded.ts --figures 900` (300 matches per player count, the script buying back now and then): a
seat earns 4.24 supply a round with two players, 3.51 with three, 3.06 with four. A rifleman (cost 2) now costs 8
to bring back: 1.9, 2.3 and 2.6 rounds of a seat's income; a gunner, sniper or mortar (cost 4) costs 16. At
`buyBack: 2` the rifleman was about one round's income.

## Out of scope
Last Stand (20). What a kind gives (21). Spending on anything but buy-back
(works are 25). Restyling.

## Docs and checks
- Fold this task's parts of *v2* into the v1 sections of
  `docs/tasks/00-plan.md`; tick 18.
- `npm test`, `npm run typecheck`, `npm run build`,
  `npm run bots -- --matches 300` pass.

## Eval page — `eval/18-supply-line.html`
Needs the game server on a spare port (say how).
- Two real clients on a short clock: one loses a man, sees "back in 3", buys
  him back, and he appears at the HQ at the end of the round; supply drops by
  the cost on both screens.
- A scripted match (real `resolve`) in which an HQ is captured and a downed
  unit waits, then returns the round after the HQ is retaken.
- The four new lessons running in the real manual player.
- The seeded figures above, from real runs, dated.
- Anything that does not work, stated plainly.
