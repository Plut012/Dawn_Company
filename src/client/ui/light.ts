// The light of the round, in words (19): how far the sun is up and what it
// does to sight. Pure; the play screen shows it beside the round.

import { UNITS } from '../../content';
import { benefitOf, sightOf } from '../../rules';
import type { PlayerView, Unit } from '../../shared/types';

const signed = (n: number): string => (n < 0 ? `−${-n}` : `+${n}`);

/** The light's name: first light, dawn, sunrise, full day. */
export function lightName(view: Pick<PlayerView, 'sun' | 'dawn'>): string {
  if (view.sun >= 0) return 'Full day';
  if (view.dawn <= 0) return 'First light';
  return view.dawn < 0.5 ? 'Dawn' : 'Sunrise';
}

/** "First light · sight −3", or "Full day" once the sun changes nothing. */
export function lightWords(view: Pick<PlayerView, 'sun' | 'dawn'>): string {
  const name = lightName(view);
  return view.sun === 0 ? name : `${name} · sight ${signed(view.sun)}`;
}

/**
 * A unit's sight in this light, with the sum when the sun or the ground changes it:
 * "sight 3 (6 −3, first light)", "sight 5 (6 −3, first light; hill +2)", "sight 8 (6; hill +2)".
 */
export function sightWords(view: PlayerView, unit: Unit): string {
  const base = UNITS[unit.type]?.sight;
  const now = sightOf(view, unit);
  if (base === undefined || now === base) return `sight ${now}`;
  const b = benefitOf(view, unit);
  const ground = b && b.kind.sight ? b.kind.sight : 0;
  const lit = now - ground;                        // what the light leaves of the type's sight
  const sum = lit === base ? `${base}` : `${base} ${signed(lit - base)}, ${lightName(view).toLowerCase()}`;
  return ground ? `sight ${now} (${sum}; ${b!.kind.name.toLowerCase()} ${signed(ground)})` : `sight ${now} (${sum})`;
}
