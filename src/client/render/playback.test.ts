// Playback without a screen: how a round is cut into moments, what is left
// on the board afterwards, and that it always finishes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BEAT, GUARD, JUMP, createPlayback, moments, type Stage } from './playback';
import { DEFAULT_MAP, MAPS, PRESETS } from '../../content';
import { createMatch, findPath, orderOptions, resolve, viewFor } from '../../rules';
import { distance, parseKey } from '../../shared/hex';
import type { GameEvent, Hex, Order, Unit, UnitId } from '../../shared/types';

const hex = (q: number, r: number): Hex => ({ q, r });
const unit = (id: UnitId, owner: number, pos: Hex, status: Unit['status'] = 'ready'): Unit => ({
  id, owner, type: 'rifleman', name: id, pos, status, pinnedRound: null, revealed: false, posture: 'still',
});

function stageOf(units: Unit[], effect?: Stage['effect'], viewer = 0) {
  const log: string[] = [];
  let skipping = false;
  const stage: Stage = {
    effect,
    ctx: { scene: new THREE.Scene(), hexToWorld: () => new THREE.Vector3(), unitObject: () => null },
    viewer: () => viewer,
    units: new Map(units.map((u) => [u.id, { ...u }])),
    show: (u) => log.push(`show ${u.id} ${u.pos.q},${u.pos.r} ${u.status}`),
    hide: (id) => log.push(`hide ${id}`),
    skip: () => skipping,
  };
  return { stage, log, play: createPlayback(stage), skip: (on: boolean) => { skipping = on; } };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('moments', () => {
  const kinds = (events: GameEvent[]) => moments(events).map((m) => `${m.kind}:${m.events.map((e) => e.t).join('+')}`);

  it('plays a volley together, with a shooter who shows himself, then its hits', () => {
    const shooter = unit('1-0', 1, hex(3, 0));
    expect(kinds([
      { t: 'phase', phase: 'fire' },
      { t: 'spotted', unit: shooter },
      { t: 'fire', unit: '1-0', from: hex(3, 0), target: hex(0, 0), blast: 0, ambush: false, action: 'rifle' },
      { t: 'fire', unit: '0-0', from: hex(0, 0), target: hex(3, 0), blast: 0, ambush: false, action: 'rifle' },
      { t: 'launch', unit: '0-1', from: hex(0, 1), action: 'shell' },
      { t: 'hit', unit: '0-0', at: hex(0, 0), result: 'pinned' },
      { t: 'hit', unit: '1-0', at: hex(3, 0), result: 'cover' },
      { t: 'lost', unit: '1-0' },
    ])).toEqual(['beat:phase', 'shots:spotted+fire+fire+launch', 'hits:hit+hit+lost']);
  });

  it('plays moves of one step together and keeps steps apart', () => {
    expect(kinds([
      { t: 'phase', phase: 'move' },
      { t: 'blocked', unit: '0-2', at: hex(5, 5) },
      { t: 'move', step: 1, unit: '0-0', from: hex(0, 0), to: hex(1, 0) },
      { t: 'move', step: 1, unit: '0-1', from: hex(0, 1), to: hex(1, 1) },
      { t: 'lost', unit: '1-3' },
      { t: 'move', step: 2, unit: '0-0', from: hex(1, 0), to: hex(2, 0) },
      { t: 'spotted', unit: unit('1-0', 1, hex(4, 0)) },
      { t: 'fire', unit: '1-0', from: hex(4, 0), target: hex(2, 0), blast: 0, ambush: true, action: 'rifle' },
      { t: 'hit', unit: '0-0', at: hex(2, 0), result: 'down' },
      { t: 'blocked', unit: '0-1', at: hex(1, 1) },
      { t: 'move', step: 3, unit: '0-3', from: hex(7, 7), to: hex(7, 8) },
    ])).toEqual([
      'beat:phase', 'step:blocked+move+move+lost', 'step:move', 'shots:spotted+fire', 'hits:hit', 'step:blocked+move',
    ]);
  });

  it('gives each mortar its own impact, and sight changes after a phase their own moment', () => {
    expect(kinds([
      { t: 'phase', phase: 'treat' },
      { t: 'lost', unit: '1-0' },
      { t: 'phase', phase: 'mortar' },
      { t: 'impact', target: hex(1, 1), blast: 1, action: 'shell' },
      { t: 'impact', target: hex(4, 4), blast: 1, action: 'shell' },
      { t: 'hit', unit: '0-0', at: hex(4, 4), result: 'pinned' },
      { t: 'phase', phase: 'score' },
      { t: 'score', objective: 'A', player: 0, value: 1 },
      { t: 'score', objective: 'B', player: 1, value: 1 },
      { t: 'recover', unit: '0-1' },
      { t: 'eliminated', player: 1 },
      { t: 'over', scores: [1, 1], winners: [0, 1] },
    ])).toEqual([
      'beat:phase', 'sight:lost', 'beat:phase', 'impact:impact', 'impact:impact', 'hits:hit',
      'beat:phase', 'score:score+score', 'stand:recover', 'none:eliminated+over',
    ]);
  });
});

describe('playback', () => {
  it('leaves the board as the events say, with or without effects', async () => {
    const events: GameEvent[] = [
      { t: 'phase', phase: 'treat' },
      { t: 'treat', unit: '0-3', target: '0-2', action: 'aid' },
      { t: 'phase', phase: 'fire' },
      { t: 'hit', unit: '0-0', at: hex(0, 0), result: 'pinned' },
      { t: 'hit', unit: '0-0', at: hex(0, 0), result: 'down' },
      { t: 'hit', unit: '0-1', at: hex(0, 1), result: 'cover' },
      { t: 'hit', unit: '1-0', at: hex(5, 0), result: 'down' },
      { t: 'phase', phase: 'move' },
      { t: 'move', step: 1, unit: '0-1', from: hex(0, 1), to: hex(1, 1) },
      { t: 'spotted', unit: unit('1-1', 1, hex(4, 1), 'pinned') },
      { t: 'move', step: 2, unit: '0-1', from: hex(1, 1), to: hex(2, 1) },
      { t: 'lost', unit: '1-2' },
      { t: 'phase', phase: 'score' },
      { t: 'recover', unit: '0-3' },
    ];
    const start = [
      unit('0-0', 0, hex(0, 0)), unit('0-1', 0, hex(0, 1)), unit('0-2', 0, hex(0, 2), 'pinned'),
      unit('0-3', 0, hex(0, 3), 'pinned'), unit('1-0', 1, hex(5, 0)), unit('1-2', 1, hex(5, 2)),
    ];
    const seen: string[] = [];
    const withEffects = stageOf(start, async (e) => { seen.push(e.t); });
    const without = stageOf(start);
    await Promise.all([withEffects.play(events), without.play(events)]);
    for (const { stage } of [withEffects, without]) {
      const got = [...stage.units.values()].map((u) => `${u.id} ${u.pos.q},${u.pos.r} ${u.status}`).sort();
      expect(got).toEqual([
        '0-0 0,0 down',       // pinned, then down: both hits, in order
        '0-1 2,1 ready',      // cover changes nothing; two steps
        '0-2 0,2 ready',      // treated
        '0-3 0,3 ready',      // recovered
        '1-1 4,1 pinned',     // spotted, as it was sent
      ]);                     // 1-0 went down in sight and 1-2 was lost: both off the board
    }
    expect(without.log).toContain('hide 1-0');
    expect(without.log).toContain('hide 1-2');
    // An enemy going down is shown leaving: the kit is asked for a `lost` after the `hit`.
    expect(seen.filter((t) => t === 'lost')).toHaveLength(2);
    expect(seen).not.toContain('phase');
  });

  it('plays one unit\'s events in a moment in turn, and different units together', async () => {
    const order: string[] = [];
    const { play } = stageOf([unit('0-0', 0, hex(0, 0)), unit('0-1', 0, hex(0, 1))], async (e) => {
      const who = e.t === 'hit' ? `${e.unit} ${e.result}` : e.t;
      order.push(`start ${who}`);
      await new Promise((done) => setTimeout(done, 20));
      order.push(`end ${who}`);
    });
    await play([
      { t: 'hit', unit: '0-0', at: hex(0, 0), result: 'pinned' },
      { t: 'hit', unit: '0-1', at: hex(0, 1), result: 'pinned' },
      { t: 'hit', unit: '0-0', at: hex(0, 0), result: 'down' },
    ]);
    const at = (line: string) => order.indexOf(line);
    expect(order).toHaveLength(6);
    expect(at('start 0-1 pinned')).toBeLessThan(at('end 0-0 pinned'));     // together
    expect(at('end 0-0 pinned')).toBeLessThan(at('start 0-0 down'));       // in turn
  });

  it('skips an effect that throws or rejects and still finishes right', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const { stage, play } = stageOf([unit('0-0', 0, hex(0, 0))], (e) => {
      calls++;
      if (e.t === 'move') throw new Error('broken kit');
      return Promise.reject(new Error('broken kit'));
    });
    await play([
      { t: 'move', step: 1, unit: '0-0', from: hex(0, 0), to: hex(1, 0) },
      { t: 'hit', unit: '0-0', at: hex(1, 0), result: 'pinned' },
    ]);
    expect(calls).toBe(2);
    expect(stage.units.get('0-0')).toMatchObject({ pos: hex(1, 0), status: 'pinned' });
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('gives up on an effect that never settles', async () => {
    vi.useFakeTimers();
    const { stage, play } = stageOf([unit('0-0', 0, hex(0, 0))], () => new Promise(() => {}));
    let done = false;
    void play([{ t: 'move', step: 1, unit: '0-0', from: hex(0, 0), to: hex(1, 0) }]).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(GUARD - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true);
    expect(stage.units.get('0-0')?.pos).toEqual(hex(1, 0));
  });

  it('applies the rest at once when told to skip (hidden tab)', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const s = stageOf([unit('0-0', 0, hex(0, 0))], async () => { calls++; });
    s.skip(true);
    let done = false;
    void s.play([
      { t: 'phase', phase: 'move' },
      { t: 'move', step: 1, unit: '0-0', from: hex(0, 0), to: hex(1, 0) },
      { t: 'phase', phase: 'score' },
      { t: 'score', objective: 'A', player: 0, value: 1 },
    ]).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);   // no timers needed: only promises
    expect(done).toBe(true);
    expect(calls).toBe(0);
    expect(s.stage.units.get('0-0')?.pos).toEqual(hex(1, 0));
  });

  it('times a round by its moments: a beat per phase with something in it', async () => {
    vi.useFakeTimers();
    const timed = async (events: GameEvent[]) => {
      const { play } = stageOf([unit('0-0', 0, hex(0, 0))]);   // a kit with no effect
      const start = Date.now();
      const p = play(events);
      await vi.runAllTimersAsync();
      await p;
      return Date.now() - start;
    };
    const phases: GameEvent[] = (['treat', 'fire', 'move', 'assault', 'mortar', 'score'] as const).map((phase) => ({ t: 'phase', phase }));
    expect(await timed(phases)).toBe(0);   // an empty round
    expect(await timed([...phases, { t: 'over', scores: [0, 0], winners: [0, 1] }])).toBe(0);
    expect(await timed([
      phases[2],
      { t: 'move', step: 1, unit: '0-0', from: hex(0, 0), to: hex(1, 0) },
      { t: 'move', step: 2, unit: '0-0', from: hex(1, 0), to: hex(2, 0) },
      phases[4],
    ])).toBe(BEAT + 2 * JUMP);
  });

  it('ends every real round on exactly the view the rules give next', async () => {
    // Real squads, real orders: everyone fires at whatever they can see, or walks to the middle.
    const map = MAPS[DEFAULT_MAP];
    let state = createMatch(map, [0, 1, 2, 3].map((player) => ({ player, units: PRESETS[player % PRESETS.length].units })));
    const middle = map.objectives.find((o) => o.id === 'D')!.hex;
    let checked = 0;
    for (let round = 0; round < 8 && !state.over; round++) {
      const orders = [0, 1, 2, 3].map((p) => {
        const view = viewFor(state, p);
        const list: Order[] = [];
        view.units.filter((u) => u.owner === p && u.status !== 'down').forEach((u, i) => {
          const options = orderOptions(view, u.id);
          const foe = view.units.find((e) => e.owner !== p && options.fire.includes(`${e.pos.q},${e.pos.r}`));
          if (foe) { list.push({ unit: u.id, kind: 'fire', target: foe.pos }); return; }
          const kind = i % 2 ? 'dash' : 'move';
          const ends = options[kind].map(parseKey).sort((x, y) => distance(x, middle) - distance(y, middle));
          const path = ends[0] && findPath(map, u.pos, ends[0], 99);
          if (path && path.length > 0 && options.kinds.includes(kind)) list.push({ unit: u.id, kind, path });
        });
        return list;
      });
      const result = resolve(state, orders);
      for (const p of [0, 1, 2, 3]) {
        const before = viewFor(state, p);
        const { stage, play } = stageOf(before.units, undefined, p);
        vi.useFakeTimers();
        const done = play(result.playerEvents[p]);
        await vi.runAllTimersAsync();
        await done;
        vi.useRealTimers();
        const show = (u: Unit) => `${u.id} ${u.pos.q},${u.pos.r} ${u.status}`;
        expect([...stage.units.values()].map(show).sort()).toEqual(viewFor(result.state, p).units.map(show).sort());
        checked++;
      }
      state = result.state;
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });
});
