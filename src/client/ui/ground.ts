// What ground gives (21), in words read from OBJECTIVE_KINDS. Pure; the play
// screen puts these in the hex description and on a unit's card.

import { OBJECTIVE_KINDS } from '../../content';
import { benefitOf } from '../../rules';
import type { ObjectiveKindDef, PlayerView, Unit } from '../../shared/types';

/** What a kind gives the men of its holder who stand there: "sight +2", "move +1", "pinned men rally". */
function toMen(def: ObjectiveKindDef): string[] {
  const out: string[] = [];
  if (def.sight) out.push(`sight +${def.sight}`);
  if (def.move) out.push(`move +${def.move}`);
  if (def.rally) out.push('pinned men rally');
  return out;
}

/** Everything a kind gives its holder, or null if nothing: "supply +2, pinned men rally". */
export function kindWords(kind: string): string | null {
  const def = Object.hasOwn(OBJECTIVE_KINDS, kind) ? OBJECTIVE_KINDS[kind] : null;
  if (!def) return null;
  const all = [...(def.supply ? [`supply +${def.supply}`] : []), ...toMen(def)];
  return all.length > 0 ? all.join(', ') : null;
}

/** (24) What digging in gives, in words, for a unit's card and the hex it stands on. */
export const FOXHOLE_GIVES = 'ignores one more hit a round';
/** (24) What a move costs a unit that is dug in. */
export const FOXHOLE_LEAVES = 'Moving leaves the foxhole.';

/** (24) Is this unit dug in, for the screens: a unit that is down never is. */
export const dugIn = (unit: Unit): boolean => unit.dugIn === true && unit.status !== 'down';

/** What this unit gains from the ground it stands on, or null: "Hill: sight +2". */
export function benefitWords(view: PlayerView, unit: Unit): string | null {
  const b = benefitOf(view, unit);
  const gifts = b ? toMen(b.kind) : [];
  return b && gifts.length > 0 ? `${b.kind.name}: ${gifts.join(', ')}` : null;
}
