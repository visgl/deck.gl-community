// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Light, sky and weather by cycle second. The sun runs on an authored clock of its own, not on
 * `year`, so each beat chooses its sunrises and sunsets and nothing strobes. It rises exactly ten
 * days over the cycle, so the swap finds the sun where the cycle's start left it. Everything else
 * follows from the sun's elevation and the keyed weather, and the hurricane's light, wind and grade
 * from `HURRICANE` and what is over the view: the deck, the eye or the clearing.
 *
 * Every track here is of cycle seconds, read at the content second of the frame's side of the swap.
 * Each one that runs into the swap is flat and equal at both ends of the cycle, so it agrees with
 * itself across the swap in value and slope: those are the loop's pinned values. Only the wind's two
 * clocks run on scene seconds.
 */

import {getTreeWindGust} from '@deck.gl-community/layers';
import {
  CYCLE_SECONDS,
  getContentSeconds,
  getSceneSeconds,
  getWorld,
  HURRICANE,
  isInSeamWindow,
  LOOP
} from './beats';
import {
  clamp,
  clamp01,
  createColorTrack,
  createTrack,
  getBearingVector,
  lerp,
  mixColor,
  normalize,
  pulse,
  RADIANS_PER_DEGREE,
  smoothNoise,
  smoothstep,
  type Key,
  type Track
} from './story-math';
import type {
  Rgb,
  StoryDeckShadow,
  StoryDirectionalLight,
  StoryFog,
  StoryGrade,
  StorySky,
  StoryWeather,
  StoryWind,
  StoryWorld,
  Vec3
} from './story-types';

/** Degrees north. Central Florida. */
const LATITUDE = 28;

/**
 * The sun clock: cycle seconds to days. The fraction is the time of day: 0.25 is sunrise, 0.5 noon,
 * 0.75 sunset. It never runs back, and it rises exactly ten days, flat at both ends, so the sun is
 * 3.05 degrees up at the swap from either side. Slow stretches hold low golden light. Each quick
 * sunset and sunrise has a pair of keys from about 6 degrees up to 1.5 below, where the light
 * changes most, so even a quick day takes its time at the horizon and passes noon and midnight
 * fast.
 */
export const SUN_CLOCK_KEYS: readonly Key[] = [
  // First light on the fallen orange, hardly moving until the seed lands.
  [0, 0.2596],
  [1.3, 0.25975],
  [2.6, 0.2607],
  [4.6, 0.2626],
  [6.6, 0.2657],
  // The day runs on to its first sunset over the pot, then two more days and nights.
  [7.4, 0.731],
  [7.64, 0.7547],
  [8.03, 1.2453],
  [8.25, 1.269],
  [8.5, 1.731],
  [8.74, 1.7547],
  [9.25, 2.2453],
  [9.47, 2.269],
  [9.6, 2.3],
  // One more day for the whip, ending in a held morning for the net and the planting.
  [10.25, 2.731],
  [10.49, 2.7547],
  [10.95, 3.2453],
  [11.17, 3.269],
  [12, 3.33],
  [13.4, 3.36],
  [15.8, 3.46],
  // A long afternoon on the limbs, through the first fruit and the net's lift-off, a blink of a
  // night, and a spring sunrise.
  [18.44, 3.72],
  [18.74, 3.7547],
  [19.13, 4.2526],
  [19.4, 4.2777],
  // Year 6 on one day: noon, sunset, a winter night and a dawn harvest.
  [20.4, 4.5],
  [21.1, 4.722],
  [21.36, 4.7459],
  [21.6, 4.8],
  [22.1, 5.2],
  [22.55, 5.2601],
  [22.85, 5.2843],
  // One more steady day while the years go by and their bars land, a short night, and the March
  // sunrise at the end of the aisle.
  [25.85, 5.7255],
  [26.08, 5.7505],
  [26.6, 6.24],
  [27, 6.258],
  // The grove rises in a long morning, and it is near noon by the time the storm comes.
  [31, 6.345],
  [32.6, 6.48],
  // The sun goes on behind the deck: high in the eye, low in the west for the clearing.
  [39.2, 6.568],
  [44, 6.675],
  [45.6, 6.7],
  // The storm's evening behind the camera, a quick night, and the morning after ahead.
  [46.6, 6.7341],
  [46.95, 6.7577],
  [47.6, 7.2423],
  [47.85, 7.2659],
  // Days of the recession, then a clear morning. The first day runs on to light the bed crowns
  // coming out of the water at 48.5, and the second, about as long, lights the low east end's
  // drowned roots at 50.2 with the sun behind the camera, before a last quick night.
  [48.55, 7.7315],
  [48.79, 7.755],
  [49.1, 8.245],
  [49.34, 8.2685],
  [50.31, 8.7315],
  [50.55, 8.755],
  [50.82, 9.245],
  [51.06, 9.2685],
  [51.4, 9.4],
  [53.2, 9.55],
  // Low gold over the regrowth while its nets lift and its bars climb past the old peak, a short
  // night as the camera comes down, a bright blue first light, and a sunrise a little ahead of
  // Year 30.
  [54, 9.672],
  [55.5, 9.7222],
  [55.73, 9.7461],
  [56.2, 10.2],
  [56.45, 10.235],
  [57, 10.25],
  [57.6, 10.2531],
  [59, 10.2563],
  [60.6, 10.2588],
  [64, 10.2596]
];

/**
 * Declination of the sun's path, in degrees, chosen by the shot rather than the calendar. 0 at both
 * ends of the cycle, so the sun rises due east over the fruit.
 */
const SUN_DECLINATION_KEYS: readonly Key[] = [
  [0, 0],
  [6.6, 0],
  [9.6, 1],
  [11.3, 1],
  [12.6, -5],
  [13.4, -5],
  [14.6, 5],
  [15.8, 5],
  [19.2, -5],
  [20.4, 14],
  [21.3, -6],
  [22, -20],
  [22.6, -10],
  [24.9, -2],
  [27, -6],
  [31, -6],
  [32.6, 2],
  [47.8, 2],
  [51.4, -6],
  [53.2, -4],
  [55.4, -6],
  [56.4, 0],
  [64, 0]
];

/**
 * How far off opposite the sun the moon rides, in degrees, so it clears the horizon as the sun
 * sets.
 */
const MOON_DECLINATION_OFFSET = 6;

/** The lowest the key light's direction goes, so a shadow stays a finite length, in degrees. */
const KEY_LEAST_ELEVATION = 4;
/** Below this elevation of the sun, in degrees, the moon takes over the key light. */
const MOON_TAKES_OVER = -1;

/**
 * The sun's light by its elevation in degrees: strong enough from its first few degrees for a low
 * sun to light what faces it gold, as at the finale's sunrise.
 */
const SUN_INTENSITY_BY_ELEVATION = createTrack([
  [-1, 0],
  [0, 0.32],
  [2, 0.95],
  [5, 1.7],
  [10, 2.15],
  [25, 2.4],
  [60, 2.5]
]);
const SUN_COLOR_BY_ELEVATION = createColorTrack([
  [0, [255, 150, 85]],
  [3, [255, 178, 118]],
  [6, [255, 200, 148]],
  [10, [255, 222, 186]],
  [20, [255, 238, 214]],
  [40, [255, 247, 235]],
  [70, [255, 250, 243]]
]);

/** The moon's light by its own elevation, and how much of it shows by the sun's. */
const MOON_INTENSITY_BY_ELEVATION = createTrack([
  [0, 0.04],
  [8, 0.16],
  [30, 0.34],
  [60, 0.4]
]);
const MOON_COLOR: Rgb = [165, 185, 255];
const MOON_FADE_IN_ELEVATIONS = [-1, -8] as const;

/**
 * Sky light by the sun's elevation in degrees: warm and low at sunrise, blue at dusk, dim at night.
 */
const AMBIENT_INTENSITY_BY_ELEVATION = createTrack([
  [-18, 0.26],
  [-8, 0.46],
  [-3, 0.74],
  [0, 0.72],
  [4, 0.68],
  [10, 0.72],
  [25, 0.82],
  [55, 0.9]
]);
const AMBIENT_COLOR_BY_ELEVATION = createColorTrack([
  [-18, [84, 104, 165]],
  [-8, [110, 130, 190]],
  [-3, [150, 168, 220]],
  [0, [190, 190, 222]],
  [4, [205, 205, 225]],
  [10, [210, 216, 235]],
  [25, [212, 224, 248]],
  [55, [214, 226, 252]]
]);

/** What fair-weather cloud does to light. `overcast` is 0 to 1 over this much cover. */
const OVERCAST_COVER = [0.5, 0.97] as const;
const OVERCAST_KEY_LEFT = 0.1;
const OVERCAST_AMBIENT_GAIN = 0.8;
const OVERCAST_AMBIENT_COLOR: Rgb = [206, 214, 226];
/** Degrees of sun disc jitter in a clear sky and under full cloud. */
const SOFTNESS_CLEAR = 0.9;
const SOFTNESS_OVERCAST = 12;
const SOFTNESS_MOON = 0.7;
/**
 * Fair-weather clouds crossing the sun: how much light they take, how slowly they go, over what
 * cover they start to, over what of their noise they do, and how they soften it, in degrees.
 */
const PASSING_CLOUD = {
  dim: 0.28,
  rate: 0.23,
  cover: [0.1, 0.35] as const,
  noise: [0.1, 0.7] as const,
  softness: 2
};

/**
 * The hurricane's light. Under its deck the key is the sky's own light, from high on the sun's side
 * as the brightest part of an overcast is: the sun's direction taken `towardZenith` of the way up.
 * The air whitens to a bright veil rather than murk, thicker by `fogGust` at each squall's peak.
 */
const STORM_LIGHT = {
  key: {color: [205, 214, 218] as Rgb, intensity: 0.45, softness: 12, towardZenith: 0.45},
  ambient: {color: [160, 176, 178] as Rgb, intensity: 0.48},
  shadowAlpha: 0.35,
  fogColor: [172, 182, 184] as Rgb,
  fogGust: 0.6
};
/**
 * The eye: the true sun through hazy blue, this much of it, with a sharp disc, and the open sky's
 * light. Its haze takes something of the storm's veil.
 */
const EYE_LIGHT = {
  key: 0.5,
  softness: 2,
  ambient: {color: [214, 222, 236] as Rgb, intensity: 0.7},
  shadowAlpha: 0.6,
  fogShare: 0.6
};
/**
 * The clearing: a low sun under the departing deck, gold, the washed sky's light, and what haze is
 * left lit warm by that sun from behind the camera.
 */
const CLEARING_LIGHT = {
  color: [255, 215, 170] as Rgb,
  key: 0.87,
  ambient: {color: [200, 205, 215] as Rgb, intensity: 0.75},
  fogColor: [236, 212, 180] as Rgb
};

/** `LightingEffect.shadowColor`: its alpha is how much direct light a shadow takes. */
const SHADOW_RGB = [0.05, 0.07, 0.12] as const;
const SHADOW_ALPHA_CLEAR = 0.74;
const SHADOW_ALPHA_OVERCAST = 0.45;

/** Lightning: each flash of the hurricane at a cycle second, how strong, and its bearing. */
export const LIGHTNING_TABLE: readonly {t: number; strength: number; bearing: number}[] =
  HURRICANE.lightning;
const LIGHTNING_SHAPE = {
  attack: 0.012,
  decay: 0.06,
  restrikeAfter: 0.11,
  restrikeStrength: 0.7,
  restrikeDecay: 0.045,
  elevation: 55,
  intensity: 2.6,
  color: [205, 220, 255] as Rgb
};

/**
 * The storm by what is over the view, each 0-1. `deck`: how much the storm's deck shades it from
 * the sun. Its edge passes the view centre at 33.0, and the low sun breaks under it at 44.6; the
 * eye's opening is in `EYE_KEYS`. `clearing`: the gold after it. `flood`: the washed light of the
 * standing water. `storm`: the storm's whole light, in place of a fair-weather sky's, from the
 * arrival to the morning after.
 */
const DECK_KEYS: readonly Key[] = [
  [32.6, 0],
  [33, 0.73],
  [33.8, 1],
  [44.2, 1],
  [44.6, 0.08],
  [45, 0]
];
const CLEARING_KEYS: readonly Key[] = [
  [44, 0],
  [44.6, 1],
  [45.6, 1],
  [46.6, 0]
];
const FLOOD_LIGHT_KEYS: readonly Key[] = [
  [45.6, 0],
  [46.4, 1],
  [47.8, 1],
  [48.6, 0]
];
const STORM_WINDOW_KEYS: readonly Key[] = [
  [32.4, 0],
  [32.8, 1],
  [46, 1],
  [47, 0]
];

/**
 * The deck's shadow edge on the ground (`StoryDeckShadow`) as it comes over and as it clears: the
 * compass bearing from its shade toward the sun, metres along that bearing from the origin to the
 * edge by cycle second, the cycle seconds it shows over, rising and falling, and how much of the
 * sun the deck takes behind it. Arriving from behind the camera and to its right, it runs out NE
 * across the grove at about 30 m/s, row by row away from the lens: into the bottom of the frame by
 * 32.2, past the view centre at 33.0 as the key falls there, through the middle of the frame for
 * the 33.2 frame with the far rows still in the sun, and those lose it as the deck thickens over
 * them by 34.2. Clearing, the low gold sun comes in under the deck's trailing edge from the west,
 * behind the camera, onto the near ground first, and follows the edge out east at about 30 m/s,
 * the deck's tail thinning to let some of it through ahead of the edge.
 */
const DECK_SHADOW = {
  softness: 12,
  phases: [
    {
      bearing: 50,
      position: [
        [32, -31],
        [33, 4],
        [33.8, 32],
        [34.1, 60],
        [34.4, 160]
      ] as readonly Key[],
      shown: [32, 32.1, 33.7, 34.2] as const,
      depth: [[32, 1]] as readonly Key[]
    },
    {
      bearing: 270,
      position: [
        [HURRICANE.clearing, 29.5],
        [44.45, 16],
        [45.6, -18.5],
        [46.4, -150]
      ] as readonly Key[],
      shown: [HURRICANE.clearing, HURRICANE.clearing + 0.15, 45.6, 46.4] as const,
      depth: [
        [44.3, 1],
        [45, 0.6]
      ] as readonly Key[]
    }
  ]
};
const DECK_SHADOW_PHASES = DECK_SHADOW.phases.map(phase => ({
  ...phase,
  direction: getBearingVector(phase.bearing),
  getPosition: createTrack(phase.position),
  getDepth: createTrack(phase.depth)
}));

/** Weather across the cycle, as keyed tracks of cycle seconds. */
const TURBIDITY_KEYS: readonly Key[] = [
  [0, 3.4],
  [6.6, 3.2],
  [12, 3],
  [15.8, 3.6],
  [19.2, 3.2],
  [20.4, 4.2],
  [22.6, 3.2],
  [27, 3],
  [31, 3.4],
  [32.6, 4.2],
  [44, 3],
  [45.6, 2.4],
  [47.8, 2.4],
  [49, 2.2],
  [51.4, 2.2],
  [53.2, 2.8],
  [56.4, 3.4],
  [64, 3.4]
];
const CLOUD_COVER_KEYS: readonly Key[] = [
  [0, 0.08],
  [2.6, 0.08],
  [6.6, 0.1],
  [12, 0.15],
  [15.8, 0.22],
  [19.2, 0.2],
  [31, 0.2],
  [32.6, 0.3],
  [34.4, 0.98],
  [43.8, 0.98],
  [45.6, 0.55],
  [47.8, 0.3],
  [51.4, 0.16],
  [53.2, 0.2],
  [56.4, 0.12],
  [59, 0.08],
  [64, 0.08]
];
const CLOUD_BUILD_KEYS: readonly Key[] = [
  [0, 0.2],
  [19.2, 0.2],
  [20.4, 0.35],
  [21.4, 0.25],
  [27, 0.2],
  [32.6, 0.3],
  [34.4, 0.6],
  [44, 0.6],
  [45.6, 0.7],
  [47.8, 0.45],
  [51.4, 0.2],
  [56.4, 0.25],
  [64, 0.2]
];
/**
 * Metres the cloud field has drifted: slow in the macro shots, fast when years go by, nearly still in
 * the slow motion around the swap, where it may start again from nothing unseen.
 */
const CLOUD_DRIFT_KEYS: readonly Key[] = [
  [0, 0],
  [2.6, 2],
  [6.6, 20],
  [9.6, 300],
  [12, 700],
  [15.8, 1600],
  [19.2, 2400],
  [22.6, 3600],
  [27, 5400],
  [31, 6800],
  [32.6, 7200],
  [45.6, 8400],
  [47.8, 9400],
  [51.4, 12000],
  [56.4, 14000],
  [60.6, 14040],
  [64, 14050]
];
const CLOUD_DRIFT_BEARING = 80;

/** Elevations of the sun in degrees that stars come out over, and how much cloud hides them. */
const STARS_OUT = [-3, -12] as const;
const STARS_HIDDEN_BY_CLOUD = 0.92;
/** How much of the eye's opening shows as a shaft of light. */
const SHAFT_IN_EYE = 0.9;
/**
 * Elevations of the sun in degrees that count as golden, for the bloom: rising over two, falling
 * over two.
 */
const GOLDEN_ELEVATIONS = [-1, 3, 12, 28] as const;

/**
 * The hurricane's sky, 0-1, and how far round its bands have turned, in radians: at a physical
 * speed, about 45 m/s for the scud and 24 m/s for the deck.
 */
const STORM_KEYS: readonly Key[] = [
  [32.6, 0],
  [34.4, 0.9],
  [35.2, 1],
  [43.8, 1],
  [44, 0.9],
  [45.6, 0.3],
  [46.8, 0.1],
  [47.8, 0]
];
const STORM_SWIRL_KEYS: readonly Key[] = [
  [HURRICANE.arrive, 0],
  [33.4, 0.06],
  [44.8, 1.14],
  [45.6, 1.2]
];
/** How far the sky has opened at the eye, 0-1. */
const EYE_KEYS: readonly Key[] = [
  [HURRICANE.eyeOpen + 0.05, 0],
  [HURRICANE.eyeOpen + 0.55, 0.95],
  [39.9, 1],
  [HURRICANE.eyeClose, 0.85],
  [HURRICANE.eyeClose + 0.45, 0]
];

/**
 * `windStrength`: exactly 0 through `LOOP.stillAir`, a breeze through the years, the hurricane's
 * walls and its calm eye. A squall rides each of `HURRICANE.gustPeaks` on top of the walls.
 */
const WIND_STRENGTH_KEYS: readonly Key[] = [
  [2.6, 0],
  [4.6, 0.01],
  [9.6, 0.015],
  [13.4, 0.02],
  [15.8, 0.025],
  [19.2, 0.03],
  [22.6, 0.025],
  [27, 0.02],
  [31, 0.025],
  [HURRICANE.arrive, 0.08],
  // The arrival's wind comes up early, so its gust fronts silver the canopy and the middles in bands
  // while the camera is still high over the grove.
  [33, 0.33],
  [33.6, 0.45],
  [HURRICANE.firstWall, 0.5],
  [35, 0.7],
  [36.6, 0.72],
  [HURRICANE.eyeOpen, 0.72],
  [HURRICANE.eyeOpen + 0.4, 0.08],
  [HURRICANE.eyeOpen + 0.8, 0.03],
  [HURRICANE.eyeClose, 0.03],
  [HURRICANE.eyeClose + 0.4, 0.75],
  [42.2, 0.77],
  [43.8, 0.76],
  [HURRICANE.clearing, 0.62],
  [45, 0.12],
  [45.6, 0.06],
  [47.8, 0.035],
  [51.4, 0.02],
  [56.4, 0.02],
  [57.4, 0.012],
  [CYCLE_SECONDS + LOOP.stillAir[0], 0]
];
/** A squall at each gust peak: how much it adds, and the seconds it rises and decays over. */
const SQUALL = {gain: 0.15, rise: 0.4, decay: 0.9};
/**
 * The bearing the wind blows toward, unwrapped: a breeze toward the east, then toward 15 for the
 * first wall, round through the calm to 195 for the second, and back.
 */
const WIND_BEARING_KEYS: readonly Key[] = [
  [0, 80],
  [27, 90],
  [31, 95],
  [HURRICANE.arrive, 25],
  [33.6, HURRICANE.firstWallBearing],
  [HURRICANE.eyeOpen + 0.2, HURRICANE.firstWallBearing],
  [HURRICANE.eyeClose - 0.1, HURRICANE.firstWallBearing + 180],
  [HURRICANE.clearing, HURRICANE.firstWallBearing + 180],
  [45.6, 190],
  [51.4, 100],
  [56.4, 85],
  [CYCLE_SECONDS, 80]
];
/** The breeze's gusts outside the storm: how much it varies, and how fast. */
const WIND_GUST_NOISE = 0.12;
const WIND_GUST_RATE = 0.7;

/**
 * The gust clock's lock. Through the storm `windGustTime` leaves the scene clock and runs about
 * `rate` times as fast, so fronts cross the grove at about the speed of the air. At each of
 * `HURRICANE.gustPeaks` it stands where `TreeLayer`'s front peaks at `HURRICANE.viewPoint`, found by
 * `getTreeWindGust` within `search` gust seconds either way of where the rate alone would put it.
 * Before the storm it is the scene clock, and it is again from the end of `unwind`.
 */
export const GUST_LOCK = {
  from: HURRICANE.arrive,
  /** Seconds the rate takes to come up, from `from`. */
  rampIn: 0.8,
  rate: 4.6,
  /** Of `rate`, how fast it runs through the eye, with next to no wind to show it. */
  eyeShare: 0.55,
  search: 3,
  /** Gust seconds between samples of the twin, and over which its chop is averaged out first. */
  step: 0.01,
  chop: 2.73,
  /** The least rate between peaks, so the clock never runs back. */
  leastRate: 1.5,
  /** Gust seconds it runs on past the last peak, by each of these cycle seconds. */
  runOut: [
    [44.6, 2.2],
    [45.6, 2.8]
  ] as const,
  /**
   * Cycle seconds over which what the storm put on it is taken off again, so that it is the scene
   * clock from the end of these on, and a frame drawn with `windGustTime` is the frame drawn without
   * it. The storm's lock puts about 30 gust seconds on it, more than a clock that never ran back
   * could lose before the finale, so here alone it runs back, at about 2.7 times the scene clock:
   * in a breeze too light for that to show, below `TreeLayer`'s strong-wind start for every tree
   * and the water's cat's-paws (wind 0.05) and the grass's fronts (0.12), with no rain or spray.
   * `ease` of the span at either end brings the change of rate in and out.
   */
  unwind: [46.4, 56] as const,
  ease: 0.15
};

const RAIN_KEYS: readonly Key[] = [
  [33.6, 0],
  [34.2, 0.4],
  [34.8, 0.85],
  [35.4, 1],
  [HURRICANE.eyeOpen, 1],
  [HURRICANE.eyeOpen + 0.3, 0],
  [HURRICANE.eyeClose, 0],
  [HURRICANE.eyeClose + 0.3, 0.8],
  [41, 1],
  [43.8, 1],
  [HURRICANE.clearing, 0.6],
  // The last showers pass before the sun breaks under the deck, so its light comes through clear.
  [44.35, 0.2],
  [44.7, 0.04],
  [45.3, 0.015],
  [45.8, 0]
];
/** Rain's slant in degrees from vertical, from a breeze to the full wind. */
const RAIN_SLANT = {calm: 8, full: 80, windFrom: 0.04, windTo: 0.6};
/** How banded the rain is: sheets with clearer gaps in the walls. */
const CURTAIN_KEYS: readonly Key[] = [
  [34, 0],
  [34.8, 0.75],
  [HURRICANE.eyeOpen, 0.75],
  [HURRICANE.eyeOpen + 0.3, 0],
  [HURRICANE.eyeClose, 0],
  [40.8, 0.75],
  [43.8, 0.75],
  [44.5, 0.3],
  [45.2, 0]
];
/** Spindrift: over what wind it is torn off, and how much of it is there in a lull. */
const SPRAY = {wind: [0.35, 0.7] as const, lull: 0.6};
const DEBRIS_KEYS: readonly Key[] = [
  [33, 0],
  [HURRICANE.firstWall, 0.55],
  [35, 0.9],
  [HURRICANE.eyeOpen, 1],
  [HURRICANE.eyeOpen + 0.4, 0.2],
  [HURRICANE.eyeClose, 0.08],
  [40.8, 0.9],
  [43.8, 1],
  [44.4, 0.3],
  [45.6, 0]
];
const MOTES_KEYS: readonly Key[] = [
  [LOOP.noMotes[1], 0],
  [1.2, 0.35],
  [4.6, 0.4],
  [7.8, 0.2],
  [12, 0.25],
  [15.8, 0.15],
  [19.2, 0.25],
  [21.4, 0.1],
  [27, 0.3],
  [27.6, 1],
  [30.2, 0.9],
  [31.8, 0.2],
  [32.6, 0.1],
  [44.6, 0.1],
  [45.4, 0.35],
  [47.8, 0.15],
  [56.4, 0.3],
  [57.4, 0.35],
  [62.4, 0.35],
  [CYCLE_SECONDS + LOOP.noMotes[0], 0]
];
const PETALS_KEYS: readonly Key[] = [
  [19.2, 0],
  [19.45, 0.8],
  [19.7, 1],
  [20, 0.2],
  [20.3, 0],
  [27.1, 0],
  [28.2, 0.7],
  [30.2, 1],
  [31, 0.4],
  [31.8, 0],
  [56.6, 0],
  [57.6, 0.2],
  [62.4, 0.2],
  [CYCLE_SECONDS + LOOP.noMotes[0], 0]
];
const SPARKLE_KEYS: readonly Key[] = [
  [4.9, 0],
  [5.25, 0.22],
  [6.1, 0.25],
  [6.6, 0],
  [27.2, 0],
  [27.8, 0.8],
  [29.6, 1],
  [30.6, 0.35],
  [31.4, 0]
];
/** Ground mist, and the steam off warm wet crowns and water in the eye and the clearing. */
const MIST_KEYS: readonly Key[] = [
  [0, 0.3],
  [2.6, 0.28],
  [6.6, 0.2],
  [9.6, 0.08],
  [22, 0.08],
  [22.5, 0.4],
  [23.2, 0.1],
  [26.6, 0.1],
  [27.4, 0.2],
  [31, 0.08],
  [HURRICANE.eyeOpen + 0.1, 0.05],
  [HURRICANE.eyeOpen + 0.7, 0.5],
  [39.9, 0.5],
  [HURRICANE.eyeClose + 0.2, 0.08],
  [44.3, 0.08],
  // Steam off the sunlit water in the clearing, thin enough that the gold light reads through it.
  [44.9, 0.2],
  [45.6, 0.28],
  [46.8, 0.25],
  [47.6, 0.45],
  [48.2, 0.3],
  [49.6, 0.15],
  [51.4, 0.1],
  [54.6, 0.1],
  [56.4, 0.3],
  [57.4, 0.35],
  [61, 0.35],
  [64, 0.3]
];
const GROUND_WETNESS_KEYS: readonly Key[] = [
  [33.6, 0],
  [34.6, 0.8],
  [35.4, 1],
  [48.4, 1],
  [49.6, 0.8],
  [50.8, 0.5],
  [51.4, 0.3],
  [53.2, 0.1],
  [54, 0]
];
const TREE_WETNESS_KEYS: readonly Key[] = [
  [33.6, 0],
  [34.6, 0.9],
  [44, 0.95],
  [45.6, 0.9],
  [46.8, 0.7],
  [47.8, 0.55],
  [49, 0.15],
  [50, 0]
];
const GROUND_FROST_KEYS: readonly Key[] = [
  [21.45, 0],
  [21.75, 0.55],
  [22.05, 0.8],
  [22.4, 0.4],
  [22.7, 0]
];
const TREE_FROST_KEYS: readonly Key[] = [
  [21.5, 0],
  [21.8, 0.45],
  [22.05, 0.65],
  [22.35, 0.3],
  [22.6, 0]
];

/** Haze and rain in the air, per metre: exponential fog. 0.0005 at both ends. */
const FOG_DENSITY_KEYS: readonly Key[] = [
  [0, 0.0005],
  [2.6, 0.0005],
  [6.6, 0.00045],
  [15.8, 0.00035],
  [27, 0.0005],
  [31, 0.00045],
  [HURRICANE.arrive, 0.0006],
  [33.8, 0.0035],
  [HURRICANE.firstWall, 0.005],
  [35, 0.006],
  [HURRICANE.eyeOpen, 0.006],
  [HURRICANE.eyeOpen + 0.5, 0.002],
  [HURRICANE.eyeClose - 0.2, 0.002],
  [HURRICANE.eyeClose + 0.3, 0.006],
  [HURRICANE.clearing, 0.006],
  // Washed clear as the sun breaks under the deck.
  [44.5, 0.0025],
  [44.8, 0.001],
  [45.6, 0.0007],
  [47.8, 0.0003],
  [51.4, 0.00025],
  [56.4, 0.0004],
  [57.4, 0.0005],
  [64, 0.0005]
];
const FOG_COLOR_BY_ELEVATION = createColorTrack([
  [-18, [18, 24, 40]],
  [-6, [52, 62, 92]],
  [-1, [150, 128, 128]],
  [3, [238, 186, 150]],
  [10, [236, 210, 190]],
  [25, [206, 218, 232]],
  [60, [196, 212, 232]]
]);
const FOG_OVERCAST_COLOR: Rgb = [176, 184, 192];

/** The grade, by the sun's elevation in degrees, and what the shot and the storm add. */
const EXPOSURE_BY_ELEVATION = createTrack([
  [-18, 0.35],
  [-6, 0.15],
  [2, 0]
]);
/**
 * Stops the operator opens up by cycle second, for shots into the sun whose subject is in its own
 * shade, and for the golden hour of the end shot and the landing it runs into, which a low sun
 * and the hero's dark crown would otherwise leave dim. 0.55 at both ends, easing back to the
 * opening's 0.1 over the halves' parting.
 */
const EXPOSURE_FOR_SHOT_KEYS: readonly Key[] = [
  [0, 0.55],
  [1.8, 0.55],
  [4.6, 0.1],
  [6.6, 0],
  [12, 0],
  [12.6, 0.1],
  [13.4, 0.1],
  [14.4, 0],
  [27, 0],
  [27.8, 0.2],
  [30.2, 0.15],
  [31.8, 0],
  // The short night opens up into a bright blue first light, and the sunrise holds it.
  [55.7, 0],
  [56.35, 0.65],
  [57.4, 0.55],
  [64, 0.55]
];
const CONTRAST_BY_ELEVATION = createTrack([
  [-18, 0.96],
  [0, 1],
  [15, 1.03],
  [60, 1.06]
]);
const SATURATION_BY_ELEVATION = createTrack([
  [-18, 0.6],
  [-6, 0.72],
  [0, 1.02],
  [10, 1.06],
  [40, 1]
]);
const WARMTH_BY_ELEVATION = createTrack([
  [-18, -0.3],
  [-6, -0.3],
  [-1, 0.05],
  [3, 0.25],
  [10, 0.18],
  [25, 0.05],
  [50, 0]
]);
const GRADE_OVERCAST = {contrast: 0.97, saturation: 0.88, warmth: -0.06};
/**
 * The storm's grades, each the whole of it at its phase: the walls under the deck, keeping a
 * cyan-green cast in the shadows; the eye's hazy blue; the clearing's gold; the washed light over
 * the water.
 */
const GRADE_WALLS = {exposure: -0.1, contrast: 1.1, saturation: 0.72, warmth: -0.18};
/**
 * The second wall's grade: the first's with a deeper toe. Its water brims at the bank tops, a flat
 * sheet of tea-brown between the crowns that takes the place of the dark banks and grass the first
 * wall's narrow furrow has, so the frame would lose its darks; a steeper S puts them back and keeps
 * the luma spread over the gate's 0.55. It takes over from the first wall's under the eye's own
 * grade, over `SECOND_WALL_KEYS`, so no frame shows the change.
 */
const GRADE_SECOND_WALL = {...GRADE_WALLS, contrast: 1.26};
const SECOND_WALL_KEYS: readonly Key[] = [
  [HURRICANE.eyeOpen + 0.7, 0],
  [HURRICANE.eyeClose - 0.6, 1]
];
const GRADE_EYE = {exposure: 0.05, contrast: 1.04, saturation: 0.9, warmth: 0.05, bloom: 0.25};
const GRADE_CLEARING = {exposure: 0.15, contrast: 1.08, saturation: 1, warmth: 0.28, bloom: 0.2};
const GRADE_FLOOD = {saturation: 0.95, warmth: 0.12};
const BLOOM = {base: 0.1, golden: 0.12, sparkle: 0.35};
const GRAIN = {base: 0.09, night: 0.1, storm: 0.03};
/** 0.34 at both ends. */
const VIGNETTE_KEYS: readonly Key[] = [
  [0, 0.34],
  [2.6, 0.34],
  [6.6, 0.3],
  [9.6, 0.24],
  [15.8, 0.18],
  [31, 0.16],
  [HURRICANE.arrive, 0.2],
  [HURRICANE.firstWall, 0.42],
  [HURRICANE.eyeOpen, 0.42],
  [HURRICANE.eyeOpen + 0.6, 0.36],
  [39.9, 0.36],
  [HURRICANE.eyeClose + 0.3, 0.42],
  [HURRICANE.clearing, 0.42],
  [45.6, 0.28],
  [47.8, 0.2],
  [56.4, 0.22],
  [57.4, 0.34],
  [64, 0.34]
];

const getClock = createTrack(SUN_CLOCK_KEYS);
const getDeclination = createTrack(SUN_DECLINATION_KEYS);
const getTurbidity = createTrack(TURBIDITY_KEYS);
const getCloudCover = createTrack(CLOUD_COVER_KEYS);
const getCloudBuild = createTrack(CLOUD_BUILD_KEYS);
const getCloudDrift = createTrack(CLOUD_DRIFT_KEYS);
const getStorm = createTrack(STORM_KEYS);
const getStormSwirl = createTrack(STORM_SWIRL_KEYS);
const getEye = createTrack(EYE_KEYS);
const getDeck = createTrack(DECK_KEYS);
const getClearing = createTrack(CLEARING_KEYS);
const getFloodLight = createTrack(FLOOD_LIGHT_KEYS);
const getStormWindow = createTrack(STORM_WINDOW_KEYS);
const getWindBase = createTrack(WIND_STRENGTH_KEYS);
const getWindBearing = createTrack(WIND_BEARING_KEYS);
const getRain = createTrack(RAIN_KEYS);
const getCurtains = createTrack(CURTAIN_KEYS);
const getDebris = createTrack(DEBRIS_KEYS);
const getMotes = createTrack(MOTES_KEYS);
const getPetals = createTrack(PETALS_KEYS);
const getSparkle = createTrack(SPARKLE_KEYS);
const getMist = createTrack(MIST_KEYS);
const getGroundWetness = createTrack(GROUND_WETNESS_KEYS);
const getTreeWetness = createTrack(TREE_WETNESS_KEYS);
const getGroundFrost = createTrack(GROUND_FROST_KEYS);
const getTreeFrost = createTrack(TREE_FROST_KEYS);
const getFogDensity = createTrack(FOG_DENSITY_KEYS);
const getExposureForShot = createTrack(EXPOSURE_FOR_SHOT_KEYS);
const getVignette = createTrack(VIGNETTE_KEYS);
const getSecondWall = createTrack(SECOND_WALL_KEYS);

/** A unit vector toward a body in the sky, +x east, +y north, +z up. */
function getSkyDirection(hourAngle: number, declination: number): Vec3 {
  const sinLatitude = Math.sin(LATITUDE * RADIANS_PER_DEGREE);
  const cosLatitude = Math.cos(LATITUDE * RADIANS_PER_DEGREE);
  const sinDeclination = Math.sin(declination);
  const cosDeclination = Math.cos(declination);
  const cosHour = Math.cos(hourAngle);
  return [
    -cosDeclination * Math.sin(hourAngle),
    cosLatitude * sinDeclination - sinLatitude * cosDeclination * cosHour,
    sinLatitude * sinDeclination + cosLatitude * cosDeclination * cosHour
  ];
}

function getElevation(direction: Vec3): number {
  return Math.asin(clamp(direction[2], -1, 1)) / RADIANS_PER_DEGREE;
}

/** The way light from `direction` travels, kept up off the horizon. */
function getLightDirection(direction: Vec3): Vec3 {
  const leastSine = Math.sin(KEY_LEAST_ELEVATION * RADIANS_PER_DEGREE);
  if (direction[2] >= leastSine) return [-direction[0], -direction[1], -direction[2]];
  const across = Math.hypot(direction[0], direction[1]);
  const scale = across > 0 ? Math.sqrt(1 - leastSine * leastSine) / across : 0;
  return [-direction[0] * scale, -direction[1] * scale, -leastSine];
}

/** One light becoming another: its direction, colour, intensity and softness. */
function mixLight(
  from: StoryDirectionalLight,
  to: StoryDirectionalLight,
  amount: number
): StoryDirectionalLight {
  if (amount <= 0) return from;
  if (amount >= 1) return to;
  return {
    direction: normalize([
      lerp(from.direction[0], to.direction[0], amount),
      lerp(from.direction[1], to.direction[1], amount),
      lerp(from.direction[2], to.direction[2], amount)
    ]),
    color: mixColor(from.color, to.color, amount),
    intensity: lerp(from.intensity, to.intensity, amount),
    shadow: from.shadow || to.shadow,
    softness: lerp(from.softness, to.softness, amount)
  };
}

function mixAmbient(
  from: {color: Rgb; intensity: number},
  to: {color: Rgb; intensity: number},
  amount: number
): {color: Rgb; intensity: number} {
  return {
    color: mixColor(from.color, to.color, amount),
    intensity: lerp(from.intensity, to.intensity, amount)
  };
}

/** The most recent lightning flash: how bright this instant, 0-1, and where it lit from. */
function getLightning(t: number): {flash: number; direction: Vec3} {
  let last = LIGHTNING_TABLE[0];
  for (const event of LIGHTNING_TABLE) {
    if (event.t <= t) last = event;
  }
  const since = t - last.t;
  const {attack, decay, restrikeAfter, restrikeStrength, restrikeDecay, elevation} =
    LIGHTNING_SHAPE;
  let flash = 0;
  if (since > 0) {
    flash = smoothstep(0, attack, since) * Math.exp(-since / decay);
    const again = since - restrikeAfter;
    if (again > 0) {
      flash += restrikeStrength * smoothstep(0, attack, again) * Math.exp(-again / restrikeDecay);
    }
  }
  const [x, y] = getBearingVector(last.bearing);
  const up = elevation * RADIANS_PER_DEGREE;
  return {
    flash: clamp01(flash * last.strength),
    direction: [-x * Math.cos(up), -y * Math.cos(up), -Math.sin(up)]
  };
}

/**
 * The deck's shadow on the ground at cycle second `seconds`, in a frame whose key light is `key`
 * strong where the camera looks, `sun` where the deck lets the sun through and `storm` under it.
 * See `DECK_SHADOW`.
 */
function getDeckShadow(seconds: number, key: number, sun: number, storm: number): StoryDeckShadow {
  for (const phase of DECK_SHADOW_PHASES) {
    const [riseFrom, riseTo, fallFrom, fallTo] = phase.shown;
    if (seconds > riseFrom && seconds < fallTo) {
      const shown = pulse(riseFrom, riseTo, fallFrom, fallTo, seconds);
      const light = Math.max(key, 1e-3);
      return {
        direction: [phase.direction[0], phase.direction[1]],
        position: phase.getPosition(seconds),
        softness: DECK_SHADOW.softness,
        shaded: lerp(1, lerp(sun, storm, phase.getDepth(seconds)) / light, shown),
        sunlit: lerp(1, sun / light, shown)
      };
    }
  }
  return {direction: [0, 1], position: 0, softness: DECK_SHADOW.softness, shaded: 1, sunlit: 1};
}

/** 0-1, the squalls riding the walls: one at each of `HURRICANE.gustPeaks`. */
export function getSquall(seconds: number): number {
  let squall = 0;
  for (const peak of HURRICANE.gustPeaks) {
    if (seconds > peak - SQUALL.rise && seconds < peak + SQUALL.decay) {
      squall = Math.max(
        squall,
        pulse(peak - SQUALL.rise, peak, peak, peak + SQUALL.decay, seconds)
      );
    }
  }
  return squall;
}

/** The wind's strength at a cycle second, before it is held at 0 for the loop. */
function getWindStrength(seconds: number): number {
  const breeze = 1 - getStormWindow(seconds);
  const noise = 1 + WIND_GUST_NOISE * breeze * smoothNoise(seconds * WIND_GUST_RATE, 29);
  return clamp01(getWindBase(seconds) * noise * (1 + SQUALL.gain * getSquall(seconds)));
}

/**
 * Gust seconds near `center` at which `TreeLayer`'s front peaks at `HURRICANE.viewPoint`, no sooner
 * than `earliest`: the most of the twin's gust there, once its chop is averaged out. With no gust to
 * find, as before the twin lands, `center` itself.
 */
function findFrontPeak(
  center: number,
  earliest: number,
  direction: number,
  strength: number
): number {
  const {search, step, chop} = GUST_LOCK;
  const from = Math.max(center - search, earliest);
  const to = Math.max(center + search, from + step);
  const half = Math.round(chop / 2 / step);
  const count = Math.round((to - from) / step) + 2 * half + 1;
  const sums = new Float64Array(count + 1);
  for (let index = 0; index < count; index++) {
    const gust = getTreeWindGust({
      position: HURRICANE.viewPoint,
      time: from + (index - half) * step,
      direction,
      strength
    });
    sums[index + 1] = sums[index] + gust;
  }
  let best = -Infinity;
  let lowest = Infinity;
  let found = center;
  for (let index = half; index < count - half; index++) {
    const mean = sums[index + half + 1] - sums[index - half];
    lowest = Math.min(lowest, mean);
    if (mean > best) {
      best = mean;
      found = from + (index - half) * step;
    }
  }
  return best - lowest > 1e-9 ? found : Math.max(center, earliest);
}

let gustOffsetTrack: Track | null = null;

/**
 * 0 to 1 over 0 to 1, with its rate eased up from 0 over the first `ease` of it, held, and eased
 * back down over the last: smoothstep's rate, integrated.
 */
function getEasedRamp(u: number, ease: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const rise = (x: number) => ease * (x * x * x - (x * x * x * x) / 2);
  const area = 1 - ease;
  if (u < ease) return rise(u / ease) / area;
  if (u > 1 - ease) return 1 - rise((1 - u) / ease) / area;
  return (ease / 2 + u - ease) / area;
}

/**
 * Gust seconds the gust clock stands ahead of the scene clock at cycle second `seconds`: 0 before
 * the storm, then through keys at the peaks, solved once, so the gust clock never runs back while
 * there is wind to show it; held over the storm's evening, then taken off again over
 * `GUST_LOCK.unwind`, and exactly 0 after it.
 */
function getGustOffset(seconds: number): number {
  const track = getGustOffsetTrack();
  const [from, to] = GUST_LOCK.unwind;
  if (seconds <= from) return track(seconds);
  if (seconds >= to) return 0;
  return track(from) * (1 - getEasedRamp((seconds - from) / (to - from), GUST_LOCK.ease));
}

/**
 * Gust seconds the gust clock stands ahead of the scene clock, by cycle second, up to the storm's
 * evening: 0 before the storm, then rising through keys at the peaks, solved once, and held after
 * it. It only ever rises, so the gust clock never runs back through the storm.
 */
function getGustOffsetTrack(): Track {
  if (gustOffsetTrack) return gustOffsetTrack;
  const {from, rampIn, rate, eyeShare, leastRate, runOut} = GUST_LOCK;
  const keys: [number, number][] = [
    [from, 0],
    [from + rampIn, ((rate - 1) * rampIn) / 2]
  ];
  let [second, offset] = keys[1];
  let gustTime = getSceneSeconds(second) + offset;
  for (const peak of HURRICANE.gustPeaks) {
    const across = second < HURRICANE.eyeOpen && peak > HURRICANE.eyeClose;
    const seconds = peak - second;
    const found = findFrontPeak(
      gustTime + (across ? eyeShare * rate : rate) * seconds,
      gustTime + leastRate * seconds,
      getWindBearing(peak),
      getWindStrength(peak)
    );
    gustTime = found;
    second = peak;
    offset = gustTime - getSceneSeconds(peak);
    keys.push([peak, offset]);
  }
  for (const [at, more] of runOut) keys.push([at, offset + more]);
  gustOffsetTrack = createTrack(keys);
  return gustOffsetTrack;
}

/** All of a frame's light, sky and weather. */
export type StoryEnvironment = {
  key: StoryDirectionalLight;
  flash: StoryDirectionalLight;
  ambient: {color: Rgb; intensity: number};
  shadowColor: [number, number, number, number];
  sky: StorySky;
  fog: StoryFog;
  grade: StoryGrade;
  weather: StoryWeather;
  wind: StoryWind;
  groundWetness: number;
  groundFrost: number;
  treeWetness: number;
  treeFrost: number;
  /** Degrees above the horizon, for those that read it. */
  sunElevation: number;
};

/**
 * The wind at `t`, composed from `world`'s side of the swap: its strength, exactly 0 in
 * `LOOP.stillAir`, and bearing by cycle second, and its clocks on scene seconds.
 */
export function getWind(t: number, world: StoryWorld = getWorld(t)): StoryWind {
  const seconds = getContentSeconds(t, world);
  const strength = isInSeamWindow(t, LOOP.stillAir) ? 0 : getWindStrength(seconds);
  const bearing = getWindBearing(seconds);
  const time = getSceneSeconds(t);
  const offset = getGustOffset(seconds);
  const gustTime = offset === 0 ? time : time + offset;
  const direction = ((bearing % 360) + 360) % 360;
  return {
    strength,
    bearing: direction,
    time,
    gustTime,
    gust:
      strength > 0
        ? getTreeWindGust({position: HURRICANE.viewPoint, time: gustTime, direction, strength})
        : 0
  };
}

/** Everything about the air at `t`, composed from `world`'s side of the swap. */
export function getEnvironment(t: number, world: StoryWorld = getWorld(t)): StoryEnvironment {
  const seconds = getContentSeconds(t, world);
  const clock = getClock(seconds);
  const hourAngle = 2 * Math.PI * (clock - 0.5);
  const declination = getDeclination(seconds) * RADIANS_PER_DEGREE;
  const sunDirection = getSkyDirection(hourAngle, declination);
  const moonDirection = getSkyDirection(
    hourAngle + Math.PI,
    -declination + MOON_DECLINATION_OFFSET * RADIANS_PER_DEGREE
  );
  const sunElevation = getElevation(sunDirection);
  const moonElevation = getElevation(moonDirection);

  const cloudCover = getCloudCover(seconds);
  const storm = getStorm(seconds);
  const eye = getEye(seconds);
  // In the storm its own light takes the place of fair-weather cloud's.
  const fair = 1 - getStormWindow(seconds);
  const overcast = smoothstep(OVERCAST_COVER[0], OVERCAST_COVER[1], cloudCover) * fair;
  const under = getDeck(seconds) * (1 - eye);
  const clearing = getClearing(seconds);
  const floodLight = getFloodLight(seconds);
  const passing =
    PASSING_CLOUD.dim *
    fair *
    smoothstep(PASSING_CLOUD.cover[0], PASSING_CLOUD.cover[1], cloudCover) *
    smoothstep(
      PASSING_CLOUD.noise[0],
      PASSING_CLOUD.noise[1],
      smoothNoise(seconds * PASSING_CLOUD.rate, 17)
    );

  // The key light: the sun, or the moon once the sun has gone, each dark at the moment they trade.
  // The eye lets the sun through its haze, the clearing's comes in gold under the deck, and under
  // the deck it is the storm sky's own light.
  const skyDim = lerp(1, OVERCAST_KEY_LEFT, overcast);
  let key: StoryDirectionalLight;
  if (sunElevation >= MOON_TAKES_OVER) {
    key = {
      direction: getLightDirection(sunDirection),
      color: mixColor(SUN_COLOR_BY_ELEVATION(sunElevation), CLEARING_LIGHT.color, clearing),
      intensity:
        SUN_INTENSITY_BY_ELEVATION(sunElevation) *
        skyDim *
        (1 - passing) *
        lerp(1, EYE_LIGHT.key, eye) *
        lerp(1, CLEARING_LIGHT.key, clearing),
      shadow: true,
      softness: lerp(
        lerp(SOFTNESS_CLEAR, SOFTNESS_OVERCAST, overcast) + PASSING_CLOUD.softness * passing,
        EYE_LIGHT.softness,
        eye
      )
    };
  } else {
    const shown = smoothstep(MOON_FADE_IN_ELEVATIONS[0], MOON_FADE_IN_ELEVATIONS[1], sunElevation);
    key = {
      direction: getLightDirection(moonDirection),
      color: MOON_COLOR,
      intensity: MOON_INTENSITY_BY_ELEVATION(moonElevation) * shown * skyDim,
      shadow: true,
      softness: lerp(SOFTNESS_MOON, SOFTNESS_OVERCAST, overcast)
    };
  }
  // The sun as it is where the deck has not yet come, or has gone.
  const sunlit = key.intensity;
  if (under > 0) {
    const toSky = normalize([
      lerp(sunDirection[0], 0, STORM_LIGHT.key.towardZenith),
      lerp(sunDirection[1], 0, STORM_LIGHT.key.towardZenith),
      lerp(sunDirection[2], 1, STORM_LIGHT.key.towardZenith)
    ]);
    const stormKey: StoryDirectionalLight = {
      direction: getLightDirection(toSky),
      color: STORM_LIGHT.key.color,
      intensity: STORM_LIGHT.key.intensity,
      shadow: true,
      softness: STORM_LIGHT.key.softness
    };
    key = mixLight(key, stormKey, under);
  }

  // The sky light: follows the sun, whitens under cloud, and takes each of the storm's phases.
  let ambient = {
    color: mixColor(AMBIENT_COLOR_BY_ELEVATION(sunElevation), OVERCAST_AMBIENT_COLOR, overcast),
    intensity:
      AMBIENT_INTENSITY_BY_ELEVATION(sunElevation) * lerp(1, OVERCAST_AMBIENT_GAIN, overcast)
  };
  ambient = mixAmbient(ambient, STORM_LIGHT.ambient, under);
  ambient = mixAmbient(ambient, EYE_LIGHT.ambient, eye);
  ambient = mixAmbient(ambient, CLEARING_LIGHT.ambient, clearing);

  const lightning = getLightning(seconds);
  const flash: StoryDirectionalLight = {
    direction: lightning.direction,
    color: LIGHTNING_SHAPE.color,
    intensity: LIGHTNING_SHAPE.intensity * lightning.flash,
    shadow: false,
    softness: 0
  };

  const drift = getCloudDrift(seconds);
  const [driftX, driftY] = getBearingVector(CLOUD_DRIFT_BEARING);
  const night = smoothstep(STARS_OUT[0], STARS_OUT[1], sunElevation);
  const sky: StorySky = {
    sunDirection,
    moonDirection,
    turbidity: getTurbidity(seconds),
    cloudCover,
    cloudBuild: getCloudBuild(seconds),
    cloudOffset: [drift * driftX, drift * driftY],
    storm,
    stormSwirl: getStormSwirl(seconds),
    eye,
    stars: night * (1 - STARS_HIDDEN_BY_CLOUD * cloudCover) * (1 - storm),
    starTurn: 2 * Math.PI * clock,
    flash: lightning.flash,
    deckShadow: getDeckShadow(seconds, key.intensity, sunlit, STORM_LIGHT.key.intensity)
  };

  const wind = getWind(t, world);
  const groundWetness = getGroundWetness(seconds);
  const sparkle = getSparkle(seconds);
  const still = isInSeamWindow(t, LOOP.noMotes);
  const weather: StoryWeather = {
    rain: getRain(seconds),
    rainSlant: lerp(
      RAIN_SLANT.calm,
      RAIN_SLANT.full,
      smoothstep(RAIN_SLANT.windFrom, RAIN_SLANT.windTo, wind.strength)
    ),
    debris: getDebris(seconds),
    motes: still ? 0 : getMotes(seconds),
    petals: still ? 0 : getPetals(seconds),
    sparkle,
    shaft: eye * SHAFT_IN_EYE,
    mist: getMist(seconds),
    curtains: getCurtains(seconds),
    spray:
      smoothstep(SPRAY.wind[0], SPRAY.wind[1], wind.strength) *
      groundWetness *
      lerp(SPRAY.lull, 1, wind.gust)
  };

  let fogColor = FOG_COLOR_BY_ELEVATION(sunElevation);
  fogColor = mixColor(fogColor, FOG_OVERCAST_COLOR, overcast);
  fogColor = mixColor(
    fogColor,
    STORM_LIGHT.fogColor,
    Math.max(under, EYE_LIGHT.fogShare * eye * getDeck(seconds))
  );
  fogColor = mixColor(fogColor, CLEARING_LIGHT.fogColor, clearing * (1 - under));
  const fog: StoryFog = {
    color: fogColor,
    density: getFogDensity(seconds) * (1 + STORM_LIGHT.fogGust * under * getSquall(seconds))
  };

  const golden = pulse(
    GOLDEN_ELEVATIONS[0],
    GOLDEN_ELEVATIONS[1],
    GOLDEN_ELEVATIONS[2],
    GOLDEN_ELEVATIONS[3],
    sunElevation
  );
  const grade: StoryGrade = {
    exposure: EXPOSURE_BY_ELEVATION(sunElevation) + getExposureForShot(seconds),
    contrast: lerp(CONTRAST_BY_ELEVATION(sunElevation), GRADE_OVERCAST.contrast, overcast),
    saturation: lerp(SATURATION_BY_ELEVATION(sunElevation), GRADE_OVERCAST.saturation, overcast),
    warmth: lerp(WARMTH_BY_ELEVATION(sunElevation), GRADE_OVERCAST.warmth, overcast),
    bloom: BLOOM.base + BLOOM.golden * golden + BLOOM.sparkle * sparkle,
    vignette: getVignette(seconds),
    grain: GRAIN.base + GRAIN.night * night + GRAIN.storm * under,
    fade: 1
  };
  const secondWall = getSecondWall(seconds);
  const walls =
    secondWall > 0
      ? {
          ...GRADE_WALLS,
          contrast: lerp(GRADE_WALLS.contrast, GRADE_SECOND_WALL.contrast, secondWall)
        }
      : GRADE_WALLS;
  for (const [phase, amount] of [
    [walls, under],
    [GRADE_EYE, eye],
    [GRADE_CLEARING, clearing],
    [GRADE_FLOOD, floodLight]
  ] as const) {
    if (amount > 0) {
      for (const [name, value] of Object.entries(phase)) {
        const field = name as keyof StoryGrade;
        grade[field] = lerp(grade[field], value, amount);
      }
    }
  }

  const shadowAlpha = lerp(
    lerp(lerp(SHADOW_ALPHA_CLEAR, SHADOW_ALPHA_OVERCAST, overcast), STORM_LIGHT.shadowAlpha, under),
    EYE_LIGHT.shadowAlpha,
    eye
  );

  return {
    key,
    flash,
    ambient,
    shadowColor: [SHADOW_RGB[0], SHADOW_RGB[1], SHADOW_RGB[2], shadowAlpha],
    sky,
    fog,
    grade,
    weather,
    wind,
    groundWetness,
    groundFrost: getGroundFrost(seconds),
    treeWetness: getTreeWetness(seconds),
    treeFrost: getTreeFrost(seconds),
    sunElevation
  };
}
