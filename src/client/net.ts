// The socket to the host. Keeps the seat token, reconnects by itself, and
// hands server messages to whoever listens. Plain DOM-free except for
// WebSocket and localStorage, both of which are guarded.

import type { ClientMsg, ServerMsg } from '../shared/protocol';

export interface Net {
  /** Send now, or drop it if the line is down. Nothing is queued. */
  send(msg: ClientMsg): void;
  on<T extends ServerMsg['t']>(t: T, cb: (msg: Extract<ServerMsg, { t: T }>) => void): () => void;
  /** Called on every change of the line, and once at once if the state is already known. */
  onStatus(cb: (online: boolean) => void): void;
}

const RETRY_MS = [250, 500, 1000, 2000, 3000];
const AWAY_MS = 3000;            // hidden longer than this, the line is not trusted: a phone that slept may hold a dead socket
const SEAT_TAKEN = 4000;        // the close code the server uses when another window takes the seat

function store(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function connect(slot?: string): Net {
  const params = new URLSearchParams(location.search);
  const name = slot ?? params.get('slot') ?? 'default';
  const tokenKey = `dawn-company-token-${name}`;
  const nameKey = `dawn-company-name-${name}`;
  const read = (k: string): string | null => { try { return store()?.getItem(k) ?? null; } catch { return null; } };
  const write = (k: string, v: string): void => { try { store()?.setItem(k, v); } catch { /* private mode */ } };

  let token = read(tokenKey);
  let playerName = read(nameKey) ?? '';
  let wantSeat = token !== null;                 // a remembered seat is reclaimed without being asked
  let ws: WebSocket | null = null;
  let online: boolean | null = null;
  let attempt = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Map<string, Set<(msg: never) => void>>();
  const statusListeners: ((online: boolean) => void)[] = [];

  const setOnline = (v: boolean): void => {
    if (online === v) return;
    online = v;
    for (const cb of [...statusListeners]) cb(v);
  };

  const emit = (msg: ServerMsg): void => {
    for (const cb of [...(listeners.get(msg.t) ?? [])]) (cb as (m: ServerMsg) => void)(msg);
  };

  const rawSend = (msg: ClientMsg): void => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const sendJoin = (): void => rawSend({ t: 'join', name: playerName, ...(token ? { token } : {}) });

  function open(): void {
    if (stopped) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let sock: WebSocket;
    try {
      sock = new WebSocket(`${proto}://${location.host}/ws`);
    } catch {
      retry();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      attempt = 0;
      setOnline(true);
      if (wantSeat) sendJoin();
    };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      let msg: ServerMsg;
      try { msg = JSON.parse(String(ev.data)) as ServerMsg; } catch { return; }
      if (msg.t === 'welcome') {
        token = msg.token;
        wantSeat = true;
        write(tokenKey, msg.token);
      }
      emit(msg);
    };
    sock.onclose = (ev) => {
      if (ws !== sock) return;        // a line we already hung up on
      ws = null;
      setOnline(false);
      if (ev.code === SEAT_TAKEN) {
        stopped = true;     // another window has this seat; two windows must not fight over it
        emit({ t: 'error', message: 'This seat is open in another window. Reload here to take it back.' });
        return;
      }
      retry();
    };
    sock.onerror = () => { /* close follows */ };
  }

  function retry(): void {
    if (stopped) return;
    const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
    attempt++;
    clearTimeout(timer);
    timer = setTimeout(open, wait);
  }

  /** Hang up and dial again at once. The seat token takes the seat back and the server sends the current state. */
  function redial(): void {
    if (stopped) return;
    const old = ws;
    ws = null;
    clearTimeout(timer);
    attempt = 0;
    setOnline(false);
    try { old?.close(); } catch { /* already gone */ }
    open();
  }

  open();

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    let hiddenAt: number | null = null;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= AWAY_MS || !ws || ws.readyState !== WebSocket.OPEN) redial();
    });
    window.addEventListener('online', redial);
  }

  return {
    send(msg) {
      if (msg.t === 'join') {
        playerName = msg.name;
        write(nameKey, msg.name);
        wantSeat = true;
        rawSend({ ...msg, ...(msg.token === undefined && token ? { token } : {}) });
        return;
      }
      rawSend(msg);
    },
    on(t, cb) {
      let set = listeners.get(t);
      if (!set) listeners.set(t, (set = new Set()));
      set.add(cb as (msg: never) => void);
      return () => { set.delete(cb as (msg: never) => void); };
    },
    onStatus(cb) {
      statusListeners.push(cb);
      if (online !== null) cb(online);
    },
  };
}

/** The name remembered for this slot, to pre-fill the join field. */
export function rememberedName(slot?: string): string {
  const name = slot ?? new URLSearchParams(location.search).get('slot') ?? 'default';
  try { return window.localStorage.getItem(`dawn-company-name-${name}`) ?? ''; } catch { return ''; }
}

/** True if this slot holds a seat token: the page will try to take that seat back by itself. */
export function hasRememberedSeat(slot?: string): boolean {
  const name = slot ?? new URLSearchParams(location.search).get('slot') ?? 'default';
  try { return window.localStorage.getItem(`dawn-company-token-${name}`) !== null; } catch { return false; }
}
