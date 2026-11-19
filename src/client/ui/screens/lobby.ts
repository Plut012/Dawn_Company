// The lobby: join, see who is here, build a squad, throw the ready lever.

import { PRESETS, RULES, UNITS, validateSquad } from '../../../content';
import { manualSearch } from '../../../manual/show';
import type { SeatStatus } from '../../../shared/protocol';
import type { UnitTypeId } from '../../../shared/types';
import { hasRememberedSeat, rememberedName } from '../../net';
import {
  el, field, key, lamp, lever, panel, playerMark, readout, report, stepper, unitCard,
} from '../components';
import type { Lamp, Stepper } from '../components';
import type { App, Screen } from '../screen';
import { session } from '../session';
import { actionLines, add, move, remove, rosterRow, sameSquad, spent } from '../squad';

const NAME_MAX = 24;

function arrow(up: boolean): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'arrow');
  s.innerHTML = up ? '<path d="M8 3l6 9H2z"/>' : '<path d="M8 13L2 4h12z"/>';
  return s;
}

export const lobbyScreen: Screen = {
  mount(root: HTMLElement, app: App): () => void {
    const off: (() => void)[] = [];
    let seats: SeatStatus[] = [];
    const first = app.data as { t?: string; seats?: SeatStatus[] } | undefined;
    if (first?.t === 'lobby' && first.seats) seats = first.seats;
    let squad: UnitTypeId[] = session.squad ? [...session.squad] : [...PRESETS[0].units];
    let selected = -1;                                    // card just moved, outlined in Amber
    let rejoining = app.seat < 0 && hasRememberedSeat();

    // ---- notice strip (server errors, join trouble)
    const notice = report('', true);
    notice.hidden = true;
    const say = (text: string | null): void => {
      notice.hidden = text === null;
      if (text !== null) notice.set(text, true);
    };

    // ---- join
    const nameField = field({ label: 'Your name', value: rememberedName(), placeholder: 'Your name', maxLength: NAME_MAX });
    const joinKey = key({ label: 'Join', onPress: () => submitJoin() });
    const rejoinLine = report('Taking your seat back…');
    const joinForm = el('form', 'join-form');
    joinForm.addEventListener('submit', (e) => { e.preventDefault(); submitJoin(); });
    joinForm.append(nameField, joinKey);
    joinKey.type = 'submit';
    const joinPanel = panel('Report in', {}, el('p', '', 'Name for the roll. Then build a squad and wait for the others.'), joinForm, rejoinLine);
    joinPanel.classList.add('join');

    function submitJoin(): void {
      say(null);
      joinKey.disabled = true;
      app.net.send({ t: 'join', name: nameField.value.trim() });
    }

    // ---- signals
    const signalsList = el('div', 'signals');
    const signalsLine = el('p', 'note signals-line');
    const signals = panel('Signals', { inset: true }, signalsList, signalsLine);

    // ---- ready
    const readyLever = lever({ label: 'Ready', onChange: (down) => { say(null); app.net.send({ t: 'ready', ready: down }); } });
    const legend = el('div', 'lever-legend lever-legends');
    legend.append(el('span', '', 'Building'), el('span', '', 'Ready'));
    const leverBox = el('div', 'lever-box');
    leverBox.append(readyLever, legend);
    const readyText = el('p', 'ready-text');
    const startKey = key({ label: 'Start', onPress: () => { say(null); app.net.send({ t: 'start' }); } });
    const readySide = el('div', 'ready-side');
    readySide.append(readyText, startKey);
    const readyBody = el('div', 'ready-body');
    readyBody.append(leverBox, readySide);
    const readyPanel = panel('Stand to', {}, readyBody);

    // ---- builder
    const points = readout('Points', '0/0');
    const presetKeys = PRESETS.map((p) => ({ p, k: key({ label: p.name, onPress: () => commit([...p.units]) }) }));
    const presetRow = el('div', 'preset-keys');
    presetRow.append(...presetKeys.map((x) => x.k));
    const presetNote = el('p', 'note preset-note');
    const top = el('div', 'builder-top');
    top.append(points, presetRow);

    const roster = el('div', 'roster');
    const steppers = new Map<UnitTypeId, Stepper>();
    for (const def of Object.values(UNITS)) {
      const st = stepper((d) => commit(d === 1 ? add(squad, def.id) : remove(squad, def.id)), def.name.toLowerCase());
      steppers.set(def.id, st);
      const info = el('div', 'roster-info');
      const title = el('b', '', def.name);
      title.append(el('span', '', ` ${def.rank}`));
      info.append(title, el('p', 'blurb', def.blurb), ...actionLines(def.id).map((l) => el('p', 'blurb', l)));
      const row = el('div', 'roster-row');
      row.append(info, st);
      roster.append(row);
    }

    const squadHead = el('h3', '', 'Order of march');
    const squadNote = el('p', 'note', 'Order decides where each unit starts: first in the list takes the first spot on your side of the map.');
    const squadList = el('div', 'squad-list');
    const verdict = report('');
    const builder = panel('Squad', {}, top, presetNote, roster, squadHead, squadNote, squadList, verdict);
    builder.classList.add('builder');

    // ---- the way to the field manual (its own page: `/?manual`; the seat is kept by its token)
    const manualKey = key({
      label: 'Field manual',
      onPress: () => { location.href = `${location.pathname}${manualSearch(location.search, '')}`; },
    });
    const manualRow = el('div', 'lobby-manual');
    manualRow.append(el('p', 'note', 'Every rule, shown on the map. A few seconds each.'), manualKey);

    // ---- layout
    const colA = el('div', 'stack');
    colA.append(signals, readyPanel);
    const colB = el('div', 'stack');
    colB.append(builder);
    const grid = el('div', 'lobby');
    grid.append(joinPanel, colA, colB);
    root.replaceChildren(notice, manualRow, grid);

    // ---- logic
    const mine = (): SeatStatus | undefined => seats.find((s) => s.seat === app.seat);

    function commit(next: UnitTypeId[]): void {
      say(null);
      squad = next;
      session.squad = next;
      selected = -1;
      afterEdit();
    }

    function afterEdit(): void {
      const check = validateSquad(squad);
      const me = mine();
      if (check.ok) {
        if (me) me.ready = false;        // the server clears it too; do not wait to show it
        app.net.send({ t: 'squad', units: squad });
      } else if (me?.ready) {
        me.ready = false;
        app.net.send({ t: 'ready', ready: false });
      }
      refresh();
    }

    function refresh(): void {
      const joined = app.seat >= 0;
      joinPanel.hidden = joined;
      colA.hidden = colB.hidden = !joined;
      grid.classList.toggle('joined', joined);
      rejoinLine.hidden = !rejoining;
      joinForm.hidden = rejoining;
      if (!joined) return;

      const check = validateSquad(squad);

      // signals
      signalsList.replaceChildren(...seats.map((s) => {
        const row = el('div', 'signal');
        const state = !s.connected ? 'disconnected' : s.ready ? 'ready' : 'planning';
        const word = !s.connected ? 'lost signal' : s.ready ? 'ready' : 'building';
        const l: Lamp = lamp(`${s.name}${s.seat === app.seat ? ' (you)' : ''} — ${word}`, state);
        row.append(playerMark(s.seat), l);
        return row;
      }));
      const unready = seats.filter((s) => !s.ready);
      const allReady = seats.length >= 2 && unready.length === 0;
      signalsLine.textContent =
        seats.length < 2 ? `Waiting on ${2 - seats.length} more. Kettle's on.`
        : unready.length > 0 ? `Waiting on ${unready.map((s) => s.name).join(', ')} to be ready.`
        : app.host ? 'Everyone is ready. Start when you like.'
        : `Everyone is ready. Waiting on ${seats[0]?.name ?? 'the host'}.`;

      // ready lever and start
      const me = mine();
      readyLever.set(!check.ok ? 'locked' : me?.ready ? 'down' : 'up');
      readyText.textContent =
        !check.ok ? 'The squad is not legal yet. See the report below.'
        : me?.ready ? 'Ready. Change the squad to stand down.'
        : 'Throw the lever when your squad is set.';
      startKey.hidden = !app.host;
      startKey.disabled = !(allReady && app.host);
      if (!app.host) readyText.textContent += ' The host starts the match.';

      // builder
      points.set(`${check.cost}/${RULES.budget}`, check.cost > RULES.budget);
      for (const { p, k } of presetKeys) k.setPressed(sameSquad(squad, p.units));
      const match = PRESETS.find((p) => sameSquad(squad, p.units));
      presetNote.textContent = match ? match.blurb : 'Pick a section, or build your own below.';
      for (const def of Object.values(UNITS)) {
        const r = rosterRow(squad, def.id);
        steppers.get(def.id)!.set({ count: r.count, cost: r.caption, canDec: r.canDec, canInc: r.canInc, state: r.state });
      }
      squadList.replaceChildren(...squad.map((id, i) => {
        const def = UNITS[id];
        const row = el('div', 'squad-row');
        const card = unitCard({
          name: def?.name ?? id, role: def?.rank ?? '', seat: app.seat,
          state: i === selected ? 'selected' : 'ready',
          detail: `Slot ${i + 1} · ${def?.cost ?? '?'} pts`,
        });
        const up = key({ label: '', disabled: i === 0, onPress: () => { selected = i - 1; squad = move(squad, i, -1); session.squad = squad; say(null); afterEdit(); } });
        const down = key({ label: '', disabled: i === squad.length - 1, onPress: () => { selected = i + 1; squad = move(squad, i, 1); session.squad = squad; say(null); afterEdit(); } });
        up.append(arrow(true)); up.setAttribute('aria-label', `Move ${def?.name ?? id} up`);
        down.append(arrow(false)); down.setAttribute('aria-label', `Move ${def?.name ?? id} down`);
        row.append(card, up, down);
        return row;
      }));
      if (check.ok) {
        verdict.set(`${squad.length} units, ${check.cost} of ${RULES.budget} points.${check.cost < RULES.budget ? ` ${RULES.budget - check.cost} unspent.` : ''}`, false);
      } else {
        verdict.set(check.errors.join(' '), true);
      }
    }

    off.push(app.net.on('welcome', () => {
      rejoining = false;
      if (session.squad) squad = [...session.squad];
      joinKey.disabled = false;
      refresh();
    }));
    off.push(app.net.on('lobby', (m) => {
      seats = m.seats;
      refresh();
    }));
    off.push(app.net.on('error', (m) => {
      rejoining = false;
      joinKey.disabled = false;
      say(m.message);
      refresh();
    }));

    refresh();
    return () => { for (const f of off) f(); root.replaceChildren(); };
  },
};
