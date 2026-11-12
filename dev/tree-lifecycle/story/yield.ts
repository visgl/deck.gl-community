// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Everything the bottom of the frame shows, as data: illustrative yields, the axis's zoom and
 * ticks, bars, flags, readouts and captions, and the roll-over that carries the Year 30 chart into
 * Day 0 around the swap. `stage/timeline-overlay.ts` only draws this.
 */

import {
  getContentSeconds,
  getCycleSeconds,
  getHarvestLanding,
  getSeamSeconds,
  getSeason,
  getSecondOfYear,
  getWorld,
  getYear,
  isInSeamWindow,
  LOOP
} from './beats';
import {clamp01, smootherstep, smoothstep} from './story-math';
import type {
  StoryCaption,
  StoryRollover,
  StoryTickLevel,
  StoryTimeline,
  StoryTimelineChart,
  StoryWorld
} from './story-types';

/**
 * Illustrative boxes per tree, by the year of the harvest. `onTree` is what was hanging when a
 * storm took it, and `second` lands a bar at a cycle second of its own instead of at the harvest.
 * A bar starts to rise at its landing and is up `BAR_RISE_SECONDS` later.
 */
export const YIELD_TABLE: readonly {
  year: number;
  boxes: number;
  broken?: boolean;
  onTree?: number;
  second?: number;
}[] = [
  {year: 4, boxes: 0.1},
  {year: 5, boxes: 0.4},
  {year: 6, boxes: 0.9},
  {year: 7, boxes: 1.5},
  {year: 8, boxes: 2},
  {year: 9, boxes: 2.5},
  {year: 10, boxes: 3},
  {year: 11, boxes: 3.4},
  {year: 12, boxes: 3.7},
  {year: 13, boxes: 4},
  {year: 14, boxes: 4.25},
  {year: 15, boxes: 4.5},
  {year: 16, boxes: 4.75},
  {year: 17, boxes: 5},
  {year: 18, boxes: 5.2},
  {year: 19, boxes: 5.35},
  // The storm's year: what was saved of what hung, landing as the flood peaks, so it is still rising
  // at the peak's still (46.4) and up by 46.7.
  {year: 20, boxes: 1.4, broken: true, onTree: 5.5, second: 46.1},
  // Fruit lost to the storm and roots to the standing water.
  {year: 21, boxes: 0.7},
  {year: 22, boxes: 1.6},
  {year: 23, boxes: 2.7},
  {year: 24, boxes: 3.7},
  {year: 25, boxes: 4.6},
  {year: 26, boxes: 5.3},
  {year: 27, boxes: 5.9},
  {year: 28, boxes: 6.4},
  {year: 29, boxes: 6.8},
  {year: 30, boxes: 7}
];

/** Seconds a bar takes to rise: short enough that the fast years still land one by one. */
const BAR_RISE_SECONDS = 0.6;

/** Event flags, each at the cycle second it is reached. They appear in this order and stay. */
export const FLAG_TABLE: readonly {id: string; label: string; second: number}[] = [
  {id: 'seed', label: 'Seed', second: 6.4},
  {id: 'sprout', label: 'Sprout', second: 8.5},
  {id: 'potted', label: 'Potted', second: 11.3},
  {id: 'net', label: 'Net', second: 13.2},
  {id: 'planted', label: 'Planted', second: 15.3},
  {id: 'first-bloom', label: 'First bloom', second: 17.3},
  {id: 'first-harvest', label: 'First harvest', second: 18.1},
  {id: 'grove', label: 'Grove', second: 27.6},
  // Hours apart in year 19.52, so on the same place of the axis: the lift stacks them.
  {id: 'hurricane', label: 'Hurricane', second: 33},
  {id: 'flood', label: 'Flood', second: 43},
  {id: 'replanted', label: 'Replanted', second: 51.8},
  {id: 'year-30', label: 'Year 30', second: 57.4}
];

/** Seconds a flag takes to fade in. */
const FLAG_FADE_SECONDS = 0.7;

/**
 * The axis always starts at 0 and ends at `playhead / AXIS_FOLLOW`, no less than
 * `AXIS_LEAST_YEARS`, so the playhead rides most of the way across, until the span meets
 * `AXIS_FINAL_YEARS` and stops. `AXIS_LANDING` is how many years of span the zoom takes to ease
 * into its stop.
 */
const AXIS_FOLLOW = 0.8;
const AXIS_LEAST_YEARS = 1.6 / 365;
const AXIS_FINAL_YEARS = 30;
const AXIS_LANDING = 6;

/** How each tick level fades with the axis's span in years: in over one range, out over another. */
const TICK_WINDOWS: Record<
  StoryTickLevel,
  {fadeIn?: readonly [number, number]; fadeOut?: readonly [number, number]}
> = {
  day: {fadeOut: [0.08, 0.2]},
  week: {fadeIn: [0.035, 0.08], fadeOut: [0.55, 1.2]},
  month: {fadeIn: [0.14, 0.32], fadeOut: [3.5, 8]},
  year: {fadeIn: [1.4, 3]},
  fiveYears: {fadeIn: [7, 14]}
};

/** Where the readout changes unit, in years. */
const READOUT_WEEKS_FROM = 21 / 365;
const READOUT_MONTHS_FROM = 0.25;
const READOUT_YEARS_FROM = 1;

const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];

/**
 * The roll-over around the swap, in seam seconds: from `start` up to `end`, the Year 30 chart slides
 * off to the left, joined end to end with a fresh Day 0 axis. Each part eases over a window of its
 * own, so every value is a pure function of seam seconds and every pass shows the same.
 */
export const ROLLOVER = {
  start: -1.2,
  end: 0.6,
  /** Smootherstep: the share of the axis the Year 30 chart has slid left. */
  slide: [-1.2, 0.3],
  /** Smoothstep: the Year 30 chart fading out, and the Day 0 axis fading in. */
  previousFade: [-0.4, 0.5],
  nextFade: [-0.9, 0],
  /** Smootherstep: the readout's drum, from `Year 30` to `Day 0`. */
  roll: [-0.4, 0.2],
  /** Smoothstep: the yield numbers fading out, before anything else moves much. */
  yieldFade: [-1, -0.5]
} as const;

/**
 * Lower-third captions by cycle second: a few plain words, quiet and brief. None reach into
 * `LOOP.noCaption`, so the dive and the roll-over read alone, and `Thirty years` is fully up at
 * `LOOP.fileStart`, the file's first frame.
 */
export const CAPTION_TABLE: readonly {start: number; end: number; text: string}[] = [
  {start: 1.5, end: 3, text: 'One orange'},
  {start: 4.9, end: 6.5, text: 'One seed'},
  {start: 12, end: 13.6, text: 'Netted against greening'},
  {start: 13.8, end: 15.6, text: 'Planted out'},
  {start: 17.6, end: 19.1, text: 'First fruit'},
  {start: 22.8, end: 25.2, text: 'More fruit each year'},
  {start: 27.6, end: 30.4, text: 'A grove'},
  {start: 31.1, end: 32.5, text: 'Good years'},
  {start: 33, end: 35, text: 'Hurricane'},
  {start: 38.6, end: 40.1, text: 'The eye'},
  {start: 45.9, end: 47.6, text: 'Standing water'},
  {start: 48.8, end: 50.6, text: 'Roots drown'},
  {start: 51.6, end: 53.2, text: 'Replanting the gaps'},
  {start: 59.8, end: 62.3, text: 'Thirty years'}
];

/** Seconds a caption takes to fade in and out. */
const CAPTION_FADE_SECONDS = 0.35;

const LANDED_YIELD = YIELD_TABLE.map(row => {
  const second = row.second ?? getSecondOfYear(getHarvestLanding(row.year));
  return {...row, second, axisYear: getYear(second)};
});

const REACHED_FLAGS = FLAG_TABLE.map(flag => ({...flag, year: getYear(flag.second)}));

/** The cycle second each side of the swap is frozen at through the roll-over. */
const SWAP_END = getContentSeconds(0, 'end');
const SWAP_START = getContentSeconds(0, 'start');

/** What is on the tree for a harvest year, in boxes: the harvest, or what a storm found hanging. */
export function getBoxesOnTree(harvestYear: number): number {
  for (const row of YIELD_TABLE) {
    if (row.year === harvestYear) return row.onTree ?? row.boxes;
  }
  return 0;
}

/**
 * Years at the axis's right end. Rises with `year`, and is exactly the final span from about 29 on.
 */
export function getAxisEnd(year: number): number {
  const following = Math.hypot(year / AXIS_FOLLOW, AXIS_LEAST_YEARS);
  const blend = clamp01(0.5 + (0.5 * (AXIS_FINAL_YEARS - following)) / AXIS_LANDING);
  return (
    AXIS_FINAL_YEARS + (following - AXIS_FINAL_YEARS) * blend - AXIS_LANDING * blend * (1 - blend)
  );
}

function getTickAlpha(span: number): Record<StoryTickLevel, number> {
  const getAlpha = (level: StoryTickLevel) => {
    const {fadeIn, fadeOut} = TICK_WINDOWS[level];
    const logSpan = Math.log(span);
    const shown = fadeIn ? smoothstep(Math.log(fadeIn[0]), Math.log(fadeIn[1]), logSpan) : 1;
    const hidden = fadeOut ? smoothstep(Math.log(fadeOut[0]), Math.log(fadeOut[1]), logSpan) : 0;
    return shown * (1 - hidden);
  };
  return {
    day: getAlpha('day'),
    week: getAlpha('week'),
    month: getAlpha('month'),
    year: getAlpha('year'),
    fiveYears: getAlpha('fiveYears')
  };
}

/** The large readout: `Day 12`, `Week 6`, `Month 7` or `Year 12`. */
export function getReadout(year: number): string {
  const isBeyond = (units: number) => Math.floor(units + 1e-9);
  if (year < READOUT_WEEKS_FROM) return `Day ${isBeyond(year * 365)}`;
  if (year < READOUT_MONTHS_FROM) return `Week ${isBeyond((year * 365) / 7)}`;
  if (year < READOUT_YEARS_FROM) return `Month ${isBeyond(year * 12)}`;
  return `Year ${isBeyond(year)}`;
}

/** One chart: the axis as it stands at cycle second `seconds`, at `year`. */
function getChart(seconds: number, year: number): StoryTimelineChart {
  const spanEnd = getAxisEnd(year);
  const bars: StoryTimelineChart['bars'] = [];
  let thisYear = 0;
  let total = 0;
  for (const row of LANDED_YIELD) {
    if (seconds < row.second) break;
    const rise = smootherstep(0, BAR_RISE_SECONDS, seconds - row.second);
    bars.push({year: row.axisYear, boxes: row.boxes, rise, broken: Boolean(row.broken)});
    // This year's number counts on from the one before to this harvest as its bar rises, so where
    // bars land faster than they rise it counts steadily on, never back from 0. Fully up, it is
    // exactly this harvest.
    thisYear = thisYear * (1 - rise) + row.boxes * rise;
    total += row.boxes * rise;
  }
  const flags: StoryTimelineChart['flags'] = [];
  for (const {id, label, second, year: flagYear} of REACHED_FLAGS) {
    if (seconds < second) break;
    flags.push({
      id,
      label,
      year: flagYear,
      alpha: smoothstep(0, FLAG_FADE_SECONDS, seconds - second)
    });
  }
  return {
    spanStart: 0,
    spanEnd,
    playhead: year,
    tickAlpha: getTickAlpha(spanEnd),
    bars,
    flags,
    readout: getReadout(year),
    subReadout: SEASON_NAMES[Math.floor(getSeason(year) * 4)],
    yield: bars.length > 0 ? {thisYear, total} : null,
    alpha: 1
  };
}

/**
 * The roll-over at `t`, or `null` outside it. It reads only seam seconds, never the world a frame
 * is composed from, so both sides of the swap show the same overlay.
 */
export function getRollover(t: number): StoryRollover | null {
  const seam = getSeamSeconds(t);
  if (seam < ROLLOVER.start || seam >= ROLLOVER.end) return null;
  // The Day 0 axis is live after the swap, where cycle seconds are seam seconds, and held as it
  // is at the swap before it.
  const next = seam < 0 ? SWAP_START : seam;
  return {
    slide: smootherstep(...ROLLOVER.slide, seam),
    previousAlpha: 1 - smoothstep(...ROLLOVER.previousFade, seam),
    nextAlpha: smoothstep(...ROLLOVER.nextFade, seam),
    roll: smootherstep(...ROLLOVER.roll, seam),
    yieldAlpha: 1 - smoothstep(...ROLLOVER.yieldFade, seam),
    previous: getChart(SWAP_END, getYear(SWAP_END)),
    next: getChart(next, getYear(next))
  };
}

/**
 * The whole axis at `t`, at `year`, composed from `world`'s side of the swap, with the roll-over
 * around the swap. Its own chart is that side's as it stands; through the roll-over the overlay
 * draws the roll-over's two charts instead.
 */
export function getTimeline(
  t: number,
  year: number,
  world: StoryWorld = getWorld(t)
): StoryTimeline {
  return {...getChart(getContentSeconds(t, world), year), rollover: getRollover(t)};
}

/** The caption at `t`, taken as cycle seconds, or `null` between them and in `LOOP.noCaption`. */
export function getCaption(t: number): StoryCaption {
  if (isInSeamWindow(t, LOOP.noCaption)) return null;
  const seconds = getCycleSeconds(t);
  for (const {start, end, text} of CAPTION_TABLE) {
    if (seconds >= start && seconds < end) {
      const alpha =
        smoothstep(start, start + CAPTION_FADE_SECONDS, seconds) *
        (1 - smoothstep(end - CAPTION_FADE_SECONDS, end, seconds));
      return {text, alpha};
    }
  }
  return null;
}
