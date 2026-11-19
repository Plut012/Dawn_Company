import { describe, expect, it } from 'vitest';
import { PRESETS } from '../content';
import { createMatch, findPath, orderOptions, resolve, viewFor } from '../rules';
import type { ServerMsg } from '../shared/protocol';
import type { Order, PlayerView } from '../shared/types';
import { LOBBY_GRACE_MS, Room, parseClientMsg } from './match';
import type { LogLine, Out } from './match';

type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

function setup(timerSec = 0) {
  let clock = 1_000_000;
  let tokens = 0;
  const logs: LogLine[][] = [];
  const room = new Room({
    timerSec,
    now: () => clock,
    makeToken: () => `tok${tokens++}`,
    newLog: () => {
      const lines: LogLine[] = [];
      logs.push(lines);
      return (l) => lines.push(l);
    },
  });
  return { room, logs, advance: (ms: number) => { clock += ms; } };
}

/** All messages sent to `conn`, of kind `t`. */
function got<T extends ServerMsg['t']>(outs: Out[], conn: number, t: T): Msg<T>[] {
  return outs.flatMap((o) => ('msg' in o && o.to === conn && o.msg.t === t ? [o.msg as Msg<T>] : []));
}

function join(room: Room, conn: number, name = `P${conn}`, token?: string): Out[] {
  return room.handle(conn, { t: 'join', name, token });
}

/** n seats joined, ready and started. Connections are 1..n. */
function started(n: number, timerSec = 0) {
  const s = setup(timerSec);
  for (let c = 1; c <= n; c++) {
    join(s.room, c);
    s.room.handle(c, { t: 'ready', ready: true });
  }
  const outs = s.room.handle(1, { t: 'start' });
  return { ...s, outs };
}

/** A legal move order for the first unit of `view` that can move. */
function someMove(view: PlayerView): Order[] {
  for (const u of view.units.filter((x) => x.owner === view.player)) {
    const opt = orderOptions(view, u.id);
    if (!opt.move.length) continue;
    const [q, r] = opt.move[0].split(',').map(Number);
    const path = findPath(view.map, u.pos, { q, r }, 99);
    if (path && path.length) return [{ unit: u.id, kind: 'move', path }];
  }
  throw new Error('no move found');
}

describe('joining', () => {
  it('seats players in order with fresh tokens; seat 0 is host', () => {
    const { room } = setup();
    const a = join(room, 1, 'Ann');
    const b = join(room, 2, 'Bob');
    expect(got(a, 1, 'welcome')[0]).toMatchObject({ seat: 0, host: true, token: 'tok0', mapId: 'crossroads' });
    expect(got(b, 2, 'welcome')[0]).toMatchObject({ seat: 1, host: false, token: 'tok1' });
    expect(got(b, 2, 'lobby')[0].seats.map((s) => s.name)).toEqual(['Ann', 'Bob']);
    expect(got(b, 1, 'lobby')).toHaveLength(1);              // Ann is told about Bob
    expect(got(b, 1, 'welcome')).toHaveLength(0);            // and does not get Bob's token
  });

  it('refuses a fifth seat, and a join after the start', () => {
    const { room } = setup();
    for (let c = 1; c <= 4; c++) join(room, c);
    expect(got(join(room, 5), 5, 'error')).toHaveLength(1);
    const s = started(2);
    expect(got(join(s.room, 9), 9, 'error')).toHaveLength(1);
  });

  it('keeps the same connection from joining twice, and unjoined ones from doing anything', () => {
    const { room } = setup();
    join(room, 1);
    expect(got(join(room, 1), 1, 'error')).toHaveLength(1);
    expect(got(room.handle(7, { t: 'ready', ready: true }), 7, 'error')).toHaveLength(1);
  });

  it('reclaims a seat by token, in the lobby', () => {
    const { room } = setup();
    join(room, 1, 'Ann');
    join(room, 2, 'Bob');
    room.disconnect(2);
    const outs = join(room, 5, 'whoever', 'tok1');
    expect(got(outs, 5, 'welcome')[0]).toMatchObject({ seat: 1, token: 'tok1' });
    expect(got(outs, 5, 'lobby')[0].seats[1]).toMatchObject({ name: 'Bob', connected: true });
  });

  it('a second connection with the same token takes the seat and the old one is closed', () => {
    const { room } = setup();
    join(room, 1);
    const outs = join(room, 2, 'x', 'tok0');
    expect(outs.some((o) => 'close' in o && o.to === 1)).toBe(true);
    expect(got(outs, 2, 'welcome')[0].seat).toBe(0);
    expect(room.disconnect(1)).toEqual([]);                  // the old socket's close changes nothing
  });

  it('gives a stale token a new seat in the lobby', () => {
    const { room } = setup();
    expect(got(join(room, 1, 'Ann', 'nope'), 1, 'welcome')[0]).toMatchObject({ seat: 0, token: 'tok0' });
  });

  it('frees a lobby seat after the grace period and closes the table up', () => {
    const { room, advance } = setup();
    join(room, 1);
    join(room, 2);
    join(room, 3);
    room.disconnect(1);
    advance(LOBBY_GRACE_MS - 1);
    expect(room.tick()).toEqual([]);
    advance(1);
    const outs = room.tick();
    expect(room.seatCount).toBe(2);
    // the others moved up one seat and are told; seat 0 is the host again
    expect(got(outs, 2, 'welcome')[0]).toMatchObject({ seat: 0, host: true, token: 'tok1' });
    expect(got(outs, 3, 'welcome')[0]).toMatchObject({ seat: 1, host: false });
    expect(got(outs, 3, 'lobby')[0].seats).toHaveLength(2);
  });
});

describe('squads, ready and start', () => {
  it('refuses an illegal squad and keeps the old one', () => {
    const { room } = setup();
    join(room, 1);
    room.handle(1, { t: 'ready', ready: true });
    const bad = room.handle(1, { t: 'squad', units: ['sniper', 'sniper', 'sniper', 'sniper'] });
    expect(got(bad, 1, 'error')).toHaveLength(1);
    const unknown = room.handle(1, { t: 'squad', units: ['tank', 'tank', 'tank', 'tank'] });
    expect(got(unknown, 1, 'error')).toHaveLength(1);
    expect(got(room.handle(1, { t: 'ready', ready: true }), 1, 'lobby')[0].seats[0].ready).toBe(true);
  });

  it('a legal squad change clears ready', () => {
    const { room } = setup();
    join(room, 1);
    room.handle(1, { t: 'ready', ready: true });
    const outs = room.handle(1, { t: 'squad', units: PRESETS[1].units });
    expect(got(outs, 1, 'lobby')[0].seats[0].ready).toBe(false);
  });

  it('start needs the host, two seats, and everyone ready', () => {
    const { room } = setup();
    join(room, 1);
    room.handle(1, { t: 'ready', ready: true });
    expect(got(room.handle(1, { t: 'start' }), 1, 'error')[0].message).toMatch(/two/i);
    join(room, 2);
    room.handle(2, { t: 'ready', ready: true });
    expect(got(room.handle(2, { t: 'start' }), 2, 'error')[0].message).toMatch(/host/i);
    room.handle(2, { t: 'ready', ready: false });
    expect(got(room.handle(1, { t: 'start' }), 1, 'error')[0].message).toMatch(/ready/i);
    room.handle(2, { t: 'ready', ready: true });
    const outs = room.handle(1, { t: 'start' });
    expect(got(outs, 1, 'plan')).toHaveLength(1);
    expect(got(outs, 2, 'plan')).toHaveLength(1);
    expect(room.currentStage).toBe('playing');
  });

  it('start writes a log whose first line has the map, names, tokens and squads', () => {
    const { logs } = started(2);
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toMatchObject({ t: 'start', map: 'crossroads' });
    const first = logs[0][0] as Extract<LogLine, { t: 'start' }>;
    expect(first.seats.map((s) => [s.name, s.token])).toEqual([['P1', 'tok0'], ['P2', 'tok1']]);
    expect(first.seats[0].squad).toEqual(PRESETS[0].units);
  });

  it('squad and ready are lobby-only', () => {
    const { room } = started(2);
    expect(got(room.handle(1, { t: 'ready', ready: false }), 1, 'error')).toHaveLength(1);
    expect(got(room.handle(1, { t: 'squad', units: PRESETS[1].units }), 1, 'error')).toHaveLength(1);
    expect(got(room.handle(1, { t: 'start' }), 1, 'error')).toHaveLength(1);
    expect(got(room.handle(1, { t: 'rematch' }), 1, 'error')).toHaveLength(1);
  });
});

describe('messages that are not messages', () => {
  it('get an error and change nothing', () => {
    const { room } = setup();
    join(room, 1);
    const junk: unknown[] = [
      null, 5, 'hello', [], {}, { t: 'nope' }, { t: 'join', token: 5 }, { t: 'squad', units: 'x' },
      { t: 'squad', units: [1, 2] }, { t: 'ready', ready: 'yes' }, { t: 'orders', orders: {} },
      { t: 'orders', orders: Array(1000).fill(null) },
    ];
    for (const j of junk) {
      const outs = room.handle(1, j);
      expect(got(outs, 1, 'error'), JSON.stringify(j)).toHaveLength(1);
    }
    expect(parseClientMsg({ t: 'start', extra: 1 })).toEqual({ t: 'start' });
  });

  it('junk orders mid-match are rejected, not thrown', () => {
    const { room } = started(2);
    for (const orders of [[null], [5], [{}], [{ unit: 7 }], [{ unit: '0-0', kind: 'move', path: 'x' }], [{ unit: '0-0', kind: 'fire', target: { q: 'a' } }]]) {
      const outs = room.handle(1, { t: 'orders', orders });
      expect(got(outs, 1, 'rejected').length + got(outs, 1, 'error').length).toBe(1);
    }
    expect(room.currentStage).toBe('playing');
  });

  it('cleans names', () => {
    const { room } = setup();
    const outs = join(room, 1, '  <b>Al\u0000ice</b> with a very very long name indeed  ');
    const name = got(outs, 1, 'lobby')[0].seats[0].name;
    expect(name.length).toBeLessThanOrEqual(24);
    expect(name).not.toMatch(/[<>\u0000]/);
    expect(got(join(room, 2, '   '), 2, 'lobby')[0].seats[1].name).toBe('Player 2');
  });
});

describe('rounds', () => {
  it('rejects illegal orders and accepts legal ones; the round waits for everyone', () => {
    const { room, outs } = started(2);
    const view0 = got(outs, 1, 'plan')[0].view;
    const bad = room.handle(1, { t: 'orders', orders: [{ unit: '1-0', kind: 'ambush' }] });   // not our unit
    expect(got(bad, 1, 'rejected')[0].errors.length).toBeGreaterThan(0);
    const good = room.handle(1, { t: 'orders', orders: someMove(view0) });
    expect(got(good, 1, 'rejected')).toHaveLength(0);
    const seats = got(good, 2, 'seats')[0].seats;
    expect(seats.map((s) => s.ready)).toEqual([true, false]);
    expect(room.state!.round).toBe(1);
  });

  it('recall un-readies', () => {
    const { room, outs } = started(2);
    room.handle(1, { t: 'orders', orders: someMove(got(outs, 1, 'plan')[0].view) });
    const r = room.handle(1, { t: 'recall' });
    expect(got(r, 2, 'seats')[0].seats[0].ready).toBe(false);
  });

  it('resolves when all are ready, each seat gets only its own events and view', () => {
    const { room, outs, logs } = started(3);
    const views = [1, 2, 3].map((c) => got(outs, c, 'plan')[0].view);
    expect(views.map((v) => v.player)).toEqual([0, 1, 2]);
    room.handle(1, { t: 'orders', orders: someMove(views[0]) });
    room.handle(2, { t: 'orders', orders: [] });
    const end = room.handle(3, { t: 'orders', orders: someMove(views[2]) });
    expect(room.state!.round).toBe(2);
    expect(logs[0]).toHaveLength(2);
    expect(logs[0][1]).toMatchObject({ t: 'round', round: 1 });

    const expected = resolve(createMatch(views[0].map, [0, 1, 2].map((p) => ({ player: p, units: PRESETS[0].units }))), [
      someMove(views[0]), [], someMove(views[2]),
    ]);
    for (const c of [1, 2, 3]) {
      const msgs = got(end, c, 'resolve');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].view).toEqual(viewFor(room.state!, c - 1));
      expect(msgs[0].view.player).toBe(c - 1);
      expect(msgs[0].events).toEqual(expected.playerEvents[c - 1]);
      expect(msgs[0].seats.every((s) => !s.ready)).toBe(true);
      // no enemy unit in a view is one the rules would not show
      expect(msgs[0].view.units.every((u) => u.owner === c - 1 || viewFor(room.state!, c - 1).units.some((v) => v.id === u.id))).toBe(true);
    }
    // the three seats do not all see the same set of units' ids
    const unitSets = [1, 2, 3].map((c) => got(end, c, 'resolve')[0].view.units.map((u) => u.id).join());
    expect(new Set(unitSets).size).toBeGreaterThan(1);
  });

  it('never leaks a token, or another seat\'s message, in anything but a welcome', () => {
    const { outs, room } = started(3);
    const view = got(outs, 1, 'plan')[0].view;
    const all = [...outs, ...room.handle(1, { t: 'orders', orders: someMove(view) })];
    for (const o of all) {
      if ('msg' in o && o.msg.t !== 'welcome') expect(JSON.stringify(o.msg)).not.toMatch(/tok\d/);
    }
  });

  it('timer path: a missing player holds, the round resolves when the timer fires', () => {
    const { room, outs, advance } = started(3, 60);
    expect(got(outs, 1, 'plan')[0].timer).toBe(60_000);
    room.disconnect(3);
    room.handle(1, { t: 'orders', orders: someMove(got(outs, 1, 'plan')[0].view) });
    const end = room.handle(2, { t: 'orders', orders: [] });
    expect(got(end, 1, 'resolve')).toHaveLength(0);           // seat 3 not in: wait for the timer
    expect(room.state!.round).toBe(1);
    advance(59_000);
    expect(room.tick()).toEqual([]);
    advance(1_000);
    const fired = room.tick();
    expect(room.state!.round).toBe(2);
    expect(got(fired, 1, 'resolve')[0].timer).toBe(60_000);   // restarted
    expect(got(fired, 3, 'resolve')).toHaveLength(0);         // nobody home
    // the seat was not ready, so it held: all its units are where they started
    const start = createMatch(room.state!.map, [0, 1, 2].map((p) => ({ player: p, units: PRESETS[0].units })));
    expect(room.state!.units.filter((u) => u.owner === 2).map((u) => u.pos)).toEqual(start.units.filter((u) => u.owner === 2).map((u) => u.pos));
  });

  it('with no timer a disconnected seat holds the round until it returns', () => {
    const { room, outs, advance } = started(2, 0);
    expect(got(outs, 1, 'plan')[0].timer).toBeNull();
    room.disconnect(2);
    room.handle(1, { t: 'orders', orders: [] });
    advance(10 * 60_000);
    expect(room.tick()).toEqual([]);
    expect(room.state!.round).toBe(1);
    const back = join(room, 9, 'x', 'tok1');
    expect(got(back, 9, 'plan')[0].seats.map((s) => s.ready)).toEqual([true, false]);
    const end = room.handle(9, { t: 'orders', orders: [] });
    expect(got(end, 9, 'resolve')).toHaveLength(1);
  });

  it('a seat that committed and then dropped still counts as ready', () => {
    const { room } = started(2);
    room.handle(2, { t: 'orders', orders: [] });
    room.disconnect(2);
    const end = room.handle(1, { t: 'orders', orders: [] });
    expect(got(end, 1, 'resolve')).toHaveLength(1);
  });

  it('a recalled draft is used if the timer fires before it is re-sent', () => {
    const { room, outs, advance } = started(2, 30);
    const orders = someMove(got(outs, 1, 'plan')[0].view);
    room.handle(1, { t: 'orders', orders });
    room.handle(1, { t: 'recall' });
    advance(30_000);
    room.tick();
    const mover = (orders[0] as { unit: string }).unit;
    const start = createMatch(room.state!.map, [0, 1].map((p) => ({ player: p, units: PRESETS[0].units })));
    expect(room.state!.units.find((u) => u.id === mover)!.pos).not.toEqual(start.units.find((u) => u.id === mover)!.pos);
  });

  it('reconnect by token mid-match gets welcome and the current plan; the seat is shown connected', () => {
    const { room, outs } = started(2);
    room.handle(1, { t: 'orders', orders: someMove(got(outs, 1, 'plan')[0].view) });
    const dropped = room.disconnect(1);
    expect(got(dropped, 2, 'seats')[0].seats[0].connected).toBe(false);
    const back = join(room, 8, 'ignored', 'tok0');
    expect(got(back, 8, 'welcome')[0]).toMatchObject({ seat: 0, host: true, token: 'tok0' });
    const plan = got(back, 8, 'plan')[0];
    expect(plan.view).toEqual(viewFor(room.state!, 0));
    expect(plan.seats[0]).toMatchObject({ connected: true, ready: true });
    expect(got(back, 2, 'seats')[0].seats[0].connected).toBe(true);
  });
});

describe('drafts', () => {
  /** Where `unit` stands in the room's state. */
  const posOf = (room: Room, unit: string) => room.state!.units.find((u) => u.id === unit)!.pos;
  const moverOf = (orders: Order[]) => (orders[0] as { unit: string }).unit;

  it('a draft that was never sent with the lever runs at the deadline', () => {
    const { room, outs, advance } = started(2, 30);
    const orders = someMove(got(outs, 1, 'plan')[0].view);
    const unit = moverOf(orders);
    const before = posOf(room, unit);
    expect(room.handle(1, { t: 'draft', orders })).toEqual([]);          // no reply at all
    advance(30_000);
    const fired = room.tick();
    expect(got(fired, 1, 'resolve')).toHaveLength(1);
    expect(posOf(room, unit)).not.toEqual(before);
  });

  it('what ran is in the log', () => {
    const { room, outs, advance, logs } = started(2, 30);
    const orders = someMove(got(outs, 1, 'plan')[0].view);
    room.handle(1, { t: 'draft', orders });
    advance(30_000);
    room.tick();
    expect(logs[0][1]).toMatchObject({ t: 'round', round: 1, orders: [orders, []] });
  });

  it('an invalid draft does not displace a valid one, and says nothing', () => {
    const { room, outs, advance } = started(2, 30);
    const orders = someMove(got(outs, 1, 'plan')[0].view);
    const unit = moverOf(orders);
    const before = posOf(room, unit);
    room.handle(1, { t: 'draft', orders });
    expect(room.handle(1, { t: 'draft', orders: [{ unit: '1-0', kind: 'ambush' }] })).toEqual([]);   // not seat 0's unit
    expect(room.handle(1, { t: 'draft', orders: [{ unit, kind: 'move', path: [{ q: 99, r: 99 }] }] })).toEqual([]);
    advance(30_000);
    room.tick();
    expect(posOf(room, unit)).not.toEqual(before);
    // the held orders are what the held draft says: moved along its path
    expect(posOf(room, unit)).toEqual((orders[0] as { path: { q: number; r: number }[] }).path.at(-1));
  });

  it('a draft does not mark the seat ready or end the round', () => {
    const { room, outs } = started(2);
    const orders = someMove(got(outs, 1, 'plan')[0].view);
    room.handle(2, { t: 'orders', orders: [] });
    const after = room.handle(1, { t: 'draft', orders });
    expect(after).toEqual([]);
    expect(room.state!.round).toBe(1);
    const back = join(room, 9, 'x', 'tok0');
    expect(got(back, 9, 'plan')[0].seats.map((x) => x.ready)).toEqual([false, true]);
    // and with every other seat ready, the round still waits for the lever
    expect(room.state!.round).toBe(1);
  });

  it('a draft from a seat that is ready is ignored; recall then a new draft runs the new draft', () => {
    const { room, outs, advance } = started(2, 30);
    const view = got(outs, 1, 'plan')[0].view;
    const rifle = view.units.find((u) => u.owner === 0 && u.type === 'rifleman')!;
    const far = orderOptions(view, rifle.id).move.map((k) => k.split(',').map(Number)).sort((x, y) => y[0] - x[0])[0];
    const path = findPath(view.map, rifle.pos, { q: far[0], r: far[1] }, 99)!;
    const unit = rifle.id;
    const first: Order[] = [{ unit, kind: 'move', path }];
    room.handle(1, { t: 'orders', orders: first });
    room.handle(1, { t: 'draft', orders: [] });                          // ready: ignored
    const held = got(join(room, 9, 'x', 'tok0'), 9, 'plan')[0].orders;
    expect(held).toEqual(first);
    room.handle(9, { t: 'recall' });
    const shorter: Order[] = [{ unit, kind: 'move', path: path.slice(0, 1) }];
    room.handle(9, { t: 'draft', orders: shorter });
    advance(30_000);
    room.tick();
    expect(posOf(room, unit)).toEqual(path[0]);
    expect(path.length).toBeGreaterThan(1);                              // the two orders really differ
  });

  it('only the lever ends a round early: every living seat must have pulled it', () => {
    const { room, outs } = started(2);
    const orders = someMove(got(outs, 1, 'plan')[0].view);
    room.handle(1, { t: 'draft', orders });
    room.handle(2, { t: 'draft', orders: [] });
    expect(room.state!.round).toBe(1);
    const end = room.handle(1, { t: 'orders', orders });
    expect(got(end, 1, 'resolve')).toHaveLength(0);                      // seat 1 still has the lever up
  });

  it('a draft out of turn (lobby, over, unjoined) is ignored without an error', () => {
    const s = setup();
    join(s.room, 1);
    expect(s.room.handle(1, { t: 'draft', orders: [] })).toEqual([]);
    expect(s.room.handle(7, { t: 'draft', orders: [] })).toMatchObject([{ msg: { t: 'error' } }]);   // unjoined: join first, as for any message
  });

  it('a draft carries a move\'s follow-up like any order', () => {
    const { room, outs, advance } = started(2, 30);
    const view = got(outs, 1, 'plan')[0].view;
    const rifle = view.units.find((u) => u.owner === 0 && u.type === 'rifleman')!;
    const opt = orderOptions(view, rifle.id);
    const [q, r] = opt.move[0].split(',').map(Number);
    const path = findPath(view.map, rifle.pos, { q, r }, 99)!;
    const then = { kind: 'fire' as const, target: { q: path.at(-1)!.q + 1, r: path.at(-1)!.r } };
    const order: Order = { unit: rifle.id, kind: 'move', path, then };
    room.handle(1, { t: 'draft', orders: [order] });
    expect(got(join(room, 9, 'x', 'tok0'), 9, 'plan')[0].orders).toEqual([order]);
    advance(30_000);
    expect(got(room.tick(), 9, 'resolve')).toHaveLength(1);
  });

  it('reconnect returns the held orders, committed or not; a new round starts empty', () => {
    const { room, outs } = started(2);
    expect(got(outs, 1, 'plan')[0].orders).toBeNull();
    const orders = someMove(got(outs, 1, 'plan')[0].view);
    room.handle(1, { t: 'draft', orders });
    room.disconnect(1);
    const back = join(room, 8, 'x', 'tok0');
    expect(got(back, 8, 'plan')[0].orders).toEqual(orders);
    expect(got(back, 8, 'plan')[0].seats[0].ready).toBe(false);
    room.handle(8, { t: 'orders', orders });
    room.disconnect(8);
    const again = join(room, 9, 'x', 'tok0');
    expect(got(again, 9, 'plan')[0]).toMatchObject({ orders, seats: [{ ready: true }, { ready: false }] });
    room.handle(9, { t: 'recall' });
    room.handle(2, { t: 'orders', orders: [] });
    const end = room.handle(9, { t: 'orders', orders: [] });
    expect(got(end, 9, 'resolve')).toHaveLength(1);
    expect(got(join(room, 10, 'x', 'tok0'), 10, 'plan')[0].orders).toBeNull();
  });
});

describe('elimination and the end', () => {
  it('an eliminated seat no longer blocks the round', () => {
    const { room, outs } = started(3);
    // wipe seat 1's squad (the room's state object is a plain value)
    for (const u of room.state!.units) if (u.owner === 1) u.status = 'down';
    room.handle(1, { t: 'orders', orders: [] });
    room.handle(2, { t: 'orders', orders: [] });
    const end = room.handle(3, { t: 'orders', orders: [] });          // round 1 resolves; seat 1 is eliminated
    const r = got(end, 1, 'resolve')[0];
    expect(r.seats[1].out).toBe(true);
    expect(room.state!.round).toBe(2);
    expect(got(room.handle(2, { t: 'orders', orders: [] }), 2, 'error')).toHaveLength(1);   // out: no orders
    room.handle(1, { t: 'orders', orders: [] });
    const end2 = room.handle(3, { t: 'orders', orders: [] });
    expect(got(end2, 1, 'resolve')).toHaveLength(1);
    expect(room.state!.round).toBe(3);
    void outs;
  });

  function playToEnd(s: ReturnType<typeof started>) {
    let last: Out[] = [];
    let guard = 0;
    while (s.room.currentStage === 'playing' && guard++ < 50) {
      for (const c of [1, 2]) last = s.room.handle(c, { t: 'orders', orders: [] });
    }
    return last;
  }

  it('the match ends after maxRounds; rematch returns to the lobby keeping seats, names and squads', () => {
    const s = started(2);
    s.room.handle(1, { t: 'squad', units: [] });   // error, ignored while playing
    const end = playToEnd(s);
    expect(s.room.currentStage).toBe('over');
    expect(got(end, 1, 'resolve')[0].view.over).toBe(true);
    expect(s.room.handle(1, { t: 'orders', orders: [] }).some((o) => 'msg' in o && o.msg.t === 'error')).toBe(true);
    expect(got(s.room.handle(2, { t: 'rematch' }), 2, 'error')).toHaveLength(1);   // host only
    const lobby = s.room.handle(1, { t: 'rematch' });
    expect(s.room.currentStage).toBe('lobby');
    const seats = got(lobby, 2, 'lobby')[0].seats;
    expect(seats.map((x) => [x.name, x.ready])).toEqual([['P1', false], ['P2', false]]);
    s.room.handle(1, { t: 'ready', ready: true });
    s.room.handle(2, { t: 'ready', ready: true });
    s.room.handle(1, { t: 'start' });
    expect(s.room.currentStage).toBe('playing');
    expect(s.room.state!.round).toBe(1);
    expect(s.logs).toHaveLength(2);        // a new log for the new match
  });

  it('a reconnecting player after the end gets the final view', () => {
    const s = started(2);
    playToEnd(s);
    s.room.disconnect(2);
    const back = join(s.room, 6, 'x', 'tok1');
    expect(got(back, 6, 'plan')[0].view.over).toBe(true);
  });
});

describe('resume', () => {
  it('replaying the log gives the same state as the live match, and tokens work', () => {
    const live = started(3, 60);
    const views = [1, 2, 3].map((c) => got(live.outs, c, 'plan')[0].view);
    live.room.handle(1, { t: 'orders', orders: someMove(views[0]) });
    live.room.handle(2, { t: 'orders', orders: someMove(views[1]) });
    live.room.handle(3, { t: 'orders', orders: someMove(views[2]) });
    const v2 = [1, 2, 3].map((_, p) => viewFor(live.room.state!, p));
    live.room.handle(1, { t: 'orders', orders: someMove(v2[0]) });
    live.room.handle(3, { t: 'orders', orders: [] });
    live.advance(60_000);
    live.room.tick();
    expect(live.room.state!.round).toBe(3);

    const lines = live.logs[0];
    const appended: LogLine[] = [];
    let clock = 5_000_000;
    const resumed = Room.resume(lines, { timerSec: 60, now: () => clock, makeToken: () => 'new' }, (l) => appended.push(l));
    expect(resumed.state).toEqual(live.room.state);
    expect(resumed.currentStage).toBe('playing');
    expect(resumed.nextDeadline).toBeNull();                     // paused until someone returns

    const back = resumed.handle(11, { t: 'join', name: 'x', token: 'tok2' });
    expect(got(back, 11, 'welcome')[0]).toMatchObject({ seat: 2, token: 'tok2' });
    const plan = got(back, 11, 'plan')[0];
    expect(plan.view).toEqual(viewFor(live.room.state!, 2));
    expect(plan.timer).toBe(60_000);
    expect(plan.seats.map((s) => s.name)).toEqual(['P1', 'P2', 'P3']);
    expect(plan.seats.map((s) => s.connected)).toEqual([false, false, true]);

    // new rounds append to the same log
    resumed.handle(10, { t: 'join', name: 'x', token: 'tok1' });
    resumed.handle(9, { t: 'join', name: 'x', token: 'tok0' });
    for (const c of [9, 10, 11]) resumed.handle(c, { t: 'orders', orders: [] });
    expect(resumed.state!.round).toBe(4);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ t: 'round', round: 3 });
  });

  it('resumes a finished match as over, and refuses a bad log', () => {
    const s = started(2);
    for (let i = 0; i < 40 && s.room.currentStage === 'playing'; i++) for (const c of [1, 2]) s.room.handle(c, { t: 'orders', orders: [] });
    const opts = { timerSec: 0, now: () => 0, makeToken: () => 'x' };
    const r = Room.resume(s.logs[0], opts, () => {});
    expect(r.currentStage).toBe('over');
    expect(r.state).toEqual(s.room.state);
    expect(() => Room.resume([], opts, () => {})).toThrow();
    expect(() => Room.resume([s.logs[0][0], s.logs[0][2]], opts, () => {})).toThrow();
  });
});
