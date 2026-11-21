// Steady randomness for the diorama kit: nothing here uses Math.random, so a hex looks the same on every
// screen and after every reload.

import * as THREE from 'three';
import type { Hex } from '../../../../shared/types';

/** A small random stream from a seed: the same numbers every time. */
export function streamOf(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The stream of one hex, seeded by its key (q, r). */
export const hexStream = (hex: Hex): (() => number) =>
  streamOf(Math.imul(hex.q, 73856093) ^ Math.imul(hex.r, 19349663) ^ 0x2f6e2b1);

const SIZE = 128;

/** One channel of noise that tiles: a few octaves of smoothed lattice values, each octave wrapping at the edge. */
function channel(seed: number, firstCells: number, octaves: number): Float32Array {
  const out = new Float32Array(SIZE * SIZE);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = firstCells << o;
    const rnd = streamOf(seed + o * 977);
    const lattice = Float32Array.from({ length: cells * cells }, () => rnd());
    const at = (x: number, y: number) => lattice[(y % cells) * cells + (x % cells)];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const fx = (x / SIZE) * cells;
        const fy = (y / SIZE) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        out[y * SIZE + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  // Stretch to the whole 0..1 range, so thresholds in the shaders mean the same for every channel.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of out) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo || total);
  return out;
}

let shared: THREE.DataTexture | null = null;

/**
 * The kit's one texture: four independent tiling noises, made in code. r = soft clouds, g = patches,
 * b = grain, a = fine grain. The ground, the mist and the veil all read it at their own scales.
 */
export function noiseTexture(): THREE.DataTexture {
  if (shared) return shared;
  const channels = [channel(11, 3, 4), channel(23, 5, 4), channel(37, 12, 3), channel(53, 24, 2)];
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.round(channels[c][i] * 255);
  }
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  shared = texture;
  return texture;
}
