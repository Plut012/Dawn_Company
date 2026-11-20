// A match log to resume for the Supply Line eval page (task 18): two seats on
// the real map, played by the seeded script through the real rules until seat
// 0 has just lost a man who can be bought back (due back in 3, line open,
// supply enough), then written out as the server's order log. Resume it with
// `npm run server -- --resume <file>`, and the eval page's two clients take
// the seats back with the tokens below.
//   npx tsx scripts/supply-log.ts <file>

import { writeFileSync } from 'node:fs';
import { MODES, PRESETS, mapFor } from '../src/content';
import { buyBackCost, createMatch, lineOpen, resolve } from '../src/rules';
import type { LogLine } from '../src/server/match';
import type { Order } from '../src/shared/types';
import { mulberry32, scriptedOrders } from './seeded';

export const TOKENS = ['eval18-a', 'eval18-b'];
const file = process.argv[2];
if (!file) { console.error('Usage: npx tsx scripts/supply-log.ts <file>'); process.exit(2); }

const map = mapFor(2);
const returns = MODES['supply-line'].returns!;
for (let seed = 1; seed < 500; seed++) {
  const rnd = mulberry32(seed);
  const squads = [PRESETS[0].units, PRESETS[0].units].map((units, player) => ({ player, units }));
  let state = createMatch(map, squads, 'supply-line');
  const lines: LogLine[] = [{
    t: 'start', at: 0, map: map.id, mode: 'supply-line',
    seats: squads.map((s, i) => ({ seat: i, name: ['Ann', 'Bo'][i], token: TOKENS[i], squad: [...s.units] })),
  }];
  const seen = { enemies: 0, aimed: 0, lurking: 0, lurkingSeen: 0 };
  while (!state.over && state.round < map.maxRounds - 3) {
    const orders: Order[][] = [0, 1].map((p) => scriptedOrders(state, p, rnd, seen, true));
    lines.push({ t: 'round', round: state.round, orders, purchases: [[], []] });
    state = resolve(state, orders, [[], []]).state;
    const fresh = state.units.find((u) => u.owner === 0 && u.status === 'down' && u.returnRound === state.round - 1 + returns.rounds);
    const cost = fresh ? buyBackCost(state, fresh.id) : null;
    const living = state.units.some((u) => u.owner === 0 && u.status !== 'down');
    if (fresh && cost !== null && cost <= state.scores[0] && lineOpen(state, 0) && living && !state.over) {
      writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
      console.log(`Seed ${seed}: round ${state.round} to plan; ${fresh.name} (${fresh.id}) went down last round, due back at the end of round ${fresh.returnRound}; `
        + `buy-back ${cost}, seat 0 has ${state.scores[0]} supply. Log written to ${file}.`);
      process.exit(0);
    }
  }
}
console.error('No seed gave a downed man to buy back.');
process.exit(1);
