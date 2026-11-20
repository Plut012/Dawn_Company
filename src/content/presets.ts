// Ready-made squads, so a newcomer can hit "ready" at once.
// Each must pass validateSquad; the tests check it.

import type { Preset } from '../shared/types';

export const PRESETS: Preset[] = [
  {
    id: 'line',
    name: 'Line section',
    blurb: 'A bit of everything. Does nothing brilliantly and nothing badly.',
    units: ['rifleman', 'rifleman', 'rifleman', 'gunner', 'sniper', 'mortar', 'medic'],
  },
  {
    id: 'support',
    name: 'Weapons section',
    blurb: 'Two machine guns, a mortar and a sniper to see for them. Heavy to carry, unpleasant to walk towards.',
    units: ['rifleman', 'rifleman', 'gunner', 'gunner', 'mortar', 'sniper'],
  },
  {
    id: 'scouts',
    name: 'Scout section',
    blurb: 'Eight pairs of boots and one machine gun among them. Gets there first; then has to stay.',
    units: ['rifleman', 'rifleman', 'rifleman', 'rifleman', 'rifleman', 'sniper', 'gunner', 'medic'],
  },
  {
    // (25) Supply Line only: Last Stand has no engineer.
    id: 'pioneers',
    name: 'Pioneer section',
    blurb: 'Two engineers to dig the line, a machine gun to hold it. Spends supply on ground instead of men.',
    units: ['rifleman', 'rifleman', 'rifleman', 'rifleman', 'gunner', 'engineer', 'engineer', 'medic'],
  },
];
