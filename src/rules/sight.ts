// Who can see what: the fog of war. Every other part of the game asks these
// functions and never works out visibility itself. The server uses `viewFor`
// to decide what each player is sent, so a mistake here leaks hidden information.
//
// Pure functions: no DOM, Node APIs, clock or randomness.

import { TERRAIN, UNITS } from '../content';
import { distance, key, line, within } from '../shared/hex';
import type { GameMap, GameState, Hex, HexKey, PlayerId, PlayerView, Unit } from '../shared/types';

/**
 * The first hex on the sight line that stops it, or null if the line is clear.
 * The two end hexes never block. The eye and the target sit at their hex's
 * elevation and the line's height is the straight interpolation between them.
 * A hex in between is as high as its elevation, plus 1 if its terrain blocks
 * sight; it stops the line if that is strictly more than the line's height
 * there. A hex off the map always blocks, and so does an end hex off the map
 * (that one is returned).
 */
export function blockingHex(map: GameMap, from: Hex, to: Hex): Hex | null {
  const a = map.cells[key(from)];
  const b = map.cells[key(to)];
  if (!a) return from;          // an end hex off the map: report it
  if (!b) return to;
  const hexes = line(from, to);
  const n = hexes.length - 1;
  for (let i = 1; i < n; i++) {
    const cell = map.cells[key(hexes[i])];
    if (!cell) return hexes[i];
    const height = cell.elevation + (TERRAIN[cell.terrain]?.blocksSight ? 1 : 0);
    // height > a + (b - a) * i / n, with both sides multiplied by n so that
    // the sum is exact and the answer is the same from either end.
    if (height * n > a.elevation * (n - i) + b.elevation * i) return hexes[i];
  }
  return null;
}

/** Is the line from one hex to another clear? Line only, no range. Symmetric. */
export function canSee(map: GameMap, from: Hex, to: Hex): boolean {
  if (from.q === to.q && from.r === to.r) return true;
  const a = map.cells[key(from)];
  const b = map.cells[key(to)];
  if (!a || !b) return false;
  return blockingHex(map, from, to) === null;
}

/**
 * How near an enemy must be to see this unit where it stands, or null if the
 * ground does not hide it at all. Hiding terrain hides a unit that has not
 * fired: one that has kept still more than one that has moved. A unit that
 * dashed, or gave itself away, is seen like one in the open.
 */
export function hideRange(map: GameMap, unit: Unit): number | null {
  const hide = TERRAIN[map.cells[key(unit.pos)]?.terrain ?? '']?.hide ?? null;
  if (!hide || unit.revealed || unit.posture === 'dashed') return null;
  return unit.posture === 'moved' ? hide.moved : hide.still;
}

/**
 * Does this unit itself see that one? Within its sight range, with a clear
 * line, and near enough for what hides the target (a spotter's `spotting` is
 * added to that distance). Says nothing of whether either is down.
 */
export function spots(map: GameMap, spotter: Unit, target: Unit): boolean {
  const def = UNITS[spotter.type];
  const d = distance(spotter.pos, target.pos);
  if (!def || d > def.sight) return false;
  if (!canSee(map, spotter.pos, target.pos)) return false;
  const near = hideRange(map, target);
  return near === null || d <= near + def.spotting;
}

const living = (state: GameState, player: PlayerId): Unit[] =>
  state.units.filter((u) => u.owner === player && u.status !== 'down');

/** Every hex the player sees now: the union over their living units. */
export function visibleHexes(state: GameState, player: PlayerId): Set<HexKey> {
  const out = new Set<HexKey>();
  if (state.eliminated[player]) {
    for (const k of Object.keys(state.map.cells)) out.add(k);
    return out;
  }
  for (const u of living(state, player)) {
    out.add(key(u.pos));
    const sight = UNITS[u.type]?.sight ?? 0;
    for (const h of within(u.pos, sight)) {
      const k = key(h);
      if (!out.has(k) && state.map.cells[k] && canSee(state.map, u.pos, h)) out.add(k);
    }
  }
  return out;
}

/** The enemy units the player can see: never one that is down. */
export function visibleEnemies(state: GameState, player: PlayerId): Unit[] {
  const enemies = state.units.filter((u) => u.owner !== player && u.status !== 'down');
  if (state.eliminated[player]) return enemies;
  const mine = living(state, player);
  return enemies.filter((e) => mine.some((f) => spots(state.map, f, e)));
}

/** What a player is sent: their own units, the enemies they see, the hexes they see. */
export function viewFor(state: GameState, player: PlayerId): PlayerView {
  const visible = visibleHexes(state, player);
  const seen = new Set(visibleEnemies(state, player).map((u) => u.id));
  return {
    player,
    map: state.map,
    playerCount: state.playerCount,
    round: state.round,
    maxRounds: state.map.maxRounds,
    units: state.units.filter((u) => u.owner === player || seen.has(u.id)),
    visible: [...visible],
    scores: [...state.scores],
    eliminated: [...state.eliminated],
    over: state.over,
    winners: [...state.winners],
  };
}
