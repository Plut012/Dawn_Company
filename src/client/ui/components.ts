// The field kit as code: one small function per component in docs/design.md.
// Each returns a plain element carrying the class names from kit.css. State is
// the class (as in the style sheet) and is changed with the part's `set...`
// method; operable parts take a callback. Text always goes in as textContent.

import type { PlayerId } from '../../shared/types';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls = '', text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svg(viewBox: string, inner: string, cls = ''): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = inner;     // only ever our own constants
  return s;
}

function setState(e: HTMLElement, states: readonly string[], now: string): void {
  e.classList.remove(...states);
  if (states.includes(now)) e.classList.add(now);
}

// ---------------------------------------------------------------- Panel
export interface PanelOptions { inset?: boolean }

/** Olive plate (or Ink, when `inset`) with a stencil label and a screw in each top corner. */
export function panel(label: string, opts: PanelOptions = {}, ...children: (Node | string)[]): HTMLElement {
  const p = el('section', opts.inset ? 'panel inset' : 'panel');
  p.append(el('span', 'label', label), ...children);
  return p;
}

// ---------------------------------------------------------------- Order chit
export type ChitState = 'idle' | 'selected' | 'issued' | 'disabled';
const CHIT_STATES = ['selected', 'issued', 'disabled'] as const;

/** Stroke icons for the order chits, 32 x 32. */
export const ICONS = {
  move: '<path d="M4 16h22M18 8l8 8-8 8"/>',
  dash: '<path d="M2 16h14M10 8l8 8-8 8M18 8l8 8-8 8"/>',
  fire: '<circle cx="16" cy="16" r="9"/><path d="M16 2v8M16 22v8M2 16h8M22 16h8"/>',
  ambush: '<path d="M3 16c5-8 21-8 26 0-5 8-21 8-26 0z"/><circle cx="16" cy="16" r="3"/>',
  special: '<path d="M16 3l4 9 9 1-7 6 2 10-8-5-8 5 2-10-7-6 9-1z"/>',
} as const;

export interface ChitOptions { label: string; icon?: string; state?: ChitState; onPress?: () => void }
export type Chit = HTMLButtonElement & { set(state: ChitState): void; readonly state: ChitState };

/** 72 px cardboard square. It reports presses; the caller decides what state comes next. */
export function chit(opts: ChitOptions): Chit {
  const b = el('button', 'chit') as unknown as Chit;
  b.type = 'button';
  if (opts.icon) b.append(svg('0 0 32 32', opts.icon));
  b.append(document.createTextNode(opts.label));
  let state: ChitState = 'idle';
  b.set = (s) => {
    state = s;
    setState(b, CHIT_STATES, s);
    b.setAttribute('aria-disabled', String(s === 'disabled'));
    b.setAttribute('aria-pressed', String(s === 'selected' || s === 'issued'));
  };
  Object.defineProperty(b, 'state', { get: () => state });
  b.set(opts.state ?? 'idle');
  b.addEventListener('click', () => { if (state !== 'disabled') opts.onPress?.(); });
  return b;
}

// ---------------------------------------------------------------- Key
export interface KeyOptions { label: string; onPress?: () => void; disabled?: boolean; pressed?: boolean }
export type Key = HTMLButtonElement & { setLabel(text: string): void; setPressed(on: boolean): void };

/** Push button. Idle, pressed (held down, Amber), or disabled (the `disabled` property). */
export function key(opts: KeyOptions): Key {
  const b = el('button', 'key', opts.label) as unknown as Key;
  b.type = 'button';
  b.disabled = !!opts.disabled;
  b.classList.toggle('pressed', !!opts.pressed);
  b.setLabel = (t) => { b.textContent = t; };
  b.setPressed = (on) => b.classList.toggle('pressed', on);
  if (opts.onPress) b.addEventListener('click', () => { if (!b.disabled) opts.onPress!(); });
  return b;
}

// ---------------------------------------------------------------- Ready lever
export type LeverState = 'up' | 'down' | 'locked';
const LEVER_STATES = ['down', 'locked'] as const;
export interface LeverOptions {
  state?: LeverState;
  /** Called when the player throws the lever: `true` = down (ready). Not called when locked. */
  onChange?: (down: boolean) => void;
  label?: string;
}
export type Lever = HTMLElement & { set(state: LeverState): void; readonly state: LeverState };

/** Two-position lever. It travels by itself when thrown; `set` follows the server. */
export function lever(opts: LeverOptions = {}): Lever {
  const l = el('div', 'lever') as unknown as Lever;
  l.append(el('div', 'slot'), el('div', 'handle'));
  l.tabIndex = 0;
  l.setAttribute('role', 'switch');
  if (opts.label) l.setAttribute('aria-label', opts.label);
  let state: LeverState = 'up';
  l.set = (s) => {
    state = s;
    setState(l, LEVER_STATES, s);
    l.setAttribute('aria-checked', String(s === 'down'));
    l.setAttribute('aria-disabled', String(s === 'locked'));
  };
  Object.defineProperty(l, 'state', { get: () => state });
  const throwIt = (): void => {
    if (state === 'locked') return;
    const next: LeverState = state === 'down' ? 'up' : 'down';
    l.set(next);
    opts.onChange?.(next === 'down');
  };
  l.addEventListener('click', throwIt);
  l.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); throwIt(); }
  });
  l.set(opts.state ?? 'up');
  return l;
}

// ---------------------------------------------------------------- Lamp
export type LampState = 'planning' | 'ready' | 'disconnected' | 'out';
const LAMP_STATES = ['planning', 'ready', 'disconnected', 'out'] as const;
export type Lamp = HTMLElement & { set(state: LampState, text?: string): void };

/** One status light with its caption. */
export function lamp(text: string, state: LampState = 'planning'): Lamp {
  const l = el('span', 'lamp') as unknown as Lamp;
  const caption = el('span', 'text', text);
  l.append(document.createElement('i'), caption);
  l.set = (s, t) => {
    setState(l, LAMP_STATES, s);
    if (t !== undefined) caption.textContent = t;
  };
  l.set(state);
  return l;
}

// ---------------------------------------------------------------- Readout
export type Readout = HTMLElement & { set(value: string | number, alert?: boolean): void };

/** Stencil numerals on a dark plate. */
export function readout(label: string, value: string | number, alert = false): Readout {
  const r = el('div', 'readout') as unknown as Readout;
  const b = el('b');
  r.append(b, el('span', '', label));
  r.set = (v, a = false) => {
    b.textContent = String(v);
    r.classList.toggle('alert', a);
  };
  r.set(value, alert);
  return r;
}

// ---------------------------------------------------------------- Player marks and unit card
const MARK_COLOURS = ['#3F6E8C', '#6B4E7A', '#2F7F78', '#E9DFC6'] as const;
const MARK_NAMES = ['blue bar', 'plum chevron', 'teal diamond', 'bone disc'] as const;

/** The player mark for a seat: colour and shape together. */
export function playerMark(seat: PlayerId, cls = 'mark'): SVGSVGElement {
  const i = ((seat % 4) + 4) % 4;
  const c = MARK_COLOURS[i];
  const shapes = [
    `<rect x="2" y="7" width="16" height="6" fill="${c}" stroke="#1E2420" stroke-width="2"/>`,
    `<path d="M3 14L10 5l7 9" fill="none" stroke="#1E2420" stroke-width="6" stroke-linejoin="miter"/><path d="M3 14L10 5l7 9" fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="miter"/>`,
    `<polygon points="10,2 18,10 10,18 2,10" fill="${c}" stroke="#1E2420" stroke-width="2"/>`,
    `<circle cx="10" cy="10" r="7" fill="${c}" stroke="#1E2420" stroke-width="2"/>`,
  ];
  const m = svg('0 0 20 20', shapes[i], cls);
  m.setAttribute('role', 'img');
  m.setAttribute('aria-label', MARK_NAMES[i]);
  m.removeAttribute('aria-hidden');
  return m;
}

export type UnitCardState = 'ready' | 'selected' | 'pinned' | 'down';
const CARD_STATES = ['selected', 'pinned', 'down'] as const;
export interface UnitCardOptions {
  name: string;
  role: string;
  seat: PlayerId;
  state?: UnitCardState;
  /** Replaces the default "role · state" line. */
  detail?: string;
}
export type UnitCard = HTMLElement & { set(state: UnitCardState): void };

const SILHOUETTE = '<path d="M10 14a8 8 0 0116 0h3v3H7v-3zM12 19h12v5l-3 4h-6l-3-4zM6 36c0-6 5-8 12-8s12 2 12 8z"/>';

/** Silhouette, name, role and player mark. */
export function unitCard(opts: UnitCardOptions): UnitCard {
  const c = el('div', 'unit') as unknown as UnitCard;
  const face = el('div', 'face');
  face.append(svg('0 0 36 36', SILHOUETTE));
  const text = el('div');
  const small = el('small');
  text.append(el('b', '', opts.name), small);
  c.append(face, text, playerMark(opts.seat));
  c.set = (s) => {
    setState(c, CARD_STATES, s);
    small.textContent = opts.detail ?? `${opts.role} · ${s}`;
  };
  c.set(opts.state ?? 'ready');
  return c;
}

// ---------------------------------------------------------------- Stepper
export type StepperState = 'idle' | 'at-limit' | 'unaffordable' | 'barred';
export interface StepperView {
  count: number;
  /** Cost caption, e.g. "4 PTS EA · 3 LEFT". */
  cost: string;
  canDec: boolean;
  canInc: boolean;
  state: StepperState;
}
export type Stepper = HTMLElement & { set(view: StepperView): void };

/** − count + with the point cost beside it. Calls `onStep(-1)` / `onStep(+1)`. */
export function stepper(onStep: (delta: -1 | 1) => void, label = ''): Stepper {
  const s = el('div', 'stepper') as unknown as Stepper;
  const minus = el('button', '', '−');
  const count = el('span', 'count');
  const plus = el('button', '', '+');
  const cost = el('span', 'cost');
  minus.type = plus.type = 'button';
  minus.setAttribute('aria-label', `One fewer ${label}`.trim());
  plus.setAttribute('aria-label', `One more ${label}`.trim());
  count.setAttribute('aria-live', 'polite');
  minus.addEventListener('click', () => { if (!minus.disabled) onStep(-1); });
  plus.addEventListener('click', () => { if (!plus.disabled) onStep(1); });
  s.append(minus, count, plus, cost);
  s.set = (v) => {
    count.textContent = String(v.count);
    cost.textContent = v.cost;
    minus.disabled = !v.canDec;
    plus.disabled = !v.canInc;
    s.classList.toggle('unaffordable', v.state === 'unaffordable');
    s.classList.toggle('at-limit', v.state === 'at-limit');
    s.classList.toggle('barred', v.state === 'barred');
  };
  return s;
}

// ---------------------------------------------------------------- Report strip
export type Report = HTMLElement & { set(text: string, danger?: boolean, time?: string): void };

/** One typed line. Normal, or danger (Rust edge). */
export function report(text = '', danger = false, time?: string): Report {
  const r = el('div', 'report') as unknown as Report;
  r.setAttribute('role', 'status');
  r.set = (t, d = false, tm) => {
    r.replaceChildren();
    if (tm) r.append(el('time', '', tm));
    r.append(document.createTextNode(t));
    r.classList.toggle('danger', d);
  };
  r.set(text, danger, time);
  return r;
}

// ---------------------------------------------------------------- Field
/** Paper plate for typing a name. */
export function field(opts: { label: string; value?: string; placeholder?: string; maxLength?: number }): HTMLInputElement {
  const f = el('input', 'field');
  f.type = 'text';
  f.value = opts.value ?? '';
  f.placeholder = opts.placeholder ?? '';
  if (opts.maxLength) f.maxLength = opts.maxLength;
  f.setAttribute('aria-label', opts.label);
  f.setAttribute('autocomplete', 'nickname');
  f.spellcheck = false;
  return f;
}
