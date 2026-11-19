import { describe, expect, it } from 'vitest';
import { createPlayback } from '../client/render/playback';
import type { Stage } from '../client/render/playback';
import { ACTIONS, TERRAIN, UNITS } from '../content';
import { canSee, resolve, validateOrders, visibleEnemies } from '../rules';
import { distance, key, label } from '../shared/hex';
import type { GameEvent, Order, OrderKind, Phase, Unit, UnitId } from '../shared/types';
import {
  GROUPS, LESSONS, checkLesson, fire, hex, lessonById, move, runLesson, stageLesson, tinyMap,
} from './lessons';
import type { Lesson } from './lessons';
import {
  UMPIRE_SEAT, eventsOf, manualSearch, orderMarks, outcome, phaseChunks, stopsFor, viewOf,
} from './show';
import type { Viewpoint } from './show';

const byId = (id: string): Lesson => {
  const l = lessonById(id);
  if (!l) throw new Error(`no lesson ${id}`);
  return l;
};
const viewpoints = (l: Lesson): Viewpoint[] => [...stageLesson(l).eliminated.map((_, p) => p), 'umpire'];
const sentences = (text: string): number => text.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim() !== '').length;

/** The board's playback on a stage with no kit: nothing is drawn, everything that lasts is applied. */
async function playOn(view: ReturnType<typeof viewOf>, lists: GameEvent[][]): Promise<Map<UnitId, Unit>> {
  const units = new Map<UnitId, Unit>(view.units.map((u) => [u.id, { ...u, pos: { ...u.pos } }]));
  const stage: Stage = {
    effect: undefined,
    ctx: {} as Stage['ctx'],
    viewer: () => view.player,
    units,
    show: () => {},
    hide: () => {},
    skip: () => true,
  };
  const play = createPlayback(stage);
  for (const events of lists) await play(events);
  return units;
}
const standing = (units: Iterable<Unit>): string[] =>
  [...units].map((u) => `${u.id} ${label(u.pos)} ${u.status}`).sort();

describe('the lessons', () => {
  it('are the nineteen of the tasks, in order, with unique url-safe ids', () => {
    expect(LESSONS.map((l) => l.id)).toEqual([
      'sight', 'stealth', 'creep', 'reveal', 'move-dash', 'collide', 'pass', 'hit', 'cover', 'dash-risk', 'move-fire',
      'gunner', 'sniper', 'mortar', 'medic', 'ambush', 'pinned', 'phases', 'score',
    ]);
    for (const l of LESSONS) expect(l.id).toMatch(/^[a-z0-9-]+$/);
    // Grouped as the list shows them: each group's lessons sit together, groups in order.
    const order = LESSONS.map((l) => GROUPS.indexOf(l.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order).not.toContain(-1);
  });

  for (const lesson of LESSONS) {
    describe(lesson.id, () => {
      const run = runLesson(lesson);

      it('gives only orders the rules accept, each round', () => {
        lesson.rounds.forEach((orders, r) => {
          for (let p = 0; p < run.states[r].playerCount; p++) {
            expect(validateOrders(run.states[r], p, orders[p] ?? []), `round ${r + 1}, player ${p}`).toEqual([]);
          }
        });
      });

      it('holds: every expectation is met', () => {
        expect(lesson.expect.length).toBeGreaterThan(0);
        expect(checkLesson(lesson)).toEqual([]);
      });

      it('says it in a title and at most two sentences', () => {
        expect(lesson.title.length).toBeGreaterThan(0);
        expect(sentences(lesson.text)).toBeGreaterThanOrEqual(1);
        expect(sentences(lesson.text)).toBeLessThanOrEqual(2);
        for (const note of Object.values(lesson.notes ?? {})) expect(sentences(note)).toBeLessThanOrEqual(2);
      });

      it('is tiny, with one unit to a hex and both sides on the map', () => {
        expect(lesson.map.cols * lesson.map.rows).toBeLessThanOrEqual(25);
        const at = run.states[0].units.map((u) => key(u.pos));
        expect(new Set(at).size).toBe(at.length);
        expect(run.states[0].playerCount).toBe(2);
        expect(run.states.length).toBe(lesson.rounds.length + 1);
        // Never over before its last round: every round is really played.
        run.states.slice(0, -1).forEach((s) => expect(s.over).toBe(false));
      });

      it('steps through every event once, in order, from every viewpoint', () => {
        for (const v of viewpoints(lesson)) {
          const stops = stopsFor(lesson, run, v);
          run.results.forEach((result, r) => {
            const mine = stops.filter((s) => s.kind === 'phase' && s.round === r);
            const played = mine.flatMap((s) => (s.kind === 'phase' ? s.chunks.flatMap((c) => c.events) : []));
            expect(played).toEqual(eventsOf(result, v));
            expect(stops.some((s) => s.kind === 'orders' && s.round === r)).toBe(r > 0);
          });
          // Every phase is passed, in the fixed order.
          const phases = phaseChunks(eventsOf(run.results[0], v)).map((c) => c.phase);
          expect(phases).toEqual(['treat', 'fire', 'move', 'assault', 'mortar', 'score']);
        }
      });

      it('played phase by phase, leaves the board as playing the round whole does, and as the next state stands', async () => {
        for (const v of viewpoints(lesson)) {
          for (let r = 0; r < lesson.rounds.length; r++) {
            const events = eventsOf(run.results[r], v);
            const view = viewOf(run.states[r], v);
            const whole = await playOn(view, [events]);
            const stepped = await playOn(view, phaseChunks(events).map((c) => c.events));
            expect(standing(stepped.values()), `${v}, round ${r + 1}`).toEqual(standing(whole.values()));
            expect(standing(whole.values()), `${v}, round ${r + 1}`).toEqual(standing(viewOf(run.states[r + 1], v).units));
          }
        }
      });

      it('ends in one plain line', () => {
        const line = outcome(lesson, run);
        expect(line).not.toBe('Done.');
        expect(line.length).toBeLessThanOrEqual(110);
      });
    });
  }

  it('between them use every order, every unit, every hit result and every phase', () => {
    const kinds = new Set<OrderKind>();
    const types = new Set<string>();
    const results = new Set<string>();
    const phases = new Set<Phase>();
    for (const l of LESSONS) {
      for (const u of l.units) types.add(u.type);
      for (const round of l.rounds) for (const orders of round) for (const o of orders) kinds.add(o.kind);
      for (const r of runLesson(l).results) {
        for (const e of r.events) {
          if (e.t === 'hit') results.add(e.result);
          if (e.t === 'phase') phases.add(e.phase);
        }
      }
    }
    expect([...kinds].sort()).toEqual(['ambush', 'dash', 'fire', 'move', 'special']);
    expect([...types].sort()).toEqual(Object.keys(UNITS).sort());
    expect([...results].sort()).toEqual(['cover', 'down', 'pinned']);
    expect([...phases].sort()).toEqual(['assault', 'fire', 'mortar', 'move', 'score', 'treat']);
  });
});

// What `expect` cannot say: how things stood before, and what would have happened otherwise.
describe('each lesson shows its rule, not something beside it', () => {
  const sees = (state: ReturnType<typeof stageLesson>, player: number, id: string): boolean =>
    visibleEnemies(state, player).some((u) => u.id === id);
  /** The lesson's first round again, with one player's orders replaced. */
  const instead = (l: Lesson, player: number, orders: Order[]) => {
    const all = l.rounds[0].map((o) => [...o]);
    all[player] = orders;
    return resolve(stageLesson(l), all);
  };
  const hits = (events: GameEvent[]): string[] => events.flatMap((e) => (e.t === 'hit' ? [`${e.unit} ${e.result}`] : []));

  it('sight: unseen from the low ground, seen from the hill', () => {
    const run = runLesson(byId('sight'));
    expect(sees(run.states[0], 0, '1-0')).toBe(false);
    expect(sees(run.states[1], 0, '1-0')).toBe(true);
    expect(run.states[0].map.cells[key(hex('B2'))].elevation).toBeGreaterThan(run.states[0].map.cells[key(hex('A2'))].elevation);
  });

  it('stealth: the hex is seen from the start, the man only from the distance the woods hide him to', () => {
    const l = byId('stealth');
    const run = runLesson(l);
    const man = run.states[0].units.find((u) => u.id === '1-0')!;
    expect(viewOf(run.states[0], 0).visible).toContain(key(man.pos));
    expect(sees(run.states[0], 0, '1-0')).toBe(false);
    expect(sees(run.states[1], 0, '1-0')).toBe(true);
    const walker = run.states[1].units.find((u) => u.id === '0-0')!;
    expect(distance(walker.pos, man.pos)).toBe(TERRAIN.woods.hide!.still);
    // One step short of that, with the same clear line, he sees nothing: the first step of the walk.
    const short = instead(l, 0, [move('0-0', 'C2')]);
    expect(distance(short.state.units.find((u) => u.id === '0-0')!.pos, man.pos)).toBe(TERRAIN.woods.hide!.still + 1);
    expect(sees(short.state, 0, '1-0')).toBe(false);
    // And he is spotted on the second step, not before.
    const spotted = run.results[0].playerEvents[0].findIndex((e) => e.t === 'spotted');
    const steps = run.results[0].playerEvents[0].slice(0, spotted).filter((e) => e.t === 'move');
    expect(steps.length).toBe(2);
  });

  it('creep: both come to one hex beyond where a mover is seen from; the runner is seen from the fire phase, the creeper never', () => {
    const l = byId('creep');
    const run = runLesson(l);
    const watcher = run.states[0].units.find((u) => u.id === '0-0')!;
    const beyond = TERRAIN.woods.hide!.moved! + 1;
    // The two routes are the same length, through the same terrain, at the same distance from the watcher.
    for (const [id, order] of [['1-0', l.rounds[0][1][0]], ['1-1', l.rounds[0][1][1]]] as const) {
      const start = run.states[0].units.find((u) => u.id === id)!;
      if (order.kind !== 'move' && order.kind !== 'dash') throw new Error('not a walk');
      expect(order.path.length).toBe(2);
      for (const h of [start.pos, ...order.path]) {
        expect(distance(watcher.pos, h)).toBeGreaterThanOrEqual(beyond);
        expect(l.map.cells[key(h)].terrain).toBe('woods');
      }
      // Both walks end exactly one hex beyond where a mover is seen from, the watcher's line clear.
      expect(distance(watcher.pos, order.path[1])).toBe(beyond);
      expect(canSee(l.map, watcher.pos, order.path[1])).toBe(true);
    }
    expect(sees(run.states[0], 0, '1-0')).toBe(false);
    expect(sees(run.states[0], 0, '1-1')).toBe(false);
    const blue = run.results[0].playerEvents[0];
    const names = blue.map((e) => (e.t === 'phase' ? e.phase : e.t === 'spotted' ? `spotted ${e.unit.id}` : e.t === 'move' ? `move ${e.unit}` : e.t));
    // Seen as he breaks cover, then watched all the way; of the other man, nothing at all.
    expect(names).toEqual(['treat', 'fire', 'spotted 1-0', 'dash', 'move', 'move 1-0', 'move 1-0', 'assault', 'mortar', 'score']);
    expect(JSON.stringify(blue)).not.toContain('"1-1"');
    expect(run.states[1].units.map((u) => u.posture)).toEqual(['still', 'dashed', 'moved']);
    // The same route at a walk instead: neither is seen.
    const walked = instead(l, 1, [move('1-0', 'E1', 'D1'), move('1-1', 'B1', 'C1')]);
    expect(sees(walked.state, 0, '1-0')).toBe(false);
    // One hex nearer, the creeper is seen too.
    const nearer: Lesson = { ...l, units: l.units.map((u) => (u.owner === 0 ? { ...u, at: 'C3' } : u)) };
    expect(sees(runLesson(nearer).states[1], 0, '1-1')).toBe(true);
  });

  it('reveal: hidden, seen after firing and through the next planning, hidden when the next round resolves', () => {
    const run = runLesson(byId('reveal'));
    expect(sees(run.states[0], 0, '1-0')).toBe(false);
    expect(sees(run.states[1], 0, '1-0')).toBe(true);        // what Blue plans round 2 from
    expect(sees(run.states[2], 0, '1-0')).toBe(false);
    // He is lost at the very start of round 2, not at its end.
    const blue = run.results[1].playerEvents[0];
    expect(blue[0]).toEqual({ t: 'phase', phase: 'treat' });
    expect(blue[1]).toEqual({ t: 'lost', unit: '1-0' });
  });

  it('dash-risk: the same shot at the same man without a dash order is stopped by the building', () => {
    const l = byId('dash-risk');
    expect(hits(runLesson(l).results[0].events)).toEqual(['1-0 down']);
    expect(hits(instead(l, 1, []).events)).toEqual(['1-0 cover']);
  });

  it('cover and hit: the same two shots, behind a wall and in the open', () => {
    expect(hits(runLesson(byId('cover')).results[0].events)).toEqual(['1-0 cover', '1-0 pinned']);
    expect(hits(runLesson(byId('hit')).results[0].events)).toEqual(['1-0 pinned', '1-0 down', '0-0 pinned']);
  });

  it('sniper: the rifleman is out of his own range, and a rifle shot would have been stopped by the building', () => {
    const l = byId('sniper');
    const start = stageLesson(l);
    expect(validateOrders(start, 1, [fire('1-0', 'A2')]).map((e) => e.reason)).toEqual(['target is out of range']);
    expect(ACTIONS[UNITS.rifleman.fire!].effects).toEqual([{ kind: 'hit' }]);
    expect(ACTIONS[UNITS.sniper.fire!].effects).toEqual([{ kind: 'hit', ignoresCover: true }]);
  });

  it('mortar: without the spotter the order is refused; the man who left is outside the blast', () => {
    const l = byId('mortar');
    const blind: Lesson = { ...l, units: l.units.filter((u) => !(u.owner === 0 && u.type === 'rifleman')) };
    expect(validateOrders(stageLesson(blind), 0, l.rounds[0][0]).map((e) => e.reason)).toEqual(['no friendly unit can see the target']);
    // Had he stayed, he would have been hit too.
    expect(hits(instead(l, 1, []).events).sort()).toEqual(['1-0 pinned', '1-1 pinned']);
  });

  it('medic: without the treatment the pinned man does not fire', () => {
    const l = byId('medic');
    const without = instead(l, 0, l.rounds[0][0].filter((o) => o.kind !== 'special'));
    expect(without.events.some((e) => e.t === 'fire')).toBe(false);
    expect(runLesson(l).results[0].events.some((e) => e.t === 'fire')).toBe(true);
  });

  it('ambush: the shot comes in the movement phase, after one step, and without the ambush he arrives', () => {
    const l = byId('ambush');
    const events = runLesson(l).results[0].events;
    const at = (t: GameEvent['t']) => events.findIndex((e) => e.t === t);
    expect(events.filter((e) => e.t === 'move').length).toBe(1);
    expect(at('move')).toBeLessThan(at('fire'));
    expect(events.find((e) => e.t === 'fire')).toMatchObject({ ambush: true });
    expect(label(instead(l, 0, []).state.units.find((u) => u.id === '1-0')!.pos)).toBe('D2');
  });

  it('pinned: pinned through round 1 and all of round 2; the recovery is the last thing in round 2', () => {
    const run = runLesson(byId('pinned'));
    expect(run.states[1].units.find((u) => u.id === '1-0')!.status).toBe('pinned');
    expect(run.results[0].events.some((e) => e.t === 'move' || e.t === 'recover')).toBe(false);
    expect(run.results[1].events.some((e) => e.t === 'move')).toBe(false);
    const phases = run.results[1].events.filter((e) => e.t === 'phase' || e.t === 'recover').map((e) => (e.t === 'phase' ? e.phase : e.t));
    expect(phases).toEqual(['treat', 'fire', 'move', 'assault', 'mortar', 'score', 'recover']);
  });

  it('phases: something happens in each of the six', () => {
    const chunks = phaseChunks(runLesson(byId('phases')).results[0].events);
    expect(chunks.map((c) => c.phase)).toEqual(['treat', 'fire', 'move', 'assault', 'mortar', 'score']);
    for (const c of chunks) expect(c.events.length, c.phase).toBeGreaterThan(1);
  });

  it('score: the text quotes the objective the unit ends on', () => {
    const l = byId('score');
    const a = l.map.objectives.find((o) => o.id === 'A')!;
    expect(l.text).toContain(`worth ${a.value}`);
    expect(runLesson(l).states[1].scores).toEqual([a.value, 0]);
  });

  it('texts quote the numbers in src/content', () => {
    expect(TERRAIN.woods.hide).toEqual({ still: 1, moved: 2 });
    expect(byId('stealth').text).toContain('is within 1 hex.');
    expect(byId('stealth').notes?.move).toContain('At 1 hex ');
    expect(byId('creep').text).toContain('only from 2 hexes or closer');
    expect(byId('move-dash').text).toContain(`up to ${UNITS.rifleman.move} hexes`);
    expect(byId('move-dash').text).toContain(`up to ${UNITS.rifleman.move * 2}.`);
    expect(byId('sniper').text).toContain(`${ACTIONS[UNITS.sniper.fire!].range} hexes`);
    expect(byId('sniper').text).toContain(`stops at ${ACTIONS[UNITS.rifleman.fire!].range}`);
  });
});

describe('staging and checking', () => {
  const lesson = byId('cover');

  it('names units as a match does and stages a pinned unit as pinned earlier', () => {
    const state = stageLesson(byId('medic'));
    expect(state.units.map((u) => u.id)).toEqual(['0-0', '0-1', '1-0']);
    expect(state.units.map((u) => u.name)).toEqual(['Pvt. Hale', 'Pvt. Barlow', 'Pvt. Archer']);
    expect(state.units[1]).toMatchObject({ status: 'pinned', pinnedRound: 0 });
    expect(state.round).toBe(1);
  });

  it('reports each expectation that fails, in words', () => {
    const wrong: Lesson = {
      ...lesson,
      expect: [
        { unit: '1-0', status: 'down' }, { unit: '1-0', at: 'A1' }, { event: 'hit', count: 5 }, { event: 'treat' },
        { score: [3, 0] }, { seenBy: 1, unit: '0-0', seen: false }, { unit: '7-7', status: 'ready' },
      ],
    };
    expect(checkLesson(wrong)).toEqual([
      'Pvt. Archer (1-0) should be down, but is pinned.',
      'Pvt. Archer (1-0) should be at A1, but is at D2.',
      'Expected 5 "hit" events, but there were 2.',
      'Expected at least one "treat" event, but there were 0.',
      'The score should be 3 to 0, but is 0 to 0.',
      'Pvt. Hale (0-0) should not be seen by player 1, but is.',
      'There is no unit 7-7.',
    ]);
  });

  it('does not change a lesson by running it', () => {
    const before = JSON.stringify(lesson);
    runLesson(lesson);
    expect(JSON.stringify(lesson)).toBe(before);
  });

  it('reads a tiny map in the map format, and says what is wrong with a bad one', () => {
    const map = tinyMap({ id: 't', terrain: ['. w', ' b .'], elevation: ['. 1', ' 2 .'], marks: ['. .', ' . A'], objectiveValues: { A: 3 } });
    expect(map.cells[key(hex('B1'))]).toEqual({ terrain: 'woods', elevation: 1 });
    expect(map.cells[key(hex('A2'))]).toEqual({ terrain: 'building', elevation: 2 });
    expect(map.objectives).toEqual([{ id: 'A', hex: hex('B2'), value: 3 }]);
    expect(label(hex('B2'))).toBe('B2');
    expect(() => tinyMap({ id: 't', terrain: ['. x'] })).toThrow(/unknown terrain "x" at B1/);
    expect(() => tinyMap({ id: 't', terrain: ['. .', ' .'] })).toThrow(/row 2 has 1 hexes/);
    expect(() => tinyMap({ id: 't', terrain: ['. .'], marks: ['. A'] })).toThrow(/not an objective with a value/);
    expect(() => stageLesson({ ...lesson, units: [{ owner: 0, type: 'rifleman', at: 'Z9' }] })).toThrow(/no hex Z9/);
  });
});

describe('what the screen shows', () => {
  it('the umpire sees every hex and every unit still in the match, as nobody', () => {
    const l = byId('hit');
    const run = runLesson(l);
    const start = viewOf(run.states[0], 'umpire');
    expect(start.player).toBe(UMPIRE_SEAT);
    expect(start.visible.length).toBe(Object.keys(l.map.cells).length);
    expect(start.units.length).toBe(3);
    expect(viewOf(run.states[1], 'umpire').units.map((u) => u.id)).toEqual(['0-0', '0-1']);   // the man who went down is off
    expect(eventsOf(run.results[0], 'umpire')).toBe(run.results[0].events);
    expect(eventsOf(run.results[0], 1)).toBe(run.results[0].playerEvents[1]);
  });

  it('a side sees its own orders as marks, the umpire everyone\'s', () => {
    const l = byId('dash-risk');
    const start = stageLesson(l);
    expect(orderMarks(start, l.rounds[0], 0)).toEqual([{ kind: 'target', from: hex('A2'), hex: hex('D2'), blast: 0 }]);
    expect(orderMarks(start, l.rounds[0], 1)).toEqual([{ kind: 'path', from: hex('D2'), path: ['D3', 'C3', 'B3', 'A3'].map(hex), dash: true }]);
    expect(orderMarks(start, l.rounds[0], 'umpire').length).toBe(2);
    const g = byId('gunner');
    expect(orderMarks(stageLesson(g), g.rounds[0], 'umpire')).toEqual([{ kind: 'target', from: hex('A2'), hex: hex('C2'), blast: ACTIONS[UNITS.gunner.fire!].blast }]);
    const a = byId('ambush');
    expect(orderMarks(stageLesson(a), a.rounds[0], 0)).toEqual([{ kind: 'ambush', hex: hex('A2') }]);
    // An order the rules would turn down is not drawn.
    expect(orderMarks(start, [[fire('0-0', 'Z9')], []], 'umpire')).toEqual([]);
  });

  it('stops only where something happens or there is something to say', () => {
    const l = byId('pinned');
    const stops = stopsFor(l, runLesson(l), 'umpire').map((s) => (s.kind === 'orders' ? `orders ${s.round}` : `${s.round} ${s.phase}`));
    expect(stops).toEqual(['0 fire', '0 move', '0 score', 'orders 1', '1 move', '1 score']);
    const quiet: Lesson = { ...byId('reveal'), notes: undefined };
    expect(stopsFor(quiet, runLesson(quiet), 'umpire').map((s) => (s.kind === 'orders' ? 'orders' : s.phase))).toEqual(['fire', 'orders', 'score']);
  });

  it('the closing line is read from the state', () => {
    expect(outcome(byId('ambush'), runLesson(byId('ambush')))).toBe('Pvt. Archer: pinned at E2.');
    expect(outcome(byId('score'), runLesson(byId('score')))).toBe('Pvt. Hale: at C2. Score: Blue 2, Plum 0.');
    expect(outcome(byId('reveal'), runLesson(byId('reveal')))).toBe('Pvt. Archer: not seen by Blue.');
  });

  it('keeps the rest of the query when the manual opens and closes', () => {
    expect(manualSearch('', 'cover')).toBe('?manual=cover');
    expect(manualSearch('?slot=dev1', '')).toBe('?slot=dev1&manual=');
    expect(manualSearch('?slot=dev1&manual=cover', 'hit')).toBe('?slot=dev1&manual=hit');
    expect(manualSearch('?manual=cover', null)).toBe('');
    expect(manualSearch('?slot=dev1&manual=cover', null)).toBe('?slot=dev1');
    expect(new URLSearchParams(manualSearch('', '')).get('manual')).toBe('');
  });
});
