import { describe, expect, it } from 'vitest';
import { viewFor } from '../../rules';
import type { GameState, Unit } from '../../shared/types';
import { lightWords, sightWords } from './light';

const man = (type: string): Unit => ({
  id: '0-0', owner: 0, type, name: 'Pvt. Test', pos: { q: 0, r: 0 }, status: 'ready',
  pinnedRound: null, revealed: false, posture: 'still', returnRound: null, dugIn: false,
});
const state = (round: number, type = 'rifleman'): GameState => ({
  map: { id: 'm', name: 'M', cols: 1, rows: 1, cells: { '0,0': { terrain: 'open', elevation: 0 } }, objectives: [], spawns: [], seatSpawns: {}, maxRounds: 15 },
  playerCount: 2, units: [man(type)], round, scores: [0, 0], eliminated: [false, false], flags: {}, mode: 'supply-line', works: {}, over: false, winners: [],
});

describe('the light in words (19)', () => {
  it('names the light of each round and what it does to sight', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 12].map((r) => lightWords(viewFor(state(r), 0)))).toEqual([
      'First light · sight −3', 'Dawn · sight −3', 'Dawn · sight −2', 'Sunrise · sight −2',
      'Sunrise · sight −1', 'Sunrise · sight −1', 'Full day', 'Full day',
    ]);
  });
  it('gives a unit\'s sight with the sun', () => {
    expect(sightWords(viewFor(state(1), 0), man('rifleman'))).toBe('sight 3 (6 −3, first light)');
    expect(sightWords(viewFor(state(5), 0), man('sniper'))).toBe('sight 7 (8 −1, sunrise)');
    expect(sightWords(viewFor(state(7), 0), man('mortar'))).toBe('sight 5');
  });
});
