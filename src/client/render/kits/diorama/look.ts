// The diorama kit's look: its materials, and the air they sit in.
//
// "The world is real": the ground and the figure are physically based materials with detail made in the
// shader from one noise texture.
// The mist is air (second pass): MIST_LAYERS thin, gently rolling sheets lie between the low ground and
// just over the first step of a hill, each cut into banks and gaps by the noise texture in world space,
// each a small share of the whole depth. They are drawn after everything solid, so they lie in front of
// whatever stands in them: a man in low ground is swallowed from the feet up. Under them every world
// material still takes a little haze by height (the first pass's tint, now thin), which hides the steps
// between sheets on a hillside. Sheets, not a depth-aware screen pass: the board renders straight to its
// canvas on demand, and a screen pass would mean a second render target and a change to the board itself.
// "The information is drawn": marks, bases, labels and the veil are unlit, skip tone mapping, and are
// drawn after the mist (they are in the see-through pass, the mist first in it), so the mist never
// covers them.
//
// A look is made per kit (so per board): its uniforms carry that board's dawn.

import * as THREE from 'three';
import { noiseTexture } from './noise';

const lin = (hex: string): THREE.Color => new THREE.Color(hex);   // sRGB hex, held as linear

// ---- the air, keyed by dawn

interface Air {
  at: number;
  sky: string; skyGround: string; fill: number;      // hemisphere: light from above, bounce from below, strength
  sun: string; sunPower: number; sunDir: [number, number, number]; shade: number;   // moon, then sun; shade = how dark its shadow
  exposure: number; env: number;
  mist: string; thick: number; fall: number; patchy: number;   // the haze on surfaces: colour (before tone mapping), depth at level-0 ground, height it thins over, how broken
  fog: string; body: number; top: number; gaps: number;        // the mist in the air: colour, depth in a bank's heart, the height it reaches, how much of the ground is gaps (0..1)
  base: number;                                      // how bright the player bases are drawn (1 = the palette's colour)
  table: string;                                     // what the board stands on, seen through thin mist
}

/**
 * The cost of the mist: how many sheets are drawn (each one a see-through layer over most of the screen).
 * A phone (a coarse pointer) gets the cheap setting; 0 leaves only the haze on surfaces.
 * The whole depth is shared out among the sheets, so fewer of them is coarser, not thinner.
 */
export const MIST_LAYERS = { desktop: 9, phone: 4 };
const MIST_FLOOR = 0.06;     // the lowest sheet, above level-0 ground
const MIST_ROLL = 0.044;     // how far a sheet rolls above and below its height
const STEP = 0.5;            // the height of a hill's first step: no sheet lies where its roll would cut that flat top
const MIST_CEILING = 0.74;   // the highest, just over the first step of a hill (0.5)

// 0: blue-black, almost moonlit, the low ground under milk. 0.5: grey, the mist off the high ground.
// 1: a low sun through it, cold shade and warm light. Never cheerful.
const AIR: Air[] = [
  {
    at: 0, sky: '#5b76a8', skyGround: '#141a22', fill: 0.9,
    sun: '#a9c0ee', sunPower: 2.3, sunDir: [-0.6, 0.75, 0.4], shade: 0.65,
    exposure: 0.92, env: 0.3,
    mist: '#3a4658', thick: 0.3, fall: 0.4, patchy: 1,
    fog: '#66758d', body: 3.0, top: 0.84, gaps: 0.3, base: 0.5, table: '#0b0e12',
  },
  {
    at: 0.5, sky: '#93a0ad', skyGround: '#34352f', fill: 1.05,
    sun: '#cfd3d6', sunPower: 1.3, sunDir: [-0.9, 0.6, 0.1], shade: 0.5,
    exposure: 0.92, env: 0.5,
    mist: '#69737a', thick: 0.22, fall: 0.2, patchy: 1,
    fog: '#a3abb0', body: 1.9, top: 0.46, gaps: 0.36, base: 0.8, table: '#15181a',
  },
  {
    at: 1, sky: '#6f8db3', skyGround: '#3d3a33', fill: 0.6,
    sun: '#ffcb98', sunPower: 4.4, sunDir: [-1, 0.4, -0.2], shade: 0.85,
    exposure: 0.95, env: 0.5,
    mist: '#7f7b74', thick: 0.12, fall: 0.15, patchy: 1,
    fog: '#c4b6a2', body: 1.4, top: 0.28, gaps: 0.56, base: 1, table: '#1b1c1a',
  },
];

export interface Lights { sun: THREE.DirectionalLight; sky: THREE.HemisphereLight; sunDirection: THREE.Vector3 }

// ---- shader pieces

const MIST_VERTEX_PARS = 'varying vec3 vMistPos;\n';
const MIST_VERTEX = '\nvMistPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n';
const MIST_FRAGMENT_PARS = `
uniform vec3 uMist;
uniform vec4 uMistShape;   // depth at the base height, base height, height it thins over, patchiness
uniform sampler2D uNoise;
varying vec3 vMistPos;
`;
const MIST_FRAGMENT = `
{
  float mistClouds = texture2D(uNoise, vMistPos.xz * 0.031 + vec2(0.13, 0.57)).r;
  float mistWisps = texture2D(uNoise, vMistPos.xz * 0.11).g;
  float mistBody = mix(1.0, 0.12 + 2.3 * smoothstep(0.2, 0.85, mistClouds) * (0.45 + 1.1 * mistWisps), uMistShape.w);
  float mistLift = clamp((vMistPos.y - uMistShape.y) / uMistShape.z, -3.0, 30.0);
  float mistDepth = uMistShape.x * exp(-mistLift) * mistBody;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uMist, 1.0 - exp(-mistDepth));
}
`;

type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];

function addMist(shader: Shader, uniforms: Record<string, THREE.IUniform>): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = MIST_VERTEX_PARS + shader.vertexShader
    .replace('#include <begin_vertex>', `#include <begin_vertex>${MIST_VERTEX}`);
  shader.fragmentShader = MIST_FRAGMENT_PARS + shader.fragmentShader
    .replace('#include <tonemapping_fragment>', `${MIST_FRAGMENT}#include <tonemapping_fragment>`);
}

const GROUND_VERTEX_PARS = `
attribute float aDepth;
varying float vDepth;
varying vec3 vGroundN;
`;
const GROUND_VERTEX = `
vGroundN = normalize(mat3(modelMatrix) * objectNormal);
vDepth = aDepth;
`;
const GROUND_FRAGMENT_PARS = `
uniform vec3 uLush;
uniform vec3 uDry;
uniform vec3 uDamp;
uniform vec3 uEarth;
uniform vec3 uStone;
varying float vDepth;
varying vec3 vGroundN;
`;
// Turf on top: lush and dry grass in patches, damp hollows that shine a little, bare worn earth, and a
// blade-sized mottle. Earth on the sides: strata, grit, the odd stone, and a ragged lip of turf at the top.
const GROUND_COLOR = `
vec2 gp = vMistPos.xz;
float gSide = 1.0 - smoothstep(0.3, 0.6, vGroundN.y);
float gClouds = texture2D(uNoise, gp * 0.047).r;
float gPatches = texture2D(uNoise, gp * 0.19 + vec2(0.31, 0.77)).g;
float gGrain = texture2D(uNoise, gp * 0.83).b;
// Blade-sized grain, drawn out along one direction as grass lies.
vec2 gLie = vec2(gp.x * 0.8 + gp.y * 0.6, gp.y * 0.8 - gp.x * 0.6) * vec2(1.3, 4.6);
float gFine = texture2D(uNoise, gLie).a;
float gWear = texture2D(uNoise, gp * 0.13 + vec2(0.71, 0.19)).r;
vec3 gTurf = mix(uLush, uDry, smoothstep(0.3, 0.9, gPatches * 0.7 + gGrain * 0.3) * 0.75);
float gDamp = smoothstep(0.52, 0.8, gClouds);
gTurf = mix(gTurf, uDamp, gDamp * 0.55);
float gWorn = smoothstep(0.63, 0.8, gWear * 0.78 + gGrain * 0.22);
gTurf = mix(gTurf, uEarth * (0.75 + 0.5 * gGrain), gWorn);
gTurf *= (0.84 + 0.32 * gFine) * (0.88 + 0.24 * gWear);
float gStrata = texture2D(uNoise, vec2((gp.x + gp.y) * 0.6, vMistPos.y * 2.2)).g;
float gGrit = texture2D(uNoise, vec2((gp.x - gp.y) * 2.3, vMistPos.y * 5.0)).a;
vec3 gEarth = mix(uEarth * 0.5, uEarth * 1.2, gStrata) * (0.65 + 0.7 * gGrit);
gEarth = mix(gEarth, uStone, smoothstep(0.74, 0.86, gGrit * 0.6 + gStrata * 0.4) * 0.7);
float gLip = 1.0 - smoothstep(0.035, 0.07 + 0.09 * gGrain, vDepth);
gEarth = mix(gEarth, gTurf * 0.6, gLip);
diffuseColor.rgb = mix(gTurf, gEarth, gSide);
float gRough = mix(mix(0.96, 0.42, gDamp), 0.92, max(gWorn * (1.0 - gDamp * 0.7), gSide));
`;
const GROUND_NORMAL = `
if (gSide < 0.5) {
  float gE = 0.02;
  float gHx = texture2D(uNoise, gLie + vec2(gE * 0.8, -gE * 0.6) * vec2(1.3, 4.6)).a - gFine;
  float gHz = texture2D(uNoise, gLie + vec2(gE * 0.6, gE * 0.8) * vec2(1.3, 4.6)).a - gFine;
  vec3 gBumped = normalize(vec3(-gHx * 0.9, 1.0, -gHz * 0.9));
  normal = normalize((viewMatrix * vec4(gBumped, 0.0)).xyz);
}
`;

// One sheet of mist. Banks where the clouds of the noise are thick, gaps where they are thin; a sheet higher
// up keeps only the heart of each bank, so a bank is a mound, not a slab. No edge: it fades out before its rim.
const SHEET_FRAGMENT_PARS = `
uniform vec3 uFog;
uniform vec4 uFogShape;    // depth in a bank's heart, height the mist reaches, gaps, sheets
uniform vec4 uFogBounds;   // min x, min z, max x, max z of the board
uniform vec2 uFogSeed;
uniform sampler2D uNoise;
uniform float uSheet;      // this sheet's height
varying vec3 vMistPos;
`;
const SHEET_FRAGMENT = `
{
  vec2 fp = vMistPos.xz + uFogSeed;
  float fClouds = texture2D(uNoise, fp * 0.037 + vec2(uSheet * 0.05, 0.0)).r;
  float fWisps = texture2D(uNoise, fp * 0.123 + vec2(0.0, uSheet * 0.11)).g;
  float fFine = texture2D(uNoise, fp * 0.41 + vec2(uSheet * 0.3)).b;
  float fUp = clamp(uSheet / max(uFogShape.y, 0.001), 0.0, 1.0);          // 0 at the ground, 1 at the mist's top
  float fShape = fClouds * 0.62 + fWisps * 0.28 + fFine * 0.1;
  float fLo = uFogShape.z + fUp * 0.22;                                    // narrower higher up
  float fBank = smoothstep(fLo, fLo + 0.3, fShape);
  float fTop = 1.0 - smoothstep(0.6, 1.0, fUp);                            // thins out towards its top
  vec2 fIn = min(vMistPos.xz - uFogBounds.xy, uFogBounds.zw - vMistPos.xz);
  float fEdge = smoothstep(0.0, 3.5, fIn.x) * smoothstep(0.0, 3.5, fIn.y);
  float fDepth = uFogShape.x * fBank * fTop * fEdge / uFogShape.w;
  diffuseColor = vec4(uFog * (0.82 + 0.3 * fUp), 1.0 - exp(-fDepth));
}
`;

const PAINT_VERTEX_PARS = 'attribute vec2 aSurface;\nvarying vec2 vSurface;\n';
const PAINT_FRAGMENT_PARS = 'uniform vec4 uFade;\nvarying vec2 vSurface;\n';

// The veil over unseen ground: flat, dark, hatched in ink like the shading on a printed map. World-space lines,
// so they stay put as the map is dragged.
const VEIL_FRAGMENT_PARS = 'uniform vec3 uHatch;\nvarying vec3 vMistPos;\n';
const VEIL_FRAGMENT = `
{
  float veilAt = (vMistPos.x + vMistPos.z * 0.577 + vMistPos.y * 0.35) / 0.21;
  float veilW = fwidth(veilAt);
  float veilLine = 1.0 - smoothstep(0.1 - veilW, 0.1 + veilW, abs(fract(veilAt) - 0.5));
  // Too far out to draw a line a pixel wide: fade to the even tone it would average to.
  veilLine = mix(veilLine, 0.2, smoothstep(0.35, 0.8, veilW));
  diffuseColor.rgb = mix(diffuseColor.rgb, uHatch, veilLine * 0.5);
}
`;

// ---- the look

export interface Look {
  ground: THREE.Material;                    // turf and earth, for a tile made by tiles.ts (needs `aDepth`)
  blades: THREE.Material;                    // grass tufts (vertex colours, `aSurface`)
  paint: THREE.Material;                     // the figure (vertex colours, `aSurface`: roughness, metalness)
  faded: THREE.Material;                     // the figure when down
  sea: THREE.Material;                       // what lies round and under the board
  mist: THREE.Group;                         // the sheets of mist; the kit adds it to the scene
  veil(): THREE.Material;
  /** An unlit colour of the drawn layer. `dims`: how far it follows the dawn's `base` brightness (0 = not at all). */
  drawn(color: string, dims?: number): THREE.Material;
  /**
   * Make a lowpoly piece belong here, with this look's copies of its materials (lowpoly's own are left
   * alone): its lit parts take the haze, its drawn parts skip tone mapping and are drawn after the mist.
   */
  dress<T extends THREE.Object3D>(object: T): T;
  /** The same for a prop an effect animates: its own unlit materials, changed in place (the effect holds them). */
  dressLive<T extends THREE.Object3D>(object: T): T;
  /** Lay the mist over this much ground (the hex centres' bounds), broken up from this seed. */
  cover(bounds: THREE.Box3, seed: number): void;
  /** Set the air for this dawn. */
  air(scene: THREE.Scene, lights: Lights | null, renderer: THREE.WebGLRenderer | null, dawn: number): void;
}

export function createLook(): Look {
  const uniforms = {
    uMist: { value: lin(AIR[2].mist) },
    uMistShape: { value: new THREE.Vector4(AIR[2].thick, 0, AIR[2].fall, AIR[2].patchy) },
    uNoise: { value: noiseTexture() },
  };

  const ground = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 });
  ground.onBeforeCompile = (shader) => {
    addMist(shader, uniforms);
    Object.assign(shader.uniforms, {
      uLush: { value: lin('#3f5a30') }, uDry: { value: lin('#66683f') }, uDamp: { value: lin('#2b3823') },
      uEarth: { value: lin('#54432f') }, uStone: { value: lin('#8a8778') },
    });
    shader.vertexShader = GROUND_VERTEX_PARS + shader.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>${GROUND_VERTEX}`);
    shader.fragmentShader = GROUND_FRAGMENT_PARS + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>${GROUND_COLOR}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;\n')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${GROUND_NORMAL}`);
  };
  ground.customProgramCacheKey = () => 'diorama-ground';

  function painted(fade: number, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, side });
    const uFade = { value: new THREE.Vector4(...lin('#4b5a66').toArray(), fade) };
    m.onBeforeCompile = (shader) => {
      addMist(shader, uniforms);
      shader.uniforms.uFade = uFade;
      shader.vertexShader = PAINT_VERTEX_PARS + shader.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurface = aSurface;\n');
      shader.fragmentShader = PAINT_FRAGMENT_PARS + shader.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uFade.rgb, uFade.a);\n')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vSurface.x;\n')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vSurface.y * (1.0 - uFade.a);\n');
    };
    m.customProgramCacheKey = () => 'diorama-paint';
    return m;
  }
  const paint = painted(0, THREE.FrontSide);
  const faded = painted(0.8, THREE.FrontSide);
  const blades = painted(0, THREE.FrontSide);   // tiles.ts gives every blade both its faces, so both are lit from above

  const sea = new THREE.MeshLambertMaterial({ color: AIR[2].table });
  sea.onBeforeCompile = (shader) => addMist(shader, uniforms);
  sea.customProgramCacheKey = () => 'diorama-mist';

  // A lowpoly lit material, copied once and given the mist.
  const misted = new WeakMap<THREE.Material, THREE.Material>();
  const mine = new Set<THREE.Material>([ground, paint, faded, blades, sea]);
  function mistedCopy(m: THREE.Material): THREE.Material {
    if (mine.has(m) || !(m as THREE.MeshLambertMaterial).isMeshLambertMaterial) return m;
    let copy = misted.get(m);
    if (!copy) {
      copy = m.clone();
      copy.onBeforeCompile = (shader) => addMist(shader, uniforms);
      copy.customProgramCacheKey = () => 'diorama-mist';
      misted.set(m, copy);
      mine.add(copy);
    }
    return copy;
  }
  // A lowpoly unlit material, copied once: no tone mapping, and in the see-through pass so that it is drawn
  // after the mist. An ink outline hull (drawn inside out) is part of a figure, not information: it stays.
  const unlit = (m: THREE.Material): boolean =>
    (m as THREE.MeshBasicMaterial).isMeshBasicMaterial === true || (m as THREE.LineBasicMaterial).isLineBasicMaterial === true;
  const drawnCopies = new WeakMap<THREE.Material, THREE.Material>();
  function drawnCopy(m: THREE.Material): THREE.Material {
    if (mine.has(m) || !unlit(m) || m.side === THREE.BackSide) return m;
    let copy = drawnCopies.get(m);
    if (!copy) {
      copy = m.clone();
      copy.toneMapped = false;
      copy.transparent = true;       // depthWrite stays as it was: a solid piece still hides what is behind it
      drawnCopies.set(m, copy);
      mine.add(copy);
    }
    return copy;
  }
  const swap = (m: THREE.Material): THREE.Material => drawnCopy(mistedCopy(m));

  // Colours of the drawn layer that follow the dawn (the bases).
  const tints = new Map<string, { material: THREE.MeshBasicMaterial; full: THREE.Color; dims: number }>();
  let baseLight = 1;
  const applyTint = (t: { material: THREE.MeshBasicMaterial; full: THREE.Color; dims: number }): void => {
    t.material.color.copy(t.full).multiplyScalar(1 - t.dims * (1 - baseLight));
  };

  // The sheets of mist.
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const sheetCount = coarse ? MIST_LAYERS.phone : MIST_LAYERS.desktop;
  const fogUniforms = {
    uFog: { value: lin(AIR[2].fog) },
    uFogShape: { value: new THREE.Vector4(AIR[2].body, AIR[2].top, AIR[2].gaps, Math.max(1, sheetCount)) },
    uFogBounds: { value: new THREE.Vector4(-1, -1, 1, 1) },
    uFogSeed: { value: new THREE.Vector2() },
    uNoise: uniforms.uNoise,
  };
  const mist = new THREE.Group();
  const sheets: { mesh: THREE.Mesh; height: number }[] = [];
  for (let i = 0; i < sheetCount; i++) {
    let height = sheetCount === 1 ? MIST_FLOOR : MIST_FLOOR + ((MIST_CEILING - MIST_FLOOR) * i) / (sheetCount - 1);
    if (Math.abs(height - STEP) < MIST_ROLL + 0.02) height = STEP + (height < STEP ? -1 : 1) * (MIST_ROLL + 0.02);
    const m = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, fogUniforms, { uSheet: { value: height } });
      shader.vertexShader = MIST_VERTEX_PARS + shader.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>${MIST_VERTEX}`);
      shader.fragmentShader = SHEET_FRAGMENT_PARS + shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>${SHEET_FRAGMENT}`);
    };
    m.customProgramCacheKey = () => 'diorama-sheet';
    mine.add(m);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
    mesh.position.y = height;
    mesh.scale.y = i % 2 ? -1 : 1;      // every other sheet rolls the other way, so no two cut a hillside alike
    mesh.renderOrder = -1;              // first in the see-through pass: everything drawn comes after it
    mesh.raycast = () => {};
    mesh.visible = false;
    sheets.push({ mesh, height });
    mist.add(mesh);
  }

  return {
    ground, blades, paint, faded, sea, mist,

    drawn(color, dims = 0) {
      const id = `${color}/${dims}`;
      let t = tints.get(id);
      if (!t) {
        const material = new THREE.MeshBasicMaterial({ color, transparent: true, toneMapped: false });
        t = { material, full: lin(color), dims };
        tints.set(id, t);
        mine.add(material);
        applyTint(t);
      }
      return t.material;
    },

    cover(bounds, seed) {
      if (sheets.length === 0 || bounds.isEmpty()) return;
      const MARGIN = 5;
      const w = bounds.max.x - bounds.min.x + MARGIN * 2;
      const d = bounds.max.z - bounds.min.z + MARGIN * 2;
      const cx = (bounds.min.x + bounds.max.x) / 2;
      const cz = (bounds.min.z + bounds.max.z) / 2;
      const plane = new THREE.PlaneGeometry(w, d, Math.min(96, Math.ceil(w / 0.5)), Math.min(96, Math.ceil(d / 0.5)))
        .rotateX(-Math.PI / 2).translate(cx, 0, cz);
      // A slow roll, so that where a sheet meets a hillside is never a straight line.
      const at = plane.getAttribute('position');
      for (let i = 0; i < at.count; i++) {
        const x = at.getX(i);
        const z = at.getZ(i);
        at.setY(i, MIST_ROLL * (0.68 * Math.sin(x * 1.9 + z * 0.8 + seed) * Math.cos(z * 1.4 - x * 0.7) + 0.32 * Math.sin(x * 4.3 - z * 3.1)));
      }
      for (const { mesh } of sheets) {
        if (mesh.geometry !== plane) mesh.geometry.dispose();
        mesh.geometry = plane;
      }
      fogUniforms.uFogBounds.value.set(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2);
      fogUniforms.uFogSeed.value.set((seed % 97) * 1.37, (seed % 89) * 2.11);
    },

    dressLive(object) {
      object.traverse((o) => {
        for (const m of [(o as THREE.Mesh).material ?? []].flat()) {
          if (unlit(m) && !mine.has(m) && m.toneMapped) { m.toneMapped = false; m.needsUpdate = true; }
        }
      });
      return object;
    },

    veil() {
      const m = new THREE.MeshBasicMaterial({
        color: '#12171b', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      });
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uHatch = { value: lin('#3D4F5C') };
        shader.vertexShader = MIST_VERTEX_PARS + shader.vertexShader
          .replace('#include <begin_vertex>', `#include <begin_vertex>${MIST_VERTEX}`);
        shader.fragmentShader = VEIL_FRAGMENT_PARS + shader.fragmentShader
          .replace('#include <color_fragment>', `#include <color_fragment>${VEIL_FRAGMENT}`);
      };
      m.customProgramCacheKey = () => 'diorama-veil';
      return m;
    },

    dress(object) {
      object.traverse((o) => {
        const part = o as THREE.Mesh;
        if (!part.material) return;
        if (Array.isArray(part.material)) {
          const swapped = part.material.map(swap);
          if (swapped.some((m, i) => m !== (part.material as THREE.Material[])[i])) part.material = swapped;
        } else {
          part.material = swap(part.material);
        }
      });
      return object;
    },

    air(scene, lights, renderer, dawn) {
      const t = Math.min(1, Math.max(0, Number.isFinite(dawn) ? dawn : 1));
      const hi = Math.max(1, AIR.findIndex((a) => a.at >= t));
      const a = AIR[hi - 1];
      const b = AIR[hi];
      const k = (t - a.at) / (b.at - a.at);
      const num = (x: number, y: number) => x + (y - x) * k;
      const col = (x: string, y: string) => lin(x).lerp(lin(y), k);
      uniforms.uMist.value.copy(col(a.mist, b.mist));
      uniforms.uMistShape.value.set(num(a.thick, b.thick), 0, num(a.fall, b.fall), num(a.patchy, b.patchy));
      fogUniforms.uFog.value.copy(col(a.fog, b.fog));
      const top = num(a.top, b.top);
      fogUniforms.uFogShape.value.set(num(a.body, b.body), top, num(a.gaps, b.gaps), Math.max(1, sheets.length));
      for (const sheet of sheets) sheet.mesh.visible = sheet.height < top;    // a sheet over the mist's top costs nothing
      baseLight = num(a.base, b.base);
      for (const t of tints.values()) applyTint(t);
      (sea as THREE.MeshLambertMaterial).color.copy(col(a.table, b.table));
      scene.background = col(a.table, b.table);
      scene.environmentIntensity = num(a.env, b.env);
      if (renderer) renderer.toneMappingExposure = num(a.exposure, b.exposure);
      if (!lights) return;
      lights.sky.color.copy(col(a.sky, b.sky));
      lights.sky.groundColor.copy(col(a.skyGround, b.skyGround));
      lights.sky.intensity = num(a.fill, b.fill);
      lights.sun.color.copy(col(a.sun, b.sun));
      lights.sun.intensity = num(a.sunPower, b.sunPower);
      lights.sun.shadow.intensity = num(a.shade, b.shade);
      lights.sunDirection.set(...a.sunDir).lerp(new THREE.Vector3(...b.sunDir), k).normalize();
    },
  };
}
