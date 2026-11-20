import { describe, expect, it } from 'vitest';
import { PRESETS, RULES, validateSquad } from '../../content';
import { add, barredReason, move, remove, rosterRow, spent } from './squad';

describe('squad builder arithmetic', () => {
  const line = PRESETS[0].units;

  it('adds to the end and removes the last of a type', () => {
    expect(add(['rifleman'], 'medic')).toEqual(['rifleman', 'medic']);
    expect(remove(['rifleman', 'medic', 'rifleman'], 'rifleman')).toEqual(['rifleman', 'medic']);
    expect(remove(['rifleman'], 'sniper')).toEqual(['rifleman']);
  });

  it('moves a unit by swapping with its neighbour, and stops at the ends', () => {
    expect(move(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(move(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(move(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });

  it('every preset sits within budget', () => {
    for (const p of PRESETS) expect(spent(p.units)).toBeLessThanOrEqual(RULES.budget);
  });

  it('marks a unit at its per-squad limit', () => {
    const row = rosterRow(['sniper', 'rifleman', 'rifleman', 'rifleman'], 'sniper');
    expect(row.state).toBe('at-limit');
    expect(row.canInc).toBe(false);
    expect(row.canDec).toBe(true);
    expect(row.caption).toContain('MAX 1');
  });

  it('marks a unit the squad cannot afford, and says how many points are left', () => {
    const squad = ['rifleman', 'rifleman', 'rifleman', 'rifleman', 'rifleman', 'gunner', 'gunner'];   // 5*2 + 2*4 = 18
    expect(spent(squad)).toBe(18);
    const row = rosterRow(squad, 'gunner');
    // gunner max is 2 and both are used, so it is at its limit, not unaffordable
    expect(row.state).toBe('at-limit');
    const sniper = rosterRow(squad, 'sniper');
    expect(sniper.state).toBe('unaffordable');
    expect(sniper.caption).toContain('2 LEFT');
    expect(sniper.canInc).toBe(false);
  });

  it('treats a spent budget as a limit, not as unaffordable', () => {
    const row = rosterRow(line, 'rifleman');      // the line section spends all 20
    expect(spent(line)).toBe(RULES.budget);
    expect(row.state).toBe('at-limit');
    expect(row.caption).toContain('0 LEFT');
  });

  it('stops adding when the squad is full', () => {
    const full = Array(RULES.maxUnits).fill('rifleman');
    const row = rosterRow(full, 'medic');
    expect(row.canInc).toBe(false);
    expect(row.caption).toContain('FULL');
  });

  it('offers an add that keeps the squad legal', () => {
    const squad = [...line];
    for (const id of ['rifleman', 'medic', 'sniper'] as const) {
      const row = rosterRow(squad, id);
      if (row.canInc) expect(validateSquad(add(squad, id)).cost).toBeLessThanOrEqual(RULES.budget);
    }
  });

  it('greys out a unit the mode does not allow, with the reason, but lets one already there be taken out', () => {
    expect(barredReason('mortar', 'last-stand')).toBe('Last Stand has no mortar.');
    expect(barredReason('mortar')).toBeNull();
    expect(barredReason('medic', 'last-stand')).toBeNull();
    const row = rosterRow(['rifleman', 'rifleman'], 'mortar', 'last-stand');
    expect(row.state).toBe('barred');
    expect(row.canInc).toBe(false);
    expect(row.canDec).toBe(false);
    expect(row.caption).toContain('BARRED');
    expect(rosterRow(line, 'mortar', 'last-stand').canDec).toBe(true);        // a mortar is in the line section
    expect(rosterRow(['rifleman'], 'mortar').state).toBe('idle');           // supply-line by default
    expect(rosterRow(['rifleman'], 'medic', 'last-stand').state).toBe('idle');
  });

  it('never offers an add the mode would refuse', () => {
    for (const id of ['rifleman', 'gunner', 'sniper', 'mortar', 'medic']) {
      const row = rosterRow(['rifleman', 'rifleman'], id, 'last-stand');
      if (row.canInc) expect(validateSquad(add(['rifleman', 'rifleman'], id), 'last-stand').errors.filter((e) => /has no/.test(e))).toEqual([]);
      else expect(id).toBe('mortar');
    }
  });
});
