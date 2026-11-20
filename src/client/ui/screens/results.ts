// The results screen: final scores, who won, what is left of each squad.
// The host can call a rematch; a `lobby` message takes everyone back.

import { MODES } from '../../../content';
import type { SeatStatus, ServerMsg } from '../../../shared/protocol';
import { clearDraft } from '../draft';
import { el, key, panel, playerMark, readout, report } from '../components';
import { scoreWord, standings, stoodLine, tieBreak } from '../outcome';
import type { App, Screen } from '../screen';

type WithView = Extract<ServerMsg, { t: 'plan' | 'resolve' }>;

export const resultsScreen: Screen = {
  mount(root: HTMLElement, app: App): () => void {
    const off: (() => void)[] = [];
    const first = app.data as WithView | undefined;
    const view = first?.view;
    let seats: SeatStatus[] = first?.seats ?? [];
    try { clearDraft(window.sessionStorage, new URLSearchParams(location.search).get('slot') ?? 'default'); } catch { /* no storage */ }

    if (!view) {
      root.replaceChildren(panel('After action', {}, el('p', '', 'The match is over.')));
      return () => root.replaceChildren();
    }

    const names: string[] = [];
    for (const s of seats) names[s.seat] = s.name;
    const rows = standings(view, names);
    const winners = rows.filter((r) => r.winner);
    const iWon = view.winners.includes(view.player);

    const headline = el('h2', 'results-head',
      winners.length === 0 ? 'No winner'
      : winners.length > 1 ? (iWon ? 'A shared win' : `${winners.map((w) => w.name).join(' and ')} share it`)
      : iWon ? 'You held the field' : `${winners[0].name} holds the field`);
    const played = Math.max(0, view.round - 1);
    const unit = scoreWord(view.mode);   // Supply Line: the score is supply (18); Last Stand: the men standing (20)
    const sub = el('p', 'results-sub', played < view.maxRounds
      ? `Over early, after ${played} of ${view.maxRounds} rounds. Final ${unit.toLowerCase()}.`
      : `Final ${unit.toLowerCase()} after ${played} rounds.`);
    // Last Stand: who stood and with how many men, and why someone won on a tie-break
    const why = [stoodLine(view, names), tieBreak(view, names)].filter((x): x is string => x !== null).join(' ');
    const reason = why ? el('p', 'results-why', why) : null;

    const table = el('div', 'results-table');
    for (const r of rows) {
      const row = el('div', r.winner ? 'results-row winner' : 'results-row');
      const who = el('div', 'results-who');
      const name = el('b', '', r.seat === view.player ? `${r.name} (you)` : r.name);
      const left = r.out ? 'No one standing'
        : r.exact ? `${r.standing} standing`
        : 'Still in the field';
      who.append(name, el('small', '', left), el('p', '', r.summary));
      const score = readout(r.winner ? `Winner · ${unit}` : unit, r.score);
      row.append(playerMark(r.seat), who, score);
      table.append(row);
    }

    const again = key({ label: 'Rematch', onPress: () => app.net.send({ t: 'rematch' }) });
    const hostName = seats.find((s) => s.seat === 0)?.name ?? 'The host';
    const note = el('p', 'results-note', app.host
      ? 'Same table, new squads. Everyone goes back to the lobby.'
      : `${hostName} can call a rematch. You will be taken back to the lobby.`);
    const foot = el('div', 'results-foot');
    if (app.host) foot.append(again);
    foot.append(note);

    const notice = report('', true);
    notice.hidden = true;

    const plate = panel(`After action · ${MODES[view.mode]?.name ?? view.mode}`, {}, headline, sub, ...(reason ? [reason] : []), table, foot);
    plate.classList.add('results');
    root.replaceChildren(notice, plate);

    off.push(
      app.net.on('seats', (m) => { seats = m.seats; }),
      app.net.on('error', (m) => { notice.hidden = false; notice.set(m.message, true); }),
      // `welcome` can come again after a reconnect: the host flag may only be known now.
      app.net.on('welcome', (m) => {
        if (m.host && !again.isConnected) foot.prepend(again);
        note.textContent = m.host
          ? 'Same table, new squads. Everyone goes back to the lobby.'
          : `${hostName} can call a rematch. You will be taken back to the lobby.`;
      }),
    );
    return () => { for (const f of off) f(); root.replaceChildren(); };
  },
};
