// Which visual kit a board is drawn with. `lowpoly` is the game's kit; `diorama` (26) is a trial of another
// direction, asked for in the URL: `?kit=diorama`.

import type { VisualKit } from '../kit';
import { dioramaKit } from './diorama';
import { lowpolyKit } from './lowpoly';

export type KitId = 'lowpoly' | 'diorama';

/** The kit a URL's query asks for: `?kit=diorama`; anything else, or nothing, is `lowpoly`. */
export function kitFromUrl(search?: string): KitId {
  const query = search ?? (typeof location === 'undefined' ? '' : location.search);
  return new URLSearchParams(query).get('kit') === 'diorama' ? 'diorama' : 'lowpoly';
}

/** A new kit: one per board. */
export function makeKit(id: KitId): VisualKit {
  return id === 'diorama' ? dioramaKit() : lowpolyKit();
}
