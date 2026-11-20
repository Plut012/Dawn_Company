import { describe, expect, it } from 'vitest';
import { mapFor, MAPS } from '../../content';
import { createMatch, viewFor } from '../../rules';
import type { PlayerView } from '../../shared/types';
import { men, scoreWord, standings, stoodLine, survives, tieBreak } from './outcome';

const squad = ['rifleman', 'rifleman', 'rifleman', 'medic'];
const state = createMatch(mapFor(3), [0, 1, 2].map((player) => ({ player, units: squad })));
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
    expect(rows[1].summary).toBe('Won from the casualty list. The supply does not mind.');
    expect(rows[2].out).toBe(true);
    expect(rows[2].exact).toBe(true);
    expect(rows[2].summary).toBe('Wiped out. The supply stands; nobody is left to spend it.');
  });

  it('falls back to a seat name', () => {
    expect(standings(over({ scores: [0, 0, 0], winners: [0, 1, 2] }), [])[1].name).toBe('Player 2');
  });
});

describe('Last Stand (20)', () => {
  const stand = (change: Partial<PlayerView>): PlayerView => over({ mode: 'last-stand', ...change });
  const names = ['Ann', 'Bo', 'Cy'];
  it('names the score by the mode', () => {
    expect(scoreWord('supply-line')).toBe('Supply');
    expect(scoreWord('last-stand')).toBe('Standing');
    expect(survives('last-stand')).toBe(true);
    expect(survives('supply-line')).toBe(false);
    expect(survives('no-such-mode')).toBe(false);
    expect(men(0) + ', ' + men(1) + ', ' + men(3) + ', ' + men(12)).toBe('no one, one man, three men, 12 men');
  });
  it('says who stood and with how many men, exactly for every squad', () => {
    const v = stand({ scores: [3, 1, 0], winners: [0], eliminated: [false, false, true] });
    expect(stoodLine(v, names)).toBe('Ann stood with three men against one other squad.');
    expect(tieBreak(v, names)).toBeNull();                    // the count said it
    const rows = standings(v, names);
    expect(rows.map((r) => [r.name, r.standing, r.exact])).toEqual([['Ann', 3, true], ['Bo', 1, true], ['Cy', 0, true]]);
    expect(rows.map((r) => r.summary)).toEqual(['Three men left. Stood at the end.', 'One man left. Not enough.', 'Wiped out. Nobody came back.']);
    expect(stoodLine(stand({ scores: [1, 0, 0], winners: [0] }), names)).toBe('Ann stood with one man and the field to themselves.');
    expect(standings(stand({ scores: [1, 0, 0], winners: [0] }), names)[0].summary).toBe('The last man standing.');
  });
  it('says why someone won on a tie-break, by what their men were worth', () => {
    const v = stand({ scores: [2, 2, 0], winners: [1], worth: [4, 6, 0] });
    expect(tieBreak(v, names)).toBe("Both had two men; Bo's were worth more.");
    expect(stoodLine(v, names)).toBe('Bo stood with two men against one other squad.');
    expect(tieBreak(stand({ scores: [2, 2, 2], winners: [2], worth: [4, 5, 6] }), names)).toBe("All had two men; Cy's were worth more.");
    expect(tieBreak(stand({ scores: [2, 2, 0], winners: [0, 1], worth: [4, 4, 0] }), names)).toBe('Both had two men, and their men were worth the same. They share it.');
    // Without the figures (a view from a reconnect): the count was level, and it says no more than that.
    expect(tieBreak(stand({ scores: [2, 2, 0], winners: [1] }), names)).toBe('Both had two men; the dearer men won it.');
  });
  it('says when the last squads fell together', () => {
    const v = stand({ scores: [0, 0, 0], winners: [0, 1], eliminated: [true, true, true] });
    expect(tieBreak(v, names)).toBe('Ann and Bo lost their last men in the same round. They share it.');
    expect(standings(v, names).map((r) => r.summary)).toEqual([
      'Lost the last man in the same round as the others. Shares the win.',
      'Lost the last man in the same round as the others. Shares the win.',
      'Wiped out. Nobody came back.',
    ]);
  });
  it('says nothing of it in Supply Line', () => {
    expect(tieBreak(over({ scores: [2, 2, 0], winners: [1] }), names)).toBeNull();
    expect(stoodLine(over({ scores: [2, 2, 0], winners: [1] }), names)).toBeNull();
  });
});
