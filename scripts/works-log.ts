// A match log to resume for the Works eval page (task 25): two seats on the
// real two-player map, seat 0 the Pioneer section, seat 1 the Line section,
// played by the seeded script through the real rules until seat 0 has an
// engineer on his feet, outside every objective, with free ground round him
// to build on and the supply for all three works (sandbags, wire, a nest);
// then written out as the server's order log. Resume it with
// `npx tsx src/server/main.ts --resume <file>`, and the eval page's two
// clients take the seats back with the tokens below.
//   npx tsx scripts/works-log.ts <file>

import { writeFileSync } from 'node:fs';
import { PRESETS, TERRAIN, WORKS, mapFor } from '../src/content';
import { createMatch, resolve } from '../src/rules';
import { key, neighbors } from '../src/shared/hex';
import type { LogLine } from '../src/server/match';
import type { GameState, Hex, Order } from '../src/shared/types';
import { mulberry32, scriptedOrders } from './seeded';

export const TOKENS = ['eval25-a', 'eval25-b'];
const file = process.argv[2];
if (!file) { console.error('Usage: npx tsx scripts/works-log.ts <file>'); process.exit(2); }

const map = mapFor(2);
const need = Object.values(WORKS).reduce((a, w) => a + w.cost, 0);
const pioneers = PRESETS.find((p) => p.id === 'pioneers')!.units;
const line = PRESETS.find((p) => p.id === 'line')!.units;

/** Ground a work may go on, with nobody on it: passable, not water, outside every objective, no work yet. */
const free = (s: GameState, h: Hex): boolean => {
  const cell = s.map.cells[key(h)];
  return !!cell && TERRAIN[cell.terrain].passable && cell.terrain !== 'water' && !Object.hasOwn(s.works, key(h))
    && !s.map.objectives.some((o) => o.hexes.some((x) => key(x) === key(h)))
    && !s.units.some((u) => u.status !== 'down' && key(u.pos) === key(h));
};

for (let seed = 1; seed < 500; seed++) {
  const rnd = mulberry32(seed);
  const squads = [pioneers, line].map((units, player) => ({ player, units }));
  let state = createMatch(map, squads, 'supply-line');
  const lines: LogLine[] = [{
    t: 'start', at: 0, map: map.id, mode: 'supply-line',
    seats: squads.map((s, i) => ({ seat: i, name: ['Ann', 'Bo'][i], token: TOKENS[i], squad: [...s.units] })),
  }];
  const seen = { enemies: 0, aimed: 0, lurking: 0, lurkingSeen: 0 };
  while (!state.over && state.round < map.maxRounds - 4) {
    const orders: Order[][] = [0, 1].map((p) => scriptedOrders(state, p, rnd, seen, true));
    lines.push({ t: 'round', round: state.round, orders, purchases: [[], []] });
    state = resolve(state, orders, [[], []]).state;
    const s = state;
    // The first engineer on his feet, in squad order, is the one the eval page's walk-through picks: he must do.
    const first = s.units.find((u) => u.owner === 0 && u.type === 'engineer' && u.status === 'ready');
    const eng = first && !s.map.objectives.some((o) => o.hexes.some((x) => key(x) === key(first.pos)))
      && neighbors(first.pos).filter((n) => free(s, n)).length >= 3 ? first : undefined;
    if (eng && s.scores[0] >= need && state.round >= 4 && !s.over) {
      writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
      console.log(`Seed ${seed}: round ${s.round} to plan; ${eng.name} (${eng.id}) at ${key(eng.pos)}, seat 0 has ${s.scores[0]} supply `
        + `(the three works cost ${need}). Log written to ${file}.`);
      process.exit(0);
    }
  }
}
console.error('No seed gave an engineer with room and supply to build.');
process.exit(1);
