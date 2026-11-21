// (27) Occupied hexes: the tracker the board keeps, and the board's use of it, replayed without a screen.
// The board itself needs WebGL, so these tests wire a playback stage to an occupancy the way createBoard does
// (showUnit -> place, hideUnit -> remove, a `move` effect -> heading).

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createOccupancy } from './occupancy';
import { createPlayback, type Stage } from './playback';
import { key } from '../../shared/hex';
import type { GameEvent, Hex, HexKey, Unit, UnitId } from '../../shared/types';
import { dioramaKit } from './kits/diorama';

const hex = (q: number, r: number): Hex => ({ q, r });
const unit = (id: UnitId, owner: number, pos: Hex): Unit => ({
  id, owner, type: 'rifleman', name: id, pos, status: 'ready', pinnedRound: null, revealed: false, posture: 'still', returnRound: null, dugIn: false,
});

describe('occupancy', () => {
  it('tells a hex once when it gains a unit and once when it loses its last', () => {
    const log: string[] = [];
    const occ = createOccupancy((k, on) => log.push(`${k} ${on}`));
    occ.place('a', '0,0');
    occ.place('a', '0,0');
    occ.place('b', '0,0');
    expect(log).toEqual(['0,0 true']);
    occ.remove('a');
    expect(log).toEqual(['0,0 true']);
    occ.remove('b');
    occ.remove('b');
    expect(log).toEqual(['0,0 true', '0,0 false']);
    expect(occ.has('0,0')).toBe(false);
  });

  it('counts a piece on the hex it is setting off for, until it is placed', () => {
    const log: string[] = [];
    const occ = createOccupancy((k, on) => log.push(`${k} ${on}`));
    occ.heading('ghost', '5,5');               // not on the board: nothing
    occ.place('a', '0,0');
    occ.heading('a', '1,0');
    expect(log).toEqual(['0,0 true', '1,0 true']);
    occ.place('a', '1,0');
    expect(log).toEqual(['0,0 true', '1,0 true', '0,0 false']);
    occ.heading('a', '2,0');
    occ.place('a', '1,0');                      // he was blocked: put back where he stood
    expect(log.slice(3)).toEqual(['2,0 true', '2,0 false']);
  });

  it('forgets everything on reset and tells the new hexes afresh', () => {
    const log: string[] = [];
    const occ = createOccupancy((k, on) => log.push(`${k} ${on}`));
    occ.place('a', '0,0');
    occ.reset();
    expect(occ.has('0,0')).toBe(false);
    occ.place('a', '0,0');
    expect(log).toEqual(['0,0 true', '0,0 true']);
  });
});

describe('the board and a kit that opens houses', () => {
  /** A board without a screen: tiles from the real diorama kit, pieces as a set of ids, wired as createBoard wires them. */
  function board(tilesAt: Record<HexKey, string>, shown: Unit[]) {
    const kit = dioramaKit();
    const calls: string[] = [];
    const tiles = new Map<HexKey, THREE.Object3D>();
    for (const [k, terrain] of Object.entries(tilesAt)) {
      const [q, r] = k.split(',').map(Number);
      tiles.set(k, kit.tile(terrain, 0, { q, r }));
    }
    const occ = createOccupancy((k, on) => {
      calls.push(`${k} ${on}`);
      const tile = tiles.get(k);
      if (tile) kit.occupied!(tile, on);
    });
    const units = new Map(shown.map((u) => [u.id, { ...u }]));
    const pieces = new Set<UnitId>();
    const show = (u: Unit) => { pieces.add(u.id); occ.place(u.id, key(u.pos)); };
    const hide = (id: UnitId) => { pieces.delete(id); occ.remove(id); };
    const stage: Stage = {
      effect: async (e) => { if (e.t === 'move' && pieces.has(e.unit)) occ.heading(e.unit, key(e.to)); },
      ctx: { scene: new THREE.Scene(), hexToWorld: () => new THREE.Vector3(), unitObject: () => null },
      viewer: () => 0,
      units,
      show,
      hide,
      skip: () => false,
    };
    const lidOn = (k: HexKey): boolean => {
      let on = false;
      tiles.get(k)!.traverse((o) => { if (o.name === 'lid') on = o.visible; });
      return on;
    };
    // setView: every unit of the view is shown.
    for (const u of units.values()) show(u);
    return { calls, play: createPlayback(stage), lidOn, show, hide };
  }
  const HOUSE = key(hex(2, 0));
  const YARD = key(hex(3, 0));
  const OTHER = key(hex(5, 0));

  it('opens the house a shown unit stands in, not the one where only an unseen enemy stands', () => {
    // The view holds Blue's man in the house at 2,0. An enemy stands in the house at 5,0, unseen: he is not in the view.
    const b = board({ [HOUSE]: 'building', [YARD]: 'open', [OTHER]: 'building' }, [unit('0-0', 0, hex(2, 0))]);
    expect(b.calls).toEqual([`${HOUSE} true`]);
    expect(b.lidOn(HOUSE)).toBe(false);
    expect(b.lidOn(OTHER)).toBe(true);
  });

  it('shuts the house when he has walked out, and opens the next as he sets off for it', async () => {
    const b = board({ [HOUSE]: 'building', [YARD]: 'open', [OTHER]: 'building', '4,0': 'building' }, [unit('0-0', 0, hex(2, 0))]);
    const events: GameEvent[] = [
      { t: 'move', step: 1, unit: '0-0', from: hex(2, 0), to: hex(3, 0) },
      { t: 'move', step: 2, unit: '0-0', from: hex(3, 0), to: hex(4, 0) },
    ];
    await b.play(events);
    expect(b.calls).toEqual([`${HOUSE} true`, `${YARD} true`, `${HOUSE} false`, '4,0 true', `${YARD} false`]);
    expect(b.lidOn(HOUSE)).toBe(true);
    expect(b.lidOn('4,0')).toBe(false);
    expect(b.lidOn(OTHER)).toBe(true);
  });

  it('opens a house for an enemy who comes into sight in it, and shuts it when he is lost or goes down', async () => {
    const b = board({ [HOUSE]: 'building', [OTHER]: 'building' }, [unit('0-0', 0, hex(0, 0))]);
    const enemy = unit('1-0', 1, hex(5, 0));
    await b.play([{ t: 'spotted', unit: enemy }]);
    expect(b.lidOn(OTHER)).toBe(false);
    await b.play([{ t: 'lost', unit: '1-0' }]);
    expect(b.lidOn(OTHER)).toBe(true);
    await b.play([{ t: 'spotted', unit: enemy }, { t: 'hit', unit: '1-0', at: hex(5, 0), result: 'down' }]);
    expect(b.lidOn(OTHER)).toBe(true);           // an enemy who goes down leaves the board
    // One of the viewer's own who goes down is still shown, and still counts.
    b.show(unit('0-1', 0, hex(2, 0)));
    await b.play([{ t: 'hit', unit: '0-1', at: hex(2, 0), result: 'down' }]);
    expect(b.lidOn(HOUSE)).toBe(false);
    expect(b.calls.filter((c) => c === `${HOUSE} true`).length).toBe(1);
  });
});
