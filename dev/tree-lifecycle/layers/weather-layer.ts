// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * What is in the air: rain in curtains and its splashes, spindrift and the plumes torn off the
 * crowns, torn leaves and twigs, petals, motes, the gold sparkles of the two magic moments, mist,
 * steam, the wisps of it off the crowns in the eye, and the shaft of light through the eye of the storm. And on the flood, what it carries:
 * green fruit, leaves and twigs, and the splashes where something heavy hits it.
 *
 * All of it is stateless. Nothing has a position on the CPU: the vertex stage hashes an index,
 * carries it along by how far the air has moved since the cycle began, and wraps it into a box that
 * follows the camera, so any frame can be drawn at any time and no frame costs work per particle.
 * Winds change, so how far the air has moved is integrated once, ahead of time, from the story's
 * own weather on the scene clock: see `getWeatherDrift`. What floats is anchored to the field
 * instead, around the hero, and carried by the flood's own drift.
 *
 * Things with a size are instanced quads with no vertex data: streaks, flakes, puffs and points.
 * Mist, spray, rain far away and the shaft of light are slices across the view, each working out
 * where in the field its fragments are, so what is in the air between them and a tree is depth
 * tested like the rest. Every test of the ground reads `LAND_GLSL`'s land and the flood's level.
 *
 * Everything here draws last and blends as premultiplied alpha into the display-encoded frame, as
 * what the other layers leave there is already past their filmic curve. Its own light goes through
 * the same curve, from the same lights. Output with alpha 0 adds light, and output with alpha mixes
 * toward a color. It tests depth, so trees occlude it, and writes none, but for what floats, which
 * is drawn first, solid, so the water hides what is under it. It skips the shadow pass and the
 * picking pass.
 */

import {COORDINATE_SYSTEM, Layer, project32} from '@deck.gl/core';
import type {DefaultProps, LayerProps, UpdateParameters} from '@deck.gl/core';
import {_treeWindGust, getTreeWindGust} from '@deck.gl-community/layers';
import type {Device, Texture} from '@luma.gl/core';
import {Model} from '@luma.gl/engine';
import type {ShaderModule} from '@luma.gl/shadertools';
import {
  CYCLE_SECONDS,
  getCrownFraction,
  getCycleSeconds,
  getHeightFraction,
  getTimeRate,
  isInSeamWindow,
  LOOP
} from '../story/beats';
import {getCameraEye, getCameraForward, getStoryCamera} from '../story/camera';
import {getEnvironment} from '../story/environment';
import {FLOOD, getFlood} from '../story/flood';
import {getMagicRing} from '../story/grove';
import {BED_LAYOUT, LAND_GLSL} from '../story/land';
import {getSeedPosition, SEED_TABLE} from '../story/props';
import {
  clamp01,
  getBearingVector,
  hash01,
  lerp,
  RADIANS_PER_DEGREE,
  smoothstep
} from '../story/story-math';
import type {Rgb, StoryState, Vec3} from '../story/story-types';
import {getFieldLinearLight} from './field-shading';

/** Rain. All lengths are metres, and all boxes follow the camera. */
const RAIN_TABLE = {
  /** Terminal speed of a typical drop, metres per second. */
  fallSpeed: 8.5,
  /** The most slant, in degrees from vertical, however hard it blows. */
  mostSlant: 84,
  /**
   * Seconds of motion each sub-frame's streak spans, for what is not frozen: the splashes' drops.
   * The accumulator adds its own shutter on top, so this is only enough for its sub-frames to
   * overlap into a smooth line, and enough to read in a frame of one sample.
   */
  shutter: 1 / 120,
  /**
   * A falling drop is frozen at its frame's own second, as a fast shutter sees rain: every sub-frame
   * of a frame draws the same short dash, this many seconds of its flight long, so it is crisp and
   * as bright as it is, 10-60 pixels in the middle distance, not a long faint wire. `frameRate` is
   * the film's, whose seconds the frames are on.
   */
  exposure: 1 / 240,
  frameRate: 30,
  /**
   * Near to far: drops, box across and high, how far ahead the box is centered, and how bright.
   * Most are in the middle distance, where a dash is short and reads against the crowns and the
   * banks. The far set is thin, as the curtains of the slices of air carry the far rain.
   */
  layers: [
    {count: 3600, across: 12, high: 10, ahead: 4, alpha: 0.5},
    {count: 22000, across: 34, high: 22, ahead: 14, alpha: 0.85},
    {count: 9000, across: 96, high: 44, ahead: 42, alpha: 0.95}
  ],
  /** Radius of a drop, smallest and largest, and its speed as a share of the fall speed for it. */
  radius: [0.0006, 0.0028],
  speed: [0.72, 1.14],
  /** How bright a drop is against another, as one catches more of the sky than the next. */
  glint: [0.6, 1.55] as const,
  /**
   * Narrowest a streak looks, in pixels, how much wider some are, and of the lens's blur how much
   * it widens by. Its quad is `quadShare` times that, for a soft profile to fall off in, so a thin
   * line has no beads on it.
   */
  leastWidth: 1.1,
  widest: 1.8,
  blurShare: 0.8,
  quadShare: 2.2,
  /** Metres from the lens within which a dash fades out, rather than cross the frame as a wire. */
  lensFade: [0.6, 1.8] as const,
  /** How much of a box's size is taken to fade out at its sides. */
  edgeBand: 0.16,
  /**
   * Splashes: small drops thrown back up from the ground, as a box over the ground. Only on dry
   * ground: standing water draws its own rings.
   */
  splashes: {
    count: 2600,
    across: 28,
    ahead: 9,
    seconds: [0.09, 0.2],
    rise: [0.5, 1.5],
    gravity: 9.8,
    /** Metres per second it is blown along the ground at full wind. */
    blown: 16,
    alpha: 0.55,
    /** Distance from the camera, in metres, over which they fade out. */
    fade: [7, 24]
  }
};

/**
 * Rain curtains, in the slices of air and in the sky's veil alike: sheets of heavier rain 40-80 m
 * apart along the wind, each standing tall and running far across it, with clearer gaps between
 * them, carried downwind, so they sweep across the view and the far rows come and go. Metres per
 * tile of the noise, whose first octave has four cells to a tile: across the wind, along it, and up.
 */
const CURTAIN_TABLE = {
  across: 640,
  along: 130,
  up: 420,
  /** Share of the air's speed the sheets are carried at. */
  carried: 0.8,
  /** A gap's density, what a sheet adds to it, and over what span of the noise. */
  gap: 0.1,
  sheet: 2.5,
  edges: [0.46, 0.61] as const,
  /** The curtains at which the sheets are whole: below it they blend toward an even veil. */
  whole: 0.7,
  /** Metres up over which the sheets give way to an even veil. */
  aloft: [24, 100] as const,
  /** How much the gust at the view point packs the sheets: x1.6 at a peak. */
  gustGain: 0.6,
  /** The fine fibres within a sheet, as a share of its density. */
  fibres: [0.85, 1.15] as const
};

/**
 * The flakes: anything with a shape that tumbles. Each set has a count, a box, and half a length
 * in metres. A far set's flakes are larger than life, as a real one is lost in less than a pixel,
 * so the far leaves go once the wind is a storm's, which tears true-size ones off every tree.
 */
const LEAF_SETS = [
  {count: 360, across: 20, high: 10, ahead: 7, length: 0.05, far: 0},
  {count: 2000, across: 84, high: 22, ahead: 30, length: 0.06, far: 1}
];
const PETAL_SETS = [
  {count: 1400, across: 6.5, high: 6, ahead: 2.6, length: 0.0095, far: 0},
  {count: 6000, across: 17, high: 7, ahead: 8, length: 0.0115, far: 0},
  {count: 7000, across: 90, high: 14, ahead: 34, length: 0.015, far: 1}
];
/** A far set's flakes, being larger than life, stay this far from the camera, in metres. */
const FAR_FLAKES_FROM = [8, 16];
/** Wind strengths over which the far leaves go. */
const FAR_LEAVES_GONE = [0.22, 0.3];
const FLAKE_TABLE = {
  /** Of the leaves, how many are twigs. */
  twigShare: 0.14,
  /** Of a leaf and a petal, its width as a share of its length. */
  leafWidth: 0.42,
  petalWidth: 0.7,
  twigLength: [0.07, 0.2],
  twigWidth: 0.0045,
  /** Seconds of motion a flake is smeared over, so that its sub-frames join up. */
  shutter: 1 / 480,
  /** Metres from the camera within which a flake fades away, rather than cover the lens. */
  lensFade: [0.5, 1.6],
  petalSink: 0.75
};

/**
 * Motes come in octaves of box size, each with its own dust, world-fixed and cross-faded by how far
 * the camera stands from what it looks at, so they hold up from macro to the grove without ever
 * moving when the shot does. Sizes are metres of radius, and `drift` is the share of the wind they
 * move with.
 */
const MOTE_OCTAVES = [
  {box: 0.35, radius: 0.00011, drift: 0.02},
  {box: 1.4, radius: 0.00022, drift: 0.05},
  {box: 5.6, radius: 0.0005, drift: 0.11},
  {box: 22.4, radius: 0.0012, drift: 0.2}
];
const MOTE_TABLE = {
  count: 640,
  /** Wind strengths over which dust is gone. */
  clearedBy: [0.12, 0.34],
  /**
   * Of the lens's blur, how much of it each sub-frame's mote covers, as soft spots at the lens's
   * many places then average to a smooth disc.
   */
  blurShare: 0.85,
  /** How bright a mote that catches the sun is. */
  gain: 2.1,
  /** Radius in a 720 frame's pixels of lens blur over which it fades out, too spread to see. */
  mostBlur: [7, 18]
};

/** Gold sparkles. */
const SPARKLE_TABLE = {
  /** Around the ring of `grove-magic`. */
  ring: {
    count: 15000,
    reach: 190,
    /** Heights it is born at, then metres per second it rises at, then seconds it lives. */
    lowest: 0.15,
    highest: 2.6,
    rise: [0.25, 0.95],
    life: [1.1, 2.8]
  },
  /** Around the arc of the seed: scattered this far off it, rising this fast. */
  seed: {count: 520, scatter: 0.03, rise: [0.018, 0.075], life: [0.45, 1.25]},
  /** Linear light of a sparkle at full strength: warm gold, not white. */
  color: [1.75, 0.98, 0.34],
  /** Of its light how much also covers what is behind, so that it stays gold on a bright sky. */
  cover: 0.6,
  /** How wide its soft core is in pixels at least, as a standard deviation. */
  leastSpread: 0.95,
  blurShare: 0.85
};
const SPARKLE_RING_HEIGHTS = [SPARKLE_TABLE.ring.lowest, SPARKLE_TABLE.ring.highest];

/**
 * Cycle seconds of a mote's and a sparkle's way across the frame that each sub-frame draws it along: a quarter of
 * a frame, so the sub-frames of a frame's shutter overlap into one soft streak.
 */
const POINT_SHUTTER = 1 / 120;

/** Slices of air, from `first` metres out to `last`, far to near. */
const AIR_TABLE = {
  slices: 10,
  /** The nearest slice, as a share of the distance to the target, in metres. */
  firstShare: 0.16,
  firstMost: 3,
  last: 340,
  /** Slices past the far plane are drawn just inside it, at this share. */
  farShare: 0.997,
  /** Below this nothing of the air is worth drawing. */
  leastAmount: 0.012,
  /** Rain's optical depth per metre, close and far away. */
  rainDepth: [0.0055, 0.008],
  /** Metres over which it goes from close to far. */
  rainDepthAt: [28, 150],
  /** The power of the rain's amount its optical depth goes with, so a shower is not a storm's veil. */
  rainVeilPower: 1.5,
  /** How much of its color is lit rain, close and far: the rest is the color of the air. */
  rainLit: [0.55, 0.2],
  /** Mist's optical depth per metre, and height in metres of the layer of each kind. */
  mistDepth: 0.3,
  /**
   * Of that, how much steam has: it is a thinner thing, in wisps with clear air between them, spread
   * higher, and goes on rising. Over what span of its noise the wisps are.
   */
  steamShare: 0.32,
  steamWisps: [0.5, 0.68],
  mistHeight: 0.8,
  steamHeight: 3.4,
  /**
   * Metres per second that steam rises at, metres from the lens over which it comes in, and metres over the ground
   * over which it thins out to nothing just over the crowns, whose shadows cut it into shafts.
   */
  steamRise: 0.55,
  steamFromLens: [5, 14] as const,
  steamTop: [4.5, 8] as const,
  /** How much the shaft widens per metre of height: a cone, down from the opening above. */
  shaftSpread: 0.14,
  /**
   * Of a lightning flash's light, how much the rain, the spray and the mist scatter back. It is
   * added to their own light ahead of the curve, so a flash whitens the air and never clips it.
   */
  flashRain: 0.3,
  /** The most light a flash adds to the rain, ahead of the curve. */
  flashRainMost: 0.2,
  flashSpray: 0.38,
  flashMist: 0.25
};

/**
 * Spindrift, torn off the water and the wet ground in a low streaming layer, with clear air above
 * it. Streaky, low and lit, or it reads as smoke. Far off it is a mode of the slices of air, the
 * white low band the far end of the aisle goes into; near by it is streaks of its own, below.
 */
const SPRAY_TABLE = {
  /** Metres it reaches up, and the height over which its density falls by e. */
  depth: 1.2,
  falloff: 0.3,
  /** Metres per tile of the noise across the wind, along it, and up: streaks six times as long. */
  across: 7,
  along: 42,
  up: 3,
  /** Share of the air's speed it is carried at. */
  carried: 0.9,
  /** Tiles of the noise a scene second that its streaks change shape by. */
  churn: 0.22,
  /** Over what span of its noise a streak is, which leaves clear air between them. */
  streaks: [0.42, 0.72] as const,
  /** Optical depth per metre at full spray. */
  depthPerMetre: 0.45,
  /** Metres from the camera over which the slices' spray comes in, where the streaks leave off. */
  slicesFrom: [12, 30] as const,
  /** Metres over the land over which a slice's spray feathers out, at least, where it meets a bank. */
  feather: 0.22
};

/**
 * Spindrift near by: streaks of spray streaming low over the water and the beds, each a few metres
 * long along the wind and a hand to a forearm high, carried at nearly the air's speed. They come
 * and go as gusts tear them up and they thin out, and they are lit as the spray is, so they show
 * bright against the dark banks and the water.
 */
const SPINDRIFT_TABLE = {
  count: 2600,
  /** Metres across the box that follows the camera, and how far ahead its middle is. */
  across: 44,
  ahead: 17,
  /** Metres over the water or the ground, lowest and highest: most of them low. */
  height: [0.02, 1.0] as const,
  /** Metres long along the wind, and high. */
  length: [1.4, 4.6] as const,
  thick: [0.06, 0.32] as const,
  /** Scene seconds one lasts, from forming to gone. */
  life: [0.5, 1.3] as const,
  /** How much of the light it is lit by gets through it at its thickest. */
  alpha: 0.42,
  /** Metres from the lens within which one fades out, and how far it goes. */
  lensFade: [0.8, 2.6] as const,
  reach: [26, 40] as const
};

/** Plumes of spray torn off the tops of the nearest crowns, as each gust front crosses them. */
const PLUME_TABLE = {
  crowns: 16,
  /** Puffs along each, and its length in metres, from a lull to a peak. */
  puffs: 9,
  length: [2, 6] as const,
  /** Metres across a puff, at its root and at its end, for a crown of 3 m. */
  width: [0.45, 1.6] as const,
  /** How much longer a puff is along the wind than across it. */
  stretch: 2.6,
  /** How much there is in a lull, as a share of a peak, and the gusts it rises over. */
  lull: 0.3,
  gusts: [0.15, 0.85] as const,
  /** Optical depth through its root at full spray. */
  depth: 1.2,
  /** The least crown that tears into one, in metres of radius, and the most lean, in degrees. */
  leastCrown: 0.9,
  mostLean: 25,
  /** How much a crown bows downwind at full force, as a share of its height. */
  bow: 0.12
};

/**
 * Steam off the warm wet crowns in the eye's sun, through the same puffs as the plumes, which the calm has none
 * of: wisps that go up off all of a crown's top, widen and thin out. Scene seconds a wisp lasts, metres a second
 * it rises, metres across it as it starts and as it goes, how much taller than wide it is, and how much of the
 * light behind it it hides at its thickest.
 */
const STEAM_TABLE = {
  life: [3.2, 5.8] as const,
  rise: [0.4, 0.95] as const,
  width: [0.55, 2.3] as const,
  stretch: 1.7,
  alpha: 0.55,
  /** Metres from the lens over which a wisp comes in, so the crowns beside the camera do not smear it across it. */
  fromLens: [5, 11] as const,
  /** The eye's opening over which it comes. */
  eye: [0.05, 0.4] as const
};

/** What something heavy throws up where it hits the water, from `ground.flood.splashes`. */
const SPLASH_TABLE = {
  most: 4,
  drops: 300,
  puffs: 40,
  /** Rings spreading on the water from each. */
  rings: 3,
  /** Scene seconds the drops, the burst and the rings last. */
  dropSeconds: 1.8,
  burstSeconds: 1.4,
  ringSeconds: 2.4,
  /**
   * The burst: thrown up at once, to the splash's size in metres, in a crown of sheets that break
   * into spray. Seconds it takes to get most of the way up, slowed by the air, and to fall back.
   */
  burstRise: 0.09,
  burstFall: 0.75,
  /** Metres a second a ring spreads at, the first fastest, and its width as it goes. */
  ringSpeed: [2.6, 1.9, 1.3] as const,
  ringWidth: [0.18, 0.7] as const,
  /** A drop's radius in metres, smallest and largest. */
  radius: [0.0015, 0.006] as const,
  gravity: 9.8,
  alpha: 0.85
};

/** What the flood carries: fruit, leaves and twigs, anchored to the field around the hero. */
const FLOAT_TABLE = {
  fruit: 900,
  litter: 4000,
  /**
   * A September Valencia is green, 5-6.5 cm across: of the fruit, how many are the darker green,
   * and how many are yellowing at the stem end where they were bruised.
   */
  darkShare: 0.55,
  bruisedShare: 0.1,
  radius: [0.025, 0.0325] as const,
  /** Of the litter, how many are twigs, and their lengths; a leaf's half length. */
  twigShare: 0.2,
  twigLength: [0.06, 0.22] as const,
  leafLength: [0.032, 0.05] as const,
  /** Half the block they are seeded over, around the hero, in metres. */
  extent: [44, 34] as const,
  /**
   * Shares seeded along the furrows, in the lee of trunks, against wrecks and at the culvert's
   * west mouth, in that order: the rest anywhere on the block. Most drift where the water slows.
   * Of those along the furrows, how many are in the hero's, which the storm is seen down.
   */
  shares: [0.24, 0.36, 0.26, 0.1] as const,
  heroFurrow: 0.6,
  /** Of the flood's drift, how much moves what is caught in a trunk's lee, against a wreck or at the culvert. */
  caughtCarry: 0.06,
  /**
   * Of the flood's drift, how much reaches what floats down in a furrow, under its banks and out of
   * the wind, until it brims: the bank tops' height either side of which that comes back.
   */
  shelter: 0.15,
  shelterLevels: [BED_LAYOUT.bankTopZ - 0.1, BED_LAYOUT.bankTopZ + 0.1] as const,
  /** Bob, in metres and in hertz of the scene clock. */
  bob: [0.004, 0.7] as const,
  /**
   * How deep a fruit floats, as a share of its radius its centre is under: three quarters of it
   * down, so only a cap shows, with a dark ring of meniscus round it.
   */
  sunk: 0.5,
  meniscus: 0.0035,
  /** Story seconds a stranded thing takes to brown, and the seconds over which all of it goes. */
  browns: 1.4,
  gone: [50.1, 50.8] as const,
  /** The most wrecks they gather against, taken in the grove's own order. */
  wrecks: 12,
  /** Lean in degrees past which a tree is a wreck. */
  wreckLean: 45,
  /** Litter is lifted this far over the water, so it never fights it for depth. */
  lift: 0.004
};

/**
 * The shaft of light has slices of its own, closer together than the air's and only where it
 * stands, as it is rays of a few metres across that the eye has to find in it.
 */
const SHAFT_TABLE = {
  slices: 20,
  /** Optical depth per metre at full strength. */
  depth: 0.15,
  /** Where its edge is, as a share of the story's radius, which takes in the soft part past it. */
  flatRadius: 0.5,
  /** How far before and after its axis the slices go, as a share of its radius. */
  reach: 2,
  /**
   * The height up the axis that slices are centered on, and over which the steam it shows in thins, metres: up
   * past the crowns, whose steam it lights in shafts.
   */
  height: 4,
  steamHeight: 3.6,
  /**
   * Metres over the ground over which it goes, so it stays round the crowns and out of the sky, and metres from the
   * lens over which it comes in, as the cone passes close by a camera looking up into the eye.
   */
  steamTop: [4.5, 8] as const,
  lensFade: [7, 16] as const,
  /** Metres per unit of noise of the broad rays and of the fine ones, as shares of its radius. */
  broadRays: 0.42,
  fineRays: 1.7,
  /** Of the light that dust throws, how much it is at full strength. */
  dustGain: 3.4
};

/** Texels along each row of the small tables the sparkles and what floats read. */
const WEATHER_TABLE_TEXELS = 64;
const WEATHER_TABLE_SEED_ROW = 0;
const WEATHER_TABLE_RING_ROW = 1;
/** The flood's level, drift and how much floats, from its rise to after it has drained. */
const WEATHER_TABLE_FLOW_ROW = 2;
const WEATHER_TABLE_ROWS = 3;
const FLOW_SECONDS = [FLOOD.rises, FLOOD.drained + 0.1] as const;

/** The frame's own table: a texel to each plume, splash and wreck. See `getWeatherFrame`. */
const FRAME_TEXELS = 16;
const FRAME_ROW = {plume: 0, plumeMore: 1, splash: 2, splashMore: 3, wreck: 4};
const FRAME_ROWS = 5;

/**
 * The power of the rain's amount 0-1 that what it hides in the air goes with, for every layer that draws
 * rain in the air: a shower is far clearer than its share of a storm.
 */
export const WEATHER_RAIN_VEIL_POWER = AIR_TABLE.rainVeilPower;

/** Of the wind's strength 0-1, metres per second. */
const WIND_SPEED_AT_FULL = 64;
/** Seconds between samples of the table of how far the air has moved. */
const DRIFT_STEP_SECONDS = 1 / 24;
/** How fast a torn leaf sinks, metres per second, in still air and in a wind that holds it up. */
const LEAF_SINK = {still: 1.5, blown: 0.15, windFrom: 0.05, windTo: 0.4};
/** The lowest a box of what is in the air reaches, under a furrow's floor. */
const WEATHER_LOWEST = BED_LAYOUT.floorZ - 0.05;

/** Texels along each side of the tiling 3D noise. */
const NOISE_SIZE = 64;
/** Lattice cells per tile of each of its octaves, and how much of it each has. */
const NOISE_OCTAVES = [
  {cells: 4, share: 0.5},
  {cells: 8, share: 0.26},
  {cells: 16, share: 0.15},
  {cells: 32, share: 0.09}
];

/** Depth tested, writing none, and premultiplied: every model of the layer draws this way. */
const WEATHER_PARAMETERS = {
  depthWriteEnabled: false,
  depthCompare: 'less-equal',
  cullMode: 'none',
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'one',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha'
} as const;
/** What floats is solid, and writes depth, so what is drawn after it is hidden behind it. */
const WEATHER_SOLID_PARAMETERS = {...WEATHER_PARAMETERS, depthWriteEnabled: true} as const;

const RAIN_DROPS = RAIN_TABLE.layers.reduce((sum, layer) => sum + layer.count, 0);
const RAIN_INSTANCES = RAIN_DROPS + RAIN_TABLE.splashes.count;
const LEAF_FLAKES = LEAF_SETS.reduce((sum, set) => sum + set.count, 0);
const PETAL_FLAKES = PETAL_SETS.reduce((sum, set) => sum + set.count, 0);
const FLAKE_INSTANCES = LEAF_FLAKES + PETAL_FLAKES;
const MOTES = MOTE_TABLE.count * MOTE_OCTAVES.length;
const POINT_INSTANCES = MOTES + SPARKLE_TABLE.ring.count + SPARKLE_TABLE.seed.count;
const PLUME_PUFFS = PLUME_TABLE.crowns * PLUME_TABLE.puffs;
const BURST_PUFFS = SPLASH_TABLE.most * SPLASH_TABLE.puffs;
const SPLASH_RINGS = SPLASH_TABLE.most * SPLASH_TABLE.rings;
/** Plumes, then bursts, then rings, then spindrift: each a quad of the puffs' model. */
const PUFF_INSTANCES = PLUME_PUFFS + BURST_PUFFS + SPLASH_RINGS + SPINDRIFT_TABLE.count;
const SPATTER_INSTANCES = SPLASH_TABLE.most * SPLASH_TABLE.drops;
const FLOAT_INSTANCES = FLOAT_TABLE.fruit + FLOAT_TABLE.litter;

function formatFloat(value: number): string {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

/** A GLSL vec3 of a triple. */
function formatTriple(triple: readonly number[]): string {
  return `vec3(${formatFloat(triple[0])}, ${formatFloat(triple[1])}, ${formatFloat(triple[2])})`;
}

/** GLSL for somewhere in a range of a table, by an amount. */
function formatMix(range: readonly number[], amount: string): string {
  return `mix(${formatFloat(range[0])}, ${formatFloat(range[1])}, ${amount})`;
}

/** GLSL for how far a value has gone through a range of a table, 0-1. */
function formatStep(range: readonly number[], value: string): string {
  return `smoothstep(${formatFloat(range[0])}, ${formatFloat(range[1])}, ${value})`;
}

/**
 * GLSL of the rain's curtains, for any layer that draws rain in the air, which the sky's veil
 * shares so its sheets sweep the horizon with the near ones:
 *
 * `float weatherCurtainAt(sampler3D noise, vec3 point, vec3 across, vec2 carried, float curtains,
 * float gust, float scale)`
 *
 * How much rain there is at a point against an even veil of 1: with `curtains` at 0.7 or more,
 * sheets 40-80 m apart along the wind, standing tall and running far across it, with clearer gaps
 * between, which the gust at the view point packs tighter. They are carried downwind, so they sweep
 * across a view along the rows, and give way to an even veil 25-100 m up, where the gusts that
 * drive them do not reach. `noise` is the weather's tiling noise (`acquireWeatherNoise`),
 * `across` the unit vector across the wind of `getWeatherCurtain`, `carried` the metres the sheets
 * have been carried, and `scale` how much larger the sheets are drawn, for a look far off that
 * cannot hold their size.
 */
export const WEATHER_CURTAIN_GLSL = /* glsl */ `
float weatherCurtainAt(
  sampler3D noise,
  vec3 point,
  vec3 across,
  vec2 carried,
  float curtains,
  float gust,
  float scale
) {
  if (curtains <= 0.0) return 1.0;
  vec3 moved = point - vec3(carried, 0.0);
  vec2 downwind = vec2(-across.y, across.x);
  vec3 place = vec3(
    dot(moved.xy, across.xy) / ${formatFloat(CURTAIN_TABLE.across)},
    dot(moved.xy, downwind) / ${formatFloat(CURTAIN_TABLE.along)},
    moved.z / ${formatFloat(CURTAIN_TABLE.up)}
  ) / max(scale, 1.0);
  float field = texture(noise, place).r;
  float sheets = ${formatFloat(CURTAIN_TABLE.gap)} +
    ${formatFloat(CURTAIN_TABLE.sheet)} * ${formatStep(CURTAIN_TABLE.edges, 'field')};
  sheets *= 1.0 + ${formatFloat(CURTAIN_TABLE.gustGain)} * gust;
  // The gusts that drive them are low: higher up the rain is an even veil, so the sky has no pillars in it.
  float low = 1.0 - ${formatStep(CURTAIN_TABLE.aloft, 'point.z')};
  return mix(1.0, sheets, clamp(curtains / ${formatFloat(CURTAIN_TABLE.whole)}, 0.0, 1.0) * low);
}
`;

const WEATHER_DECLARATION = /* glsl */ `
layout(std140) uniform weatherUniforms {
  vec4 clock;
  vec4 timing;
  vec4 gusts;
  vec4 amounts;
  vec4 moreAmounts;
  vec4 storm;
  vec4 flood;
  vec4 rainVelocity;
  vec4 rainDrift;
  vec4 rainAcross;
  vec4 rainAbove;
  vec4 airVelocity;
  vec4 airDrift;
  vec4 lens;
  vec4 ambient;
  vec4 keyLight;
  vec4 keyTravel;
  vec4 flashLight;
  vec4 flashTravel;
  vec4 fog;
  vec4 horizon;
  vec4 shaft;
  vec4 ring;
  vec4 cameraMotion;
  vec4 cameraSpin;
} weather;
`;

/** What `weather` holds for a frame. See `getWeatherUniforms`. */
type WeatherUniforms = {
  /**
   * Scene seconds, which everything that moves runs on; wind strength 0-1; 0-1, new with each
   * sub-frame, for dither; camera distance.
   */
  clock: number[];
  /** Cycle second, scene seconds per story second, splashes, wrecks. */
  timing: number[];
  /**
   * The unit vector the wind blows toward, x and y; the gust at the view point 0-1; and the gust
   * clock `TreeLayer`'s fronts run on.
   */
  gusts: number[];
  /** Rain, debris, motes, petals. */
  amounts: number[];
  /** Sparkle, mist, how much of the mist is steam, and metres a torn leaf has sunk. */
  moreAmounts: number[];
  /** Curtains, spray, how much floats, and the plumes there are. */
  storm: number[];
  /** The flood's level, its high-water mark, and the metres it has carried what floats, x and y. */
  flood: number[];
  /** Metres per second, then speed. */
  rainVelocity: number[];
  /** Metres moved since the cycle began, on the scene clock, then the length of that path. */
  rainDrift: number[];
  /** A unit vector across the rain, on the ground, and one across it and that. */
  rainAcross: number[];
  rainAbove: number[];
  airVelocity: number[];
  airDrift: number[];
  /** Lens radius, focus distance, near and far planes, in metres. */
  lens: number[];
  /** Linear light, then, for the key, the strength of its shadow. */
  ambient: number[];
  keyLight: number[];
  /** Unit vector the light travels along. */
  keyTravel: number[];
  flashLight: number[];
  flashTravel: number[];
  /** Display color, 0-1, and density per metre. */
  fog: number[];
  /** Linear light of the horizon, the fog's color ahead of the curve: what a drop mostly shows. */
  horizon: number[];
  /** Position of the shaft of light, and radius, in metres, or a radius of 0 for none. */
  shaft: number[];
  /** Radius of the magic ring; strength of the shaft. */
  ring: number[];
  /**
   * How the camera moves, per cycle second: its eye's velocity in metres, and its spin, as a vector along the
   * axis it turns about in radians, so a point can be drawn out along the way it crosses the frame.
   */
  cameraMotion: number[];
  cameraSpin: number[];
};

const weatherModule = {
  name: 'weather',
  vs: WEATHER_DECLARATION,
  fs: WEATHER_DECLARATION,
  uniformTypes: {
    clock: 'vec4<f32>',
    timing: 'vec4<f32>',
    gusts: 'vec4<f32>',
    amounts: 'vec4<f32>',
    moreAmounts: 'vec4<f32>',
    storm: 'vec4<f32>',
    flood: 'vec4<f32>',
    rainVelocity: 'vec4<f32>',
    rainDrift: 'vec4<f32>',
    rainAcross: 'vec4<f32>',
    rainAbove: 'vec4<f32>',
    airVelocity: 'vec4<f32>',
    airDrift: 'vec4<f32>',
    lens: 'vec4<f32>',
    ambient: 'vec4<f32>',
    keyLight: 'vec4<f32>',
    keyTravel: 'vec4<f32>',
    flashLight: 'vec4<f32>',
    flashTravel: 'vec4<f32>',
    fog: 'vec4<f32>',
    horizon: 'vec4<f32>',
    shaft: 'vec4<f32>',
    ring: 'vec4<f32>',
    cameraMotion: 'vec4<f32>',
    cameraSpin: 'vec4<f32>'
  }
} as const satisfies ShaderModule<WeatherUniforms>;

/** Light, the curve and the ground, the same as the rest of the frame's. */
const WEATHER_SHARED_GLSL = /* glsl */ `
vec3 weatherFilmic(vec3 x) {
  x = max(x, vec3(0.0));
  vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  return pow(mapped, vec3(1.0 / 2.2));
}

float weatherFogVisibility(float metres) {
  return exp(-weather.fog.a * metres);
}

// How much of the shaft of light a point is in, 0-1.
float weatherShaftBody(vec3 point) {
  if (weather.shaft.w <= 0.0) return 0.0;
  vec3 axis = -weather.keyTravel.xyz;
  vec3 offset = point - weather.shaft.xyz;
  float along = max(dot(offset, axis), 0.0);
  vec3 across = offset - axis * along;
  float radius = weather.shaft.w * ${formatFloat(SHAFT_TABLE.flatRadius)} *
    (1.0 + along * ${formatFloat(AIR_TABLE.shaftSpread)});
  float reach = dot(across, across) / (radius * radius);
  // Even across its middle, and soft at its edge, which shows against whatever is dark behind it.
  return exp(-reach * reach);
}

${LAND_GLSL}

// What things land on or float on: the land, or the flood's plane where it stands over it.
float weatherGround(vec2 p) {
  return max(fieldLandHeight(p), weather.flood.x);
}

// The gust that TreeLayer's trees stand in here, 0-1, as the view point's is weather.gusts.z.
float weatherGustAt(vec2 p) {
  return treeWind_getGust(p, weather.gusts.w, weather.gusts.xy, weather.clock.y, 0.0);
}

// A lightning flash's light, as a share of it, with a shoulder so it never adds more than most: what it lights goes
// blue-white at its peak and keeps its shape.
vec3 weatherFlashShare(float share, float most) {
  vec3 light = weather.flashLight.rgb * share;
  return light / (1.0 + max(max(light.r, light.g), light.b) / most);
}

// How the spray and the plumes go with the gust here, against the view point's, in which the
// story's amounts are already.
float weatherGustPulse(vec2 p) {
  return (0.6 + 0.4 * weatherGustAt(p)) / (0.6 + 0.4 * weather.gusts.z);
}
`;

/** Everything a vertex stage of this layer shares. */
const WEATHER_VERTEX_GLSL = /* glsl */ `
const vec4 WEATHER_CULLED = vec4(2.0, 2.0, 2.0, 1.0);
const float WEATHER_LOWEST = ${formatFloat(WEATHER_LOWEST)};

#ifdef MODULE_SHADOW
uniform sampler2D weatherShadowMap;
const vec4 WEATHER_SHADOW_UNPACK = vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0);
#endif

struct WeatherView {
  vec3 eye;
  vec3 forward;
  vec3 right;
  vec3 up;
  // Pixels of a metre, a metre from the eye.
  float focal;
} weatherView;

// From the matrices, not the story's camera, so a lens or a shake moves it all alike. Particles
// live in metres in the field, and deck's common space is centered on the view's target.
void weatherLoadView() {
  mat4 m = project.viewProjectionMatrix;
  vec3 rowX = vec3(m[0][0], m[1][0], m[2][0]);
  vec3 rowY = vec3(m[0][1], m[1][1], m[2][1]);
  vec3 rowW = vec3(m[0][3], m[1][3], m[2][3]);
  weatherView.eye = project.cameraPosition + project.coordinateOrigin;
  weatherView.forward = normalize(rowW);
  weatherView.right = normalize(rowX);
  weatherView.up = normalize(rowY);
  weatherView.focal = 0.5 * project.viewportSize.y * length(rowY) / length(rowW);
}

// Pixels of a frame 720 on its short side, in this frame's, so that a thin thing is as thin at any
// size of frame.
float weatherPixelScale() {
  return max(min(project.viewportSize.x, project.viewportSize.y) / 720.0, 0.75);
}

vec4 weatherToClip(vec3 point) {
  return project_common_position_to_clipspace(vec4(point - project.coordinateOrigin, 1.0));
}

// What makes clip z and w of a point in metres: dot(row.xyz, point) + row.w, for a fragment stage
// that works out a depth of its own.
void weatherClipRows(out vec4 rowZ, out vec4 rowW) {
  mat4 m = project.viewProjectionMatrix;
  vec3 origin = project.coordinateOrigin;
  vec3 z = vec3(m[0][2], m[1][2], m[2][2]);
  vec3 w = vec3(m[0][3], m[1][3], m[2][3]);
  rowZ = vec4(z, m[3][2] + project.center.z - dot(z, origin));
  rowW = vec4(w, m[3][3] + project.center.w - dot(w, origin));
}

vec2 weatherCorner() {
  return vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
}

// Three values 0-1 for an index, by PCG3D. All the randomness there is.
vec3 weatherHash(int index, int salt) {
  uvec3 v = uvec3(uint(index), uint(salt), 2654435769u);
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return vec3(v) * (1.0 / 4294967296.0);
}

// Radius in pixels of the blur a point this deep gets from the lens.
float weatherBlurPixels(float depth) {
  return weather.lens.x * weatherView.focal * abs(1.0 / weather.lens.y - 1.0 / depth);
}

// How far inside its box a point is, fading out at the sides. The floor, if the ground, stays.
float weatherEdgeFade(vec3 inBox, vec3 box, bool onGround) {
  vec3 edge = min(inBox, box - inBox) / (box * ${formatFloat(RAIN_TABLE.edgeBand)});
  float top = onGround ? (box.z - inBox.z) / (box.z * ${formatFloat(RAIN_TABLE.edgeBand)}) : edge.z;
  return smoothstep(0.0, 1.0, min(edge.x, edge.y)) * smoothstep(0.0, 1.0, top);
}

// The box a set of particles lives in: its low corner, following the camera, never under the
// floor of a furrow, as the camera may look along one.
vec3 weatherBoxOrigin(vec3 box, float ahead) {
  vec3 origin = weatherView.eye + weatherView.forward * ahead - box * 0.5;
  origin.z = max(origin.z, WEATHER_LOWEST);
  return origin;
}

bool weatherIsOnGround(vec3 origin) {
  return origin.z <= WEATHER_LOWEST + 1e-3;
}

// How much of the key light reaches a point, 0-1.
float weatherSunAt(vec3 point) {
#ifdef MODULE_SHADOW
  if (weather.keyLight.a <= 0.0) return 1.0;
  vec4 position = project_common_position_to_clipspace(
    vec4(point - project.coordinateOrigin, 1.0),
    shadow.viewProjectionMatrix0,
    shadow.projectCenter0
  );
  vec3 place = (position.xyz / position.w + 1.0) * 0.5;
  if (place.x <= 0.0 || place.y <= 0.0 || place.x >= 1.0 || place.y >= 1.0) return 1.0;
  ivec2 size = textureSize(weatherShadowMap, 0);
  vec4 texel = texelFetch(weatherShadowMap, ivec2(place.xy * vec2(size)), 0);
  float depth = dot(texel, WEATHER_SHADOW_UNPACK);
  return mix(1.0, place.z <= depth ? 1.0 : 0.0, weather.keyLight.a);
#else
  return 1.0;
#endif
}
`;

/** A drop's light and a thin streak's place, which rain and the splashes' drops share. */
const STREAK_VERTEX_GLSL = /* glsl */ `
// What a drop shows: it is a small wide lens, so the horizon and the air around it above all, which
// in rain is the light of the veil, and it blazes backlit. So it reads against a dark crown, and is
// lost against a bright sky.
vec3 weatherDropLight(vec3 toCamera) {
  vec3 light = weather.horizon.rgb * 0.92 + weather.ambient.rgb * 0.1;
  float backlit = max(dot(weather.keyTravel.xyz, toCamera), 0.0);
  light += weather.keyLight.rgb * (0.04 + 1.3 * pow(backlit, 12.0));
  float flashBack = max(dot(weather.flashTravel.xyz, toCamera), 0.0);
  light += weather.flashLight.rgb * (0.3 + 0.9 * flashBack * flashBack);
  return light;
}

// A corner of a thin quad along a line, as wide as asked in pixels. Returns its length in pixels,
// or less than zero if it is all behind the camera.
float weatherPlaceStreak(vec3 from, vec3 to, float width, vec2 corner) {
  float fromDepth = dot(from - weatherView.eye, weatherView.forward);
  float toDepth = dot(to - weatherView.eye, weatherView.forward);
  float planeNear = weather.lens.z * 1.05;
  if (fromDepth < planeNear && toDepth < planeNear) return -1.0;
  if (fromDepth < planeNear) from = mix(from, to, (planeNear - fromDepth) / (toDepth - fromDepth));
  else if (toDepth < planeNear) to = mix(to, from, (planeNear - toDepth) / (fromDepth - toDepth));
  vec4 fromClip = weatherToClip(from);
  vec4 toClip = weatherToClip(to);
  vec2 pixels = project.viewportSize * 0.5;
  vec2 fromPixel = fromClip.xy / fromClip.w * pixels;
  vec2 toPixel = toClip.xy / toClip.w * pixels;
  vec2 along = toPixel - fromPixel;
  float streak = length(along);
  along = streak > 1e-3 ? along / streak : vec2(0.0, 1.0);
  vec2 across = vec2(-along.y, along.x);
  vec4 clip = corner.y < 0.0 ? fromClip : toClip;
  vec2 pixel = corner.y < 0.0 ? fromPixel : toPixel;
  pixel += across * corner.x * width * 0.5 + along * corner.y * width * 0.5;
  gl_Position = vec4(pixel / pixels * clip.w, clip.z, clip.w);
  return streak;
}
`;

function getRainLayerGlsl(): string {
  const lines: string[] = [];
  let first = 0;
  for (const {count, across, high, ahead, alpha} of RAIN_TABLE.layers) {
    lines.push(`  if (index < ${first + count}) {
    box = ${formatTriple([across, across, high])};
    ahead = ${formatFloat(ahead)};
    gain = ${formatFloat(alpha)};
    return;
  }`);
    first += count;
  }
  return `void weatherRainLayer(int index, out vec3 box, out float ahead, out float gain) {
  box = vec3(1.0);
  ahead = 0.0;
  gain = 0.0;
${lines.join('\n')}
}`;
}

const RAIN_VERTEX = /* glsl */ `#version 300 es
#define SHADER_NAME weather-rain-vs
precision highp float;
precision highp int;
precision highp sampler2D;

${WEATHER_SHARED_GLSL}
${WEATHER_VERTEX_GLSL}
${STREAK_VERTEX_GLSL}
${getRainLayerGlsl()}

out vec2 vUv;
out vec3 vColor;
out float vAlpha;
out float vTaper;

void main() {
  weatherLoadView();
  gl_Position = WEATHER_CULLED;
  vUv = weatherCorner();
  vColor = vec3(0.0);
  vAlpha = 0.0;
  vTaper = 1.0;
  int index = gl_InstanceID;
  float rain = weather.amounts.x;
  float pixelRatio = weatherPixelScale();
  // Slow motion shortens what a shutter sees of a drop.
  float shutter = ${formatFloat(RAIN_TABLE.shutter)} * weather.timing.y;

  if (index < ${RAIN_DROPS}) {
    vec3 box;
    float ahead;
    float gain;
    weatherRainLayer(index, box, ahead, gain);
    vec3 place = weatherHash(index, 11);
    vec3 kind = weatherHash(index, 12);
    vec3 look = weatherHash(index, 16);
    // Harder rain is more drops, not brighter ones.
    if (kind.x > pow(rain, 0.7)) return;
    float size = kind.y * kind.y;
    float radius = ${formatMix(RAIN_TABLE.radius, 'size')};
    float speed = ${formatMix(RAIN_TABLE.speed, 'sqrt(size)')};

    // Frozen at its frame's own second, which every sub-frame of the frame shares: where the drop
    // is then, on the scene clock, from where it is now.
    float frameAt = floor(weather.timing.x * ${formatFloat(RAIN_TABLE.frameRate)} + 0.5) /
      ${formatFloat(RAIN_TABLE.frameRate)};
    float toFrame = (frameAt - weather.timing.x) * weather.timing.y;
    vec3 drift = weather.rainDrift.xyz + weather.rainVelocity.xyz * toFrame;
    vec3 origin = weatherBoxOrigin(box, ahead);
    vec3 inBox = mod(place * box + drift * speed - origin, box);
    vec3 center = origin + inBox;
    float depth = dot(center - weatherView.eye, weatherView.forward);
    if (depth < weather.lens.z * 1.5) return;

    // A short dash of its flight: slow motion shortens it, as it does what a shutter sees.
    vec3 stepBy = weather.rainVelocity.xyz * speed *
      ${formatFloat(RAIN_TABLE.exposure)} * weather.timing.y * 0.5;
    float pixelsPerMetre = weatherView.focal / depth;
    float drop = 2.0 * radius * pixelsPerMetre;
    float blur = weatherBlurPixels(depth);
    float least = ${formatFloat(RAIN_TABLE.leastWidth)} * pixelRatio *
      ${formatMix([1, RAIN_TABLE.widest], 'look.y * look.y * look.y')};
    float width = max(max(drop, least), blur * ${formatFloat(RAIN_TABLE.blurShare)});
    float streak = weatherPlaceStreak(
      center - stepBy,
      center + stepBy,
      width * ${formatFloat(RAIN_TABLE.quadShare)},
      vUv
    );
    if (streak < 0.0) return;

    float metres = length(center - weatherView.eye);
    // Some catch more of the sky than others.
    float glint = ${formatMix(RAIN_TABLE.glint, 'look.x * look.x')};
    vColor = weatherFilmic(weatherDropLight((weatherView.eye - center) / metres) * glint);
    // A thin line's share of a pixel, a far one's kept a little, and a long one's light spread
    // along it.
    float thin = min(pow(drop / width, 0.7) * 2.4, 1.0);
    float spread = clamp(64.0 * pixelRatio / (streak + width), 0.25, 1.0);
    // So close to the lens that it is too spread out to see, or would cross the frame as a wire.
    float tooWide = 1.0 - smoothstep(14.0, 40.0, blur / pixelRatio);
    float closeBy = ${formatStep(RAIN_TABLE.lensFade, 'metres')};
    vAlpha = gain * thin * spread * tooWide * closeBy *
      weatherEdgeFade(inBox, box, weatherIsOnGround(origin)) * weatherFogVisibility(metres) *
      smoothstep(weather.lens.z * 1.5, weather.lens.z * 4.0, depth);
    vTaper = clamp(width * 2.0 / max(streak, 1.0) + 0.2, 0.2, 1.0);
    return;
  }

  // A splash: one small drop thrown back up from dry ground, a moment, in a new place each time.
  vec3 kind = weatherHash(index, 13);
  if (kind.x > pow(rain, 0.8)) return;
  float seconds = ${formatMix(RAIN_TABLE.splashes.seconds, 'kind.y')};
  float cycle = weather.clock.x / seconds + kind.z * 17.0;
  float life = fract(cycle);
  int turnOf = int(floor(cycle));
  vec3 place = weatherHash(index + turnOf * 7919, 14);
  vec3 throwBy = weatherHash(index + turnOf * 7919, 15);
  const float across = ${formatFloat(RAIN_TABLE.splashes.across)};
  vec3 box = vec3(across, across, 1.0);
  vec3 origin = weatherView.eye + weatherView.forward * ${formatFloat(RAIN_TABLE.splashes.ahead)} -
    box * 0.5;
  vec2 onGround = origin.xy + mod(place.xy * across - origin.xy, vec2(across));
  float land = fieldLandHeight(onGround);
  // Standing water draws its own rings.
  if (weather.flood.x > land - 0.002) return;
  float age = life * seconds;
  float rise = ${formatMix(RAIN_TABLE.splashes.rise, 'throwBy.x')};
  float angle = throwBy.y * 6.2831853;
  vec2 windward = weather.airVelocity.xy / max(weather.airVelocity.w, 1.0);
  float blown = weather.clock.y * ${formatFloat(RAIN_TABLE.splashes.blown)};
  vec2 outward = vec2(cos(angle), sin(angle)) * rise * 0.45 +
    windward * blown * (0.4 + 0.6 * throwBy.z);
  float climb = rise - ${formatFloat(RAIN_TABLE.splashes.gravity)} * age;
  vec3 at = vec3(
    onGround + outward * age,
    land + 0.008 + max(rise * age - 0.5 * ${formatFloat(RAIN_TABLE.splashes.gravity)} * age * age, 0.0)
  );
  vec3 motion = vec3(outward, climb) * shutter;
  float depth = dot(at - weatherView.eye, weatherView.forward);
  if (depth < weather.lens.z * 2.0) return;
  float width = max(
    ${formatFloat(RAIN_TABLE.leastWidth)} * pixelRatio,
    weatherBlurPixels(depth) * ${formatFloat(RAIN_TABLE.blurShare)}
  );
  float streak = weatherPlaceStreak(
    at - motion,
    at,
    width * ${formatFloat(RAIN_TABLE.quadShare)},
    vUv
  );
  if (streak < 0.0) return;
  float metres = length(at - weatherView.eye);
  vColor = weatherFilmic(weatherDropLight((weatherView.eye - at) / metres) * 1.1);
  float closeBy = 1.0 - ${formatStep(RAIN_TABLE.splashes.fade, 'metres')};
  // A hard wind tears them into spray, which there is little to see of.
  float torn = 1.0 - 0.7 * smoothstep(0.1, 0.5, weather.clock.y);
  vAlpha = ${formatFloat(RAIN_TABLE.splashes.alpha)} * torn * (1.0 - life) * closeBy *
    weatherFogVisibility(metres);
  vTaper = 0.6;
}
`;

const RAIN_FRAGMENT = /* glsl */ `#version 300 es
#define SHADER_NAME weather-rain-fs
precision highp float;

in vec2 vUv;
in vec3 vColor;
in float vAlpha;
in float vTaper;
out vec4 fragColor;

void main() {
  float across = exp(-vUv.x * vUv.x * 3.2);
  float along = abs(vUv.y);
  float ends = 1.0 - smoothstep(1.0 - vTaper, 1.0, along);
  float alpha = vAlpha * across * ends;
  fragColor = vec4(vColor * alpha, alpha);
}
`;

/**
 * Where something heavy hits the water: its drops, thrown up and falling back, as streaks. The
 * fragment stage is the rain's.
 */
const SPATTER_VERTEX = /* glsl */ `#version 300 es
#define SHADER_NAME weather-spatter-vs
precision highp float;
precision highp int;
precision highp sampler2D;

${WEATHER_SHARED_GLSL}
${WEATHER_VERTEX_GLSL}
${STREAK_VERTEX_GLSL}

uniform sampler2D weatherFrame;

out vec2 vUv;
out vec3 vColor;
out float vAlpha;
out float vTaper;

void main() {
  weatherLoadView();
  gl_Position = WEATHER_CULLED;
  vUv = weatherCorner();
  vColor = vec3(0.0);
  vAlpha = 0.0;
  vTaper = 0.5;
  int splash = gl_InstanceID / ${SPLASH_TABLE.drops};
  if (float(splash) >= weather.timing.z) return;
  vec4 hit = texelFetch(weatherFrame, ivec2(splash, ${FRAME_ROW.splash}), 0);
  float size = texelFetch(weatherFrame, ivec2(splash, ${FRAME_ROW.splashMore}), 0).x;
  float age = hit.w;
  if (age <= 0.0 || age >= ${formatFloat(SPLASH_TABLE.dropSeconds)}) return;
  vec3 pick = weatherHash(gl_InstanceID, 81);
  vec3 more = weatherHash(gl_InstanceID, 82);
  // Thrown up and out in a crown, the highest as high as the thing that hit was big.
  const float gravity = ${formatFloat(SPLASH_TABLE.gravity)};
  float angle = pick.x * 6.2831853;
  vec2 outward = vec2(cos(angle), sin(angle));
  float steep = mix(0.55, 1.45, pick.y);
  float speed = sqrt(2.0 * gravity * size * mix(0.15, 1.0, pick.z * pick.z)) / sin(steep);
  vec3 velocity = vec3(outward * speed * cos(steep), speed * sin(steep));
  // The wind takes the smaller drops with it.
  velocity.xy += weather.airVelocity.xy * 0.12 * (1.0 - more.y);
  vec3 start = hit.xyz + vec3(outward * size * 0.3 * more.x, 0.0);
  vec3 at = start + velocity * age - vec3(0.0, 0.0, 0.5 * gravity * age * age);
  if (at.z < weather.flood.x - 0.01) return;
  vec3 moving = velocity - vec3(0.0, 0.0, gravity * age);
  float shutter = ${formatFloat(RAIN_TABLE.shutter)} * weather.timing.y;
  float depth = dot(at - weatherView.eye, weatherView.forward);
  if (depth < weather.lens.z * 2.0) return;
  float radius = ${formatMix(SPLASH_TABLE.radius, 'more.z')};
  float pixelsPerMetre = weatherView.focal / depth;
  float drop = 2.0 * radius * pixelsPerMetre;
  float width = max(
    max(drop, ${formatFloat(RAIN_TABLE.leastWidth)} * weatherPixelScale()),
    weatherBlurPixels(depth) * ${formatFloat(RAIN_TABLE.blurShare)}
  );
  float streak = weatherPlaceStreak(
    at - moving * shutter,
    at,
    width * ${formatFloat(RAIN_TABLE.quadShare)},
    vUv
  );
  if (streak < 0.0) return;
  float metres = length(at - weatherView.eye);
  vColor = weatherFilmic(weatherDropLight((weatherView.eye - at) / metres) * 1.15);
  float thin = min(drop / width * 2.4, 1.0);
  vAlpha = ${formatFloat(SPLASH_TABLE.alpha)} * thin *
    (1.0 - smoothstep(${formatFloat(SPLASH_TABLE.dropSeconds * 0.6)}, ${formatFloat(SPLASH_TABLE.dropSeconds)}, age)) *
    weatherFogVisibility(metres);
  vTaper = clamp(width * 2.0 / max(streak, 1.0) + 0.2, 0.2, 1.0);
}
`;

/** Sets of flakes as GLSL, from index `first` on: each says what it is if the index is in it. */
function getFlakeSetGlsl(sets: typeof LEAF_SETS, first: number, kind: string): string {
  let start = first;
  return sets
    .map(set => {
      const end = start + set.count;
      const text = `  if (index < ${end}) {
    box = ${formatTriple([set.across, set.across, set.high])};
    ahead = ${formatFloat(set.ahead)};
    size = ${formatFloat(set.length)};
    kind = ${kind};
    isFar = ${formatFloat(set.far)};
    return;
  }`;
      start = end;
      return text;
    })
    .join('\n');
}

const FLAKE_VERTEX = /* glsl */ `#version 300 es
#define SHADER_NAME weather-flake-vs
precision highp float;
precision highp int;
precision highp sampler2D;

${WEATHER_SHARED_GLSL}
${WEATHER_VERTEX_GLSL}

out vec2 vUv;
out vec3 vColor;
out float vAlpha;
flat out float vKind;
// 0 its own shape, 1 nothing but a soft spot of the lens's blur.
flat out float vSoft;

const float WEATHER_FLAKE_LEAF = 0.0;
const float WEATHER_FLAKE_TWIG = 1.0;
const float WEATHER_FLAKE_PETAL = 2.0;

void weatherFlakeSet(
  int index,
  out vec3 box,
  out float ahead,
  out float size,
  out float kind,
  out float isFar
) {
  box = vec3(1.0);
  ahead = 0.0;
  size = 0.0;
  kind = WEATHER_FLAKE_LEAF;
  isFar = 0.0;
${getFlakeSetGlsl(LEAF_SETS, 0, 'WEATHER_FLAKE_LEAF')}
${getFlakeSetGlsl(PETAL_SETS, LEAF_FLAKES, 'WEATHER_FLAKE_PETAL')}
}

mat3 weatherRotation(vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  float k = 1.0 - c;
  return mat3(
    c + axis.x * axis.x * k, axis.y * axis.x * k + axis.z * s, axis.z * axis.x * k - axis.y * s,
    axis.x * axis.y * k - axis.z * s, c + axis.y * axis.y * k, axis.z * axis.y * k + axis.x * s,
    axis.x * axis.z * k + axis.y * s, axis.y * axis.z * k - axis.x * s, c + axis.z * axis.z * k
  );
}

void main() {
  weatherLoadView();
  gl_Position = WEATHER_CULLED;
  vUv = weatherCorner();
  vColor = vec3(0.0);
  vAlpha = 0.0;
  vKind = 0.0;
  vSoft = 0.0;
  int index = gl_InstanceID;
  float time = weather.clock.x;
  float wind = weather.clock.y;
  float pixelRatio = weatherPixelScale();

  vec3 box;
  float ahead;
  float size;
  float kind;
  float isFar;
  weatherFlakeSet(index, box, ahead, size, kind, isFar);
  bool isPetal = kind > 1.5;
  vec3 place = weatherHash(index, 21);
  vec3 trait = weatherHash(index, 22);
  vec3 turn = weatherHash(index, 23);
  vec3 sway = weatherHash(index, 24);
  float amount = isPetal ? weather.amounts.w : weather.amounts.y;
  if (trait.x > pow(amount, 0.75)) return;
  // In a storm's wind every tree sheds leaves of their true size: the larger than life ones go.
  float farGone = isFar > 0.5 && !isPetal ? ${formatStep(FAR_LEAVES_GONE, 'wind')} : 0.0;
  if (farGone >= 1.0) return;
  if (!isPetal && sway.z < ${formatFloat(FLAKE_TABLE.twigShare)}) kind = WEATHER_FLAKE_TWIG;

  // How it moves: with the air, at its own share of it, sinking, and pushed about.
  float share = isPetal ? mix(0.35, 0.8, trait.y) : mix(0.28, 0.8, trait.y);
  float sinking = isPetal
    ? ${formatFloat(FLAKE_TABLE.petalSink)} * mix(0.65, 1.35, trait.z) * time
    : weather.moreAmounts.w * mix(0.7, 1.3, trait.z);
  vec3 drift = weather.airDrift.xyz * share - vec3(0.0, 0.0, sinking);
  vec3 origin = weatherBoxOrigin(box, ahead);
  vec3 inBox = mod(place * box + drift - origin, box);
  float pushed = isPetal ? 0.12 + wind * 0.6 : 0.25 + wind * 2.6;
  float rate = isPetal ? mix(0.8, 1.9, sway.x) : mix(2.0, 6.0, sway.x);
  vec3 phase = sway * 6.2831853;
  vec3 push = vec3(
    sin(time * rate + phase.x) + 0.5 * sin(time * rate * 2.3 + phase.y),
    cos(time * rate * 1.3 + phase.y) + 0.5 * sin(time * rate * 1.9 + phase.z),
    0.6 * sin(time * rate * 0.8 + phase.z)
  ) * pushed;
  vec3 center = origin + inBox + push;
  if (center.z < weatherGround(center.xy) + 0.003) return;

  vec3 fromEye = center - weatherView.eye;
  float depth = dot(fromEye, weatherView.forward);
  if (depth < weather.lens.z * 2.0) return;
  float metres = length(fromEye);

  // How it tumbles: faster the more air has gone by it.
  vec3 axis = normalize(turn - 0.5);
  float spin = isPetal
    ? time * mix(0.7, 2.4, turn.x) + 1.1 * sin(time * mix(1.4, 2.6, turn.y) + phase.x)
    : weather.airDrift.w * mix(0.2, 0.9, turn.x) + time * mix(1.2, 3.2, turn.y);
  mat3 rotation = weatherRotation(axis, spin + turn.z * 6.2831853);
  vec3 alongAxis = rotation[0];
  vec3 acrossAxis = rotation[1];
  vec3 normal = rotation[2];

  // Its shape, kept at least about a pixel across, and as wide as the lens's blur, by taking away
  // alpha.
  float length0 = size * mix(0.7, 1.25, trait.y);
  float width0 = length0 * (
    isPetal ? ${formatFloat(FLAKE_TABLE.petalWidth)} : ${formatFloat(FLAKE_TABLE.leafWidth)}
  );
  if (kind == WEATHER_FLAKE_TWIG) {
    float scale = size / ${formatFloat(LEAF_SETS[0].length)};
    length0 = ${formatMix(FLAKE_TABLE.twigLength, 'trait.y')} * scale;
    width0 = ${formatFloat(FLAKE_TABLE.twigWidth)} * scale;
  }
  float pixelsPerMetre = weatherView.focal / depth;
  float blurMetres = weatherBlurPixels(depth) * 0.85 / pixelsPerMetre;
  float least = max(0.7 * pixelRatio / pixelsPerMetre, blurMetres);
  float flakeLength = max(length0, least);
  float flakeWidth = max(width0, least);
  float coverage = (length0 / flakeLength) * (width0 / flakeWidth);
  vSoft = smoothstep(0.6, 1.6, blurMetres / length0);

  // A fast one is smeared along its way, so that its sub-frames join up.
  vec3 motion = weather.airVelocity.xyz * share * ${formatFloat(FLAKE_TABLE.shutter)} * 0.5 *
    weather.timing.y;
  vec3 offset = alongAxis * vUv.x * flakeLength + acrossAxis * vUv.y * flakeWidth;
  offset += motion * sign(dot(offset, motion) + 1e-6);
  coverage *= flakeLength / (flakeLength + length(motion));
  gl_Position = weatherToClip(center + offset);

  // Its light.
  vec3 toCamera = -fromEye / metres;
  float facing = dot(normal, toCamera);
  float sun = isPetal ? weatherSunAt(center) : 1.0;
  float keyTurned = abs(dot(normal, weather.keyTravel.xyz));
  float keyThrough = dot(normal, weather.keyTravel.xyz) * facing > 0.0 ? 0.65 : 1.0;
  float flashTurned = abs(dot(normal, weather.flashTravel.xyz));
  vec3 light = weather.ambient.rgb * (0.62 + 0.38 * abs(normal.z)) +
    weather.keyLight.rgb * sun * keyTurned * keyThrough +
    weather.flashLight.rgb * (0.2 + 0.8 * flashTurned);
  vec3 albedo;
  if (isPetal) {
    albedo = vec3(0.82, 0.8, 0.72);
  } else if (kind == WEATHER_FLAKE_TWIG) {
    albedo = mix(vec3(0.075, 0.058, 0.042), vec3(0.15, 0.115, 0.08), trait.z);
  } else {
    // Dark above and pale below, as they are on the tree, a few already scorched by salt and wind.
    vec3 upper = mix(vec3(0.028, 0.075, 0.018), vec3(0.06, 0.13, 0.03), trait.z);
    vec3 lower = mix(vec3(0.14, 0.19, 0.1), vec3(0.2, 0.25, 0.14), trait.z);
    albedo = facing > 0.0 ? upper : lower;
    if (turn.y > 0.88) albedo = mix(albedo, vec3(0.2, 0.13, 0.05), 0.75);
  }
  vec3 color = albedo * light;
  if (!isPetal) {
    // Wet, so it mirrors the sky at a glancing angle.
    float glance = 1.0 - abs(facing);
    color += weather.ambient.rgb * 0.45 * glance * glance * glance;
  }
  vColor = weatherFilmic(color);

  float lens = ${formatStep(FLAKE_TABLE.lensFade, 'metres')};
  if (isFar > 0.5) lens *= ${formatStep(FAR_FLAKES_FROM, 'metres')} * (1.0 - farGone);
  vAlpha = coverage * lens * weatherEdgeFade(inBox, box, false) * weatherFogVisibility(metres);
  vKind = kind;
}
`;

const FLAKE_FRAGMENT = /* glsl */ `#version 300 es
#define SHADER_NAME weather-flake-fs
precision highp float;

in vec2 vUv;
in vec3 vColor;
in float vAlpha;
flat in float vKind;
flat in float vSoft;
out vec4 fragColor;

void main() {
  float x = vUv.x;
  float y = abs(vUv.y);
  float edge = max(fwidth(vUv.y), 0.02);
  float mask;
  vec3 color = vColor;
  if (vKind < 0.5) {
    // A leaf: pointed, full in the middle, with a paler rib.
    float span = 1.0 - x * x;
    float outline = pow(max(span, 0.0), 0.8) * (1.0 - 0.18 * x);
    mask = 1.0 - smoothstep(outline - edge, outline + edge, y);
    color *= 0.92 + 0.3 * exp(-y * y * 90.0);
  } else if (vKind < 1.5) {
    mask = 1.0 - smoothstep(0.75 - edge, 1.0, y);
    mask *= 1.0 - smoothstep(0.86, 1.0, abs(x));
  } else {
    // A petal: an oval, narrower at its base.
    float outline = sqrt(max(1.0 - x * x, 0.0)) * (0.86 + 0.14 * x);
    mask = 1.0 - smoothstep(outline - edge * 1.6, outline + edge, y);
    color *= 1.04 - 0.1 * y * y;
  }
  // Far out of focus, each sub-frame's flake is a soft spot, and so many of them make a disc of the
  // lens.
  float spot = exp(-dot(vUv, vUv) * 3.0) - exp(-3.0);
  float alpha = vAlpha * mix(mask, spot * 1.6, vSoft);
  fragColor = vec4(color * alpha, alpha);
}
`;

/**
 * What the flood carries, as the field holds it: fruit as spheres that work out their own depth, so
 * the water hides their lower halves, and leaves and twigs lying flat on it. Each was seeded along
 * the furrows, in the lee of a trunk, against a wreck, at the culvert or anywhere, comes on the water
 * as the flood takes more, rides its drift from there, and is left on the land where the water left
 * it, browning, until all of it is gone.
 */
const FLOAT_VERTEX = /* glsl */ `#version 300 es
#define SHADER_NAME weather-float-vs
precision highp float;
precision highp int;
precision highp sampler2D;

${WEATHER_SHARED_GLSL}
${WEATHER_VERTEX_GLSL}

uniform sampler2D weatherTables;
uniform sampler2D weatherFrame;

out vec3 vWorld;
out vec2 vUv;
flat out vec3 vEye;
flat out vec4 vSphere;
flat out vec4 vClipZ;
flat out vec4 vClipW;
flat out vec3 vAlbedo;
flat out float vSun;
flat out float vKind;
flat out float vWet;
// A fruit: 1 if it is yellowing at the stem end; and 1 if it floats, for its meniscus.
flat out float vBruise;
flat out float vAfloat;

const float WEATHER_FLOAT_FRUIT = 0.0;
const float WEATHER_FLOAT_LEAF = 1.0;
const float WEATHER_FLOAT_TWIG = 2.0;
const float FLOW_FROM = ${formatFloat(FLOW_SECONDS[0])};
const float FLOW_STEP = ${formatFloat((FLOW_SECONDS[1] - FLOW_SECONDS[0]) / (WEATHER_TABLE_TEXELS - 1))};

vec4 weatherFlowTexel(int i) {
  return texelFetch(weatherTables, ivec2(i, ${WEATHER_TABLE_FLOW_ROW}), 0);
}

// The flood at a cycle second: its level, how far it had carried things, x and y, and how much
// floated.
vec4 weatherFlowAt(float seconds) {
  float place = clamp((seconds - FLOW_FROM) / FLOW_STEP, 0.0, ${formatFloat(WEATHER_TABLE_TEXELS - 1)});
  int low = int(floor(place));
  vec4 from = weatherFlowTexel(low);
  vec4 to = weatherFlowTexel(min(low + 1, ${WEATHER_TABLE_TEXELS - 1}));
  return mix(from, to, fract(place));
}

// The first second the flood had both risen over this height and taken on this much to carry.
float weatherFlowArrival(float height, float share) {
  vec4 last = weatherFlowTexel(0);
  if (last.x >= height && last.w >= share) return FLOW_FROM;
  for (int i = 1; i < ${WEATHER_TABLE_TEXELS}; i++) {
    vec4 next = weatherFlowTexel(i);
    if (next.x >= height && next.w >= share) {
      float byLevel = next.x > last.x ? clamp((height - last.x) / (next.x - last.x), 0.0, 1.0) : 0.0;
      float byShare = next.w > last.w ? clamp((share - last.w) / (next.w - last.w), 0.0, 1.0) : 0.0;
      return FLOW_FROM + FLOW_STEP * (float(i - 1) + max(byLevel, byShare));
    }
    last = next;
  }
  return 1e6;
}

// The last second the flood stood over this height, on its way down.
float weatherFlowLeft(float height) {
  vec4 last = weatherFlowTexel(${WEATHER_TABLE_TEXELS - 1});
  if (last.x >= height) return 1e6;
  for (int i = ${WEATHER_TABLE_TEXELS - 2}; i >= 0; i--) {
    vec4 next = weatherFlowTexel(i);
    if (next.x >= height) {
      float u = clamp((next.x - height) / max(next.x - last.x, 1e-6), 0.0, 1.0);
      return FLOW_FROM + FLOW_STEP * (float(i) + u);
    }
    last = next;
  }
  return FLOW_FROM;
}

// Where one was seeded, and 1 if it is caught there, in a trunk's lee, against a wreck or at the culvert, so it
// stays as the water goes by: false if it has nowhere to be, as a wreck that has not fallen.
bool weatherFloatSeed(int index, out vec2 seed, out float caught) {
  caught = 0.0;
  vec3 pick = weatherHash(index, 71);
  vec3 more = weatherHash(index, 72);
  vec2 extent = vec2(${formatFloat(FLOAT_TABLE.extent[0])}, ${formatFloat(FLOAT_TABLE.extent[1])});
  vec2 anywhere = (more.xy * 2.0 - 1.0) * extent;
  // What floats gathers on the side away from where the flood carries it.
  vec2 carry = weather.flood.zw;
  vec2 downstream = dot(carry, carry) > 1e-6 ? normalize(carry) : vec2(1.0, 0.0);
  vec2 aside = vec2(-downstream.y, downstream.x);
  const float shareFurrow = ${formatFloat(FLOAT_TABLE.shares[0])};
  const float shareTrunk = shareFurrow + ${formatFloat(FLOAT_TABLE.shares[1])};
  const float shareWreck = shareTrunk + ${formatFloat(FLOAT_TABLE.shares[2])};
  const float shareCulvert = shareWreck + ${formatFloat(FLOAT_TABLE.shares[3])};
  if (pick.x < shareFurrow) {
    // Along one of the furrows of the block, most of them the hero's: the rest in the two to the
    // south and the one to the north.
    float furrow = 0.0;
    if (pick.y >= ${formatFloat(FLOAT_TABLE.heroFurrow)}) {
      float other = floor((pick.y - ${formatFloat(FLOAT_TABLE.heroFurrow)}) / ${formatFloat(1 - FLOAT_TABLE.heroFurrow)} * 3.0);
      furrow = other < 1.5 ? other - 2.0 : 1.0;
    }
    seed = vec2(
      anywhere.x,
      ${formatFloat(BED_LAYOUT.furrowAt)} + ${formatFloat(BED_LAYOUT.bedSpacing)} * furrow +
        (more.z - 0.5) * ${formatFloat(BED_LAYOUT.furrowTop)}
    );
  } else if (pick.x < shareTrunk) {
    // In the lee of a trunk, in a wedge that widens away from it. The hero's row is set off by half
    // a tree.
    float row = floor(pick.y * 9.0) - 4.0;
    float column = floor(pick.z * 11.0) - 5.0;
    float x = row == 0.0
      ? (column == 0.0 ? 0.0 : sign(column) * (3.0 + 6.0 * abs(column)))
      : 6.0 * column;
    vec2 trunk = vec2(x, ${formatFloat(BED_LAYOUT.rowSpacing)} * row);
    float behind = 0.2 + 1.0 * more.x * more.x;
    seed = trunk + downstream * behind + aside * (more.y - 0.5) * (0.25 + 0.45 * behind);
    caught = 1.0;
  } else if (pick.x < shareWreck) {
    // Dammed against a wreck's crown, on the side the flood comes from.
    int wreck = int(floor(pick.y * ${formatFloat(FLOAT_TABLE.wrecks)}));
    if (float(wreck) >= weather.timing.w) return false;
    vec4 crown = texelFetch(weatherFrame, ivec2(wreck, ${FRAME_ROW.wreck}), 0);
    seed = crown.xy - downstream * crown.z * mix(0.6, 1.0, more.x) +
      aside * (more.y - 0.5) * 1.6 * crown.z;
    caught = 1.0;
  } else if (pick.x < shareCulvert) {
    // At the culvert's west mouth, where the furrow runs in under the hero's crown.
    seed = vec2(
      ${formatFloat(BED_LAYOUT.crossing.x[0])} - 2.2 * more.x * more.x,
      ${formatFloat(BED_LAYOUT.furrowAt)} + (more.y - 0.5) * 1.6
    );
    caught = 1.0;
  } else {
    seed = anywhere;
  }
  return true;
}

void main() {
  weatherLoadView();
  gl_Position = WEATHER_CULLED;
  vUv = weatherCorner();
  vWorld = vec3(0.0);
  vEye = weatherView.eye;
  vSphere = vec4(0.0);
  vAlbedo = vec3(0.0);
  vSun = 1.0;
  vKind = WEATHER_FLOAT_FRUIT;
  vWet = 0.0;
  vBruise = 0.0;
  vAfloat = 0.0;
  vec4 clipZ;
  vec4 clipW;
  weatherClipRows(clipZ, clipW);
  vClipZ = clipZ;
  vClipW = clipW;
  int index = gl_InstanceID;
  float seconds = weather.timing.x;
  if (seconds >= ${formatFloat(FLOAT_TABLE.gone[1])}) return;

  vec2 seed;
  float caught;
  if (!weatherFloatSeed(index, seed, caught)) return;
  vec3 trait = weatherHash(index, 73);
  vec3 look = weatherHash(index, 74);
  // Gone over the last of the recession, a few at a time.
  if (trait.z < ${formatStep(FLOAT_TABLE.gone, 'seconds')}) return;
  float land = fieldLandHeight(seed);
  float mark = weather.flood.y;
  if (mark < land + 0.004) return;
  // When it came on the water, and how far the water has carried it since.
  float arrived = weatherFlowArrival(land + 0.004, trait.x);
  if (seconds < arrived) return;
  float level = weather.flood.x;
  // What is caught stays, nudged a little as the water goes by it; the rest rides the flood.
  float carry = mix(0.8, 1.2, trait.y) *
    mix(${formatFloat(FLOAT_TABLE.shelter)}, 1.0, ${formatStep(FLOAT_TABLE.shelterLevels, 'level')}) *
    mix(1.0, ${formatFloat(FLOAT_TABLE.caughtCarry)}, caught);
  vec2 since = (weather.flood.zw - weatherFlowAt(arrived).yz) * carry;
  vec2 place = seed + since;
  bool afloat = fieldLandHeight(place) < level - 0.002;
  float strandedFor = 0.0;
  if (!afloat) {
    if (fieldLandHeight(seed) < level - 0.002) {
      // Carried onto a bank: it lies at the water's edge, between where it came on and where the
      // water would have it.
      float wet = 0.0;
      float dry = 1.0;
      for (int i = 0; i < 6; i++) {
        float middle = 0.5 * (wet + dry);
        if (fieldLandHeight(seed + since * middle) < level - 0.002) wet = middle;
        else dry = middle;
      }
      place = seed + since * wet;
      afloat = true;
    } else {
      // Left where the falling water left it.
      float left = weatherFlowLeft(land + 0.004);
      strandedFor = max(seconds - left, 0.0);
      place = seed + (weatherFlowAt(left).yz - weatherFlowAt(arrived).yz) * carry;
    }
  }
  // It turns slowly as it drifts.
  float time = weather.clock.x;
  vec3 phase = look * 6.2831853;
  if (afloat) {
    place += 0.06 * vec2(sin(time * 0.31 + phase.x), cos(time * 0.27 + phase.y));
  }
  float bob = afloat
    ? ${formatFloat(FLOAT_TABLE.bob[0])} * sin(6.2831853 * ${formatFloat(FLOAT_TABLE.bob[1])} * time + phase.z)
    : 0.0;
  float ground = afloat ? level : fieldLandHeight(place);
  vec3 toEye = weatherView.eye - vec3(place, ground);
  float metres = length(toEye);
  if (dot(-toEye, weatherView.forward) < weather.lens.z * 1.5) return;
  float browned = smoothstep(0.0, ${formatFloat(FLOAT_TABLE.browns)}, strandedFor);
  vWet = afloat ? 1.0 : 1.0 - smoothstep(0.0, 2.0, strandedFor) * 0.7;
  vAfloat = afloat ? 1.0 : 0.0;

  if (index < ${FLOAT_TABLE.fruit}) {
    // A green fruit, floating low, a sphere on a quad that faces the camera: two greens, and a few
    // yellowing at the stem end, which floats uppermost, where they were bruised.
    float radius = ${formatMix(FLOAT_TABLE.radius, 'look.x')};
    vec3 center = vec3(place, afloat ? level - radius * ${formatFloat(FLOAT_TABLE.sunk)} + bob : ground + radius * 0.92);
    vec3 green = look.y < ${formatFloat(FLOAT_TABLE.darkShare)}
      ? mix(vec3(0.045, 0.1, 0.016), vec3(0.06, 0.125, 0.02), look.y / ${formatFloat(FLOAT_TABLE.darkShare)})
      : mix(vec3(0.085, 0.165, 0.03), vec3(0.11, 0.19, 0.036), look.y);
    vAlbedo = mix(green, vec3(0.09, 0.06, 0.025), browned);
    vBruise = look.z < ${formatFloat(FLOAT_TABLE.bruisedShare)} ? 1.0 - browned : 0.0;
    vSphere = vec4(center, radius);
    vec3 corner = weatherView.right * vUv.x + weatherView.up * vUv.y;
    vWorld = center + corner * radius * 1.12 + normalize(weatherView.eye - center) * radius;
    gl_Position = weatherToClip(vWorld);
    vSun = weatherSunAt(center + vec3(0.0, 0.0, radius));
    vKind = WEATHER_FLOAT_FRUIT;
    return;
  }

  // A leaf or a twig, lying flat, a little over the water so it never fights it for depth.
  vec3 kind = weatherHash(index, 75);
  bool twig = kind.x < ${formatFloat(FLOAT_TABLE.twigShare)};
  float yaw = look.x * 6.2831853 + (afloat ? 0.25 * sin(time * mix(0.1, 0.3, look.y) + phase.y) : 0.0);
  vec2 along = vec2(cos(yaw), sin(yaw));
  vec2 across = vec2(-along.y, along.x);
  float halfLength = twig
    ? 0.5 * ${formatMix(FLOAT_TABLE.twigLength, 'look.y')}
    : ${formatMix(FLOAT_TABLE.leafLength, 'look.y')};
  float halfWidth = twig ? 0.0028 : halfLength * ${formatFloat(FLAKE_TABLE.leafWidth)};
  // At least a little of a pixel across, so a far one is not lost between them.
  float least = 0.35 * weatherPixelScale() * metres / weatherView.focal;
  halfWidth = max(halfWidth, least);
  vec2 offset = along * vUv.x * halfLength + across * vUv.y * halfWidth;
  float lift = afloat ? ${formatFloat(FLOAT_TABLE.lift)} + bob * 0.5 : 0.006;
  vWorld = vec3(place + offset, ground + lift);
  gl_Position = weatherToClip(vWorld);
  vSun = weatherSunAt(vec3(place, ground + 0.05));
  vec3 upper = mix(vec3(0.028, 0.072, 0.018), vec3(0.06, 0.12, 0.03), look.z);
  vec3 lower = mix(vec3(0.13, 0.17, 0.09), vec3(0.19, 0.23, 0.13), look.z);
  vec3 wood = mix(vec3(0.07, 0.054, 0.04), vec3(0.14, 0.105, 0.07), look.z);
  vec3 albedo = twig ? wood : (kind.y > 0.5 ? upper : lower);
  if (!twig && look.x > 0.86) albedo = mix(albedo, vec3(0.2, 0.13, 0.05), 0.7);
  vAlbedo = mix(albedo, vec3(0.11, 0.08, 0.045), browned);
  vKind = twig ? WEATHER_FLOAT_TWIG : WEATHER_FLOAT_LEAF;
}
`;

const FLOAT_FRAGMENT = /* glsl */ `#version 300 es
#define SHADER_NAME weather-float-fs
precision highp float;

${WEATHER_SHARED_GLSL}

in vec3 vWorld;
in vec2 vUv;
flat in vec3 vEye;
flat in vec4 vSphere;
flat in vec4 vClipZ;
flat in vec4 vClipW;
flat in vec3 vAlbedo;
flat in float vSun;
flat in float vKind;
flat in float vWet;
flat in float vBruise;
flat in float vAfloat;
out vec4 fragColor;

float weatherDepthOf(vec3 point) {
  float z = dot(vClipZ.xyz, point) + vClipZ.w;
  float w = dot(vClipW.xyz, point) + vClipW.w;
  return clamp(z / w * 0.5 + 0.5, 0.0, 1.0);
}

// Lit by the key in its own shade, the sky over it and the flash, wet, and lost in the air with
// distance. Open is how much of the sky it sees, less down by the water.
vec3 weatherFloatLight(vec3 point, vec3 normal, vec3 albedo, float shine, float open) {
  vec3 toEye = vEye - point;
  float metres = length(toEye);
  vec3 view = toEye / metres;
  vec3 toKey = -weather.keyTravel.xyz;
  float lit = max(dot(normal, toKey), 0.0) * vSun;
  vec3 light = weather.keyLight.rgb * lit +
    weather.ambient.rgb * (0.3 + 0.7 * max(normal.z, 0.0)) * open +
    weather.flashLight.rgb * (0.15 + 0.6 * max(dot(normal, -weather.flashTravel.xyz), 0.0));
  vec3 color = albedo * light;
  // Wet: one point of the key's glint, and the sky as Fresnel has it at a glancing angle.
  vec3 halfway = normalize(toKey + view);
  color += weather.keyLight.rgb * pow(max(dot(normal, halfway), 0.0), 160.0) * 0.6 * shine * vSun;
  float glance = 1.0 - max(dot(normal, view), 0.0);
  float fresnel = 0.03 + 0.97 * glance * glance * glance * glance * glance;
  color += weather.ambient.rgb * 0.9 * fresnel * shine * open * max(0.35 + 0.65 * normal.z, 0.0);
  return mix(weather.horizon.rgb, color, weatherFogVisibility(metres));
}

void main() {
  if (vKind < 0.5) {
    vec3 direction = normalize(vWorld - vEye);
    vec3 offset = vEye - vSphere.xyz;
    float along = dot(offset, direction);
    // From the closest point, so a small sphere far off keeps its shape.
    vec3 closest = offset - direction * along;
    float inside = vSphere.w * vSphere.w - dot(closest, closest);
    if (inside < 0.0) discard;
    vec3 hit = vEye + direction * (-along - sqrt(inside));
    vec3 normal = (hit - vSphere.xyz) / vSphere.w;
    // Its oil glands, faintly.
    float dimple = fract(sin(dot(floor(normal * 40.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec3 albedo = vAlbedo * (0.94 + 0.08 * dimple);
    // Yellowing in a small patch round the stem, where it was bruised, the rest of it green, and darker where it
    // has been in the water.
    albedo = mix(albedo, vec3(0.15, 0.15, 0.03), vBruise * smoothstep(0.87, 0.97, normal.z));
    albedo *= mix(1.0, 0.78, (1.0 - smoothstep(-0.2, 0.25, normal.z)) * vWet);
    // Afloat, the water sees to its lower part, and a dark ring of meniscus hugs it at the line.
    float above = hit.z - weather.flood.x;
    float meniscus = vAfloat * (1.0 - smoothstep(0.0, ${formatFloat(FLOAT_TABLE.meniscus)}, above));
    float open = mix(1.0, smoothstep(-0.002, vSphere.w * 0.7, above), vAfloat);
    albedo *= 1.0 - 0.75 * meniscus;
    gl_FragDepth = weatherDepthOf(hit);
    vec3 light = weatherFloatLight(hit, normal, albedo, (0.5 + 0.5 * vWet) * (1.0 - meniscus), open);
    fragColor = vec4(weatherFilmic(light), 1.0);
    return;
  }
  float x = vUv.x;
  float y = abs(vUv.y);
  float mask;
  if (vKind < 1.5) {
    float span = 1.0 - x * x;
    float outline = pow(max(span, 0.0), 0.8) * (1.0 - 0.18 * x);
    mask = step(y, outline);
  } else {
    mask = step(abs(x), 0.96);
  }
  if (mask < 0.5) discard;
  vec3 normal = vec3(0.0, 0.0, 1.0);
  vec3 albedo = vAlbedo * (vKind < 1.5 ? 0.92 + 0.3 * exp(-y * y * 90.0) : 1.0);
  gl_FragDepth = gl_FragCoord.z;
  fragColor = vec4(weatherFilmic(weatherFloatLight(vWorld, normal, albedo, 0.35 + 0.65 * vWet, 1.0)), 1.0);
}
`;

/**
 * Soft streaky puffs of spray: the plumes torn off the tops of the nearest crowns, and the bursts
 * where something heavy hits the water. Each puff is a quad long along the wind, and its streaks,
 * from the weather's noise, are carried at the air's speed.
 */
const PUFF_VERTEX = /* glsl */ `#version 300 es
#define SHADER_NAME weather-puff-vs
precision highp float;
precision highp int;
precision highp sampler2D;

${WEATHER_SHARED_GLSL}
${WEATHER_VERTEX_GLSL}

uniform sampler2D weatherFrame;

out vec2 vUv;
out vec3 vWorld;
flat out vec3 vColor;
flat out float vAlpha;
flat out vec3 vAlong;
// What the quad is: 0 a plume's puff, 1 a streak of spindrift, 2 a ring on the water, 3 a piece of
// a burst.
flat out float vShape;
// A seed of its own for its texture, and for a ring how far out its crest is and how wide, as
// shares of the quad's half side.
flat out float vSeed;
flat out vec2 vRing;

// A quad around a point, long along a direction and facing the camera across it.
void weatherPlacePuff(vec3 center, vec3 along, float longSide, float width) {
  vec3 toEye = normalize(weatherView.eye - center);
  vec3 across = cross(along, toEye);
  float acrossLength = length(across);
  across = acrossLength > 1e-3 ? across / acrossLength : weatherView.up;
  vec3 alongFacing = normalize(cross(toEye, across));
  vWorld = center + alongFacing * vUv.x * longSide + across * vUv.y * width;
  vAlong = along;
  gl_Position = weatherToClip(vWorld);
}

// How a puff of spray is lit: the sky around it, and the key and the flash scattered on through,
// brighter by its gain where it is dense water.
vec3 weatherSprayLight(vec3 center, float gain) {
  vec3 toward = normalize(center - weatherView.eye);
  float along = max(dot(toward, -weather.keyTravel.xyz), 0.0);
  float scatter = 0.55 + 0.6 * along * along + 2.2 * pow(along, 16.0);
  vec3 light = weather.ambient.rgb * 1.05 + weather.keyLight.rgb * scatter * weatherSunAt(center) +
    weatherFlashShare(${formatFloat(AIR_TABLE.flashSpray)}, ${formatFloat(AIR_TABLE.flashRainMost * 1.5)});
  return weatherFilmic(light * gain);
}

void main() {
  weatherLoadView();
  gl_Position = WEATHER_CULLED;
  vUv = weatherCorner();
  vWorld = vec3(0.0);
  vColor = vec3(0.0);
  vAlpha = 0.0;
  vAlong = vec3(1.0, 0.0, 0.0);
  vShape = 0.0;
  vSeed = 0.0;
  vRing = vec2(0.0);
  int index = gl_InstanceID;
  vec2 wind = weather.gusts.xy;
  vec3 downwind = vec3(wind, 0.0);

  if (index < ${PLUME_PUFFS}) {
    int crown = index / ${PLUME_TABLE.puffs};
    int puff = index - crown * ${PLUME_TABLE.puffs};
    if (float(crown) >= weather.storm.w) return;
    vec4 top = texelFetch(weatherFrame, ivec2(crown, ${FRAME_ROW.plume}), 0);
    vec4 more = texelFetch(weatherFrame, ivec2(crown, ${FRAME_ROW.plumeMore}), 0);
    if (more.z > 0.5) {
      // Steam off a warm wet crown in the eye's sun: a wisp from somewhere on its top, going up, widening and
      // thinning out, then another from somewhere else. The shadows of the crowns cut it into shafts.
      vec3 pick = weatherHash(index, 99);
      float life = ${formatMix(STEAM_TABLE.life, 'pick.x')};
      float cycle = weather.clock.x / life + pick.y * 7.0;
      float age = fract(cycle);
      int turn = int(floor(cycle));
      vec3 seed = weatherHash(index + turn * 7919, 101);
      float radius = top.w;
      vec2 from = top.xy + (seed.xy - 0.5) * radius * 1.5;
      float seconds = age * life;
      vec3 center = vec3(
        from + weather.airVelocity.xy * 0.45 * seconds,
        top.z - 0.3 * radius + ${formatMix(STEAM_TABLE.rise, 'seed.z')} * seconds
      );
      float width = ${formatMix(STEAM_TABLE.width, 'sqrt(age)')} * clamp(radius / 3.0, 0.6, 1.3);
      vec3 up = normalize(vec3(weather.airVelocity.xy * 0.05, 1.0));
      weatherPlacePuff(center, up, width * ${formatFloat(STEAM_TABLE.stretch)}, width);
      vShape = 4.0;
      vSeed = seed.x * 9.0 + float(turn) * 0.37;
      float metres = length(center - weatherView.eye);
      vColor = weatherSprayLight(center, 0.92);
      vAlpha = more.x * ${formatFloat(STEAM_TABLE.alpha)} * smoothstep(0.0, 0.2, age) *
        (1.0 - smoothstep(0.42, 1.0, age)) * weatherFogVisibility(metres) *
        ${formatStep(STEAM_TABLE.fromLens, 'metres')};
      return;
    }
    float gust = ${formatStep(PLUME_TABLE.gusts, 'more.y')};
    float strength = more.x * weather.storm.y * mix(${formatFloat(PLUME_TABLE.lull)}, 1.0, gust);
    if (strength <= 0.002) return;
    vec3 pick = weatherHash(crown, 91);
    float time = weather.clock.x;
    float reach = ${formatMix(PLUME_TABLE.length, 'gust')} * mix(0.8, 1.2, pick.x);
    float s = (float(puff) + 0.5) / ${formatFloat(PLUME_TABLE.puffs)};
    float size = clamp(top.w / 3.0, 0.6, 1.4);
    // Off the top, downwind, lifting a little in the wake, then sinking, and wavering.
    vec3 side = vec3(-wind.y, wind.x, 0.0);
    float waver = sin(time * mix(1.3, 2.1, pick.y) + s * 3.0 + pick.z * 6.2831853);
    vec3 center = top.xyz + downwind * (s * reach) +
      vec3(0.0, 0.0, reach * (0.16 * s - 0.24 * s * s)) + side * waver * 0.18 * s * reach;
    float width = ${formatMix(PLUME_TABLE.width, 'sqrt(s)')} * size;
    weatherPlacePuff(center, downwind, width * ${formatFloat(PLUME_TABLE.stretch)}, width);
    float metres = length(center - weatherView.eye);
    vColor = weatherSprayLight(center, 1.0);
    vSeed = pick.x * 5.0;
    float shape = smoothstep(0.0, 0.18, s) * pow(1.0 - s, 0.8);
    vAlpha = (1.0 - exp(-strength * ${formatFloat(PLUME_TABLE.depth)} * shape)) *
      weatherFogVisibility(metres) * smoothstep(1.0, 3.0, metres);
    return;
  }

  if (index < ${PLUME_PUFFS + BURST_PUFFS}) {
    // A burst where something heavy hit the water: a crown of sheets thrown up at once all round
    // it, flaring out as they rise, slowed by the air, then breaking into spray and falling back.
    int burst = index - ${PLUME_PUFFS};
    int splash = burst / ${SPLASH_TABLE.puffs};
    if (float(splash) >= weather.timing.z) return;
    vec4 hit = texelFetch(weatherFrame, ivec2(splash, ${FRAME_ROW.splash}), 0);
    float size = texelFetch(weatherFrame, ivec2(splash, ${FRAME_ROW.splashMore}), 0).x;
    float age = hit.w;
    if (age <= 0.0 || age >= ${formatFloat(SPLASH_TABLE.burstSeconds)}) return;
    vec3 pick = weatherHash(burst, 92);
    vec3 more = weatherHash(burst, 93);
    float angle = pick.x * 6.2831853;
    vec2 outward = vec2(cos(angle), sin(angle));
    // Up the sheet, 0 at the water to 1 at its top, and how high this part of the crown goes.
    float up = pick.y;
    float top = size * mix(0.5, 1.0, pick.z * pick.z) * (0.75 + 0.25 * cos(angle * 3.0 + more.z * 6.0));
    float risen = 1.0 - exp(-age / ${formatFloat(SPLASH_TABLE.burstRise)});
    float fallen = smoothstep(${formatFloat(SPLASH_TABLE.burstRise * 2.0)}, ${formatFloat(SPLASH_TABLE.burstFall + SPLASH_TABLE.burstRise * 2.0)}, age);
    float height = top * up * risen * (1.0 - 0.85 * fallen * fallen);
    float flared = size * (0.22 + 0.3 * risen + 0.35 * up * risen + 0.4 * fallen) * mix(0.75, 1.15, more.x);
    vec3 center = hit.xyz + vec3(outward * flared, height) +
      vec3(weather.airVelocity.xy * 0.04 * age, 0.0);
    float width = size * mix(0.12, 0.26, more.y) * (0.55 + 0.6 * risen + 0.5 * fallen);
    // Each piece is long up its sheet, and the sheet leans out from the middle.
    weatherPlacePuff(center, normalize(vec3(outward * (0.35 + 0.5 * up), 1.0)), width * 1.7, width);
    vShape = 3.0;
    vSeed = more.z * 7.0 + age * 0.6;
    float metres = length(center - weatherView.eye);
    vColor = weatherSprayLight(center, 1.15);
    float shape = smoothstep(0.0, 0.02, age) * (1.0 - smoothstep(0.35, 1.0, age / ${formatFloat(SPLASH_TABLE.burstSeconds)}));
    vAlpha = 0.9 * shape * (1.0 - 0.45 * up * fallen) * weatherFogVisibility(metres) *
      smoothstep(0.6, 1.6, metres);
    return;
  }

  if (index < ${PLUME_PUFFS + BURST_PUFFS + SPLASH_RINGS}) {
    // A ring spreading on the water from where it hit, one after another, wider and fainter.
    int ring = index - ${PLUME_PUFFS + BURST_PUFFS};
    int splash = ring / ${SPLASH_TABLE.rings};
    int which = ring - splash * ${SPLASH_TABLE.rings};
    if (float(splash) >= weather.timing.z) return;
    vec4 hit = texelFetch(weatherFrame, ivec2(splash, ${FRAME_ROW.splash}), 0);
    float size = texelFetch(weatherFrame, ivec2(splash, ${FRAME_ROW.splashMore}), 0).x;
    float age = hit.w - 0.1 * float(which);
    if (age <= 0.0 || age >= ${formatFloat(SPLASH_TABLE.ringSeconds)}) return;
    float speed = which == 0 ? ${formatFloat(SPLASH_TABLE.ringSpeed[0])} :
      which == 1 ? ${formatFloat(SPLASH_TABLE.ringSpeed[1])} : ${formatFloat(SPLASH_TABLE.ringSpeed[2])};
    float along = age / ${formatFloat(SPLASH_TABLE.ringSeconds)};
    float radius = size * 0.3 + speed * age;
    float width = ${formatMix(SPLASH_TABLE.ringWidth, 'along')} * (0.6 + 0.4 * size / 3.0);
    float side = radius + width * 3.0;
    vWorld = vec3(hit.xy + vUv * side, weather.flood.x + 0.008);
    gl_Position = weatherToClip(vWorld);
    vShape = 2.0;
    vRing = vec2(radius / side, width / side);
    float metres = length(hit.xyz - weatherView.eye);
    // Its crest catches the sky.
    vColor = weatherFilmic(weather.horizon.rgb * 0.95 + weather.ambient.rgb * 0.25 +
      weather.flashLight.rgb * 0.3);
    vAlpha = 0.6 * (1.0 - smoothstep(0.2, 1.0, along)) * mix(1.0, 0.6, float(which) * 0.5) *
      weatherFogVisibility(metres);
    return;
  }

  // Spindrift: a streak of spray low over the water or the beds, carried along by the wind. Each
  // lasts a little while, then forms again somewhere else.
  float spray = weather.storm.y;
  if (spray <= 0.0) return;
  int streak = index - ${PLUME_PUFFS + BURST_PUFFS + SPLASH_RINGS};
  vec3 pick = weatherHash(streak, 95);
  vec3 form = weatherHash(streak, 96);
  float life = ${formatMix(SPINDRIFT_TABLE.life, 'form.x')};
  float cycle = weather.clock.x / life + pick.z * 17.0;
  float age = fract(cycle);
  int turn = int(floor(cycle));
  vec3 seed = weatherHash(streak + turn * 7919, 97);
  vec3 look = weatherHash(streak + turn * 7919, 98);
  vec2 forward = normalize(weatherView.forward.xy + vec2(1e-5, 0.0));
  const float across = ${formatFloat(SPINDRIFT_TABLE.across)};
  vec2 origin = weatherView.eye.xy + forward * ${formatFloat(SPINDRIFT_TABLE.ahead)} - across * 0.5;
  vec2 inBox = mod(seed.xy * across + weather.airDrift.xy * ${formatFloat(SPRAY_TABLE.carried)} - origin, vec2(across));
  vec2 place = origin + inBox;
  float ground = weatherGround(place);
  float height = ${formatMix(SPINDRIFT_TABLE.height, 'seed.z * seed.z')};
  vec3 center = vec3(place, ground + height);
  float metres = length(center - weatherView.eye);
  if (dot(center - weatherView.eye, weatherView.forward) < weather.lens.z * 2.0) return;
  float length0 = ${formatMix(SPINDRIFT_TABLE.length, 'look.x')};
  float thick = ${formatMix(SPINDRIFT_TABLE.thick, 'look.y * look.y')} * (0.6 + 0.8 * height);
  weatherPlacePuff(center, downwind, length0 * 0.5, thick * 0.5);
  vShape = 1.0;
  vSeed = look.z * 11.0;
  vColor = weatherSprayLight(center, 1.0);
  vec2 edge = min(inBox, vec2(across) - inBox) / (across * 0.12);
  float boxed = smoothstep(0.0, 1.0, min(edge.x, edge.y));
  float lived = smoothstep(0.0, 0.25, age) * (1.0 - smoothstep(0.55, 1.0, age));
  float near = ${formatStep(SPINDRIFT_TABLE.lensFade, 'metres')} *
    (1.0 - ${formatStep(SPINDRIFT_TABLE.reach, 'metres')});
  // Torn up hardest where a gust front is, lowest the thickest.
  float torn = spray * weatherGustPulse(place) * mix(1.0, 0.55, smoothstep(0.2, 1.0, height));
  vAlpha = ${formatFloat(SPINDRIFT_TABLE.alpha)} * torn * lived * near * boxed * weatherFogVisibility(metres);
}
`;

const PUFF_FRAGMENT = /* glsl */ `#version 300 es
#define SHADER_NAME weather-puff-fs
precision highp float;
precision highp int;
precision highp sampler3D;

uniform sampler3D weatherNoise;

${WEATHER_SHARED_GLSL}

in vec2 vUv;
in vec3 vWorld;
flat in vec3 vColor;
flat in float vAlpha;
flat in vec3 vAlong;
flat in float vShape;
flat in float vSeed;
flat in vec2 vRing;
out vec4 fragColor;

float weatherPuffNoise(vec3 place) {
  return texture(weatherNoise, place).r * 0.6 + texture(weatherNoise, place * 2.7 + 0.31).r * 0.4;
}

void main() {
  if (!(vAlpha > 0.0)) discard;
  vec3 moved = vWorld - vec3(weather.airDrift.xy * ${formatFloat(SPRAY_TABLE.carried)}, 0.0);
  vec2 side = vec2(-vAlong.y, vAlong.x);

  if (vShape > 3.5) {
    // A wisp of steam: soft, thinning out to its edge, with finer wisps in it that go up.
    float reach = dot(vUv, vUv);
    if (reach >= 1.0) discard;
    float body = exp(-reach * 2.4) - exp(-2.4);
    vec3 place = vec3(
      (vWorld.x + vWorld.y * 0.7) / 0.8,
      vWorld.z / 1.9 - weather.clock.x * 0.32,
      vSeed
    );
    float wisps = weatherPuffNoise(place);
    float alpha = min(vAlpha * body * smoothstep(0.3, 0.72, wisps) * 1.9, 0.6);
    if (!(alpha > 0.002)) discard;
    fragColor = vec4(vColor * alpha, alpha);
    return;
  }

  if (vShape > 2.5) {
    // A piece of a burst: sheets of water torn into clumps of drops, crisp, and white where thick.
    float reach = dot(vUv, vUv);
    if (reach >= 1.0) discard;
    float body = exp(-reach * 2.2) - exp(-2.2);
    float clumps = weatherPuffNoise(vWorld / 0.55 + vec3(0.0, 0.0, vSeed));
    float drops = texture(weatherNoise, vWorld / 0.16 + vec3(vSeed, 0.0, 0.0)).r;
    float alpha = vAlpha * body * smoothstep(0.34, 0.62, clumps) * mix(0.55, 1.25, drops) * 1.7;
    alpha = min(alpha, 0.96);
    fragColor = vec4(vColor * alpha, alpha);
    return;
  }

  if (vShape > 1.5) {
    // A ring on the water: a bright crest that catches the sky, the dark trough inside it, broken a
    // little round its way, and only where there is water.
    if (fieldLandHeight(vWorld.xy) > weather.flood.x - 0.004) discard;
    float r = length(vUv);
    float d = (r - vRing.x) / max(vRing.y, 1e-3);
    float crest = exp(-d * d * 2.4);
    float trough = exp(-(d + 1.7) * (d + 1.7) * 1.8);
    float broken = 0.65 + 0.35 * texture(weatherNoise, vec3(vUv * 2.5, vSeed + r)).r;
    float light = vAlpha * crest * broken;
    float dark = vAlpha * trough * 0.55 * broken;
    fragColor = vec4(vColor * light, min(light + dark, 1.0));
    return;
  }

  if (vShape > 0.5) {
    // A streak of spindrift: soft across, tapering along, with finer streaks in it along the wind,
    // carried as the air is.
    float body = exp(-vUv.y * vUv.y * 3.2) * (1.0 - smoothstep(0.4, 1.0, abs(vUv.x)));
    vec3 place = vec3(
      dot(moved.xy, vAlong.xy) / 7.0,
      moved.z / 0.28,
      dot(moved.xy, side) / 1.2 + vSeed
    );
    float fine = weatherPuffNoise(place);
    float alpha = min(vAlpha * body * smoothstep(0.3, 0.68, fine) * 1.6, 0.9);
    // Nothing that is not a number gets into the frame.
    if (!(alpha > 0.002)) discard;
    fragColor = vec4(vColor * alpha, alpha);
    return;
  }

  float reach = dot(vUv, vUv);
  if (reach >= 1.0) discard;
  float body = exp(-reach * 2.6) - exp(-2.6);
  // Streaks along the wind, carried at the air's speed.
  vec3 place = vec3(dot(moved.xy, side) / 1.6, dot(moved.xy, vAlong.xy) / 9.0, moved.z / 2.0 + weather.clock.x * 0.3 + vSeed);
  float streaks = weatherPuffNoise(place);
  float alpha = min(vAlpha * body * smoothstep(0.3, 0.75, streaks) * 1.6, 0.95);
  fragColor = vec4(vColor * alpha, alpha);
}
`;

function getMoteOctavesGlsl(): string {
  const boxes = MOTE_OCTAVES.map(octave => formatFloat(octave.box)).join(', ');
  const radii = MOTE_OCTAVES.map(octave => formatFloat(octave.radius)).join(', ');
  const drifts = MOTE_OCTAVES.map(octave => formatFloat(octave.drift)).join(', ');
  const count = MOTE_OCTAVES.length;
  return `const float WEATHER_MOTE_BOX[${count}] = float[${count}](${boxes});
const float WEATHER_MOTE_RADIUS[${count}] = float[${count}](${radii});
const float WEATHER_MOTE_DRIFT[${count}] = float[${count}](${drifts});`;
}

const POINT_VERTEX = /* glsl */ `#version 300 es
#define SHADER_NAME weather-point-vs
precision highp float;
precision highp int;
precision highp sampler2D;

${WEATHER_SHARED_GLSL}
${WEATHER_VERTEX_GLSL}
${getMoteOctavesGlsl()}

uniform sampler2D weatherTables;

out vec2 vUv;
out vec3 vColor;
out float vAlpha;
// A sparkle has a faint halo.
flat out float vHalo;
// How far the point is drawn out each way along its way across the frame, in units of its quad's radius.
flat out float vSpan;

// Places a point as a quad facing the camera, of this radius in pixels, drawn out along the way it crosses the
// frame over its share of the shutter: its own motion in metres per cycle second, and the camera's, so a
// sub-frame's point joins the next one's rather than leaving a trail of dots. Returns how much of its light is
// left at any one place, as being drawn out spreads it.
float weatherPlacePoint(vec3 center, vec3 velocity, float radius) {
  vec4 clip = weatherToClip(center);
  vec3 apparent = velocity - weather.cameraMotion.xyz -
    cross(weather.cameraSpin.xyz, center - weatherView.eye);
  vec3 halfStep = apparent * ${formatFloat(POINT_SHUTTER * 0.5)};
  vec4 fromClip = weatherToClip(center - halfStep);
  vec4 toClip = weatherToClip(center + halfStep);
  vec2 pixels = project.viewportSize * 0.5;
  vec2 along = vec2(0.0);
  if (fromClip.w > 1e-4 && toClip.w > 1e-4) {
    along = (toClip.xy / toClip.w - fromClip.xy / fromClip.w) * pixels;
  }
  float streak = length(along);
  vec2 axis = streak > 1e-3 ? along / streak : vec2(1.0, 0.0);
  vec2 side = vec2(-axis.y, axis.x);
  float halfLength = min(streak * 0.5, radius * 40.0);
  vec2 offset = axis * vUv.x * (halfLength + radius) + side * vUv.y * radius;
  clip.xy += offset / pixels * clip.w;
  gl_Position = clip;
  vSpan = halfLength / max(radius, 1e-3);
  return 1.0 / (1.0 + halfLength / max(radius * 0.45, 1e-3));
}

// A row of the tables, along it, 0-1.
vec3 weatherTableAt(int row, float along) {
  float place = clamp(along, 0.0, 1.0) * ${formatFloat(WEATHER_TABLE_TEXELS - 1)};
  int low = int(floor(place));
  vec3 from = texelFetch(weatherTables, ivec2(low, row), 0).xyz;
  vec3 to = texelFetch(weatherTables, ivec2(min(low + 1, ${WEATHER_TABLE_TEXELS - 1}), row), 0).xyz;
  return mix(from, to, fract(place));
}

void weatherMote(int index) {
  int octave = index / ${MOTE_TABLE.count};
  float side = WEATHER_MOTE_BOX[octave];
  // Cross-faded by the camera's distance, so that one octave takes over from another out of sight.
  float apart = abs(log2(weather.clock.w / (2.0 * side)));
  float weight = 1.0 - smoothstep(1.1, 2.9, apart);
  float shaft = weather.ring.y;
  // Rain and a hard wind clear the air of dust.
  float cleared = (1.0 - ${formatStep(MOTE_TABLE.clearedBy, 'weather.clock.y')}) *
    (1.0 - smoothstep(0.0, 0.15, weather.amounts.x));
  float amount = max(weather.amounts.z * cleared, shaft * 0.7);
  vec3 trait = weatherHash(index, 31);
  if (weight <= 0.0 || trait.x > amount) return;

  vec3 place = weatherHash(index, 32);
  vec3 phase = weatherHash(index, 33) * 6.2831853;
  vec3 box = vec3(side);
  vec3 origin = weatherView.eye + weatherView.forward * (side * 0.34) - box * 0.5;
  float time = weather.clock.x;
  // It wanders slowly on the air around it, at a scale of its box.
  vec3 wander = vec3(
    sin(time * 0.31 + phase.x) + sin(time * 0.13 + phase.y),
    sin(time * 0.27 + phase.y) + sin(time * 0.11 + phase.z),
    sin(time * 0.23 + phase.z) * 0.6 + 0.3
  ) * side * 0.022;
  vec3 drift = weather.airDrift.xyz * WEATHER_MOTE_DRIFT[octave];
  vec3 inBox = mod(place * box + drift - origin, box);
  vec3 center = origin + inBox + wander;
  if (center.z < weatherGround(center.xy)) return;

  vec3 fromEye = center - weatherView.eye;
  float depth = dot(fromEye, weatherView.forward);
  if (depth < weather.lens.z * 2.0) return;
  float metres = length(fromEye);
  vec3 toward = fromEye / metres;

  float radius = WEATHER_MOTE_RADIUS[octave] * mix(0.6, 2.0, trait.y * trait.y);
  float sharp = radius * weatherView.focal / depth;
  float blur = weatherBlurPixels(depth) * ${formatFloat(MOTE_TABLE.blurShare)};
  float drawn = max(max(sharp, 0.8 * weatherPixelScale()), blur);
  // It goes with the air, on the scene clock.
  vec3 velocity = weather.airVelocity.xyz * WEATHER_MOTE_DRIFT[octave] * weather.timing.y;
  float drawnOut = weatherPlacePoint(center, velocity, drawn * 2.2);

  // It shines when it scatters the sun on toward the camera, and a turning flake comes and goes.
  // The dust in the shaft of light is lit as it is by nothing else.
  float along = max(dot(toward, -weather.keyTravel.xyz), 0.0);
  float scatter = 0.1 + 0.55 * along * along + 0.35 * pow(along, 14.0);
  float inShaft = weatherShaftBody(center) * shaft;
  scatter *= 1.0 + ${formatFloat(SHAFT_TABLE.dustGain)} * inShaft;
  vColor = weatherFilmic(weather.keyLight.rgb * 1.5 + weather.ambient.rgb * 0.1);
  float twinkle = 0.5 + 0.5 * sin(time * mix(0.7, 2.6, trait.z) + phase.x);
  // Of a blurred or small mote's light, a good deal is lost to the wider spot.
  float spread = pow(min(sharp / drawn, 1.0), 0.4);
  float tooWide = 1.0 - ${formatStep(MOTE_TABLE.mostBlur, 'blur / weatherPixelScale()')};
  // In shade, it still has the sky to catch.
  float lit = 0.22 + 0.78 * weatherSunAt(center);
  vAlpha = ${formatFloat(MOTE_TABLE.gain)} * weight * scatter * twinkle * spread * tooWide * lit * drawnOut *
    weatherEdgeFade(inBox, box, false) * weatherFogVisibility(metres);
}

// A sparkle at a point, moving at this velocity in metres per cycle second.
void weatherSparkleLight(vec3 center, vec3 velocity, float strength, float sharpRadius) {
  vec3 fromEye = center - weatherView.eye;
  float depth = dot(fromEye, weatherView.forward);
  if (depth < weather.lens.z * 2.0) return;
  float metres = length(fromEye);
  float sharp = sharpRadius * weatherView.focal / depth;
  float blur = weatherBlurPixels(depth) * ${formatFloat(SPARKLE_TABLE.blurShare)};
  float least = ${formatFloat(SPARKLE_TABLE.leastSpread)} * weatherPixelScale();
  float drawn = max(max(sharp, least), blur);
  float spread = weatherPlacePoint(center, velocity, drawn * 4.6);
  vColor = weatherFilmic(${formatTriple(SPARKLE_TABLE.color)});
  vAlpha = strength * spread * weatherFogVisibility(metres) * pow(min(sharp / drawn, 1.0), 0.3);
  vHalo = 1.0;
}

// The sparkles' events are keyed on cycle seconds, as the ring and the seed are: the time rate is 1
// there, so they move as the scene clock does.
void weatherRingSparkle(int index) {
  float sparkle = weather.moreAmounts.x;
  if (sparkle <= 0.0) return;
  vec3 place = weatherHash(index, 41);
  if (weather.ring.x <= place.x * ${formatFloat(SPARKLE_TABLE.ring.reach)}) return;
  float reach = place.x * ${formatFloat(SPARKLE_TABLE.ring.reach)};
  vec3 trait = weatherHash(index, 42);
  float time = weather.timing.x;
  // Its age is since the ring reached it, which is not how far it has gone since: that speeds up.
  float age = time - weatherTableAt(${WEATHER_TABLE_RING_ROW}, place.x).x;
  float life = ${formatMix(SPARKLE_TABLE.ring.life, 'trait.x')};
  if (age <= 0.0 || age >= life) return;
  float angle = place.y * 6.2831853;
  float low = ${formatMix(SPARKLE_RING_HEIGHTS, 'place.z * place.z')};
  float rise = ${formatMix(SPARKLE_TABLE.ring.rise, 'trait.y')};
  vec3 center = vec3(
    reach * cos(angle) + 0.25 * sin(time * 0.9 + trait.z * 40.0),
    reach * sin(angle) + 0.25 * cos(time * 0.8 + trait.y * 40.0),
    low + rise * age
  );
  float shape = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(life * 0.4, life, age));
  float twinkle = 0.62 + 0.38 * sin(time * mix(2.0, 5.0, trait.z) + trait.x * 40.0);
  // Most are fine, and a few a little larger, so that they have depth among them.
  float size = mix(0.0035, 0.016, pow(trait.y, 5.0));
  vec3 velocity = vec3(
    0.225 * cos(time * 0.9 + trait.z * 40.0),
    -0.2 * sin(time * 0.8 + trait.y * 40.0),
    rise
  );
  weatherSparkleLight(center, velocity, sparkle * shape * twinkle, size);
}

void weatherSeedSparkle(int index) {
  float sparkle = weather.moreAmounts.x;
  float time = weather.timing.x;
  float lift = ${formatFloat(SEED_TABLE.lift)};
  float land = ${formatFloat(SEED_TABLE.land)};
  if (sparkle <= 0.0 || time < lift || time > land + 1.5) return;
  vec3 place = weatherHash(index, 51);
  vec3 trait = weatherHash(index, 52);
  float born = lift + place.x * (land - lift);
  float age = time - born;
  float life = ${formatMix(SPARKLE_TABLE.seed.life, 'trait.x')};
  if (age <= 0.0 || age >= life) return;
  vec3 off = (weatherHash(index, 53) - 0.5) * 2.0;
  off *= ${formatFloat(SPARKLE_TABLE.seed.scatter)} * pow(place.y, 1.5);
  float rise = ${formatMix(SPARKLE_TABLE.seed.rise, 'trait.y')};
  vec3 center = weatherTableAt(${WEATHER_TABLE_SEED_ROW}, place.x) + off + vec3(
    0.006 * sin(age * 3.0 + trait.z * 30.0),
    0.006 * cos(age * 2.6 + trait.x * 30.0),
    rise * age
  );
  float shape = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(life * 0.35, life, age));
  float twinkle = 0.65 + 0.35 * sin(time * mix(4.0, 9.0, trait.z) + trait.x * 40.0);
  float size = mix(0.00022, 0.00045, trait.z);
  weatherSparkleLight(center, vec3(0.0, 0.0, rise), min(sparkle * 2.2, 0.6) * shape * twinkle, size);
}

void main() {
  weatherLoadView();
  gl_Position = WEATHER_CULLED;
  vUv = weatherCorner();
  vColor = vec3(0.0);
  vAlpha = 0.0;
  vHalo = 0.0;
  vSpan = 0.0;
  int index = gl_InstanceID;
  if (index < ${MOTES}) {
    weatherMote(index);
  } else if (index < ${MOTES + SPARKLE_TABLE.ring.count}) {
    weatherRingSparkle(index);
  } else {
    weatherSeedSparkle(index);
  }
}
`;

const POINT_FRAGMENT = /* glsl */ `#version 300 es
#define SHADER_NAME weather-point-fs
precision highp float;

in vec2 vUv;
in vec3 vColor;
in float vAlpha;
flat in float vHalo;
flat in float vSpan;
out vec4 fragColor;

void main() {
  // How far from the line it is drawn out along, in units of the quad's radius.
  float along = max(abs(vUv.x) * (vSpan + 1.0) - vSpan, 0.0);
  float reach = along * along + vUv.y * vUv.y;
  if (reach >= 1.0) discard;
  float shape = exp(-reach * 7.0) - exp(-7.0);
  float cover = 0.0;
  if (vHalo > 0.5) {
    // The core is a soft point, and around it a faint wide glow of the same light.
    float core = exp(-reach * 10.5);
    shape = core + 0.1 * (exp(-reach * 3.0) - exp(-3.0));
    cover = core * vAlpha * ${formatFloat(SPARKLE_TABLE.cover)};
  }
  float light = vAlpha * shape;
  // Added, so it shows against dark, and hardly at all against a bright sky. A sparkle's core also
  // covers what is behind it a little, so that a bright sky does not turn it white.
  fragColor = vec4(vColor * light, cover);
}
`;

/** A slice's place and everything its fragments need to find a point of the field. */
const SLICE_VERTEX_GLSL = /* glsl */ `
out vec3 vRay;
out vec3 vEye;
out vec3 vShadowPlace;
flat out float vDepth;
flat out float vThickness;
flat out float vGroundFade;

// A slice across the view, as deep as asked along it, standing for this much of the depth around
// it. What lies past the far plane is drawn inside it. The ground out there is reckoned, not depth
// tested. A slice holds still, so that what it shows does not boil from frame to frame.
void weatherPlaceSlice(vec2 corner, float depth, float thickness) {
  float drawn = min(depth, weather.lens.w * ${formatFloat(AIR_TABLE.farShare)});
  vec4 clip = weatherToClip(weatherView.eye + weatherView.forward * drawn);
  gl_Position = vec4(corner * clip.w, clip.z, clip.w);

  vec2 tangents = project.viewportSize * 0.5 / weatherView.focal;
  vRay = weatherView.forward + weatherView.right * corner.x * tangents.x +
    weatherView.up * corner.y * tangents.y;
  vEye = weatherView.eye;
  vDepth = depth;
  vThickness = thickness;
  // Where a slice meets the ground it would end in a line. If it thins out by this height instead,
  // it comes down to nothing just where the slice beyond it ends, and together they make a slope.
  float eyeHeight = max(weatherView.eye.z - weatherGround(weatherView.eye.xy), 0.05);
  vGroundFade = max(eyeHeight * thickness / (depth + thickness), 1e-3);

  vShadowPlace = vec3(-1.0);
#ifdef MODULE_SHADOW
  if (depth <= weather.lens.w && weather.keyLight.a > 0.0) {
    vec4 position = project_common_position_to_clipspace(
      vec4(vEye + vRay * depth - project.coordinateOrigin, 1.0),
      shadow.viewProjectionMatrix0,
      shadow.projectCenter0
    );
    vShadowPlace = (position.xyz / position.w + 1.0) * 0.5;
  }
#endif
}
`;

/** What the fragments of a slice share. */
const SLICE_FRAGMENT_GLSL = /* glsl */ `
uniform sampler3D weatherNoise;
#ifdef MODULE_SHADOW
uniform sampler2D weatherShadowMap;
const vec4 WEATHER_SHADOW_UNPACK = vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0);
#endif

in vec3 vRay;
in vec3 vEye;
in vec3 vShadowPlace;
flat in float vDepth;
flat in float vThickness;
flat in float vGroundFade;

float weatherNoise3(vec3 place) {
  return texture(weatherNoise, place).r;
}

// Interleaved gradient noise, 0-1, for a pixel, new with each sub-frame and each slice.
float weatherPixelNoise(vec2 pixel) {
  vec2 moved = pixel + 47.0 * weather.clock.z + 13.0 * fract(vDepth * 0.37);
  return fract(52.9829189 * fract(dot(moved, vec2(0.06711056, 0.00583715))));
}

// Noise to hide the steps of 8 bits, which many faint layers would otherwise build up into bands.
float weatherDither() {
  return weatherPixelNoise(gl_FragCoord.xy) + weatherPixelNoise(gl_FragCoord.yx + 17.0) - 1.0;
}

// How much of the sun reaches this point of the slice, with the map's texels broken up a little, as
// many slices and sub-frames then average them away.
float weatherAirSun() {
#ifdef MODULE_SHADOW
  vec3 place = vShadowPlace;
  if (place.x <= 0.0 || place.y <= 0.0 || place.x >= 1.0 || place.y >= 1.0) return 1.0;
  ivec2 size = textureSize(weatherShadowMap, 0);
  vec2 jitter = vec2(
    weatherPixelNoise(gl_FragCoord.xy + 5.0),
    weatherPixelNoise(gl_FragCoord.yx + 29.0)
  );
  vec2 texel = place.xy * vec2(size) + 3.0 * (jitter - 0.5);
  ivec2 at = clamp(ivec2(texel), ivec2(0), size - 1);
  float depth = dot(texelFetch(weatherShadowMap, at, 0), WEATHER_SHADOW_UNPACK);
  return mix(1.0, place.z <= depth ? 1.0 : 0.0, weather.keyLight.a);
#else
  return 1.0;
#endif
}
`;

const AIR_VERTEX = /* glsl */ `#version 300 es
#define SHADER_NAME weather-air-vs
precision highp float;
precision highp int;
precision highp sampler2D;

${WEATHER_SHARED_GLSL}
${WEATHER_VERTEX_GLSL}
${SLICE_VERTEX_GLSL}

flat out float vPixelMetres;
// The rain's own light, with what it gives back of a lightning flash, which lights the whole of
// the rain at once, through the curve together, so a flash whitens it and never clips.
flat out vec3 vRainColor;

void main() {
  weatherLoadView();
  // Far to near.
  float first = max(
    min(
      weather.clock.w * ${formatFloat(AIR_TABLE.firstShare)},
      ${formatFloat(AIR_TABLE.firstMost)}
    ),
    weather.lens.z * 2.0
  );
  float ratio = pow(
    ${formatFloat(AIR_TABLE.last)} / first,
    1.0 / ${formatFloat(AIR_TABLE.slices - 1)}
  );
  float slice = float(${AIR_TABLE.slices - 1} - gl_InstanceID);
  float depth = first * pow(ratio, slice);
  weatherPlaceSlice(weatherCorner(), depth, depth * (ratio - 1.0));
  vPixelMetres = depth / weatherView.focal;

  // A flash's light on the rain, with a shoulder, so at its peak the volume goes blue-white and stays short of
  // white, and the far rows behind it keep their shape.
  vec3 flash = weather.flashLight.rgb * ${formatFloat(AIR_TABLE.flashRain)};
  flash /= 1.0 + max(max(flash.r, flash.g), flash.b) / ${formatFloat(AIR_TABLE.flashRainMost)};
  vec3 rainLight = weather.ambient.rgb * 0.98 + flash;
  float lit = ${formatMix(AIR_TABLE.rainLit, formatStep(AIR_TABLE.rainDepthAt, 'depth'))};
  vRainColor = mix(weatherFilmic(weather.horizon.rgb + flash * 0.6), weatherFilmic(rainLight), lit);
}
`;

const AIR_FRAGMENT = /* glsl */ `#version 300 es
#define SHADER_NAME weather-air-fs
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;

${WEATHER_SHARED_GLSL}
${SLICE_FRAGMENT_GLSL}
${WEATHER_CURTAIN_GLSL}

flat in float vPixelMetres;
flat in vec3 vRainColor;
out vec4 fragColor;

// How much rain is in the air at a point, 0 and up: its curtains, packed by the gusts, and within
// them fine fibres, drawn out along the fall, each a few pixels across at any distance.
float weatherRainAt(vec3 point) {
  vec3 fall = weather.rainVelocity.xyz / max(weather.rainVelocity.w, 1e-3);
  float sheets = weatherCurtainAt(
    weatherNoise,
    point,
    weather.rainAcross.xyz,
    weather.airDrift.xy * ${formatFloat(CURTAIN_TABLE.carried)},
    weather.storm.x,
    weather.gusts.z,
    1.0
  );
  float across = dot(point, weather.rainAcross.xyz);
  float above = dot(point, weather.rainAbove.xyz);
  float along = dot(point, fall);
  float tile = vPixelMetres * 44.0;
  float fibres = weatherNoise3(vec3(
    across / tile,
    above / tile,
    (along - weather.rainDrift.w) / (tile * 40.0)
  ));
  return sheets * ${formatMix(CURTAIN_TABLE.fibres, 'smoothstep(0.3, 0.7, fibres)')};
}

// How much mist is at a point this high over the ground, 0 and up: low sheets, or wisps of steam
// going up from wet ground and water.
float weatherMistAt(vec3 point, float height, float metres) {
  float steam = weather.moreAmounts.z;
  float layerHeight = ${formatMix([AIR_TABLE.mistHeight, AIR_TABLE.steamHeight], 'steam')};
  // It meets the ground softly, as a slice of it ends there in a line.
  float settled = smoothstep(0.0, max(0.03, metres * 0.007), height);
  float layer = exp(-height / layerHeight) * settled;
  if (layer < 0.002) return 0.0;
  // Each of them keeps to its own field, so that neither slides as one turns into the other.
  vec3 moved = point - vec3(weather.airDrift.xy * 0.14, 0.0);
  float patches = 0.0;
  if (steam < 1.0) {
    float broad = weatherNoise3(moved / vec3(170.0, 170.0, 26.0));
    float wisps = weatherNoise3(moved / vec3(44.0, 44.0, 9.0) + 0.37);
    patches += (1.0 - steam) * smoothstep(0.34, 0.72, broad * 0.56 + wisps * 0.44);
  }
  if (steam > 0.0) {
    vec3 risen = moved - vec3(0.0, 0.0, weather.clock.x * ${formatFloat(AIR_TABLE.steamRise)});
    float broad = weatherNoise3(risen / vec3(90.0, 90.0, 46.0));
    float wisps = weatherNoise3(risen / vec3(11.0, 11.0, 26.0) + 0.37);
    // Its wisps are tens of metres across: close by the lens one would smear across the frame, so they come in
    // farther off.
    patches += steam * ${formatFloat(AIR_TABLE.steamShare)} *
      ${formatStep(AIR_TABLE.steamWisps, 'broad * 0.5 + wisps * 0.5')} *
      ${formatStep(AIR_TABLE.steamFromLens, 'metres')} * (1.0 - ${formatStep(AIR_TABLE.steamTop, 'height')});
  }
  return layer * patches;
}

// How much spindrift is at a point this high over the water or the wet ground: streaks six times
// as long as they are wide, carried along the wind, lifting with the gust fronts as they cross.
float weatherSprayAt(vec3 point, float height) {
  if (height > ${formatFloat(SPRAY_TABLE.depth * 1.25)}) return 0.0;
  vec2 wind = weather.gusts.xy;
  vec2 side = vec2(-wind.y, wind.x);
  vec2 moved = point.xy - weather.airDrift.xy * ${formatFloat(SPRAY_TABLE.carried)};
  vec3 place = vec3(
    dot(moved, side) / ${formatFloat(SPRAY_TABLE.across)},
    dot(moved, wind) / ${formatFloat(SPRAY_TABLE.along)},
    height / ${formatFloat(SPRAY_TABLE.up)} + weather.clock.x * ${formatFloat(SPRAY_TABLE.churn)}
  );
  float streaks = weatherNoise3(place);
  float fine = weatherNoise3(place * vec3(2.9, 2.3, 1.7) + 0.37);
  float body = ${formatStep(SPRAY_TABLE.streaks, 'streaks * 0.62 + fine * 0.38')};
  if (body <= 0.0) return 0.0;
  float profile = exp(-height / ${formatFloat(SPRAY_TABLE.falloff)}) *
    (1.0 - smoothstep(${formatFloat(SPRAY_TABLE.depth * 0.55)}, ${formatFloat(SPRAY_TABLE.depth * 1.25)}, height));
  return body * profile * weatherGustPulse(point.xy);
}

void main() {
  vec3 point = vEye + vRay * vDepth;
  // Past the ground, or under the water, it is the ground. Only past the far plane does depth
  // testing not say so.
  float ground = weatherGround(point.xy);
  if (point.z <= ground) discard;
  float height = point.z - ground;
  float rayLength = length(vRay);
  float metres = rayLength * vDepth;
  // How much of the stretch this slice stands for is above the ground: where the ray meets the
  // ground within it, as near its far end as the land under each end says, so a slice comes down
  // to nothing just where the ray meets a bank or the water, and leaves no line or wedge there.
  float aboveGround = 1.0;
  if (height < vGroundFade * 2.0) {
    vec3 beyond = vEye + vRay * (vDepth + vThickness);
    float heightBeyond = beyond.z - weatherGround(beyond.xy);
    aboveGround = heightBeyond >= 0.0 ? 1.0 : height / max(height - heightBeyond, 1e-4);
    aboveGround = smoothstep(0.0, 1.0, aboveGround);
  }
  vec3 light = vec3(0.0);
  float alpha = 0.0;
  vec3 toward = vRay / rayLength;

  float rain = weather.amounts.x;
  if (rain > 0.0) {
    float thick = ${formatMix(AIR_TABLE.rainDepth, formatStep(AIR_TABLE.rainDepthAt, 'vDepth'))};
    // Light rain is far clearer than its share of a storm's: what it hides goes up faster than it.
    float optical = pow(rain, ${formatFloat(AIR_TABLE.rainVeilPower)}) * thick * vThickness * aboveGround *
      weatherRainAt(point);
    float share = 1.0 - exp(-optical);
    light += vRainColor * share;
    alpha += share;
  }

  float spray = weather.storm.y;
  // Near by, the spindrift is streaks of its own.
  float sprayHere = spray * ${formatStep(SPRAY_TABLE.slicesFrom, 'metres')};
  if (sprayHere > 0.0) {
    // Feathered out where a slice comes down to the land, by how far over it this is, so the line where a slice
    // meets a bank never shows, even in a flash. Over water, the land is deep enough under it to leave it be.
    float overLand = point.z - fieldLandHeight(point.xy);
    float feather = smoothstep(0.0, max(${formatFloat(SPRAY_TABLE.feather)}, vGroundFade * 0.9), overLand);
    float density = weatherSprayAt(point, height) * feather;
    if (density > 0.0) {
      float along = max(dot(toward, -weather.keyTravel.xyz), 0.0);
      float scatter = 0.55 + 0.6 * along * along + 2.2 * pow(along, 16.0);
      vec3 sprayLight = weather.ambient.rgb * 1.05 +
        weather.keyLight.rgb * scatter * weatherAirSun() +
        weatherFlashShare(${formatFloat(AIR_TABLE.flashSpray)}, ${formatFloat(AIR_TABLE.flashRainMost * 1.5)});
      float optical = sprayHere * density * ${formatFloat(SPRAY_TABLE.depthPerMetre)} * vThickness *
        aboveGround;
      float share = (1.0 - exp(-optical)) * weatherFogVisibility(metres);
      light += weatherFilmic(sprayLight) * share;
      alpha += share;
    }
  }

  float mist = weather.moreAmounts.y;
  if (mist > 0.0) {
    float density = weatherMistAt(point, height, metres);
    if (density > 0.0) {
      float along = max(dot(toward, -weather.keyTravel.xyz), 0.0);
      float scatter = 0.2 + 0.5 * along * along + 3.2 * pow(along, 22.0);
      vec3 mistLight = weather.ambient.rgb * 0.92 +
        weather.keyLight.rgb * scatter * weatherAirSun() +
        weatherFlashShare(${formatFloat(AIR_TABLE.flashMist)}, ${formatFloat(AIR_TABLE.flashRainMost)});
      float optical = mist * density * ${formatFloat(AIR_TABLE.mistDepth)} * vThickness *
        aboveGround;
      float share = (1.0 - exp(-optical)) * weatherFogVisibility(metres);
      light += weatherFilmic(mistLight) * share;
      alpha += share;
    }
  }

  if (alpha <= 0.0) discard;
  light += vec3(weatherDither() / 255.0);
  fragColor = vec4(max(light, vec3(0.0)), min(alpha, 1.0));
}
`;

const SHAFT_VERTEX = /* glsl */ `#version 300 es
#define SHADER_NAME weather-shaft-vs
precision highp float;
precision highp int;
precision highp sampler2D;

${WEATHER_SHARED_GLSL}
${WEATHER_VERTEX_GLSL}
${SLICE_VERTEX_GLSL}

void main() {
  weatherLoadView();
  gl_Position = WEATHER_CULLED;
  // Evenly through the shaft's own depth, far to near.
  vec3 middle = weather.shaft.xyz - weather.keyTravel.xyz * ${formatFloat(SHAFT_TABLE.height)};
  float across = dot(middle - weatherView.eye, weatherView.forward);
  float reach = weather.shaft.w * ${formatFloat(SHAFT_TABLE.reach)};
  float nearest = max(across - reach, weather.lens.z * 2.0);
  float farthest = min(across + reach, weather.lens.w * 0.99);
  if (farthest <= nearest) return;
  float thickness = (farthest - nearest) / ${formatFloat(SHAFT_TABLE.slices)};
  float place = float(${SHAFT_TABLE.slices - 1} - gl_InstanceID);
  weatherPlaceSlice(weatherCorner(), nearest + thickness * (place + 0.5), thickness);
}
`;

const SHAFT_FRAGMENT = /* glsl */ `#version 300 es
#define SHADER_NAME weather-shaft-fs
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;

${WEATHER_SHARED_GLSL}
${SLICE_FRAGMENT_GLSL}

out vec4 fragColor;

void main() {
  vec3 point = vEye + vRay * vDepth;
  float ground = weatherGround(point.xy);
  if (point.z <= ground) discard;
  float body = weatherShaftBody(point);
  if (body < 0.004) discard;

  // Rays cast down along the sun, from gaps in what is left of the cloud, so they are the same all
  // the way down each line of it. They are in air with a little dust in it, which moves.
  vec3 axis = -weather.keyTravel.xyz;
  vec3 offset = point - weather.shaft.xyz;
  vec3 across = normalize(cross(axis, vec3(0.0, 1.0, 0.0)));
  vec3 above = cross(axis, across);
  float along = dot(offset, axis);
  float radius = weather.shaft.w * (1.0 + along * ${formatFloat(AIR_TABLE.shaftSpread)});
  vec2 flatPlace = vec2(dot(offset, across), dot(offset, above)) / radius;
  float time = weather.clock.x;
  vec2 broadPlace = flatPlace * ${formatFloat(SHAFT_TABLE.broadRays)};
  vec2 finePlace = flatPlace * ${formatFloat(SHAFT_TABLE.fineRays)};
  float broad = weatherNoise3(vec3(broadPlace, time * 0.012));
  float fine = weatherNoise3(vec3(finePlace, time * 0.02 + 0.5));
  float rays = (0.12 + 0.88 * smoothstep(0.38, 0.62, broad)) *
    (0.4 + 1.1 * smoothstep(0.38, 0.62, fine));
  float dust = 0.7 + 0.6 * weatherNoise3(point / 17.0 + vec3(0.0, 0.0, time * 0.016));

  float toward = max(dot(vRay / length(vRay), axis), 0.0);
  float scatter = 0.75 + 1.2 * toward * toward;
  float height = point.z - ground;
  float aboveGround = min(height / vGroundFade, 1.0);
  // It shows in the steam off the crowns and the water, low down, and in its wisps, which rise: not as a
  // band in the sky.
  float steam = exp(-height / ${formatFloat(SHAFT_TABLE.steamHeight)}) *
    (1.0 - ${formatStep(SHAFT_TABLE.steamTop, 'height')}) *
    (0.35 + 0.9 * smoothstep(0.4, 0.68, weatherNoise3((point - vec3(0.0, 0.0, time * ${formatFloat(AIR_TABLE.steamRise)})) / vec3(9.0, 9.0, 22.0))));
  float fromLens = ${formatStep(SHAFT_TABLE.lensFade, 'length(point - vEye)')};
  float optical = weather.ring.y * ${formatFloat(SHAFT_TABLE.depth)} * vThickness * aboveGround *
    body * rays * dust * scatter * steam * fromLens * weatherAirSun();
  float share = 1.0 - exp(-optical);
  if (share <= 0.0) discard;
  vec3 color = weatherFilmic(weather.keyLight.rgb * 2.4);
  fragColor = vec4(max(color * share + vec3(weatherDither() / 255.0), vec3(0.0)), share);
}
`;

const WEATHER_SHADOW_UNIFORMS = /* glsl */ `
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

const WEATHER_SHADOW_MODULES = new WeakMap<object, object>();

/**
 * deck's shadow module, down to its uniforms, as `TreeLayer` and the field layers have it: these
 * shaders read the map through a sampler of their own, and never draw into it.
 */
function getWeatherShadowModule<ModuleT extends {name: string}>(module: ModuleT): ModuleT {
  if (module.name !== 'shadow') return module;
  let slim = WEATHER_SHADOW_MODULES.get(module) as ModuleT | undefined;
  if (!slim) {
    const {getUniforms} = module as unknown as {
      getUniforms: (...args: unknown[]) => Record<string, unknown>;
    };
    slim = {
      ...module,
      vs: `${WEATHER_SHADOW_UNIFORMS}
vec4 shadow_setVertexPosition(vec4 position_commonspace) {
  return gl_Position;
}
`,
      fs: `${WEATHER_SHADOW_UNIFORMS}
vec4 shadow_filterShadowColor(vec4 color) {
  return color;
}
`,
      getUniforms: (...args: unknown[]) => {
        const {
          shadow_uShadowMap0: _map0,
          shadow_uShadowMap1: _map1,
          ...uniforms
        } = getUniforms(...args);
        return uniforms;
      }
    };
    WEATHER_SHADOW_MODULES.set(module, slim);
  }
  return slim;
}

/** Metres moved by the rain and the air since the cycle began, at a cycle second. */
export type WeatherDrift = {
  /** Metres the rain has moved, x, y and z, and the length of its path. */
  rain: [number, number, number, number];
  /** Metres the air has moved, x and y, and the length of its path. */
  air: [number, number, number];
  /** Metres a torn leaf has sunk. */
  leafSink: number;
};

/** What the rain is doing with this slant and wind: its velocity in metres per second. */
export function getRainVelocity(slant: number, bearing: number): Vec3 {
  const lean = Math.min(slant, RAIN_TABLE.mostSlant) * RADIANS_PER_DEGREE;
  const [x, y] = getBearingVector(bearing);
  const blown = RAIN_TABLE.fallSpeed * Math.tan(lean);
  return [x * blown, y * blown, -RAIN_TABLE.fallSpeed];
}

/** How many numbers each sample of the table of drift holds. */
const DRIFT_STRIDE = 8;
let driftTable: Float64Array | null = null;

/**
 * How far things have been carried at each sample of the cycle, by adding up the story's own
 * weather on the scene clock, so slow motion slows the rain and the air with everything else. It
 * is a function of nothing, built once, so a particle's place is a function of the second alone.
 */
function getDriftTable(): Float64Array {
  if (driftTable) return driftTable;
  const samples = Math.ceil(CYCLE_SECONDS / DRIFT_STEP_SECONDS) + 2;
  const table = new Float64Array(samples * DRIFT_STRIDE);
  for (let sample = 1; sample < samples; sample++) {
    const seconds = Math.min((sample - 0.5) * DRIFT_STEP_SECONDS, CYCLE_SECONDS - 1e-6);
    const {weather, wind} = getEnvironment(seconds);
    const step = getTimeRate(seconds) * DRIFT_STEP_SECONDS;
    const rain = getRainVelocity(weather.rainSlant, wind.bearing);
    const [airX, airY] = getBearingVector(wind.bearing);
    const airSpeed = wind.strength * WIND_SPEED_AT_FULL;
    const sink = lerp(
      LEAF_SINK.still,
      LEAF_SINK.blown,
      smoothstep(LEAF_SINK.windFrom, LEAF_SINK.windTo, wind.strength)
    );
    const out = sample * DRIFT_STRIDE;
    const from = out - DRIFT_STRIDE;
    table[out] = table[from] + rain[0] * step;
    table[out + 1] = table[from + 1] + rain[1] * step;
    table[out + 2] = table[from + 2] + rain[2] * step;
    table[out + 3] = table[from + 3] + Math.hypot(...rain) * step;
    table[out + 4] = table[from + 4] + airX * airSpeed * step;
    table[out + 5] = table[from + 5] + airY * airSpeed * step;
    table[out + 6] = table[from + 6] + airSpeed * step;
    table[out + 7] = table[from + 7] + sink * step;
  }
  driftTable = table;
  return table;
}

/**
 * How far the rain and the air have carried things by `t`, taken mod the cycle, since the cycle's
 * start at the swap, where it starts again from nothing. Its rate of change is the velocity at
 * that second times the time rate, however the wind has changed, which is why it is added up and
 * not `velocity * t`.
 */
export function getWeatherDrift(t: number): WeatherDrift {
  const table = getDriftTable();
  const last = table.length / DRIFT_STRIDE - 2;
  const place = Math.min(getCycleSeconds(t) / DRIFT_STEP_SECONDS, last);
  const sample = Math.floor(place);
  const from = sample * DRIFT_STRIDE;
  const to = from + DRIFT_STRIDE;
  const u = place - sample;
  const at = (offset: number) => lerp(table[from + offset], table[to + offset], u);
  return {
    rain: [at(0), at(1), at(2), at(3)],
    air: [at(4), at(5), at(6)],
    leafSink: at(7)
  };
}

/** Cycle seconds either side of a frame that the camera's motion is taken over. */
const CAMERA_MOTION_SECONDS = 1 / 240;
/**
 * The frame's shape the camera's motion is reckoned for. A frame's own shape is not in its state, and a portrait
 * frame's widening scales the take's distance by a few percent at most, with its eye where it was, so its motion
 * is the same to within that.
 */
const CAMERA_MOTION_ASPECT = 16 / 9;

/** How the camera moves at a frame, per cycle second: its eye's velocity, and its spin. */
export type CameraMotion = {velocity: Vec3; spin: Vec3};
const STILL_CAMERA: CameraMotion = {velocity: [0, 0, 0], spin: [0, 0, 0]};

/**
 * How the camera moves at `state`'s second, from the take either side of it in the same world, per cycle second:
 * the eye's velocity in metres, and its spin as a vector along the axis it turns about, in radians, so that a
 * point at `p` seen from the eye `e` crosses the frame as `velocity of p - velocity - spin x (p - e)` would.
 */
export function getCameraMotion(state: StoryState): CameraMotion {
  const {cycle, props, ground} = state;
  const take = (offset: number) =>
    getStoryCamera(
      cycle.seconds + offset,
      cycle.world,
      CAMERA_MOTION_ASPECT,
      [],
      props.orange,
      ground.flood
    );
  const before = take(-CAMERA_MOTION_SECONDS);
  const after = take(CAMERA_MOTION_SECONDS);
  const span = 2 * CAMERA_MOTION_SECONDS;
  const [ex0, ey0, ez0] = getCameraEye(before);
  const [ex1, ey1, ez1] = getCameraEye(after);
  // The turn from one frame of the camera to the other, as the small rotation that takes the one to the other.
  const getFrame = (camera: typeof before): [Vec3, Vec3, Vec3] => {
    const forward = getCameraForward(camera);
    const flat = Math.hypot(forward[0], forward[1]) || 1;
    const right: Vec3 = [forward[1] / flat, -forward[0] / flat, 0];
    const up: Vec3 = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0]
    ];
    return [right, up, forward];
  };
  const from = getFrame(before);
  const to = getFrame(after);
  // R = to * from^T, as rows i and columns j: the sum over the three axes of to[k][i] * from[k][j].
  const rotation = (i: number, j: number) =>
    to[0][i] * from[0][j] + to[1][i] * from[1][j] + to[2][i] * from[2][j];
  const spin: Vec3 = [
    (rotation(2, 1) - rotation(1, 2)) / (2 * span),
    (rotation(0, 2) - rotation(2, 0)) / (2 * span),
    (rotation(1, 0) - rotation(0, 1)) / (2 * span)
  ];
  return {
    velocity: [(ex1 - ex0) / span, (ey1 - ey0) / span, (ez1 - ez0) / span],
    spin: spin.map(value => (Number.isFinite(value) ? value : 0)) as Vec3
  };
}

/** Standard deck.gl lights mean sRGB colors times intensity: linear intensity, decoded hue. */
function getLinearLight(color: Rgb, intensity: number): [number, number, number] {
  const level = Math.max(color[0], color[1], color[2], 1e-3);
  const scale = (level / 255) * intensity;
  return [
    Math.pow(color[0] / level, 2.2) * scale,
    Math.pow(color[1] / level, 2.2) * scale,
    Math.pow(color[2] / level, 2.2) * scale
  ];
}

/** How much of the mist is steam: wet ground with sun on it. */
function getSteamShare(state: StoryState): number {
  return smoothstep(0.2, 0.65, state.ground.wetness) * smoothstep(0.1, 0.7, state.key.intensity);
}

/** The cycle second the magic ring reaches a distance from the hero. */
export function getRingArrival(metres: number): number {
  let low = 0;
  let high = CYCLE_SECONDS;
  for (let step = 0; step < 40; step++) {
    const middle = (low + high) / 2;
    if (getMagicRing(middle).radius < metres) low = middle;
    else high = middle;
  }
  return high;
}

/** The frame of the rain's curtains, and how far they have been carried, for a frame. */
export type WeatherCurtain = {
  /** Unit vectors across the wind on the ground, up the sheets, and along the fall. */
  across: Vec3;
  above: Vec3;
  fall: Vec3;
  /** Metres the sheets have been carried since the cycle began, x and y. */
  carried: [number, number];
};

/** The rain's frame for `WEATHER_CURTAIN_GLSL`, the same for the slices of air and the sky. */
export function getWeatherCurtain(state: StoryState): WeatherCurtain {
  const {weather, wind, cycle} = state;
  const rain = getRainVelocity(weather.rainSlant, wind.bearing);
  const speed = Math.hypot(...rain);
  const fall: Vec3 = [rain[0] / speed, rain[1] / speed, rain[2] / speed];
  const flat = Math.hypot(fall[1], fall[0]);
  const across: Vec3 = flat > 1e-4 ? [fall[1] / flat, -fall[0] / flat, 0] : [1, 0, 0];
  const above: Vec3 = [
    across[1] * fall[2] - across[2] * fall[1],
    across[2] * fall[0] - across[0] * fall[2],
    across[0] * fall[1] - across[1] * fall[0]
  ];
  const {air} = getWeatherDrift(cycle.seconds);
  return {
    across,
    above,
    fall,
    carried: [air[0] * CURTAIN_TABLE.carried, air[1] * CURTAIN_TABLE.carried]
  };
}

/** A crown that tears into a plume: the top of it, its radius, how much it has to give, its gust. */
export type WeatherPlume = {top: Vec3; radius: number; strength: number; gust: number};

type NearCrown = WeatherPlume & {metres: number; foliage: number};

/**
 * The nearest standing crowns, up to `PLUME_TABLE.crowns` of them, nearest first. Each top is bowed downwind as
 * the trees bow, and its gust is `TreeLayer`'s own there, from its CPU twin.
 */
function getNearestCrowns(state: StoryState): NearCrown[] {
  const {trees, wind, camera} = state;
  const eye = getCameraEye(camera);
  const [windX, windY] = getBearingVector(wind.bearing);
  const origin = trees[0]?.position ?? [0, 0, 0];
  const crowns: NearCrown[] = [];
  for (const tree of trees) {
    const growth = tree.growth ?? 1;
    const lean = tree.lean?.[0] ?? 0;
    const foliage = tree.foliage ?? 1;
    if (growth <= 0.2 || lean > PLUME_TABLE.mostLean || foliage <= 0.12) continue;
    const radius = (tree.crownRadius ?? 3) * getCrownFraction(growth);
    if (radius < PLUME_TABLE.leastCrown) continue;
    const position = tree.position ?? [0, 0, 0];
    const height = (tree.height ?? 6) * getHeightFraction(growth);
    const force = typeof tree.wind === 'number' ? tree.wind : wind.strength;
    const bow = PLUME_TABLE.bow * clamp01(force) * height;
    const base = tree.elevation ?? position[2] ?? 0;
    const top: Vec3 = [
      position[0] + windX * bow,
      position[1] + windY * bow,
      base + height * (1 - 0.25 * clamp01(force))
    ];
    const metres = Math.hypot(top[0] - eye[0], top[1] - eye[1], top[2] - eye[2]);
    const gust = getTreeWindGust({
      position: [position[0] - origin[0], position[1] - origin[1]],
      time: wind.gustTime,
      direction: wind.bearing,
      strength: clamp01(force)
    });
    crowns.push({top, radius, strength: 0, gust: clamp01(gust), metres, foliage});
  }
  crowns.sort((a, b) => a.metres - b.metres);
  return crowns.slice(0, PLUME_TABLE.crowns);
}

/**
 * The nearest standing crowns, up to `PLUME_TABLE.crowns` of them, whose tops tear into plumes of
 * spray in a storm's gusts, nearest first. Each top is bowed downwind as the trees bow, and its gust
 * is `TreeLayer`'s own there, from its CPU twin.
 */
export function getPlumeCrowns(state: StoryState): WeatherPlume[] {
  if (state.weather.spray <= 0) return [];
  return getNearestCrowns(state).map(({top, radius, gust, foliage}) => ({
    top,
    radius,
    strength: clamp01(foliage * 1.25),
    gust
  }));
}

/** How much steam goes up off the warm wet crowns: only in the eye's sun, and never while spray is torn off them. */
export function getCrownSteam(state: StoryState): number {
  if (state.weather.spray > 0) return 0;
  const eye = smoothstep(STEAM_TABLE.eye[0], STEAM_TABLE.eye[1], state.sky.eye);
  return clamp01(state.weather.mist * getSteamShare(state) * eye);
}

/**
 * The nearest standing crowns that steam in the eye's sun, as plumes whose strength is how much steam each gives,
 * up to `PLUME_TABLE.crowns` of them, nearest first: none when `getCrownSteam` is 0.
 */
export function getSteamCrowns(state: StoryState): WeatherPlume[] {
  const steam = getCrownSteam(state);
  if (steam <= 0.002) return [];
  return getNearestCrowns(state).map(({top, radius, foliage}) => ({
    top,
    radius,
    strength: steam * clamp01(0.4 + foliage),
    gust: 0
  }));
}

/** A wreck that what floats gathers against: its crown's middle and radius, on the ground. */
export type WeatherWreck = {center: [number, number]; radius: number};

/**
 * The fallen trees' crowns, in the grove's own order, so a thing dammed against one keeps to it as
 * the camera moves: at most `FLOAT_TABLE.wrecks`, the first that have gone down.
 */
export function getWrecks(state: StoryState): WeatherWreck[] {
  const wrecks: WeatherWreck[] = [];
  for (const tree of state.trees) {
    if (wrecks.length >= FLOAT_TABLE.wrecks) break;
    const growth = tree.growth ?? 1;
    const [lean = 0, bearing = 0] = tree.lean ?? [0, 0];
    if (growth <= 0.2 || lean < FLOAT_TABLE.wreckLean) continue;
    const position = tree.position ?? [0, 0, 0];
    const height = (tree.height ?? 6) * getHeightFraction(growth);
    const [x, y] = getBearingVector(bearing);
    const reach = height * 0.62 * Math.sin(lean * RADIANS_PER_DEGREE);
    wrecks.push({
      center: [position[0] + x * reach, position[1] + y * reach],
      radius: (tree.crownRadius ?? 3) * getCrownFraction(growth)
    });
  }
  return wrecks;
}

/** The frame's own table, a texel to each thing, and how many there are of each. */
export type WeatherFrame = {data: Float32Array; plumes: number; splashes: number; wrecks: number};

/** Plumes or steam, splashes and wrecks, for the frame's own table. See `FRAME_ROW`. */
export function getWeatherFrame(state: StoryState): WeatherFrame {
  const data = new Float32Array(FRAME_TEXELS * FRAME_ROWS * 4);
  const write = (row: number, column: number, values: readonly number[]) =>
    data.set(values, (row * FRAME_TEXELS + column) * 4);
  // Plumes in a storm, and in the eye's calm steam off the same crowns, marked as such.
  const spray = getPlumeCrowns(state);
  const steaming = spray.length === 0;
  const plumes = steaming ? getSteamCrowns(state) : spray;
  plumes.forEach(({top, radius, strength, gust}, column) => {
    write(FRAME_ROW.plume, column, [top[0], top[1], top[2], radius]);
    write(FRAME_ROW.plumeMore, column, [strength, gust, steaming ? 1 : 0, 0]);
  });
  const splashes = state.ground.flood.splashes.slice(0, SPLASH_TABLE.most);
  splashes.forEach(({position, age, size}, column) => {
    write(FRAME_ROW.splash, column, [position[0], position[1], position[2], age]);
    write(FRAME_ROW.splashMore, column, [size, 0, 0, 0]);
  });
  const wrecks = getWrecks(state);
  wrecks.forEach(({center, radius}, column) => {
    write(FRAME_ROW.wreck, column, [center[0], center[1], radius, 0]);
  });
  return {data, plumes: plumes.length, splashes: splashes.length, wrecks: wrecks.length};
}

/** Everything the shaders need from a frame. */
function getWeatherUniforms(state: StoryState, frame: WeatherFrame): WeatherUniforms {
  const {weather, wind, camera, key, flash, ambient, fog, ground, lightShafts, shadowColor, cycle} =
    state;
  const drift = getWeatherDrift(cycle.seconds);
  const rain = getRainVelocity(weather.rainSlant, wind.bearing);
  const rainSpeed = Math.hypot(...rain);
  const curtain = getWeatherCurtain(state);
  const [airX, airY] = getBearingVector(wind.bearing);
  const airSpeed = wind.strength * WIND_SPEED_AT_FULL;
  const shaft = lightShafts[0];
  const keyLight = getLinearLight(key.color, key.intensity);
  const flashLight = getLinearLight(flash.color, flash.intensity);
  const ambientLight = getLinearLight(ambient.color, ambient.intensity);
  // Dust and petals are world-fixed, so they would jump at the swap: none around it.
  const noMotes = isInSeamWindow(cycle.seconds, LOOP.noMotes);
  // Only the points are drawn out along the camera's motion.
  const hasPoints = weather.motes > 0 || weather.sparkle > 0 || lightShafts.length > 0;
  const motion = hasPoints ? getCameraMotion(state) : STILL_CAMERA;
  return {
    clock: [
      cycle.clock,
      wind.strength,
      hash01(Math.round(cycle.seconds * 960), 5),
      camera.distance
    ],
    timing: [cycle.seconds, cycle.rate, frame.splashes, frame.wrecks],
    gusts: [airX, airY, clamp01(wind.gust), wind.gustTime],
    amounts: [
      weather.rain,
      weather.debris,
      noMotes ? 0 : weather.motes,
      noMotes ? 0 : weather.petals
    ],
    moreAmounts: [weather.sparkle, weather.mist, getSteamShare(state), drift.leafSink],
    storm: [weather.curtains, weather.spray, ground.flood.floating, frame.plumes],
    flood: [ground.flood.level, ground.flood.mark, ground.flood.drift[0], ground.flood.drift[1]],
    rainVelocity: [rain[0], rain[1], rain[2], rainSpeed],
    rainDrift: drift.rain,
    rainAcross: [...curtain.across, 0],
    rainAbove: [...curtain.above, 0],
    airVelocity: [airX * airSpeed, airY * airSpeed, 0, airSpeed],
    airDrift: [drift.air[0], drift.air[1], 0, drift.air[2]],
    lens: [camera.aperture, camera.distance, camera.near, camera.far],
    ambient: [...ambientLight, 0],
    keyLight: [...keyLight, shadowColor[3]],
    keyTravel: [...key.direction, 0],
    flashLight: [...flashLight, 0],
    flashTravel: [...flash.direction, 0],
    fog: [fog.color[0] / 255, fog.color[1] / 255, fog.color[2] / 255, fog.density],
    horizon: [...getFieldLinearLight(fog.color), 0],
    shaft: shaft ? [...shaft.position, shaft.radius] : [0, 0, 0, 0],
    ring: [ground.magicRing.radius, shaft ? shaft.strength : 0, 0, 0],
    cameraMotion: [...motion.velocity, 0],
    cameraSpin: [...motion.spin, 0]
  };
}

/** A tiling 3D noise 0-255, of value noise in octaves, stretched to fill the range. */
export function getWeatherNoiseData(size: number): Uint8Array {
  const values = new Float32Array(size * size * size);
  for (let octaveIndex = 0; octaveIndex < NOISE_OCTAVES.length; octaveIndex++) {
    const {cells, share} = NOISE_OCTAVES[octaveIndex];
    const lattice = new Float32Array(cells * cells * cells);
    for (let cell = 0; cell < lattice.length; cell++) {
      lattice[cell] = hash01(cell, 61 + octaveIndex);
    }
    const scale = cells / size;
    const eased = new Float32Array(size);
    const lows = new Int32Array(size);
    for (let texel = 0; texel < size; texel++) {
      const place = texel * scale;
      const low = Math.floor(place);
      const u = place - low;
      lows[texel] = low;
      eased[texel] = u * u * u * (u * (6 * u - 15) + 10);
    }
    let out = 0;
    for (let z = 0; z < size; z++) {
      const plane0 = (lows[z] % cells) * cells * cells;
      const plane1 = ((lows[z] + 1) % cells) * cells * cells;
      const zAmount = eased[z];
      for (let y = 0; y < size; y++) {
        const row0 = (lows[y] % cells) * cells;
        const row1 = ((lows[y] + 1) % cells) * cells;
        const yAmount = eased[y];
        for (let x = 0; x < size; x++) {
          const x0 = lows[x] % cells;
          const x1 = (lows[x] + 1) % cells;
          const xAmount = eased[x];
          const near = lerp(
            lerp(lattice[plane0 + row0 + x0], lattice[plane0 + row0 + x1], xAmount),
            lerp(lattice[plane0 + row1 + x0], lattice[plane0 + row1 + x1], xAmount),
            yAmount
          );
          const far = lerp(
            lerp(lattice[plane1 + row0 + x0], lattice[plane1 + row0 + x1], xAmount),
            lerp(lattice[plane1 + row1 + x0], lattice[plane1 + row1 + x1], xAmount),
            yAmount
          );
          values[out++] += share * lerp(near, far, zAmount);
        }
      }
    }
  }
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  const data = new Uint8Array(values.length);
  for (let texel = 0; texel < values.length; texel++) {
    data[texel] = Math.round((255 * (values[texel] - low)) / Math.max(high - low, 1e-6));
  }
  return data;
}

type NoiseEntry = {texture: Texture; references: number};
const WEATHER_NOISE = new WeakMap<Device, NoiseEntry>();
let weatherNoiseData: Uint8Array | null = null;

/**
 * The weather's tiling 3D noise, one texture to a device, shared by every layer that draws rain: the
 * weather's own slices and the sky's veil, so their curtains agree. Give it back with
 * `releaseWeatherNoise`.
 */
export function acquireWeatherNoise(device: Device): Texture {
  let entry = WEATHER_NOISE.get(device);
  if (!entry) {
    weatherNoiseData ??= getWeatherNoiseData(NOISE_SIZE);
    const texture = device.createTexture({
      id: 'weather-noise',
      dimension: '3d',
      format: 'r8unorm',
      width: NOISE_SIZE,
      height: NOISE_SIZE,
      depth: NOISE_SIZE,
      mipLevels: 1,
      sampler: {
        minFilter: 'linear',
        magFilter: 'linear',
        mipmapFilter: 'none',
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        addressModeW: 'repeat'
      }
    });
    texture.writeData(weatherNoiseData, {
      width: NOISE_SIZE,
      height: NOISE_SIZE,
      depthOrArrayLayers: NOISE_SIZE
    });
    entry = {texture, references: 0};
    WEATHER_NOISE.set(device, entry);
  }
  entry.references++;
  return entry.texture;
}

/** Gives back what `acquireWeatherNoise` gave, and destroys it once no layer holds it. */
export function releaseWeatherNoise(device: Device): void {
  const entry = WEATHER_NOISE.get(device);
  if (entry && --entry.references <= 0) {
    WEATHER_NOISE.delete(device);
    entry.texture.destroy();
  }
}

/**
 * The cycle's flood at each sample of `FLOW_SECONDS`: its level, how far it had carried what
 * floats, x and y, and how much floated, for what floats to find when it came on the water and
 * where the water left it.
 */
export function getFloodFlowTable(): Float32Array {
  const data = new Float32Array(WEATHER_TABLE_TEXELS * 4);
  for (let texel = 0; texel < WEATHER_TABLE_TEXELS; texel++) {
    const seconds = lerp(FLOW_SECONDS[0], FLOW_SECONDS[1], texel / (WEATHER_TABLE_TEXELS - 1));
    const {level, drift, floating} = getFlood(seconds, []);
    data.set([level, drift[0], drift[1], floating], texel * 4);
  }
  return data;
}

/**
 * What the sparkles and what floats need of the story, sampled once, each by how far along it. A
 * row of the seed's arc, for those born along it, each at a second of its own; a row of the second
 * the magic ring reaches each distance; and a row of the flood.
 */
function createTablesTexture(device: Device): Texture {
  const width = WEATHER_TABLE_TEXELS;
  const data = new Float32Array(width * WEATHER_TABLE_ROWS * 4);
  for (let texel = 0; texel < width; texel++) {
    const along = texel / (width - 1);
    const position = getSeedPosition(lerp(SEED_TABLE.lift, SEED_TABLE.land, along));
    data.set(position, (WEATHER_TABLE_SEED_ROW * width + texel) * 4);
    const arrival = getRingArrival(along * SPARKLE_TABLE.ring.reach);
    data[(WEATHER_TABLE_RING_ROW * width + texel) * 4] = arrival;
  }
  data.set(getFloodFlowTable(), WEATHER_TABLE_FLOW_ROW * width * 4);
  return device.createTexture({
    id: 'weather-tables',
    format: 'rgba32float',
    width,
    height: WEATHER_TABLE_ROWS,
    data,
    mipLevels: 1,
    sampler: {minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'none'}
  });
}

function createFrameTexture(device: Device, data: Float32Array): Texture {
  return device.createTexture({
    id: 'weather-frame',
    format: 'rgba32float',
    width: FRAME_TEXELS,
    height: FRAME_ROWS,
    data,
    mipLevels: 1,
    sampler: {minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'none'}
  });
}

type WeatherLayerProps = LayerProps & {
  uniforms: WeatherUniforms;
  /** The frame's own table: plumes, splashes and wrecks. */
  frame: Float32Array;
  shadowEnabled: boolean;
};

const defaultProps: DefaultProps<WeatherLayerProps> = {
  uniforms: {type: 'object', value: {} as WeatherUniforms, compare: false},
  frame: {type: 'object', value: new Float32Array(FRAME_TEXELS * FRAME_ROWS * 4), compare: false},
  shadowEnabled: false
};

/** The whole of the air, and what floats, as one layer with a model for each way of drawing it. */
class WeatherLayer extends Layer<Required<WeatherLayerProps>> {
  static layerName = 'WeatherLayer';
  static defaultProps = defaultProps;

  declare state: {
    models: Model[];
    floating?: Model;
    air?: Model;
    shaft?: Model;
    puffs?: Model;
    spatter?: Model;
    rain?: Model;
    flakes?: Model;
    points?: Model;
    noise?: Texture;
    tables?: Texture;
    frame?: Texture;
    shadowMap?: Texture;
    dummyShadowMap?: Texture;
  };

  initializeState(): void {
    this.state.models = [];
  }

  getShaders(shaders: unknown): ReturnType<Layer['getShaders']> {
    const merged = super.getShaders(shaders) as {modules: {name: string}[]};
    return {...merged, modules: merged.modules.map(getWeatherShadowModule)};
  }

  updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    if (params.changeFlags.extensionsChanged || !this.state.models.length) {
      for (const model of this.state.models) model.destroy();
      this.createModels();
    }
    this.state.frame?.writeData(this.props.frame, {
      width: FRAME_TEXELS,
      height: FRAME_ROWS
    } as never);
  }

  finalizeState(context: Parameters<Layer['finalizeState']>[0]): void {
    super.finalizeState(context);
    if (this.state.noise) releaseWeatherNoise(this.context.device);
    this.state.tables?.destroy();
    this.state.frame?.destroy();
  }

  private createModel(name: string, vs: string, fs: string, instanceCount: number): Model {
    return new Model(this.context.device, {
      ...this.getShaders({vs, fs, modules: [project32, weatherModule, _treeWindGust]}),
      id: `${this.props.id}-${name}`,
      topology: 'triangle-strip',
      vertexCount: 4,
      instanceCount,
      isInstanced: true,
      bufferLayout: []
    });
  }

  private createModels(): void {
    const {device} = this.context;
    this.state.noise ??= acquireWeatherNoise(device);
    this.state.tables ??= createTablesTexture(device);
    this.state.frame ??= createFrameTexture(device, this.props.frame);
    const floating = this.createModel('floating', FLOAT_VERTEX, FLOAT_FRAGMENT, FLOAT_INSTANCES);
    const air = this.createModel('air', AIR_VERTEX, AIR_FRAGMENT, AIR_TABLE.slices);
    const shaft = this.createModel('shaft', SHAFT_VERTEX, SHAFT_FRAGMENT, SHAFT_TABLE.slices);
    const puffs = this.createModel('puffs', PUFF_VERTEX, PUFF_FRAGMENT, PUFF_INSTANCES);
    const spatter = this.createModel('spatter', SPATTER_VERTEX, RAIN_FRAGMENT, SPATTER_INSTANCES);
    const rain = this.createModel('rain', RAIN_VERTEX, RAIN_FRAGMENT, RAIN_INSTANCES);
    const flakes = this.createModel('flakes', FLAKE_VERTEX, FLAKE_FRAGMENT, FLAKE_INSTANCES);
    const points = this.createModel('points', POINT_VERTEX, POINT_FRAGMENT, POINT_INSTANCES);
    Object.assign(this.state, {floating, air, shaft, puffs, spatter, rain, flakes, points});
    this.state.models = [floating, air, shaft, puffs, spatter, rain, flakes, points];
  }

  /** Takes the shadow map for the layer's own sampler. See `getWeatherShadowModule`. */
  setShaderModuleProps(props: Parameters<Model['shaderInputs']['setProps']>[0]): void {
    const shadow = props.shadow as {shadowMaps?: Texture[]; dummyShadowMap?: Texture} | undefined;
    if (shadow) {
      if (shadow.dummyShadowMap) this.state.dummyShadowMap = shadow.dummyShadowMap;
      this.state.shadowMap = shadow.shadowMaps?.[0];
    }
    super.setShaderModuleProps(props);
  }

  draw({renderPass, shaderModuleProps}: Parameters<Layer['draw']>[0]): void {
    // It casts no shadow and is not there to be picked.
    if (shaderModuleProps?.picking?.isActive || shaderModuleProps?.shadow?.drawToShadowMap) return;
    const {floating, air, shaft, puffs, spatter, rain, flakes, points} = this.state;
    const {noise, tables, frame, shadowMap, dummyShadowMap} = this.state;
    if (!floating || !air || !shaft || !puffs || !spatter || !rain || !flakes || !points) return;
    if (!noise || !tables || !frame) return;
    const {uniforms} = this.props;
    const [rainAmount, debris, motes, petals] = uniforms.amounts;
    const [sparkle, mist] = uniforms.moreAmounts;
    const [, spray, floats] = uniforms.storm;
    const splashes = uniforms.timing[2];
    const shaftStrength = uniforms.ring[1];
    const shadowBinding = shadowMap ?? dummyShadowMap;
    // Each model is given the textures its shaders read, and the shadow map if they read the sun.
    const drawModel = (model: Model, bindings: Record<string, Texture>, readsSun: boolean) => {
      model.shaderInputs.setProps({weather: uniforms});
      model.setBindings(
        readsSun && shadowBinding ? {...bindings, weatherShadowMap: shadowBinding} : bindings
      );
      model.draw(renderPass);
    };
    // First, and solid, so the slices and the rain drawn after it are hidden behind it.
    if (floats > 0 && uniforms.flood[1] > BED_LAYOUT.ribbonZ + 0.01) {
      floating.setParameters(WEATHER_SOLID_PARAMETERS);
      drawModel(floating, {weatherTables: tables, weatherFrame: frame}, true);
    }
    if (rainAmount > AIR_TABLE.leastAmount || mist > AIR_TABLE.leastAmount || spray > 0) {
      drawModel(air, {weatherNoise: noise}, true);
    }
    if (shaftStrength > AIR_TABLE.leastAmount) drawModel(shaft, {weatherNoise: noise}, true);
    if (spray > 0 || splashes > 0) {
      // Plumes and spindrift go with the spray, and the bursts and rings with a splash.
      drawModel(puffs, {weatherNoise: noise, weatherFrame: frame}, true);
    }
    if (splashes > 0) drawModel(spatter, {weatherFrame: frame}, false);
    if (rainAmount > 0) drawModel(rain, {}, false);
    if (debris > 0 || petals > 0) {
      // Leaves come first, so with no petals the rest need not be gone through.
      flakes.setInstanceCount(petals > 0 ? FLAKE_INSTANCES : LEAF_FLAKES);
      drawModel(flakes, {}, true);
    }
    if (motes > 0 || sparkle > 0 || shaftStrength > 0) {
      // The same for motes.
      points.setInstanceCount(sparkle > 0 ? POINT_INSTANCES : MOTES);
      drawModel(points, {weatherTables: tables}, true);
    }
  }
}

/**
 * Rain, splashes, spray, debris, motes, petals, sparkles, mist, steam and shafts of light, and what
 * the flood carries, or `null` when there is nothing in the air or on the water.
 */
export function createWeatherLayer(state: StoryState): WeatherLayer | null {
  const {weather, lightShafts, ground} = state;
  const isEmpty =
    weather.rain <= 0 &&
    weather.debris <= 0 &&
    weather.motes <= 0 &&
    weather.petals <= 0 &&
    weather.sparkle <= 0 &&
    weather.mist <= 0 &&
    weather.spray <= 0 &&
    ground.flood.floating <= 0 &&
    ground.flood.splashes.length === 0 &&
    lightShafts.length === 0;
  if (isEmpty) return null;
  const frame = getWeatherFrame(state);
  return new WeatherLayer({
    id: 'weather',
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    coordinateOrigin: [0, 0, 0],
    uniforms: getWeatherUniforms(state, frame),
    frame: frame.data,
    shadowEnabled: false,
    getPolygonOffset: null,
    parameters: WEATHER_PARAMETERS
  });
}
