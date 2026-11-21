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
  sheen: string;                                     // (28) the sky of the moment as still water gives it back (before tone mapping)
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
    fog: '#66758d', body: 3.0, top: 0.84, gaps: 0.3, base: 0.5, sheen: '#26323f', table: '#0b0e12',
  },
  {
    at: 0.5, sky: '#93a0ad', skyGround: '#34352f', fill: 1.05,
    sun: '#cfd3d6', sunPower: 1.3, sunDir: [-0.9, 0.6, 0.1], shade: 0.5,
    exposure: 0.92, env: 0.5,
    mist: '#69737a', thick: 0.22, fall: 0.2, patchy: 1,
    fog: '#a3abb0', body: 1.9, top: 0.46, gaps: 0.36, base: 0.8, sheen: '#414b52', table: '#15181a',
  },
  {
    at: 1, sky: '#6f8db3', skyGround: '#3d3a33', fill: 0.6,
    sun: '#ffcb98', sunPower: 4.4, sunDir: [-1, 0.4, -0.2], shade: 0.85,
    exposure: 0.95, env: 0.5,
    mist: '#7f7b74', thick: 0.12, fall: 0.15, patchy: 1,
    fog: '#c4b6a2', body: 1.4, top: 0.28, gaps: 0.56, base: 1, sheen: '#55534a', table: '#1b1c1a',
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

/** `haze`: how much of the haze by height this material takes (water, lying low, would drown in all of it). */
function addMist(shader: Shader, uniforms: Record<string, THREE.IUniform>, haze = 1): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = MIST_VERTEX_PARS + shader.vertexShader
    .replace('#include <begin_vertex>', `#include <begin_vertex>${MIST_VERTEX}`);
  shader.fragmentShader = MIST_FRAGMENT_PARS + shader.fragmentShader
    .replace('#include <tonemapping_fragment>', `${MIST_FRAGMENT.replace('uMistShape.x *', `${haze.toFixed(3)} * uMistShape.x *`)}#include <tonemapping_fragment>`);
}

const GROUND_VERTEX_PARS = `
attribute float aDepth;
attribute float aFloor;
attribute float aEdge;
varying float vDepth;
varying float vFloor;
varying float vEdge;
varying vec3 vGroundN;
`;
const GROUND_VERTEX = `
vGroundN = normalize(mat3(modelMatrix) * objectNormal);
vDepth = aDepth;
vFloor = aFloor;
vEdge = aEdge;
`;
const GROUND_FRAGMENT_PARS = `
uniform vec3 uLush;
uniform vec3 uDry;
uniform vec3 uDamp;
uniform vec3 uEarth;
uniform vec3 uStone;
uniform vec3 uLitter;
uniform vec3 uMoss;
uniform vec3 uRows;
varying float vDepth;
varying float vFloor;
varying float vEdge;
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
// (27) vFloor > 0: a wood's floor, leaf litter and moss, ragged where it thins towards the hex's rim.
// vFloor < 0: a yard of trodden earth round a house.
float gWood = smoothstep(0.34, 0.62, vFloor + (gPatches - 0.5) * 0.55 + (gGrain - 0.5) * 0.2);
float gLeaf = texture2D(uNoise, gp * 3.7 + vec2(0.4, 0.9)).a;
vec3 gLitter = uLitter * (0.7 + 0.6 * gGrain) + vec3(0.05, 0.022, 0.0) * smoothstep(0.6, 0.75, gLeaf);
gLitter = mix(gLitter, uMoss * (0.75 + 0.5 * gFine), smoothstep(0.45, 0.7, gWear) * 0.8);
gTurf = mix(gTurf, gLitter, gWood);
// (28) vEdge: how much of a field of crops is here. Tilled soil in the rows' direction (the whole map's), greener
// along each row where the stalks stand; where it falls off towards a neighbour that is not crops, a headland
// of trodden earth and then turf.
float gField = smoothstep(0.3, 0.62, vEdge + (gGrain - 0.5) * 0.3);
float gRowAt = dot(gp, uRows.xy) / uRows.z;
float gFurrow = abs(fract(gRowAt) - 0.5) * 2.0;                       // 1 on a row, 0 in the furrow between
gFurrow = mix(0.5, gFurrow, 1.0 - smoothstep(0.3, 0.8, fwidth(gRowAt)));
vec3 gSoil = uEarth * (0.5 + 0.4 * gGrain) * (0.7 + 0.2 * gLeaf);
gSoil = mix(gSoil, uDry * (0.6 + 0.3 * gFine), smoothstep(0.35, 0.9, gFurrow) * 0.75);
gTurf = mix(gTurf, uEarth * (0.75 + 0.4 * gGrain), smoothstep(0.08, 0.3, vEdge) * (1.0 - gField) * 0.7);
gTurf = mix(gTurf, gSoil, gField);
float gYard = smoothstep(0.3, 0.62, -vFloor + (gPatches - 0.5) * 0.5) * 0.85;
gTurf = mix(gTurf, uEarth * (0.7 + 0.45 * gGrain) * (0.85 + 0.3 * gLeaf), gYard);
float gStrata = texture2D(uNoise, vec2((gp.x + gp.y) * 0.6, vMistPos.y * 2.2)).g;
float gGrit = texture2D(uNoise, vec2((gp.x - gp.y) * 2.3, vMistPos.y * 5.0)).a;
vec3 gEarth = mix(uEarth * 0.5, uEarth * 1.2, gStrata) * (0.65 + 0.7 * gGrit);
gEarth = mix(gEarth, uStone, smoothstep(0.74, 0.86, gGrit * 0.6 + gStrata * 0.4) * 0.7);
float gLip = 1.0 - smoothstep(0.035, 0.07 + 0.09 * gGrain, vDepth);
gEarth = mix(gEarth, gTurf * 0.6, gLip);
diffuseColor.rgb = mix(gTurf, gEarth, gSide);
float gRough = mix(mix(0.96, 0.42, gDamp), 0.92, max(max(gWorn * (1.0 - gDamp * 0.7), gSide), max(max(gWood, gYard), gField)));
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

/** (28) The rows of every field on a map: turned this far (radians) from running east-west, this far apart. */
export const ROWS = { turn: 0.32, apart: 0.105 };

// (28) Water: dark and still. `aEdge` is how near the bank is: there it is shallow, murky and, at the very edge, mud.
const WATER_VERTEX_PARS = 'attribute float aEdge;\nvarying float vEdge;\n';
const WATER_FRAGMENT_PARS = 'uniform vec3 uDeep;\nuniform vec3 uShallow;\nuniform vec3 uMud;\nuniform vec3 uSheen;\nuniform vec4 uFogBounds;\nvarying float vEdge;\n';
const WATER_COLOR = `
vec2 wp = vMistPos.xz;
float wSoft = texture2D(uNoise, wp * 0.31 + vec2(0.2, 0.6)).r;
float wGrain = texture2D(uNoise, wp * 1.9).b;
float wFine = texture2D(uNoise, wp * 5.1).a;
float wShore = smoothstep(0.2, 0.95, vEdge + (wGrain - 0.5) * 0.4);
float wMud = smoothstep(0.72, 0.98, vEdge + (wFine - 0.5) * 0.3);
vec3 wCol = mix(uDeep * (0.7 + 0.6 * wSoft), uShallow * (0.8 + 0.4 * wGrain), wShore * 0.85);
// Weed and scum in drifts on still water.
wCol = mix(wCol, uShallow * 1.3, smoothstep(0.7, 0.86, wSoft * 0.6 + wGrain * 0.4) * 0.35);
diffuseColor.rgb = mix(wCol, uMud * (0.7 + 0.6 * wFine), wMud);
float wRough = mix(mix(0.07, 0.22, wShore), 0.85, wMud);
// (28, second pass) The sheen: the sky of the moment given back by the surface, so that it reads as water from the
// board's height. The camera never turns and has no perspective, so a true mirror would be one flat tone: the
// sheen is instead brighter towards the far (north) side of the board, as a real reflection of a sky is, which
// is what makes the surface read as a plane. Ripples: long faint streaks across it, from the noise, seeded.
float wFar = 1.0 - clamp((vMistPos.z - uFogBounds.y - 5.0) / max(uFogBounds.w - uFogBounds.y - 10.0, 1.0), 0.0, 1.0);
vec2 wAlong = vec2(wp.x * 0.94 + wp.y * 0.34, wp.y * 0.94 - wp.x * 0.34);
float wRipple = texture2D(uNoise, wAlong * vec2(0.45, 3.6)).g;
float wRipple2 = texture2D(uNoise, wAlong * vec2(1.1, 9.0) + vec2(0.37, 0.11)).b;
float wStreak = smoothstep(0.52, 0.78, wRipple) * 0.55 + smoothstep(0.6, 0.85, wRipple2) * 0.3;
float wDrift = 0.8 + 0.4 * wSoft;
vec3 wSheen = uSheen * (0.62 + 0.62 * wFar) * wDrift * (0.82 + 0.5 * wStreak) * (1.0 - wMud) * (1.0 - 0.55 * wShore);
`;
const WATER_NORMAL = `
{
  vec3 wUp = normalize(vec3((wGrain - 0.5) * 0.07, 1.0, (wFine - 0.5) * 0.07));
  normal = normalize((viewMatrix * vec4(wUp, 0.0)).xyz);
}
`;

// (27) Foliage: the paint broken up leaf by leaf, from the noise read in three dimensions.
const LEAVES_COLOR = `
{
  float lfBig = texture2D(uNoise, vMistPos.xz * 1.9 + vMistPos.y * vec2(1.1, 1.7)).b;
  float lfSmall = texture2D(uNoise, vMistPos.xz * 5.3 + vMistPos.y * vec2(3.1, 2.3)).a;
  diffuseColor.rgb *= 0.62 + 0.42 * lfBig + 0.42 * lfSmall;
}
`;

// (27) Masonry: a house's surfaces, drawn from where a point is on its wall or roof (aMat: u, v in world
// units along and up the surface; kind). Kind 0..0.9 is a wall, the fraction how much render covers its
// stones; 1 a roof of slates or tiles in courses, mossy; 2 boards; 3 plain. Detail fades out when a course
// is under a pixel, so it does not shimmer at the opening zoom.
const MASONRY_VERTEX_PARS = 'attribute vec3 aMat;\nvarying vec3 vMat;\n';
const MASONRY_FRAGMENT_PARS = `
varying vec3 vMat;
float mHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;
const MASONRY_COLOR = `
{
  vec2 mUv = vMat.xy;
  float mKind = vMat.z;
  float mSoft = texture2D(uNoise, mUv * 0.9 + vMistPos.xz * 0.21).r;
  float mGrain = texture2D(uNoise, mUv * 4.3).a;
  vec3 mCol = diffuseColor.rgb;
  if (mKind < 0.95) {
    // Rubble stone in rough courses, the mortar pale; render over it where it has not fallen away.
    float mH = 0.046;
    float mRow = floor(mUv.y / mH);
    float mU = mUv.x / (mH * (1.5 + mHash(vec2(mRow, 3.0)))) + mHash(vec2(mRow, 7.0));
    vec2 mCell = vec2(floor(mU), mRow);
    vec2 mIn = vec2(fract(mU), fract(mUv.y / mH));
    float mSeen = 1.0 - smoothstep(0.35, 0.9, fwidth(mUv.y / mH));
    float mJoint = smoothstep(0.0, 0.1, mIn.x) * smoothstep(1.0, 0.9, mIn.x) * smoothstep(0.0, 0.16, mIn.y) * smoothstep(1.0, 0.84, mIn.y);
    vec3 mStone = mCol * (0.62 + 0.62 * mHash(mCell)) * mix(vec3(1.0), vec3(1.08, 0.98, 0.86), mHash(mCell + 9.0));
    mStone = mix(mCol * 0.86, mix(mCol * 1.25 + 0.03, mStone, mJoint), mSeen);
    float mCover = smoothstep(0.02, 0.2, mKind + (mSoft - 0.62) * 0.9 + (mGrain - 0.5) * 0.12);
    vec3 mRender = (mCol * 1.5 + vec3(0.07, 0.065, 0.05)) * (0.86 + 0.2 * mGrain);
    mCol = mix(mStone, mRender, mCover * step(0.01, mKind));
    // Weather: damp and moss rising from the ground, dark streaks down from the eaves.
    float mStreak = texture2D(uNoise, vec2(mUv.x * 2.6, mUv.y * 0.22)).g;
    mCol *= 1.0 - 0.38 * smoothstep(0.5, 0.8, mStreak) * smoothstep(0.1, 0.4, mUv.y);
    float mDamp = (1.0 - smoothstep(0.02, 0.16, mUv.y + (mSoft - 0.5) * 0.12));
    mCol = mix(mCol, vec3(0.045, 0.06, 0.03), mDamp * 0.7);
  } else if (mKind < 1.5) {
    // Courses up the slope, each slate a little its own colour, a dark line under each course; moss in drifts.
    float mH = 0.046;
    float mRow = floor(mUv.y / mH);
    float mU = mUv.x / 0.058 + mod(mRow, 2.0) * 0.5;
    vec2 mIn = vec2(fract(mU), fract(mUv.y / mH));
    float mSeen = 1.0 - smoothstep(0.35, 0.9, fwidth(mUv.y / mH));
    float mEach = mHash(vec2(floor(mU), mRow));
    vec3 mSlate = mCol * (0.8 + 0.4 * mEach);
    mSlate *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.22, mIn.y));
    mSlate *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.08, mIn.x));
    mSlate = mix(mCol * 0.9, mSlate, mSeen);
    mSlate = mix(mSlate, mCol * 0.35, step(0.99, mEach) * mSeen);            // a slipped slate, the batten dark behind
    float mMoss = smoothstep(0.52, 0.78, mSoft * 0.75 + mGrain * 0.25 + (0.35 - mUv.y) * 0.25);
    mCol = mix(mSlate, vec3(0.085, 0.12, 0.04) * (0.7 + 0.6 * mGrain), mMoss * 0.85);
    float mStreak = texture2D(uNoise, vec2(mUv.x * 3.1, mUv.y * 0.3)).g;
    mCol *= 1.0 - 0.25 * smoothstep(0.55, 0.85, mStreak);
  } else if (mKind < 2.5) {
    // Boards, the paint worn off them.
    float mB = mUv.x / 0.042;
    float mSeen = 1.0 - smoothstep(0.35, 0.9, fwidth(mB));
    float mGap = 1.0 - smoothstep(0.0, 0.1, fract(mB)) * smoothstep(1.0, 0.9, fract(mB));
    mCol *= (0.75 + 0.4 * mHash(vec2(floor(mB), 1.0))) * (0.8 + 0.4 * mGrain);
    mCol *= 1.0 - 0.6 * mGap * mSeen;
  } else {
    mCol *= 0.85 + 0.3 * mGrain;
  }
  diffuseColor.rgb = mCol;
}
`;
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
  water: THREE.Material;                     // (28) still water (`aEdge`: how near the bank)
  leaves: THREE.Material;                    // (27) trees and undergrowth (vertex colours, `aSurface`), mottled leaf by leaf
  masonry: THREE.Material;                   // (27) a house (vertex colours, `aSurface`, `aMat`: stone, render, slates, boards)
  coarse: boolean;                           // a phone (a coarse pointer): the cheap setting of every cost constant
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
      uEarth: { value: lin('#54432f') }, uLitter: { value: lin('#3d3122') }, uRows: { value: new THREE.Vector3(Math.sin(ROWS.turn), Math.cos(ROWS.turn), ROWS.apart) }, uMoss: { value: lin('#35472a') }, uStone: { value: lin('#8a8778') },
    });
    shader.vertexShader = GROUND_VERTEX_PARS + shader.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>${GROUND_VERTEX}`);
    shader.fragmentShader = GROUND_FRAGMENT_PARS + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>${GROUND_COLOR}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;\n')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${GROUND_NORMAL}`);
  };
  ground.customProgramCacheKey = () => 'diorama-ground';

  function painted(fade: number, side: THREE.Side = THREE.FrontSide, detail: 'none' | 'leaves' | 'masonry' = 'none'): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, side });
    const uFade = { value: new THREE.Vector4(...lin('#4b5a66').toArray(), fade) };
    m.onBeforeCompile = (shader) => {
      addMist(shader, uniforms);
      shader.uniforms.uFade = uFade;
      shader.vertexShader = PAINT_VERTEX_PARS + shader.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurface = aSurface;\n');
      shader.fragmentShader = PAINT_FRAGMENT_PARS + shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>${detail === 'leaves' ? LEAVES_COLOR : detail === 'masonry' ? MASONRY_COLOR : ''}\ndiffuseColor.rgb = mix(diffuseColor.rgb, uFade.rgb, uFade.a);\n`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vSurface.x;\n')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vSurface.y * (1.0 - uFade.a);\n');
      if (detail === 'masonry') {
        shader.vertexShader = MASONRY_VERTEX_PARS + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat;\n');
        shader.fragmentShader = MASONRY_FRAGMENT_PARS + shader.fragmentShader;
      }
    };
    m.customProgramCacheKey = () => `diorama-paint-${detail}`;
    return m;
  }
  const paint = painted(0, THREE.FrontSide);
  const faded = painted(0.8, THREE.FrontSide);
  const leaves = painted(0, THREE.FrontSide, 'leaves');
  const masonry = painted(0, THREE.FrontSide, 'masonry');
  const blades = painted(0, THREE.FrontSide);   // tiles.ts gives every blade both its faces, so both are lit from above

  // (28) Water: smooth enough to carry the sky the kit already renders for reflections, and a sheen of the dawn's sky.
  const waterSheen = { value: lin(AIR[2].sheen) };
  const fogBounds = { value: new THREE.Vector4(-1, -1, 1, 1) };     // the board's ground, shared with the mist's sheets
  const water = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.1, metalness: 0, envMapIntensity: 1.7 });
  water.onBeforeCompile = (shader) => {
    addMist(shader, uniforms, 0.3);
    Object.assign(shader.uniforms, { uDeep: { value: lin('#1b2931') }, uShallow: { value: lin('#565a3c') }, uMud: { value: lin('#5a4a34') }, uSheen: waterSheen, uFogBounds: fogBounds });
    shader.vertexShader = WATER_VERTEX_PARS + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;\n');
    shader.fragmentShader = WATER_FRAGMENT_PARS + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>${WATER_COLOR}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = wRough;\n')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += wSheen;\n')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${WATER_NORMAL}`);
  };
  water.customProgramCacheKey = () => 'diorama-water';

  const sea = new THREE.MeshLambertMaterial({ color: AIR[2].table });
  sea.onBeforeCompile = (shader) => addMist(shader, uniforms);
  sea.customProgramCacheKey = () => 'diorama-mist';

  // A lowpoly lit material, copied once and given the mist.
  const misted = new WeakMap<THREE.Material, THREE.Material>();
  const mine = new Set<THREE.Material>([ground, paint, faded, blades, leaves, masonry, water, sea]);
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
    uFogBounds: fogBounds,
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
    ground, blades, paint, faded, leaves, masonry, water, sea, mist, coarse,

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
      waterSheen.value.copy(col(a.sheen, b.sheen));
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
