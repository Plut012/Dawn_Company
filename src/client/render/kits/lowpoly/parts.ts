// Shared pieces of the low-poly kit: the palette, materials, ink outlines,
// stencilled text.

import * as THREE from 'three';

/** The palette, terrain tints and player colours from docs/design.md. */
export const TOKENS = {
  ink: '#1E2420',
  paper: '#E9DFC6',
  khaki: '#B7A77A',
  olive: '#5E6B45',
  slate: '#3D4F5C',
  rust: '#9A4B32',
  amber: '#E8A23A',
  hill1: '#C6B88E',
  hill2: '#D5C9A4',
  blue: '#3F6E8C',
  plum: '#6B4E7A',
  teal: '#2F7F78',
  bone: '#E9DFC6',
} as const;

/** The camera's angle above the ground (see kit.ts): signs lean back to face it. */
export const FACE_CAMERA = (-55 * Math.PI) / 180;

const litCache = new Map<string, THREE.MeshLambertMaterial>();
const flatCache = new Map<string, THREE.MeshBasicMaterial>();

/** A flat-shaded material that takes the dawn light. */
export function lit(color: string): THREE.MeshLambertMaterial {
  let m = litCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    litCache.set(color, m);
  }
  return m;
}

/** An unlit flat colour, for ink and marks. `lift` pulls it off the surface below. */
export function flat(color: string, opacity = 1, lift = false): THREE.MeshBasicMaterial {
  const id = `${color}/${opacity}/${lift}`;
  let m = flatCache.get(id);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color, opacity, transparent: opacity < 1, depthWrite: opacity >= 1,
      polygonOffset: lift, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    flatCache.set(id, m);
  }
  return m;
}

const hullMaterial = new THREE.MeshBasicMaterial({ color: TOKENS.ink, side: THREE.BackSide });

/** A lit mesh that casts and takes shadow. */
export function solid(geometry: THREE.BufferGeometry, color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, lit(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Give a mesh a thin ink outline: the same shape, slightly larger, drawn
 * inside out behind it.
 */
export function outline<T extends THREE.Mesh>(mesh: T, thickness = 0.022): T {
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const box = g.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const hull = new THREE.Mesh(g, hullMaterial);
  hull.scale.set(
    1 + (2 * thickness) / Math.max(size.x, 0.01),
    1 + (2 * thickness) / Math.max(size.y, 0.01),
    1 + (2 * thickness) / Math.max(size.z, 0.01),
  );
  hull.position.set(
    centre.x * (1 - hull.scale.x),
    centre.y * (1 - hull.scale.y),
    centre.z * (1 - hull.scale.z),
  );
  mesh.add(hull);
  return mesh;
}

/** A box with its base centre at (x, y, z). */
export function box(
  w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0, ink = true,
): THREE.Mesh {
  const mesh = solid(new THREE.BoxGeometry(w, h, d), color);
  mesh.position.set(x, y + h / 2, z);
  return ink ? outline(mesh) : mesh;
}

/** Lay a shape drawn in the x-y plane flat on the ground (its +y towards the north). */
export function layFlat<T extends THREE.BufferGeometry>(geometry: T): T {
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

// ---- text

export const STENCIL = '700 64px "Stardos Stencil", "Courier New", monospace';
const textCache = new Map<string, { texture: THREE.Texture; aspect: number }>();

/**
 * Load the stencil face (declared by the page's CSS) before the board is
 * built, so labels are not drawn in a fallback face. Safe to skip.
 */
export async function loadKitFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try { await document.fonts.load(STENCIL, 'A1'); } catch { /* fall back */ }
}

/**
 * Stencilled text on an upright see-through plane `height` tall, or null
 * where there is no canvas to draw on (tests).
 */
export function text(str: string, height: number, color: string, opacity = 1): THREE.Mesh | null {
  if (typeof document === 'undefined') return null;
  const id = `${str}/${color}`;
  let entry = textCache.get(id);
  if (!entry) {
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.font = STENCIL;
    const w = Math.ceil(g.measureText(str).width) + 8;
    canvas.width = w;
    canvas.height = 72;
    g.font = STENCIL;
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(str, w / 2, 39);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    entry = { texture, aspect: w / 72 };
    textCache.set(id, entry);
  }
  const material = new THREE.MeshBasicMaterial({
    map: entry.texture, transparent: true, opacity, depthWrite: false,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(height * entry.aspect, height), material);
}
