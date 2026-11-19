import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP, MAPS } from '../../content';
import { createMatch, viewFor } from '../../rules';
import type { PlayerView } from '../../shared/types';
import { standings } from './outcome';

const squad = ['rifleman', 'rifleman', 'rifleman', 'medic'];
const state = createMatch(MAPS[DEFAULT_MAP], [0, 1, 2].map((player) => ({ player, units: squad })));
const base = viewFor(state, 0);
const over = (change: Partial<PlayerView>): PlayerView => ({ ...base, over: true, ...change });

describe('standings', () => {
  it('puts winners first, then by score', () => {
    const rows = standings(over({ scores: [4, 9, 6], winners: [1] }), ['Ann', 'Bo', 'Cy']);
    expect(rows.map((r) => r.name)).toEqual(['Bo', 'Cy', 'Ann']);
    expect(rows.map((r) => r.winner)).toEqual([true, false, false]);
    expect(rows[0].summary).toBe('Held the ground that counted.');
    expect(rows[1].summary).toBe('Short by 3. Close enough to argue about.');
    expect(rows[2].summary).toBe('Held something, some of the time.');
  });

  it('counts own units exactly and others only as far as they are seen', () => {
    const units = base.units.map((u) => (u.id === '0-0' ? { ...u, status: 'down' as const } : u));
    const rows = standings(over({ units, scores: [1, 0, 0], winners: [0] }), ['Ann', 'Bo', 'Cy']);
    const ann = rows.find((r) => r.seat === 0)!;
    const bo = rows.find((r) => r.seat === 1)!;
    expect(ann.standing).toBe(3);
    expect(ann.exact).toBe(true);
    expect(bo.exact).toBe(false);
    expect(bo.summary).toBe('Never held an objective. Saw a good deal of the map.');
  });

  it('marks a wiped squad, which may still have won', () => {
    const rows = standings(over({ scores: [5, 2, 5], winners: [0, 2], eliminated: [false, true, true] }), ['Ann', 'Bo', 'Cy']);
    expect(rows.map((r) => r.seat)).toEqual([0, 2, 1]);
    expect(rows[0].summary).toBe('Shares the win. Nobody is pleased about it.');
    expect(rows[1].summary).toBe('Won from the casualty list. The points do not mind.');
    expect(rows[2].out).toBe(true);
    expect(rows[2].exact).toBe(true);
    expect(rows[2].summary).toBe('Wiped out. The score stands; nobody is left to read it.');
  });

  it('falls back to a seat name', () => {
    expect(standings(over({ scores: [0, 0, 0], winners: [0, 1, 2] }), [])[1].name).toBe('Player 2');
  });
});
