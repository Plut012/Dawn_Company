import { describe, expect, it } from 'vitest';
import { mapFor, MAPS } from '../../content';
import { createMatch, viewFor } from '../../rules';
import { label } from '../../shared/hex';
import type { GameEvent, Unit } from '../../shared/types';
import { teller } from './lines';

const map = mapFor(2);
const squad = ['rifleman', 'gunner', 'mortar', 'medic'];
const state = createMatch(map, [{ player: 0, units: squad }, { player: 1, units: squad }]);
const view = viewFor(state, 0);
const hale = view.units.find((u) => u.id === '0-0')!;
const medic = view.units.find((u) => u.id === '0-3')!;
const foe: Unit = { ...state.units.find((u) => u.id === '1-1')!, pos: { q: 5, r: 3 } };
const names = ['Ann', 'Bo'];
const F4 = { q: 4, r: 3 };       // label F4: column F, row 4 (odd-r offset)

const text = (events: GameEvent[], t = teller(view, names)): string[] => t.tell(events).map((l) => l.text);

describe('report lines', () => {
  it('says a hit flatly, with the hex, and marks own losses as danger', () => {
    const t = teller(view, names);
    const lines = t.tell([
      { t: 'hit', unit: hale.id, at: F4, result: 'pinned' },
      { t: 'hit', unit: hale.id, at: F4, result: 'down' },
      { t: 'hit', unit: hale.id, at: F4, result: 'cover' },
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      `${hale.name} pinned at F4.`,
      `${hale.name} down at F4.`,
      `${hale.name} hit at F4. Cover holds.`,
    ]);
    expect(lines.map((l) => l.danger)).toEqual([true, true, false]);
  });

  it('names an enemy by its player and type, once spotted', () => {
    const t = teller(view, names);
    const lines = t.tell([
      { t: 'spotted', unit: foe },
      { t: 'fire', unit: foe.id, from: foe.pos, target: F4, blast: 1, ambush: false, action: 'burst' },
      { t: 'hit', unit: foe.id, at: foe.pos, result: 'pinned' },
      { t: 'lost', unit: foe.id },
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      "Bo's machine gunner spotted at G4.",
      "Bo's machine gunner: fire at F4.",
      "Bo's machine gunner pinned at G4.",
      "Bo's machine gunner lost from sight.",
    ]);
    expect(lines.every((l) => !l.danger)).toBe(true);
  });

  it('tells fire from an unseen shooter, an ambush, and the mortar', () => {
    expect(text([
      { t: 'fire', unit: null, from: null, target: F4, blast: 0, ambush: false, action: 'rifle' },
      { t: 'fire', unit: hale.id, from: hale.pos, target: F4, blast: 0, ambush: true, action: 'rifle' },
      { t: 'launch', unit: '0-2', from: hale.pos, action: 'shell' },
      { t: 'impact', target: F4, blast: 1, action: 'shell' },
    ])).toEqual([
      'Fire on F4 from out of sight.',
      `${hale.name}: fire from ambush at F4.`,
      `${view.units.find((u) => u.id === '0-2')!.name}: mortar. Rounds in the air.`,
      'Mortar lands at F4.',
    ]);
  });

  it('says captures in words, by kind and letter, and marks a flag lost as danger', () => {
    const lines = teller(view, names).tell([
      { t: 'capture', objective: 'C', player: 1, from: null },
      { t: 'capture', objective: 'E', player: 0, from: null },
      { t: 'capture', objective: 'W', player: 1, from: 0 },
      { t: 'capture', objective: 'A', player: 0, from: 1 },
    ]);
    expect(lines).toEqual([
      { text: 'Bo took the village C.', danger: false },
      { text: 'You took the hill E.', danger: false },
      { text: 'Bo took the HQ W from you.', danger: true },
      { text: 'You took the depot A.', danger: false },
    ]);
  });

  it('tells what the flags earned in one line, yours first', () => {
    expect(text([
      { t: 'score', objective: 'A', player: 1, value: 1 },
      { t: 'score', objective: 'C', player: 0, value: 2 },
      { t: 'score', objective: 'E', player: 1, value: 3 },
      { t: 'score', objective: 'W', player: 0, value: 1 },
    ])).toEqual(['Supply: you +3, Bo +4.']);
    expect(text([{ t: 'score', objective: 'Y', player: 1, value: 1 }])).toEqual(['Supply: Bo +1.']);
  });

  it('says nothing when a unit breaks into a run: the steps that follow show it', () => {
    expect(text([{ t: 'dash', unit: hale.id }])).toEqual([]);
  });

  it('tells treatment, recovery and a blocked move', () => {
    expect(text([
      { t: 'treat', unit: medic.id, target: hale.id, action: 'aid' },
      { t: 'recover', unit: hale.id },
      { t: 'blocked', unit: hale.id, at: F4 },
    ])).toEqual([
      `${medic.name}: treat on ${hale.name}. Back up.`,
      `${hale.name} recovers.`,
      `${hale.name} blocked at F4.`,
    ]);
  });

  it('says nothing for phases and plain steps', () => {
    expect(text([
      { t: 'phase', phase: 'move' },
      { t: 'move', step: 1, unit: hale.id, from: hale.pos, to: F4 },
    ])).toEqual([]);
  });

  it('does not report an enemy that went down as lost from sight', () => {
    const t = teller(view, names);
    t.tell([{ t: 'spotted', unit: foe }]);
    expect(text([{ t: 'hit', unit: foe.id, at: foe.pos, result: 'down' }, { t: 'lost', unit: foe.id }], t))
      .toEqual(["Bo's machine gunner down at G4."]);
  });

  it('keeps the flood of sight events quiet when the viewer is eliminated', () => {
    const t = teller(view, names);
    const lines = t.tell([
      { t: 'lost', unit: foe.id },
      { t: 'eliminated', player: 0 },
      { t: 'spotted', unit: foe },
    ]);
    expect(lines).toEqual([{ text: 'Your squad is out. Your supply stands.', danger: true }]);
    // ... and it stays quiet for what follows in the same round.
    expect(t.tell([{ t: 'spotted', unit: { ...foe, id: '1-2' } }])).toEqual([]);
  });

  it('tells another squad going out, and the end', () => {
    expect(text([{ t: 'eliminated', player: 1 }, { t: 'over', scores: [3, 1], winners: [0] }]))
      .toEqual(["Bo's squad is out.", 'Cease fire. The match is over.']);
  });

  it('never throws on a unit it has not been told about', () => {
    expect(text([{ t: 'hit', unit: '3-9', at: F4, result: 'pinned' }])).toEqual(['A unit pinned at F4.']);
  });
});

describe('report lines: task 14', () => {
  it('says why a follow-up did not happen, in a word or two, and is silent for a man already down', () => {
    const t = teller(view, names);
    const lines = t.tell([
      { t: 'phase', phase: 'assault' },
      { t: 'unable', unit: hale.id, action: 'rifle', reason: 'sight' },
      { t: 'unable', unit: hale.id, action: 'rifle', reason: 'range' },
      { t: 'unable', unit: hale.id, action: 'rifle', reason: 'pinned' },
      { t: 'unable', unit: medic.id, action: 'aid', reason: 'needs' },
      { t: 'unable', unit: hale.id, action: 'rifle', reason: 'down' },
      { t: 'spotted', unit: foe },
      { t: 'unable', unit: foe.id, action: 'rifle', reason: 'sight' },
      { t: 'unable', unit: hale.id, action: 'unheard-of', reason: 'range' },
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      `${hale.name}: fire called off, no line.`,
      `${hale.name}: fire called off, out of range.`,
      `${hale.name}: fire called off, pinned.`,
      `${medic.name}: treat called off, nothing to treat.`,
      "Bo's machine gunner spotted at G4.",
      "Bo's machine gunner: fire called off, no line.",
      `${hale.name}: act called off, out of range.`,
    ]);
    expect(lines.map((l) => l.danger)).toEqual([true, true, true, true, false, false, true]);
  });

  it('a move by a unit that was blocked is a fall back, and is said; next round it walks in silence again', () => {
    const t = teller(view, names);
    expect(t.tell([
      { t: 'phase', phase: 'move' },
      { t: 'move', step: 1, unit: hale.id, from: hale.pos, to: F4 },
      { t: 'blocked', unit: hale.id, at: F4 },
      { t: 'move', step: 2, unit: hale.id, from: F4, to: hale.pos },
    ]).map((l) => l.text)).toEqual([`${hale.name} blocked at F4.`, `${hale.name} falls back to ${label(hale.pos)}.`]);
    expect(t.tell([{ t: 'phase', phase: 'treat' }, { t: 'move', step: 1, unit: hale.id, from: hale.pos, to: F4 }])).toEqual([]);
  });
});

describe('report lines for digging in (24)', () => {
  it('tells the round\'s foxholes in one line, after what came before them, and a hit on a man dug in as cover', () => {
    const lines = text([
      { t: 'hit', unit: hale.id, at: F4, result: 'cover' },
      { t: 'dig', unit: hale.id },
      { t: 'dig', unit: medic.id },
    ]);
    expect(lines).toEqual([`${hale.name} hit at F4. Cover holds.`, `Dug in: ${hale.name}, ${medic.name}.`]);
    expect(text([{ t: 'dig', unit: hale.id }, { t: 'recover', unit: medic.id }])).toEqual([`Dug in: ${hale.name}.`, `${medic.name} recovers.`]);
  });
});

describe('report lines for Supply Line (18)', () => {
  const W = map.objectives.find((o) => o.id === 'W')!;
  it('says a buy-back and a return in words: own by name, an enemy by player', () => {
    expect(text([{ t: 'purchase', player: 0, unit: hale.id, cost: 8 }])).toEqual([`You bought back ${hale.name} for 8 supply.`]);
    expect(text([{ t: 'purchase', player: 1, unit: '1-0', cost: 8 }])).toEqual(['Bo bought a man back for 8 supply.']);
    expect(text([{ t: 'return', unit: hale.id, at: W.hexes[0] }])).toEqual([`${hale.name} is back at the HQ W.`]);
    expect(text([{ t: 'return', unit: '1-2', at: { q: 30, r: 30 } }])).toEqual(['An enemy comes back at AE31.'.replace('AE31', label({ q: 30, r: 30 }))]);
  });
});

describe('report lines for Last Stand (20)', () => {
  const stand = teller({ ...view, mode: 'last-stand' }, names);
  it('says a man down is down for good, and a lost squad has no supply to speak of', () => {
    expect(stand.tell([{ t: 'hit', unit: hale.id, at: F4, result: 'down' }]).map((l) => l.text)).toEqual([`${hale.name} down at F4. For good.`]);
    expect(stand.tell([{ t: 'hit', unit: hale.id, at: F4, result: 'pinned' }]).map((l) => l.text)).toEqual([`${hale.name} pinned at F4.`]);
    expect(stand.tell([{ t: 'eliminated', player: 0 }]).map((l) => l.text)).toEqual(['Your squad is out.']);
    expect(teller(view, names).tell([{ t: 'eliminated', player: 0 }]).map((l) => l.text)).toEqual(['Your squad is out. Your supply stands.']);
  });
});

describe('works in the report (25)', () => {
  it('says a build, with what it cost the viewer, and why one did not happen', () => {
    const eng: Unit = { ...hale, id: '0-9', type: 'engineer', name: 'Spr. Webb' };
    const t = teller({ ...view, units: [...view.units, eng] }, names);
    expect(text([
      { t: 'build', unit: '0-9', at: F4, work: 'nest' },
      { t: 'build', unit: '1-7', at: F4, work: 'sandbags' },
      { t: 'unable', unit: '0-9', action: 'build', reason: 'supply' },
      { t: 'unable', unit: '0-9', action: 'build', reason: 'blocked' },
    ], t)).toEqual([
      'Spr. Webb builds MG nest at F4 for 12 supply.',
      'The enemy builds sandbags at F4.',
      'Spr. Webb: build called off, not enough supply.',
      'Spr. Webb: build called off, no room for it there.',
    ]);
  });
});
