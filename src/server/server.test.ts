// Integration: start main.ts as a real process on a spare port and play a
// round over real sockets. Logs go to a temporary directory.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg } from '../shared/protocol';

let child: ChildProcess;
let port = 0;
let dir = '';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

class Client {
  ws: WebSocket;
  inbox: ServerMsg[] = [];
  private waiters: (() => void)[] = [];
  constructor() {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on('message', (d) => {
      this.inbox.push(JSON.parse(d.toString()) as ServerMsg);
      this.waiters.splice(0).forEach((w) => w());
    });
  }
  open(): Promise<void> {
    return new Promise((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); });
  }
  send(m: ClientMsg | string): void { this.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
  async next<T extends ServerMsg['t']>(t: T): Promise<Extract<ServerMsg, { t: T }>> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i !== -1) return this.inbox.splice(i, 1)[0] as Extract<ServerMsg, { t: T }>;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${t}; have ${this.inbox.map((m) => m.t)}`);
      await new Promise<void>((r) => { this.waiters.push(r); setTimeout(r, 100); });
    }
  }
}

/** A server process on a free port, with its match logs in `matches`. */
async function startServer(timerSec: number, matches: string): Promise<{ child: ChildProcess; port: number }> {
  const p = await freePort();
  const c = spawn(process.execPath, ['--import', 'tsx', 'src/server/main.ts', '--port', String(p), '--timer', String(timerSec), '--matches', matches], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    c.stdout!.on('data', (d: Buffer) => { if (d.toString().includes('listening')) { clearTimeout(t); resolve(); } });
    c.on('exit', () => reject(new Error('server exited')));
  });
  return { child: c, port: p };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dawn-squad-test-'));
  ({ child, port } = await startServer(0, dir));
}, 20000);

afterAll(() => {
  child?.kill();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('server over real sockets', () => {
  it('seats two players, survives junk, plays a round, and logs it', async () => {
    const a = new Client();
    const b = new Client();
    await Promise.all([a.open(), b.open()]);

    a.send('this is not json');
    expect((await a.next('error')).message).toMatch(/json/i);
    a.send({ t: 'join', name: 'Ann' });
    const wa = await a.next('welcome');
    b.send({ t: 'join', name: 'Bob' });
    const wb = await b.next('welcome');
    expect([wa.seat, wb.seat, wa.host, wb.host]).toEqual([0, 1, true, false]);
    expect(wa.token).not.toBe(wb.token);

    for (const c of [a, b]) c.send({ t: 'ready', ready: true });
    for (;;) {                                           // sockets are independent: wait until both are ready
      const l = await a.next('lobby');
      if (l.seats.length === 2 && l.seats.every((x) => x.ready)) break;
    }
    a.send({ t: 'start' });
    const pa = await a.next('plan');
    const pb = await b.next('plan');
    expect(pa.view.player).toBe(0);
    expect(pb.view.player).toBe(1);
    expect(JSON.stringify(pa)).not.toContain(wb.token);

    a.send({ t: 'orders', orders: [] });
    b.send({ t: 'orders', orders: [{ unit: '0-0', kind: 'ambush' }] });       // not Bob's unit
    expect((await b.next('rejected')).errors.length).toBeGreaterThan(0);
    b.send({ t: 'orders', orders: [{ unit: '1-0', kind: 'ambush' }] });
    const ra = await a.next('resolve');
    const rb = await b.next('resolve');
    expect(ra.view.round).toBe(2);
    expect(ra.view.player).toBe(0);
    expect(rb.view.player).toBe(1);

    // reconnect by token mid-match
    b.ws.close();
    const b2 = new Client();
    await b2.open();
    b2.send({ t: 'join', name: 'ignored', token: wb.token });
    expect((await b2.next('welcome')).seat).toBe(1);
    expect((await b2.next('plan')).view.round).toBe(2);

    a.ws.close();
    b2.ws.close();

    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    expect(files).toHaveLength(1);
    const lines = readFileSync(join(dir, files[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ t: 'start', map: 'ford' });
    expect(lines[1]).toMatchObject({ t: 'round', round: 1 });
  }, 20000);

  it('runs a draft that was never sent with the lever at the bell, and hands it back on reconnect', async () => {
    const own = mkdtempSync(join(tmpdir(), 'dawn-squad-test-'));
    const srv = await startServer(4, own);               // a 4 second clock of its own
    const saved = port;
    port = srv.port;
    const clients: Client[] = [];
    try {
      const a = new Client();
      const b = new Client();
      clients.push(a, b);
      await Promise.all([a.open(), b.open()]);
      a.send({ t: 'join', name: 'Ann' });
      const wa = await a.next('welcome');
      b.send({ t: 'join', name: 'Bob' });
      await b.next('welcome');
      for (const c of [a, b]) c.send({ t: 'ready', ready: true });
      for (;;) {
        const l = await a.next('lobby');
        if (l.seats.length === 2 && l.seats.every((x) => x.ready)) break;
      }
      a.send({ t: 'start' });
      const pa = await a.next('plan');
      await b.next('plan');
      expect(pa.orders).toBeNull();
      const mine = pa.view.units.filter((u) => u.owner === 0);
      const order = { unit: mine[0].id, kind: 'ambush' as const };
      a.send({ t: 'draft', orders: [order] });
      a.send({ t: 'draft', orders: [{ unit: '1-0', kind: 'ambush' }] });        // invalid: dropped, no reply
      // reconnect mid-round: the held orders come back, and the lever is still up
      a.ws.close();
      const a2 = new Client();
      clients.push(a2);
      await a2.open();
      a2.send({ t: 'join', name: 'ignored', token: wa.token });
      await a2.next('welcome');
      const back = await a2.next('plan');
      expect(back.orders).toEqual([order]);
      expect(back.seats[0].ready).toBe(false);
      // nobody pulls a lever: the bell ends the round and the draft ran (the ambusher shows in the log)
      const r = await a2.next('resolve');
      expect(r.view.round).toBe(2);
      expect(a2.inbox.some((m) => m.t === 'rejected' || m.t === 'error')).toBe(false);
      const files = readdirSync(own).filter((f) => f.endsWith('.jsonl'));
      const lines = readFileSync(join(own, files[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(lines[1]).toMatchObject({ t: 'round', round: 1, orders: [[order], []] });
    } finally {
      for (const c of clients) c.ws.close();
      port = saved;
      srv.child.kill();
      rmSync(own, { recursive: true, force: true });
    }
  }, 30000);

  it('serves only inside dist, and not the repo around it', async () => {
    for (const path of ['/..%2f..%2fpackage.json', '/../package.json', '/%2e%2e/%2e%2e/package.json', '/src/server/main.ts']) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      const body = await res.text();
      expect(body).not.toContain('"dawn-squad"');
      expect(body).not.toContain('createServer');
    }
  });

  it.skipIf(!existsSync('dist/index.html'))('gzips the client and caches what cannot change', async () => {
    const page = await fetch(`http://127.0.0.1:${port}/`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(page.headers.get('content-encoding')).toBe('gzip');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    const html = await page.text();
    expect(html).toContain('<html');
    const script = /\/assets\/[^"]+\.js/.exec(html)![0];
    const js = await fetch(`http://127.0.0.1:${port}${script}`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(js.headers.get('content-encoding')).toBe('gzip');
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect(Number(js.headers.get('content-length'))).toBeLessThan(readFileSync(`dist${script}`).length / 2);
    const plain = await fetch(`http://127.0.0.1:${port}${script}`, { headers: { 'Accept-Encoding': 'identity' } });
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect((await plain.arrayBuffer()).byteLength).toBe(readFileSync(`dist${script}`).length);
  });

  it('refuses an oversized frame without dying', async () => {
    const c = new Client();
    await c.open();
    const closed = new Promise<number>((r) => c.ws.once('close', (code) => r(code)));
    c.send(JSON.stringify({ t: 'join', name: 'x'.repeat(200_000) }));
    expect(await closed).toBe(1009);
    const d = new Client();
    await d.open();
    d.send({ t: 'join', name: 'Still alive' });
    expect((await d.next('error')).message).toMatch(/started/i);   // alive, and answering
    d.ws.close();
  });
});
