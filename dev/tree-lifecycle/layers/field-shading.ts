// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * What custom layers of the film share with the sky, the ground and `TreeLayer`, so that everything
 * in a frame sits in one space: light in linear units, the same filmic curve at the end, shadows read
 * from deck's map the way `TreePhotorealPrimitiveLayer` reads them, and the air, which is the sky's
 * own color, so that anything lost in the distance meets the sky with no line.
 *
 * A layer that wants all of it:
 *
 *   class MyLayer extends FieldLayer<MyProps> {
 *     getShaders() {
 *       return super.getShaders({vs, fs, modules: [project32, lighting, fieldAir]});
 *     }
 *     draw({renderPass}) {
 *       const {model} = this.state;
 *       this.setFieldUniforms(model, this.props.air);
 *       model.draw(renderPass);
 *     }
 *   }
 *
 * with `air: getFieldAir(state)` from the factory. The chunks are plain GLSL for the layer's own
 * shaders to include. In the vertex stage: `FIELD_AIR_GLSL` if it wants the sky, and
 * `FIELD_SHADOW_VERTEX_GLSL` with `fieldShadowWrite(commonPosition)`, or `fieldShadowAtVertex` for one
 * read per vertex. In the fragment stage: `FIELD_LIGHT_GLSL`, `FIELD_AIR_GLSL`, and
 * `getFieldShadowFragment(taps)` for `fieldShadow()`. Common space is metres in this film, as
 * everything is Cartesian around the origin.
 */

import {Layer, type LayerProps, type UpdateParameters} from '@deck.gl/core';
import type {Texture} from '@luma.gl/core';
import type {Model} from '@luma.gl/engine';
import {getContentSeconds} from '../story/beats';
import {getFloodDay, getFloodTraces, getSecondUncovered} from '../story/flood';
import {BED_LAYOUT, LAND_GLSL} from '../story/land';
import {clamp01, smoothstep} from '../story/story-math';
import type {StoryState, Vec3} from '../story/story-types';

/** One vec4 each, in the order of the `fieldAir` uniform block. */
export type FieldAir = {
  /** Unit vector toward the sun, and its elevation in radians. */
  sun: [number, number, number, number];
  /** Unit vector toward the moon, and how much its light leads, 0-1. */
  moon: [number, number, number, number];
  /** Aerosol optical depth at 550 nm, Mie g, star visibility, and how hazy, 0-1. */
  haze: [number, number, number, number];
  /** What many scatterings add to the air: light, as a color, and the sun's strength in the sky. */
  multi: [number, number, number, number];
  /** The moonlit night sky near the horizon, linear, and the horizon's depth in optical terms. */
  night: [number, number, number, number];
  /** Storm 0-1, eye 0-1, how much cloud has taken over the horizon 0-1, cloud cover 0-1. */
  weather: [number, number, number, number];
  /** Unit vector toward the flash this instant, and how bright, 0-1. */
  flash: [number, number, number, number];
  /** `state.fog`: color as linear light ahead of the filmic curve, and density per metre. */
  fog: [number, number, number, number];
  /** Story second, a 0-1 seed for dither and taps that differs by sub-frame, the tangent of the sun's radius for the penumbra, and one unused. */
  clock: [number, number, number, number];
};

const FIELD_AIR_DECLARATION = /* glsl */ `layout(std140) uniform fieldAirUniforms {
  vec4 sun;
  vec4 moon;
  vec4 haze;
  vec4 multi;
  vec4 night;
  vec4 weather;
  vec4 flash;
  vec4 fog;
  vec4 clock;
} fieldAir;`;

/** The sky's state for any layer of the film. Set with `FieldLayer.setFieldUniforms`. */
export const fieldAir = {
  name: 'fieldAir',
  vs: FIELD_AIR_DECLARATION,
  fs: FIELD_AIR_DECLARATION,
  uniformTypes: {
    sun: 'vec4<f32>',
    moon: 'vec4<f32>',
    haze: 'vec4<f32>',
    multi: 'vec4<f32>',
    night: 'vec4<f32>',
    weather: 'vec4<f32>',
    flash: 'vec4<f32>',
    fog: 'vec4<f32>',
    clock: 'vec4<f32>'
  }
} as const;

/**
 * Linear light that `fieldFilmic` turns into this sRGB color, each 0-255, so that a surface lost in fog
 * shows exactly the color asked for. The same as `TreeLayer` does for its `fog`.
 */
export function getFieldLinearLight(color: ArrayLike<number>): [number, number, number] {
  const channel = (value: number): number => {
    // The inverse of Narkowicz's fit: y (2.43 x^2 + 0.59 x + 0.14) = 2.51 x^2 + 0.03 x, for linear display y.
    const y = Math.min(0.999, Math.pow(clamp01(value / 255), 2.2));
    const a = 2.51 - 2.43 * y;
    const b = 0.03 - 0.59 * y;
    const c = -0.14 * y;
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  };
  return [channel(color[0]), channel(color[1]), channel(color[2])];
}

/** Sun elevations in radians that many scatterings fade over, and what they bring at full strength. */
const MULTI_SCATTER = {
  fade: [-0.21, 0.14] as const,
  color: [0.62, 0.76, 1.0] as const,
  strength: 0.42
};
/** The sun's strength in the sky's sums: not a real one, but what puts the sky under the key light. */
const SKY_SUN_STRENGTH = 15;
/** Linear light of a moonlit sky near the horizon. */
const NIGHT_SKY: readonly [number, number, number] = [0.014, 0.019, 0.036];
/** Sun elevations in radians that night comes on over. */
const NIGHT_FADE = [-0.05, -0.2] as const;
/** The fraction of a sun of 0.9 degrees the shadow's penumbra takes at a single sample. */
const PENUMBRA_SHARE = 0.6;
/** How cloud cover takes over the horizon. */
const OVERCAST_COVER = [0.55, 0.98] as const;

/** Optical depth of aerosol at 550 nm for a Linke-like turbidity. */
export function getAerosolDepth(turbidity: number): number {
  return 0.042 * Math.pow(Math.max(turbidity - 1, 0.1), 1.4);
}

const AIR_CACHE = new WeakMap<object, FieldAir>();

/** `fieldAir`'s values for a frame. */
export function getFieldAir(state: StoryState): FieldAir {
  let air = AIR_CACHE.get(state);
  if (!air) {
    air = createFieldAir(state);
    AIR_CACHE.set(state, air);
  }
  return air;
}

function createFieldAir(state: StoryState): FieldAir {
  const {sky, fog, key, flash} = state;
  const elevation = Math.asin(sky.sunDirection[2]);
  const moonLead = clamp01(smoothstep(NIGHT_FADE[0], NIGHT_FADE[1], elevation));
  const multi =
    smoothstep(MULTI_SCATTER.fade[0], MULTI_SCATTER.fade[1], elevation) * MULTI_SCATTER.strength;
  const fogLight = getFieldLinearLight(fog.color);
  const overcast = smoothstep(OVERCAST_COVER[0], OVERCAST_COVER[1], sky.cloudCover) * (1 - sky.eye);
  const moonUp = smoothstep(-0.02, 0.2, sky.moonDirection[2]);
  const nightLight = 0.55 + 0.45 * moonUp;
  // A flash lights from where its directional light comes.
  const flashLength = Math.hypot(flash.direction[0], flash.direction[1], flash.direction[2]) || 1;
  // Hashed from the story second, which an accumulator's shutter moves, so noise differs by sub-frame.
  const seed = (Math.abs(Math.sin(state.t * 91.7 + 1.3)) * 43758.5453) % 1;
  return {
    sun: [sky.sunDirection[0], sky.sunDirection[1], sky.sunDirection[2], elevation],
    moon: [sky.moonDirection[0], sky.moonDirection[1], sky.moonDirection[2], moonLead],
    haze: [getAerosolDepth(sky.turbidity), 0.8, sky.stars, clamp01((sky.turbidity - 2) / 4)],
    multi: [
      MULTI_SCATTER.color[0] * multi,
      MULTI_SCATTER.color[1] * multi,
      MULTI_SCATTER.color[2] * multi,
      SKY_SUN_STRENGTH
    ],
    night: [
      NIGHT_SKY[0] * nightLight * moonLead,
      NIGHT_SKY[1] * nightLight * moonLead,
      NIGHT_SKY[2] * nightLight * moonLead,
      0
    ],
    weather: [sky.storm, sky.eye, Math.max(overcast, sky.storm * (1 - sky.eye)), sky.cloudCover],
    flash: [
      -flash.direction[0] / flashLength,
      -flash.direction[1] / flashLength,
      -flash.direction[2] / flashLength,
      sky.flash
    ],
    fog: [fogLight[0], fogLight[1], fogLight[2], fog.density],
    clock: [
      state.t,
      seed,
      Math.tan((Math.max(key.softness, 0.27) * PENUMBRA_SHARE * Math.PI) / 180),
      0
    ]
  };
}

/**
 * The fragment stage's light, the same as `TREE_PHOTOREAL_FRAGMENT_CHUNK`: standard lights decoded to
 * linear, sky above and bounce below, and the filmic curve at the end.
 */
export const FIELD_LIGHT_GLSL = /* glsl */ `
// Standard deck.gl lights mean sRGB colors times intensity. Keep the intensity linear, and decode only
// the hue, so a warm low sun or a blue night stays the color it was given.
vec3 fieldLightColor(vec3 color) {
  float level = max(max(color.r, color.g), max(color.b, 1e-4));
  return pow(color / level, vec3(2.2)) * level;
}

vec3 fieldFilmic(vec3 x) {
  // Narkowicz's fit to the ACES curve, then display encoding.
  x = max(x, vec3(0.0));
  vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  return pow(mapped, vec3(1.0 / 2.2));
}

// Interleaved gradient noise, 0-1, stable per pixel, and new with each sub-frame's seed.
float fieldPixelNoise(vec2 pixel) {
  vec2 moved = pixel + 47.0 * fieldAir.clock.y;
  return fract(52.9829189 * fract(dot(moved, vec2(0.06711056, 0.00583715))));
}

// A little noise ahead of 8 bits, so the sky's long gradients do not band, then or in the average.
vec3 fieldDither(vec3 color, vec2 pixel) {
  float a = fieldPixelNoise(pixel);
  float b = fieldPixelNoise(pixel.yx + 17.0);
  return color + (a + b - 1.0) / 255.0;
}
`;

/**
 * The clear air's color by direction: single scattering of the sun through the real shape of the
 * atmosphere, Rayleigh and aerosol, with ozone, an analytic optical depth toward the sun and a planet in
 * the way of it. So sunrise has its warm band and a cool side opposite, and twilight its Earth's
 * shadow, from the same sums as noon. `fieldHorizon` is what anything lost in the distance turns into.
 */
export const FIELD_AIR_GLSL = /* glsl */ `
const float FIELD_PLANET = 6371000.0;
const float FIELD_AIR_TOP = 6471000.0;
const float FIELD_RAYLEIGH_HEIGHT = 8000.0;
const float FIELD_AEROSOL_HEIGHT = 1500.0;
const vec3 FIELD_RAYLEIGH = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const vec3 FIELD_OZONE = vec3(0.65e-6, 1.881e-6, 0.085e-6);
// Aerosol optical depth by wavelength against 550 nm.
const vec3 FIELD_AEROSOL_TINT = vec3(0.78, 1.0, 1.3);
const int FIELD_AIR_STEPS = 8;
// How high above the horizon a direction is taken to look when it looks at the horizon.
const float FIELD_HORIZON_Z = 0.004;

// Optical depth per unit of sea-level density, out to the top of the air from radius r at cos zenith mu.
// Bruneton's analytic form.
float fieldAirPath(float height, float r, float mu) {
  float a = sqrt(0.5 / height * r) * mu;
  float aSquared = a * a;
  float y = (a < 0.0 ? -1.0 : 1.0) / (2.3193 * abs(a) + sqrt(1.52 * aSquared + 4.0));
  float x = a < 0.0 ? exp(min(aSquared, 40.0)) : 0.0;
  return sqrt(6.2831 * height * r) * exp((FIELD_PLANET - r) / height) * (x + y);
}

// How much of a light gets from straight along mu, at radius r, to this point. The planet takes it at
// its horizon, softly as the sun's a disc.
vec3 fieldAirThrough(float r, float mu) {
  float horizon = -sqrt(max((r - FIELD_PLANET) * (r + FIELD_PLANET), 0.0)) / r;
  float clear = smoothstep(horizon - 0.0045, horizon + 0.0045, mu);
  if (clear <= 0.0) return vec3(0.0);
  float safe = max(mu, horizon - 0.0045);
  float rayleigh = fieldAirPath(FIELD_RAYLEIGH_HEIGHT, r, safe);
  float aerosol = fieldAirPath(FIELD_AEROSOL_HEIGHT, r, safe);
  // Ozone: its whole column, along about the air mass of the Rayleigh path.
  float airMass = rayleigh * exp((r - FIELD_PLANET) / FIELD_RAYLEIGH_HEIGHT) / FIELD_RAYLEIGH_HEIGHT;
  float aerosolBeta = fieldAir.haze.x / FIELD_AEROSOL_HEIGHT;
  vec3 depth = FIELD_RAYLEIGH * rayleigh +
    FIELD_AEROSOL_TINT * aerosolBeta * 1.08 * aerosol +
    FIELD_OZONE * 15000.0 * airMass;
  return exp(-depth) * clear;
}

// The clear sky's light toward a direction above the horizon, in parts that only need their phase to be
// light. The parts are smooth enough to work out at the corners of a coarse grid, and the phase, which has the
// sun's sharp glow in it, for each pixel.
void fieldAirParts(vec3 direction, out vec3 rayleigh, out vec3 aerosol, out vec3 other) {
  vec3 sun = fieldAir.sun.xyz;
  float cosine = dot(direction, sun);
  vec3 aerosolBeta = FIELD_AEROSOL_TINT * fieldAir.haze.x / FIELD_AEROSOL_HEIGHT;

  float r0 = FIELD_PLANET + 2.0;
  float mu0 = max(direction.z, 1e-3);
  float reach = sqrt((FIELD_AIR_TOP - r0) * (FIELD_AIR_TOP + r0) + r0 * r0 * mu0 * mu0) - r0 * mu0;

  rayleigh = vec3(0.0);
  aerosol = vec3(0.0);
  other = vec3(0.0);
  vec3 through = vec3(1.0);
  float last = 0.0;
  for (int i = 0; i < FIELD_AIR_STEPS; i++) {
    float u = float(i + 1) / float(FIELD_AIR_STEPS);
    float next = reach * u * u;
    float t = 0.5 * (last + next);
    float step = next - last;
    last = next;
    float r = sqrt(r0 * r0 + 2.0 * r0 * mu0 * t + t * t);
    float height = r - FIELD_PLANET;
    float rayleighDensity = exp(-height / FIELD_RAYLEIGH_HEIGHT);
    float aerosolDensity = exp(-height / FIELD_AEROSOL_HEIGHT);
    float ozoneDensity = max(1.0 - abs(height - 25000.0) / 15000.0, 0.0);
    vec3 rayleighHere = FIELD_RAYLEIGH * rayleighDensity;
    vec3 aerosolHere = aerosolBeta * aerosolDensity;
    vec3 extinction = rayleighHere + aerosolHere * 1.08 + FIELD_OZONE * ozoneDensity;
    float sunMu = (r0 * sun.z + t * cosine) / r;
    vec3 sunlight = fieldAirThrough(r, sunMu) * fieldAir.multi.w;
    vec3 fade = exp(-extinction * step);
    vec3 share = through * (1.0 - fade) / max(extinction, vec3(1e-9));
    rayleigh += share * rayleighHere * sunlight;
    aerosol += share * aerosolHere * sunlight;
    other += share * (rayleighHere + aerosolHere) * fieldAir.multi.rgb;
    through *= fade;
  }
  // The moon's sky, a little brighter toward the horizon and toward the moon.
  if (fieldAir.moon.w > 0.0) {
    float moonward = max(dot(direction, fieldAir.moon.xyz), 0.0);
    float low = pow(1.0 - clamp(direction.z, 0.0, 1.0), 3.0);
    other += fieldAir.night.rgb * (0.38 + 0.62 * low + 0.5 * pow(moonward, 8.0));
  }
}

// Those parts as light toward this direction.
vec3 fieldAirLight(vec3 direction, vec3 rayleigh, vec3 aerosol, vec3 other) {
  float cosine = dot(direction, fieldAir.sun.xyz);
  float cosine2 = cosine * cosine;
  float g = fieldAir.haze.y;
  float g2 = g * g;
  float rayleighPhase = 0.0596831 * (1.0 + cosine2);
  float aerosolPhase = 0.1193662 * (1.0 - g2) * (1.0 + cosine2) /
    ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * cosine, 1e-5), 1.5));
  return rayleigh * rayleighPhase + aerosol * aerosolPhase * 0.3 + other;
}

vec3 fieldAtmosphere(vec3 direction) {
  vec3 rayleigh;
  vec3 aerosol;
  vec3 other;
  fieldAirParts(direction, rayleigh, aerosol, other);
  return fieldAirLight(direction, rayleigh, aerosol, other);
}

// A look along this direction at the horizon.
vec3 fieldHorizonDirection(vec3 direction) {
  float across = max(length(direction.xy), 1e-5);
  float side = sqrt(1.0 - FIELD_HORIZON_Z * FIELD_HORIZON_Z) / across;
  return vec3(direction.xy * side, FIELD_HORIZON_Z);
}

// What everything far off turns into along this direction, and what the sky comes down to.
vec3 fieldHorizon(vec3 direction) {
  float taken = fieldAir.weather.z;
  vec3 clear = taken < 0.999 ? fieldAtmosphere(fieldHorizonDirection(direction)) : vec3(0.0);
  return mix(clear, fieldAir.fog.rgb, taken);
}

// How much of a surface this far off gets through the air, by state.fog, and all of it gone at the end of
// the ground's mesh, so that ground meets sky with no line.
float fieldAirVisibility(float metres) {
  float density = max(fieldAir.fog.w, 0.00012);
  return exp(-density * metres) * (1.0 - smoothstep(3200.0, 5800.0, metres));
}
`;

/** The field's layout, for the ground and the grass, which must agree on it. Vec4s, as `fieldPlan`. */
export type FieldPlan = {
  /** Metres between lines of trees, metres between trees, half the block of real trees, x and y. */
  rows: [number, number, number, number];
  /** How far the rows have spread, how settled they are, and two unused. */
  reach: [number, number, number, number];
};

const FIELD_PLAN_DECLARATION = /* glsl */ `layout(std140) uniform fieldPlanUniforms {
  vec4 rows;
  vec4 reach;
} fieldPlan;`;

/** The rows on the ground, for any layer that needs to know where the strips are. */
export const fieldPlan = {
  name: 'fieldPlan',
  vs: FIELD_PLAN_DECLARATION,
  fs: FIELD_PLAN_DECLARATION,
  uniformTypes: {rows: 'vec4<f32>', reach: 'vec4<f32>'}
} as const;

/** `fieldPlan`'s values for a frame. */
export function getFieldPlan(state: StoryState): FieldPlan {
  const {spacing, treeSpacing, extent, reach, strength} = state.ground.rows;
  return {
    rows: [spacing, treeSpacing, extent[0], extent[1]],
    reach: [reach, strength, 0, 0]
  };
}

/**
 * Where grass grows, and the land it grows on: `LAND_GLSL`'s beds and furrows, so the ground, the
 * blades and the far rows stand on one land. All of it is a function of the world's xy, so the ground
 * and the blades agree, and it holds still whatever the camera does. Noise here is hashed from cell
 * coordinates alone.
 */
export const FIELD_PLAN_GLSL = /* glsl */ `
float fieldHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

vec2 fieldHash2(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

// Value noise, 0-1, and its gradient in the units of p.
vec3 fieldNoised(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = p - cell;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = fieldHash(cell);
  float b = fieldHash(cell + vec2(1.0, 0.0));
  float c = fieldHash(cell + vec2(0.0, 1.0));
  float d = fieldHash(cell + vec2(1.0, 1.0));
  float k = a - b - c + d;
  return vec3(
    a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y,
    du * vec2(b - a + k * u.y, c - a + k * u.x)
  );
}

float fieldNoise(vec2 p) {
  return fieldNoised(p).x;
}

// Noise at a scale that may be any size, as what a pixel covers is: two octaves of powers of two, by how
// close it is to each. Scaling one noise by a varying amount would smear it around the eye.
float fieldNoiseScaled(vec2 p, float scale, float seed) {
  float level = log2(max(scale, 1e-5) / 0.001);
  float low = floor(level);
  float f = level - low;
  float a = fieldNoise(p / (0.001 * pow(2.0, low)) + low * 3.17 + seed);
  float b = fieldNoise(p / (0.001 * pow(2.0, low + 1.0)) + (low + 1.0) * 3.17 + seed);
  // Mixed noise loses contrast midway, so give it back.
  float mixed = mix(a, b, f);
  return 0.5 + (mixed - 0.5) * (1.0 + 0.5 * (1.0 - abs(2.0 * f - 1.0)));
}

${LAND_GLSL}

// How much of the grove's layout has come this far from the hero, 0-1.
float fieldRowsHere(float fromHero) {
  float reach = fieldPlan.reach.x;
  return fieldPlan.reach.y * (1.0 - smoothstep(reach * 0.75, reach, fromHero));
}

// The share of a width of y that lies in strips of half-width w around each line of trees: a box filter
// of the pulse train, so that the rows run together far off into their average and never shimmer.
float fieldStripShare(float y, float width, float w) {
  float period = fieldPlan.rows.x;
  float half_ = 0.5 * max(width, 1e-4);
  float a = y - half_ + 0.5 * period;
  float b = y + half_ + 0.5 * period;
  float low = 0.5 * period - w;
  float high = 0.5 * period + w;
  float fa = floor(a / period) * 2.0 * w + clamp(a - floor(a / period) * period, low, high) - low;
  float fb = floor(b / period) * 2.0 * w + clamp(b - floor(b / period) * period, low, high) - low;
  return (fb - fa) / (b - a);
}

// How bare it is, 0-1, along a line of trees: the herbicide strip, which wanders a little by hand.
float fieldStrip(vec2 p, float width) {
  float wander = (fieldNoise(p * 0.45 + 3.1) - 0.5) * 0.5 + (fieldNoise(p * 1.9 + 7.7) - 0.5) * 0.22;
  float edge = max(width, 0.22);
  return clamp(fieldStripShare(p.y + wander * (1.0 - smoothstep(0.3, 2.0, width)), edge, 1.72), 0.0, 1.0);
}

// A 0-1 noise, about even, that clumps of grass are a threshold of.
float fieldTufts(vec2 p, float scale) {
  return smoothstep(0.2, 0.8, fieldNoiseScaled(p, scale, 3.3) * 0.62 + fieldNoiseScaled(p, scale * 2.7, 9.1) * 0.38);
}

// The same clumps from fixed scales, for a vertex that cannot afford to blend them.
float fieldTuftsFixed(vec2 p, float scale) {
  return smoothstep(0.2, 0.8, fieldNoise(p / scale + 3.3) * 0.62 + fieldNoise(p / (scale * 2.7) + 9.1) * 0.38);
}

// How much of a key light a crowd of blades takes, seen from a distance, for a sun at this height: tops
// from above, and flats that stand up to a low sun. The ground's lawn and the blades agree on it.
float fieldLawnLight(float keyUp) {
  return 0.46 * keyUp + 0.3 * sqrt(max(1.0 - keyUp * keyUp, 0.0));
}

// How much of an old field is grass here, before there are rows: thin near the hero and thicker with distance.
float fieldWildCover(vec2 p, float fromHero) {
  float patches = fieldNoise(p * 0.11 + 11.3) * 0.52 + fieldNoise(p * 0.47 + 2.9) * 0.3 + fieldNoise(p * 2.1) * 0.18;
  float wild = mix(0.1, 0.32 + 0.4 * smoothstep(0.3, 0.7, patches), smoothstep(5.0, 26.0, fromHero));
  wild *= smoothstep(1.6, 4.0, fromHero);
  return mix(wild, 0.72, smoothstep(60.0, 500.0, fromHero));
}

// A point to lay a pattern by on a furrow's banks: along the land's own surface across it rather than across
// its plan, so a pattern is not drawn out down a bank. It is p itself past the zone, and on the crossing, which
// is flat or slopes along it; it jumps only at the centre line, under the ribbon.
vec2 fieldFurrowPlace(vec2 p) {
  float u = fieldFurrowU(p);
  float across = abs(u);
  if (across >= FIELD_LAND_ZONE) return p;
  vec2 surface = vec2(p.x, p.y - u + (u < 0.0 ? -1.0 : 1.0) * fieldFurrowArc(across));
  return mix(surface, p, clamp(fieldCrossing(p), 0.0, 1.0));
}

// How much grass a furrow lets grow, 0-1: none on its floor or low on its banks, where the water stands; a
// ragged grass line part way up each bank, wandering at every scale along it, so no edge of it runs straight;
// the bank above it grassed but for slumps and rain cuts; the bed's grass on its shoulders and over the
// crossing; and on the crossing's ramps, sandy fill grassed in patches, thinner down toward the pipe. Its
// patches are laid along the bank's own surface, so none is drawn out down the slope.
float fieldFurrowCover(vec2 p) {
  float u = fieldFurrowU(p);
  float across = abs(u);
  if (across >= FIELD_LAND_ZONE + 0.2) return 1.0;
  float side = u < 0.0 ? 17.0 : 0.0;
  vec2 q = fieldFurrowPlace(p);
  float wander = (fieldNoise(vec2(p.x * 0.31, side)) - 0.5) * 0.16 + (fieldNoise(vec2(p.x * 1.1, side + 5.0)) - 0.5) * 0.1 +
    (fieldNoise(vec2(p.x * 3.7, side + 9.0)) - 0.5) * 0.06 + (fieldNoise(q * 9.0 + side) - 0.5) * 0.05;
  float a = across + wander;
  float crossing = fieldCrossing(p);
  // The grass line, about 20 cm over the ribbon, and a few tufts below it.
  float line = FIELD_LAND_HALF_FLOOR + 0.26;
  float banks = mix(0.05, 0.88, smoothstep(line - 0.04, line + 0.05, a));
  float slumps = smoothstep(0.6, 0.78, fieldNoise(q * 1.6 + 23.0 + side) * 0.7 + fieldNoise(q * 4.9 + 7.0) * 0.3);
  banks *= 1.0 - 0.55 * slumps * (1.0 - smoothstep(FIELD_LAND_HALF_TOP, FIELD_LAND_LIP_END + 0.1, across));
  float cover = mix(banks, 1.0, smoothstep(FIELD_LAND_HALF_TOP - 0.06, FIELD_LAND_ZONE, a));
  if (crossing <= 0.0) return cover;
  float fill = smoothstep(0.2, 0.52, fieldNoise(p * 2.3 + 51.0) * 0.7 + fieldNoise(p * 7.9 + 3.0) * 0.3) * smoothstep(0.1, 0.45, crossing);
  return crossing >= 1.0 ? 1.0 : max(mix(cover, 0.0, crossing), 0.9 * fill);
}

// How much grass there is here, 0-1: mowed middles once there are rows, and before that an old field. In the
// bed middles it is thin along the tires' two tracks, and bare in a place or two; nothing drives the
// furrow side of a row.
float fieldGrassCover(vec2 p, float width) {
  float fromHero = length(p);
  float rows = fieldRowsHere(fromHero);
  float cover = rows < 1.0 ? fieldWildCover(p, fromHero) : 0.0;
  if (rows > 0.0) {
    float tracks = fieldStripShare(p.y + 0.5 * fieldPlan.rows.x + 1.0, max(width, 0.5), 0.3) +
      fieldStripShare(p.y + 0.5 * fieldPlan.rows.x - 1.0, max(width, 0.5), 0.3);
    tracks *= smoothstep(0.2, 0.3, abs(fieldFurrowU(p)) / FIELD_LAND_BED_SPACING);
    float middles = (1.0 - fieldStrip(p, width)) * (1.0 - 0.22 * tracks) *
      (0.93 + 0.07 * smoothstep(0.3, 0.55, fieldNoise(p * 0.47 + 2.9)));
    cover = mix(cover, middles, rows);
  }
  return cover * fieldFurrowCover(p);
}
`;

/** The flood as the ground and the grass read it. Vec4s, as `fieldFlood`. */
export type FieldFlood = {
  /** Level, high-water mark, calm and foam, as `StoryFlood`. */
  water: [number, number, number, number];
  /** Silt, how much floats, the content second, and the calendar day since the hurricane came. */
  more: [number, number, number, number];
  /** How much is left of the flood's other traces on the land, as `getFloodTraces`, and three unused. */
  marks: [number, number, number, number];
  /** Heights of the recession's knots, highest first, four and four. */
  levelsA: [number, number, number, number];
  levelsB: [number, number, number, number];
  /** The cycle second the falling water left each knot's height. */
  secondsA: [number, number, number, number];
  secondsB: [number, number, number, number];
  /** The same as calendar days since the hurricane came. */
  daysA: [number, number, number, number];
  daysB: [number, number, number, number];
};

const FIELD_FLOOD_DECLARATION = /* glsl */ `layout(std140) uniform fieldFloodUniforms {
  vec4 water;
  vec4 more;
  vec4 marks;
  vec4 levelsA;
  vec4 levelsB;
  vec4 secondsA;
  vec4 secondsB;
  vec4 daysA;
  vec4 daysB;
} fieldFlood;`;

/** The flood, for the ground and the grass, which must agree on where the water stood and when it went. */
export const fieldFlood = {
  name: 'fieldFlood',
  vs: FIELD_FLOOD_DECLARATION,
  fs: FIELD_FLOOD_DECLARATION,
  uniformTypes: {
    water: 'vec4<f32>',
    more: 'vec4<f32>',
    marks: 'vec4<f32>',
    levelsA: 'vec4<f32>',
    levelsB: 'vec4<f32>',
    secondsA: 'vec4<f32>',
    secondsB: 'vec4<f32>',
    daysA: 'vec4<f32>',
    daysB: 'vec4<f32>'
  }
} as const;

/**
 * Heights the recession is told by, highest first: the peak, the bed crowns, the rows, the low east
 * end, the shoulders, half way down the banks, and the ribbon.
 */
const RECESSION_HEIGHTS = [0.09, 0.06, 0.03, 0, -0.03, -0.1, -0.35, BED_LAYOUT.ribbonZ] as const;

let recession: {levels: number[]; seconds: number[]; days: number[]} | null = null;

/** When the falling water left each of `RECESSION_HEIGHTS`, in cycle seconds and calendar days. */
function getRecession(): {levels: number[]; seconds: number[]; days: number[]} {
  if (!recession) {
    const seconds = RECESSION_HEIGHTS.map(height => getSecondUncovered(height));
    recession = {levels: [...RECESSION_HEIGHTS], seconds, days: seconds.map(getFloodDay)};
  }
  return recession;
}

const FLOOD_CACHE = new WeakMap<object, FieldFlood>();

/** `fieldFlood`'s values for a frame. */
export function getFieldFlood(state: StoryState): FieldFlood {
  let values = FLOOD_CACHE.get(state);
  if (!values) {
    const {flood, silt} = state.ground;
    const content = getContentSeconds(state.t, state.cycle.world);
    const {levels, seconds, days} = getRecession();
    const four = (list: number[], from: number) =>
      list.slice(from, from + 4) as [number, number, number, number];
    values = {
      water: [flood.level, flood.mark, flood.calm, flood.foam],
      more: [silt, flood.floating, content, getFloodDay(content)],
      marks: [getFloodTraces(content), 0, 0, 0],
      levelsA: four(levels, 0),
      levelsB: four(levels, 4),
      secondsA: four(seconds, 0),
      secondsB: four(seconds, 4),
      daysA: four(days, 0),
      daysB: four(days, 4)
    };
    FLOOD_CACHE.set(state, values);
  }
  return values;
}

/**
 * The flood in GLSL, after `fieldFlood`'s declaration: `fieldUncovered(height)`, the cycle second
 * and the calendar day the falling water left land at a height, between the recession's knots.
 */
export const FIELD_FLOOD_GLSL = /* glsl */ `
vec2 fieldUncovered(float height) {
  float levels[8] = float[8](
    fieldFlood.levelsA.x, fieldFlood.levelsA.y, fieldFlood.levelsA.z, fieldFlood.levelsA.w,
    fieldFlood.levelsB.x, fieldFlood.levelsB.y, fieldFlood.levelsB.z, fieldFlood.levelsB.w
  );
  float seconds[8] = float[8](
    fieldFlood.secondsA.x, fieldFlood.secondsA.y, fieldFlood.secondsA.z, fieldFlood.secondsA.w,
    fieldFlood.secondsB.x, fieldFlood.secondsB.y, fieldFlood.secondsB.z, fieldFlood.secondsB.w
  );
  float days[8] = float[8](
    fieldFlood.daysA.x, fieldFlood.daysA.y, fieldFlood.daysA.z, fieldFlood.daysA.w,
    fieldFlood.daysB.x, fieldFlood.daysB.y, fieldFlood.daysB.z, fieldFlood.daysB.w
  );
  if (height >= levels[0]) return vec2(seconds[0], days[0]);
  for (int i = 1; i < 8; i++) {
    if (height >= levels[i]) {
      float share = (levels[i - 1] - height) / max(levels[i - 1] - levels[i], 1e-6);
      return vec2(mix(seconds[i - 1], seconds[i], share), mix(days[i - 1], days[i], share));
    }
  }
  return vec2(seconds[7], days[7]);
}
`;

/** deck's packed depth, for both stages. */
const FIELD_SHADOW_COMMON_GLSL = /* glsl */ `
#ifdef MODULE_SHADOW
uniform sampler2D fieldShadowMap;
const vec4 FIELD_SHADOW_UNPACK = vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0);
#endif
`;

/**
 * The vertex stage of per-pixel shadows: `fieldShadowWrite(vec4(commonPosition, 1.0))`. It also has
 * `fieldShadowAtVertex(commonPosition, seed)`, for surfaces too thin to read per pixel.
 */
export const FIELD_SHADOW_VERTEX_GLSL = /* glsl */ `
${FIELD_SHADOW_COMMON_GLSL}
out vec3 vFieldShadow;
flat out vec3 vFieldShadowScale;

#ifdef MODULE_SHADOW
vec3 fieldShadowPlace(vec4 commonPosition) {
  vec4 position = project_common_position_to_clipspace(
    commonPosition,
    shadow.viewProjectionMatrix0,
    shadow.projectCenter0
  );
  return (position.xyz / position.w + 1.0) * 0.5;
}

// Metres across a texel of the map, along its two axes, and map depth per metre.
vec3 fieldShadowScale() {
  mat4 light = shadow.viewProjectionMatrix0;
  vec2 size = vec2(textureSize(fieldShadowMap, 0));
  vec2 axis = vec2(
    length(vec3(light[0].x, light[1].x, light[2].x)),
    length(vec3(light[0].y, light[1].y, light[2].y))
  );
  return vec3(2.0 / (axis * size), 0.5 * length(vec3(light[0].z, light[1].z, light[2].z)));
}

void fieldShadowWrite(vec4 commonPosition) {
  vFieldShadow = fieldShadowPlace(commonPosition);
  vFieldShadowScale = fieldShadowScale();
}

// How lit a point is, from a few texels around a place offset by a seed, 0-1, read once per vertex.
float fieldShadowAtVertex(vec4 commonPosition, float seed, int taps) {
  vec3 place = fieldShadowPlace(commonPosition);
  if (place.x <= 0.0 || place.y <= 0.0 || place.x >= 1.0 || place.y >= 1.0) return 1.0;
  ivec2 size = textureSize(fieldShadowMap, 0);
  vec3 scale = fieldShadowScale();
  float depth = place.z - 0.02 * scale.z;
  vec2 middle = place.xy * vec2(size) - 0.5;
  float angle = seed * 44.0;
  vec2 reach = vec2(cos(angle), sin(angle)) * 1.1;
  float lit = 0.0;
  for (int i = 0; i < taps; i++) {
    vec2 at = middle + reach;
    reach = vec2(-reach.y, reach.x);
    ivec2 texel = clamp(ivec2(floor(at + 0.5)), ivec2(0), size - 1);
    lit += depth <= dot(texelFetch(fieldShadowMap, texel, 0), FIELD_SHADOW_UNPACK) ? 1.0 : 0.0;
  }
  return lit / float(taps);
}
#else
void fieldShadowWrite(vec4 commonPosition) {
  vFieldShadow = vec3(0.0);
  vFieldShadowScale = vec3(1.0);
}
float fieldShadowAtVertex(vec4 commonPosition, float seed, int taps) {
  return 1.0;
}
#endif
`;

/** Taps along a golden-angle spiral, so that any number of them is spread evenly on a disc. */
function getFieldShadowDisc(count: number): string {
  const taps: string[] = [];
  for (let i = 0; i < count; i++) {
    const radius = Math.sqrt((i + 0.5) / count);
    const angle = i * 2.399963;
    taps.push(
      `vec2(${(radius * Math.cos(angle)).toFixed(4)}, ${(radius * Math.sin(angle)).toFixed(4)})`
    );
  }
  return `const vec2 FIELD_SHADOW_DISC[${count}] = vec2[${count}](${taps.join(', ')});`;
}

/**
 * The fragment stage of per-pixel shadows: `fieldShadow()`, how much direct light gets here, 0-1, with
 * shadow strength left to the layer, as `fieldShadowStrength` in a uniform of its own.
 *
 * It looks for what is in the way first, as percentage closer soft shadows do: a shadow is as soft as
 * its occluder is far, so a trunk's is crisp at the root and a crown's dapples are soft. Each tap blends
 * the four texels around it, since packed depth only holds at texel centers, so nothing shows the texels.
 * A receiver in this film casts nothing itself, so there is no acne to fight, only a small bias.
 */
export function getFieldShadowFragment(taps: number): string {
  const searches = Math.max(4, taps >> 1);
  return /* glsl */ `
${FIELD_SHADOW_COMMON_GLSL}
in vec3 vFieldShadow;
flat in vec3 vFieldShadowScale;

#ifdef MODULE_SHADOW
${getFieldShadowDisc(taps)}

float fieldShadowTap(vec2 place, float depth, ivec2 size) {
  vec2 corner = floor(place);
  vec2 f = place - corner;
  ivec2 low = clamp(ivec2(corner), ivec2(0), size - 1);
  ivec2 high = clamp(ivec2(corner) + 1, ivec2(0), size - 1);
  float a = depth <= dot(texelFetch(fieldShadowMap, low, 0), FIELD_SHADOW_UNPACK) ? 1.0 : 0.0;
  float b = depth <= dot(texelFetch(fieldShadowMap, ivec2(high.x, low.y), 0), FIELD_SHADOW_UNPACK) ? 1.0 : 0.0;
  float c = depth <= dot(texelFetch(fieldShadowMap, ivec2(low.x, high.y), 0), FIELD_SHADOW_UNPACK) ? 1.0 : 0.0;
  float d = depth <= dot(texelFetch(fieldShadowMap, high, 0), FIELD_SHADOW_UNPACK) ? 1.0 : 0.0;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Where a point of common space is in the map, as the vertex stage's fieldShadowPlace has it.
vec3 fieldShadowPlaceAt(vec3 commonPosition) {
  vec4 position = shadow.viewProjectionMatrix0 * vec4(commonPosition, 1.0) + shadow.projectCenter0;
  return (position.xyz / position.w + 1.0) * 0.5;
}

// Fraction of the key light reaching a place in the map, 0-1.
float fieldShadowAt(vec3 place) {
  if (place.x <= 0.0 || place.y <= 0.0 || place.x >= 1.0 || place.y >= 1.0 || place.z >= 1.0) return 1.0;
  ivec2 size = textureSize(fieldShadowMap, 0);
  vec2 sizeF = vec2(size);
  vec2 texelMetres = vFieldShadowScale.xy;
  float depthPerMetre = vFieldShadowScale.z;
  float depth = place.z - 0.004 * depthPerMetre;
  vec2 middle = place.xy * sizeF - 0.5;
  float angle = 6.2831853 * fieldPixelNoise(gl_FragCoord.xy);
  float c = cos(angle);
  float s = sin(angle);
  float tangent = fieldAir.clock.z;

  // What is in the way, out to as far as a crown's height could spread a shadow.
  vec2 search = clamp(max(12.0 * tangent, 0.05) / texelMetres, vec2(2.0), vec2(14.0));
  float blockers = 0.0;
  float blockerDepth = 0.0;
  for (int i = 0; i < ${searches}; i++) {
    vec2 tap = FIELD_SHADOW_DISC[i * ${taps} / ${searches}];
    vec2 at = middle + vec2(c * tap.x - s * tap.y, s * tap.x + c * tap.y) * search;
    ivec2 texel = clamp(ivec2(floor(at + 0.5)), ivec2(0), size - 1);
    float stored = dot(texelFetch(fieldShadowMap, texel, 0), FIELD_SHADOW_UNPACK);
    if (stored < depth) {
      blockers += 1.0;
      blockerDepth += stored;
    }
  }
  if (blockers <= 0.0) return 1.0;
  float above = (depth - blockerDepth / blockers) / max(depthPerMetre, 1e-9);
  // The penumbra of a disc at this height, never finer than a texel and a bit.
  vec2 radius = clamp(above * tangent / texelMetres, vec2(1.2), vec2(26.0));
  float lit = 0.0;
  for (int i = 0; i < ${taps}; i++) {
    vec2 tap = FIELD_SHADOW_DISC[i];
    lit += fieldShadowTap(middle + vec2(c * tap.x - s * tap.y, s * tap.x + c * tap.y) * radius, depth, size);
  }
  lit /= ${taps}.0;
  // No edge where the map ends.
  vec2 rim = min(place.xy, 1.0 - place.xy);
  float inside = smoothstep(0.0, 0.03, min(rim.x, rim.y));
  return mix(1.0, lit, inside);
}

// Fraction of the key light reaching the point the vertex stage wrote, 0-1.
float fieldShadow() {
  return fieldShadowAt(vFieldShadow);
}
#else
vec3 fieldShadowPlaceAt(vec3 commonPosition) {
  return vec3(0.0);
}
float fieldShadowAt(vec3 place) {
  return 1.0;
}
float fieldShadow() {
  return 1.0;
}
#endif
`;
}

/**
 * The sky probe's layout, for the sky that draws it and the water that reads it: an equirectangular
 * texture of the whole sphere, in linear light ahead of `fieldFilmic`, as the sky's own sums leave
 * it. `s` is a direction's compass bearing over 360 degrees, clockwise from +y; `t` is 0.5 plus its
 * elevation over 180 degrees, so the zenith is the last row. `SKY_PROBE_GLSL` has the same in GLSL.
 */
export const SKY_PROBE_LAYOUT = {width: 128, height: 64} as const;

/** Where a direction is in the sky probe, as texture coordinates `[s, t]`. */
export function getSkyProbePlace(direction: Readonly<Vec3>): [number, number] {
  const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const bearing = Math.atan2(direction[0], direction[1]);
  const s = bearing / (2 * Math.PI);
  const elevation = Math.asin(Math.max(-1, Math.min(1, direction[2] / length)));
  return [s - Math.floor(s), 0.5 + elevation / Math.PI];
}

/** The unit direction at texture coordinates `[s, t]` of the sky probe. */
export function getSkyProbeDirection(s: number, t: number): Vec3 {
  const bearing = s * 2 * Math.PI;
  const elevation = (t - 0.5) * Math.PI;
  const across = Math.cos(elevation);
  return [across * Math.sin(bearing), across * Math.cos(bearing), Math.sin(elevation)];
}

/**
 * `SKY_PROBE_LAYOUT` in GLSL: `fieldSkyProbePlace(direction)` and `fieldSkyProbeDirection(place)`,
 * for a pass that draws the probe and a surface that reads it.
 */
export const SKY_PROBE_GLSL = /* glsl */ `
vec2 fieldSkyProbePlace(vec3 direction) {
  vec3 unit = normalize(direction);
  float s = atan(unit.x, unit.y) / 6.2831853;
  return vec2(fract(s), 0.5 + asin(clamp(unit.z, -1.0, 1.0)) / 3.14159265);
}

vec3 fieldSkyProbeDirection(vec2 place) {
  float bearing = place.x * 6.2831853;
  float elevation = (place.y - 0.5) * 3.14159265;
  return vec3(cos(elevation) * sin(bearing), cos(elevation) * cos(bearing), sin(elevation));
}
`;

/**
 * What wet ground and standing water mirror, for a fragment stage after `FIELD_AIR_GLSL`:
 * `fieldMirror(direction, spread, probe)`. With `probe` over 0.5 it reads the sky probe bound as
 * `fieldSkyProbe` in four taps `spread` apart, as rough water blurs it; otherwise the clear air, or
 * what cloud has made of it.
 */
export const FIELD_MIRROR_GLSL = /* glsl */ `
uniform sampler2D fieldSkyProbe;
${SKY_PROBE_GLSL}

vec3 fieldMirror(vec3 direction, float spread, float probe) {
  vec3 up = normalize(vec3(direction.xy, max(direction.z, FIELD_HORIZON_Z)));
  if (probe > 0.5) {
    vec3 side = normalize(cross(up, abs(up.z) < 0.95 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
    vec3 other = cross(up, side);
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      float angle = 1.5707963 * float(i) + 0.7853982;
      vec3 tap = normalize(up + (side * cos(angle) + other * sin(angle)) * spread);
      tap.z = max(tap.z, FIELD_HORIZON_Z);
      sum += textureLod(fieldSkyProbe, fieldSkyProbePlace(tap), 0.0).rgb;
    }
    return sum * 0.25;
  }
  vec3 clear = fieldAir.weather.z < 0.999 ? fieldAtmosphere(up) : vec3(0.0);
  return mix(clear, fieldAir.fog.rgb * 0.9, fieldAir.weather.z);
}
`;

const FIELD_SHADOW_UNIFORM_BLOCK = /* glsl */ `
layout(std140) uniform shadowUniforms {
  bool drawShadowMap;
  bool useShadowMap;
  vec4 color;
  highp int lightId;
  float lightCount;
  mat4 viewProjectionMatrix0;
  mat4 viewProjectionMatrix1;
  vec4 projectCenter0;
  vec4 projectCenter1;
} shadow;
`;

const FIELD_SHADOW_MODULE_VS = /* glsl */ `${FIELD_SHADOW_UNIFORM_BLOCK}
vec4 shadow_setVertexPosition(vec4 position_commonspace) {
  return gl_Position;
}
`;

const FIELD_SHADOW_MODULE_FS = /* glsl */ `${FIELD_SHADOW_UNIFORM_BLOCK}
vec4 shadow_filterShadowColor(vec4 color) {
  return color;
}
`;

const FIELD_SHADOW_MODULES = new WeakMap<object, unknown>();

/**
 * deck's shadow module with what these layers do not use taken out, as `TreeLayer` does: they read the map
 * through a sampler of their own, and draw nothing into it. The uniforms and what it injects are the same.
 */
function getFieldShadowModule<ModuleT extends {name: string}>(module: ModuleT): ModuleT {
  if (module.name !== 'shadow') return module;
  let slim = FIELD_SHADOW_MODULES.get(module) as ModuleT | undefined;
  if (!slim) {
    const {getUniforms} = module as unknown as {
      getUniforms: (...args: unknown[]) => Record<string, unknown>;
    };
    slim = {
      ...module,
      vs: FIELD_SHADOW_MODULE_VS,
      fs: FIELD_SHADOW_MODULE_FS,
      getUniforms: (...args: unknown[]) => {
        const {
          shadow_uShadowMap0: _map0,
          shadow_uShadowMap1: _map1,
          ...uniforms
        } = getUniforms(...args);
        return uniforms;
      }
    };
    FIELD_SHADOW_MODULES.set(module, slim);
  }
  return slim;
}

/** What every field layer takes. */
export type FieldLayerProps = LayerProps & {
  /** `getFieldAir(state)`. */
  air: FieldAir;
};

/**
 * A layer that reads the film's shadows and air. It draws nothing into a shadow pass or a picking pass:
 * nothing in it casts, or is a thing to pick.
 */
export abstract class FieldLayer<PropsT extends {} = {}> extends Layer<
  PropsT & Required<FieldLayerProps>
> {
  static layerName = 'FieldLayer';

  declare state: {
    model?: Model;
    fieldShadowMap: Texture | null;
    fieldShadowFallback: Texture | null;
    fieldShadowStrength: number;
    [key: string]: unknown;
  };

  initializeState(): void {
    this.state.fieldShadowMap = null;
    this.state.fieldShadowFallback = null;
    this.state.fieldShadowStrength = 0;
  }

  getShaders(shaders: unknown): any {
    const merged = super.getShaders(shaders) as {modules: {name: string}[]};
    return {...merged, modules: merged.modules.map(getFieldShadowModule)};
  }

  /** Makes the model, and again if deck's default modules change. */
  updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    if (params.changeFlags.extensionsChanged || !this.state.model) {
      this.state.model?.destroy();
      this.state.model = this.createModel();
    }
  }

  /** Builds this layer's model. */
  protected abstract createModel(): Model;

  /** Takes the map away from deck's shadow module, as these layers read it themselves. */
  setShaderModuleProps(props: Parameters<Layer['setShaderModuleProps']>[0]): void {
    const shadow = (props as {shadow?: Record<string, any>}).shadow;
    if (!shadow || !shadow.dummyShadowMap) {
      super.setShaderModuleProps(props);
      return;
    }
    const maps: Texture[] = shadow.shadowMaps ?? [];
    this.state.fieldShadowFallback = shadow.dummyShadowMap;
    this.state.fieldShadowMap = maps[0] ?? null;
    this.state.fieldShadowStrength = maps[0] ? (shadow.shadowColor?.[3] ?? 1) : 0;
    super.setShaderModuleProps({...props, shadow: {...shadow, shadowMaps: []}} as never);
  }

  /** How much of direct light a shadow takes, 0-1. Hand it to `fieldShadow()`'s result. */
  protected get fieldShadowStrength(): number {
    return this.state.fieldShadowStrength ?? 0;
  }

  /** Sets `fieldAir` on a model, and binds the shadow map unless its shaders do not read one. */
  protected setFieldUniforms(model: Model, air: FieldAir, readsShadow = true): void {
    model.shaderInputs.setProps({fieldAir: air} as never);
    const {fieldShadowMap, fieldShadowFallback} = this.state;
    const map = fieldShadowMap ?? fieldShadowFallback;
    if (
      readsShadow &&
      map &&
      this.context.defaultShaderModules.some(module => module.name === 'shadow')
    ) {
      model.setBindings({fieldShadowMap: map});
    }
  }

  /** Whether this draw is one this layer sits out. */
  protected isDrawSkipped(options: {shaderModuleProps?: Record<string, any> | null}): boolean {
    const {shaderModuleProps} = options;
    return Boolean(
      shaderModuleProps?.picking?.isActive || shaderModuleProps?.shadow?.drawToShadowMap
    );
  }
}
