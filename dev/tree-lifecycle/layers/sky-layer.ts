// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The sky, drawn first with no depth, over the whole frame. Each pixel works out its own ray from the view
 * actually in use, so the lens's jitter moves it like anything else.
 *
 * In order, from far to near: the clear air of `field-shading.ts`, worked out at the corners of a coarse grid,
 * with its phase per pixel; the stars, the moon and the sun; high cirrus; cumulus, marched through a 3D noise with
 * a few steps toward the light, in a pass of its own at half the frame's size, which marches the storm's walls in
 * tiers as well, the eye's stadium and the departing wall; then the hurricane's low decks with their spiral, their
 * lumpy undersides, their leading and trailing edges and their eye, and the rain under them, in sheets that follow
 * the weather layer's own. At the bottom a line of far woods, then the horizon that the ground fades into.
 *
 * While water may mirror it, the same sky goes into a small probe as well, a pass of its own: see `getSkyProbe`.
 */

import type {UpdateParameters, Viewport} from '@deck.gl/core';
import type {Device, Framebuffer, Texture} from '@luma.gl/core';
import {Model} from '@luma.gl/engine';
import {Matrix4} from '@math.gl/core';
import {HURRICANE} from '../story/beats';
import {
  clamp01,
  createTrack,
  getBearingVector,
  lerp,
  smoothstep,
  type Key
} from '../story/story-math';
import type {StoryState} from '../story/story-types';
import {
  FIELD_AIR_GLSL,
  FIELD_LIGHT_GLSL,
  fieldAir,
  FieldLayer,
  type FieldAir,
  getFieldAir,
  SKY_PROBE_GLSL,
  SKY_PROBE_LAYOUT
} from './field-shading';
import {
  acquireWeatherNoise,
  getWeatherCurtain,
  releaseWeatherNoise,
  WEATHER_CURTAIN_GLSL,
  WEATHER_RAIN_VEIL_POWER
} from './weather-layer';

/** Side of the cloud noise, in texels. Tiles along all three axes. */
const CLOUD_NOISE_SIZE = 64;
/** Cumulus by `cloudBuild`, flat fair-weather to towering, in metres. */
const CUMULUS = {
  base: [1250, 950] as const,
  thickness: [520, 9200] as const,
  /** Shape noise repeats every this many metres. */
  shape: [3400, 11000] as const,
  /** The field of cells repeats every this many metres. */
  field: [15000, 42000] as const,
  /** Shape's detail is this many times finer. */
  detail: 2.4
};
/**
 * The story's nights go by in a second, with the star field turning as fast as its clock. So much of that turn
 * shows here that it keeps the look of stars turning slowly overhead, not of streaks across a shutter.
 */
const STAR_TURN_SHARE = 0.1;
/** Cells of the grid that the clear air is worked out at. */
const SKY_GRID = [48, 27] as const;
/**
 * How far off the storm's center stands. Bands turn around it, so overhead they race along the wind. It
 * changes sides while the eye hides the decks, so they race back the other way, as the wind does after an eye.
 */
const STORM_CENTER_METRES = 18000;

/**
 * The hurricane's decks. Heights in metres, and how far each is stretched along its flow: a little, so their
 * cells are ragged, not brushed. The swirl comes from the story at the main deck's speed, about 24 m/s, and the
 * scud races at about 45 and the upper deck creeps at about 7. Colors are linear light: the main deck's base
 * and its breaks, about 2.3 stops over the near canopy, and the scud darker, in torn cells.
 */
const STORM_DECKS = {
  upper: {height: 3400, swirl: 0.3, stretch: 1, scale: 1.6},
  /** `hang` is how far its underside's lumps hang below it, where it is thickest. */
  main: {height: 950, swirl: 1, stretch: 1, scale: 3.1, hang: 300},
  scud: {height: 360, swirl: 1.9, stretch: 1.1, scale: 4.6, hang: 140},
  base: [0.13, 0.15, 0.14] as const,
  breaks: [0.37, 0.41, 0.4] as const,
  scudColor: [0.075, 0.09, 0.085] as const,
  /** The departing storm, deep blue-grey, and how much of the low sun its trailing edge takes. */
  departingBase: [0.045, 0.06, 0.085] as const,
  departingBreaks: [0.12, 0.14, 0.18] as const,
  underside: 0.45
};

/**
 * The deck's edges, as metres along the way it goes, by cycle second. It comes over from the SSW, its edge past
 * the view's centre at 33.0, and breaks from the west as it clears, its trailing edge overhead at 44.6.
 */
const DECK_FRONT = {
  /** Arriving, it travels toward the first wall's bearing, and the clear sky is ahead of it. */
  arriving: [
    [HURRICANE.arrive - 0.6, -9000],
    [HURRICANE.arrive, -3500],
    [33, 0],
    [33.3, 1600],
    [33.8, 6000],
    [HURRICANE.firstWall, 20000]
  ] as readonly Key[],
  /** Clearing, it goes east, and the clear sky is to the west of it. */
  clearingBearing: 270,
  clearing: [
    [HURRICANE.clearing, 16000],
    [HURRICANE.clearing + 0.6, 0],
    [HURRICANE.clearing + 1.6, -6000],
    [HURRICANE.clearing + 3.8, -14000]
  ] as readonly Key[],
  /** Metres either side of the edge over which it is ragged, by the decks' own noise. */
  ragged: 2600,
  /**
   * Clearing, the low sun gets in under the trailing edge this far, lighting its base and the rain under it
   * gold, and past that the air under the deck is in its shadow, this much of its light left.
   */
  sunlit: 1800,
  /**
   * Metres into the deck its base is lit, the rain's glow there, and how much of the rain and fog far off is left
   * in the washed air, the showers near the camera being the weather layer's.
   */
  undersideReach: 300,
  rainGlow: 0.4,
  washed: 0.3,
  gold: [1, 0.74, 0.46] as const,
  shadowed: [0.16, 0.19, 0.26] as const
};

const RADIANS = Math.PI / 180;

/**
 * The outer band's rain shaft, standing to the east on the arrival, in radians: the bearing of its middle at the
 * deck's base, how far downwind its foot leans, its width at the ground and at the base, and how high the base
 * is.
 */
const SHAFT = {
  bearing: 96 * RADIANS,
  lean: 4 * RADIANS,
  widthLow: 6.5 * RADIANS,
  widthHigh: 3.2 * RADIANS,
  top: 9.5 * RADIANS
};

/**
 * The departing storm's wall in the east as it clears, marched as cloud in the cumulus pass with the eye's own
 * tiers: deep blue-grey in the shade of its deck, its foot lit warm all along by the low sun that gets in under it.
 * How far east its face stands at the ground, from when it starts to go to when it has gone, metres; how far along
 * the wall its towers repeat; how large its billows are, so far off; the heights over which the sun gets in under
 * it, from all of it to none, over the rain dark at its very foot; how much of the sun its foot takes, and the most light that gives, so no point of it
 * is a second sun; the light of the shaded wall, as a share of the sky's; how much clearer the washed air is out to
 * it; and the storm's strengths over which it goes, and over which it fades out at the last.
 */
const DEPARTING = {
  distance: [42000, 95000] as const,
  along: 42000,
  shape: 9000,
  footLit: [700, 2600] as const,
  footGain: 0.8,
  footMost: 0.3,
  shade: [0.16, 0.19, 0.26] as const,
  /** The light of the air out to it, in its deck's shade, as a share of the clear air's, and how clear that air is. */
  air: [0.3, 0.34, 0.42] as const,
  washed: 0.55,
  goes: [0.45, 0.08] as const,
  fades: [0.02, 0.15] as const
};

/**
 * The eye's stadium, marched as cloud in the cumulus pass: a ring of towering cloud all round the camera, which
 * stands near the eye's middle, its inner face leaning out as it rises and stepping back at two terraces, as a
 * stadium's tiers do, from a skirt of low stratocumulus at its foot to the rounded heads of its towers. Metres.
 * From the furrow its lowest tier tops out about 15 degrees up, the next about 25, and the towers' heads 30-40,
 * with the hazy blue of the eye clear over all of it.
 */
const EYEWALL = {
  /** The inner face's distance out at the ground, and how far out it leans for each metre up. */
  radius: 8200,
  lean: 0.4,
  /**
   * The tiers: the heights of the tops of the first two, lowest and highest round the ring, and how far the face
   * steps back over each top, so the next tier stands behind it.
   */
  tiers: [
    [2300, 3500],
    [4700, 6300]
  ] as const,
  steps: [1500, 1300] as const,
  /** The main wall's top between its towers, and the heads of the towers over it. */
  top: [7600, 10600] as const,
  /** How far a tower stands in from the face, and the width over which the face goes from clear to solid. */
  towers: 1300,
  edge: 1000,
  /** The billows repeat every this many metres, their detail is this many times finer, and they rise this fast. */
  shape: 5600,
  detail: 3.2,
  rise: 2.5,
  /** The skirt of stratocumulus: its base and top, and how far in from the face it reaches. */
  skirt: [520, 1400] as const,
  skirtReach: 2600,
  /** Radians the ring turns for each unit of the storm's swirl. */
  turn: 0.03,
  /** How light the wall's foot is against its top, in its rain and its own shade. */
  foot: 0.42
};

/** Where the rain under the decks goes, past the weather's slices out to the cloud base. Metres. */
const RAIN_VEIL = {
  from: 340,
  top: 950,
  /** Optical depth per metre of the rain at full strength, and of the fog's share of it. */
  rain: 0.00016,
  fog: 0.028,
  /** The fog the air has anyway, which no veil takes. */
  clearFog: 0.0012
};

/**
 * The probe: the sky as water mirrors it, in the water's own layout, and the grid its vertices work out the air
 * on. Calm water is a mirror, which a coarse probe would blur by degrees, so where the flood is calm the probe is
 * drawn four times as fine each way: the eye's stadium and its bright walls show in it.
 */
const PROBE = {...SKY_PROBE_LAYOUT, grid: [16, 16] as const};
const FINE_PROBE = {width: SKY_PROBE_LAYOUT.width * 4, height: SKY_PROBE_LAYOUT.height * 4};
/** What water may mirror it over: a level above this, or ground wetter than this; and how calm it is a mirror. */
const PROBE_WANTED = {level: -0.66, wetness: 0.3, calm: 0.5};

type SkyLayerProps = {
  /** How the frame's cumulus is laid out: base, top, shape scale, field scale. */
  cumulus: [number, number, number, number];
  /** Cover, build, drift x and y. */
  cloud: [number, number, number, number];
  /** Swirl, storm center x and y, wind's bearing in radians. */
  storm: [number, number, number, number];
  /** Star field's turn in radians, rain 0-1, the storm's arrival, and the lens's blur of the sky in radians. */
  extra: [number, number, number, number];
  /** The rain's frame from `getWeatherCurtain`, across, above and along the fall, with the curtains, the gust and the rain. */
  rainAcross: [number, number, number, number];
  rainAbove: [number, number, number, number];
  rainFall: [number, number, number, number];
  /**
   * Metres the curtains have been carried, x and y; daylight 0-1; and how far east the departing storm's wall stands,
   * in metres, from `getDepartingDistance`.
   */
  veil: [number, number, number, number];
  /** The deck's edge: the unit vector toward clear sky, x and y, how far along it the edge is, and 0, 1 arriving or 2 clearing. */
  front: [number, number, number, number];
  /** Whether water may mirror the sky in this frame, so the probe is drawn, and whether it is calm, so finely. */
  probe: boolean;
  probeFine: boolean;
};

const FIELD_SKY_DECLARATION = /* glsl */ `layout(std140) uniform fieldSkyUniforms {
  vec4 eye;
  vec4 rayA;
  vec4 rayB;
  vec4 rayC;
  vec4 cumulus;
  vec4 cloud;
  vec4 storm;
  vec4 extra;
  vec4 rainAcross;
  vec4 rainAbove;
  vec4 rainFall;
  vec4 veil;
  vec4 front;
} fieldSky;`;

const fieldSky = {
  name: 'fieldSky',
  vs: FIELD_SKY_DECLARATION,
  fs: FIELD_SKY_DECLARATION,
  uniformTypes: {
    eye: 'vec4<f32>',
    rayA: 'vec4<f32>',
    rayB: 'vec4<f32>',
    rayC: 'vec4<f32>',
    cumulus: 'vec4<f32>',
    cloud: 'vec4<f32>',
    storm: 'vec4<f32>',
    extra: 'vec4<f32>',
    rainAcross: 'vec4<f32>',
    rainAbove: 'vec4<f32>',
    rainFall: 'vec4<f32>',
    veil: 'vec4<f32>',
    front: 'vec4<f32>'
  }
} as const;

/** What the vertex stages of the sky and the probe share: the light of the clear air and of the clouds. */
const SKY_VERTEX_HEAD = /* glsl */ `#version 300 es
precision highp float;

out vec3 vRay;
out vec2 vPlace;
// The clear air, in parts, at the corners of a coarse grid.
out vec3 vAirRayleigh;
out vec3 vAirAerosol;
out vec3 vAirOther;
// What the clouds of this frame are lit by: sun low and high in the layer, sky above and bounce below.
flat out vec3 vCloudSunLow;
flat out vec3 vCloudSunHigh;
flat out vec3 vCloudSky;
flat out vec3 vCloudBounce;
flat out vec3 vCloudLightDirection;
flat out vec3 vSunThrough;

${FIELD_AIR_GLSL}

// The air toward a direction, and what lights the clouds.
void skyLoadLight(vec3 look) {
  float lookZ = max(look.z, FIELD_HORIZON_Z);
  float scale = sqrt(max(1.0 - lookZ * lookZ, 0.0)) / max(length(look.xy), 1e-5);
  fieldAirParts(vec3(look.xy * scale, lookZ), vAirRayleigh, vAirAerosol, vAirOther);

  vec3 sun = fieldAir.sun.xyz;
  float base = fieldSky.cumulus.x;
  float top = min(fieldSky.cumulus.y, 12000.0);
  float strength = 2.7;
  float rLow = FIELD_PLANET + base;
  float rHigh = FIELD_PLANET + top;
  vSunThrough = fieldAirThrough(FIELD_PLANET + 2.0, sun.z);
  vec3 sunLow = fieldAirThrough(rLow, sun.z) * strength;
  vec3 sunHigh = fieldAirThrough(rHigh, sun.z) * strength;
  vec3 moonLight = vec3(0.34, 0.42, 0.62) * 0.2 * fieldAir.moon.w * smoothstep(-0.02, 0.2, fieldAir.moon.z);
  vCloudLightDirection = fieldAir.moon.w > 0.6 ? fieldAir.moon.xyz : sun;
  vCloudSunLow = fieldAir.moon.w > 0.6 ? moonLight : sunLow;
  vCloudSunHigh = fieldAir.moon.w > 0.6 ? moonLight : sunHigh;
  vec3 zenith = fieldAtmosphere(vec3(0.0, 0.0, 1.0));
  vec3 around = 0.5 * (fieldAtmosphere(normalize(vec3(sun.xy, 0.25))) + fieldAtmosphere(normalize(vec3(-sun.xy, 0.25))));
  vCloudSky = 0.5 * (zenith + around) * 0.72;
  // Sand and light sent back up from below.
  float sunUp = max(sun.z, 0.0);
  float shaded = 1.0 - 0.82 * fieldSky.cloud.x;
  vCloudBounce = (fieldAirThrough(FIELD_PLANET + 2.0, sun.z) * strength * sunUp * shaded + vCloudSky) * vec3(0.28, 0.25, 0.2);
  vCloudSky *= mix(1.0, 0.55, fieldSky.cloud.x * fieldSky.cloud.x);
}

// A cell of a grid over the target, and a corner of one of its two triangles, -1 to 1.
vec2 skyGridPlace(int cellsX, int cellsY) {
  int cell = gl_VertexID / 6;
  int corner = gl_VertexID % 6;
  vec2 cellPlace = vec2(float(cell % cellsX), float(cell / cellsX));
  vec2 offset = corner == 0 ? vec2(0.0, 0.0) : corner == 1 || corner == 3 ? vec2(1.0, 0.0) : corner == 2 || corner == 5 ? vec2(0.0, 1.0) : vec2(1.0, 1.0);
  return (cellPlace + offset) / vec2(float(cellsX), float(cellsY)) * 2.0 - 1.0;
}
`;

const SKY_VERTEX = /* glsl */ `${SKY_VERTEX_HEAD}
#define SHADER_NAME field-sky-vs

void main() {
  vec2 place = skyGridPlace(${SKY_GRID[0]}, ${SKY_GRID[1]});
  gl_Position = vec4(place, 1.0, 1.0);
  vPlace = place;
  vRay = fieldSky.rayA.xyz + (fieldSky.rayB.xyz - fieldSky.rayA.xyz) * (place.x + 1.0) * 0.25 +
    (fieldSky.rayC.xyz - fieldSky.rayA.xyz) * (place.y + 1.0) * 0.25;
  skyLoadLight(normalize(vRay));
}
`;

/**
 * The probe's grid, in the layout of `SKY_PROBE_LAYOUT` that the water reads it by: the whole sphere, each
 * vertex's direction from `fieldSkyProbeDirection`.
 */
const PROBE_VERTEX = /* glsl */ `${SKY_VERTEX_HEAD}
#define SHADER_NAME field-sky-probe-vs
${SKY_PROBE_GLSL}

void main() {
  vec2 place = skyGridPlace(${PROBE.grid[0]}, ${PROBE.grid[1]});
  gl_Position = vec4(place, 0.0, 1.0);
  vPlace = place;
  vRay = fieldSkyProbeDirection(place * 0.5 + 0.5);
  skyLoadLight(normalize(vRay));
}
`;

/** What both fragment stages start with. */
const SKY_FRAGMENT_HEAD = /* glsl */ `
precision highp float;
precision highp sampler3D;

in vec3 vRay;
in vec2 vPlace;
in vec3 vAirRayleigh;
in vec3 vAirAerosol;
in vec3 vAirOther;
flat in vec3 vCloudSunLow;
flat in vec3 vCloudSunHigh;
flat in vec3 vCloudSky;
flat in vec3 vCloudBounce;
flat in vec3 vCloudLightDirection;
flat in vec3 vSunThrough;

// R a billowing noise, G and B finer billows, A a smooth noise. All tile, and all but G and B are even
// histograms, so a threshold of x leaves exactly the share 1 - x above it.
uniform sampler3D fieldNoise;
out vec4 fragColor;

${FIELD_LIGHT_GLSL}
${FIELD_AIR_GLSL}

float henyeyGreenstein(float cosine, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * cosine, 1e-4), 1.5));
}

float remap(float value, float low, float high, float toLow, float toHigh) {
  return toLow + (value - low) / max(high - low, 1e-4) * (toHigh - toLow);
}

// Lightning, around where it strikes, and a little everywhere.
vec3 getFlashLight(vec3 direction) {
  float flash = fieldAir.flash.w;
  if (flash <= 0.0) return vec3(0.0);
  float toward = max(dot(direction, fieldAir.flash.xyz), 0.0);
  return vec3(0.72, 0.82, 1.0) * flash * (0.3 + 3.2 * pow(toward, 6.0));
}
`;

/** Cumulus: its shape, and a march through it toward the camera. */
const CUMULUS_GLSL = /* glsl */ `
const float MOST_CLOUD_METRES = 90000.0;

float cumulusCells(vec2 q) {
  vec2 w = q / fieldSky.cumulus.w;
  float cells = texture(fieldNoise, vec3(w, 0.21)).a;
  float small = texture(fieldNoise, vec3(w * 3.3 + 0.31, 0.63)).a;
  float mixed = cells * 0.72 + small * 0.28;
  // Mixed noise has fewer extremes than either: widen it back to an even share around the middle.
  float even = clamp((mixed - 0.5) * 1.34 + 0.5, 0.0, 1.0);
  float cover = fieldSky.cloud.x;
  // Softly, so a cloud thins out toward its edge rather than stops at a line.
  return smoothstep(1.0 - cover - 0.04, 1.0 - cover + 0.3, even);
}

float cumulusProfile(float height, float build) {
  // Flat bottoms, a cauliflower top, and narrower toward the top of a tower.
  float bottom = smoothstep(0.0, mix(0.1, 0.03, build), height);
  float top = 1.0 - smoothstep(mix(0.42, 0.55, build), 1.0, height);
  return bottom * top * mix(1.0, 1.0 - 0.45 * height, build);
}

// How far out on its billows the last fine density was, for what it can tell the light.
float cumulusDetail = 0.5;

float cumulusDensity(vec3 p, bool fine, float dilate) {
  float height = (p.z - fieldSky.cumulus.x) / (fieldSky.cumulus.y - fieldSky.cumulus.x);
  if (height <= 0.0 || height >= 1.0) return 0.0;
  vec2 q = p.xy + fieldSky.cloud.zw;
  float cells = cumulusCells(q);
  if (cells <= 0.0) return 0.0;
  float build = fieldSky.cloud.y;
  float profile = cumulusProfile(height, build);
  float scale = fieldSky.cumulus.z;
  // Cloud leans with height, and billows go up as they go by.
  vec3 at = vec3(q + vec2(0.35, 0.12) * (p.z - fieldSky.cumulus.x), p.z * 1.25) / scale;
  float shape = texture(fieldNoise, at).r;
  // Short of solid until the sky is nearly full, so that billows, not the layer's shape, make the surface. With
  // the sun on the horizon a few fair-weather clouds are thin, lit through, rather than dark lumps.
  float closed = mix(0.66, 1.05, smoothstep(0.6, 0.97, fieldSky.cloud.x)) *
    mix(0.7, 1.0, smoothstep(0.03, 0.16, fieldAir.sun.z));
  // Solid at the bottom, where a cloud starts all at once at the height air condenses, so its base is flat.
  closed = mix(1.05, closed, smoothstep(0.02, 0.3, height));
  float amount = cells * profile * closed;
  float density = remap(shape + dilate, 1.0 - amount, 1.0, 0.0, 1.0);
  if (density <= 0.0) return 0.0;
  if (fine) {
    vec3 detailAt = at * ${CUMULUS.detail.toFixed(2)} + vec3(0.0, 0.0, 0.17);
    float detail = texture(fieldNoise, detailAt).g * 0.42 + texture(fieldNoise, detailAt * 2.3).g * 0.33 + texture(fieldNoise, detailAt * 5.3).b * 0.25;
    cumulusDetail = detail;
    // Eaten away at the edges, more so low down, where wisps are, than at the billowing top.
    float bite = mix(0.5, 0.32, height);
    density = remap(density, (1.0 - detail) * bite, 1.0, 0.0, 1.0);
  }
  // Thin toward its surface, so it has a soft edge that the light comes through, and no line round it.
  density = clamp(density, 0.0, 1.0);
  return density * density * (1.6 - 0.6 * density);
}

// A march through the layer: how much light comes back, and how much of what is behind gets through. It
// strides until it meets cloud, goes back a stride, and walks. A cloud's surface is then as crisp as a walk.
vec4 cumulusMarch(vec3 direction, float jitter, vec3 eyePosition, vec3 flashLight, vec3 air) {
  float base = fieldSky.cumulus.x;
  float top = fieldSky.cumulus.y;
  if (direction.z < 0.006 || fieldSky.cloud.x <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float near = (base - eyePosition.z) / direction.z;
  if (near > MOST_CLOUD_METRES) return vec4(0.0, 0.0, 0.0, 1.0);
  float far = min((top - eyePosition.z) / direction.z, MOST_CLOUD_METRES);
  float span = far - near;
  float stride = max(span / 22.0, 90.0);
  float walk = clamp(0.012 * near, 24.0, 240.0);
  vec3 lightDirection = vCloudLightDirection;
  float cosine = dot(direction, lightDirection);
  // Thin cloud against the sun lights up, but only so far: a silver lining, not a filament.
  float phase = min(mix(henyeyGreenstein(cosine, 0.66), henyeyGreenstein(cosine, -0.2), 0.42) * 12.566, 3.6);
  const float SIGMA = 0.026;
  float lightStep = mix(45.0, 170.0, fieldSky.cloud.y);
  float t = near + stride * jitter;
  float lastEmpty = near;
  vec3 light = vec3(0.0);
  float through = 1.0;
  float weight = 0.0;
  float depth = 0.0;
  bool walking = false;
  float empty = 0.0;
  int samples = 0;
  for (int i = 0; i < 52 && t < far && through > 0.03; i++) {
    vec3 p = eyePosition + direction * t;
    if (!walking) {
      if (cumulusDensity(p, false, 0.14) > 0.0) {
        // Back to where the cloud begins, by halves.
        float inside = t;
        float outside = lastEmpty;
        for (int j = 0; j < 4; j++) {
          float middle = 0.5 * (inside + outside);
          if (cumulusDensity(eyePosition + direction * middle, false, 0.14) > 0.0) inside = middle;
          else outside = middle;
        }
        t = inside;
        walking = true;
        empty = 0.0;
      } else {
        lastEmpty = t;
        t += stride;
      }
      continue;
    }
    float density = cumulusDensity(p, true, 0.0);
    if (density > 0.0) {
      if (weight <= 0.0 && empty > 0.0) {
        // The surface itself, between this walk and the last, so its place does not show the walk's steps.
        float inside = t;
        float outside = t - walk;
        for (int j = 0; j < 3; j++) {
          float middle = 0.5 * (inside + outside);
          if (cumulusDensity(eyePosition + direction * middle, true, 0.0) > 0.0) inside = middle;
          else outside = middle;
        }
        t = inside + walk * jitter * 0.4;
        p = eyePosition + direction * t;
        density = max(cumulusDensity(p, true, 0.0), 0.03);
      }
      empty = 0.0;
      float detailHere = cumulusDetail;
      // Toward the light, in steps that widen, seeing its own billows at first. The first look gets the most.
      float tau = 0.0;
      float along = lightStep * 0.4;
      vec3 toward = p;
      int looks = samples < 2 ? 5 : 3;
      for (int j = 0; j < looks; j++) {
        toward += lightDirection * along;
        tau += cumulusDensity(toward, j < 2, 0.0) * along;
        along *= 2.6;
      }
      float height = clamp((p.z - base) / (top - base), 0.0, 1.0);
      float beer = exp(-SIGMA * 0.9 * tau);
      float soft = 0.24 * exp(-SIGMA * 0.11 * tau);
      float powder = mix(1.0, 1.0 - exp(-density * 7.0), 0.55 * (0.5 - 0.5 * cosine));
      vec3 sun = mix(vCloudSunLow, vCloudSunHigh, height);
      // The crevices of its billows see less of everything.
      float crevice = mix(0.62, 1.12, smoothstep(0.3, 0.8, detailHere));
      // Light that has come straight through keeps its forward peak, and what has scattered around has lost it.
      vec3 direct = sun * (beer * phase + soft * 0.6) * powder * crevice;
      // Sky from above and sand from below, less of each the deeper in.
      float open = pow(height, 0.6) * exp(-SIGMA * 0.03 * tau);
      vec3 sky = mix(vCloudBounce, vCloudSky, open) * mix(0.6, 1.0, open) * mix(0.8, 1.05, crevice - 0.62);
      vec3 source = direct * 0.52 + sky + flashLight * (0.4 + 0.6 * density);
      float stepHere = walk * (1.0 + 0.4 * float(samples));
      float fade = exp(-SIGMA * density * stepHere);
      light += through * source * (1.0 - fade);
      depth += t * through * (1.0 - fade);
      weight += through * (1.0 - fade);
      through *= fade;
      t += stepHere;
      samples++;
    } else {
      // Through a gap with widening steps, and out, eventually, to striding again.
      empty += 1.0;
      t += walk * (1.0 + 0.4 * empty);
      if (empty > 7.0) {
        walking = false;
        lastEmpty = t;
        t += stride * 0.5;
      }
    }
  }
  if (weight > 0.0) {
    depth /= weight;
    // Air between here and the cloud.
    float airLeft = exp(-depth * mix(1.1e-5, 3.2e-5, fieldAir.haze.w));
    light = mix(air * (1.0 - through), light, airLeft);
  }
  // Toward the horizon cloud runs together with the haze.
  float shown = smoothstep(0.006, 0.04, direction.z);
  return vec4(light * shown, mix(1.0, through, shown));
}

// ---------------------------------------------------------------- The eye's wall

const float EYEWALL_TOP = ${EYEWALL.top[1].toFixed(1)};

// Round the eye, which is about the camera: how far out a place is, and the way to it, which turns slowly with the
// storm, so its towers go by.
vec2 eyewallWay(vec2 offset, out float r) {
  r = max(length(offset), 1.0);
  float turn = fieldSky.storm.x * ${EYEWALL.turn.toFixed(3)};
  float c = cos(turn);
  float s = sin(turn);
  vec2 way = offset / r;
  return vec2(way.x * c - way.y * s, way.x * s + way.y * c);
}

// How much of a tier there is at a place, 0-1: none in from its face, all of it an edge's width out, and its top
// rounded over, as the heads of cumulus are.
float eyewallTier(float r, float face, float z, float top) {
  return smoothstep(-1.0, 1.0, (r - face) / ${EYEWALL.edge.toFixed(1)}) * (1.0 - smoothstep(0.7, 1.0, z / top));
}

// How far out on its billows the last fine density was, for what it can tell the light.
float eyewallDetail = 0.5;

// How much cloud there is in a wall of the storm: its tiers, each standing behind the one below it with its own
// heads, the towers of its top tier standing in from it, and a skirt at its foot. r is how far out a point is
// from the camera, way where it is along the wall, q its place for the billows, which repeat every shape
// metres. Like the cumulus, a share of the billows is cloud, more of them the deeper in, so its surface is theirs,
// soft and lumpy, and never a line.
float stormWallDensity(float r, vec2 way, vec2 q, float z, float shape, bool fine, float dilate, bool skirt) {
  if (z < 0.0 || z > EYEWALL_TOP) return 0.0;
  // The face leans out as it rises, and each tier stands behind the one below it.
  float face = ${EYEWALL.radius.toFixed(1)} + ${EYEWALL.lean.toFixed(3)} * z;
  float first = mix(${EYEWALL.tiers[0][0].toFixed(1)}, ${EYEWALL.tiers[0][1].toFixed(1)}, texture(fieldNoise, vec3(way * 5.2, 0.13)).a);
  float second = mix(${EYEWALL.tiers[1][0].toFixed(1)}, ${EYEWALL.tiers[1][1].toFixed(1)}, texture(fieldNoise, vec3(way * 3.6 + 0.4, 0.57)).a);
  float amount = eyewallTier(r, face, z, first);
  amount = max(amount, eyewallTier(r, face + ${EYEWALL.steps[0].toFixed(1)}, z, second));
  // The top tier, in broad towers, in clusters, each a column standing in from it, the tallest standing in
  // farthest.
  float clusters = texture(fieldNoise, vec3(way * 1.1, z * 0.00003 + 0.21)).a;
  float towers = texture(fieldNoise, vec3(way * 2.3 + 0.5, z * 0.00005 + 0.63)).a;
  float column = smoothstep(0.35, 0.85, clusters * 0.4 + towers * 0.6);
  float heads = texture(fieldNoise, vec3(way * 6.5, 0.83)).a;
  float top = mix(${EYEWALL.top[0].toFixed(1)}, EYEWALL_TOP, 0.86 * column + 0.14 * heads);
  float back = face + ${(EYEWALL.steps[0] + EYEWALL.steps[1]).toFixed(1)} - ${EYEWALL.towers.toFixed(1)} * column;
  amount = max(amount, eyewallTier(r, back, z, top));
  if (skirt) {
    // The skirt: lumpy, flat bottomed, its tops at different heights, in from the wall's foot.
    float skirtTop = mix(${(EYEWALL.skirt[0] + 380).toFixed(1)}, ${EYEWALL.skirt[1].toFixed(1)}, texture(fieldNoise, vec3(q / 6100.0, 0.47)).a);
    float skirtCells = texture(fieldNoise, vec3(q / 3300.0, 0.29)).a;
    float inSkirt = smoothstep(${(EYEWALL.radius - EYEWALL.skirtReach).toFixed(1)}, ${(EYEWALL.radius - EYEWALL.skirtReach + 1400).toFixed(1)}, r) *
      smoothstep(${EYEWALL.skirt[0].toFixed(1)}, ${(EYEWALL.skirt[0] + 160).toFixed(1)}, z) *
      (1.0 - smoothstep(skirtTop - 320.0, skirtTop, z)) * smoothstep(0.2, 0.62, skirtCells);
    amount = max(amount, inSkirt * 0.92);
  }
  if (amount <= 0.0) return 0.0;
  vec3 at = vec3(q, z * 1.25 - fieldSky.storm.x * ${(EYEWALL.rise * 40).toFixed(1)}) / shape;
  float billows = texture(fieldNoise, at).r;
  float density = remap(billows + dilate, 1.0 - amount, 1.0, 0.0, 1.0);
  if (density <= 0.0) return 0.0;
  if (fine) {
    vec3 detailAt = at * ${EYEWALL.detail.toFixed(2)} + vec3(0.0, 0.0, 0.17);
    float detail = texture(fieldNoise, detailAt).g * 0.5 + texture(fieldNoise, detailAt * 2.4).g * 0.3 +
      texture(fieldNoise, detailAt * 5.1).b * 0.2;
    eyewallDetail = detail;
    density = remap(density, (1.0 - detail) * 0.24, 1.0, 0.0, 1.0);
  }
  density = clamp(density, 0.0, 1.0);
  return density * density * (1.6 - 0.6 * density);
}

// The eye's wall, all round the camera.
float eyewallDensity(vec3 p, bool fine, float dilate) {
  if (p.z < 0.0 || p.z > EYEWALL_TOP) return 0.0;
  float r;
  vec2 way = eyewallWay(p.xy - fieldSky.eye.xy, r);
  return stormWallDensity(r, way, way * r, p.z, ${EYEWALL.shape.toFixed(1)}, fine, dilate, true);
}

// The departing storm's wall, across the east, farther the farther it has gone, and carried east with it: the
// same tiers, so far off that its billows are larger to be seen.
float departingDensity(vec3 p, bool fine, float dilate) {
  if (p.z < 0.0 || p.z > EYEWALL_TOP) return 0.0;
  vec2 offset = p.xy - fieldSky.eye.xy;
  float r = offset.x - fieldSky.veil.w + ${EYEWALL.radius.toFixed(1)};
  vec2 way = vec2(offset.y / ${DEPARTING.along.toFixed(1)} + 0.31, 1.0);
  vec2 q = offset - vec2(fieldSky.veil.w, 0.0);
  return stormWallDensity(r, way, q, p.z, ${DEPARTING.shape.toFixed(1)}, fine, dilate, false);
}

float stormWallAt(vec3 p, bool fine, float dilate, bool departing) {
  return departing ? departingDensity(p, fine, dilate) : eyewallDensity(p, fine, dilate);
}

// A march through a wall of the storm, as the cumulus's is: how much light comes back, and how much of what is
// behind gets through. In the eye the sun high over it lights the inner face, the tops of its tiers and the heads
// of its towers, and the billows shade each other below and in their clefts. The departing wall stands in the shade
// of its own deck, lit by the clear sky in the west, but along its foot, which the low sun gets in under.
vec4 stormWallMarch(vec3 direction, float jitter, vec3 eyePosition, vec3 flashLight, vec3 air, bool departing) {
  if (direction.z < 0.004) return vec4(0.0, 0.0, 0.0, 1.0);
  float lean = ${EYEWALL.lean.toFixed(3)};
  // Out from the camera: all round for the eye, and toward the east for the departing wall, which stands that far
  // farther off.
  float across = departing ? direction.x : max(length(direction.xy), 1e-4);
  float offset = departing ? fieldSky.veil.w - ${EYEWALL.radius.toFixed(1)} : 0.0;
  if (across < 0.05) return vec4(0.0, 0.0, 0.0, 1.0);
  // Where the ray could first meet cloud: the skirt's inner edge, or the wall's innermost reach.
  float innermost = offset + ${(EYEWALL.radius - EYEWALL.towers - EYEWALL.edge).toFixed(1)};
  float facing = across - lean * direction.z;
  float tWall = facing > 0.02 ? (innermost + lean * eyePosition.z) / facing : 1e9;
  float tSkirt = ${(EYEWALL.radius - EYEWALL.skirtReach).toFixed(1)} / across;
  bool skirt = !departing && eyePosition.z + direction.z * tSkirt < ${EYEWALL.skirt[1].toFixed(1)};
  float near = skirt ? min(tSkirt, tWall) : tWall;
  float far = min((EYEWALL_TOP - eyePosition.z) / direction.z, near + 30000.0);
  if (near >= far) return vec4(0.0, 0.0, 0.0, 1.0);
  float stride = clamp((far - near) / 30.0, 120.0, departing ? 700.0 : 420.0);
  vec3 lightDirection = vCloudLightDirection;
  float cosine = dot(direction, lightDirection);
  float phase = min(mix(henyeyGreenstein(cosine, 0.66), henyeyGreenstein(cosine, -0.2), 0.42) * 12.566, 3.6);
  const float SIGMA = 0.026;
  const float LIGHT_STEP = 230.0;
  float t = near + stride * jitter;
  float lastEmpty = near;
  vec3 light = vec3(0.0);
  float through = 1.0;
  float weight = 0.0;
  float depth = 0.0;
  bool walking = false;
  float empty = 0.0;
  int samples = 0;
  for (int i = 0; i < 64 && t < far && through > 0.03; i++) {
    vec3 p = eyePosition + direction * t;
    float walk = clamp(0.0048 * t, 36.0, departing ? 260.0 : 150.0);
    if (!walking) {
      if (stormWallAt(p, false, 0.14, departing) > 0.0) {
        float inside = t;
        float outside = lastEmpty;
        for (int j = 0; j < 4; j++) {
          float middle = 0.5 * (inside + outside);
          if (stormWallAt(eyePosition + direction * middle, false, 0.14, departing) > 0.0) inside = middle;
          else outside = middle;
        }
        t = inside;
        walking = true;
        empty = 0.0;
      } else {
        lastEmpty = t;
        t += stride;
      }
      continue;
    }
    float density = stormWallAt(p, true, 0.0, departing);
    if (density > 0.0) {
      if (weight <= 0.0 && empty > 0.0) {
        float inside = t;
        float outside = t - walk;
        for (int j = 0; j < 3; j++) {
          float middle = 0.5 * (inside + outside);
          if (stormWallAt(eyePosition + direction * middle, true, 0.0, departing) > 0.0) inside = middle;
          else outside = middle;
        }
        t = inside + walk * jitter * 0.4;
        p = eyePosition + direction * t;
        density = max(stormWallAt(p, true, 0.0, departing), 0.03);
      }
      empty = 0.0;
      float detailHere = eyewallDetail;
      float tau = 0.0;
      float along = LIGHT_STEP * 0.4;
      vec3 toward = p;
      int looks = samples < 2 ? 5 : 3;
      for (int j = 0; j < looks; j++) {
        toward += lightDirection * along;
        tau += stormWallAt(toward, j < 2, 0.0, departing) * along;
        along *= 2.6;
      }
      // And toward the open sky, in toward the camera and up, for how much of it this sees: little under a tier
      // or a tower's head.
      vec2 inward = departing ? vec2(-1.0, 0.0) : -normalize(p.xy - eyePosition.xy);
      vec3 skyward = normalize(vec3(inward * 0.55, 0.84));
      float tauUp = stormWallAt(p + skyward * 220.0, false, 0.0, departing) * 220.0 +
        stormWallAt(p + skyward * 760.0, false, 0.0, departing) * 540.0;
      float height = clamp(p.z / EYEWALL_TOP, 0.0, 1.0);
      vec3 sun = mix(vCloudSunLow, vCloudSunHigh, height);
      // Light straight through, and what has scattered on through more of it, softer, rounder and deeper.
      float lit = exp(-SIGMA * 0.9 * tau) * phase + 0.24 * exp(-SIGMA * 0.3 * tau) * (0.5 + 0.5 * phase) +
        0.03 * exp(-SIGMA * 0.1 * tau);
      float powder = mix(1.0, 1.0 - exp(-density * 7.0), 0.55 * (0.5 - 0.5 * cosine));
      float crevice = mix(0.55, 1.1, smoothstep(0.3, 0.8, detailHere));
      vec3 direct = sun * lit * powder * crevice;
      float open = exp(-SIGMA * 0.12 * tauUp);
      // What comes up from below is off dark wet crowns and water, not sand.
      vec3 sky = mix(vCloudBounce * 0.3, vCloudSky, open) * mix(0.3, 0.9, open) * mix(0.8, 1.05, crevice - 0.55);
      vec3 source;
      if (departing) {
        // In the shade of its deck, but for a low band along its foot that the low sun gets in under, warm, and
        // never brighter than a sunlit cloud: no point of it a second sun.
        float underDeck = smoothstep(60.0, 700.0, p.z) *
          (1.0 - smoothstep(${DEPARTING.footLit[0].toFixed(1)}, ${DEPARTING.footLit[1].toFixed(1)}, p.z));
        vec3 foot = direct * ${toGlslVec3(DECK_FRONT.gold)} * underDeck * ${DEPARTING.footGain.toFixed(2)};
        foot /= 1.0 + max(max(foot.r, foot.g), foot.b) / ${DEPARTING.footMost.toFixed(2)};
        source = foot + sky * ${toGlslVec3(DEPARTING.shade)};
      } else {
        // Its foot darker in its own rain.
        float foot = mix(${EYEWALL.foot.toFixed(2)}, 1.0, smoothstep(400.0, 6000.0, p.z));
        source = (direct * 0.78 + sky) * foot;
      }
      source += flashLight * (0.4 + 0.6 * density);
      float stepHere = walk * (1.0 + 0.3 * float(samples));
      float fade = exp(-SIGMA * density * stepHere);
      light += through * source * (1.0 - fade);
      depth += t * through * (1.0 - fade);
      weight += through * (1.0 - fade);
      through *= fade;
      t += stepHere;
      samples++;
    } else {
      empty += 1.0;
      t += walk * (1.0 + 0.4 * empty);
      if (empty > 7.0) {
        walking = false;
        lastEmpty = t;
        t += stride * 0.5;
      }
    }
  }
  if (weight > 0.0) {
    depth /= weight;
    // The air between, more of it low down.
    float airLeft = exp(-depth * mix(0.7e-5, 1.6e-5, fieldAir.haze.w) * mix(1.6, 0.8, smoothstep(0.05, 0.5, direction.z)) *
      (departing ? ${DEPARTING.washed.toFixed(2)} : 1.0));
    light = mix(air * (1.0 - through), light, airLeft);
  }
  // Toward the horizon cloud runs together with the haze, but for the departing wall, which stands on it.
  float shown = departing ? smoothstep(0.0, 0.006, direction.z) : smoothstep(0.004, 0.03, direction.z);
  return vec4(light * shown, mix(1.0, through, shown));
}

// The cumulus, and the storm's wall behind them, the eye's or the departing one: what the cloud pass and the probe
// draw.
vec4 cloudMarch(vec3 direction, float jitter, vec3 eyePosition, vec3 flashLight, vec3 air) {
  vec4 cumulus = cumulusMarch(direction, jitter, eyePosition, flashLight, air);
  bool departing = fieldSky.front.w > 1.5 && fieldAir.weather.x > 0.0;
  if (fieldAir.weather.y <= 0.0 && !departing) return cumulus;
  // Out to the departing wall the air is in the shade of its deck.
  vec3 between = departing ? air * ${toGlslVec3(DEPARTING.air)} : air;
  vec4 wall = stormWallMarch(direction, jitter, eyePosition, flashLight, between, departing);
  return vec4(cumulus.rgb + cumulus.a * wall.rgb, cumulus.a * wall.a);
}
`;

/**
 * Cumulus on its own, into a target of half the frame's size, a quarter of its pixels. It is what costs the
 * most of the sky, and is soft by nature, and with an accumulator's jitter it comes back to full resolution.
 */
const CLOUD_FRAGMENT = /* glsl */ `#version 300 es
#define SHADER_NAME field-cloud-fs
${SKY_FRAGMENT_HEAD}
${CUMULUS_GLSL}

void main() {
  vec3 direction = normalize(vRay);
  vec3 above = normalize(vec3(direction.xy, max(direction.z, FIELD_HORIZON_Z)));
  vec3 clear = fieldAirLight(above, vAirRayleigh, vAirAerosol, vAirOther);
  fragColor = cloudMarch(
    direction,
    fieldPixelNoise(gl_FragCoord.xy),
    fieldSky.eye.xyz,
    getFlashLight(direction),
    clear
  );
}
`;

/** Everything of the sky but the cumulus, toward a direction, as linear light: `skyLight`. */
const SKY_LIGHT_GLSL = /* glsl */ `
// The weather's noise, which the rain under the decks shares with the weather's slices.
uniform sampler3D weatherNoise;
${WEATHER_CURTAIN_GLSL}

// ---------------------------------------------------------------- Stars

float starHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// Turned about the celestial pole, at 28 degrees north, into the star field's own frame.
vec3 starFrame(vec3 direction) {
  vec3 pole = vec3(0.0, 0.8829476, 0.4694716);
  float angle = fieldSky.extra.x;
  float c = cos(angle);
  float s = sin(angle);
  return direction * c + cross(pole, direction) * s + pole * dot(pole, direction) * (1.0 - c);
}

// The brightness and tint of one scale of stars: at most one to a cell of a cube's faces.
vec3 starCells(vec3 star, float cellsPerFace, float magnitudeLow, float magnitudeHigh, float share, float seed, float pixelAngle) {
  vec3 absolute = abs(star);
  vec3 face;
  vec2 uv;
  if (absolute.x >= absolute.y && absolute.x >= absolute.z) {
    face = vec3(sign(star.x), 0.0, 0.0);
    uv = star.yz / absolute.x;
  } else if (absolute.y >= absolute.z) {
    face = vec3(0.0, sign(star.y), 0.0);
    uv = star.xz / absolute.y;
  } else {
    face = vec3(0.0, 0.0, sign(star.z));
    uv = star.xy / absolute.z;
  }
  vec2 cell = floor(uv * cellsPerFace);
  vec3 id = vec3(cell, seed) + face * 137.0;
  if (starHash(id) > share) return vec3(0.0);
  vec2 place = (cell + 0.5 + 0.8 * (vec2(starHash(id + 11.0), starHash(id + 23.0)) - 0.5)) / cellsPerFace;
  float angle = length(uv - place);
  // A star is a point: its spread is the lens's, a pixel or so, or what is left of a defocused star's disc.
  float spread = max(pixelAngle * 0.8, fieldSky.extra.w * 0.55);
  float shape = exp(-angle * angle / (2.0 * spread * spread));
  float pick = starHash(id + 41.0);
  // Three times as many stars for each step fainter.
  float magnitude = mix(magnitudeLow, magnitudeHigh, pow(pick, 0.42));
  float brightness = pow(10.0, -0.4 * (magnitude - 1.0));
  float warm = starHash(id + 57.0);
  vec3 tint = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.82, 0.62), warm * warm);
  return tint * brightness * shape;
}

vec3 starField(vec3 direction, float pixelAngle) {
  float visible = fieldAir.haze.z;
  if (visible <= 0.0) return vec3(0.0);
  vec3 star = starFrame(direction);
  vec3 light = vec3(0.0);
  light += starCells(star, 5.0, -0.5, 2.5, 0.55, 3.0, pixelAngle);
  light += starCells(star, 16.0, 2.5, 4.5, 0.75, 5.0, pixelAngle);
  light += starCells(star, 44.0, 4.2, 6.2, 0.85, 7.0, pixelAngle);
  // The Milky Way: a band, broken up by dust and full of faint stars.
  vec3 pole = normalize(vec3(0.31, -0.42, 0.85));
  float across = dot(star, pole);
  float band = exp(-across * across * 26.0);
  float dust = texture(fieldNoise, star * 0.55 + 0.3).a;
  float clump = texture(fieldNoise, star * 1.6).r;
  light += vec3(0.052, 0.058, 0.08) * band * smoothstep(0.25, 0.8, dust * 0.65 + clump * 0.35);
  light += starCells(star, 90.0, 5.8, 7.2, 0.55 + 0.4 * band, 9.0, pixelAngle) * 1.2;
  return light * 1.5 * visible;
}

// ---------------------------------------------------------------- Sun and moon

vec3 sunDisc(vec3 direction, float pixelAngle) {
  float cosine = dot(direction, fieldAir.sun.xyz);
  if (cosine < 0.9) return vec3(0.0);
  float angle = acos(min(cosine, 1.0));
  const float RADIUS = 0.0052;
  float edge = max(pixelAngle, 0.0006);
  float disc = 1.0 - smoothstep(RADIUS - edge, RADIUS + edge, angle);
  float mu = sqrt(max(1.0 - pow(angle / RADIUS, 2.0), 0.0));
  float limb = 0.42 + 0.58 * mu;
  float glow = 0.9 * exp(-angle / 0.012) + 0.1 * exp(-angle / 0.05);
  return vSunThrough * (disc * limb * 260.0 + glow * 6.0);
}

vec3 moonDisc(vec3 direction, float pixelAngle, out float cover) {
  cover = 0.0;
  vec3 moon = fieldAir.moon.xyz;
  float cosine = dot(direction, moon);
  float visible = smoothstep(-0.25, 0.1, -fieldAir.sun.w);
  if (cosine < 0.98 || moon.z < -0.02 || visible <= 0.0) return vec3(0.0);
  float angle = acos(min(cosine, 1.0));
  const float RADIUS = 0.0065;
  float edge = max(pixelAngle, 0.0005);
  float disc = 1.0 - smoothstep(RADIUS - edge, RADIUS + edge, angle);
  cover = disc * visible;
  // Its own face: seas from noise, across a disc.
  vec3 side = normalize(cross(moon, vec3(0.0, 0.0, 1.0)));
  vec3 up = cross(side, moon);
  vec2 uv = vec2(dot(direction - moon, side), dot(direction - moon, up)) / RADIUS;
  float seas = texture(fieldNoise, vec3(uv * 0.11 + 0.23, 0.41)).a * 0.6 + texture(fieldNoise, vec3(uv * 0.29 + 0.6, 0.77)).a * 0.4;
  float albedo = mix(0.62, 1.0, smoothstep(0.32, 0.68, seas));
  float roundness = sqrt(max(1.0 - dot(uv, uv), 0.0));
  vec3 color = vec3(1.0, 0.97, 0.9) * albedo * (0.72 + 0.28 * roundness) * 2.6;
  float halo = 0.035 * exp(-angle / 0.03) + 0.012 * exp(-angle / 0.12);
  return (color * disc + vec3(0.75, 0.82, 1.0) * halo) * visible;
}

// ---------------------------------------------------------------- Cirrus

// High ice, flat, in patches, combed out along the upper wind and curling at its ends.
vec4 cirrus(vec3 direction, vec3 behind) {
  if (direction.z < 0.015) return vec4(0.0);
  const float HEIGHT = 9500.0;
  float t = (HEIGHT - fieldSky.eye.z) / direction.z;
  vec2 q = (fieldSky.eye.xy + direction.xy * t + fieldSky.cloud.zw * 0.35) / 1000.0;
  float patches = texture(fieldNoise, vec3(q * 0.011, 0.59)).a;
  float amount = (0.3 + 0.7 * fieldAir.haze.w) * (1.0 - fieldAir.weather.x);
  amount *= smoothstep(0.42, 0.78, patches);
  if (amount <= 0.0) return vec4(0.0);
  q = mat2(0.906, 0.423, -0.423, 0.906) * q;
  vec2 warp = vec2(
    texture(fieldNoise, vec3(q * 0.045, 0.11)).a,
    texture(fieldNoise, vec3(q * 0.045 + 0.37, 0.67)).a
  ) - 0.5;
  q += warp * 1.6;
  float wisp = texture(fieldNoise, vec3(q.x * 0.03, q.y * 0.33, 0.37)).a;
  float fine = texture(fieldNoise, vec3(q.x * 0.085, q.y * 1.1, 0.71)).a;
  float hair = texture(fieldNoise, vec3(q.x * 0.21, q.y * 3.4, 0.13)).a;
  float combed = fine * 0.62 + hair * 0.38;
  float alpha = smoothstep(0.52, 0.84, wisp) * (0.2 + 0.8 * smoothstep(0.38, 0.74, combed)) * 0.2 * amount;
  alpha *= smoothstep(0.015, 0.1, direction.z);
  if (alpha <= 0.0) return vec4(0.0);
  float cosine = dot(direction, vCloudLightDirection);
  float phase = 0.5 + 0.8 * henyeyGreenstein(cosine, 0.72) * 12.566;
  vec3 color = vCloudSunHigh * phase * 0.34 + vCloudSky * 0.7;
  float airLeft = exp(-t / 90000.0);
  return vec4(mix(behind, color, airLeft), alpha);
}

// ---------------------------------------------------------------- The hurricane

// One deck's thickness, 0-1, in the swirl's own coordinates, so it runs along the spiral and has no seam. Its
// finer octaves are only as much of themselves as fine says: low down the look along the deck draws them out
// into brush strokes and grain, so there the deck goes smooth, as haze and distance make it.
float deckNoise(vec2 q, float swirl, float stretch, float scale, float seed, float fine) {
  float r = max(length(q), 200.0);
  float logR = log(r);
  // A log spiral in the bands, which turn faster nearer the eye.
  float twist = 1.6 * logR + swirl * 256.0 / max(r, 2000.0);
  float theta = atan(q.y, q.x) - twist;
  vec2 around = vec2(cos(theta), sin(theta)) * scale;
  vec3 place = vec3(around, logR * stretch * scale + seed);
  // Turbulence, in the swirl's own frame so it goes with the deck: its cells torn and their edges wandering, so a
  // look along it at a low angle sees them ragged, not drawn out into straight strokes.
  vec3 turbulence = vec3(
    texture(fieldNoise, place * 1.5 + vec3(0.37, 0.11, 0.0)).a,
    texture(fieldNoise, place * 1.5 + vec3(0.71, 0.53, 0.29)).a,
    texture(fieldNoise, place * 1.5 + vec3(0.13, 0.89, 0.61)).a
  ) - 0.5;
  place += turbulence * 0.42;
  float low = texture(fieldNoise, place).a;
  float mid = texture(fieldNoise, vec3(place.xy * 2.7 + 0.3, place.z * 2.7 + seed)).a;
  float high = texture(fieldNoise, vec3(place.xy * 7.3 + 0.7, place.z * 7.3 + seed * 1.6)).r;
  float midShare = smoothstep(0.0, 0.45, fine);
  return low * 0.56 + mix(0.5, mid, midShare) * 0.3 + mix(0.5, high, fine * fine) * 0.14;
}

// The storm's three broad spiral bands, 0-1, turning with its swirl.
float bandShape(vec2 q, float swirl) {
  float r = max(length(q), 200.0);
  float twist = 1.6 * log(r) + swirl * 256.0 / max(r, 2000.0);
  float theta = atan(q.y, q.x) - twist;
  return 0.5 + 0.5 * sin(3.0 * theta);
}

// How much of a deck's finer octaves to draw toward this direction: none low down, where the look along it
// stretches them, and all of them high up.
float deckFine(float z) {
  return smoothstep(0.07, 0.42, z);
}

// A deck's underside, which hangs down in lumps where it is thick: the first place along the ray that meets it,
// marching up through the lumps from as low as they hang to the deck's own height. A look along it at a low angle
// then sees lobes in front of lobes, ragged, rather than its cells drawn out into brush strokes. Gives the place on
// the deck, and there its cells, its bands, and how far up the lumps it is, 0 at the lowest to 1 at the deck.
vec2 deckRelief(
  vec3 eyePosition,
  vec3 direction,
  vec2 center,
  float height,
  float hang,
  float swirl,
  float stretch,
  float scale,
  float seed,
  float fine,
  float bands,
  out float cells,
  out float band,
  out float lift
) {
  float z = max(direction.z, 0.012);
  float low = (height - hang - eyePosition.z) / z;
  float high = (height - eyePosition.z) / z;
  float lastT = low;
  float lastGap = -1.0;
  vec2 q = eyePosition.xy + direction.xy * high - center;
  cells = 0.5;
  band = 0.5;
  lift = 1.0;
  for (int i = 0; i <= 6; i++) {
    float t = mix(low, high, float(i) / 6.0);
    vec2 here = eyePosition.xy + direction.xy * t - center;
    float value = deckNoise(here, swirl, stretch, scale, seed, fine);
    float shape = bands > 0.0 ? bandShape(here, swirl) : 0.5;
    float thickness = smoothstep(0.3, 0.78, mix(value, value * 0.62 + shape * 0.38, bands));
    float gap = eyePosition.z + direction.z * t - (height - hang * thickness);
    if (gap >= 0.0 || i == 6) {
      // Between the last look and this one, where the ray crossed the lumps' surface.
      float u = i == 0 ? 0.0 : clamp(lastGap / min(lastGap - gap, -1e-3), 0.0, 1.0);
      float at = mix(lastT, t, u);
      q = eyePosition.xy + direction.xy * at - center;
      cells = deckNoise(q, swirl, stretch, scale, seed, fine);
      band = bands > 0.0 ? bandShape(q, swirl) : 0.5;
      lift = clamp((eyePosition.z + direction.z * at - (height - hang)) / max(hang, 1.0), 0.0, 1.0);
      break;
    }
    lastT = t;
    lastGap = gap;
  }
  return q;
}

// Light that a flash adds, with a soft shoulder, so a deck it lights keeps its cells and never clips.
vec3 flashShoulder(vec3 light) {
  const float MOST = 0.3;
  return light / (1.0 + max(max(light.r, light.g), light.b) / MOST);
}

// The outer band's rain shaft on the arrival: one broad, soft fall streak hanging from the deck's base to the
// east, leaning downwind as it falls, wider and fainter toward the ground, with long soft fibres down it and no
// hard sides.
vec4 stormShaft(vec3 direction, float elevation) {
  float bearing = atan(direction.x, direction.y);
  float top = ${SHAFT.top.toFixed(3)} + 0.02 * (texture(fieldNoise, vec3(bearing * 0.9, 0.71, 0.23)).a - 0.5);
  if (elevation > top + 0.03) return vec4(0.0);
  // 0 at the ground to 1 at the deck's base.
  float down = clamp(elevation / top, 0.0, 1.0);
  // Its middle leans downwind, to the north, the lower it is, and it widens as it falls.
  float middle = ${SHAFT.bearing.toFixed(4)} - ${SHAFT.lean.toFixed(4)} * (1.0 - down);
  float width = mix(${SHAFT.widthLow.toFixed(4)}, ${SHAFT.widthHigh.toFixed(4)}, down);
  float across = (bearing - middle) / width;
  float body = exp(-across * across * 1.3);
  if (body < 0.004) return vec4(0.0);
  // Fibres along the fall, slow and soft, drifting with the band.
  float drift = fieldSky.storm.x * 0.08;
  float fibres = texture(fieldNoise, vec3(across * 0.55 + down * 0.35, down * 0.5 + drift, 0.53)).a * 0.65 +
    texture(fieldNoise, vec3(across * 1.3 + down * 0.8 + 0.3, down * 1.1 + drift * 1.7, 0.17)).a * 0.35;
  // It comes out of the base softly, is thickest just under it, and fades into the haze toward the ground.
  float hanging = (1.0 - smoothstep(top - 0.03, top + 0.01, elevation)) * mix(0.45, 1.0, smoothstep(0.0, 0.7, down));
  float amount = body * hanging * mix(0.55, 1.1, smoothstep(0.3, 0.72, fibres));
  float daylight = fieldSky.veil.z;
  vec3 color = mix(fieldAir.fog.rgb, vec3(0.12, 0.135, 0.14) * daylight, mix(0.5, 0.7, body));
  return vec4(color, min(amount * 0.8, 0.85));
}

vec3 stormSky(vec3 direction, vec3 behind, vec3 flashLight, vec3 eyePosition, vec4 clouds) {
  float storm = fieldAir.weather.x;
  float eye = fieldAir.weather.y;
  vec2 center = fieldSky.storm.yz;
  float swirl = fieldSky.storm.x;
  float z = max(direction.z, 0.012);
  float elevation = asin(clamp(direction.z, -1.0, 1.0));
  vec3 fog = fieldAir.fog.rgb;
  float daylight = fieldSky.veil.z;
  float mode = fieldSky.front.w;
  float fine = deckFine(direction.z);
  // Deep blue-grey as it departs, seen through air in its own shadow.
  float departing = mode > 1.5 ? 1.0 : 0.0;
  fog *= mix(vec3(1.0), ${toGlslVec3(DECK_FRONT.shadowed)}, departing);

  // The upper deck, solid and slow: what the light has come through.
  float tUp = ${STORM_DECKS.upper.height.toFixed(1)} / z;
  vec2 qUp = eyePosition.xy + direction.xy * tUp - center;
  float up = deckNoise(qUp, swirl * ${STORM_DECKS.upper.swirl.toFixed(2)}, ${STORM_DECKS.upper.stretch.toFixed(2)}, ${STORM_DECKS.upper.scale.toFixed(2)}, 0.1, 1.0);
  vec3 upColor = mix(vec3(0.075, 0.1, 0.09), vec3(0.3, 0.335, 0.32), smoothstep(0.34, 0.74, up)) * daylight *
    mix(1.0, 0.45, departing);

  // The main deck: thick bands of it, its base dark and its breaks pale, ragged cells rather than brushed.
  float tMain = ${STORM_DECKS.main.height.toFixed(1)} / z;
  float main;
  float band;
  float mainLift;
  vec2 qMain = deckRelief(eyePosition, direction, center, ${STORM_DECKS.main.height.toFixed(1)}, ${STORM_DECKS.main.hang.toFixed(1)}, swirl,
    ${STORM_DECKS.main.stretch.toFixed(2)}, ${STORM_DECKS.main.scale.toFixed(2)}, 0.45, fine, 1.0, main, band, mainLift);
  float thick = smoothstep(0.32, 0.66, main * 0.62 + band * 0.38);
  // Gone by, its far underside is smooth with distance and the washed air low down, where a look along it would
  // draw its cells out into strokes.
  float evened = departing * (1.0 - smoothstep(0.1, 0.5, direction.z)) * 0.85;
  thick = mix(thick, 0.7, evened);
  mainLift = mix(mainLift, 0.6, evened);
  vec3 breaks = mix(${toGlslVec3(STORM_DECKS.breaks)}, ${toGlslVec3(STORM_DECKS.departingBreaks)}, departing);
  vec3 base = mix(${toGlslVec3(STORM_DECKS.base)}, ${toGlslVec3(STORM_DECKS.departingBase)}, departing);
  // Darkest under the lowest lumps, which hang in their own shade, and pale up in the gaps between them.
  vec3 mainColor = mix(breaks, base, thick) * mix(0.72, 1.12, mainLift);
  // Green-grey, as light is through deep water.
  mainColor *= mix(vec3(1.0), vec3(0.9, 1.04, 0.96), thick * (1.0 - departing));
  mainColor *= daylight;
  float mainAlpha = mix(smoothstep(0.2, 0.46, main * 0.7 + band * 0.3), 1.0, evened);

  // Scud: low, torn and racing, darker than what is above it.
  float tScud = ${STORM_DECKS.scud.height.toFixed(1)} / z;
  float scud;
  float scudBand;
  float scudLift;
  vec2 qScud = deckRelief(eyePosition, direction, center, ${STORM_DECKS.scud.height.toFixed(1)}, ${STORM_DECKS.scud.hang.toFixed(1)},
    swirl * ${STORM_DECKS.scud.swirl.toFixed(2)}, ${STORM_DECKS.scud.stretch.toFixed(2)}, ${STORM_DECKS.scud.scale.toFixed(2)}, 0.8, fine, 0.0,
    scud, scudBand, scudLift);
  // Torn at its edges by finer cells of its own, racing with it, so its fragments are ragged, not round.
  float torn = deckNoise(qScud, swirl * ${STORM_DECKS.scud.swirl.toFixed(2)}, ${STORM_DECKS.scud.stretch.toFixed(2)},
    ${(STORM_DECKS.scud.scale * 3.3).toFixed(2)}, 1.7, 1.0);
  // Torn dark fragments, racing; they go into the haze only right down at the horizon.
  float scudAlpha = smoothstep(0.52, 0.6, scud + (torn - 0.5) * 0.3) * 0.94 * (1.0 - departing * 0.6) *
    smoothstep(0.02, 0.08, direction.z);
  vec3 scudColor = ${toGlslVec3(STORM_DECKS.scudColor)} * mix(1.2, 0.8, smoothstep(0.55, 0.85, scud)) *
    mix(0.8, 1.1, scudLift) * daylight;

  // Each deck goes into the rain with distance: less so once it has gone by, through the washed air.
  float haze = mix(0.00008, 0.00016, smoothstep(0.003, 0.012, fieldAir.fog.w)) * mix(1.0, 0.35, departing);
  vec3 color = mix(fog, upColor, exp(-haze * tUp * 0.5));
  color = mix(color, mix(fog, mainColor, exp(-haze * tMain)), mainAlpha);
  color = mix(color, mix(fog, scudColor, exp(-haze * tScud * 1.4)), scudAlpha);

  // Lightning lights the decks from within, patchily, around where it is, brightest where they are thin, and
  // with a shoulder, so their cells still show at its peak.
  color = color * (1.0 + 0.15 * fieldAir.flash.w) +
    flashShoulder(flashLight * (0.25 + 1.1 * (1.0 - thick)) * mix(0.45, 1.0, smoothstep(0.2, 0.75, main)));

  // The eye: the deck opens from overhead down to the horizon, raggedly, onto the eye's hazy blue and the stadium
  // of its wall all round, which the cumulus pass marched, and which are what is behind.
  float patches = band * 0.5 + main * 0.5;
  if (eye > 0.0) {
    float opening = mix(1.75, -0.06, smoothstep(0.0, 0.92, eye)) + (patches - 0.5) * 0.16;
    color = mix(color, behind, smoothstep(opening - 0.02, opening + 0.05, elevation));
  }

  // The hurricane comes and goes: bands first, then the whole deck.
  float cover = smoothstep(0.0, 1.0, storm);
  float arrive = smoothstep(1.0 - cover * 1.5, 1.25 - cover * 1.1, patches + 0.08);
  float amount = min(arrive, cover * 1.6);
  if (mode > 0.5) {
    // Its edge, ragged by its own cells: arriving, it comes over from behind; clearing, it breaks from the west.
    float along = dot(direction.xy * tMain, fieldSky.front.xy) + (patches - 0.5) * ${DECK_FRONT.ragged.toFixed(1)};
    float inside = fieldSky.front.z - along;
    float edge = smoothstep(-600.0, 600.0, inside);
    // Whole behind its edge, from the first as it arrives, and as it departs until it is nearly gone: its
    // edge, not a fade, takes it away.
    float body = departing > 0.5 ? smoothstep(0.0, 0.25, storm) : smoothstep(0.0, 0.12, storm);
    amount = max(edge, amount * 0.6) * body;
    if (departing > 0.5) {
      // The departing deck's base, lit warm by the low sun that comes in under its trailing edge.
      float sunLow = smoothstep(0.02, 0.2, fieldAir.sun.w) * (1.0 - smoothstep(0.45, 0.75, fieldAir.sun.w));
      float underside = exp(-max(inside, 0.0) / ${DECK_FRONT.undersideReach.toFixed(1)}) * edge * sunLow;
      color += vSunThrough * ${toGlslVec3(DECK_FRONT.gold)} * ${STORM_DECKS.underside.toFixed(2)} * underside *
        mix(1.0, 0.55, thick) * exp(-haze * tMain);
    }
  }
  vec3 sky = mix(behind, color, max(amount, eye));
  if (mode > 0.5 && mode < 1.5) {
    vec4 shaft = stormShaft(direction, elevation);
    sky = mix(sky, shaft.rgb, shaft.a * smoothstep(0.02, 0.2, storm) * (1.0 - smoothstep(0.55, 0.9, storm)));
  }
  if (departing > 0.5) {
    // The departing wall stands in front of the deck's far base, which it hides, and fades out as it goes.
    float present = smoothstep(${DEPARTING.fades[0].toFixed(2)}, ${DEPARTING.fades[1].toFixed(2)}, storm);
    sky = sky * mix(1.0, clouds.a, present) + clouds.rgb * present;
  }
  return sky;
}

// ---------------------------------------------------------------- The rain under the decks

// The rain past the weather's own slices, out to the cloud base, in sheets that follow theirs, so they sweep the
// horizon rather than grey all of it. A sample in each of four stretches of the ray, each a little larger than
// the last, as the sheets far off are drawn larger than they are, so no pixel's sample is lost between them.
vec3 rainVeil(vec3 direction, vec3 sky, vec3 eyePosition, vec3 flashLight) {
  // As the weather's slices have it: a shower is far clearer than its share of a storm.
  float rain = pow(fieldSky.rainFall.w, ${WEATHER_RAIN_VEIL_POWER.toFixed(2)});
  float fog = max(fieldAir.fog.w - ${RAIN_VEIL.clearFog.toFixed(4)}, 0.0);
  if (rain <= 0.0 && fog <= 0.0) return sky;
  float z = max(direction.z, 0.004);
  float reach = max(${RAIN_VEIL.top.toFixed(1)} - eyePosition.z, 50.0) / z;
  // Once the storm has gone by, what fog is left is low showers, not a veil to the cloud base. Under the
  // departing deck the air is in its shadow, but where the low sun gets in under its trailing edge.
  bool departing = fieldSky.front.w > 1.5;
  float washed = departing ? ${DECK_FRONT.washed.toFixed(2)} : 1.0;
  float density = (rain * ${RAIN_VEIL.rain.toFixed(6)} + fog * ${RAIN_VEIL.fog.toFixed(4)}) * washed;
  vec3 airLight = fieldAir.fog.rgb * mix(1.0, 0.82, smoothstep(0.0, 0.3, z)) + flashShoulder(flashLight * 0.2);
  float sunLow = smoothstep(0.02, 0.2, fieldAir.sun.w) * (1.0 - smoothstep(0.45, 0.75, fieldAir.sun.w));
  vec3 light = vec3(0.0);
  float through = 1.0;
  float from = ${RAIN_VEIL.from.toFixed(1)};
  for (int i = 0; i < 4; i++) {
    float to = from * 2.6;
    float near = min(from, reach);
    float far = min(to, reach);
    if (far > near) {
      float middle = sqrt(near * far);
      vec3 point = eyePosition + direction * middle;
      float sheets = weatherCurtainAt(
        weatherNoise,
        point,
        fieldSky.rainAcross.xyz,
        fieldSky.veil.xy,
        fieldSky.rainAcross.w,
        fieldSky.rainAbove.w,
        middle / ${RAIN_VEIL.from.toFixed(1)}
      );
      vec3 here = airLight;
      if (departing) {
        float inside = fieldSky.front.z - dot(point.xy - eyePosition.xy, fieldSky.front.xy);
        float shade = smoothstep(0.0, ${DECK_FRONT.sunlit.toFixed(1)}, inside);
        here = mix(here, here * ${toGlslVec3(DECK_FRONT.shadowed)}, shade);
        here += vSunThrough * ${toGlslVec3(DECK_FRONT.gold)} * ${DECK_FRONT.rainGlow.toFixed(2)} * sunLow *
          step(0.0, inside) * (1.0 - shade);
      }
      float share = 1.0 - exp(-density * (far - near) * sheets);
      light += through * share * here;
      through *= 1.0 - share;
    }
    from = to;
  }
  return sky * through + light;
}

// ---------------------------------------------------------------- The far woods

// A low dark line of woods, far off, with a gap here and there. It stands between ground and sky.
float woods(vec3 direction, float pixelAngle) {
  if (direction.z > 0.02) return 0.0;
  float azimuth = atan(direction.y, direction.x);
  vec2 around = vec2(cos(azimuth), sin(azimuth));
  float broad = texture(fieldNoise, vec3(around * 0.31, 0.11)).a;
  float crowns = texture(fieldNoise, vec3(around * 2.3, 0.53)).a;
  float fine = texture(fieldNoise, vec3(around * 8.1, 0.83)).g;
  float height = smoothstep(0.34, 0.5, broad) * (0.0032 + 0.0034 * broad + 0.0026 * crowns + 0.0012 * fine);
  return 1.0 - smoothstep(height - pixelAngle, height + pixelAngle, direction.z);
}

// The whole sky toward a direction, as linear light: the cumulus from its own pass, the sun's disc or not.
vec3 skyLight(vec3 direction, float pixelAngle, vec4 cumulus, bool withSun) {
  vec3 eyePosition = fieldSky.eye.xyz;
  float z = direction.z;
  float wood = woods(direction, pixelAngle);
  vec3 horizon = z < 0.012 || wood > 0.0 ? fieldHorizon(direction) : vec3(0.0);
  if (fieldSky.front.w > 1.5 && fieldAir.weather.x > 0.0) {
    // Toward the departing storm the far air is in the shade of its deck, and its wall stands on the horizon: no
    // glare there.
    float toward = smoothstep(-0.45, 0.45, dot(normalize(direction.xy + vec2(1e-5)), -fieldSky.front.xy));
    float present = smoothstep(${DEPARTING.fades[0].toFixed(2)}, ${DEPARTING.fades[1].toFixed(2)}, fieldAir.weather.x);
    horizon = mix(horizon, horizon * ${toGlslVec3(DEPARTING.air)} * 1.6, toward * present);
  }

  vec3 color = horizon;
  if (z > 0.0) {
    vec3 above = normalize(vec3(direction.xy, max(z, FIELD_HORIZON_Z)));
    vec3 clear = fieldAirLight(above, vAirRayleigh, vAirAerosol, vAirOther);

    vec3 flashLight = getFlashLight(direction);

    float storm = fieldAir.weather.x;
    float eye = fieldAir.weather.y;
    float deckFull = storm * (1.0 - eye);
    // The departing wall, which the cloud pass marched, stands in front of the deck, not behind it.
    vec4 behindClouds = fieldSky.front.w > 1.5 && storm > 0.0 ? vec4(0.0, 0.0, 0.0, 1.0) : cumulus;

    // What is above all the cloud.
    float moonCover;
    vec3 moon = moonDisc(direction, pixelAngle, moonCover);
    vec3 stars = starField(direction, pixelAngle) * (1.0 - moonCover);
    vec3 sky = clear + stars + moon;
    vec3 sun = withSun ? sunDisc(direction, pixelAngle) : vec3(0.0);

    // Nothing behind a full deck needs working out.
    if (deckFull < 0.995) {
      vec4 ice = cirrus(direction, sky);
      sky = mix(sky, ice.rgb, ice.a);
      sky = sky * behindClouds.a + behindClouds.rgb;
      sky += sun * behindClouds.a * (1.0 - ice.a * 0.7);
      // The glow the haze makes round the sun, warm when it is low, much of it in front of the cloud.
      float fromSun = 1.0 - dot(direction, fieldAir.sun.xyz);
      vec3 glow = vSunThrough * (0.24 * exp(-fromSun * 240.0) + 0.09 * exp(-fromSun * 20.0)) *
        (0.5 + fieldAir.haze.w) * (1.0 - deckFull);
      sky += glow * (0.4 + 0.6 * behindClouds.a);
    }
    if (storm > 0.0) {
      sky = stormSky(direction, sky, flashLight, eyePosition, cumulus);
    }
    sky = rainVeil(direction, sky, eyePosition, flashLight);
    color = z < 0.012 ? mix(horizon, sky, smoothstep(0.0, 0.012, z)) : sky;
  }

  // The woods, behind all of the air they are far off in.
  if (wood > 0.0) {
    vec3 light = vSunThrough * 2.0 * max(fieldAir.sun.z, 0.03) + vCloudSky * 0.5;
    vec3 trees = vec3(0.028, 0.044, 0.03) * light;
    float left = max(exp(-max(fieldAir.fog.w, 0.00012) * 3800.0), 0.0) * 0.8;
    color = mix(color, mix(horizon, trees, left), wood);
  }
  return color;
}
`;

const SKY_FRAGMENT = /* glsl */ `#version 300 es
#define SHADER_NAME field-sky-fs
${SKY_FRAGMENT_HEAD}

// Light and what gets through, of the cumulus, from the pass before this one.
uniform sampler2D fieldClouds;

${SKY_LIGHT_GLSL}

void main() {
  vec3 direction = normalize(vRay);
  float pixelAngle = max(length(dFdx(direction)), length(dFdy(direction)));
  vec4 cumulus = direction.z > 0.0 ? texture(fieldClouds, vPlace * 0.5 + 0.5) : vec4(0.0, 0.0, 0.0, 1.0);
  vec3 color = skyLight(direction, pixelAngle, cumulus, true);
  fragColor = vec4(fieldDither(fieldFilmic(color), gl_FragCoord.xy), 1.0);
}
`;

/**
 * The probe's sky: the same as the frame's, with the cumulus marched for its own rays, and linear light, as water
 * mixes it before its own curve. The sun's disc is left to the water's glint, which is sharper than a probe's texel.
 */
const PROBE_FRAGMENT = /* glsl */ `#version 300 es
#define SHADER_NAME field-sky-probe-fs
${SKY_FRAGMENT_HEAD}
${CUMULUS_GLSL}
${SKY_LIGHT_GLSL}

void main() {
  vec3 direction = normalize(vRay);
  const float TEXEL = ${((2 * Math.PI) / PROBE.width).toFixed(4)};
  vec3 above = normalize(vec3(direction.xy, max(direction.z, FIELD_HORIZON_Z)));
  vec3 clear = fieldAirLight(above, vAirRayleigh, vAirAerosol, vAirOther);
  vec4 cumulus = cloudMarch(direction, 0.5, fieldSky.eye.xyz, getFlashLight(direction), clear);
  vec3 color = skyLight(direction, TEXEL, cumulus, false);
  fragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

/** A linear color as a GLSL vec3. */
function toGlslVec3(color: readonly number[]): string {
  return `vec3(${color.map(value => value.toFixed(3)).join(', ')})`;
}

// ------------------------------------------------------------------ Noise

function hashInteger(x: number, y: number, z: number, salt: number): number {
  let h = Math.imul(x + 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(y + 0x165667b1, 0xc2b2ae35);
  h ^= Math.imul(z + 0x27d4eb2f, 0x2c1b3c6d);
  h = Math.imul(h ^ salt, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Tiling gradient noise, about 0-1, at `frequency` cells to a tile. */
function getGradientNoise(
  x: number,
  y: number,
  z: number,
  frequency: number,
  salt: number
): number {
  const fx = x * frequency;
  const fy = y * frequency;
  const fz = z * frequency;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  const dx = fx - ix;
  const dy = fy - iy;
  const dz = fz - iz;
  const u = fade(dx);
  const v = fade(dy);
  const w = fade(dz);
  let value = 0;
  for (let k = 0; k < 2; k++) {
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const a = (ix + i) % frequency;
        const b = (iy + j) % frequency;
        const c = (iz + k) % frequency;
        const gx = hashInteger(a, b, c, salt) * 2 - 1;
        const gy = hashInteger(a, b, c, salt + 1) * 2 - 1;
        const gz = hashInteger(a, b, c, salt + 2) * 2 - 1;
        const dot = gx * (dx - i) + gy * (dy - j) + gz * (dz - k);
        value += dot * (i ? u : 1 - u) * (j ? v : 1 - v) * (k ? w : 1 - w);
      }
    }
  }
  return value * 0.9 + 0.5;
}

/** Feature points of a tiling cellular noise at `frequency` cells to a tile, as cell offsets. */
function createWorleyPoints(frequency: number, salt: number): Float32Array {
  const points = new Float32Array(frequency * frequency * frequency * 3);
  for (let k = 0; k < frequency; k++) {
    for (let j = 0; j < frequency; j++) {
      for (let i = 0; i < frequency; i++) {
        const at = (i + frequency * (j + frequency * k)) * 3;
        points[at] = hashInteger(i, j, k, salt);
        points[at + 1] = hashInteger(i, j, k, salt + 1);
        points[at + 2] = hashInteger(i, j, k, salt + 2);
      }
    }
  }
  return points;
}

/** 1 at a feature point, falling to 0 a cell away. Billows, as inverted cells. */
function getWorley(
  x: number,
  y: number,
  z: number,
  frequency: number,
  points: Float32Array
): number {
  const fx = x * frequency;
  const fy = y * frequency;
  const fz = z * frequency;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);
  let nearest = 3;
  for (let k = -1; k <= 1; k++) {
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const a = (ix + i + frequency) % frequency;
        const b = (iy + j + frequency) % frequency;
        const c = (iz + k + frequency) % frequency;
        const at = (a + frequency * (b + frequency * c)) * 3;
        const dx = ix + i + points[at] - fx;
        const dy = iy + j + points[at + 1] - fy;
        const dz = iz + k + points[at + 2] - fz;
        const distance = dx * dx + dy * dy + dz * dz;
        if (distance < nearest) nearest = distance;
      }
    }
  }
  return 1 - Math.min(Math.sqrt(nearest), 1);
}

/** Moves values so that a threshold of x leaves the share 1 - x above it, through their own histogram. */
function makeEven(values: Float32Array, out: Uint8Array, channel: number): void {
  const BINS = 4096;
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const scale = (BINS - 1) / Math.max(high - low, 1e-6);
  const counts = new Float64Array(BINS);
  for (const value of values) counts[Math.floor((value - low) * scale)]++;
  let sum = 0;
  for (let i = 0; i < BINS; i++) {
    sum += counts[i];
    counts[i] = sum / values.length;
  }
  for (let i = 0; i < values.length; i++) {
    out[i * 4 + channel] = Math.round(255 * counts[Math.floor((values[i] - low) * scale)]);
  }
}

/** The cloud noise: RGBA8, tiling, the same every time. See the sampler's comment in the shader. */
export function createCloudNoiseData(size: number = CLOUD_NOISE_SIZE): Uint8Array {
  const count = size * size * size;
  const out = new Uint8Array(count * 4);
  const billows = new Float32Array(count);
  const smooth = new Float32Array(count);
  const worleyLow = [
    createWorleyPoints(4, 11),
    createWorleyPoints(8, 14),
    createWorleyPoints(16, 17)
  ];
  const worleyMid = [createWorleyPoints(8, 21), createWorleyPoints(16, 24)];
  const worleyHigh = [createWorleyPoints(16, 31), createWorleyPoints(32, 34)];
  for (let k = 0; k < size; k++) {
    const z = k / size;
    for (let j = 0; j < size; j++) {
      const y = j / size;
      for (let i = 0; i < size; i++) {
        const x = i / size;
        const at = i + size * (j + size * k);
        const gradient =
          getGradientNoise(x, y, z, 4, 1) * 0.55 +
          getGradientNoise(x, y, z, 8, 4) * 0.27 +
          getGradientNoise(x, y, z, 16, 7) * 0.18;
        const billow =
          getWorley(x, y, z, 4, worleyLow[0]) * 0.625 +
          getWorley(x, y, z, 8, worleyLow[1]) * 0.25 +
          getWorley(x, y, z, 16, worleyLow[2]) * 0.125;
        billows[at] = gradient + (1 - gradient) * (billow - 0.32);
        const mid =
          getWorley(x, y, z, 8, worleyMid[0]) * 0.7 + getWorley(x, y, z, 16, worleyMid[1]) * 0.3;
        const high =
          getWorley(x, y, z, 16, worleyHigh[0]) * 0.7 + getWorley(x, y, z, 32, worleyHigh[1]) * 0.3;
        out[at * 4 + 1] = Math.round(255 * clamp01(mid));
        out[at * 4 + 2] = Math.round(255 * clamp01(high));
        smooth[at] =
          getGradientNoise(x, y, z, 3, 41) * 0.62 +
          getGradientNoise(x, y, z, 6, 44) * 0.26 +
          getGradientNoise(x, y, z, 12, 47) * 0.12;
      }
    }
  }
  makeEven(billows, out, 0);
  makeEven(smooth, out, 3);
  return out;
}

type NoiseEntry = {texture: Texture; references: number};
const CLOUD_NOISE = new WeakMap<Device, NoiseEntry>();
let cloudNoiseData: Uint8Array | null = null;

function acquireCloudNoise(device: Device): Texture {
  let entry = CLOUD_NOISE.get(device);
  if (!entry) {
    cloudNoiseData ??= createCloudNoiseData();
    entry = {
      references: 0,
      texture: device.createTexture({
        id: 'field-cloud-noise',
        dimension: '3d',
        format: 'rgba8unorm',
        width: CLOUD_NOISE_SIZE,
        height: CLOUD_NOISE_SIZE,
        depth: CLOUD_NOISE_SIZE,
        mipLevels: 1,
        data: cloudNoiseData,
        sampler: {
          minFilter: 'linear',
          magFilter: 'linear',
          addressModeU: 'repeat',
          addressModeV: 'repeat',
          addressModeW: 'repeat'
        }
      })
    };
    CLOUD_NOISE.set(device, entry);
  }
  entry.references++;
  return entry.texture;
}

function releaseCloudNoise(device: Device): void {
  const entry = CLOUD_NOISE.get(device);
  if (entry && --entry.references <= 0) {
    CLOUD_NOISE.delete(device);
    entry.texture.destroy();
  }
}

// ------------------------------------------------------------------ The probe

/** The probe each device has this frame, or null when the frame's water has nothing to mirror. */
const SKY_PROBES = new WeakMap<Device, Texture | null>();

/**
 * The sky as water mirrors it, or `null` when this frame has none, as when nothing is wet or no sky is drawn: the
 * sky layer's own sky, decks, eye walls, rain and cumulus, as linear light ahead of the filmic curve, in an
 * RGBA16F texture of the whole sphere laid out as `SKY_PROBE_LAYOUT` of `field-shading.ts` says, with mipmaps for
 * rough water: 128x64, or 512x256 while the flood is calm enough to be a mirror (`isSkyProbeFine`). Its layout is
 * the same at either size, so a reader takes it by texture coordinates alone. It is drawn once a sub-frame while
 * standing water or wet ground may mirror it. Read it with `FIELD_MIRROR_GLSL`. The sun's disc is not in it: it is
 * the water's own glint.
 */
export function getSkyProbe(device: Device): Texture | null {
  return SKY_PROBES.get(device) ?? null;
}

/** Whether water may mirror the sky in this frame, so the probe is worth drawing. */
export function isSkyProbeWanted(state: StoryState): boolean {
  return (
    state.ground.flood.level > PROBE_WANTED.level || state.ground.wetness > PROBE_WANTED.wetness
  );
}

/**
 * Whether the probe is drawn finely, `FINE_PROBE` in place of `SKY_PROBE_LAYOUT`'s size, in the same layout: while
 * the flood stands calm enough to be a mirror.
 */
export function isSkyProbeFine(state: StoryState): boolean {
  return isSkyProbeWanted(state) && state.ground.flood.calm > PROBE_WANTED.calm;
}

// ------------------------------------------------------------------ The decks' edges

const getArrivingFront = createTrack(DECK_FRONT.arriving);
const getClearingFront = createTrack(DECK_FRONT.clearing);

/**
 * The deck's edge at cycle second `t`, as `[x, y, metres, mode]`: the unit vector on the ground toward the clear
 * sky, how far along it from the camera the edge stands, and the mode, 1 while it arrives from the SSW, 2 while
 * it clears to the east, and 0 when it covers everything or there is no deck.
 */
export function getDeckFront(t: number): [number, number, number, number] {
  if (t >= HURRICANE.arrive - 1 && t < HURRICANE.firstWall + 0.5) {
    const [x, y] = getBearingVector(HURRICANE.firstWallBearing);
    return [x, y, getArrivingFront(t), 1];
  }
  if (t >= HURRICANE.clearing - 0.5 && t < HURRICANE.clearing + 8) {
    const [x, y] = getBearingVector(DECK_FRONT.clearingBearing);
    return [x, y, getClearingFront(t), 2];
  }
  return [0, 1, 0, 0];
}

// ------------------------------------------------------------------ The layer

function setRay(
  out: Float32Array | number[],
  inverse: Matrix4,
  eye: number[],
  x: number,
  y: number
) {
  const far = inverse.transform([x, y, 1]) as number[];
  out[0] = far[0] - eye[0];
  out[1] = far[1] - eye[1];
  out[2] = far[2] - eye[2];
  out[3] = 0;
}

const SKY_PARAMETERS = {
  depthWriteEnabled: false,
  depthCompare: 'always',
  cullMode: 'none',
  blend: false
} as const;

class FieldSkyLayer extends FieldLayer<SkyLayerProps> {
  static layerName = 'FieldSkyLayer';

  declare state: FieldLayer['state'] & {
    noise?: Texture;
    weatherNoise?: Texture;
    cloudModel?: Model;
    cloudTexture?: Texture;
    cloudTarget?: Framebuffer;
    probeModel?: Model;
    probeTexture?: Texture;
    probeTarget?: Framebuffer;
    fineProbeTexture?: Texture;
    fineProbeTarget?: Framebuffer;
  };

  protected createModel(): Model {
    const {device} = this.context;
    this.state.noise ??= acquireCloudNoise(device);
    this.state.weatherNoise ??= acquireWeatherNoise(device);
    const shared = {
      modules: [fieldAir, fieldSky],
      topology: 'triangle-list' as const,
      bufferLayout: [],
      parameters: SKY_PARAMETERS
    };
    this.state.cloudModel?.destroy();
    this.state.cloudModel = new Model(device, {
      ...shared,
      id: `${this.props.id}-clouds`,
      vs: SKY_VERTEX,
      fs: CLOUD_FRAGMENT,
      vertexCount: SKY_GRID[0] * SKY_GRID[1] * 6
    });
    this.state.probeModel?.destroy();
    this.state.probeModel = new Model(device, {
      ...shared,
      id: `${this.props.id}-probe`,
      vs: PROBE_VERTEX,
      fs: PROBE_FRAGMENT,
      vertexCount: PROBE.grid[0] * PROBE.grid[1] * 6
    });
    return new Model(device, {
      ...shared,
      id: this.props.id,
      vs: SKY_VERTEX,
      fs: SKY_FRAGMENT,
      vertexCount: SKY_GRID[0] * SKY_GRID[1] * 6
    });
  }

  setShaderModuleProps(): void {
    // It reads nothing of deck's: no light, no shadow, not even the project module.
  }

  /** What the sky's uniforms are for a viewport. */
  private getSkyUniforms(viewport: Viewport) {
    const inverse = new Matrix4(viewport.viewProjectionMatrix as number[]).invert();
    const eye = viewport.cameraPosition as number[];
    const rayA = [0, 0, 0, 0];
    const rayB = [0, 0, 0, 0];
    const rayC = [0, 0, 0, 0];
    setRay(rayA, inverse, eye, -1, -1);
    setRay(rayB, inverse, eye, 3, -1);
    setRay(rayC, inverse, eye, -1, 3);
    const {air, cumulus, cloud, storm, extra, rainAcross, rainAbove, rainFall, veil, front} =
      this.props;
    return {
      fieldAir: air,
      fieldSky: {
        eye: [eye[0], eye[1], eye[2], 0],
        rayA,
        rayB,
        rayC,
        cumulus,
        cloud,
        storm,
        extra,
        rainAcross,
        rainAbove,
        rainFall,
        veil,
        front
      }
    };
  }

  /** The target of the cumulus pass, half the size of what is drawn. */
  private getCloudTarget(): Framebuffer {
    const {device} = this.context;
    const canvas = device.canvasContext as unknown as {getDrawingBufferSize(): [number, number]};
    const [width, height] = canvas.getDrawingBufferSize();
    const halfWidth = Math.max(Math.ceil(width / 2), 8);
    const halfHeight = Math.max(Math.ceil(height / 2), 8);
    const {cloudTexture, cloudTarget} = this.state;
    if (
      cloudTexture &&
      cloudTarget &&
      cloudTexture.width === halfWidth &&
      cloudTexture.height === halfHeight
    ) {
      return cloudTarget;
    }
    cloudTarget?.destroy();
    cloudTexture?.destroy();
    this.state.cloudTexture = device.createTexture({
      id: `${this.props.id}-clouds`,
      format: 'rgba16float',
      width: halfWidth,
      height: halfHeight,
      mipLevels: 1,
      sampler: {
        minFilter: 'linear',
        magFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge'
      }
    });
    this.state.cloudTarget = device.createFramebuffer({
      id: `${this.props.id}-clouds`,
      width: halfWidth,
      height: halfHeight,
      colorAttachments: [this.state.cloudTexture]
    });
    return this.state.cloudTarget;
  }

  /** A probe's texture and target, coarse or fine, each made once. */
  private getProbeTarget(fine: boolean): {texture: Texture; target: Framebuffer} {
    const {device} = this.context;
    const existing = fine
      ? [this.state.fineProbeTexture, this.state.fineProbeTarget]
      : [this.state.probeTexture, this.state.probeTarget];
    if (existing[0] && existing[1]) {
      return {texture: existing[0] as Texture, target: existing[1] as Framebuffer};
    }
    const {width, height} = fine ? FINE_PROBE : PROBE;
    const id = `${this.props.id}-probe${fine ? '-fine' : ''}`;
    const texture = device.createTexture({
      id,
      format: 'rgba16float',
      width,
      height,
      mipLevels: Math.log2(width) + 1,
      sampler: {
        minFilter: 'linear',
        magFilter: 'linear',
        mipmapFilter: 'linear',
        addressModeU: 'repeat',
        addressModeV: 'clamp-to-edge'
      }
    });
    const target = device.createFramebuffer({id, width, height, colorAttachments: [texture]});
    if (fine) {
      this.state.fineProbeTexture = texture;
      this.state.fineProbeTarget = target;
    } else {
      this.state.probeTexture = texture;
      this.state.probeTarget = target;
    }
    return {texture, target};
  }

  /**
   * Marches the cumulus, and draws the probe while water may mirror it. An update comes ahead of the frame's own
   * render pass, and a pass cannot start within another. The viewport is asked of deck, as the layer context's is
   * still the last frame's at this point.
   */
  updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    const {cloudModel, probeModel, noise, weatherNoise} = this.state;
    const viewport = (
      this.context.deck as {getViewports?: () => Viewport[]} | undefined
    )?.getViewports?.()[0];
    if (!cloudModel || !probeModel || !noise || !weatherNoise || !viewport) return;
    const {device} = this.context;
    const {air, cloud} = this.props;
    const uniforms = this.getSkyUniforms(viewport) as never;
    const framebuffer = this.getCloudTarget();
    // The pass marches the storm's walls as well as the cumulus: the eye's, and the departing one, which stands
    // in front of its deck.
    const isDeparting = this.props.front[3] > 1.5 && air.weather[0] > 0;
    const isHidden =
      (cloud[0] <= 0 && air.weather[1] <= 0 && !isDeparting) ||
      (!isDeparting && air.weather[0] * (1 - air.weather[1]) >= 0.995);
    const pass = device.beginRenderPass({
      id: `${this.props.id}-clouds`,
      framebuffer,
      clearColor: [0, 0, 0, 1],
      parameters: {viewport: [0, 0, framebuffer.width, framebuffer.height]}
    });
    if (!isHidden) {
      cloudModel.shaderInputs.setProps(uniforms);
      cloudModel.setBindings({fieldNoise: noise});
      cloudModel.draw(pass);
    }
    pass.end();

    if (!this.props.probe) {
      SKY_PROBES.set(device, null);
      return;
    }
    const {texture, target} = this.getProbeTarget(this.props.probeFine);
    const probePass = device.beginRenderPass({
      id: `${this.props.id}-probe`,
      framebuffer: target,
      clearColor: [0, 0, 0, 1],
      parameters: {viewport: [0, 0, target.width, target.height]}
    });
    probeModel.shaderInputs.setProps(uniforms);
    probeModel.setBindings({fieldNoise: noise, weatherNoise});
    probeModel.draw(probePass);
    probePass.end();
    texture.generateMipmapsWebGL();
    SKY_PROBES.set(device, texture);
  }

  finalizeState(context: Parameters<FieldLayer['finalizeState']>[0]): void {
    const {device} = this.context;
    if (this.state.noise) releaseCloudNoise(device);
    if (this.state.weatherNoise) releaseWeatherNoise(device);
    SKY_PROBES.delete(device);
    this.state.cloudModel?.destroy();
    this.state.cloudTarget?.destroy();
    this.state.cloudTexture?.destroy();
    this.state.probeModel?.destroy();
    this.state.probeTarget?.destroy();
    this.state.probeTexture?.destroy();
    this.state.fineProbeTarget?.destroy();
    this.state.fineProbeTexture?.destroy();
    super.finalizeState(context);
  }

  draw({renderPass, shaderModuleProps}: Parameters<FieldLayer['draw']>[0]): void {
    const {model, noise, weatherNoise, cloudTexture} = this.state;
    if (!model || !noise || !weatherNoise || !cloudTexture) return;
    if (this.isDrawSkipped({shaderModuleProps})) return;
    model.shaderInputs.setProps(this.getSkyUniforms(this.context.viewport as Viewport) as never);
    model.setBindings({fieldNoise: noise, fieldClouds: cloudTexture, weatherNoise});
    model.draw(renderPass);
  }
}

/** Where the storm's center stands, in metres from the hero, with the bands turning counterclockwise. */
export function getStormCenter(t: number): [number, number] {
  const middle = (HURRICANE.eyeOpen + HURRICANE.eyeClose) / 2;
  const [x, y] = getBearingVector(HURRICANE.firstWallBearing);
  // At a point right of center, looking along the wind, counterclockwise flow runs along it.
  const side = t < middle ? 1 : -1;
  return [-y * STORM_CENTER_METRES * side, x * STORM_CENTER_METRES * side];
}

/** The cumulus layer for a `cloudBuild`: base, top, shape scale, field scale, in metres. */
export function getCumulusLayer(build: number): [number, number, number, number] {
  const towering = Math.pow(clamp01(build), 1.5);
  const base = lerp(CUMULUS.base[0], CUMULUS.base[1], towering);
  return [
    base,
    base + lerp(CUMULUS.thickness[0], CUMULUS.thickness[1], towering),
    lerp(CUMULUS.shape[0], CUMULUS.shape[1], towering),
    lerp(CUMULUS.field[0], CUMULUS.field[1], towering)
  ];
}

/** Storm strengths over which the fair-weather cumulus goes, as the deck comes over and only scud is under it. */
const CUMULUS_GONE_IN_STORM = [0.01, 0.15] as const;
/**
 * Fair-weather cumulus grow as the sun warms the ground: at first light only a few are left of yesterday's, which a
 * sun on the horizon backlights into dark lumps. Of the story's cover, how much there is with the sun on the
 * horizon, and the heights of the sun, as the z of its direction, over which it comes to all of it.
 */
const CUMULUS_AT_DAWN = {least: 0.15, sun: [0.02, 0.14] as const};

/**
 * The cover of the frame's cumulus: the story's, but thin at first light, none in the eye, whose stadium stands round
 * a clear sky, and none under the storm's deck, which has only scud below it.
 */
export function getCumulusCover(state: StoryState): number {
  const {sky} = state;
  const storm = smoothstep(CUMULUS_GONE_IN_STORM[0], CUMULUS_GONE_IN_STORM[1], sky.storm);
  const risen = smoothstep(CUMULUS_AT_DAWN.sun[0], CUMULUS_AT_DAWN.sun[1], sky.sunDirection[2]);
  const dawn = lerp(CUMULUS_AT_DAWN.least, 1, risen);
  return sky.cloudCover * dawn * (1 - sky.eye) * (1 - storm);
}

/**
 * How far east of the camera the departing storm's wall stands at the ground, in metres: farther the farther the
 * storm has gone, from when it starts to go as the deck clears to when it is gone.
 */
export function getDepartingDistance(state: StoryState): number {
  const gone = smoothstep(DEPARTING.goes[0], DEPARTING.goes[1], state.sky.storm);
  return lerp(DEPARTING.distance[0], DEPARTING.distance[1], gone);
}

/** How much of the day's light a deck of cloud has to give back, 0.05 at night to 1 by the time the sun is well up. */
function getDaylight(state: StoryState): number {
  const elevation = Math.asin(Math.max(-1, Math.min(1, state.sky.sunDirection[2])));
  return lerp(0.05, 1, smoothstep(-0.1, 0.35, elevation));
}

/** Full-screen sky: air, sun, moon, stars, clouds and storm, and the probe of it that water mirrors. */
export function createSkyLayer(state: StoryState): FieldSkyLayer {
  const {sky, weather, wind} = state;
  const air: FieldAir = getFieldAir(state);
  const [centerX, centerY] = getStormCenter(state.t);
  const curtain = getWeatherCurtain(state);
  return new FieldSkyLayer({
    id: 'sky',
    air,
    cumulus: getCumulusLayer(sky.cloudBuild),
    cloud: [getCumulusCover(state), sky.cloudBuild, sky.cloudOffset[0], sky.cloudOffset[1]],
    storm: [sky.stormSwirl, centerX, centerY, (wind.bearing * Math.PI) / 180],
    extra: [
      sky.starTurn * STAR_TURN_SHARE,
      weather.rain,
      smoothstep(0, 1, sky.storm),
      state.camera.aperture / state.camera.distance
    ],
    rainAcross: [...curtain.across, weather.curtains],
    rainAbove: [...curtain.above, clamp01(wind.gust)],
    rainFall: [...curtain.fall, weather.rain],
    veil: [curtain.carried[0], curtain.carried[1], getDaylight(state), getDepartingDistance(state)],
    front: getDeckFront(state.t),
    probe: isSkyProbeWanted(state),
    probeFine: isSkyProbeFine(state),
    parameters: SKY_PARAMETERS,
    shadowEnabled: false,
    pickable: false
  } as never);
}
