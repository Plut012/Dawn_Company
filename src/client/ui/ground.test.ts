import { describe, expect, it } from 'vitest';
import { viewFor } from '../../rules';
import type { GameState, Unit } from '../../shared/types';
import { FOXHOLE_GIVES, FOXHOLE_LEAVES, benefitWords, dugIn, kindWords } from './ground';
import { sightWords } from './light';

const man = (q: number, owner = 0): Unit => ({
  id: `${owner}-0`, owner, type: 'rifleman', name: 'Pvt. Test', pos: { q, r: 0 }, status: 'ready',
  pinnedRound: null, revealed: false, posture: 'still', returnRound: null, dugIn: false,
});
const cells = Object.fromEntries(Array.from({ length: 4 }, (_, q) => [`${q},0`, { terrain: 'open', elevation: 0 }]));
const state = (kind: string, round: number, flag: number | null = 0, q = 0): GameState => ({
  map: { id: 'm', name: 'M', cols: 4, rows: 1, cells, objectives: [{ id: 'K', kind, hexes: [{ q: 0, r: 0 }], value: 1, zone: null }], spawns: [], seatSpawns: {}, maxRounds: 15 },
  playerCount: 2, units: [man(q), man(3, 1)], round, scores: [0, 0], eliminated: [false, false], flags: { K: flag }, mode: 'supply-line', works: {}, over: false, winners: [],
});

describe('what ground gives, in words (21)', () => {
  it('names everything a kind gives its holder, from the data', () => {
    expect(kindWords('hq')).toBeNull();
    expect(kindWords('village')).toBe('supply +1');
    expect(kindWords('hill')).toBe('sight +2');
    expect(kindWords('crossroads')).toBe('move +1');
    expect(kindWords('depot')).toBe('supply +2, pinned men rally');
  });
  it('a unit card shows a benefit he has, and only then', () => {
    const v = (kind: string, flag: number | null = 0, q = 0) => viewFor(state(kind, 7, flag, q), 0);
    expect(benefitWords(v('hill'), man(0))).toBe('Hill: sight +2');
    expect(benefitWords(v('crossroads'), man(0))).toBe('Crossroads: move +1');
    expect(benefitWords(v('depot'), man(0))).toBe('Depot: pinned men rally');
    expect(benefitWords(v('village'), man(0))).toBeNull();          // a village gives the side supply, not the man anything
    expect(benefitWords(v('hill', 1), man(0))).toBeNull();          // the enemy's hill
    expect(benefitWords(v('hill', 0, 1), man(1))).toBeNull();       // off the area
  });
  it('the sight sum names the hill beside the light', () => {
    expect(sightWords(viewFor(state('hill', 1), 0), man(0))).toBe('sight 5 (6 −3, first light; hill +2)');
    expect(sightWords(viewFor(state('hill', 7), 0), man(0))).toBe('sight 8 (6; hill +2)');
    expect(sightWords(viewFor(state('hill', 7, null), 0), man(0))).toBe('sight 6');
  });
});

describe('the foxhole in words (24)', () => {
  it('a unit is dug in when it says so and is not down; the words come from one place', () => {
    expect(dugIn(man(0))).toBe(false);
    expect(dugIn({ ...man(0), dugIn: true })).toBe(true);
    expect(dugIn({ ...man(0), dugIn: true, status: 'pinned' })).toBe(true);
    expect(dugIn({ ...man(0), dugIn: true, status: 'down' })).toBe(false);
    expect(FOXHOLE_GIVES).toBe('ignores one more hit a round');
    expect(FOXHOLE_LEAVES).toBe('Moving leaves the foxhole.');
  });
});
