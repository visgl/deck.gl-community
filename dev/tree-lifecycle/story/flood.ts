// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The flood by cycle second: one level plane over the field, water wherever the land of `land.ts`
 * is below it, its high-water mark, how still it is, what it carries, the silt it leaves, and how
 * long it stood over a tree's roots.
 *
 * The furrows fill first, brim at their bank tops, spill over the shoulders to the trunks and over
 * the bed crowns, stand for an evening, a night and a morning, and go down over ten days, the bed
 * crowns out first and the low east end last. Times are cycle seconds; the year track gives the
 * calendar.
 */

import {getCycleSeconds, getSceneSeconds, getYear, HURRICANE} from './beats';
import {getEnvironment} from './environment';
import {BED_LAYOUT} from './land';
import {clamp01, createTrack, getBearingVector, smoothstep, type Key} from './story-math';
import type {StoryFlood, StorySplash} from './story-types';

/** Metres of the water's surface by cycle second, the same plane over the whole field. */
export const FLOOD_LEVEL_KEYS: readonly Key[] = [
  [0, BED_LAYOUT.ribbonZ],
  // Rain rings and sheet flow off the shoulders from 34.0; the pipe's mouth half under at 38.2.
  [33.6, BED_LAYOUT.ribbonZ],
  [36, -0.6],
  [38.2, -0.45],
  // The eye, backing up behind the wreck across the culvert.
  [39.5, -0.33],
  [40.3, -0.29],
  [41.4, -0.18],
  // Brimming at the bank tops, then over the shoulders to the trunks, then over the bed crowns.
  [42.2, BED_LAYOUT.bankTopZ],
  [43, 0],
  [43.6, 0.03],
  [44.6, 0.06],
  // The peak: the storm's evening, a quick night, the morning after.
  [45.8, 0.09],
  [47, 0.09],
  // The bed crowns come out as long strips, then the rows, the low east end, the shoulders. It
  // falls a little faster past the rows than a straight line would, so that land 8 mm below the
  // hero's stands under water for 3 days, and the hero for 2.7.
  [48.1, 0.06],
  [48.4, 0.03],
  [48.7, 0],
  [49, -0.03],
  [49.6, BED_LAYOUT.bankTopZ],
  [50, -0.35],
  [50.4, -0.6],
  [50.8, BED_LAYOUT.ribbonZ],
  [64, BED_LAYOUT.ribbonZ]
];

/** The flood's arc in cycle seconds, and what moves the water and what floats on it. */
export const FLOOD = {
  /** The level leaves the ribbon, and comes back to it. */
  rises: 33.6,
  drained: 50.8,
  /** The highest it stands, from and to. */
  peak: [45.8, 47] as const,
  /** Metres a second east toward the lateral ditch, once it runs over the bank tops. */
  currentSpeed: 0.15,
  /** Levels the current comes on over, round the bank tops. */
  currentLevels: [BED_LAYOUT.bankTopZ - 0.04, BED_LAYOUT.bankTopZ + 0.04] as const,
  /** Share of the air's speed that what floats takes from the wind: 2% of 64 m/s per unit. */
  windage: 0.02,
  airSpeed: 64,
  /** How the wind and rain chop it: calm is 1 - (rain^0.7 + wind^2 x this). */
  windChop: 2.5,
  /** Wind it foams over, levels it needs to, and seconds the foam outlasts the wind by. */
  foamWind: [0.38, 0.72] as const,
  foamLevels: [BED_LAYOUT.ribbonZ - 0.02, BED_LAYOUT.ribbonZ + 0.06] as const,
  foamSeconds: 2,
  /** Integration step of the drift and the foam, story seconds. */
  step: 1 / 60
};

/** How much floats, or lies stranded where the water left it. Stranded fruit is gone by 50.8. */
const FLOATING_KEYS: readonly Key[] = [
  [34.8, 0],
  [36.2, 0.3],
  [38.2, 0.5],
  [40.3, 0.55],
  [42.2, 0.8],
  [43.4, 1],
  [49.8, 1],
  [FLOOD.drained, 0]
];

/**
 * What the flood leaves on flatwoods sand. A thin film of pale silt comes as the water goes and dries, and
 * the next rains and the grass coming through it take it within weeks: by the year track, before the
 * replanting. Its wrack lines, the sand it washed into the furrows and the scum in the low spots last a
 * little longer, and are grown over before the replants go in.
 */
const SILT = {
  rise: [48, 49.8] as const,
  gone: [50.4, 50.8] as const,
  traces: [50.6, 51.4] as const
};

/** Days in a year, for the calendar the year track gives. */
const DAYS_PER_YEAR = 365.25;
/** Time steps the same tables are sampled at, story seconds. */
const TIME_STEP = 1 / 600;

const getLevelAtSecond = createTrack(FLOOD_LEVEL_KEYS);
const getFloatingAtSecond = createTrack(FLOATING_KEYS);

/** Metres, the water's surface at cycle second `t`. */
export function getWaterLevel(t: number): number {
  return getLevelAtSecond(getCycleSeconds(t));
}

/** The highest the water has stood since the swap, at cycle second `t`. */
export function getHighWater(t: number): number {
  const seconds = getCycleSeconds(t);
  let mark = getLevelAtSecond(seconds);
  for (const [x, y] of FLOOD_LEVEL_KEYS) {
    if (x > seconds) break;
    mark = Math.max(mark, y);
  }
  return mark;
}

/** 0-1, the pale film of silt at cycle second `t`, once the water has gone. */
export function getSilt(t: number): number {
  const seconds = getCycleSeconds(t);
  return (
    smoothstep(SILT.rise[0], SILT.rise[1], seconds) *
    (1 - smoothstep(SILT.gone[0], SILT.gone[1], seconds))
  );
}

/**
 * 0-1, how much is left at cycle second `t` of the flood's other traces on the land it covered: wrack
 * lines, sand washed into the furrows, scum in the low spots. They come with the water's going, which the
 * land under the high-water mark tells, and are grown over a little after the silt.
 */
export function getFloodTraces(t: number): number {
  return 1 - smoothstep(SILT.traces[0], SILT.traces[1], getCycleSeconds(t));
}

/** Calendar days at cycle second `t`, counted from the day the hurricane arrives. */
export function getFloodDay(t: number): number {
  return (getYear(getCycleSeconds(t)) - getYear(HURRICANE.arrive)) * DAYS_PER_YEAR;
}

type Crossings = {levels: Float64Array; seconds: Float64Array};
let rising: Crossings | null = null;
let falling: Crossings | null = null;

/** When the level passes each height on its way up, and on its way down, as tables over height. */
function getCrossings(): {rising: Crossings; falling: Crossings} {
  if (!rising || !falling) {
    rising = sampleCrossings(FLOOD.rises, FLOOD.peak[0]);
    falling = sampleCrossings(FLOOD.drained, FLOOD.peak[1]);
  }
  return {rising, falling};
}

/** The level and its second from `from` toward `to`, in order of rising level. */
function sampleCrossings(from: number, to: number): Crossings {
  const count = Math.ceil(Math.abs(to - from) / TIME_STEP) + 1;
  const levels = new Float64Array(count);
  const seconds = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const t = from + ((to - from) * i) / (count - 1);
    seconds[i] = t;
    // Never down again on its way up, so a search can halve it.
    levels[i] = Math.max(getLevelAtSecond(t), i > 0 ? levels[i - 1] : -Infinity);
  }
  return {levels, seconds};
}

/** The second a table's level first reaches `height`. */
function findCrossing({levels, seconds}: Crossings, height: number): number {
  let low = 0;
  let high = levels.length - 1;
  if (height <= levels[low]) return seconds[low];
  if (height >= levels[high]) return seconds[high];
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (levels[middle] < height) low = middle;
    else high = middle;
  }
  const share = (height - levels[low]) / Math.max(levels[high] - levels[low], 1e-12);
  return seconds[low] + (seconds[high] - seconds[low]) * share;
}

/**
 * Calendar days in the cycle that the water stands above land at `baseZ`, by the year track: 0 above
 * the peak, and the whole cycle below the furrows' ribbon, which never leaves.
 */
export function getDaysUnderWater(baseZ: number): number {
  const [, peak] = FLOOD.peak;
  const top = getLevelAtSecond(peak);
  if (baseZ >= top) return 0;
  if (baseZ < BED_LAYOUT.ribbonZ) return (getYear(64) - getYear(0)) * DAYS_PER_YEAR;
  const {rising: up, falling: down} = getCrossings();
  const covered = findCrossing(up, baseZ);
  const uncovered = findCrossing(down, baseZ);
  return Math.max(getYear(uncovered) - getYear(covered), 0) * DAYS_PER_YEAR;
}

/**
 * The cycle second the falling water left land at `height`, after the peak: the peak's end above
 * it, and the drained second below the ribbon.
 */
export function getSecondUncovered(height: number): number {
  return findCrossing(getCrossings().falling, height);
}

type FlowTable = {
  driftX: Float32Array;
  driftY: Float32Array;
  foam: Float32Array;
  /** The unit vector of the wind that made the foam there is, which stays where it blew it. */
  foamX: Float32Array;
  foamY: Float32Array;
};
let flowTable: FlowTable | null = null;

/** The wind and rain as the environment has them at a cycle second, on that second's own side. */
function getAir(seconds: number): {strength: number; bearing: number; rain: number} {
  const {wind, weather} = getEnvironment(seconds);
  return {strength: wind.strength, bearing: wind.bearing, rain: weather.rain};
}

/**
 * What the water carries and how it foams, added up once over the flood on the scene clock: the
 * current east once it runs over the bank tops, 2% of the wind, and foam that outlasts its gusts.
 */
function getFlowTable(): FlowTable {
  if (flowTable) return flowTable;
  const steps = Math.ceil((FLOOD.drained - FLOOD.rises) / FLOOD.step);
  const driftX = new Float32Array(steps + 1);
  const driftY = new Float32Array(steps + 1);
  const foam = new Float32Array(steps + 1);
  const foamX = new Float32Array(steps + 1);
  const foamY = new Float32Array(steps + 1);
  let x = 0;
  let y = 0;
  let foamy = 0;
  let madeX = 0;
  let madeY = 1;
  for (let step = 1; step <= steps; step++) {
    const from = FLOOD.rises + (step - 1) * FLOOD.step;
    const to = FLOOD.rises + step * FLOOD.step;
    const middle = (from + to) / 2;
    const scene = getSceneSeconds(to) - getSceneSeconds(from);
    const level = getLevelAtSecond(middle);
    const air = getAir(middle);
    const current =
      FLOOD.currentSpeed * smoothstep(FLOOD.currentLevels[0], FLOOD.currentLevels[1], level);
    const [towardX, towardY] = getBearingVector(air.bearing);
    const blown = FLOOD.windage * FLOOD.airSpeed * air.strength;
    x += (current + blown * towardX) * scene;
    y += blown * towardY * scene;
    driftX[step] = x;
    driftY[step] = y;
    const windy =
      smoothstep(FLOOD.foamWind[0], FLOOD.foamWind[1], air.strength) *
      smoothstep(FLOOD.foamLevels[0], FLOOD.foamLevels[1], level);
    const kept = foamy * Math.exp(-scene / FLOOD.foamSeconds);
    if (windy > kept) {
      madeX = towardX;
      madeY = towardY;
    }
    foamy = Math.max(windy, kept);
    foam[step] = foamy;
    foamX[step] = madeX;
    foamY[step] = madeY;
  }
  foamX[0] = foamX[1];
  foamY[0] = foamY[1];
  flowTable = {driftX, driftY, foam, foamX, foamY};
  return flowTable;
}

/** A value of the flow table at cycle second `seconds`, between its steps. */
function readFlow(values: Float32Array, seconds: number): number {
  const place = (seconds - FLOOD.rises) / FLOOD.step;
  if (place <= 0) return values[0];
  if (place >= values.length - 1) return values[values.length - 1];
  const step = Math.floor(place);
  return values[step] + (values[step + 1] - values[step]) * (place - step);
}

/**
 * The unit vector, on the ground, of the wind that made the foam on the water at cycle second `t`:
 * foam stays on the banks it was blown onto after the wind drops or turns.
 */
export function getFoamToward(t: number): [number, number] {
  const seconds = getCycleSeconds(t);
  if (seconds <= FLOOD.rises) return [0, 1];
  const table = getFlowTable();
  const place = Math.min(
    Math.max(Math.round((seconds - FLOOD.rises) / FLOOD.step), 0),
    table.foam.length - 1
  );
  return [table.foamX[place], table.foamY[place]];
}

/**
 * The flood at cycle second `t`, with what is hitting the water now. What it has carried holds from
 * the drained second to the swap, where it starts again from nothing.
 */
export function getFlood(t: number, splashes: StorySplash[]): StoryFlood {
  const seconds = getCycleSeconds(t);
  const level = getLevelAtSecond(seconds);
  const air = getAir(seconds);
  const rough = Math.pow(clamp01(air.rain), 0.7) + FLOOD.windChop * air.strength * air.strength;
  const table = seconds > FLOOD.rises ? getFlowTable() : null;
  // Foam outlasts the wind, but is gone by the time the furrows are back to their ribbon.
  const foamLeft = 1 - smoothstep(FLOOD.peak[1], FLOOD.drained, seconds);
  return {
    level,
    mark: getHighWater(seconds),
    calm: 1 - clamp01(rough),
    foam: table ? readFlow(table.foam, seconds) * foamLeft : 0,
    drift: table ? [readFlow(table.driftX, seconds), readFlow(table.driftY, seconds)] : [0, 0],
    floating: getFloatingAtSecond(seconds),
    splashes
  };
}
