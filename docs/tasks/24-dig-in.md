# 24 — Dig in

## Overview
Fortification starts with the men themselves: a unit that holds still for a
whole round digs in, and is harder to hurt until it moves. No button: it
emerges from the orders that already exist, as the vision asks.

Read first: `docs/vision.md` (*The battlefield*: fortification);
`docs/tasks/00-plan.md` (Hits, *v2*: Dig in, the score phase);
`src/rules/resolve.ts` (cover and the score phase), `src/rules/effects.ts` (the
hit rule), `src/client/render/kit.ts` and the lowpoly unit kit.
Depends on: 16.

## The work

**Types**, verbatim:
```ts
// Unit gains:      dugIn: boolean;
// GameEvent gains: | { t: 'dig'; unit: UnitId }   // told to the owner and to whoever sees the unit
// UnitVisual gains: setDugIn?(dug: boolean): void
```

**Rules.**
- In the score phase, after returns (or after supply, if 18 has not landed —
  it has: dependency order), every living unit that did not move or dash this
  round (its posture is `still`) and is not already dug in becomes dug in; a
  `dig` event each.
- A unit stops being dug in at its first step or its dash (as its posture
  changes), and when it goes down. A returning unit is not dug in.
- The hit rule: a unit ignores, each round, as many hits as its ground's
  cover (0 or 1) **plus 1 if dug in**. A hit that ignores cover (the sniper's)
  ignores both. A dasher is never dug in.
- `viewFor` shows `dugIn` for every unit it shows.

**Board.** The lowpoly unit kit draws a low ring of sandbags (paper, ink
outline, as the wall tile) round a dug-in figure; the board calls
`setDugIn` from the view and on `dig` events and when a unit moves.

**Play screen.** A dug-in unit's card and the hex description say so; the
order menu shows that moving gives it up ("moving leaves the foxhole").

**Manual.** A lesson, *Dig in*: the same two shots at a man in the open,
dug in and not.

**Tests and scripts.** The hit rule with and without cover, dug in, and the
sniper; digging in and giving it up; Last Stand and Supply Line alike.
Re-pin the digests. Report from seeded matches: how many units are dug in
per round, and units down per match before and after.

## Out of scope
Works (25). Digging in faster or deeper over several rounds.

## Docs and checks
- Fold into the v1 sections (Hits, types, Kit); tick 24.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run bots -- --matches 200` pass.

## Eval page — `eval/24-dig-in.html`
- The real board with a unit digging in and moving out across two scripted
  rounds (real `resolve`), its figure changing.
- The *Dig in* lesson running in the real manual player.
- The figures above, dated.
- Anything that does not work, stated plainly.
