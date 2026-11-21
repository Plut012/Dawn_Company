// The play screen: the board in the middle of the field kit. Pick a unit,
// pick an order chit, tap the map, pull the lever. When everyone is ready the
// round plays back, and it starts again.
//
// The screen holds no rules. What a unit may do comes from `orderOptions`,
// the server judges what is sent, and the board draws what it is given.

import { MODES, OBJECTIVE_KINDS, TERRAIN, UNITS, WORKS } from '../../../content';
import { actionOf, buyBackCost, followUpOptions, lineOpen, orderOptions } from '../../../rules';
import { eq, key, label, parseKey } from '../../../shared/hex';
import type { SeatStatus, ServerMsg } from '../../../shared/protocol';
import type { Hex, HexKey, Order, OrderKind, PlayerView, Purchase, Unit, UnitId, WorkId } from '../../../shared/types';
import { START_SCALE, createBoard } from '../../render';
import type { Board, Mark } from '../../render';
import { kitFromUrl, makeKit } from '../../render/kits';
import { loadKitFonts } from '../../render/kits/lowpoly';
import { BEAT, moments } from '../../render/playback';
import { ICONS, chit, el, key as keyButton, lamp, lever, playerMark, readout, report, unitCard } from '../components';
import type { Chit, ChitState } from '../components';
import {
  actionIcon, actionName, allowance, clearDraft, draftSignature, followUpOf, friendlyFire, fromOrders, layRoute, likelyFollowUps, loadDraft, moveOrder, orderBrief, orderLabel,
  ownUnits, ownUnitsUnderFire, plannedEnd, prune, saveDraft, stance, throttled, toOrders, unitName, workOf, workSpend, workWord,
} from '../draft';
import type { Draft } from '../draft';
import { FOXHOLE_GIVES, FOXHOLE_LEAVES, benefitWords, dugIn, kindWords } from '../ground';
import { lightName, lightWords, sightWords } from '../light';
import { teller } from '../lines';
import { scoreWord, survives } from '../outcome';
import type { Line } from '../lines';
import type { App, Screen } from '../screen';
import { session } from '../session';

type WithView = Extract<ServerMsg, { t: 'plan' | 'resolve' }>;
type Phase = 'plan' | 'sent' | 'playback';
type ChitKind = OrderKind | 'hold';
type Aim = Exclude<OrderKind, 'ambush'>;       // the orders that are aimed on the map

const HOLD_ICON = '<path d="M9 6v20M23 6v20"/>';
const ALERT_MS = 10_000;
// A change to the draft reaches the server at most this often (about three times a second): the
// server runs the draft at the bell if the lever is still up, so the screen never has to race the clock.
const DRAFT_GAP_MS = 330;
const CHIT_KEYS: Record<string, ChitKind> = { h: 'hold', m: 'move', d: 'dash', f: 'fire', a: 'ambush', s: 'special', t: 'special' };

function sessionStore(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/** "Hale, Barlow": a list of units short enough for the strip. */
const surnames = (units: Unit[]): string => units.map((u) => u.name.replace(/^\S+\.\s+/, '')).join(', ');

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** The layout for a phone on its side; keep in step with the media query in app.css. */
const sideways = window.matchMedia('(orientation: landscape) and (max-height: 500px)');

export const playScreen: Screen = {
  mount(root: HTMLElement, app: App): () => void {
    const off: (() => void)[] = [];
    const slot = new URLSearchParams(location.search).get('slot') ?? 'default';
    let dead = false;

    // ---- state
    let view: PlayerView | null = null;
    let seats: SeatStatus[] = [];
    let draft: Draft = {};
    let buys: Purchase[] = [];                              // buy-backs pencilled in with the draft (18)
    let phase: Phase = 'plan';
    let selected: UnitId | null = null;
    let mode: Aim | null = null;                            // the order now being aimed on the map
    let fromHere = false;                                   // fire or special aimed from where the unit stands, though it has a move
    let pending: { unit: UnitId; target: Hex; kind: 'fire' | 'special' } | null = null;   // a shot over own units, waiting for a second tap
    let choosing: { unit: UnitId; target: Hex; follow: boolean } | null = null;          // (25) a build aimed, waiting for its work
    let rejected = new Map<UnitId, string>();
    let log: Line[] = [];                                   // the last round's report lines
    let note: Line | null = null;                           // a passing line: an answer to the last tap
    let logOpen = false;
    let deadline: number | null = null;
    let online = true;
    let board: Board | null = null;
    let framed = false;                                     // the camera has been put on the squad once

    // ---- parts
    const roundOut = readout('Round', '–');
    const lightOut = el('i', 'play-light');                 // the light of the round (19)
    roundOut.append(lightOut);
    const scoreOut = readout('Supply', '0');
    const timeOut = readout('Time', '–');
    const readouts = el('div', 'play-readouts');
    const modeOut = el('span', 'play-mode');                // the mode's name, in the header
    readouts.append(roundOut, scoreOut, timeOut, modeOut);
    const lamps = el('div', 'play-lamps');
    const top = el('header', 'play-top');
    top.append(readouts, lamps);

    const canvas = el('canvas');
    const boardBox = el('div', 'play-board');
    boardBox.append(canvas);

    const strip = report('');
    const stripCount = el('span', 'play-count');
    const stripKey = el('button', 'play-strip');
    stripKey.type = 'button';
    stripKey.setAttribute('aria-expanded', 'false');
    stripKey.append(strip, stripCount);
    const logList = el('div', 'play-log');
    logList.hidden = true;
    const reportBox = el('div', 'play-report');
    reportBox.append(logList, stripKey);
    stripKey.addEventListener('click', () => { logOpen = !logOpen && log.length > 0; refresh(); });

    const squadRow = el('div', 'play-squad');
    const chitRow = el('div', 'play-chits');
    const readyLever = lever({ label: 'Ready', onChange: (down) => throwLever(down) });
    const legend = el('div', 'lever-legend lever-legends');
    legend.append(el('span', '', 'Plan'), el('span', '', 'Ready'));
    const leverWord = el('span', 'lever-legend play-lever-word');    // where there is no room for the legend
    const leverText = el('p', 'play-ready-text');
    const leverBox = el('div', 'lever-box');
    leverBox.append(readyLever, legend, leverWord, leverText);
    const outLine = el('p', 'play-out', 'Your squad is out. You see the whole field now. Your supply stands to the end.');
    const tray = el('section', 'panel play-tray');
    tray.append(el('span', 'label', 'Squad'), squadRow, chitRow, leverBox, outLine);

    const screen = el('div', 'play');
    screen.append(top, boardBox, reportBox, tray);
    root.replaceChildren(screen);

    // ---- small helpers
    const me = (): number => view?.player ?? app.seat;
    const names = (): string[] => {
      const out: string[] = [];
      for (const s of seats) out[s.seat] = s.name;
      return out;
    };
    const spectating = (): boolean => !!view && (view.eliminated[view.player] ?? false);
    const unit = (id: UnitId | null): Unit | null => (id && view ? view.units.find((u) => u.id === id) ?? null : null);
    const say = (text: string, danger = false): void => { note = { text, danger }; };
    const persist = (): void => { if (view) saveDraft(sessionStore(), slot, draftSignature(session.token, view), draft); };
    // The draft as it stands goes to the server while the lever is up; the server runs it at the bell.
    const draftSender = throttled(() => {
      if (view && phase === 'plan' && !spectating()) app.net.send({ t: 'draft', orders: toOrders(draft), purchases: buys });
    }, DRAFT_GAP_MS);
    off.push(() => draftSender.cancel());

    /**
     * With a move pencilled in, the chit of an action that may follow a move aims the move's
     * follow-up, from the end of the path: the hexes where it would run as things stand
     * (possibly none). Null when the chit aims a plain order from where the unit stands:
     * no move, an action that cannot follow one, or the player asked to fire from here.
     */
    function followTargets(u: Unit, kind: Aim): HexKey[] | null {
      const o = draft[u.id];
      if (!view || !o || o.kind !== 'move' || (kind !== 'fire' && kind !== 'special')) return null;
      if (fromHere && mode === kind && u.id === selected) return null;
      const legal = followUpOptions(view, u.id, plannedEnd(u, draft))[kind];
      return legal.length > 0 ? likelyFollowUps(view, draft, u, kind, legal) : null;
    }

    /** May this unit's chit switch from aiming the follow-up to a plain order from where it stands? */
    function canFireFromHere(u: Unit, kind: 'fire' | 'special'): boolean {
      return !!view && (orderOptions(view, u.id)[kind]?.length ?? 0) > 0;
    }

    /** Has this unit an action it may use after a move? */
    function canFollow(u: Unit): boolean {
      return (['fire', 'special'] as const).some((k) => (UNITS[u.type]?.orders.includes(k) ?? false) && (actionOf(u.type, k)?.mobile ?? false));
    }

    function setOrder(order: Order | null, id: UnitId): void {
      if (order) draft[id] = order; else delete draft[id];
      rejected.delete(id);
      persist();
      draftSender.poke();
    }

    // ---- buying back (18)

    /** Supply left once the buy-backs and the works (25) in the draft are paid. */
    const supplyLeft = (v: PlayerView): number => (v.scores[v.player] ?? 0) - buys.reduce((a, b) => a + (buyBackCost(v, b.unit) ?? 0), 0) - workSpend(draft);
    const buying = (id: UnitId): boolean => buys.some((b) => b.unit === id);

    /** A down unit's line on its card: when it comes back, or that it cannot. Null when it never will. */
    function backLine(v: PlayerView, u: Unit): string | null {
      if (u.status !== 'down' || u.returnRound === null || u.returnRound === undefined) return null;
      if (!lineOpen(v, v.player)) return 'cut off';
      if (buying(u.id)) return 'bought back';
      const n = u.returnRound - v.round + 1;
      return n <= 1 ? 'back at round\'s end' : `back in ${n}`;
    }

    function toggleBuy(id: UnitId): void {
      if (!view || phase !== 'plan' || spectating()) return;
      const u = unit(id);
      if (buying(id)) {
        buys = buys.filter((b) => b.unit !== id);
        if (u) say(`${unitName(u)} stays on the casualty list.`);
      } else {
        const cost = buyBackCost(view, id);
        if (cost === null || !u) return;
        if (cost > supplyLeft(view)) { say(`${unitName(u)} costs ${cost} supply to bring back; you have ${supplyLeft(view)} left.`, true); refresh(); return; }
        buys = [...buys, { kind: 'return', unit: id }];
        say(`${unitName(u)} bought back for ${cost} supply. He is back at the HQ when the round ends.`);
      }
      rejected.delete(id);
      draftSender.poke();
      refresh();
    }

    // ---- drawing the kit

    function marks(): Mark[] {
      if (!view || phase === 'playback' || spectating()) return [];
      const out: Mark[] = [];
      for (const u of ownUnits(view)) {
        const o = draft[u.id];
        if (!o || u.status === 'down') continue;
        if (o.kind === 'move' || o.kind === 'dash') {
          out.push({ kind: 'path', from: u.pos, path: o.path, dash: o.kind === 'dash' });
          // The follow-up is aimed from where the path ends.
          const then = followUpOf(draft, u.id);
          if (then) out.push({ kind: 'target', from: plannedEnd(u, draft), hex: then.target, blast: actionOf(u.type, then.kind)?.blast ?? 0 });
        } else if (o.kind === 'fire' || o.kind === 'special') out.push({ kind: 'target', from: u.pos, hex: o.target, blast: actionOf(u.type, o.kind)?.blast ?? 0 });
        else out.push({ kind: 'ambush', hex: u.pos });
      }
      const sel = unit(selected);
      if (choosing && sel && sel.id === choosing.unit) {
        out.push({ kind: 'target', from: choosing.follow ? plannedEnd(sel, draft) : sel.pos, hex: choosing.target, blast: 0 });
      }
      if (pending && sel && sel.id === pending.unit) {
        const from = followTargets(sel, pending.kind) ? plannedEnd(sel, draft) : sel.pos;
        out.push({ kind: 'target', from, hex: pending.target, blast: actionOf(sel.type, pending.kind)?.blast ?? 0 });
      }
      if (sel) out.push({ kind: 'select', hex: sel.pos });
      if (sel && mode && phase === 'plan') {
        const hexes = (followTargets(sel, mode) ?? orderOptions(view, sel.id)[mode]).map(parseKey);
        if (hexes.length > 0) out.push({ kind: 'options', hexes });
      }
      return out;
    }

    /** The line the strip shows when nothing has just been said: what the selected unit is up to. */
    function standingLine(): Line {
      if (!view) return { text: 'Waiting for the map.', danger: false };
      if (!online) return { text: 'Signal lost. Trying to get through again…', danger: true };
      if (phase === 'playback') return log.at(-1) ?? { text: `Round ${view.round} resolving.`, danger: false };
      if (spectating()) return log.at(-1) ?? { text: 'Watching.', danger: false };
      const fires = friendlyFire(view, draft);
      if (phase === 'sent') {
        const waiting = seats.filter((s) => !s.ready && !s.out && s.seat !== me()).map((s) => s.name);
        const tail = waiting.length > 0 ? ` Waiting on ${waiting.join(', ')}.` : '';
        if (fires.length > 0) {
          const f = fires[0];
          return { text: `Orders in, with ${surnames(f.victims)} under ${unitName(f.shooter)}'s fire.${tail}`, danger: true };
        }
        return { text: `Orders in.${tail} Lever up to change them.`, danger: false };
      }
      const sel = unit(selected);
      if (!sel) return log.at(-1) ?? { text: `Round ${view.round}. Pick a unit, then an order.`, danger: false };
      const name = unitName(sel);
      if (choosing && choosing.unit === sel.id) {
        return { text: `${name}: what goes up at ${label(choosing.target)}? Paid from supply at the round's end, if it is there then (${supplyLeft(view)} left now).`, danger: false };
      }
      const why = rejected.get(sel.id);
      if (why) return { text: `${name}: order rejected, ${why}.`, danger: true };
      const asShooter = fires.find((f) => f.shooter.id === sel.id);
      if (asShooter && !mode) {
        return { text: `${name}'s fire at ${label(asShooter.target)} covers your own: ${surnames(asShooter.victims)}.`, danger: true };
      }
      const asVictim = fires.find((f) => f.victims.some((v) => v.id === sel.id));
      if (asVictim && !mode) {
        return { text: `${name} is under ${unitName(asVictim.shooter)}'s fire at ${label(asVictim.target)}.`, danger: true };
      }
      if (mode === 'move' || mode === 'dash') {
        const max = allowance(view, sel, mode);
        return mode === 'dash'
          ? { text: `Dash, up to ${max}: tap a marked hex. No cover on the run; one hit puts him down.${dugIn(sel) ? ` ${FOXHOLE_LEAVES}` : ''}`, danger: false }
          : { text: `Move, up to ${max}: tap a marked hex. Tap on from there to shape the route.${canFollow(sel) ? ' Then a chit for what he does there.' : ''}${dugIn(sel) ? ` ${FOXHOLE_LEAVES}` : ''}`, danger: false };
      }
      if (mode === 'fire' || mode === 'special') {
        const follow = followTargets(sel, mode);
        const end = label(plannedEnd(sel, draft));
        const swap = canFireFromHere(sel, mode) ? ` Tap ${actionName(sel.type, mode)} again to do it from ${label(sel.pos)} instead, without the move.` : '';
        if (follow && follow.length === 0) {
          return { text: `${actionName(sel.type, mode)} after the move: nothing it could reach from ${end}.${swap}`, danger: false };
        }
        if (follow) {
          return { text: `${actionName(sel.type, mode)} after the move, from ${end}: tap a marked hex.${swap}`, danger: false };
        }
        const going = draft[sel.id]?.kind;
        if (going === 'move' || going === 'dash') {
          return { text: `${actionName(sel.type, mode)} from ${label(sel.pos)}, without the move: tap a marked hex. It replaces the move.`, danger: false };
        }
      }
      if (mode === 'fire' || mode === 'special') {
        return { text: `${actionName(sel.type, mode)}: tap a marked hex. ${actionOf(sel.type, mode)?.blurb ?? ''}`.trim(), danger: false };
      }
      if (sel.status === 'pinned') {
        return { text: `${name} is pinned at ${label(sel.pos)}. Orders run only if a medic treats him first.`, danger: true };
      }
      const o = draft[sel.id];
      const hole = dugIn(sel) ? ` Dug in: ${FOXHOLE_GIVES}.${o?.kind === 'move' || o?.kind === 'dash' ? ` ${FOXHOLE_LEAVES}` : ''}` : '';
      return { text: `${name} at ${label(sel.pos)}, ${view ? sightWords(view, sel) : ''}. ${o ? `${orderLabel(o, sel.type)}.` : 'No order: holds.'}${hole}`, danger: false };
    }

    function refresh(): void {
      if (dead || !view) return;
      const v = view;
      const out = spectating();

      // readouts
      modeOut.textContent = MODES[v.mode]?.name ?? v.mode;
      roundOut.set(`${Math.min(v.round, v.maxRounds)}/${v.maxRounds}`);
      lightOut.textContent = lightWords(v);
      roundOut.title = `Round ${Math.min(v.round, v.maxRounds)} of ${v.maxRounds}. ${lightWords(v)}.`;
      const left = supplyLeft(v);
      const word = scoreWord(v.mode);                      // Supply, or Standing in Last Stand (20)
      scoreOut.set(left);
      scoreOut.lastElementChild!.textContent = word;
      scoreOut.title = survives(v.mode) ? `${left} of your men standing`
        : buys.length > 0 ? `${v.scores[v.player] ?? 0} supply, ${left} after the buy-backs in your draft` : `${left} supply`;
      outLine.textContent = survives(v.mode) ? 'Your squad is out. You see the whole field now.'
        : 'Your squad is out. You see the whole field now. Your supply stands to the end.';
      tick();

      // lamps
      lamps.replaceChildren(...seats.map((s) => {
        const state = s.out ? 'out' : !s.connected ? 'disconnected' : s.ready ? 'ready' : 'planning';
        const status = s.out ? 'out' : !s.connected ? 'lost signal' : s.ready ? 'ready' : 'planning';
        const l = lamp(s.name, state);
        l.append(el('b', '', String(v.scores[s.seat] ?? 0)));
        l.title = `${s.name}: ${status}, ${v.scores[s.seat] ?? 0} ${word.toLowerCase()}`;
        l.setAttribute('aria-label', l.title);
        const box = el('div', s.seat === v.player ? 'play-lamp own' : 'play-lamp');
        box.append(playerMark(s.seat), l);
        return box;
      }));

      // squad cards
      const fires = out ? [] : friendlyFire(v, draft);
      const underFire = new Set(fires.flatMap((f) => f.victims.map((u) => u.id)));
      squadRow.replaceChildren(...ownUnits(v).map((u) => {
        const def = UNITS[u.type];
        const card = unitCard({
          name: unitName(u), role: def?.name ?? u.type, seat: u.owner,
          state: u.status === 'ready' ? 'ready' : u.status,
          detail: u.status === 'down' ? def?.name ?? u.type
            : [def?.name ?? u.type, stance(v.map, u), dugIn(u) ? 'Dug in' : null, benefitWords(v, u)].filter(Boolean).join(' · '),
        });
        const order = el('small', 'play-order');
        const o = draft[u.id];
        const back = backLine(v, u);
        if (u.status === 'down') {
          order.textContent = back ? back[0].toUpperCase() + back.slice(1) : 'Down';     // the card itself says he is down
          if (rejected.has(u.id)) { order.textContent = 'Buy-back rejected'; order.classList.add('danger'); }
          else if (back === 'cut off') order.classList.add('danger');
        }
        else if (rejected.has(u.id)) { order.textContent = 'Order rejected'; order.classList.add('danger'); }
        else if (underFire.has(u.id)) { order.textContent = `${orderBrief(o, u.type)} · own fire`; order.classList.add('danger'); }
        else order.textContent = `${u.status === 'pinned' ? 'Pinned · ' : ''}${orderBrief(o, u.type)}`;
        order.title = orderLabel(o, u.type);
        card.children[1]?.append(order);
        const cost = u.status === 'down' && !out ? buyBackCost(v, u.id) : null;
        if (cost !== null) {
          const affordable = buying(u.id) || cost <= supplyLeft(v);
          const buy = keyButton({
            label: `Buy back · ${cost} supply`,
            pressed: buying(u.id),
            disabled: phase !== 'plan' || !affordable,
            onPress: () => toggleBuy(u.id),
          });
          buy.classList.add('play-buy');
          buy.dataset.buy = u.id;
          buy.title = buying(u.id) ? 'Press again to take it back' : affordable ? `Bring ${unitName(u)} back at the HQ at the end of this round` : `Not enough supply: ${supplyLeft(v)} left`;
          buy.addEventListener('click', (e) => e.stopPropagation());
          buy.addEventListener('keydown', (e) => e.stopPropagation());
          card.children[1]?.append(buy);
        }
        card.classList.toggle('selected', u.id === selected);
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-pressed', String(u.id === selected));
        card.dataset.unit = u.id;
        card.dataset.at = label(u.pos);
        card.title = `${unitName(u)}, ${(def?.name ?? u.type).toLowerCase()}, at ${label(u.pos)}${u.status === 'down' ? '' : `, ${stance(v.map, u)}`}${dugIn(u) ? `, dug in: ${FOXHOLE_GIVES}` : ''}`;
        card.dataset.dug = String(dugIn(u));
        if (u.status !== 'down') card.dataset.stance = stance(v.map, u);
        card.addEventListener('click', () => pressCard(u.id));
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pressCard(u.id); } });
        return card;
      }));

      // a phone on its side lists the squad top to bottom in a short box: keep the selected card in it
      if (sideways.matches && squadRow.scrollHeight > squadRow.clientHeight + 1) {
        const card = squadRow.querySelector<HTMLElement>('.unit.selected');
        if (card) {
          const c = card.getBoundingClientRect();
          const box = squadRow.getBoundingClientRect();
          if (c.top < box.top) squadRow.scrollTop += c.top - box.top - 3;
          else if (c.bottom > box.bottom) squadRow.scrollTop += c.bottom - box.bottom + 3;
        }
      }

      // chits
      const sel = unit(selected);
      const live = sel && sel.status !== 'down' ? sel : null;
      const options = live ? orderOptions(v, live.id) : null;
      const kinds: ChitKind[] = ['hold', ...(options?.kinds ?? (['move', 'dash', 'fire', 'ambush'] as OrderKind[]))];
      const locked = phase !== 'plan';
      if (live && choosing && choosing.unit === live.id && !locked) {
        chitRow.replaceChildren(...workKeys(v, live), keyButton({ label: 'Cancel', onPress: () => { choosing = null; refresh(); } }));
      } else chitRow.replaceChildren(...kinds.map((k) => {
        let state: ChitState = 'idle';
        const has = live ? draft[live.id]?.kind : undefined;
        const then = live ? followUpOf(draft, live.id)?.kind : undefined;
        const empty = k !== 'hold' && k !== 'ambush' && (options?.[k].length ?? 0) === 0 && !(live && followTargets(live, k));
        const issued = k === 'hold' ? has === undefined : has === k || then === k;
        if (!live || locked || empty) state = 'disabled';
        else if (k !== 'hold' && mode === k) state = 'selected';
        else if (issued) state = 'issued';
        // A locked kit still shows which order the unit has.
        const c: Chit = chit({
          label: k === 'hold' ? 'Hold' : k === 'fire' || k === 'special' ? actionName(live?.type ?? '', k) : k,
          icon: k === 'hold' ? HOLD_ICON : k === 'fire' || k === 'special' ? ICONS[actionIcon(live?.type ?? '', k)] : ICONS[k],
          state,
          onPress: () => pressChit(k),
        });
        if (state === 'disabled' && live && issued) c.classList.add('issued');
        if (live && dugIn(live) && (k === 'move' || k === 'dash')) c.title = `${k === 'move' ? 'Move' : 'Dash'}: ${FOXHOLE_LEAVES.toLowerCase()}`;
        c.dataset.kind = k;
        return c;
      }));

      // lever, and the line for a squad that is out
      readyLever.set(phase === 'playback' ? 'locked' : phase === 'sent' ? 'down' : 'up');
      leverWord.textContent = phase === 'playback' ? 'Resolving' : phase === 'sent' ? 'Ready' : 'Pull when set';
      const waiting = seats.filter((s) => !s.ready && !s.out && s.seat !== v.player).map((s) => s.name);
      leverText.textContent =
        phase === 'playback' ? 'The round is resolving. The lever is locked.'
        : phase === 'sent' ? `Orders are in.${waiting.length > 0 ? ` Waiting on ${waiting.join(', ')}.` : ''} Lever up to change them.`
        : `Pull the lever when every unit has its order. Units with none hold.${deadline !== null ? ' If the clock runs out first, your orders run as they stand.' : ''}`;
      squadRow.hidden = chitRow.hidden = leverBox.hidden = out;
      outLine.hidden = !out;
      tray.classList.toggle('out', out);

      // report strip and the round's lines
      const line = note ?? standingLine();
      strip.set(line.text, line.danger);
      stripCount.textContent = log.length > 0 ? (logOpen ? 'Close' : `Log ${log.length}`) : '';
      stripKey.setAttribute('aria-expanded', String(logOpen));
      logList.hidden = !logOpen;
      if (logOpen) {
        logList.replaceChildren(...log.map((l) => report(l.text, l.danger)));
        logList.scrollTop = logList.scrollHeight;
      }

      board?.setMarks(marks());
    }

    /**
     * (25) One key per work, with its cost: greyed when the supply left after the draft's buy-backs and other works
     * does not cover it, and wire where a man stands or means to end up (nobody may stand in it).
     */
    function workKeys(v: PlayerView, u: Unit): HTMLElement[] {
      const target = choosing!.target;
      const left = supplyLeft(v) + (workOf(draft[u.id]) ? WORKS[workOf(draft[u.id])!].cost : 0);   // his own last choice is replaced
      const standing = v.units.some((x) => x.status !== 'down' && eq(x.owner === v.player ? plannedEnd(x, draft) : x.pos, target))
        || (!choosing!.follow && eq(u.pos, target)) || (choosing!.follow && eq(plannedEnd(u, draft), target));
      return Object.values(WORKS).map((w, i) => {
        const short = w.cost > left;
        const manned = !(TERRAIN[w.terrain]?.passable ?? true) && standing;
        const b = keyButton({ label: `${w.name} · ${w.cost}`, disabled: short || manned, onPress: () => pickWork(w.id) });
        b.classList.add('play-work');
        b.dataset.work = w.id;
        b.title = short ? `${w.name}: ${w.cost} supply, you have ${left} left` : manned ? `${w.name}: nobody may stand in it`
          : `${w.name}, ${w.cost} supply (${i + 1}). ${w.blurb}`;
        return b;
      });
    }

    function pickWork(work: WorkId): void {
      const u = unit(selected);
      if (!choosing || !u || choosing.unit !== u.id || phase !== 'plan') return;
      const { target, follow } = choosing;
      const o = draft[u.id];
      if (follow && o?.kind === 'move') setOrder({ unit: u.id, kind: 'move', path: o.path, then: { kind: 'special', target, work } }, u.id);
      else setOrder({ unit: u.id, kind: 'special', target, work }, u.id);
      say(`${unitName(u)}: ${workWord(work)} at ${label(target)}, ${WORKS[work].cost} supply when it goes up at the round's end.`);
      choosing = null;
      mode = null;
      refresh();
    }

    function tick(): void {
      if (deadline === null || phase === 'playback') {
        timeOut.hidden = deadline === null;
        timeOut.set('–');
        return;
      }
      timeOut.hidden = false;
      const left = Math.max(0, deadline - Date.now());
      const s = Math.ceil(left / 1000);
      timeOut.set(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, left < ALERT_MS);
    }
    const clock = setInterval(tick, 250);
    off.push(() => clearInterval(clock));

    // ---- the player's hands

    function select(id: UnitId | null): void {
      selected = id;
      mode = null;
      fromHere = false;
      pending = null;
      choosing = null;
      note = null;
    }

    function pressCard(id: UnitId): void {
      if (phase === 'playback' || !view) return;
      const u = unit(id);
      if (!u) return;
      // A second press on the same card finds the unit on the map. The first never moves the camera.
      if (selected === id || u.status === 'down') board?.focus(u.pos);
      if (u.status === 'down') {
        const back = view ? backLine(view, u) : null;
        say(back === 'cut off' ? `${unitName(u)} is down. Your HQ is lost: nobody comes back until you retake it.`
          : back ? `${unitName(u)} is down at ${label(u.pos)}, ${back}.` : `${unitName(u)} is down at ${label(u.pos)}.`);
      }
      else if (selected !== id) select(id);
      refresh();
    }

    function pressChit(k: ChitKind): void {
      const u = unit(selected);
      if (phase !== 'plan' || !u || u.status === 'down') return;
      note = null;
      pending = null;
      choosing = null;
      if (k === 'hold') { setOrder(null, u.id); mode = null; }
      else if (k === 'ambush') { setOrder({ unit: u.id, kind: 'ambush' }, u.id); mode = null; }
      else if (mode === k && (k === 'fire' || k === 'special') && !fromHere && followTargets(u, k) !== null && canFireFromHere(u, k)) {
        fromHere = true;        // a second press: aim from where he stands, not after the move
        refresh();
        return;
      }
      else mode = mode === k ? null : k;
      fromHere = false;
      refresh();
    }

    function describeHex(hex: Hex): string {
      const cell = view?.map.cells[key(hex)];
      if (!cell) return label(hex);
      const t = TERRAIN[cell.terrain];
      const work = view?.works?.[key(hex)];
      const parts = [work ? `${label(hex)}: ${workWord(work)}, a work` : `${label(hex)}: ${(t?.name ?? cell.terrain).toLowerCase()}`];
      if (cell.elevation > 0) parts.push(`hill level ${cell.elevation}`);
      if (t?.cover) parts.push('cover');
      const holed = view?.units.find((x) => eq(x.pos, hex) && dugIn(x));
      if (holed) parts.push(`${unitName(holed)} is dug in, ${FOXHOLE_GIVES} until he moves`);
      if (t?.hide) {
        parts.push(t.hide.moved === null
          ? `hides a unit that keeps still beyond ${t.hide.still}, not one that moves`
          : `hides a unit that keeps still beyond ${t.hide.still}, one that moves beyond ${t.hide.moved}`);
      }
      if (t && !t.passable) parts.push('cannot be crossed');
      const obj = view?.map.objectives.find((o) => o.hexes.some((h) => eq(h, hex)));
      if (obj) {
        const kind = Object.hasOwn(OBJECTIVE_KINDS, obj.kind) ? OBJECTIVE_KINDS[obj.kind].name : obj.kind;
        const owner = view?.flags?.[obj.id] ?? null;
        const flag = owner === null ? 'nobody\'s flag' : owner === view?.player ? 'your flag' : `${names()[owner] ?? `player ${owner + 1}`}'s flag`;
        const gives = kindWords(obj.kind);
        parts.push(`${kind === 'HQ' ? kind : kind.toLowerCase()} ${obj.id}, ${obj.value} a round${gives ? `, gives its holder ${gives}` : ''}, ${flag}`);
      }
      if (view && !view.visible.includes(key(hex))) parts.push(view.sun === 0 ? 'not in sight' : `not in sight at ${lightName(view).toLowerCase()} (sight ${view.sun < 0 ? '−' : '+'}${Math.abs(view.sun)})`);
      else if (view && view.sun !== 0) parts.push(`in sight at ${lightName(view).toLowerCase()} (sight −${Math.abs(view.sun)})`);
      return `${parts.join(', ')}.`;
    }

    function tapHex(hex: Hex, onHex: Unit | null): void {
      if (!view || phase === 'playback') return;
      const v = view;
      const sel = unit(selected);
      const own = onHex && onHex.owner === v.player ? onHex : null;
      const aiming = phase === 'plan' && mode && sel && sel.status !== 'down' && !spectating();

      if (aiming && sel && mode) {
        const kind = mode;
        note = null;
        const options = orderOptions(v, sel.id);
        if (kind === 'move' || kind === 'dash') {
          // A hex a teammate stands on is a hex like any other here: the route may pass it or end on it.
          const o = draft[sel.id];
          const current = o && o.kind === kind ? o.path : [];
          const then = kind === 'move' ? followUpOf(draft, sel.id) : null;
          const route = layRoute(v.map, sel.pos, current, hex, allowance(v, sel, kind));
          if (route === null) say(`${label(hex)} is out of reach for ${unitName(sel)}.`);
          else if (route.length === 0) setOrder(null, sel.id);        // clearing the move clears its follow-up
          else if (kind === 'dash') setOrder({ unit: sel.id, kind, path: route }, sel.id);
          else {
            setOrder(moveOrder(v, sel, route, then), sel.id);
            if (then && !followUpOf(draft, sel.id)) {
              say(`${unitName(sel)}: ${label(then.target)} is out of range from ${label(route[route.length - 1])}. ${actionName(sel.type, then.kind)} dropped.`);
            } else if (own && own.id !== sel.id && own.status !== 'down' && eq(route[route.length - 1], hex)) {
              say(`${unitName(sel)} takes ${label(hex)} if ${unitName(own)} has left it. If not, he stops short.`);
            }
          }
          refresh();
          return;
        }
        const follow = followTargets(sel, kind);     // not null: this tap aims the move's follow-up
        const legal = (follow ?? options[kind]).includes(key(hex));
        if (!legal) {
          pending = null;
          if (own && own.id !== sel.id && own.status !== 'down') { select(own.id); refresh(); return; }
          say(`${unitName(sel)}: ${label(hex)} is not a marked hex for ${actionName(sel.type, kind).toLowerCase()}.`);
          refresh();
          return;
        }
        {
          const victims = ownUnitsUnderFire(v, draft, sel, hex, kind, follow !== null);
          const confirmed = pending && pending.unit === sel.id && pending.kind === kind && eq(pending.target, hex);
          if (victims.length > 0 && !confirmed) {
            pending = { unit: sel.id, target: hex, kind };
            say(`${actionName(sel.type, kind)} at ${label(hex)} covers your own: ${surnames(victims)}. Tap ${label(hex)} again to order it.`, true);
            refresh();
            return;
          }
        }
        pending = null;
        if (kind === 'special' && (actionOf(sel.type, 'special')?.effects.some((e) => e.kind === 'build') ?? false)) {
          // (25) A build: the hex first, then which work (keys in place of the chits).
          choosing = { unit: sel.id, target: hex, follow: follow !== null };
          refresh();
          return;
        }
        const o = draft[sel.id];
        if (follow && o?.kind === 'move') setOrder({ unit: sel.id, kind: 'move', path: o.path, then: { kind, target: hex } }, sel.id);
        else {
          if (o?.kind === 'move' || o?.kind === 'dash') say(`${unitName(sel)} stays at ${label(sel.pos)}: ${actionName(sel.type, kind).toLowerCase()} at ${label(hex)} in place of the move.`);
          setOrder({ unit: sel.id, kind, target: hex }, sel.id);
        }
        mode = null;
        fromHere = false;
        refresh();
        return;
      }

      // Not aiming: a tap picks a unit, or asks what is there.
      if (own && own.status !== 'down' && !spectating()) {
        select(selected === own.id ? null : own.id);
      } else if (onHex) {
        const def = UNITS[onHex.type];
        const whose = own ? unitName(onHex) : `${names()[onHex.owner] ?? 'Enemy'}'s ${(def?.name ?? onHex.type).toLowerCase()}`;
        say(`${whose} at ${label(hex)}${onHex.status === 'ready' ? '' : `, ${onHex.status}`}, ${sightWords(view, onHex)}.`);
        pending = null;
      } else {
        say(describeHex(hex));
        pending = null;
      }
      refresh();
    }

    function throwLever(down: boolean): void {
      if (!view || phase === 'playback') return;
      note = null;
      pending = null;
      choosing = null;
      mode = null;
      draftSender.cancel();
      if (down) {
        rejected = new Map();
        phase = 'sent';
        app.net.send({ t: 'orders', orders: toOrders(draft), purchases: buys });
      } else {
        phase = 'plan';
        app.net.send({ t: 'recall' });
      }
      refresh();
    }

    function onKey(e: KeyboardEvent): void {
      if (e.ctrlKey || e.metaKey || e.altKey || !view || phase === 'playback') return;
      if (choosing && /^[1-9]$/.test(e.key)) {
        const b = chitRow.querySelectorAll<HTMLButtonElement>('.play-work')[Number(e.key) - 1];
        if (b) { e.preventDefault(); b.click(); }
        return;
      }
      const k = CHIT_KEYS[e.key.toLowerCase()];
      if (k) {
        const c = chitRow.querySelector<HTMLButtonElement>(`[data-kind="${k}"]`);
        if (c) { e.preventDefault(); c.click(); }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const live = ownUnits(view).filter((u) => u.status !== 'down');
        if (live.length === 0) return;
        const i = live.findIndex((u) => u.id === selected);
        const next = live[(i + (e.key === 'ArrowRight' ? 1 : live.length - 1) + (i === -1 && e.key === 'ArrowLeft' ? 1 : 0)) % live.length];
        e.preventDefault();
        select(next.id);
        refresh();
      } else if (e.key === 'Escape') {
        mode = null;
        pending = null;
        choosing = null;
        note = null;
        logOpen = false;
        refresh();
      }
    }
    window.addEventListener('keydown', onKey);
    off.push(() => window.removeEventListener('keydown', onKey));

    // ---- following the server. Messages are taken one at a time: a round plays out before the next thing.

    /** Snap to a view and start planning from it. */
    function plan(m: WithView): void {
      if (dead) return;
      if (m.view.over) {
        clearDraft(sessionStore(), slot);
        app.go('results', m);
        return;
      }
      view = m.view;
      seats = m.seats;
      board?.setView(m.view);
      deadline = m.timer === null ? null : Date.now() + m.timer;
      // What the server holds for this seat is what will run, so it is what the screen shows. Only a
      // server that holds nothing lets this tab's own saved draft in, and then tells the server of it.
      const held = m.t === 'plan' ? m.orders ?? null : null;      // a `resolve` starts a round with nothing held
      draft = prune(m.view, held ? fromOrders(held) : loadDraft(sessionStore(), slot, draftSignature(session.token, m.view)));
      buys = (m.t === 'plan' ? m.purchases ?? [] : []).filter((b) => buyBackCost(m.view, b.unit) !== null);
      persist();
      rejected = new Map();
      mode = null;
      pending = null;
      choosing = null;
      note = null;
      const mine = ownUnits(m.view).filter((u) => u.status !== 'down');
      if (spectating()) selected = null;
      else if (!mine.some((u) => u.id === selected)) selected = mine[0]?.id ?? null;
      phase = m.seats.find((s) => s.seat === m.view.player)?.ready && !spectating() ? 'sent' : 'plan';
      draftSender.cancel();
      if (held === null && phase === 'plan' && (toOrders(draft).length > 0 || buys.length > 0)) draftSender.poke();
      if (!framed && board && mine.length > 0 && !wholeMapFits(m.view)) {
        // Open on the squad: the unit nearest its middle. A phone does not show the whole map.
        const cq = mine.reduce((a, u) => a + u.pos.q, 0) / mine.length;
        const cr = mine.reduce((a, u) => a + u.pos.r, 0) / mine.length;
        const mid = [...mine].sort((a, b) =>
          Math.hypot(a.pos.q - cq, a.pos.r - cr) - Math.hypot(b.pos.q - cq, b.pos.r - cr))[0];
        board.focus(mid.pos);
        framed = true;
      }
      refresh();
    }

    /**
     * True when the board opens with the whole map in frame, so there is no call to move the camera.
     * The board keeps at least START_SCALE px to a hex radius; this is the room the map needs at that scale
     * (centre to centre of the outermost hexes, plus a hex and a bit; and a little more than the map's height).
     */
    function wholeMapFits(v: PlayerView): boolean {
      const needW = ((v.map.cols - 0.5) * Math.sqrt(3) + 2.2) * START_SCALE;
      const needH = (v.map.rows * 1.5 + 4) * START_SCALE * 0.82;
      return boardBox.clientWidth >= needW && boardBox.clientHeight >= needH;
    }

    /** Play one resolved round, telling it line by line, then plan the next. */
    async function playRound(m: Extract<ServerMsg, { t: 'resolve' }>): Promise<void> {
      if (dead || !view || !board) { plan(m); return; }
      phase = 'playback';
      draftSender.cancel();
      mode = null;
      pending = null;
      choosing = null;
      note = null;
      logOpen = false;
      log = [];
      const tell = teller(view, names());
      refresh();
      const list = moments(m.events);
      for (let i = 0; i < list.length && !dead; i++) {
        const lines = tell.tell(list[i].events);
        if (lines.length > 0) {
          log.push(...lines);
          refresh();
        }
        if (list[i].kind === 'beat') {
          // The board gives a lone `phase` no pause, so the pause between phases is kept here.
          const next = list[i + 1];
          if (next && next.kind !== 'beat' && next.kind !== 'none' && !document.hidden) await wait(BEAT);
        } else {
          await board.play(list[i].events);
        }
      }
      if (dead) return;
      clearDraft(sessionStore(), slot);
      plan(m);
    }

    let queue: Promise<void> = (async () => {
      await loadKitFonts();
      if (dead) return;
      board = createBoard(canvas, makeKit(kitFromUrl()));
      board.onHexTap(tapHex);
      const watch = new ResizeObserver(() => board?.resize());
      watch.observe(boardBox);
      off.push(() => watch.disconnect());
    })();
    const next = (job: () => void | Promise<void>): void => {
      queue = queue.then(job).catch((e) => console.error('Play screen:', e));
    };

    const first = app.data as WithView | undefined;
    if (first?.view) next(() => plan(first));

    off.push(
      app.net.on('plan', (m) => next(() => plan(m))),
      app.net.on('resolve', (m) => next(() => playRound(m))),
      app.net.on('seats', (m) => next(() => { seats = m.seats; refresh(); })),
      app.net.on('rejected', (m) => next(() => {
        if (phase === 'playback') return;
        phase = 'plan';
        rejected = new Map();
        const lines: Line[] = m.errors.map((e) => {
          const u = unit(e.unit);
          if (u) rejected.set(u.id, e.reason);
          return { text: `${u ? unitName(u) : 'Orders'}: rejected, ${e.reason}.`, danger: true };
        });
        log = [...log, ...lines];
        const bad = [...rejected.keys()][0];
        if (bad) select(bad);
        note = lines.length === 1 ? lines[0]
          : { text: `${lines.length} orders rejected. Lever is back up. Open the log for each.`, danger: true };
        refresh();
      })),
      app.net.on('error', (m) => next(() => {
        if (phase === 'sent') phase = 'plan';        // whatever was sent did not take
        say(m.message, true);
        refresh();
      })),
    );
    app.net.onStatus((on) => { if (!dead) { online = on; refresh(); } });

    return () => {
      dead = true;
      for (const f of off) f();
      board?.dispose();
      root.replaceChildren();
    };
  },
};
