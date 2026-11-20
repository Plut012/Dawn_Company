// Report lines: one plain sentence per notable event, in the flat voice of
// docs/design.md. Pure; the play screen feeds it the round as it plays.

import { ACTIONS, OBJECTIVE_KINDS, UNITS, WORKS } from '../../content';
import { label } from '../../shared/hex';
import { survives } from './outcome';
import type { GameEvent, PlayerId, PlayerView, Unit, UnitId } from '../../shared/types';

export interface Line { text: string; danger: boolean }

export interface Teller {
  /** The lines for the next stretch of the round's events, in order. */
  tell(events: GameEvent[]): Line[];
}

/**
 * A teller for one round. `view` is the view the round was planned from: it
 * names every unit in sight then; `spotted` events name the rest.
 * `names[seat]` is each player's name.
 */
export function teller(view: PlayerView, names: string[]): Teller {
  const me = view.player;
  const units = new Map<UnitId, Unit>(view.units.map((u) => [u.id, u]));
  const down = new Set<UnitId>();
  const stopped = new Set<UnitId>();   // blocked this round: any move it makes after that is a fall back
  let flood = false;            // the viewer has just been eliminated: everything comes into view at once

  const player = (p: PlayerId): string => names[p] ?? `Player ${p + 1}`;
  const who = (id: UnitId): string => {
    const u = units.get(id);
    if (!u) return 'A unit';
    const def = UNITS[u.type];
    if (u.owner === me) return u.name;         // "Pvt. Hale": the name carries the rank
    return `${player(u.owner)}'s ${(def?.name ?? u.type).toLowerCase()}`;
  };
  const mine = (id: UnitId): boolean => units.get(id)?.owner === me;
  const line = (text: string, danger = false): Line => ({ text, danger });
  /** An action's name, as it is in the data; `plain` for one this client does not know. */
  const action = (id: string, plain: string): string => (Object.hasOwn(ACTIONS, id) ? ACTIONS[id].name : plain);
  const lower = (s: string): string => s.toLowerCase();
  /** "the village C", "the HQ W": an objective by its kind and letter. */
  const place = (id: string): string => {
    const kind = view.map.objectives.find((o) => o.id === id)?.kind ?? '';
    const name = Object.hasOwn(OBJECTIVE_KINDS, kind) ? OBJECTIVE_KINDS[kind].name : 'objective';
    return `the ${name === 'HQ' ? name : lower(name)} ${id}`;
  };
  /** What the flags earned, one line for a run of `score` events: "Supply: you +5, Bo +3." */
  const supply = (scores: Extract<GameEvent, { t: 'score' }>[]): Line => {
    const total = new Map<PlayerId, number>();
    for (const e of scores) total.set(e.player, (total.get(e.player) ?? 0) + e.value);
    const order = [...total.keys()].sort((a, b) => (a === me ? -1 : b === me ? 1 : a - b));
    return line(`Supply: ${order.map((p) => `${p === me ? 'you' : player(p)} +${total.get(p)}`).join(', ')}.`);
  };

  function one(e: GameEvent): Line | null {
    switch (e.t) {
      case 'treat':
        return line(`${who(e.unit)}: ${lower(action(e.action, 'Treat'))} on ${who(e.target)}. Back up.`);
      case 'fire': {
        const at = label(e.target);
        if (e.unit === null) return line(`${action(e.action, 'Fire')} on ${at} from out of sight.`);
        return line(`${who(e.unit)}: ${lower(action(e.action, 'Fire'))} ${e.ambush ? 'from ambush ' : ''}at ${at}.`);
      }
      case 'launch':
        return line(`${who(e.unit)}: ${lower(action(e.action, 'Fire'))}. Rounds in the air.`);
      case 'impact':
        return line(`${action(e.action, 'Fire')} lands at ${label(e.target)}.`);
      case 'reveal':
        return line(`${who(e.unit)} given away: ${lower(action(e.action, 'an action'))}.`, mine(e.unit));
      case 'hit': {
        const name = who(e.unit);
        const at = label(e.at);
        if (e.result === 'cover') return line(`${name} hit at ${at}. Cover holds.`);
        if (e.result === 'pinned') return line(`${name} pinned at ${at}.`, mine(e.unit));
        down.add(e.unit);
        return line(`${name} down at ${at}.${survives(view.mode) ? ' For good.' : ''}`, mine(e.unit));     // Last Stand (20): nobody comes back
      }
      case 'blocked':
        stopped.add(e.unit);
        return line(`${who(e.unit)} blocked at ${label(e.at)}.`);
      case 'move':
        // A blocked unit never goes on: this is it giving up a hex it could not keep.
        return stopped.has(e.unit) ? line(`${who(e.unit)} falls back to ${label(e.to)}.`) : null;
      case 'unable': {
        // A follow-up that did not happen. A unit that went down has had its line already.
        if (e.reason === 'down') return null;
        const name = lower(action(e.action, 'act'));
        const why = {
          pinned: 'pinned', range: 'out of range', sight: 'no line', needs: `nothing to ${name}`,
          supply: 'not enough supply', blocked: 'no room for it there',   // (25) a build
        }[e.reason];
        return line(`${who(e.unit)}: ${name} called off, ${why}.`, mine(e.unit));
      }
      case 'spotted':
        units.set(e.unit.id, e.unit);
        return flood ? null : line(`${who(e.unit.id)} spotted at ${label(e.unit.pos)}.`);
      case 'lost':
        return flood || down.has(e.unit) || !units.has(e.unit) ? null : line(`${who(e.unit)} lost from sight.`);
      case 'recover':
        return line(`${who(e.unit)} recovers.`);
      case 'dig':
        return null;   // told together, in `tell`
      case 'capture': {
        const what = place(e.objective);
        if (e.player === me) return line(`You took ${what}.`);
        if (e.from === me) return line(`${player(e.player)} took ${what} from you.`, true);
        return line(`${player(e.player)} took ${what}.`);
      }
      case 'score':
        return null;   // told together, in `tell`
      case 'purchase':
        return e.player === me
          ? line(`You bought back ${who(e.unit)} for ${e.cost} supply.`)
          : line(`${player(e.player)} bought a man back for ${e.cost} supply.`);
      case 'return': {
        down.delete(e.unit);
        const hq = view.map.objectives.find((o) => o.kind === 'hq' && o.hexes.some((h) => h.q === e.at.q && h.r === e.at.r));
        const where = hq ? `the HQ ${hq.id}` : label(e.at);
        if (mine(e.unit)) {
          const u = units.get(e.unit);
          if (u) units.set(e.unit, { ...u, pos: { ...e.at }, status: 'ready' });
          return line(`${who(e.unit)} is back at ${where}.`);
        }
        return line(`${units.has(e.unit) ? who(e.unit) : 'An enemy'} comes back at ${where}.`);
      }
      case 'build': {
        // (25) A work goes up: told to its owner and to whoever sees the hex.
        const work = Object.hasOwn(WORKS, e.work) ? WORKS[e.work] : null;
        const what = work ? work.name.replace(/^[A-Z][a-z]/, (c) => c.toLowerCase()) : 'a work';   // "sandbags", "MG nest"
        if (mine(e.unit)) return line(`${who(e.unit)} builds ${what} at ${label(e.at)}${work ? ` for ${work.cost} supply` : ''}.`);
        return line(`${units.has(e.unit) ? who(e.unit) : 'The enemy'} builds ${what} at ${label(e.at)}.`);
      }
      case 'eliminated':
        if (e.player === me) {
          flood = true;
          return line(survives(view.mode) ? 'Your squad is out.' : 'Your squad is out. Your supply stands.', true);
        }
        return line(`${player(e.player)}'s squad is out.`);
      case 'over':
        return line('Cease fire. The match is over.');
      case 'phase':
        if (e.phase === 'treat') stopped.clear();
        return null;
      case 'dash':
        return null;
    }
  }

  return {
    tell(events) {
      const out: Line[] = [];
      // An eliminated player is sent `lost` for everything and then `spotted`
      // for everyone. That is bookkeeping, not news.
      if (events.some((e) => e.t === 'eliminated' && e.player === me)) flood = true;
      let scores: Extract<GameEvent, { t: 'score' }>[] = [];
      let digs: UnitId[] = [];
      const flush = () => {
        if (scores.length > 0) out.push(supply(scores));
        if (digs.length > 0) out.push(line(`Dug in: ${digs.map(who).join(', ')}.`));   // (24) one line for the round's foxholes
        scores = [];
        digs = [];
      };
      for (const e of events) {
        if (e.t === 'score') { scores.push(e); continue; }
        if (e.t === 'dig') { digs.push(e.unit); continue; }
        flush();
        const l = one(e);
        if (l) out.push(l);
      }
      flush();
      return out;
    },
  };
}
