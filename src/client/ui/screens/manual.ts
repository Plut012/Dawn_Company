// The field manual: one short lesson at a time, drawn by the real board and
// resolved by the real rules. Watch-only: the orders are preset; the viewer
// plays them or steps through the phases.
//
// The screen holds no rules and no lesson content. Lessons are data in
// src/manual; what to show of one (views, marks, stops, the closing line) is
// worked out there too. This file is the kit around the board.
//
// It needs no server and opens no socket; main.ts mounts it for `/?manual`.

import { GROUPS, LESSONS, checkLesson, lessonById, runLesson } from '../../../manual/lessons';
import type { Lesson, LessonRun } from '../../../manual/lessons';
import {
  PHASES, PHASE_NAMES, SIDE_NAMES, manualSearch, orderMarks, outcome, stopsFor, viewOf, viewpointName,
} from '../../../manual/show';
import type { Stop, Viewpoint } from '../../../manual/show';
import type { Phase } from '../../../shared/types';
import { createBoard } from '../../render';
import type { Board } from '../../render';
import { lowpolyKit, loadKitFonts } from '../../render/kits/lowpoly';
import { el, key, panel, playerMark, report } from '../components';
import type { Key } from '../components';
import { teller } from '../lines';
import type { Teller } from '../lines';

const NOTE_DWELL = 1100;     // ms a phase with a note stays up, at least, while Play runs
const ORDERS_DWELL = 1400;   // ms the next round's orders stay up before Play goes on
const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export interface ManualOptions {
  /** Lesson id to open at; anything else opens the first lesson. */
  lesson?: string | null;
  /** The key back to the lobby. Left out: no such key. */
  onBack?: () => void;
}

export function mountManual(root: HTMLElement, opts: ManualOptions = {}): () => void {
  let dead = false;
  let board: Board | null = null;

  // ---- state
  let lesson: Lesson = lessonById(opts.lesson) ?? LESSONS[0];
  let run: LessonRun = runLesson(lesson);
  let failed: string[] = checkLesson(lesson, run);
  let viewpoint: Viewpoint = lesson.viewAs;
  let stops: Stop[] = [];
  let cursor = 0;                  // the next stop to play; stops.length = all played
  let finished = false;            // the closing line is up
  let phaseNow: Phase | null = null;
  let playing = false;             // Play is running by itself
  let busy = false;                // the board is playing a stop
  let halt = false;                // asks a running Play to stop after the current stop
  let tell: Teller | null = null;  // report lines for the round now playing
  let mapTurn = 0;                 // bumped to make the board frame the map afresh
  let listOpen = false;

  // ---- parts
  const backKey = key({ label: 'Lobby', onPress: () => opts.onBack?.() });
  backKey.hidden = !opts.onBack;
  const listKey = key({ label: 'Lessons', onPress: () => { listOpen = !listOpen; refresh(); } });
  listKey.classList.add('manual-list-key');
  const prevKey = key({ label: 'Prev', onPress: () => go(-1) });
  const nextKey = key({ label: 'Next', onPress: () => go(1) });
  prevKey.setAttribute('aria-label', 'Previous lesson');
  nextKey.setAttribute('aria-label', 'Next lesson');
  const topKeys = el('div', 'manual-keys');
  topKeys.append(backKey, listKey, prevKey, nextKey);
  const top = el('header', 'manual-top');
  top.append(el('h1', 'manual-name', 'Field manual'), topKeys);

  const title = el('h2', 'manual-title');
  const text = el('p', 'manual-text');
  const head = panel('', {}, title, text);
  head.classList.add('manual-head');
  const headLabel = head.querySelector('.label') as HTMLElement;

  const canvas = el('canvas');
  const boardBox = el('div', 'manual-board');
  boardBox.append(canvas);

  const roundWord = el('span', 'manual-round');
  const phaseWords = new Map<Phase, HTMLElement>(PHASES.map((p) => [p, el('span', '', PHASE_NAMES[p])]));
  const phaseBar = el('div', 'manual-phases');
  phaseBar.append(roundWord, ...phaseWords.values());
  const strip = report('');
  const status = el('div', 'manual-status');
  status.append(phaseBar, strip);

  const playKey = key({ label: 'Play', onPress: () => press(playAll) });
  const stepKey = key({ label: 'Step', onPress: () => press(stepOnce) });
  const restartKey = key({ label: 'Restart', onPress: () => interrupt(() => showRound(0)) });
  const runRow = el('div', 'manual-run');
  runRow.append(playKey, stepKey, restartKey);
  const viewRow = el('div', 'manual-view');
  const kit = panel('Playback', {}, runRow, viewRow);
  kit.classList.add('manual-kit');

  const listKeys = new Map<string, Key>();
  const listBody = el('div', 'manual-list-body');
  for (const group of GROUPS) {
    const inGroup = LESSONS.filter((l) => l.group === group);
    if (inGroup.length === 0) continue;
    listBody.append(el('h3', '', group));
    for (const l of inGroup) {
      const k = key({ label: l.title, onPress: () => open(l) });
      listKeys.set(l.id, k);
      listBody.append(k);
    }
  }
  const list = panel('Lessons', {}, listBody);
  list.classList.add('manual-list');

  const screen = el('div', 'manual');
  screen.append(top, head, boardBox, status, kit, list);
  root.replaceChildren(screen);

  // ---- drawing the kit

  /** The round the board is in (0-based): the one being played, or just played and not yet followed by new orders. */
  function roundInHand(): number {
    const next = stops[cursor];
    if (!next) return Math.max(0, lesson.rounds.length - 1);
    return next.kind === 'orders' ? next.round - 1 : next.round;
  }

  function say(line: string, danger = false): void { strip.set(line, danger); }

  function refresh(): void {
    const at = LESSONS.indexOf(lesson);
    headLabel.textContent = `${lesson.group} · ${at + 1} of ${LESSONS.length}`;
    title.textContent = lesson.title;
    text.textContent = lesson.text;
    prevKey.disabled = at <= 0;
    nextKey.disabled = at >= LESSONS.length - 1;
    for (const [id, k] of listKeys) k.setPressed(id === lesson.id);
    listKey.setPressed(listOpen);
    screen.classList.toggle('list-open', listOpen);
    screen.dataset.lesson = lesson.id;
    screen.dataset.state = finished ? 'end' : playing || busy ? 'playing' : 'ready';   // for scripts and the eval page

    const round = roundInHand();
    roundWord.textContent = lesson.rounds.length > 1 ? `Round ${round + 1}/${lesson.rounds.length}` : '';
    const reached = phaseNow === null ? -1 : PHASES.indexOf(phaseNow);
    PHASES.forEach((p, i) => {
      const word = phaseWords.get(p)!;
      word.classList.toggle('now', i === reached && !finished);
      word.classList.toggle('done', i < reached || finished);
    });

    playKey.setPressed(playing);
    playKey.disabled = playing;
    stepKey.disabled = playing || busy || finished;

    viewRow.hidden = !lesson.fogMatters;
    if (!lesson.fogMatters) viewRow.replaceChildren();
    if (lesson.fogMatters) {
      const sides: Viewpoint[] = [...run.states[0].eliminated.map((_, p) => p), 'umpire'];
      viewRow.replaceChildren(el('span', 'manual-view-word', 'View as'), ...sides.map((v) => {
        const k = key({ label: viewpointName(v), pressed: v === viewpoint, onPress: () => interrupt(() => look(v)) });
        if (v !== 'umpire') k.prepend(playerMark(v));
        k.setAttribute('aria-pressed', String(v === viewpoint));
        return k;
      }));
    }
  }

  // ---- showing a lesson on the board

  /** The map as the board is given it. A new `mapTurn` makes the board build and frame it afresh. */
  const withMap = <T extends { map: Lesson['map'] }>(view: T): T =>
    ({ ...view, map: { ...view.map, id: `${view.map.id}#${mapTurn}` } });

  /** Put a round's starting state on the board, with its orders as marks, and say so. */
  function putOrders(round: number): void {
    phaseNow = null;
    tell = null;
    board?.setView(withMap(viewOf(run.states[round], viewpoint)));
    const marks = orderMarks(run.states[round], lesson.rounds[round], viewpoint);
    board?.setMarks(marks);
    const as = viewpoint === 'umpire' ? '' : `As ${viewpointName(viewpoint)}: `;
    // A move with a follow-up is one order drawn as two marks: its route, then the aim from the route's end.
    const orders = marks.filter((m, i) => {
      const prev = marks[i - 1];
      const end = prev?.kind === 'path' ? prev.path[prev.path.length - 1] : null;
      return !(m.kind === 'target' && end && m.from.q === end.q && m.from.r === end.r);
    }).length;
    const count = orders === 0 ? 'no orders this round' : orders === 1 ? '1 order marked' : `${orders} orders marked`;
    const line = `${as}${count}.`;
    say(`${lesson.rounds.length > 1 ? `Round ${round + 1}. ` : ''}${line.charAt(0).toUpperCase()}${line.slice(1)} Play, or step through the phases.`);
  }

  /** Go to the start of a round. */
  function showRound(round: number): void {
    stops = stopsFor(lesson, run, viewpoint);
    cursor = stops.findIndex((s) => s.kind === 'phase' && s.round === round);
    finished = false;
    putOrders(round);
    refresh();
  }

  /** The end: the last state and the closing line. */
  function showEnd(): void {
    stops = stopsFor(lesson, run, viewpoint);
    cursor = stops.length;
    finished = true;
    phaseNow = null;
    board?.setView(withMap(viewOf(run.states[run.states.length - 1], viewpoint)));
    board?.setMarks([]);
    if (failed.length > 0) say(`Not as written. ${failed.join(' ')}`, true);
    else say(outcome(lesson, run));
    refresh();
  }

  function open(next: Lesson): void {
    interrupt(() => {
      lesson = next;
      run = runLesson(lesson);
      failed = checkLesson(lesson, run);
      viewpoint = lesson.viewAs;
      listOpen = false;
      try { history.replaceState(null, '', `${location.pathname}${manualSearch(location.search, lesson.id)}`); } catch { /* a page that may not touch its URL */ }
      refresh();             // the text first: it decides how much room the board gets
      fit();
      mapTurn++;
      showRound(0);
    });
  }

  function go(by: -1 | 1): void {
    const next = LESSONS[LESSONS.indexOf(lesson) + by];
    if (next) open(next);
  }

  /** Change viewpoint: the same moment (the start of the round in hand, or the end) through other eyes. */
  function look(next: Viewpoint): void {
    const round = roundInHand();
    viewpoint = next;
    if (finished) showEnd(); else showRound(round);
  }

  // ---- playing

  /** Play the next stop. Returns false when there was none left to play. */
  async function playStop(dwell: boolean): Promise<boolean> {
    if (!board || cursor >= stops.length) return false;
    const stop = stops[cursor];
    if (stop.kind === 'orders') {
      putOrders(stop.round);
      cursor++;
      refresh();
      if (dwell && !halt && !document.hidden) await wait(ORDERS_DWELL);
      return true;
    }
    if (!tell) {             // the round's first phase: the marks come off, the reports start
      board.setMarks([]);
      tell = teller(viewOf(run.states[stop.round], viewpoint), [...SIDE_NAMES]);
    }
    const lines = tell.tell(stop.chunks.flatMap((c) => c.events));
    const note = stop.phase ? lesson.notes?.[stop.phase] : undefined;
    phaseNow = stop.phase;
    say(stop.phase ? `${PHASE_NAMES[stop.phase]}. ${note ?? lines.map((l) => l.text).join(' ')}` : 'Nothing to report this round.');
    busy = true;
    refresh();
    const started = Date.now();
    for (const chunk of stop.chunks) await board.play(chunk.events);
    if (dwell && !halt && !document.hidden) await wait(Math.max(0, (note ? NOTE_DWELL : 0) - (Date.now() - started)));
    busy = false;
    cursor++;
    if (dead) return false;
    // The round is over: the board already stands as the next state does. Giving it that state's
    // view changes only the fog, which the board cannot lift while it plays.
    const next = stops[cursor];
    if (!next || next.kind === 'orders') board.setView(withMap(viewOf(run.states[stop.round + 1], viewpoint)));
    refresh();
    return true;
  }

  /** Step: one stop; after the last one, a further press brings the closing line. */
  async function stepOnce(): Promise<void> {
    if (finished) return;
    if (!(await playStop(false)) && !dead) showEnd();
  }

  /** Play: everything that is left, by itself. From the end, it starts over. */
  async function playAll(): Promise<void> {
    if (finished) showRound(0);
    playing = true;
    halt = false;
    refresh();
    while (!halt && !dead && (await playStop(true))) { /* on to the next stop */ }
    playing = false;
    if (dead) return;
    if (!halt) showEnd(); else refresh();
  }

  // ---- one thing at a time

  const cleanup: (() => void)[] = [];
  let boxW = 0;
  let boxH = 0;
  /** Give the board the size its box has now. */
  function fit(): void {
    boxW = boardBox.clientWidth;
    boxH = boardBox.clientHeight;
    board?.resize();
  }

  let queue: Promise<void> = (async () => {
    await loadKitFonts();
    if (dead) return;
    board = createBoard(canvas, lowpolyKit());
    // The board refits by itself when its box changes shape (a phone turned over): the lesson, the step and
    // what is playing carry on. A tiny map that was framed stays framed; see `resize` in render.
    const watch = new ResizeObserver(() => {
      if (boardBox.clientWidth === boxW && boardBox.clientHeight === boxH) return;
      fit();
    });
    watch.observe(boardBox);
    cleanup.push(() => watch.disconnect());
  })();

  /** Do this after whatever is running. */
  function press(job: () => void | Promise<void>): void {
    queue = queue.then(() => (dead ? undefined : job())).catch((e) => console.error('Field manual:', e));
  }

  /** Stop a running Play, then do this. */
  function interrupt(job: () => void): void {
    halt = true;
    press(() => { halt = false; job(); });
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  }
  window.addEventListener('keydown', onKeyDown);

  refresh();
  press(() => { fit(); showRound(0); });

  return () => {
    dead = true;
    halt = true;
    window.removeEventListener('keydown', onKeyDown);
    for (const f of cleanup) f();
    board?.dispose();
    root.replaceChildren();
  };
}
