// What actions do. An action (src/content) lists effects; each kind of effect
// is one function in the table below, applied to one unit at a time. This is
// the only place in the rules that knows what an effect is. A new kind of
// effect is one new function here and one new variant of `Effect`.
//
// Pure: no DOM, Node APIs, clock or randomness.

import { WORKS } from '../content';
import type { ActionDef, Effect, GameEvent, GameMap, Hex, HexKey, PlayerId, Unit, UnitId, WorkId } from '../shared/types';
import { workProblem } from './works';

/** One use of an action: who, what, at which hex, and (25) the work a build puts up. */
export interface Use { user: Unit; action: ActionDef; target: Hex; work?: WorkId }

/** What an effect may ask of the round being resolved. */
export interface World {
  round: number;
  /** Uses up one hit's worth of the unit's cover (its ground's, and a foxhole's, 24) for this round, if any is left. True if it had. */
  shelter(unit: Unit): boolean;
  /** Running in the open: no cover, and down from one hit. */
  exposed(unit: Unit): boolean;
  /** Does this player know of this unit just now (its own, or in sight)? */
  sees(player: PlayerId, unit: UnitId): boolean;
  /** Record an event; each player is told the version `told` gives them, or nothing. */
  record(event: GameEvent, told: (player: PlayerId) => GameEvent | null): void;
  /** Bring every player's sight up to date after something changed who can be seen. */
  refresh(): void;
  /** (25) Does this player see this hex just now? */
  seesHex(player: PlayerId, hex: Hex): boolean;
  /** (25) The map as it stands now (works included), the works so far, and every unit. */
  map(): GameMap;
  works(): Record<HexKey, WorkId>;
  units(): Unit[];
  /** (25) What this player may spend now; null in a mode without supply. */
  supply(player: PlayerId): number | null;
  /** (25) Pay for a work and put it up: the cost leaves the player's supply, the hex's terrain becomes the work's. */
  raise(player: PlayerId, at: Hex, work: WorkId): void;
}

/** The kinds of effect that act on the target hex itself, once a use, rather than on each unit there (25). */
type HexEffect = Extract<Effect, { kind: 'build' }>;
type UnitEffect = Exclude<Effect, HexEffect>;
type Apply<E extends Effect> = (world: World, effect: E, use: Use, unit: Unit) => void;
type ApplyHex<E extends Effect> = (world: World, effect: E, use: Use) => void;

const ON_HEX: { [K in HexEffect['kind']]: ApplyHex<Extract<Effect, { kind: K }>> } = {
  /**
   * (25) The work named by the order goes up on the target hex, if the hex may still take it (`blocked`) and the
   * user's owner can pay for it now (`supply`); otherwise an `unable`. Told to the owner and whoever sees the hex.
   */
  build(world, _effect, use) {
    const { user, action, target, work } = use;
    const at = { q: target.q, r: target.r };
    const unable = (reason: 'blocked' | 'supply') => {
      const e: GameEvent = { t: 'unable', unit: user.id, action: action.id, reason };
      world.record(e, (p) => (world.sees(p, user.id) ? e : null));
    };
    if (work === undefined || workProblem(world.map(), world.works(), at, work, world.units()) !== null) return unable('blocked');
    const supply = world.supply(user.owner);
    if (supply === null || supply < WORKS[work].cost) return unable('supply');
    world.raise(user.owner, at, work);
    const e: GameEvent = { t: 'build', unit: user.id, at, work };
    world.record(e, (p) => (p === user.owner || world.seesHex(p, at) ? e : null));
  },
};

const EFFECTS: { [K in UnitEffect['kind']]: Apply<Extract<Effect, { kind: K }>> } = {
  /** The hit rule: cover (and a foxhole) takes the first hits, then ready -> pinned -> down; a runner goes straight down. */
  hit(world, effect, _use, unit) {
    let result: 'cover' | 'pinned' | 'down';
    if (!effect.ignoresCover && world.shelter(unit)) result = 'cover';
    else if (world.exposed(unit) || unit.status === 'pinned') result = 'down';
    else result = 'pinned';
    // Judged before the change: a unit seen going down is still "seen" here.
    const event: GameEvent = { t: 'hit', unit: unit.id, at: { q: unit.pos.q, r: unit.pos.r }, result };
    world.record(event, (p) => (world.sees(p, unit.id) ? event : null));
    if (result === 'down') { unit.status = 'down'; unit.pinnedRound = null; unit.dugIn = false; }
    if (result === 'pinned') { unit.status = 'pinned'; unit.pinnedRound = world.round; }
  },

  /** A pinned unit becomes ready. Nothing happens to any other. */
  recover(world, _effect, use, unit) {
    if (unit.status !== 'pinned') return;
    unit.status = 'ready';
    unit.pinnedRound = null;
    const event: GameEvent = { t: 'treat', unit: use.user.id, target: unit.id, action: use.action.id };
    // Seeing only the one who got up, a player learns just that it is back on its feet.
    world.record(event, (p) => {
      if (!world.sees(p, unit.id)) return null;
      return world.sees(p, use.user.id) ? event : { t: 'recover', unit: unit.id };
    });
  },

  /** The unit counts as having fired: no terrain hides it until the next round begins to resolve. */
  reveal(world, _effect, use, unit) {
    if (unit.revealed) return;
    unit.revealed = true;
    world.refresh();
    const event: GameEvent = { t: 'reveal', unit: unit.id, action: use.action.id };
    world.record(event, (p) => (world.sees(p, unit.id) ? event : null));
  },
};

/** Apply one effect of an action to one unit. An effect of a kind not in the table (or one on the hex) does nothing. */
export function applyEffect(world: World, effect: Effect, use: Use, unit: Unit): void {
  if (!Object.hasOwn(EFFECTS, effect.kind)) return;
  (EFFECTS[effect.kind as UnitEffect['kind']] as Apply<Effect>)(world, effect, use, unit);
}

/** Does this effect act on the target hex, once a use, rather than on the units there? (25) */
export function onHex(effect: Effect): boolean {
  return Object.hasOwn(ON_HEX, effect.kind);
}

/** Apply one effect that acts on the hex, once for the use (25). Any other kind does nothing. */
export function applyHexEffect(world: World, effect: Effect, use: Use): void {
  if (!onHex(effect)) return;
  (ON_HEX[effect.kind as HexEffect['kind']] as ApplyHex<Effect>)(world, effect, use);
}
