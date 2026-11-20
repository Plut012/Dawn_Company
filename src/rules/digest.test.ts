// The same fifty seeded matches must always play out the same way: a digest
// of every event (each player's included) and of the final state is pinned
// here. A change that is meant to leave the game as it is (a refactor, a new
// field on an event) must leave these digests alone; a change to the rules
// must come with new ones, on purpose. `npx tsx scripts/seeded.ts` prints them.

import { describe, expect, it } from 'vitest';
import { ADDED_FIELDS, LAST_STAND_SEEDS, SEEDS, digestAll, playSeeded } from '../../scripts/seeded';

// History. Task 12, stage A (actions as data) was proved against the digests of the engine before it:
// all fifty were identical, combined digest 4c64e70ddfead1ba, with only the new `action` field of events
// left out. Stage B (stealth by terrain and posture) changed the rules on purpose, and new digests were
// recorded after it. The terrain rework (woods no longer cover, a building hides only a still unit; crops,
// low walls and water on Crossroads) changed rules and map on purpose; the digests below were recorded after
// that, on 2026-11-18, and leave nothing out.
// Task 14 (move then act; teammates do not block each other) changed the rules and the script on purpose
// too, the same day and while the terrain rework was under way, so the digests below hold both. For the
// record, task 14 alone on the terrain as it was before the rework gave the combined digest 87d3a8f11e0ad1fc
// (the engine before either change: b26a7704205b4e3a).
// Task 15 (the 17 x 13 crossroads, nine objectives, a budget of 20, new presets, 15 rounds) changed the map and the
// squads the script deals, so the digests were recorded afresh on 2026-11-18 (previous combined digest 3c1e3225e5894ac1).
// No rule was touched: the same fifty seeds, the same script and the same rules on a different board.
// Task 16 (objectives are areas with flags, captured at the round's end and kept; an HQ per start zone) changed the
// score rule, the map's objectives and the script's aim (towards an area) on purpose; digests recorded afresh on
// 2026-11-19 (previous combined digest faf0a799ba01b3ec).
// Task 17 (modes) added `mode` to the match state and nothing else: with that one field left out of the digest all
// fifty came out as they were (combined 5df7156c98b24077); with it in, as below, they are new for that reason alone.
// Task 18 (Supply Line: the downed come back at their HQ, buy-backs, a cut line) changed the rules and the script (it
// now buys men back) on purpose; digests recorded afresh on 2026-11-19. Proved first: with Supply Line's `returns`
// set to null and the new `returnRound` field left out, all fifty came out as task 17's (combined 4a2239d8f44bb99e).
// Task 19 (the rising sun: sight is the type's plus `SUN` of the round, at least 1; an action's `own` sight rule is now
// the unit's own sight, not only its line; the round's last sync runs in the next round's light) changed the rules on
// purpose; digests recorded afresh on 2026-11-19 (previous combined digest 690a10fd3df52124). Proved first: with
// `SUN = [0]` all fifty came out as task 18's.
// Task 20 (Last Stand: no supply, down is final, the last squad standing wins) changed nothing in Supply Line: the
// fifty digests below are task 19's, unmoved (combined 3fbfda4ab7a264ee), and the new ten are Last Stand's own, seeds
// 2001 to 2010, recorded on 2026-11-19.
// Task 21 (objective kinds: a held hill adds sight, a crossroads move, a village and a depot supply, a depot rallies)
// changed the rules and the script (its moves use `moveOf`) on purpose; both sets recorded afresh on 2026-11-19.
// Proved first: with every kind's numbers set back to 0 and `rally` false, both came out as before (combined
// 3fbfda4ab7a264ee and f9d6449ab8066436).
// Task 22 (`ford` for two; `crossroads` redrawn with walled hamlets, a stream and two crossroads; a buy-back of 6 times
// the cost; the script heads for an objective by walking steps, ties at random) changed the maps, a number and the
// script on purpose; both sets recorded afresh on 2026-11-19 (previous combined digests cbd529f927b92b68 and
// 5e40c93ec65eea3e). No rule was touched.
// Task 23 (`tripoint`, the triangle, is the map for three; `crossroads` keeps only its layout for four) changed the map
// of the three-player seeds and nothing else: every two- and four-player digest below is task 22's, unmoved, and every
// three-player one is new; recorded 2026-11-19 (previous combined digests df00bbae7b6b4eed and c5ee0201fe8d473e).
// Task 24 (dig in: a man who held still a whole round is dug in until his first step, and ignores one more hit a
// round) changed the rules and the state on purpose (`dugIn`, a `dig` event); both sets recorded afresh on 2026-11-19
// (previous combined digests b712e4916b5b1407 and d4e099948cd03368). Proved first: with the digging switched off and
// `dugIn` left out of the digest, all sixty came out as task 23's.
// Task 25 (the engineer and works: a `build` special, paid from supply in the score phase, a work is terrain on the
// match's own copy of the map) added `works` to the match state, an engineer to the roster and a fourth preset, the
// Pioneer section, which the script deals (it builds now and then); both sets recorded afresh on 2026-11-19 (previous
// combined digests 29aa3da7c80cd1b4 and f54edefd5efd695e). Proved first: with only `works` added and left out of the
// digest, all sixty came out as task 24's; and with the engineer and the preset in, the ten Last Stand matches still
// did (Last Stand deals no preset with an engineer), so they are new for the `works: {}` in their final state alone.
const PINNED = [
  '1001:71b410a9eb90fcc5', '1002:942065a76b6fb24a', '1003:e2d5bb00a6d76558', '1004:e60528e121f1825e', '1005:fa32f75e03dee4c0',
  '1006:55a9e50d48c8c06a', '1007:ef41f0d2e43d1eff', '1008:715df4249e715a31', '1009:e661863ddc18d00c', '1010:cf9f90ae76d8cf91',
  '1011:499d8e47a03be546', '1012:3b8b5ad44f2a058e', '1013:848638fdc71bddc8', '1014:fbca6a51a0b502cb', '1015:a1b23ae1e2703269',
  '1016:569af9007f986026', '1017:95c4ec9fc55f8175', '1018:2916e79a51141002', '1019:b8311a08bb727a70', '1020:ae5d8836ef0d0394',
  '1021:2b91f427819acf16', '1022:aa291d7380c3afb0', '1023:f93b9ecb99e8e896', '1024:1ab0b0638378b93e', '1025:e38eceadc5afaa1e',
  '1026:7189e9287d921290', '1027:b66da15d16cbfac0', '1028:8cb995d6ab76317a', '1029:d27bb5f4734b685b', '1030:e801fc1e994a3283',
  '1031:b91e4190fa626760', '1032:5c48320db15252ef', '1033:7cf5020e4fb1bdb8', '1034:5ada7a76e77cd279', '1035:15836eff783261ef',
  '1036:bb1ed12e6e7a97e2', '1037:18147624041a37a7', '1038:7b147108a8ad8b49', '1039:714487358b42093e', '1040:5e541497672ea1e0',
  '1041:a0995541aa5838ad', '1042:2c7847374fe9a540', '1043:e6d27117e50fdcf6', '1044:a1b44be90076ef5c', '1045:281cb7cbf0a028ab',
  '1046:f6b8cc1711ab5ac0', '1047:61bd0d6b1d22a538', '1048:5d97376629ce32e1', '1049:e3a88f42ab9b5978', '1050:27fb9a9043698914',
];
const PINNED_ALL = '014a6d42f746739d';

const PINNED_LAST_STAND = [
  '2001:752b2e31280e62d7', '2002:e297b5977bbdb676', '2003:ed9f96deb1dbee61', '2004:47b025e18fe56ff2', '2005:f9ae2d2cd4026109',
  '2006:f708cc75e5ee7944', '2007:3e772f44ecafbaf7', '2008:ec924a2fa912106e', '2009:996b4e4b32ccf704', '2010:3d830597fbd4d420',
];
const PINNED_LAST_STAND_ALL = '30a863272d745333';

describe('seeded matches', () => {
  it('fifty seeded matches give the digests on record', () => {
    const played = SEEDS.map((seed) => playSeeded(seed));
    expect(played.map((m) => `${m.seed}:${m.digest}`)).toEqual(PINNED);
    expect(digestAll(played)).toBe(PINNED_ALL);
    // The set must be worth pinning: fights, ambushes, treatment.
    const sum = (f: (m: (typeof played)[number]) => number) => played.reduce((a, m) => a + f(m), 0);
    expect(sum((m) => m.down)).toBeGreaterThan(90);     // 109 since task 22 (100 after task 21, more before it)
    expect(sum((m) => m.ambushes)).toBeGreaterThan(20);
    expect(sum((m) => m.treats)).toBeGreaterThan(5);
  }, 120_000);

  it('ten seeded Last Stand matches give the digests on record', () => {
    const played = LAST_STAND_SEEDS.map((seed) => playSeeded(seed, true, undefined, 'last-stand'));
    expect(played.map((m) => `${m.seed}:${m.digest}`)).toEqual(PINNED_LAST_STAND);
    expect(digestAll(played)).toBe(PINNED_LAST_STAND_ALL);
    // Worth pinning: men go down for good, and nothing is earned or bought.
    expect(played.reduce((a, m) => a + m.down, 0)).toBeGreaterThan(50);
    expect(played.every((m) => m.earned === 0 && m.buyBacks === 0 && m.returns === 0)).toBe(true);
    expect(played.every((m) => m.winners.length > 0)).toBe(true);
  }, 60_000);

  it('the digest leaves nothing out', () => {
    expect([...ADDED_FIELDS]).toEqual([]);
  });
});
