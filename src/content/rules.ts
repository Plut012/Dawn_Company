// Squad-building limits and other tunable numbers.

import type { RulesConfig } from '../shared/types';

export const RULES: RulesConfig = {
  budget: 20,
  minUnits: 4,
  maxUnits: 8,
};

/**
 * The rising sun (19): `SUN[i]` is the change to every unit's sight in round
 * `i + 1`; later rounds use the last entry. The match opens in half-light.
 */
export const SUN: number[] = [-3, -3, -2, -2, -1, -1, 0];
