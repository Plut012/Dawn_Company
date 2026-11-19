// The order draft: what the player has pencilled in for the round being
// planned, before the lever sends it. Plain data and pure functions; the play
// screen draws it and the server judges it.

import { UNITS } from '../../content';
import { actionOf, findPath, followUpOptions, hideRange } from '../../rules';
import { distance, eq, key, label, within } from '../../shared/hex';
import type { FollowUp, GameMap, Hex, Order, OrderKind, PlayerView, Unit, UnitId } from '../../shared/types';

/** At most one order per unit. A unit with no entry holds. */
export type Draft = Record<UnitId, Order>;

/** The viewing player's own units, in id order, whatever their status. */
export function ownUnits(view: PlayerView): Unit[] {
  const index = (u: Unit): number => Number(u.id.split('-')[1]);
  return view.units.filter((u) => u.owner === view.player).sort((a, b) => index(a) - index(b));
}

export function toOrders(draft: Draft): Order[] {
  return Object.values(draft);
}

/** The draft a list of orders makes: the server's held orders, put back on the screen. */
export function fromOrders(orders: Order[]): Draft {
  const out: Draft = {};
  for (const o of orders) out[o.unit] = o;
  return out;
}

/**
 * Drop what cannot belong to this round: orders for units that are not the
 * player's, are down, or cannot take that kind of order. Targets and paths
 * are left alone; the server is the judge of those.
 */
export function prune(view: PlayerView, draft: Draft): Draft {
  const out: Draft = {};
  for (const u of ownUnits(view)) {
    const o = draft[u.id];
    if (!o || o.unit !== u.id || u.status === 'down') continue;
    if (!UNITS[u.type]?.orders.includes(o.kind)) continue;
    out[u.id] = o;
  }
  return out;
}

/** How many hexes a unit may be sent with this kind of order. */
export function allowance(unit: Unit, kind: OrderKind): number {
  const move = UNITS[unit.type]?.move ?? 0;
  return kind === 'dash' ? move * 2 : kind === 'move' ? move : 0;
}

/**
 * The route after a tap, while laying a move or dash.
 * - the unit's own hex: no route (the order is cleared);
 * - a hex already on the route: the route is cut back to it;
 * - a hex next to the route's end, with allowance left: the route grows by it;
 * - anywhere else: the shortest route from the unit to that hex.
 * Null when the hex cannot be reached within `max`.
 */
export function layRoute(map: GameMap, from: Hex, current: Hex[], tapped: Hex, max: number): Hex[] | null {
  if (eq(tapped, from)) return [];
  const at = current.findIndex((h) => eq(h, tapped));
  if (at !== -1) return current.slice(0, at + 1);
  const end = current.at(-1);
  if (end && current.length < max && distance(end, tapped) === 1 && findPath(map, end, tapped, 1)) {
    return [...current, tapped];
  }
  const path = findPath(map, from, tapped, max);
  return path && path.length > 0 ? path : null;
}

/** Where the unit will stand when the round's movement is over, if nothing stops it. */
export function plannedEnd(unit: Unit, draft: Draft): Hex {
  const o = draft[unit.id];
  return o && (o.kind === 'move' || o.kind === 'dash') && o.path.length > 0 ? o.path[o.path.length - 1] : unit.pos;
}

/** The follow-up of a unit's drafted move, if it has one. */
export function followUpOf(draft: Draft, id: UnitId): FollowUp | null {
  const o = draft[id];
  return o && o.kind === 'move' && o.then ? o.then : null;
}

/**
 * A move order along `path`, keeping the follow-up `then` when it can still
 * be ordered from the new end of the path and dropping it when it cannot.
 */
export function moveOrder(view: PlayerView, unit: Unit, path: Hex[], then: FollowUp | null): Order {
  const end = path[path.length - 1];
  const keep = then && end && followUpOptions(view, unit.id, end)[then.kind].includes(key(then.target));
  return keep ? { unit: unit.id, kind: 'move', path, then } : { unit: unit.id, kind: 'move', path };
}

/**
 * The player's own living units that `shooter`, ordered to `kind` at
 * `target`, would hit: the target hex and the action's blast area, never the
 * shooter itself; nobody, if the action does not hit or spares its own side.
 * An action that lands before anyone moves covers units where they stand
 * now. One that lands after movement (a mortar-phase action, or any action
 * used as a move's follow-up: `afterMove`) covers them where they stand now
 * or mean to end up.
 */
export function ownUnitsUnderFire(
  view: PlayerView, draft: Draft, shooter: Unit, target: Hex, kind: 'fire' | 'special' = 'fire', afterMove = false,
): Unit[] {
  const action = actionOf(shooter.type, kind);
  if (!action || action.affects === 'enemies' || !action.effects.some((e) => e.kind === 'hit')) return [];
  const area = within(target, Math.max(0, action.blast));
  const inArea = (h: Hex): boolean => area.some((a) => eq(a, h));
  const late = afterMove || action.phase === 'mortar';
  return ownUnits(view).filter((u) =>
    u.id !== shooter.id && u.status !== 'down'
    && (inArea(u.pos) || (late && inArea(plannedEnd(u, draft)))));
}

export interface FriendlyFire { shooter: Unit; target: Hex; victims: Unit[] }

/** Every order in the draft whose action would hit one of the player's own units. */
export function friendlyFire(view: PlayerView, draft: Draft): FriendlyFire[] {
  const out: FriendlyFire[] = [];
  for (const u of ownUnits(view)) {
    const o = draft[u.id];
    if (!o || u.status === 'down') continue;
    const then = followUpOf(draft, u.id);
    if (then) {
      const victims = ownUnitsUnderFire(view, draft, u, then.target, then.kind, true);
      if (victims.length > 0) out.push({ shooter: u, target: then.target, victims });
    }
    if (o.kind !== 'fire' && o.kind !== 'special') continue;
    const victims = ownUnitsUnderFire(view, draft, u, o.target, o.kind);
    if (victims.length > 0) out.push({ shooter: u, target: o.target, victims });
  }
  return out;
}

export type Stance = 'hidden' | 'creeping' | 'exposed';

/**
 * In a word, how hard a unit is to see where it stands, from the ground, what
 * it did in the last round and whether it gave itself away: `hidden` (kept
 * still in hiding terrain), `creeping` (moved through it), or `exposed`
 * (in the open, or it dashed or fired).
 */
export function stance(map: GameMap, unit: Unit): Stance {
  if (hideRange(map, unit) === null) return 'exposed';
  return unit.posture === 'moved' ? 'creeping' : 'hidden';
}

/** "Pvt. Hale": a unit's name already carries its rank. */
export function unitName(unit: Unit): string {
  return unit.name;
}

/** The order in a few words: "Move G5", "Hold", "Move G5 · Fire F3". */
export function orderLabel(order: Order | undefined, type: string): string {
  if (!order) return 'Hold';
  switch (order.kind) {
    case 'move': {
      const walk = `Move ${label(order.path[order.path.length - 1] ?? { q: 0, r: 0 })}`;
      return order.then ? `${walk} · ${actionName(type, order.then.kind)} ${label(order.then.target)}` : walk;
    }
    case 'dash': return `Dash ${label(order.path[order.path.length - 1] ?? { q: 0, r: 0 })}`;
    case 'fire': case 'special': return `${actionName(type, order.kind)} ${label(order.target)}`;
    case 'ambush': return 'Ambush';
  }
}

/**
 * The order as a unit card says it, where there is room for a couple of
 * words and no more: as `orderLabel`, but a move with a follow-up names its
 * two parts and leaves the hexes to the map and the strip ("Move · Fire").
 */
export function orderBrief(order: Order | undefined, type: string): string {
  if (order?.kind === 'move' && order.then) return `Move · ${actionName(type, order.then.kind)}`;
  return orderLabel(order, type);
}

/** What a unit type's `fire` or `special` order is called, on its chit and its card: the action's own name. */
export function actionName(type: string, kind: 'fire' | 'special'): string {
  return actionOf(type, kind)?.name ?? (kind === 'fire' ? 'Fire' : 'Special');
}

/**
 * The chit icon for an action: looked up by the action's `icon` key, and for
 * a key with no drawing of its own, the plain icon of its kind of order.
 */
export function actionIcon(type: string, kind: 'fire' | 'special'): 'fire' | 'special' {
  const icon = actionOf(type, kind)?.icon ?? '';
  return (Object.hasOwn(ACTION_ICONS, icon) ? ACTION_ICONS[icon] : null) ?? kind;
}

/** Which chit drawing (see ICONS in components) each action icon key uses. */
export const ACTION_ICONS: Record<string, 'fire' | 'special'> = {
  rifle: 'fire', burst: 'fire', snipe: 'fire', shell: 'fire', aid: 'special',
};

// ---- keeping the draft across a reload

export interface DraftStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const storeKey = (slot: string): string => `dawn-squad-draft-${slot}`;

/** What ties a saved draft to one round of one match for one seat: where every own unit stands. */
export function draftSignature(token: string | null, view: PlayerView): string {
  const units = ownUnits(view).map((u) => `${u.id}:${u.type}:${u.pos.q},${u.pos.r}:${u.status}`).join(' ');
  return `${token ?? ''}|${view.map.id}|${view.round}|${units}`;
}

export function saveDraft(store: DraftStore | null, slot: string, signature: string, draft: Draft): void {
  try { store?.setItem(storeKey(slot), JSON.stringify({ signature, draft })); } catch { /* full or private */ }
}

/** The saved draft, if it was saved for exactly this round; otherwise empty. */
export function loadDraft(store: DraftStore | null, slot: string, signature: string): Draft {
  try {
    const raw = store?.getItem(storeKey(slot));
    if (!raw) return {};
    const saved = JSON.parse(raw) as { signature?: unknown; draft?: unknown };
    if (saved.signature !== signature || typeof saved.draft !== 'object' || saved.draft === null) return {};
    const out: Draft = {};
    for (const [id, o] of Object.entries(saved.draft as Record<string, Order>)) {
      if (o && typeof o === 'object' && o.unit === id && wellFormed(o)) out[id] = o;
    }
    return out;
  } catch {
    return {};
  }
}

const isHex = (h: unknown): h is Hex =>
  typeof h === 'object' && h !== null && Number.isInteger((h as Hex).q) && Number.isInteger((h as Hex).r);

/** Shaped like an order, so it can be drawn. Whether it is legal is the server's call. */
function wellFormed(o: Order): boolean {
  switch (o.kind) {
    case 'move':
      if (o.then !== undefined && !(typeof o.then === 'object' && o.then !== null && (o.then.kind === 'fire' || o.then.kind === 'special') && isHex(o.then.target))) return false;
      return Array.isArray(o.path) && o.path.length > 0 && o.path.every(isHex);
    case 'dash': return Array.isArray(o.path) && o.path.length > 0 && o.path.every(isHex);
    case 'fire': case 'special': return isHex(o.target);
    case 'ambush': return true;
    default: return false;
  }
}

export function clearDraft(store: DraftStore | null, slot: string): void {
  try { store?.removeItem(storeKey(slot)); } catch { /* nothing to clear */ }
}

// ---- telling the server what is on screen

/**
 * Sends the latest of a stream of changes, at most once per `gapMs`. `poke()`
 * says "something changed": the first poke after a quiet spell sends at once,
 * later ones within the gap are folded into one send when the gap ends, and
 * what goes out is whatever `latest()` returns then. `cancel()` drops a send
 * that is waiting. Nothing is ever queued beyond that one.
 */
export function throttled(send: () => void, gapMs: number, now: () => number = Date.now) {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = (): void => { timer = undefined; last = now(); send(); };
  return {
    poke(): void {
      if (timer !== undefined) return;
      const wait = last + gapMs - now();
      if (wait <= 0) fire(); else timer = setTimeout(fire, wait);
    },
    cancel(): void {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
