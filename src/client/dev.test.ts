import { describe, expect, it } from 'vitest';
import { PRESETS } from '../content';
import { devAuto } from './dev';

describe('devAuto', () => {
  it('is honoured for a dev slot', () => {
    expect(devAuto('?slot=dev2&auto=support&name=Bo')).toEqual({ name: 'Bo', squad: PRESETS.find((p) => p.id === 'support')!.units });
  });
  it('is ignored for any other slot, and with no slot', () => {
    expect(devAuto('?slot=a&auto=line')).toBeNull();
    expect(devAuto('?auto=line')).toBeNull();
    expect(devAuto('?slot=mydev1&auto=line')).toBeNull();
  });
  it('is ignored without auto', () => {
    expect(devAuto('?slot=dev1')).toBeNull();
    expect(devAuto('?slot=dev1&name=Ann')).toBeNull();
  });
  it('falls back to the first preset and a name from the slot', () => {
    expect(devAuto('?slot=dev3&auto=nonsense')).toEqual({ name: 'Dev 3', squad: PRESETS[0].units });
    expect(devAuto('?slot=dev&auto=')).toEqual({ name: 'Dev 1', squad: PRESETS[0].units });
  });
  it('cuts a long name to the lobby limit', () => {
    expect(devAuto(`?slot=dev1&auto=line&name=${'x'.repeat(60)}`)!.name).toHaveLength(24);
  });
});
