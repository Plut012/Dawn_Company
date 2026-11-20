// The match room: lobby, seats, rounds, timer. No sockets, no files, no
// clock of its own. Everything comes in as a call (a message from a
// connection, a tick of the clock) and goes out as a list of messages to send.
//
// Connections are opaque numbers. The room never sends one seat anything that
// belongs to another: a `welcome` (which carries the token) goes only to the
// connection that joined; a `plan` or `resolve` carries only that seat's view
// and events.

import { DEFAULT_MODE, MAPS, MODES, PRESETS, mapFor, validateSquad } from '../content';
import { createMatch, resolve, validateOrders, validatePurchases, viewFor } from '../rules';
import type { ClientMsg, SeatStatus, ServerMsg } from '../shared/protocol';
import type { GameState, ModeId, Order, PlayerId, Purchase, Squad, UnitTypeId } from '../shared/types';

export type ConnId = number;
/** One thing to do: send a message to a connection, or hang up on it. */
export type Out = { to: ConnId; msg: ServerMsg } | { to: ConnId; close: true };
export type Stage = 'lobby' | 'playing' | 'over';

export const MAX_SEATS = 4;
export const LOBBY_GRACE_MS = 5 * 60_000;   // a phone that slept or switched apps keeps its seat this long
const MAX_NAME = 24;
const MAX_SQUAD = 32;
const MAX_ORDERS = 64;
const MAX_PURCHASES = 32;
const MAX_TOKEN = 128;

// ---- the order log: one JSON object per line
export interface LogStart { t: 'start'; at: number; map: string; mode?: ModeId; seats: { seat: PlayerId; name: string; token: string; squad: UnitTypeId[] }[] }
export interface LogRound { t: 'round'; round: number; orders: Order[][]; purchases?: Purchase[][] }   // purchases (18): left out = none
export type LogLine = LogStart | LogRound;
export type LogSink = (line: LogLine) => void;

export interface RoomOptions {
  /** Seconds to plan each round; 0 = no timer. */
  timerSec: number;
  now: () => number;
  makeToken: () => string;
  /** Called at the start of each match; the sink receives every log line. */
  newLog?: () => LogSink;
}

interface Seat {
  name: string;
  token: string;
  squad: UnitTypeId[];
  ready: boolean;
  conn: ConnId | null;
  lostAt: number | null;           // when the connection dropped
  orders: Order[] | null;          // what the server holds for this round: committed, or a draft; run at the bell either way
  purchases: Purchase[] | null;    // held with the orders, under the same rules (18)
}

const fail = (to: ConnId, message: string): Out[] => [{ to, msg: { t: 'error', message } }];

function cleanName(raw: unknown, seat: number): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, MAX_NAME) : '';
  return s || `Player ${seat + 1}`;
}

/** Shape check for whatever arrived. Returns the message, or a reason it is not one. */
export function parseClientMsg(x: unknown): ClientMsg | string {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return 'Messages must be JSON objects.';
  const m = x as Record<string, unknown>;
  switch (m.t) {
    case 'join':
      if (m.token !== undefined && (typeof m.token !== 'string' || m.token.length > MAX_TOKEN)) return 'Bad token.';
      return { t: 'join', name: typeof m.name === 'string' ? m.name : '', token: m.token as string | undefined };
    case 'squad':
      if (!Array.isArray(m.units) || m.units.length > MAX_SQUAD || !m.units.every((u) => typeof u === 'string')) {
        return 'A squad is a list of unit names.';
      }
      return { t: 'squad', units: m.units as UnitTypeId[] };
    case 'ready':
      return typeof m.ready === 'boolean' ? { t: 'ready', ready: m.ready } : 'ready must be true or false.';
    case 'orders':
    case 'draft':
      if (!Array.isArray(m.orders) || m.orders.length > MAX_ORDERS) return 'Orders must be a short list.';
      if (m.purchases !== undefined && (!Array.isArray(m.purchases) || m.purchases.length > MAX_PURCHASES)) return 'Purchases must be a short list.';
      return { t: m.t, orders: m.orders as Order[], purchases: (m.purchases ?? []) as Purchase[] };
    case 'mode':
      return typeof m.mode === 'string' && m.mode.length <= MAX_TOKEN ? { t: 'mode', mode: m.mode } : 'A mode is a name.';
    case 'start':
    case 'recall':
    case 'rematch':
      return { t: m.t };
    default:
      return 'Unknown message.';
  }
}

export class Room {
  private stage: Stage = 'lobby';
  private seats: Seat[] = [];
  private game: GameState | null = null;
  private mode: ModeId = DEFAULT_MODE;           // chosen in the lobby by the host; kept across a rematch
  private deadline: number | null = null;      // when the planning timer fires
  private paused = false;                      // resumed match: timer waits for the first return
  private log: LogSink | null = null;
  private readonly opts: RoomOptions;

  constructor(opts: RoomOptions) {
    this.opts = opts;
  }

  // ---- read-only peeks, for tests and the server's own status line
  get currentStage(): Stage { return this.stage; }
  get state(): GameState | null { return this.game; }
  get seatCount(): number { return this.seats.length; }
  get nextDeadline(): number | null { return this.deadline; }

  /**
   * Rebuild a match from its log: replay the start and every round, then wait
   * for seats to come back with their tokens. Throws on a log that does not
   * replay (wrong map, rounds out of order).
   */
  static resume(lines: LogLine[], opts: RoomOptions, sink: LogSink): Room {
    const first = lines[0];
    if (!first || first.t !== 'start') throw new Error('The log does not begin with a start line.');
    const map = MAPS[first.map];
    if (!map) throw new Error(`The log is for an unknown map "${first.map}".`);
    const room = new Room(opts);
    const squads: Squad[] = first.seats.map((s, i) => ({ player: i, units: [...s.squad] }));
    const mode = first.mode ?? DEFAULT_MODE;         // a log from before modes is a Supply Line match
    room.mode = mode;
    let state = createMatch(map, squads, mode);
    for (const line of lines.slice(1)) {
      if (line.t !== 'round') throw new Error('Unexpected line in the log.');
      if (line.round !== state.round) throw new Error(`The log jumps to round ${line.round}; expected ${state.round}.`);
      state = resolve(state, line.orders, line.purchases).state;
    }
    room.seats = first.seats.map((s, i) => ({
      name: s.name, token: s.token, squad: [...s.squad], ready: false,
      conn: null, lostAt: null, orders: null, purchases: null,
    }));
    room.game = state;
    room.log = sink;
    room.stage = state.over ? 'over' : 'playing';
    room.paused = !state.over;
    return room;
  }

  // ---- entry points

  /** A parsed (or junk) message from a connection. Never throws. */
  handle(conn: ConnId, raw: unknown): Out[] {
    try {
      const m = parseClientMsg(raw);
      if (typeof m === 'string') return fail(conn, m);
      if (m.t === 'join') return this.join(conn, m);
      const seat = this.seatOf(conn);
      if (seat === -1) return fail(conn, 'Join first.');
      switch (m.t) {
        case 'squad': return this.setSquad(conn, seat, m.units);
        case 'ready': return this.setReady(conn, seat, m.ready);
        case 'mode': return this.setMode(conn, seat, m.mode);
        case 'start': return this.start(conn, seat);
        case 'orders': return this.submit(conn, seat, m.orders, m.purchases ?? []);
        case 'draft': return this.draft(seat, m.orders, m.purchases ?? []);
        case 'recall': return this.recall(conn, seat);
        case 'rematch': return this.rematch(conn, seat);
      }
    } catch (e) {
      return fail(conn, 'The server could not handle that message.');
    }
  }

  /** A connection closed. */
  disconnect(conn: ConnId): Out[] {
    const i = this.seatOf(conn);
    if (i === -1) return [];
    this.seats[i].conn = null;
    this.seats[i].lostAt = this.opts.now();
    return this.announce();
  }

  /** The clock moved: end a round whose timer ran out, free stale lobby seats. */
  tick(): Out[] {
    try {
      const now = this.opts.now();
      if (this.stage === 'lobby') {
        const stale = this.seats.filter((s) => s.conn === null && s.lostAt !== null && now - s.lostAt >= LOBBY_GRACE_MS);
        if (stale.length === 0) return [];
        const out = this.dropSeats((s) => !stale.includes(s));
        return [...out, ...this.announce()];
      }
      if (this.stage === 'playing' && this.deadline !== null && now >= this.deadline) return this.endRound();
    } catch {
      // never let the clock take the server down
    }
    return [];
  }

  // ---- lobby

  private join(conn: ConnId, m: Extract<ClientMsg, { t: 'join' }>): Out[] {
    if (this.seatOf(conn) !== -1) return fail(conn, 'You have already joined.');
    const known = m.token ? this.seats.findIndex((s) => s.token === m.token) : -1;
    let i = known;
    const out: Out[] = [];
    if (known !== -1) {
      const seat = this.seats[known];
      if (seat.conn !== null && seat.conn !== conn) out.push({ to: seat.conn, close: true });
      seat.conn = conn;
      seat.lostAt = null;
      if (this.paused) {                      // resumed match: the clock starts when someone is back
        this.paused = false;
        this.restartTimer();
      }
    } else {
      if (this.stage !== 'lobby') return fail(conn, 'The match has started. Rejoin with your token, or wait for the next one.');
      if (this.seats.length >= MAX_SEATS) return fail(conn, 'The table is full.');
      i = this.seats.length;
      this.seats.push({
        name: cleanName(m.name, i),
        token: this.opts.makeToken(),
        squad: [...PRESETS[0].units],
        ready: false,
        conn,
        lostAt: null,
        orders: null,
        purchases: null,
      });
    }
    out.push(this.welcome(i));
    if (this.stage === 'lobby') out.push({ to: conn, msg: this.lobbyMsg() });
    else out.push({ to: conn, msg: this.plan(i) });
    return [...out, ...this.announce(conn)];
  }

  private setSquad(conn: ConnId, i: number, units: UnitTypeId[]): Out[] {
    if (this.stage !== 'lobby') return fail(conn, 'Squads can only change in the lobby.');
    const check = validateSquad(units, this.mode);
    if (!check.ok) return fail(conn, `Illegal squad: ${check.errors.join(' ')}`);
    this.seats[i].squad = [...units];
    this.seats[i].ready = false;
    return this.announce();
  }

  /** The host picks the mode. Every seat's ready is cleared; a squad the mode does not allow is kept, and cannot ready. */
  private setMode(conn: ConnId, i: number, mode: ModeId): Out[] {
    if (this.stage !== 'lobby') return fail(conn, 'The mode can only change in the lobby.');
    if (i !== 0) return fail(conn, 'Only the host can pick the mode.');
    if (!Object.hasOwn(MODES, mode)) return fail(conn, `No such mode: "${mode}".`);
    this.mode = mode;
    for (const s of this.seats) s.ready = false;
    return this.announce();
  }

  private setReady(conn: ConnId, i: number, ready: boolean): Out[] {
    if (this.stage !== 'lobby') return fail(conn, 'Ready is only for the lobby.');
    if (ready) {
      const check = validateSquad(this.seats[i].squad, this.mode);
      if (!check.ok) return fail(conn, `Pick a legal squad first. ${check.errors.join(' ')}`);
    }
    this.seats[i].ready = ready;
    return this.announce();
  }

  private start(conn: ConnId, i: number): Out[] {
    if (this.stage !== 'lobby') return fail(conn, 'The match has already started.');
    if (i !== 0) return fail(conn, 'Only the host can start the match.');
    if (this.seats.length < 2) return fail(conn, 'Two players are needed.');
    if (!this.seats.every((s) => s.ready)) return fail(conn, 'Not everyone is ready.');
    const squads: Squad[] = this.seats.map((s, p) => ({ player: p, units: [...s.squad] }));
    const bad = squads.map((s) => validateSquad(s.units, this.mode)).find((c) => !c.ok);
    if (bad) return fail(conn, `A squad is illegal. ${bad.errors.join(' ')}`);
    const map = mapFor(squads.length);
    this.game = createMatch(map, squads, this.mode);      // throws on bad setup; handle() turns that into an error
    this.stage = 'playing';
    this.paused = false;
    for (const s of this.seats) { s.ready = false; s.orders = null; s.purchases = null; }
    this.log = this.opts.newLog?.() ?? null;
    this.log?.({
      t: 'start', at: this.opts.now(), map: map.id, mode: this.mode,
      seats: this.seats.map((s, p) => ({ seat: p, name: s.name, token: s.token, squad: [...s.squad] })),
    });
    this.restartTimer();
    return this.toSeats((p) => this.plan(p));
  }

  private rematch(conn: ConnId, i: number): Out[] {
    if (this.stage !== 'over') return fail(conn, 'There is no finished match to replay.');
    if (i !== 0) return fail(conn, 'Only the host can start a rematch.');
    this.stage = 'lobby';
    this.game = null;
    this.deadline = null;
    this.log = null;
    const now = this.opts.now();
    for (const s of this.seats) {
      s.ready = false;
      s.orders = null;
      s.purchases = null;
      if (s.conn === null) s.lostAt = now;        // the lobby grace starts now
    }
    return this.announce();
  }

  // ---- rounds

  private submit(conn: ConnId, i: number, orders: Order[], purchases: Purchase[]): Out[] {
    if (this.stage !== 'playing' || !this.game) return fail(conn, 'There is no round to plan.');
    if (this.game.eliminated[i]) return fail(conn, 'Your squad is out of the match.');
    const errors = [...validateOrders(this.game, i, orders), ...validatePurchases(this.game, i, purchases)];
    if (errors.length > 0) return [{ to: conn, msg: { t: 'rejected', errors } }];
    this.seats[i].orders = orders;
    this.seats[i].purchases = purchases;
    this.seats[i].ready = true;
    return [...this.announce(), ...(this.everyoneReady() ? this.endRound() : [])];
  }

  /**
   * The orders as the player has them on screen, not yet committed. A good draft replaces what the
   * seat holds and leaves `ready` alone. A bad one, one from a seat that is ready, or one that
   * arrives out of turn is dropped without a word: the next draft is already on its way.
   */
  private draft(i: number, orders: Order[], purchases: Purchase[]): Out[] {
    if (this.stage !== 'playing' || !this.game || this.game.eliminated[i] || this.seats[i].ready) return [];
    if (validateOrders(this.game, i, orders).length === 0 && validatePurchases(this.game, i, purchases).length === 0) {
      this.seats[i].orders = orders;          // the orders and the purchases are one draft: kept or dropped together
      this.seats[i].purchases = purchases;
    }
    return [];
  }

  private recall(conn: ConnId, i: number): Out[] {
    if (this.stage !== 'playing') return fail(conn, 'There is no round to plan.');
    this.seats[i].ready = false;      // orders stay as the held draft until sent again
    return this.announce();
  }

  /** Every seat still in the match has committed. A seat that has dropped but committed first counts. */
  private everyoneReady(): boolean {
    const g = this.game;
    if (!g) return false;
    const live = this.seats.filter((_, p) => !g.eliminated[p]);
    return live.length > 0 && live.every((s) => s.ready);
  }

  private endRound(): Out[] {
    const g = this.game;
    if (!g || g.over) return [];
    const orders: Order[][] = this.seats.map((s) => s.orders ?? []);   // what each seat holds, lever pulled or not; nothing = hold
    const purchases: Purchase[][] = this.seats.map((s) => s.purchases ?? []);
    const result = resolve(g, orders, purchases);
    this.log?.({ t: 'round', round: g.round, orders, purchases });
    this.game = result.state;
    for (const s of this.seats) { s.ready = false; s.orders = null; s.purchases = null; }
    if (result.state.over) {
      this.stage = 'over';
      this.deadline = null;
    } else {
      this.restartTimer();
    }
    return this.toSeats((p) => ({
      t: 'resolve',
      events: result.playerEvents[p] ?? [],
      view: viewFor(result.state, p),
      seats: this.status(),
      timer: this.timerLeft(),
    }));
  }

  private restartTimer(): void {
    this.deadline = this.opts.timerSec > 0 ? this.opts.now() + this.opts.timerSec * 1000 : null;
  }

  private timerLeft(): number | null {
    return this.deadline === null ? null : Math.max(0, this.deadline - this.opts.now());
  }

  // ---- helpers

  private seatOf(conn: ConnId): number {
    return this.seats.findIndex((s) => s.conn === conn);
  }

  private lobbyMsg(): ServerMsg {
    return { t: 'lobby', seats: this.status(), mode: this.mode };
  }

  private status(): SeatStatus[] {
    return this.seats.map((s, p) => ({
      seat: p, name: s.name, connected: s.conn !== null, ready: s.ready, out: this.game?.eliminated[p] ?? false,
    }));
  }

  private welcome(i: number): Out {
    const s = this.seats[i];
    return {
      to: s.conn as ConnId,
      msg: { t: 'welcome', seat: i, token: s.token, host: i === 0, mapId: this.game?.map.id ?? mapFor(Math.max(this.seats.length, 2)).id, squad: [...s.squad] },
    };
  }

  private plan(i: number): ServerMsg {
    return { t: 'plan', view: viewFor(this.game as GameState, i), seats: this.status(), timer: this.timerLeft(), orders: this.seats[i].orders, purchases: this.seats[i].purchases };
  }

  /** Tell every connected seat (but `except`) the seat list for this stage. */
  private announce(except?: ConnId): Out[] {
    const msg: ServerMsg = this.stage === 'lobby' ? this.lobbyMsg() : { t: 'seats', seats: this.status() };
    return this.seats.flatMap((s) => (s.conn !== null && s.conn !== except ? [{ to: s.conn, msg }] : []));
  }

  private toSeats(build: (seat: PlayerId) => ServerMsg): Out[] {
    return this.seats.flatMap((s, p) => (s.conn !== null ? [{ to: s.conn, msg: build(p) }] : []));
  }

  /** Keep the seats that pass `keep`, close the table up, and re-welcome seats whose number changed. */
  private dropSeats(keep: (s: Seat) => boolean): Out[] {
    const before = this.seats;
    this.seats = before.filter(keep);
    const out: Out[] = [];
    this.seats.forEach((s, i) => {
      if (before.indexOf(s) !== i && s.conn !== null) out.push(this.welcome(i));
    });
    return out;
  }
}
