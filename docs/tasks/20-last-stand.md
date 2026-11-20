# 20 — Last Stand

## Overview
The hardcore mode: a brutal, tense firefight. Nobody comes back, ground gives
only its advantages, and the last squad standing wins. The mode's data already
exists (17) and the squad builder already keeps the mortar out; this task makes
the rules honour its switches.

Read first: `docs/vision.md` (*Modes*, Last Stand); `docs/tasks/00-plan.md`
(*v2*: Modes, the score phase); `src/content/modes.ts`, `src/rules/resolve.ts`
(score phase), `src/rules/match.ts`, `src/client/ui/screens/play.ts` and
`results.ts`.
Depends on: 18.

## The work

**Rules**, driven only by the mode's fields — never by its id:
- `supply: false`: flags are still captured (capture events as ever), but
  nothing earns: no `score` events for objectives, no purchases (every
  purchase is invalid: "No supply in this mode.").
- `returns: null`: down is final; `returnRound` stays null (already so after
  18 — check it).
- `win: 'survival'`: in the score phase, after captures, `scores[p]` is set to
  the number of player `p`'s living units (a live tally, no events). A squad
  with no living units is eliminated. The match ends after `maxRounds` or when
  at most one squad has living units. Winners: the most living units; among
  those, the greatest total `cost` of living units; still equal, they share.
  If the last squads all lose their last men in the same round, every squad
  that was not already out shares the win. Say this in a test.

**Screens.** Wherever the score is shown, its label follows the mode: *Supply*
or *Standing*. The results screen in Last Stand says who stood and how many
men they had left, and why someone won on a tie-break ("Both had two men;
Bo's were worth more"). The lobby blurb is the mode's (17).

**Manual.** One lesson, *Last Stand*: the last man standing; a second
showing the tie-break at the last round if it fits in the lesson format.

**Scripts.** `npm run bots -- --mode last-stand` and seeded matches in Last
Stand: report rounds to the end, how many matches end before the last round,
units left, and how often the tie-break decides. Digests for supply-line must
not move; pin a separate set of ten seeded Last Stand digests.

## Out of scope
New units or maps. What a kind gives (21). A mortar in Last Stand.

## Docs and checks
- Fold into the v1 sections (Rules: End; Modes); tick 20.
- `npm test`, `npm run typecheck`, `npm run build`,
  `npm run bots -- --matches 200 --mode last-stand` pass.

## Eval page — `eval/20-last-stand.html`
Needs the game server on a spare port (say how).
- Two real clients play a short Last Stand to the end (the eval may script
  orders through the real protocol); the results screen with the reason.
- The *Last Stand* lesson running in the real manual player.
- The figures above, from real runs, dated.
- Anything that does not work, stated plainly.
