// What the page remembers between screens: the squad being built and which
// seat token it belongs to. main.ts fills it from `welcome`; the lobby edits it.

import type { UnitTypeId } from '../../shared/types';

export const session: { token: string | null; squad: UnitTypeId[] | null } = { token: null, squad: null };

/** A `welcome` for a new seat brings the server's squad; a repeat for the same seat does not overwrite local edits. */
export function adoptWelcome(token: string, squad: UnitTypeId[]): void {
  if (session.token !== token || session.squad === null) session.squad = [...squad];
  session.token = token;
}
