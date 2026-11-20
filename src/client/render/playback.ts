// Playback: one player's events for a resolved round, shown in order.
//
// The events are cut into moments. A moment's events play together; moments
// play one after another. For each event the kit's `effect` (if it has one)
// supplies the look and its promise the length; playback applies what lasts:
// where units stand, their status, which are on the board at all, whose
// flag flies over each objective, and (25) the works put up on the ground.
//
// It never hangs: an effect that throws is skipped, one that never settles is
// cut off, and when the stage says `skip` (tab hidden, board disposed) the
// rest is applied at once.

import type { GameEvent, Hex, PlayerId, Unit, UnitId, WorkId } from '../../shared/types';
import type { KitCtx, VisualKit } from './kit';

/** What playback needs from the board. */
export interface Stage {
  effect: VisualKit['effect'];        // the kit's, or undefined
  ctx: KitCtx;
  viewer(): PlayerId | null;          // whose view is on the board
  units: Map<UnitId, Unit>;           // the board's own copies; playback changes them
  show(unit: Unit): void;             // add the unit's piece, or snap it to `unit`
  hide(id: UnitId): void;             // take the piece off the board
  flag?(objective: string, owner: PlayerId | null): void;   // show this owner's flag over the objective
  work?(at: Hex, work: WorkId): void;                       // (25) draw the hex again with the work's terrain
  skip(): boolean;                    // true: stop animating, apply the rest now
}

export const BEAT = 300;      // ms: the pause a `phase` gives, when something follows it
export const JUMP = 260;      // ms a moment lasts with a kit that has no `effect`
export const GUARD = 4000;    // ms after which an effect is given up on
const VOLLEY = 450;           // ms over which a moment's shots are spread
const VOLLEY_GAP = 110;       // ms between two shots at most

export type MomentKind = 'beat' | 'shots' | 'hits' | 'step' | 'impact' | 'stand' | 'capture' | 'score' | 'sight' | 'none';
export interface Moment { kind: MomentKind; events: GameEvent[] }

function kindOf(e: GameEvent): MomentKind {
  switch (e.t) {
    case 'phase': return 'beat';
    case 'fire': case 'launch': return 'shots';
    case 'hit': return 'hits';
    case 'move': case 'blocked': return 'step';
    case 'impact': return 'impact';
    case 'treat': case 'recover': case 'reveal': case 'return': case 'dig': case 'build': return 'stand';
    case 'capture': return 'capture';
    case 'score': return 'score';
    case 'spotted': case 'lost': return 'sight';
    default: return 'none';
  }
}

/**
 * Cut a round into moments.
 * - Consecutive shots are one moment; so are consecutive hits, recoveries,
 *   captures, and scores. A movement step is its `blocked` events and the `move`
 *   events that share a `step`. Each `phase` and each `impact` stands alone.
 * - A follow-up's shots (the `assault` phase) are shots like any other; one
 *   that did not happen (`unable`) is a line in the report and nothing on
 *   the board.
 * - `spotted` and `lost` never make the round longer than they must: just
 *   before a shot they join that volley (a shooter showing himself), and
 *   otherwise they join the moment they follow.
 */
export function moments(events: GameEvent[]): Moment[] {
  const out: Moment[] = [];
  let sight: GameEvent[] = [];
  const open = (kind: MomentKind): Moment => {
    const m: Moment = { kind, events: [] };
    out.push(m);
    return m;
  };
  const settleSight = () => {
    if (sight.length === 0) return;
    const cur = out.at(-1);
    const into: Moment = cur && cur.kind !== 'beat' ? cur : open('sight');
    into.events.push(...sight);
    sight = [];
  };
  for (const e of events) {
    const kind = kindOf(e);
    if (kind === 'sight') { sight.push(e); continue; }
    const last = out.at(-1);
    if (kind === 'shots') {
      const volley: Moment = last?.kind === 'shots' ? last : open('shots');
      volley.events.push(...sight, e);
      sight = [];
      continue;
    }
    settleSight();
    let joins = last !== undefined && last.kind === kind && (kind === 'hits' || kind === 'stand' || kind === 'capture' || kind === 'score' || kind === 'none');
    if (kind === 'step' && last?.kind === 'step') {
      const moved = last.events.find((x) => x.t === 'move');
      // `blocked` comes before the moves of its step; a different step number is a new step.
      joins = e.t === 'move' ? !moved || (moved.t === 'move' && moved.step === e.step) : !moved;
    }
    (joins && last ? last : open(kind)).events.push(e);
  }
  settleSight();
  return out;
}

/** The unit whose piece an event changes: its events within a moment play in turn. */
function subject(e: GameEvent): UnitId | null {
  switch (e.t) {
    case 'hit': case 'move': case 'blocked': case 'lost': case 'recover': case 'reveal': case 'return': case 'dig': case 'dash': return e.unit;
    case 'spotted': return e.unit.id;
    case 'treat': return e.target;
    default: return null;
  }
}

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export function createPlayback(stage: Stage): (events: GameEvent[]) => Promise<void> {
  const { units } = stage;

  /** Run the kit's effect for one event; settle whatever it does. */
  function effect(e: GameEvent): Promise<void> {
    if (!stage.effect || stage.skip()) return Promise.resolve();
    return new Promise((done) => {
      const timer = setTimeout(done, GUARD);
      const end = (err?: unknown) => {
        if (err !== undefined) console.error(`Playback: the effect for "${e.t}" failed and was skipped.`, err);
        clearTimeout(timer);
        done();
      };
      try {
        Promise.resolve(stage.effect!(e, stage.ctx)).then(() => end(), (err) => end(err ?? 'rejected'));
      } catch (err) {
        end(err ?? 'threw');
      }
    });
  }

  /** What must be true before the effect starts. */
  function before(e: GameEvent): void {
    if (e.t === 'return') {
      // Back at the HQ (18): the piece is put there on its feet, and the kit brings it in.
      const u = units.get(e.unit);
      if (!u) return;          // an enemy: its `spotted` follows and puts it on the board
      u.pos = { ...e.at };
      u.status = 'ready';
      u.returnRound = null;
      u.dugIn = false;
      stage.show(u);
      return;
    }
    if (e.t === 'move' || e.t === 'dash') {
      // The first step, or the run, leaves the foxhole (24): the sandbags stay behind, not walk off with him.
      const u = units.get(e.unit);
      if (u?.dugIn) { u.dugIn = false; stage.show(u); }
      return;
    }
    if (e.t !== 'spotted') return;
    const unit = { ...e.unit, pos: { ...e.unit.pos } };
    units.set(unit.id, unit);
    stage.show(unit);
  }

  /** What lasts once the effect has finished. */
  function after(e: GameEvent): void {
    const set = (id: UnitId, change: (u: Unit) => void) => {
      const u = units.get(id);
      if (!u) return;
      change(u);
      stage.show(u);
    };
    switch (e.t) {
      case 'move': set(e.unit, (u) => { u.pos = { ...e.to }; }); break;
      case 'hit': {
        const result = e.result;
        if (result !== 'cover') set(e.unit, (u) => { u.status = result; if (result === 'down') u.dugIn = false; });
        break;
      }
      case 'recover': set(e.unit, (u) => { u.status = 'ready'; }); break;
      case 'dig': set(e.unit, (u) => { u.dugIn = true; }); break;
      case 'treat': set(e.target, (u) => { u.status = 'ready'; }); break;
      case 'lost': units.delete(e.unit); stage.hide(e.unit); break;
      case 'capture': stage.flag?.(e.objective, e.player); break;
      case 'build': stage.work?.(e.at, e.work); break;
      default: break;
    }
  }

  async function one(e: GameEvent): Promise<void> {
    before(e);
    await effect(e);
    after(e);
    // A view never holds an enemy that is down (see viewFor), so one that
    // goes down in sight leaves the board the way a lost unit does.
    if (e.t === 'hit' && e.result === 'down') {
      const u = units.get(e.unit);
      if (u && u.owner !== stage.viewer()) await one({ t: 'lost', unit: e.unit });
    }
  }

  async function moment(m: Moment, more: boolean): Promise<void> {
    if (m.kind === 'beat') {
      if (more && !stage.skip()) await wait(BEAT);
      return;
    }
    const turn = new Map<UnitId, Promise<void>>();
    const all: Promise<void>[] = [];
    const shots = m.events.filter((e) => kindOf(e) === 'shots').length;
    const gap = Math.min(VOLLEY_GAP, VOLLEY / Math.max(1, shots - 1));
    let shot = 0;
    for (const e of m.events) {
      const id = subject(e);
      const delay = kindOf(e) === 'shots' ? Math.round(shot++ * gap) : 0;
      const p = (id !== null ? turn.get(id) ?? Promise.resolve() : Promise.resolve())
        .then(() => (delay > 0 && !stage.skip() ? wait(delay) : undefined))
        .then(() => one(e));
      if (id !== null) turn.set(id, p);
      all.push(p);
    }
    if (!stage.effect && m.kind !== 'none' && !stage.skip()) all.push(wait(JUMP));
    await Promise.all(all);
  }

  return async function play(events: GameEvent[]): Promise<void> {
    const list = moments(events);
    for (let i = 0; i < list.length; i++) {
      // A phase with nothing to watch in it gets no pause.
      const next = list[i + 1];
      try {
        await moment(list[i], next !== undefined && next.kind !== 'beat' && next.kind !== 'none');
      } catch (err) {
        console.error('Playback: a moment failed and was skipped.', err);
      }
    }
    for (const u of units.values()) stage.show(u);   // whatever an effect left askew
  };
}
