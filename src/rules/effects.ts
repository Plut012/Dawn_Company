// What actions do. An action (src/content) lists effects; each kind of effect
// is one function in the table below, applied to one unit at a time. This is
// the only place in the rules that knows what an effect is. A new kind of
// effect is one new function here and one new variant of `Effect`.
//
// Pure: no DOM, Node APIs, clock or randomness.

import type { ActionDef, Effect, GameEvent, Hex, PlayerId, Unit, UnitId } from '../shared/types';

/** One use of an action: who, what, at which hex. */
export interface Use { user: Unit; action: ActionDef; target: Hex }

/** What an effect may ask of the round being resolved. */
export interface World {
  round: number;
  /** Uses up the unit's cover for this round, if it has any left. True if it had. */
  shelter(unit: Unit): boolean;
  /** Running in the open: no cover, and down from one hit. */
  exposed(unit: Unit): boolean;
  /** Does this player know of this unit just now (its own, or in sight)? */
  sees(player: PlayerId, unit: UnitId): boolean;
  /** Record an event; each player is told the version `told` gives them, or nothing. */
  record(event: GameEvent, told: (player: PlayerId) => GameEvent | null): void;
  /** Bring every player's sight up to date after something changed who can be seen. */
  refresh(): void;
}

type Apply<E extends Effect> = (world: World, effect: E, use: Use, unit: Unit) => void;

const EFFECTS: { [K in Effect['kind']]: Apply<Extract<Effect, { kind: K }>> } = {
  /** The hit rule: cover takes the first, then ready -> pinned -> down; a runner goes straight down. */
  hit(world, effect, _use, unit) {
    let result: 'cover' | 'pinned' | 'down';
    if (!effect.ignoresCover && world.shelter(unit)) result = 'cover';
    else if (world.exposed(unit) || unit.status === 'pinned') result = 'down';
    else result = 'pinned';
    // Judged before the change: a unit seen going down is still "seen" here.
    const event: GameEvent = { t: 'hit', unit: unit.id, at: { q: unit.pos.q, r: unit.pos.r }, result };
    world.record(event, (p) => (world.sees(p, unit.id) ? event : null));
    if (result === 'down') { unit.status = 'down'; unit.pinnedRound = null; }
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

/** Apply one effect of an action to one unit. An effect of a kind not in the table does nothing. */
export function applyEffect(world: World, effect: Effect, use: Use, unit: Unit): void {
  const apply = EFFECTS[effect.kind] as Apply<Effect> | undefined;
  if (Object.hasOwn(EFFECTS, effect.kind)) apply?.(world, effect, use, unit);
}
