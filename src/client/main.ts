// The app shell: one socket, one screen at a time. Or, at `/?manual`, the field manual and no socket.

import './ui/kit.css';
import './ui/app.css';
import { runDevAuto } from './dev';
import { connect } from './net';
import { lamp, report } from './ui/components';
import type { App, Screen, ScreenName } from './ui/screen';
import { manualSearch } from '../manual/show';
import { lobbyScreen } from './ui/screens/lobby';
import { mountManual } from './ui/screens/manual';
import { playScreen } from './ui/screens/play';
import { resultsScreen } from './ui/screens/results';
import { adoptWelcome } from './ui/session';

const screens: Record<ScreenName, Screen> = { lobby: lobbyScreen, play: playScreen, results: resultsScreen };

const stage = document.getElementById('screen') as HTMLElement;

// `/?manual` (or `/?manual=<lesson id>`) is the field manual: no server, no socket.
const manualAt = new URLSearchParams(location.search).get('manual');
if (manualAt !== null) {
  stage.dataset.screen = 'manual';
  mountManual(stage, {
    lesson: manualAt,
    onBack: () => { location.href = `${location.pathname}${manualSearch(location.search, null)}`; },
  });
} else {
  startApp();
}

function startApp(): void {
  const net = connect();
  const linkSlot = document.getElementById('link') as HTMLElement;
  const stripSlot = document.getElementById('strip') as HTMLElement;

  let current: ScreenName | null = null;
  let unmount: (() => void) | null = null;

  const app: App = {
    net,
    seat: -1,
    host: false,
    go(name, data) {
      unmount?.();
      app.data = data;
      current = name;
      stage.dataset.screen = name;
      unmount = screens[name].mount(stage, app);
    },
  };

  // ---- connection: a lamp always, a strip when the line is lost
  const linkLamp = lamp('Connecting', 'planning');
  const lostStrip = report('Signal lost. Trying to get through again…', true);
  lostStrip.hidden = true;
  linkSlot.append(linkLamp);
  stripSlot.append(lostStrip);
  net.onStatus((online) => {
    linkLamp.set(online ? 'planning' : 'disconnected', online ? 'Linked' : 'No signal');
    lostStrip.hidden = online;
  });

  // ---- the shell follows the server. These listeners are registered first, so
  // seat and squad are up to date before any screen's own listeners run.
  net.on('welcome', (m) => {
    app.seat = m.seat;
    app.host = m.host;
    adoptWelcome(m.token, m.squad);
  });
  runDevAuto(app);       // dev slots only; see dev.ts
  net.on('lobby', (m) => { if (current !== 'lobby') app.go('lobby', m); });
  // The play screen follows `plan` and `resolve` itself once it is up: it plays
  // the last round out before it hands over to the results.
  net.on('plan', (m) => {
    if (m.view.over) { if (current !== 'results') app.go('results', m); }
    else if (current !== 'play') app.go('play', m);
  });
  net.on('resolve', (m) => { if (current !== 'play') app.go(m.view.over ? 'results' : 'play', m); });

  app.go('lobby');
}
