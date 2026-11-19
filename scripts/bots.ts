// The smoke test: mindless bots play whole matches against the real server,
// over real sockets, using only the protocol. Run with `npm run bots`.
//   --matches <n>   how many matches to play (default 60)
//   --players <n>   2, 3 or 4; left out, the matches are dealt round 2, 3, 4
//   --seed <n>      first match's seed (default: from the clock); match i uses seed + i
//
// A test tool, not an opponent: every unit gets a random legal order taken
// from `orderOptions` on the bot's own view. At most tables the bots are also
// "keen" (see randomOrders), so that squads meet, go down and are wiped out.
// Never imported by the client.
//
// Checked every round, for every bot:
//   - the view holds no enemy the bot's own units could not see, and no hex
//     they could not see (worked out again from the view alone);
//   - no order that `orderOptions` offered is rejected;
//   - events speak only of units the bot knows, and add up to the next view
//     (where each unit stands, its status, its posture, whether it gave itself away);
//   - a score names its objective exactly when the bot holds it or sees who does;
//   - scores never go down;
//   - the match ends, with the same result for every seat.
// And at the end of each match the server's order log is replayed through
// `createMatch` and `resolve`, and must reach the same scores.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { ACTIONS, MAPS, PRESETS, RULES, TERRAIN, UNITS, validateSquad } from '../src/content';
import { canSee, createMatch, findPath, followUpOptions, orderOptions, resolve } from '../src/rules';
import { distance, key, parseKey, within } from '../src/shared/hex';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';
import type {
  GameEvent, HexKey, Order, OrderKind, PlayerView, Posture, Squad, Unit, UnitId, UnitStatus, UnitTypeId,
} from '../src/shared/types';

const WAIT_MS = 10_000;          // longest a bot waits for the server before the match is called stuck
const REJOIN_CHANCE = 0.04;      // how often a bot drops its socket and takes its seat back before ordering

// ---- options

function option(name: string): number | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`--${name} needs a whole number.`);
    process.exit(2);
  }
  return n;
}

const matchCount = option('matches') ?? 60;
const playersOpt = option('players');
const baseSeed = (option('seed') ?? Date.now() % 1_000_000_000) >>> 0;
if (playersOpt !== undefined && ![2, 3, 4].includes(playersOpt)) {
  console.error('--players must be 2, 3 or 4.');
  process.exit(2);
}

// ---- seeded randomness (mulberry32)

type Rng = () => number;
function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];

/** A preset half the time, otherwise any legal squad. */
function randomSquad(r: Rng): UnitTypeId[] {
  if (r() < 0.5) return [...pick(r, PRESETS).units];
  const types = Object.keys(UNITS);
  for (;;) {
    const size = RULES.minUnits + Math.floor(r() * (RULES.maxUnits - RULES.minUnits + 1));
    const squad = Array.from({ length: size }, () => pick(r, types));
    if (validateSquad(squad).ok) return squad;
  }
}

/**
 * One random legal order for each living unit, or none (hold), from the bot's
 * own view. A `keen` bot is no cleverer, only pointed the right way so that
 * squads meet and get wiped: most of the time it fires at a hex where it sees
 * an enemy if it has one, and ends its moves as near the middle objective as
 * it can. Every choice is still one that `orderOptions` offered.
 *
 * Task 14: about one move in six is aimed at a hex one of the bot's own units
 * stands on (to walk onto it, or through it), and about half of the moves by
 * a unit whose action may follow a move carry a follow-up from
 * `followUpOptions`: at an enemy in view if one is in reach of the path's
 * end (a keen bot), else at any hex it may be aimed at.
 */
function randomOrders(r: Rng, view: PlayerView, keen: boolean): Order[] {
  const orders: Order[] = [];
  const mine = view.units.filter((u) => u.owner === view.player && u.status !== 'down');
  const enemyAt = new Set(view.units.filter((u) => u.owner !== view.player).map((u) => key(u.pos)));
  const middle = [...view.map.objectives].sort((a, b) => b.value - a.value)[0]?.hex ?? { q: 0, r: 0 };
  for (const u of mine) {
    const opt = orderOptions(view, u.id);
    const choices: (OrderKind | 'hold')[] = ['hold'];
    for (const k of opt.kinds) if (k === 'ambush' || opt[k].length > 0) choices.push(k);
    const marked = opt.fire.filter((k) => enemyAt.has(k));
    const kind = keen && marked.length > 0 && r() < 0.8 ? 'fire' : pick(r, choices);
    if (kind === 'hold') continue;
    if (kind === 'ambush') { orders.push({ unit: u.id, kind }); continue; }
    let ends = opt[kind];
    if (keen && kind === 'fire' && marked.length > 0 && r() < 0.9) ends = marked;
    if (keen && (kind === 'move' || kind === 'dash') && r() < 0.7) {
      const best = Math.min(...ends.map((k) => distance(parseKey(k), middle)));
      ends = ends.filter((k) => distance(parseKey(k), middle) === best);
    }
    if ((kind === 'move' || kind === 'dash') && r() < 0.17) {
      const held = ends.filter((k) => mine.some((f) => f.id !== u.id && key(f.pos) === k));
      if (held.length > 0) ends = held;
    }
    const target = parseKey(pick(r, ends));
    if (kind === 'move' || kind === 'dash') {
      const steps = (UNITS[u.type]?.move ?? 0) * (kind === 'dash' ? 2 : 1);
      const path = findPath(view.map, u.pos, target, steps);
      if (!path || path.length === 0) throw new Error(`orderOptions offered ${kind} to ${key(target)} for ${u.id} but findPath has no route`);
      const order: Order = { unit: u.id, kind, path };
      if (order.kind === 'move' && r() < 0.5) {
        const follow = followUpOptions(view, u.id, path[path.length - 1]);
        const kinds = (['fire', 'special'] as const).filter((k) => follow[k].length > 0);
        if (kinds.length > 0) {
          const k = pick(r, kinds);
          const friendAt = new Set(mine.filter((f) => f.id !== u.id).map((f) => key(f.pos)));
          const good = follow[k].filter((t) => (k === 'fire' ? enemyAt.has(t) : friendAt.has(t)));
          order.then = { kind: k, target: parseKey(pick(r, keen && good.length > 0 && r() < 0.9 ? good : follow[k])) };
        }
      }
      orders.push(order);
    } else {
      orders.push({ unit: u.id, kind, target });
    }
  }
  return orders;
}

// ---- one bot: a socket and an inbox

class Bot {
  ws!: WebSocket;
  inbox: ServerMsg[] = [];
  token = '';
  seat = -1;
  view: PlayerView | null = null;
  private wake: (() => void)[] = [];
  private readonly url: string;
  readonly name: string;

  constructor(url: string, name: string) {
    this.url = url;
    this.name = name;
  }

  connect(): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.on('message', (d) => {
      this.inbox.push(JSON.parse(d.toString()) as ServerMsg);
      this.wake.splice(0).forEach((w) => w());
    });
    this.ws.on('error', () => { /* shows up as a timeout with a clearer message */ });
    return new Promise((done, fail) => { this.ws.once('open', () => done()); this.ws.once('error', fail); });
  }

  send(m: ClientMsg): void { this.ws.send(JSON.stringify(m)); }

  /** The next message of one of these kinds; earlier messages of other kinds are dropped. */
  async next<T extends ServerMsg['t']>(...kinds: T[]): Promise<Extract<ServerMsg, { t: T }>> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const i = this.inbox.findIndex((m) => (kinds as string[]).includes(m.t));
      if (i !== -1) {
        const m = this.inbox[i];
        this.inbox.splice(0, i + 1);
        return m as Extract<ServerMsg, { t: T }>;
      }
      if (Date.now() > deadline) throw new Error(`${this.name} waited ${WAIT_MS / 1000}s for ${kinds.join('/')} and got nothing`);
      await new Promise<void>((r) => { this.wake.push(r); setTimeout(r, 200); });
    }
  }

  async join(): Promise<void> {
    this.send({ t: 'join', name: this.name, ...(this.token ? { token: this.token } : {}) });
    const w = await this.next('welcome', 'error');
    if (w.t === 'error') throw new Error(`${this.name} could not join: ${w.message}`);
    this.token = w.token;
    this.seat = w.seat;
  }

  close(): Promise<void> {
    return new Promise((done) => {
      if (this.ws.readyState === WebSocket.CLOSED) return done();
      this.ws.once('close', () => done());
      this.ws.close();
    });
  }
}

// ---- the checks

/**
 * How near one of the bot's units must be to see this enemy where it stands,
 * before the spotter's own `spotting`: the stealth rule, from the view alone.
 * Hiding terrain hides a unit that has not fired, to `still` hexes if it kept
 * still in the last round and to `moved` if it moved without dashing. One
 * that dashed or fired, or stands in the open, is not hidden at all.
 */
function hiddenBeyond(view: PlayerView, e: Unit): number {
  const hide = TERRAIN[view.map.cells[key(e.pos)]?.terrain ?? '']?.hide ?? null;
  if (hide === null || e.revealed) return Infinity;
  if (e.posture === 'dashed') return Infinity;
  if (e.posture === 'moved') return hide.moved ?? Infinity;
  if (e.posture === 'still') return hide.still;
  throw new Error(`unit ${e.id} has no posture the rules know: ${String(e.posture)}`);
}
const ownLiving = (view: PlayerView): Unit[] => view.units.filter((u) => u.owner === view.player && u.status !== 'down');

/** Could this view's own units see that unit? The sight rule, from the view alone. */
function couldSee(view: PlayerView, e: Unit): boolean {
  if (e.status === 'down') return false;
  if (view.eliminated[view.player]) return true;
  const near = hiddenBeyond(view, e);
  return ownLiving(view).some((f) => {
    const d = distance(f.pos, e.pos);
    if (d > (UNITS[f.type]?.sight ?? 0)) return false;
    if (!canSee(view.map, f.pos, e.pos)) return false;
    return d <= near + (UNITS[f.type]?.spotting ?? 0);
  });
}

function hexesInSight(view: PlayerView): Set<HexKey> {
  if (view.eliminated[view.player]) return new Set(Object.keys(view.map.cells));
  const out = new Set<HexKey>();
  for (const u of ownLiving(view)) {
    for (const h of within(u.pos, UNITS[u.type]?.sight ?? 0)) {
      if (view.map.cells[key(h)] && canSee(view.map, u.pos, h)) out.add(key(h));
    }
  }
  return out;
}

/** A view on its own: nothing in it that its player should not have. */
function checkView(view: PlayerView, fail: (what: string) => void): void {
  for (const u of view.units) {
    if (u.owner !== view.player && !couldSee(view, u)) fail(`view holds enemy ${u.id} at ${key(u.pos)} (${u.status}) that no own unit can see`);
  }
  const sight = hexesInSight(view);
  const sent = new Set(view.visible);
  for (const k of sent) if (!sight.has(k)) fail(`view lists hex ${k} as visible but no own unit can see it`);
  for (const k of sight) if (!sent.has(k)) fail(`view leaves out hex ${k} that an own unit can see`);
}

/** All the views of one moment, against each other: each seat sees exactly the enemies the sight rule gives it. */
function checkTogether(views: PlayerView[], fail: (seat: number, what: string) => void): void {
  for (const a of views) {
    for (const b of views) {
      if (a.player === b.player) continue;
      for (const truth of b.units.filter((u) => u.owner === b.player)) {
        const got = a.units.find((u) => u.id === truth.id);
        const should = couldSee(a, truth);
        if (should && !got) fail(a.player, `view leaves out enemy ${truth.id} at ${key(truth.pos)} that an own unit can see`);
        if (got && JSON.stringify(got) !== JSON.stringify(truth)) fail(a.player, `view shows enemy ${truth.id} differently from its owner's view`);
      }
    }
    if (JSON.stringify(a.scores) !== JSON.stringify(views[0].scores)) fail(a.player, 'scores differ between seats');
    if (a.round !== views[0].round || a.over !== views[0].over) fail(a.player, 'round or end differs between seats');
  }
}

/**
 * One round's events as one seat received them: they may speak only of units
 * that seat knows (its own, enemies in its last view, enemies `spotted`
 * since), and followed through they must arrive at the next view.
 */
function checkEvents(before: PlayerView, events: GameEvent[], after: PlayerView, fail: (what: string) => void): void {
  const me = before.player;
  interface Known { pos: HexKey; status: UnitStatus; owner: number; posture: Posture; revealed: boolean }
  const known = new Map<UnitId, Known>();
  for (const u of before.units) known.set(u.id, { pos: key(u.pos), status: u.status, owner: u.owner, posture: u.posture, revealed: u.revealed });
  const givesAway = (action: string): boolean => ACTIONS[action]?.reveals ?? true;
  let atScore: Map<UnitId, Known> | null = null;     // who the seat knew of, and where, when the scoring began
  const named = new Set<string>();                   // "objective/player" for every score that named its objective
  const need = (id: UnitId, e: GameEvent): Known | null => {
    const k = known.get(id);
    if (!k) fail(`event ${JSON.stringify(e)} names unit ${id}, which this seat does not know`);
    return k ?? null;
  };
  for (const e of events) {
    switch (e.t) {
      case 'spotted':
        if (e.unit.owner === me) fail(`own unit ${e.unit.id} reported as spotted`);
        else if (known.has(e.unit.id)) fail(`${e.unit.id} spotted while already in view`);
        known.set(e.unit.id, { pos: key(e.unit.pos), status: e.unit.status, owner: e.unit.owner, posture: e.unit.posture, revealed: e.unit.revealed });
        break;
      case 'phase':
        // A new round: nobody has fired or moved in it yet.
        if (e.phase === 'treat') for (const k of known.values()) { k.posture = 'still'; k.revealed = false; }
        if (e.phase === 'score') atScore = new Map([...known].map(([id, k]) => [id, { ...k }]));
        break;
      case 'dash': {
        const k = need(e.unit, e);
        if (k) k.posture = 'dashed';
        break;
      }
      case 'score': {
        if (e.objective === null) {
          if (e.player === me) fail(`own score of ${e.value} came without its objective`);
          break;
        }
        const obj = before.map.objectives.find((o) => o.id === e.objective);
        if (!obj) { fail(`score names objective ${e.objective}, which is not on the map`); break; }
        named.add(`${obj.id}/${e.player}`);
        const holder = [...(atScore ?? known).values()].some((k) => k.owner === e.player && k.status !== 'down' && k.pos === key(obj.hex));
        if (!holder) fail(`score names objective ${obj.id} for seat ${e.player}, but this seat knows of no unit of that seat standing on it`);
        break;
      }
      case 'lost':
        if (need(e.unit, e)) known.delete(e.unit);
        break;
      case 'treat': {
        need(e.unit, e);
        const t = need(e.target, e);
        if (t) t.status = 'ready';
        break;
      }
      case 'fire':
        if (e.unit !== null) {
          const k = need(e.unit, e);
          if (k && e.from && key(e.from) !== k.pos) fail(`fire by ${e.unit} from ${key(e.from)} but it stands at ${k.pos}`);
          if (k && givesAway(e.action)) k.revealed = true;
        }
        break;
      case 'launch': {
        const k = need(e.unit, e);
        if (k && givesAway(e.action)) k.revealed = true;
        break;
      }
      case 'reveal': {
        const k = need(e.unit, e);
        if (k) k.revealed = true;
        break;
      }
      case 'hit': {
        const k = need(e.unit, e);
        if (!k) break;
        if (key(e.at) !== k.pos) fail(`hit on ${e.unit} at ${key(e.at)} but it stands at ${k.pos}`);
        if (e.result === 'pinned') k.status = 'pinned';
        if (e.result === 'down') {
          k.status = 'down';
          if (k.owner !== me) known.delete(e.unit);      // a downed enemy leaves the view without a `lost`
        }
        break;
      }
      case 'move': {
        const k = need(e.unit, e);
        if (!k) break;
        if (key(e.from) !== k.pos) fail(`move of ${e.unit} from ${key(e.from)} but it stands at ${k.pos}`);
        k.pos = key(e.to);
        if (k.posture === 'still') k.posture = 'moved';
        break;
      }
      case 'blocked':
      case 'unable':
        need(e.unit, e);
        break;
      case 'recover': {
        const k = need(e.unit, e);
        if (k) k.status = 'ready';
        break;
      }
      default:
        break;
    }
  }
  for (const u of after.units) {
    const k = known.get(u.id);
    if (!k) { fail(`next view holds ${u.id} but no event brought it into view`); continue; }
    if (k.pos !== key(u.pos)) fail(`events leave ${u.id} at ${k.pos}, next view has it at ${key(u.pos)}`);
    if (k.status !== u.status) fail(`events leave ${u.id} ${k.status}, next view has it ${u.status}`);
    if (k.posture !== u.posture) fail(`events leave ${u.id} ${k.posture}, next view has it ${u.posture}`);
    if (k.revealed !== u.revealed) fail(`events leave ${u.id} ${k.revealed ? 'given away' : 'not given away'}, next view says otherwise`);
  }
  // Every unit this seat knew of on an objective when the scoring began must have had its score named.
  for (const obj of before.map.objectives) {
    for (const k of (atScore ?? new Map<UnitId, Known>()).values()) {
      if (k.status !== 'down' && k.pos === key(obj.hex) && !named.has(`${obj.id}/${k.owner}`)) {
        fail(`seat ${k.owner} holds objective ${obj.id} in this seat's sight, but no score named it`);
      }
    }
  }
  for (const id of known.keys()) {
    if (!after.units.some((u) => u.id === id)) fail(`events leave ${id} in view, next view does not hold it`);
  }
}

// ---- the server

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => done(p));
    });
    s.on('error', fail);
  });
}

interface Server { child: ChildProcess; port: number; logs: string[]; errors: string[] }

async function startServer(dir: string): Promise<Server> {
  const port = await freePort();
  const root = resolvePath(fileURLToPath(new URL('../', import.meta.url)));
  const child = spawn(process.execPath, ['--import', 'tsx', join(root, 'src/server/main.ts'), '--port', String(port), '--timer', '0', '--matches', dir], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const server: Server = { child, port, logs: [], errors: [] };
  let out = '';
  const up = new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(new Error('the server did not start in 20 seconds')), 20_000);
    child.stdout!.on('data', (d: Buffer) => {
      out += d.toString();
      for (const m of out.matchAll(/^Match log: (.+)$/gm)) if (!server.logs.includes(m[1])) server.logs.push(m[1]);
      if (out.includes('listening')) { clearTimeout(timer); done(); }
    });
    child.once('exit', (code) => { clearTimeout(timer); fail(new Error(`the server stopped (code ${code})`)); });
  });
  child.stderr!.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n')) if (line.trim()) server.errors.push(line.trim());
  });
  await up;
  return server;
}

// ---- one match

interface Tally { rounds: number; hits: number; downs: number; eliminations: number; early: number; orders: number; rejoins: number; treats: number; ambushes: number; score: number; unnamed: number; followUps: number; followRan: number; followNot: number; onto: number; fellBack: number }

async function playMatch(server: Server, bots: Bot[], seed: number, tally: Tally, fail: (what: string) => void): Promise<void> {
  const r = rng(seed);
  const n = bots.length;
  const logsBefore = server.logs.length;

  // lobby: squads in seat order, everyone ready, host starts
  const keen = r() < 0.6;           // most tables fight; the rest wander
  const squads = bots.map(() => randomSquad(r));
  for (const [i, b] of bots.entries()) {
    b.inbox = [];
    b.send({ t: 'squad', units: squads[i] });
    b.send({ t: 'ready', ready: true });
  }
  // The sockets are separate: wait until the host has been told that everyone is ready.
  for (;;) {
    const l = await bots[0].next('lobby');
    if (l.seats.length === n && l.seats.every((s) => s.ready)) break;
  }
  bots[0].send({ t: 'start' });
  let views: PlayerView[] = [];
  for (const [i, b] of bots.entries()) {
    const m = await b.next('plan', 'error');
    if (m.t === 'error') throw new Error(`the match did not start: ${m.message}`);
    views[i] = m.view;
  }

  const maxRounds = views[0].maxRounds;
  for (;;) {
    for (const v of views) checkView(v, (what) => fail(`seat ${v.player}, round ${v.round}: ${what}`));
    checkTogether(views, (seat, what) => fail(`seat ${seat}, round ${views[0].round}: ${what}`));
    if (views[0].over) break;
    if (views[0].round > maxRounds) { fail(`round ${views[0].round} reached and the match is not over`); break; }

    // orders, in seat order
    const sent: Order[][] = [];
    for (const [i, b] of bots.entries()) {
      if (views[i].eliminated[i]) { sent[i] = []; continue; }
      if (r() < REJOIN_CHANCE) {
        // Drop the line and take the seat back: the server must hand over the same view.
        await b.close();
        await b.connect();
        b.inbox = [];
        await b.join();
        const back = (await b.next('plan')).view;
        if (JSON.stringify(back) !== JSON.stringify(views[i])) fail(`seat ${i}, round ${views[i].round}: the view after rejoining differs from the one before`);
        tally.rejoins++;
      }
      sent[i] = randomOrders(r, views[i], keen);
      tally.orders += sent[i].length;
      for (const o of sent[i]) {
        if (o.kind === 'move' && o.then) tally.followUps++;
        const end = o.kind === 'move' || o.kind === 'dash' ? o.path[o.path.length - 1] : null;
        if (end && views[i].units.some((u) => u.owner === i && u.id !== o.unit && u.status !== 'down' && key(u.pos) === key(end))) tally.onto++;
      }
      b.send({ t: 'orders', orders: sent[i] });
    }

    // the round, as each seat is told it
    const next: PlayerView[] = [];
    for (const [i, b] of bots.entries()) {
      let m = await b.next('resolve', 'rejected', 'error');
      if (m.t !== 'resolve') {
        fail(`seat ${i}, round ${views[i].round}: ${m.t === 'rejected' ? `orders rejected: ${JSON.stringify(m.errors)}` : `server error: ${m.message}`}; orders were ${JSON.stringify(sent[i])}`);
        b.send({ t: 'orders', orders: [] });         // hold, so the match can go on
        m = await b.next('resolve');
      }
      const where = `seat ${i}, round ${views[i].round}`;
      checkEvents(views[i], m.events, m.view, (what) => fail(`${where}: ${what}`));
      m.view.scores.forEach((s, p) => { if (s < views[i].scores[p]) fail(`${where}: seat ${p}'s score fell from ${views[i].scores[p]} to ${s}`); });
      if (m.view.round !== views[i].round + 1) fail(`${where}: next view is for round ${m.view.round}`);
      if (i === 0) {
        tally.rounds++;
        for (const e of m.events) if (e.t === 'eliminated') tally.eliminations++;
      }
      // Every follow-up this seat ordered must be accounted for: it ran, or an `unable` says why not.
      let assault = false;
      const halted = new Set<UnitId>();
      const settled = new Set<UnitId>();
      for (const e of m.events) {
        if (e.t === 'phase') assault = e.phase === 'assault';
        if (e.t === 'blocked') halted.add(e.unit);
        if (e.t === 'move' && halted.has(e.unit) && e.unit.startsWith(`${i}-`)) tally.fellBack++;
        if (e.t === 'unable' && e.unit.startsWith(`${i}-`)) { tally.followNot++; settled.add(e.unit); }
        if (assault && (e.t === 'fire' || e.t === 'launch' || e.t === 'treat') && e.unit?.startsWith(`${i}-`)) { tally.followRan++; settled.add(e.unit); }
        if (e.t === 'hit' && e.unit.startsWith(`${i}-`)) { tally.hits++; if (e.result === 'down') tally.downs++; }
        if (e.t === 'treat' && e.unit.startsWith(`${i}-`)) tally.treats++;
        if (e.t === 'fire' && e.ambush && e.unit?.startsWith(`${i}-`)) tally.ambushes++;
        if (e.t === 'score' && e.objective === null) tally.unnamed++;
      }
      for (const o of sent[i]) {
        if (o.kind !== 'move' || !o.then || settled.has(o.unit)) continue;
        const type = views[i].units.find((u) => u.id === o.unit)?.type ?? '';
        const action = ACTIONS[UNITS[type]?.[o.then.kind] ?? ''];
        // A quiet action that changes nobody (a medic at a man who is not pinned) leaves no event.
        if (action?.phase !== 'treat') fail(`${where}: ${o.unit}'s follow-up neither ran nor was reported as not happening`);
      }
      next[i] = m.view;
    }
    views = next;
  }
  if (views[0].round <= maxRounds) tally.early++;
  tally.score += views[0].scores.reduce((a, b) => a + b, 0);

  // the server's log, replayed
  const logFile = server.logs[logsBefore];
  if (!logFile || server.logs.length !== logsBefore + 1) {
    fail(`expected one new match log, found ${server.logs.length - logsBefore}`);
  } else {
    const lines = readFileSync(logFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const start = lines[0];
    if (start?.t !== 'start') {
      fail('the log does not begin with a start line');
    } else {
      const logSquads: Squad[] = start.seats.map((s: { squad: UnitTypeId[] }, p: number) => ({ player: p, units: s.squad }));
      if (JSON.stringify(logSquads.map((s) => s.units)) !== JSON.stringify(squads)) fail('the squads in the log are not the ones the bots sent');
      let state = createMatch(MAPS[start.map], logSquads);
      for (const line of lines.slice(1)) state = resolve(state, line.orders).state;
      if (!state.over) fail(`replaying the log stops at round ${state.round} without ending the match`);
      if (JSON.stringify(state.scores) !== JSON.stringify(views[0].scores)) fail(`replay scores ${JSON.stringify(state.scores)} differ from the match's ${JSON.stringify(views[0].scores)}`);
      if (JSON.stringify(state.winners) !== JSON.stringify(views[0].winners)) fail(`replay winners ${JSON.stringify(state.winners)} differ from the match's ${JSON.stringify(views[0].winners)}`);
    }
  }
  if (server.errors.length > 0) fail(`the server wrote to stderr: ${server.errors.splice(0).join(' | ')}`);

  // back to the lobby for the next one
  bots[0].send({ t: 'rematch' });
  for (const b of bots) await b.next('lobby');
}

// ---- the run

async function main(): Promise<number> {
  const plan = Array.from({ length: matchCount }, (_, i) => ({ seed: (baseSeed + i) >>> 0, players: playersOpt ?? 2 + (i % 3) }));
  console.log(`Dawn Squad bots: ${matchCount} matches, seed ${baseSeed}${playersOpt ? `, ${playersOpt} players` : ', players 2/3/4 in turn'}`);
  const dir = mkdtempSync(join(tmpdir(), 'dawn-squad-bots-'));
  const failures: string[] = [];
  let failedMatches = 0;
  const started = Date.now();
  try {
    for (const players of [2, 3, 4]) {
      const mine = plan.filter((m) => m.players === players);
      if (mine.length === 0) continue;
      const server = await startServer(dir);
      const tally: Tally = { rounds: 0, hits: 0, downs: 0, eliminations: 0, early: 0, orders: 0, rejoins: 0, treats: 0, ambushes: 0, score: 0, unnamed: 0, followUps: 0, followRan: 0, followNot: 0, onto: 0, fellBack: 0 };
      let bad = 0;
      try {
        const bots = Array.from({ length: players }, (_, i) => new Bot(`ws://127.0.0.1:${server.port}/ws`, `Bot ${i + 1}`));
        for (const b of bots) {             // one at a time, so seats are in order
          await b.connect();
          await b.join();
          await b.next('lobby');
        }
        for (const m of mine) {
          const found: string[] = [];
          const rerun = `npm run bots -- --seed ${m.seed} --players ${players} --matches 1`;
          try {
            await playMatch(server, bots, m.seed, tally, (what) => { if (found.length < 20) found.push(what); });
          } catch (e) {
            found.push(`stopped: ${(e as Error).message}`);
            if (server.errors.length > 0) found.push(`server stderr: ${server.errors.splice(0).join(' | ')}`);
          }
          if (found.length > 0) {
            bad++;
            failedMatches++;
            failures.push(`FAIL seed ${m.seed}, ${players} players (re-run: ${rerun})`, ...found.map((f) => `  - ${f}`));
            console.log(failures.slice(-found.length - 1).join('\n'));
            if (found.some((f) => f.startsWith('stopped:'))) break;      // the table is in an unknown state
          }
        }
        await Promise.all(bots.map((b) => b.close().catch(() => undefined)));
      } finally {
        server.child.kill();
      }
      console.log(
        `${players} players: ${mine.length - bad}/${mine.length} matches passed; ${tally.rounds} rounds, ${tally.orders} orders, `
        + `${tally.hits} hits (${tally.downs} down), ${tally.treats} treated, ${tally.ambushes} ambushes sprung, `
        + `${tally.score} points scored (${tally.unnamed} scores told without their objective), `
        + `${tally.eliminations} squads wiped, ${tally.early} ended early, ${tally.rejoins} rejoins; `
        + `${tally.followUps} follow-ups ordered (${tally.followRan} ran, ${tally.followNot} did not), `
        + `${tally.onto} moves ordered onto a teammate's hex, ${tally.fellBack} steps fallen back`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (failedMatches > 0) {
    console.log(`FAILED: ${failedMatches} of ${matchCount} matches had failures (seed ${baseSeed}, ${secs}s)`);
    return 1;
  }
  console.log(`PASS: ${matchCount} matches, no failures (seed ${baseSeed}, ${secs}s)`);
  return 0;
}

main().then((code) => process.exit(code), (e) => {
  console.error('bots:', e);
  process.exit(1);
});
