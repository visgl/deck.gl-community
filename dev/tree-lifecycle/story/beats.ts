// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The film's clock: what happens when in the cycle. The beat table, `year` as a curve of cycle
 * seconds, the scene clock that slows around the swap, the loop's windows, the hero's growth as a
 * curve of years, the crop's calendar and the arcs other files share. A value that reads better on
 * screen beats a value in `STORY.md`.
 *
 * Any time is taken mod `CYCLE_SECONDS`, as cycle seconds. The swap, where the Year 30 grove
 * becomes the Day 0 field inside the falling orange's rind, is at cycle second 0. Seam seconds are
 * signed seconds from the swap, continuous through it: only what must run through the swap is keyed
 * on them.
 */

import {clamp01, createTrack, smoothstep, type Key} from './story-math';
import type {BeatId, StoryWorld} from './story-types';

/**
 * Seconds in one cycle. The export is exactly one cycle, 1,920 frames at 30 fps, looping on
 * itself.
 */
export const CYCLE_SECONDS = 64;
/** The cycle's old name, for tools that still read it. */
export const FILM_SECONDS = CYCLE_SECONDS;

/**
 * The loop, in seam seconds (signed seconds from the swap at cycle second 0) unless it says
 * otherwise.
 */
export const LOOP = {
  /** Cycle second the file starts on: the fruit still hanging, 0.4 s before it lets go. */
  fileStart: 61.3,
  /** The falling orange's rind fills every pixel of every sub-frame and lens position in here. */
  cover: [-0.35, 0.25] as const,
  /**
   * The camera's planes are pinned in here, so the shadow map is fit to one frustum on either
   * side. It lies inside `cover`, with room at each end for the planes to ease in and out where
   * only the rind is on screen: pinned any wider, the far plane would sweep through the trees
   * behind the falling fruit in the dive.
   */
  pinned: [-0.3, 0.2] as const,
  pinnedPlanes: {near: 0.003, far: 0.5},
  /** The fruit lets go of the hero here, its centre this many metres above the land under it. */
  letGo: -2.3,
  hangHeight: 0.85,
  /** About where it reaches the sand. A check for tests: its own fall decides it. */
  impact: 1.086,
  /** No wind at all in here, so no twig sways off the stalk and nothing drifts. */
  stillAir: [-5, 2.6] as const,
  /** No motes or petals in here, as their world-fixed places would jump at the swap. */
  noMotes: [-0.6, 0.6] as const,
  /** No caption in here, so the dive and the timeline's roll-over read alone. */
  noCaption: [-1.4, 1.4] as const
};

/** Scene seconds per story second, keyed on seam seconds: high-speed footage around the swap. */
export const TIME_RATE_KEYS: readonly Key[] = [
  [-3.6, 1],
  [-3.1, 0.42],
  [-2.6, 0.12],
  [1.25, 0.12],
  [1.9, 0.45],
  [2.6, 1]
];

/** Each beat, its first cycle second, and the year it starts on. */
export const BEAT_TABLE: readonly {id: BeatId; start: number; year: number}[] = [
  {id: 'landing', start: 0, year: 0},
  {id: 'crop-opens', start: 2.6, year: 0.0006},
  {id: 'seed-flight', start: 4.6, year: 0.002},
  {id: 'into-dirt', start: 6.6, year: 0.004},
  {id: 'sprout', start: 7.8, year: 0.02},
  {id: 'potted-tree', start: 9.6, year: 0.1},
  {id: 'net', start: 12, year: 1},
  {id: 'planting', start: 13.4, year: 1.1},
  {id: 'establish', start: 15.8, year: 1.5},
  {id: 'seasons', start: 19.2, year: 6},
  {id: 'grove-magic', start: 27, year: 15},
  {id: 'grove-thrives', start: 31, year: 15.25},
  {id: 'hurricane', start: 32.6, year: 19.52},
  {id: 'first-wall', start: 34.4, year: 19.5206},
  {id: 'eye', start: 38.2, year: 19.5209},
  {id: 'second-wall', start: 40.3, year: 19.521},
  {id: 'clearing', start: 44, year: 19.5213},
  {id: 'flood', start: 45.6, year: 19.5216},
  {id: 'aftermath', start: 47.8, year: 19.5227},
  {id: 'replant', start: 51.4, year: 20.9},
  {id: 'regrowth', start: 53.2, year: 21.1},
  {id: 'finale', start: 56.4, year: 29.95},
  {id: 'drop', start: 60.6, year: 30}
];

/**
 * Cycle seconds to years. The first year of seasons is one day of the sun clock; the storm is hours
 * and the flood days; the cycle ends held on March 1 of year 30.
 */
export const YEAR_KEYS: readonly Key[] = [
  [0, 0],
  [2.6, 0.0006],
  [4.6, 0.002],
  [6.6, 0.004],
  [7.8, 0.02],
  [9.6, 0.1],
  [10.9, 0.4],
  [12, 1],
  [13.4, 1.1],
  [15.8, 1.5],
  [16.9, 2.6],
  [18.1, 3.9],
  [19.2, 6],
  [19.8, 6.08],
  [20.6, 6.3],
  // Colour break at an autumn sunset, the freeze-protection night in mid-January, and the dawn
  // harvest, its bar landing at 22.46.
  [21.4, 6.66],
  [21.6, 6.83],
  [22.1, 6.88],
  [22.46, 6.92],
  [22.6, 7],
  [23.3, 8],
  [23.9, 9],
  [24.45, 10],
  [24.95, 11],
  [25.43, 12],
  [25.88, 13],
  [26.3, 14],
  [27, 15],
  [31, 15.25],
  [31.8, 17.2],
  [32.6, 19.52],
  [34.4, 19.5206],
  [38.2, 19.5209],
  [40.3, 19.521],
  [44, 19.5213],
  [45.6, 19.5216],
  [47.8, 19.5227],
  [48.4, 19.526],
  [49, 19.5315],
  [49.6, 19.537],
  [50.4, 19.548],
  [51.4, 20.9],
  [53.2, 21.1],
  [54, 23],
  [55.2, 27.5],
  [56.4, 29.95],
  [57.4, 30],
  [64, 30]
];

/**
 * Years to the hero's `growth`, on a monotone curve. Others follow it from their own effective age.
 */
export const HERO_GROWTH_KEYS: readonly Key[] = [
  [0.04, 0],
  [0.25, 0.02],
  [1, 0.075],
  [1.5, 0.095],
  [3, 0.17],
  [6, 0.32],
  [15, 0.6],
  [21, 0.75],
  [30, 0.97]
];

/** The hurricane's arc in cycle seconds, which sky, wind, light, falls, flood and camera share. */
export const HURRICANE = {
  arrive: 32.6,
  firstWall: 34.4,
  /** The eye: calm from `eyeOpen` to `eyeClose`. */
  eyeOpen: 38.2,
  eyeClose: 40.3,
  clearing: 44,
  /** Compass bearing the first wall blows toward (NNE). The second blows the opposite way (SSW). */
  firstWallBearing: 15,
  /** Seconds TreeLayer's gust fronts peak at `viewPoint`: three in each wall. */
  gustPeaks: [34.9, 36.2, 37.5, 40.9, 42.2, 43.4] as const,
  /**
   * Metres: the ground at the storm camera's view centre, where fronts are locked and `wind.gust` is
   * read.
   */
  viewPoint: [-18, 3.8] as const,
  /** First second a swath tree goes in each wall, and the last second one may start. */
  firstWallFalls: [35.6, 37.4] as const,
  secondWallFalls: [41, 43] as const,
  /** In-cloud lightning: second, strength 0-1, and the compass bearing it lights from. */
  lightning: [
    {t: 36.6, strength: 0.8, bearing: 60},
    {t: 37.45, strength: 1, bearing: 140},
    {t: 41.3, strength: 1, bearing: 220},
    {t: 42.9, strength: 0.7, bearing: 300}
  ] as const
};

/**
 * The crop's calendar. Blossoms run in a year of their own that starts `bloomLead` before each
 * March 1, and fruit in one that starts `fruitLag` after it, when the last crop has gone. Spans are
 * 0-1 of those years. A fruit year `k` is harvested in film year `k + 1`, which is how the bars are
 * numbered.
 */
export const CROP_CALENDAR = {
  /** The first year with blossoms, whose few fruit are the first small crop, near year 4. */
  firstBloomYear: 3,
  bloomLead: 0.04,
  bloomRise: [0, 0.05] as const,
  petalFall: [0.09, 0.16] as const,
  blossomGone: [0.16, 0.26] as const,
  fruitLag: 0.02,
  fruitSet: [0.04, 0.14] as const,
  fruitSwell: [0.04, 0.84] as const,
  colorBreak: [0.5, 0.84] as const,
  fruitFall: [0.88, 0.96] as const,
  fruitGone: [0.96, 1] as const,
  /** Seconds any of these takes in the film, however fast years go, so none pops or strobes. */
  leastSeconds: 0.22
};

/** Which part of a fruit year the bar of a harvest lands on, as a fraction of film year. */
export const HARVEST_LANDS_AT = 0.92;

const getYearAtSecond = createTrack(YEAR_KEYS);
const getHeroGrowthAtYear = createTrack(HERO_GROWTH_KEYS);
const getRateAtSeam = createTrack(TIME_RATE_KEYS);

/** Any time in seconds, as cycle seconds from 0 up to `CYCLE_SECONDS`. */
export function getCycleSeconds(t: number): number {
  const wrapped = t % CYCLE_SECONDS;
  return wrapped < 0 ? wrapped + CYCLE_SECONDS : wrapped;
}

/** Signed seconds from the swap, continuous across it: up to half a cycle either way. */
export function getSeamSeconds(t: number): number {
  const seconds = getCycleSeconds(t);
  return seconds < CYCLE_SECONDS / 2 ? seconds : seconds - CYCLE_SECONDS;
}

/** Whether `t` falls in a window of seam seconds, such as `LOOP.cover`. */
export function isInSeamWindow(t: number, window: readonly [number, number]): boolean {
  const seam = getSeamSeconds(t);
  return seam >= window[0] && seam <= window[1];
}

/** The side of the swap a second is on by itself. */
export function getWorld(t: number): StoryWorld {
  return getSeamSeconds(t) < 0 ? 'end' : 'start';
}

/**
 * The cycle second at which tracks of cycle seconds are read for a frame composed from `world`. It
 * is the second itself on its own side of the swap, and that side's flat end of the cycle on the
 * other.
 */
export function getContentSeconds(t: number, world: StoryWorld = getWorld(t)): number {
  if (world === getWorld(t)) return getCycleSeconds(t);
  return world === 'end' ? CYCLE_SECONDS - 1e-6 : 0;
}

/** Scene seconds per story second at `t`. */
export function getTimeRate(t: number): number {
  return getRateAtSeam(getSeamSeconds(t));
}

const CLOCK_STEP = 1 / 240;
let clockTable: Float64Array | null = null;

/** The scene clock at every step of the cycle, added up once from the rate. */
function getClockTable(): Float64Array {
  if (clockTable) return clockTable;
  const steps = Math.round(CYCLE_SECONDS / CLOCK_STEP);
  const table = new Float64Array(steps + 1);
  for (let step = 1; step <= steps; step++) {
    table[step] = table[step - 1] + getTimeRate((step - 0.5) * CLOCK_STEP) * CLOCK_STEP;
  }
  clockTable = table;
  return table;
}

/**
 * Scene seconds since cycle second 0, which everything that moves runs on. It starts again at the
 * swap.
 */
export function getSceneSeconds(t: number): number {
  const table = getClockTable();
  const place = getCycleSeconds(t) / CLOCK_STEP;
  const step = Math.min(Math.floor(place), table.length - 2);
  return table[step] + (table[step + 1] - table[step]) * (place - step);
}

/** Scene seconds since the fruit let go, 0 before: one fall, continuous through the swap. */
export function getFallSeconds(t: number): number {
  const seam = getSeamSeconds(t);
  if (seam <= LOOP.letGo) return 0;
  const table = getClockTable();
  const atLetGo = getSceneSeconds(CYCLE_SECONDS + LOOP.letGo);
  return seam < 0
    ? getSceneSeconds(t) - atLetGo
    : table[table.length - 1] - atLetGo + getSceneSeconds(t);
}

/** Fractional years since the seed. Rises through the cycle, and is 0 again after the swap. */
export function getYear(t: number): number {
  return getYearAtSecond(getCycleSeconds(t));
}

/** How fast years are passing at `t`, in years per second, measured inside the cycle. */
export function getYearRate(t: number): number {
  const seconds = getCycleSeconds(t);
  const from = Math.max(seconds - 0.05, 0);
  const to = Math.min(seconds + 0.05, CYCLE_SECONDS);
  return (getYearAtSecond(to) - getYearAtSecond(from)) / (to - from);
}

/** Fractional part of a year: 0 is March 1, 0.25 June, 0.5 September, 0.75 December. */
export function getSeason(year: number): number {
  return year - Math.floor(year);
}

/** The cycle second a year is reached: the first, if it stays on it. */
export function getSecondOfYear(year: number): number {
  let low = 0;
  let high = CYCLE_SECONDS;
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2;
    if (getYearAtSecond(middle) < year) low = middle;
    else high = middle;
  }
  return high;
}

/** The beat at `t`, and how far through it. */
export function getBeat(t: number): {id: BeatId; index: number; progress: number} {
  const seconds = getCycleSeconds(t);
  let index = BEAT_TABLE.length - 1;
  while (index > 0 && seconds < BEAT_TABLE[index].start) index--;
  const start = BEAT_TABLE[index].start;
  const end = index + 1 < BEAT_TABLE.length ? BEAT_TABLE[index + 1].start : CYCLE_SECONDS;
  return {id: BEAT_TABLE[index].id, index, progress: clamp01((seconds - start) / (end - start))};
}

/** The hero's `growth` at a year, or a tree's at an effective age. */
export function getGrowthAtAge(age: number): number {
  return getHeroGrowthAtYear(age);
}

/**
 * Fraction of mature height at a growth. The same curve as `getTreeHeightFraction` in `TreeLayer`,
 * which the tests check, kept here so the story needs no renderer.
 */
export function getHeightFraction(growth: number): number {
  return 1 - Math.pow(1 - clamp01(growth), 1.6);
}

/** Fraction of mature crown radius at a growth, as `getTreeCrownFraction`. */
export function getCrownFraction(growth: number): number {
  return 1 - Math.pow(1 - clamp01(growth), 1.9);
}

/** Where a fruit year stands at `year`. */
export function getFruitYear(year: number): {index: number; phase: number} {
  const shifted = year - CROP_CALENDAR.fruitLag;
  const index = Math.floor(shifted);
  return {index, phase: shifted - index};
}

/** Where a blossom year stands at `year`. */
export function getBloomYear(year: number): {index: number; phase: number} {
  const shifted = year + CROP_CALENDAR.bloomLead;
  const index = Math.floor(shifted);
  return {index, phase: shifted - index};
}

/** The year, 1-based, that a fruit year's harvest counts toward, and the year it lands on. */
export function getHarvestLanding(harvestYear: number): number {
  return harvestYear - 1 + HARVEST_LANDS_AT;
}

/**
 * How far through a span of the crop's calendar a phase is, eased, at this many years per second. A
 * span too short to see in the film ends later.
 */
export function getSpanFromStart(
  span: readonly [number, number],
  phase: number,
  rate: number
): number {
  const width = Math.max(span[1] - span[0], rate * CROP_CALENDAR.leastSeconds);
  return smoothstep(span[0], span[0] + width, phase);
}

/** The same, but a span too short to see starts earlier, so it still ends in time. */
export function getSpanToEnd(span: readonly [number, number], phase: number, rate: number): number {
  const width = Math.max(span[1] - span[0], rate * CROP_CALENDAR.leastSeconds);
  return smoothstep(span[1] - width, span[1], phase);
}
