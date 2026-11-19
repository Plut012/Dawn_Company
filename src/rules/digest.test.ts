// The same fifty seeded matches must always play out the same way: a digest
// of every event (each player's included) and of the final state is pinned
// here. A change that is meant to leave the game as it is (a refactor, a new
// field on an event) must leave these digests alone; a change to the rules
// must come with new ones, on purpose. `npx tsx scripts/seeded.ts` prints them.

import { describe, expect, it } from 'vitest';
import { ADDED_FIELDS, SEEDS, digestAll, playSeeded } from '../../scripts/seeded';

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
const PINNED = [
  '1001:b57c8d9f8fb6d066', '1002:55cc64679983b0d7', '1003:834ef735fe34f63b', '1004:1d5d762e97876bd8', '1005:ed15ad6a0786e32e',
  '1006:e0fbc303ad070238', '1007:75d8bac24942bb7e', '1008:7c017f1e63fe7b77', '1009:1b7df96db9374c24', '1010:93e8f67d6d2c16e9',
  '1011:93aca5e5a7304e8e', '1012:b3660d2b856e6198', '1013:8aefde32d2a9567d', '1014:e40757ce136a3e25', '1015:18874be6b0cb5b7f',
  '1016:0d8438fa51b103bb', '1017:f8f3504d1222abfd', '1018:116d2774b1e32300', '1019:76539ed9f9b4ba79', '1020:e2dd7c75b09dcee4',
  '1021:44a4109c83abe319', '1022:9a8e7eed6dd2d332', '1023:8756f1d45f62c1c5', '1024:791f0804334e301a', '1025:2a446ea530366ed1',
  '1026:10538da04751f314', '1027:9661d14a8d010af0', '1028:60aad6a8864a32a5', '1029:eb1fbbb1bc7eebec', '1030:b97d89584f256192',
  '1031:ba7b90c3e3b90923', '1032:d1bf87e19353dc9c', '1033:6d3de5222adce22c', '1034:998f1548e159c05c', '1035:03687100303d34b4',
  '1036:0790d040a99f06b7', '1037:cf74c147cf1e8e14', '1038:81bba788c5ff9a2e', '1039:63c8152307f028f1', '1040:b92fc906b5d282c0',
  '1041:7371ba0cf97aa736', '1042:ecc95b6f0a252f26', '1043:a8457033ebe836db', '1044:e38d4a9daa877d01', '1045:f850fa7704d99745',
  '1046:0584291698330886', '1047:315ee558c7c2b96e', '1048:0c12c80fe9f63bcc', '1049:3d4df01e2f9df548', '1050:5746179ea43b4437',
];
const PINNED_ALL = 'faf0a799ba01b3ec';

describe('seeded matches', () => {
  it('fifty seeded matches give the digests on record', () => {
    const played = SEEDS.map((seed) => playSeeded(seed));
    expect(played.map((m) => `${m.seed}:${m.digest}`)).toEqual(PINNED);
    expect(digestAll(played)).toBe(PINNED_ALL);
    // The set must be worth pinning: fights, ambushes, treatment.
    const sum = (f: (m: (typeof played)[number]) => number) => played.reduce((a, m) => a + f(m), 0);
    expect(sum((m) => m.down)).toBeGreaterThan(100);
    expect(sum((m) => m.ambushes)).toBeGreaterThan(20);
    expect(sum((m) => m.treats)).toBeGreaterThan(5);
  }, 120_000);

  it('the digest leaves nothing out', () => {
    expect([...ADDED_FIELDS]).toEqual([]);
  });
});
