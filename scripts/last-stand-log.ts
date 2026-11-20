// A match log to resume for the Last Stand eval page (task 20): two seats with
// the Scout section on the real map, in Last Stand, played by the seeded script
// through the real rules until the next-to-last round is to be planned, then
// written as the server's order log. The seed is the first whose last two
// rounds, if both seats simply hold, end level on men with the winner picked
// by what the men cost (both sides with at least two men standing). Resume it
// with `npx tsx src/server/main.ts --resume <file>`, and the eval page's two
// clients take the seats back with the tokens below and play the last two
// rounds.
//   npx tsx scripts/last-stand-log.ts <file>

import { writeFileSync } from 'node:fs';
import { PRESETS, mapFor } from '../src/content';
import { createMatch, resolve } from '../src/rules';
import type { LogLine } from '../src/server/match';
import type { Order } from '../src/shared/types';
import { mulberry32, scriptedOrders } from './seeded';

export const TOKENS = ['eval20-a', 'eval20-b'];
const file = process.argv[2];
if (!file) { console.error('Usage: npx tsx scripts/last-stand-log.ts <file>'); process.exit(2); }

const map = mapFor(2);
const scouts = PRESETS.find((p) => p.id === 'scouts')!.units;
for (let seed = 1; seed < 3000; seed++) {
  const rnd = mulberry32(seed);
  const squads = [scouts, scouts].map((units, player) => ({ player, units }));
  let state = createMatch(map, squads, 'last-stand');
  const lines: LogLine[] = [{
    t: 'start', at: 0, map: map.id, mode: 'last-stand',
    seats: squads.map((s, i) => ({ seat: i, name: ['Ann', 'Bo'][i], token: TOKENS[i], squad: [...s.units] })),
  }];
  const seen = { enemies: 0, aimed: 0, lurking: 0, lurkingSeen: 0 };
  while (!state.over && state.round < map.maxRounds - 1) {
    const orders: Order[][] = [0, 1].map((p) => scriptedOrders(state, p, rnd, seen, true));
    lines.push({ t: 'round', round: state.round, orders });
    state = resolve(state, orders, [[], []]).state;
  }
  if (state.over) continue;
  // the last two rounds, held by both
  const end = resolve(resolve(state, [[], []]).state, [[], []]).state;
  const [a, b] = end.scores;
  if (!end.over || a !== b || a < 2 || end.winners.length !== 1) continue;
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  console.log(`Seed ${seed}: round ${state.round} to plan, ${a} men each standing after two held rounds; seat ${end.winners[0]} wins on what the men cost. Log written to ${file}.`);
  process.exit(0);
}
console.error('No seed gave a tie decided by the cost of the men.');
process.exit(1);
