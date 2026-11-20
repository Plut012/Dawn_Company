import { describe, expect, it } from 'vitest';
import { keepOverMap } from './index';

// (23) The camera keeps the middle of the screen over the map, for a map that is not a rectangle.
describe('keepOverMap', () => {
  const points = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 1, z: 2 }];
  it('leaves a point within reach of a hex centre where it is (the very object)', () => {
    const at = { x: 1.5, z: 0.5 };
    expect(keepOverMap(points, at, 1.2)).toBe(at);
  });
  it('brings a point further out back to `reach` from the nearest centre, on the line to it', () => {
    const got = keepOverMap(points, { x: -3, z: -4 }, 1.2);
    expect(got.x).toBeCloseTo(-0.72);
    expect(got.z).toBeCloseTo(-0.96);
  });
  it('leaves the point alone when there is no map', () => {
    const at = { x: 50, z: 50 };
    expect(keepOverMap([], at, 1.2)).toBe(at);
  });
});
