// The host's process: static files from dist/, a WebSocket at /ws, and the
// match room from match.ts. Run with `npm run server`.
//   --port <n>        listen port (default 8080)
//   --timer <s>       seconds to plan each round (default 90, 0 = none)
//   --resume <file>   rebuild a match from its order log, then wait for rejoins
//   --matches <dir>   where order logs go (default ./matches)

import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import qrcode from 'qrcode-terminal';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { Room } from './match';
import type { LogLine, LogSink, Out } from './match';

const MAX_MESSAGE = 64 * 1024;       // bytes per WebSocket frame
const MAX_SOCKETS = 64;
const PING_MS = 15_000;
const TICK_MS = 500;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp',
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function numberArg(name: string, fallback: number): number {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`--${name} must be a number of 0 or more.`);
    process.exit(1);
  }
  return n;
}

const port = numberArg('port', 8080);
const timerSec = numberArg('timer', 90);
const matchesDir = resolvePath(arg('matches') ?? 'matches');
const root = resolvePath(fileURLToPath(new URL('../../', import.meta.url)));
const distDir = join(root, 'dist');

// ---- the order log

function fileSink(file: string): LogSink {
  return (line: LogLine) => {
    try {
      appendFileSync(file, JSON.stringify(line) + '\n');
    } catch (e) {
      console.error('Could not write the match log:', (e as Error).message);
    }
  };
}

function newLog(): LogSink {
  mkdirSync(matchesDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let file = join(matchesDir, `${stamp}.jsonl`);
  for (let n = 2; existsSync(file); n++) file = join(matchesDir, `${stamp}-${n}.jsonl`);
  writeFileSync(file, '');
  console.log(`Match log: ${file}`);
  return fileSink(file);
}

function readLog(file: string): LogLine[] {
  const text = readFileSync(file, 'utf8');
  const rows = text.split('\n').filter((l) => l.trim() !== '');
  const lines: LogLine[] = [];
  rows.forEach((row, i) => {
    try {
      lines.push(JSON.parse(row) as LogLine);
    } catch {
      if (i !== rows.length - 1) throw new Error(`Line ${i + 1} of the log is not JSON.`);
      console.warn('Ignoring a half-written last line in the log.');   // the crash that made us resume
    }
  });
  return lines;
}

const roomOptions = {
  timerSec,
  now: () => Date.now(),
  makeToken: () => randomBytes(16).toString('hex'),
  newLog,
};

let room: Room;
const resumeFile = arg('resume');
if (resumeFile) {
  try {
    const path = resolvePath(resumeFile);
    room = Room.resume(readLog(path), roomOptions, fileSink(path));
    console.log(`Resumed ${path} at round ${room.state?.round} (${room.currentStage}). Waiting for players to rejoin.`);
  } catch (e) {
    console.error(`Cannot resume: ${(e as Error).message}`);
    process.exit(1);
  }
} else {
  room = new Room(roomOptions);
}

// ---- static files, from inside dist/ only

let distReal: string | null = null;
try { distReal = realpathSync(distDir); } catch { /* not built yet */ }

function send(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

// Phones on Wi-Fi fetch the client: text and fonts go out gzipped, and what cannot change is cached.
const SQUASH = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.map', '.txt', '.ttf']);
const squashed = new Map<string, { stamp: string; data: Buffer }>();

function gzipped(file: string, mtimeMs: number, size: number): Buffer {
  const stamp = `${mtimeMs}:${size}`;
  const hit = squashed.get(file);
  if (hit && hit.stamp === stamp) return hit.data;
  const data = gzipSync(readFileSync(file));
  squashed.set(file, { stamp, data });
  return data;
}

/** Vite names files under assets/ by their content, so they never change; fonts rarely; the page itself is always asked for again. */
function cacheFor(file: string, base: string): string {
  if (file.startsWith(join(base, 'assets') + sep)) return 'public, max-age=31536000, immutable';
  if (file.startsWith(join(base, 'fonts') + sep)) return 'public, max-age=86400';
  return 'no-cache';
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  if (!distReal) {
    try { distReal = realpathSync(distDir); } catch { return send(res, 404, 'No client build yet. Run `npm run build` (or use `npm start`).'); }
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (pathname.includes('\0')) return send(res, 400, 'Bad request');
  if (pathname.endsWith('/')) pathname += 'index.html';
  const base = distReal;
  let file: string;
  try {
    file = realpathSync(resolvePath(base, '.' + pathname));
  } catch {
    // Unknown path without an extension: let the client router have it.
    if (extname(pathname) === '') {
      try { file = realpathSync(join(base, 'index.html')); } catch { return send(res, 404, 'Not found'); }
    } else {
      return send(res, 404, 'Not found');
    }
  }
  if (file !== base && !file.startsWith(base + sep)) return send(res, 404, 'Not found');
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return send(res, 404, 'Not found');
    const ext = extname(file).toLowerCase();
    const wantsGzip = SQUASH.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    const data = wantsGzip ? gzipped(file, stat.mtimeMs, stat.size) : readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': cacheFor(file, base),
      'Vary': 'Accept-Encoding',
      ...(wantsGzip ? { 'Content-Encoding': 'gzip' } : {}),
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    send(res, 404, 'Not found');
  }
}

// ---- sockets

const server = createServer((req, res) => {
  try {
    serveStatic(req, res);
  } catch {
    if (!res.headersSent) send(res, 500, 'Server error');
    else res.end();
  }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
const sockets = new Map<number, WebSocket>();
let nextConn = 1;

function dispatch(outs: Out[]): void {
  for (const o of outs) {
    const ws = sockets.get(o.to);
    if (!ws) continue;
    try {
      if ('close' in o) {
        sockets.delete(o.to);                 // already unseated by the room
        ws.close(4000, 'Seat taken by another connection');
      } else if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(o.msg));
      }
    } catch (e) {
      console.error('send failed:', (e as Error).message);
    }
  }
}

server.on('upgrade', (req, socket, head) => {
  const path = (req.url ?? '').split('?')[0];
  if (path !== '/ws' || sockets.size >= MAX_SOCKETS) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const id = nextConn++;
    sockets.set(id, ws);
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const beat = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      try { ws.ping(); } catch { /* closing */ }
    }, PING_MS);
    ws.on('message', (data, isBinary) => {
      try {
        if (isBinary) return dispatch([{ to: id, msg: { t: 'error', message: 'Text frames only.' } }]);
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString());
        } catch {
          return dispatch([{ to: id, msg: { t: 'error', message: 'That was not JSON.' } }]);
        }
        dispatch(room.handle(id, parsed));
      } catch (e) {
        console.error('handler failed:', (e as Error).message);
      }
    });
    ws.on('error', () => { /* a reset connection; 'close' follows */ });
    ws.on('close', () => {
      clearInterval(beat);
      sockets.delete(id);
      try { dispatch(room.disconnect(id)); } catch (e) { console.error('disconnect failed:', (e as Error).message); }
    });
  });
});

setInterval(() => {
  try { dispatch(room.tick()); } catch (e) { console.error('tick failed:', (e as Error).message); }
}, TICK_MS);

process.on('uncaughtException', (e) => console.error('uncaught:', e));
process.on('unhandledRejection', (e) => console.error('unhandled:', e));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(0));

// ---- go

server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try --port.` : e.message);
  process.exit(1);
});
server.listen(port, '0.0.0.0', () => {
  console.log(`Dawn Company server listening on port ${port} (timer ${timerSec > 0 ? `${timerSec}s` : 'off'})`);
  const urls: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${port}`);
  }
  if (urls.length === 0) urls.push(`http://localhost:${port}`);
  console.log('Players open:');
  for (const u of urls) console.log(`  ${u}`);
  qrcode.generate(urls[0], { small: true });
});
