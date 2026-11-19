// The dev-slot shortcut, used by dev.html's "quick start": a page opened as
// `/?slot=dev1&auto=<preset id>&name=<name>` joins by itself, takes that
// preset squad and throws its ready lever. Honoured only when the slot name
// starts with "dev", so a player's link can never carry it.

import { PRESETS } from '../content';
import type { UnitTypeId } from '../shared/types';
import { hasRememberedSeat } from './net';
import type { App } from './ui/screen';
import { session } from './ui/session';

export interface DevAuto { name: string; squad: UnitTypeId[] }

const NAME_MAX = 24;

/** What the URL asks for, or null: no `auto`, or a slot that is not a dev slot. */
export function devAuto(search: string): DevAuto | null {
  const params = new URLSearchParams(search);
  const slot = params.get('slot') ?? '';
  const auto = params.get('auto');
  if (!slot.startsWith('dev') || auto === null) return null;
  const preset = PRESETS.find((p) => p.id === auto) ?? PRESETS[0];
  const name = (params.get('name') ?? '').trim().slice(0, NAME_MAX) || `Dev ${slot.slice(3) || '1'}`;
  return { name, squad: [...preset.units] };
}

/**
 * Carry out the shortcut, once, and only for a page that arrives in the
 * lobby: a page that finds itself in a running match is left alone.
 */
export function runDevAuto(app: App, search: string = location.search): void {
  const auto = devAuto(search);
  if (!auto) return;
  let armed = true;
  let asked = false;
  const off: (() => void)[] = [];
  const stop = (): void => { armed = false; for (const f of off.splice(0)) f(); };
  app.net.onStatus((online) => {
    // A slot with a remembered seat takes it back by itself; a new one has to ask.
    if (!online || !armed || asked || app.seat >= 0 || hasRememberedSeat()) return;
    asked = true;
    app.net.send({ t: 'join', name: auto.name });
  });
  off.push(
    app.net.on('plan', stop),
    app.net.on('resolve', stop),
    app.net.on('lobby', (m) => {
      if (!armed || app.seat < 0) return;
      stop();
      session.squad = [...auto.squad];
      app.net.send({ t: 'squad', units: auto.squad });
      app.net.send({ t: 'ready', ready: true });
      app.go('lobby', m);              // mount again, so the builder shows the squad that was sent
    }),
  );
}
