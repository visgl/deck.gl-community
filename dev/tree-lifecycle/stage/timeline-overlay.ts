// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The bottom of the frame: one thin axis over a soft scrim, its ticks, season ribbon, yield bars
 * and event flags, and the readout, yield and captions around it. It reads only `state.timeline`
 * and `state.caption`. On a portrait frame the scrim is a band behind the axis, the readout and the
 * yields, so the ground below keeps its light, and each piece of type carries a soft shade of its
 * own, so it holds over bright sand or cloud.
 *
 * Everything is laid out by pure functions of that data, the frame's size and a way to measure
 * text, so a test can run the whole film through them, and `drawTimelineOverlay` only paints what
 * they return. It is sharp at any pixel density because it is laid out in device pixels, on a
 * canvas of its own.
 *
 * A portrait frame is cut for TikTok, Reels and Shorts, which draw their own buttons, captions and
 * headers over it. There everything keeps inside the area all three leave clear, and the caption
 * moves up to the top of the frame, over a soft patch of shade behind its words only.
 *
 * Around the swap, `timeline.rollover` carries two charts: the Year 30 chart slides off to the left,
 * joined end to end with a fresh Day 0 axis, with the playhead on the join. Each is laid out like
 * the one chart of any other frame, only slid along the axis and faded: the one going fades out
 * inside the axis's left end, the one coming fades in inside its right end, and the axis's line
 * stays put under both. The readout turns over like an odometer's drum, in a window a line tall.
 */

import {clamp, clamp01, lerp, smoothstep} from '../story/story-math';
import type {
  StoryCaption,
  StoryTickLevel,
  StoryTimeline,
  StoryTimelineChart
} from '../story/story-types';

/** A face, size and spacing of the overlay's type. */
export type OverlayFont = {
  family: string;
  weight: number;
  size: number;
  /** Letter spacing in pixels. */
  tracking: number;
  italic?: boolean;
};

/** Width of a line of text in a font, in pixels, with its tracking. */
export type MeasureText = (text: string, font: OverlayFont) => number;

/** The frame's plan, in device pixels: where everything sits and how big its type is. */
export type OverlayMetrics = {
  width: number;
  height: number;
  isPortrait: boolean;
  /** Device pixels per design pixel. */
  unit: number;
  /** The axis. */
  axisLeft: number;
  axisRight: number;
  axisY: number;
  ribbonHeight: number;
  lineWidth: number;
  /** How tall a bar of `barScaleBoxes` is. */
  barHeight: number;
  /** Ticks by level, in pixels below the axis. */
  tickHeight: Record<StoryTickLevel, number>;
  tickLabelY: number;
  /** How far tick labels may reach, so the first and last stay inside the frame's margins. */
  tickLabelLeft: number;
  tickLabelRight: number;
  /** Baseline of the first row of flags, and how far apart rows are. */
  flagBaseline: number;
  flagRow: number;
  /** Last row a flag may use. Past it, a label thins out to a bare tick. */
  flagMostRow: number;
  /** Space from a flag's pole to its label, and the least between a label and the next pole. */
  flagGap: number;
  flagClear: number;
  /** How far ahead of a collision a label starts to lift, so it never jumps. */
  flagLift: number;
  /**
   * How far inside either end of the axis what slides through it in the roll-over fades, and the
   * room the two charts' end labels keep between them at the join.
   */
  edgeFade: number;
  joinGap: number;
  /** The readout's baseline, at the frame's left, and its season's. */
  readoutX: number;
  readoutY: number;
  subReadoutY: number;
  /**
   * The readout's drum turns in a window a line tall, from over the ascenders of the line in place
   * to just over the season's capitals, so clear of the tick labels above and the season below.
   * What turns through the window's edges fades over `readoutFeather`, and the drum's radius is
   * `readoutDrum`.
   */
  readoutWindowTop: number;
  readoutWindowBottom: number;
  readoutFeather: number;
  readoutDrum: number;
  /** Right edge of the yield's numbers, the distance between its two columns, and baselines. */
  yieldRight: number;
  yieldColumn: number;
  yieldY: number;
  yieldLabelY: number;
  captionX: number;
  captionY: number;
  /**
   * A caption at the top of the frame has a scrim of its own: a soft patch behind its words only,
   * `captionScrimStrength` dark along the line through their middle at `captionScrimY`, from their
   * first letter to their last, and fading out over `captionScrimReach` all round, so gone by
   * `captionScrimBottom` below. The sky around it keeps its light. Its strength is `0` where the
   * caption sits in the overlay's scrim.
   */
  captionScrimY: number;
  captionScrimReach: number;
  captionScrimBottom: number;
  captionScrimStrength: number;
  /**
   * The scrim behind the axis, the readout and the yields, as `getScrimAlpha` has it: from nothing
   * at `scrimTop` in to `scrimStrength` at `scrimFull`, held to `scrimHold`, then down to
   * `scrimTailStrength` by `scrimFall`, which it keeps to the bottom of the frame.
   */
  scrimTop: number;
  scrimFull: number;
  scrimHold: number;
  scrimFall: number;
  scrimStrength: number;
  scrimTailStrength: number;
  fonts: {
    readout: OverlayFont;
    subReadout: OverlayFont;
    flag: OverlayFont;
    tick: OverlayFont;
    number: OverlayFont;
    numberLabel: OverlayFont;
    caption: OverlayFont;
  };
};

export type OverlayTick = {x: number; height: number; alpha: number};
export type OverlayTickLabel = {x: number; text: string; alpha: number};
export type OverlayRibbonPiece = {left: number; right: number; color: string; alpha: number};
export type OverlayBar = {
  x: number;
  width: number;
  /** Solid height from the axis. */
  height: number;
  alpha: number;
  /**
   * What a storm took: the height above the break, and how far it shows. `0` for an ordinary bar.
   */
  lostHeight: number;
};
export type OverlayFlag = {
  id: string;
  label: string;
  /** Where its pole stands, and how high it reaches. */
  x: number;
  poleTop: number;
  poleAlpha: number;
  /** Left edge and baseline of its label, its width, and its opacity. */
  textX: number;
  textY: number;
  textWidth: number;
  textAlpha: number;
  /** Fractional row. */
  row: number;
};

/** A chart on the axis: how many pixels it has slid along it from its place, and its opacity. */
export type OverlayChart = {offset: number; alpha: number};
/** A line of the readout's drum: its text, its baseline and its opacity. */
export type OverlayReadoutLine = {
  text: string;
  y: number;
  alpha: number;
  /** Height of its letters about its baseline, as the drum turns it away: 1 facing out. */
  scale: number;
};

/** Everything `drawTimelineOverlay` paints, and all a test needs to look at. */
export type OverlayLayout = {
  metrics: OverlayMetrics;
  alpha: number;
  playheadX: number;
  /**
   * The charts on the axis: the one, or through the roll-over the Year 30 chart and the Day 0 axis
   * joined to its right. Their marks below are placed and faded already, with what cannot be seen
   * left out.
   */
  charts: OverlayChart[];
  ribbon: OverlayRibbonPiece[];
  ticks: OverlayTick[];
  tickLabels: OverlayTickLabel[];
  bars: OverlayBar[];
  flags: OverlayFlag[];
  /**
   * The readout's line, or mid-roll the lines of its drum that show in its window, which fades what
   * turns through its edges over `feather`. A line out of the window is left out.
   */
  readout: OverlayReadoutLine[];
  readoutWindow: {top: number; bottom: number; feather: number} | null;
  subReadout: string;
  yield: {thisYear: string; total: string; alpha: number} | null;
  caption: {text: string; alpha: number} | null;
};

/** A box of a piece of text, for tests. */
export type OverlayBox = {id: string; left: number; right: number; top: number; bottom: number};

const SANS = '"Avenir Next", "Avenir", "Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = '"Iowan Old Style", "Palatino", "Georgia", serif';

/** The frame narrows to a stacked layout below this width over height, as the camera does. */
export const PORTRAIT_BELOW = 1.2;
/**
 * What TikTok, Reels and Shorts leave clear of their buttons, captions and headers on a portrait
 * frame, in design pixels from each edge: the widest margin that guides to the three apps give.
 */
export const PORTRAIT_SAFE_AREA = {top: 260, right: 164, bottom: 370, left: 62};
/** Height a design pixel is measured from: a 1080-line frame, or a 1080-wide one standing up. */
export const DESIGN_SIZE = 1080;
/**
 * A bar this many boxes tall reaches `barHeight`, and it is never wider than this in design pixels.
 */
const BAR_SCALE_BOXES = 7.5;
const BAR_MOST_WIDTH = 8;

const INK = '246, 243, 234';
/**
 * The scrims' dark, a little lifted from black, so it takes less from a dark picture than from a
 * bright one.
 */
const SCRIM = '12, 14, 16';
const SEASON_COLORS = ['#9dc27a', '#e6c868', '#d9944a', '#8fb1cf'];

/** Days of a year, and the steps of each tick level in years. */
const DAYS_PER_YEAR = 365;
const TICK_STEP: Record<StoryTickLevel, number> = {
  day: 1 / DAYS_PER_YEAR,
  week: 7 / DAYS_PER_YEAR,
  month: 1 / 12,
  year: 1,
  fiveYears: 5
};
/** From finest to coarsest, as a coarser tick at the same place wins. */
const TICK_LEVELS: readonly StoryTickLevel[] = ['day', 'week', 'month', 'year', 'fiveYears'];

/**
 * Which labels the axis carries at which span of years, in fades over log span that do not overlap,
 * so two levels never share the row. Within a level, a label stands on every `every[0]` ticks while
 * they have the room, then only on every `every[1]`, and so on: each divides the next, so what is
 * kept is evenly spaced at any zoom and thins without jumps.
 */
const TICK_LABELS: readonly {
  name: string;
  step: number;
  every: readonly number[];
  from?: readonly [number, number];
  to?: readonly [number, number];
}[] = [
  {name: 'Day', step: 1 / DAYS_PER_YEAR, every: [1, 7], to: [0.033, 0.046]},
  {name: 'Week', step: 7 / DAYS_PER_YEAR, every: [1, 2, 4], from: [0.05, 0.065], to: [0.22, 0.3]},
  {name: 'Month', step: 1 / 12, every: [1, 3, 6], from: [0.33, 0.42], to: [2.6, 3.2]},
  {name: 'Year', step: 1, every: [1, 5, 10], from: [3.4, 4.2]}
];

/** A label needs this much of the next label's distance beyond its own width before it fades in. */
const LABEL_FADE_ROOM = 1.3;

/** How far through its appearance a new flag lifts its neighbours, and then shows its own label. */
const FLAG_LIFT_UNTIL = 0.45;

/**
 * The readout face's tallest ascenders and deepest descenders, in its size, which its drum's window
 * holds whole, and the season face's capitals, which the window stops short of.
 */
const READOUT_ASCENT = 0.76;
const READOUT_DESCENT = 0.26;
const SEASON_CAP = 0.74;
/**
 * The readout's drum, in the readout's size: its radius, and the fade at its window's edges. Its
 * lines stand a sixth of a turn apart, so the one going has turned wholly out of the window as the
 * one coming arrives, and mid-roll the window shows the foot of one over the head of the other.
 */
const READOUT_DRUM = 1.25;
const READOUT_FEATHER = 0.16;
const READOUT_TURN = Math.PI / 3;
/**
 * How far into its roll the window takes to soften its edges, and how far before the end it hardens
 * them again: the line in place then shows whole, descenders and all, as the drum starts and stops.
 * Meanwhile the other line is out of the window and the one in place has not reached its edges.
 */
const READOUT_SOFTEN = [0.1, 0.03] as const;

function getFont(
  family: string,
  weight: number,
  size: number,
  tracking = 0,
  italic = false
): OverlayFont {
  return {family, weight, size, tracking, italic};
}

/**
 * The readout's drum for a readout and season at these baselines: its window, from over the
 * ascenders of the line in place to just over the season's capitals, the fade at its edges and its
 * radius.
 */
function getReadoutDrum(
  readoutY: number,
  subReadoutY: number,
  fonts: OverlayMetrics['fonts'],
  unit: number
): Pick<
  OverlayMetrics,
  'readoutWindowTop' | 'readoutWindowBottom' | 'readoutFeather' | 'readoutDrum'
> {
  const {size} = fonts.readout;
  const feather = size * READOUT_FEATHER;
  const seasonTop = subReadoutY - fonts.subReadout.size * SEASON_CAP;
  return {
    readoutWindowTop: readoutY - size * READOUT_ASCENT - feather,
    readoutWindowBottom: Math.min(
      readoutY + size * READOUT_DESCENT + feather,
      seasonTop - unit / 2
    ),
    readoutFeather: feather,
    readoutDrum: size * READOUT_DRUM
  };
}

/** The plan of the overlay for a frame of this many device pixels. */
export function getOverlayMetrics(width: number, height: number): OverlayMetrics {
  const isPortrait = width / height < PORTRAIT_BELOW;
  const unit = (isPortrait ? width : height) / DESIGN_SIZE;
  const px = (value: number) => value * unit;

  const lineWidth = Math.max(1, Math.round(px(1)));
  const fonts = isPortrait
    ? {
        readout: getFont(SERIF, 400, px(84)),
        subReadout: getFont(SANS, 500, px(23), px(4.2)),
        // Sized to the axis, which stops short of the apps' buttons.
        flag: getFont(SANS, 500, px(21), px(0.3)),
        tick: getFont(SANS, 500, px(20), px(0.4)),
        number: getFont(SERIF, 400, px(50)),
        numberLabel: getFont(SANS, 500, px(17), px(2.6)),
        caption: getFont(SERIF, 400, px(40), 0, true)
      }
    : {
        readout: getFont(SERIF, 400, px(60)),
        subReadout: getFont(SANS, 500, px(14.5), px(2.8)),
        flag: getFont(SANS, 500, px(14.5), px(0.2)),
        tick: getFont(SANS, 500, px(12.5), px(0.3)),
        number: getFont(SERIF, 400, px(36)),
        numberLabel: getFont(SANS, 500, px(10.5), px(1.8)),
        caption: getFont(SERIF, 400, px(27), 0, true)
      };

  const tickHeight: Record<StoryTickLevel, number> = isPortrait
    ? {day: px(9), week: px(9), month: px(11), year: px(14), fiveYears: px(20)}
    : {day: px(6), week: px(6), month: px(7), year: px(9), fiveYears: px(13)};

  if (isPortrait) {
    const margin = px(PORTRAIT_SAFE_AREA.left);
    const right = width - px(PORTRAIT_SAFE_AREA.right);
    // The season's baseline, 194 below the axis, lands just inside the bottom of the clear area.
    const axisY = Math.round(height - px(PORTRAIT_SAFE_AREA.bottom + 200));
    const barHeight = px(66);
    const flagRow = px(31);
    const flagBaseline = Math.round(axisY - barHeight - px(16));
    // Just below the apps' headers, over the sky, where it covers none of the subject.
    const captionY = Math.round(px(PORTRAIT_SAFE_AREA.top + 46));
    // Midway from the tops of the caption's ascenders to the feet of its descenders.
    const captionScrimY = Math.round(captionY - px(10));
    const captionScrimReach = px(112);
    const readoutY = Math.round(axisY + px(150));
    const subReadoutY = Math.round(axisY + px(194));
    return {
      width,
      height,
      isPortrait,
      unit,
      axisLeft: margin,
      axisRight: right,
      axisY,
      ribbonHeight: Math.max(2, Math.round(px(4))),
      lineWidth,
      barHeight,
      tickHeight,
      tickLabelY: Math.round(axisY + px(52)),
      tickLabelLeft: margin,
      tickLabelRight: right,
      flagBaseline,
      flagRow,
      flagMostRow: 6,
      flagGap: px(9),
      flagClear: px(10),
      flagLift: px(90),
      // What starts at the axis's left end passes it, fading, by no more than this: short of the
      // frame's edge.
      edgeFade: px(40),
      joinGap: px(20),
      readoutX: margin,
      readoutY,
      subReadoutY,
      ...getReadoutDrum(readoutY, subReadoutY, fonts, unit),
      yieldRight: right,
      yieldColumn: px(170),
      yieldY: Math.round(axisY + px(150)),
      yieldLabelY: Math.round(axisY + px(194)),
      captionX: margin,
      captionY,
      captionScrimY,
      captionScrimReach,
      captionScrimBottom: Math.round(captionScrimY + captionScrimReach),
      captionScrimStrength: 0.26,
      // A band behind the bars, axis, readout and yields, with long soft edges. The ground below,
      // where a grower looks for the landing, the basin, the water and fallen fruit, keeps its
      // light, and the flags over it hold by their own shades.
      scrimTop: axisY - px(200),
      scrimFull: axisY - px(40),
      scrimHold: axisY + px(210),
      scrimFall: axisY + px(355),
      scrimStrength: 0.4,
      scrimTailStrength: 0.14,
      fonts
    };
  }

  const margin = px(64);
  const axisY = Math.round(height - px(86));
  const barHeight = px(44);
  const flagRow = px(19.5);
  const flagBaseline = Math.round(axisY - barHeight - px(10));
  const readoutY = Math.round(axisY + px(8));
  const subReadoutY = Math.round(axisY + px(38));
  return {
    width,
    height,
    isPortrait,
    unit,
    axisLeft: margin + px(300),
    axisRight: width - margin - px(236),
    axisY,
    ribbonHeight: Math.max(2, Math.round(px(3))),
    lineWidth,
    barHeight,
    tickHeight,
    tickLabelY: Math.round(axisY + px(31)),
    tickLabelLeft: margin + px(240),
    tickLabelRight: width - margin - px(180),
    flagBaseline,
    flagRow,
    flagMostRow: 6,
    flagGap: px(6),
    flagClear: px(7),
    flagLift: px(60),
    edgeFade: px(40),
    joinGap: px(12.5),
    readoutX: margin,
    readoutY,
    subReadoutY,
    ...getReadoutDrum(readoutY, subReadoutY, fonts, unit),
    yieldRight: width - margin,
    yieldColumn: px(116),
    yieldY: Math.round(axisY + px(8)),
    yieldLabelY: Math.round(axisY + px(30)),
    captionX: margin,
    captionY: Math.round(axisY - px(62)),
    captionScrimY: 0,
    captionScrimReach: 0,
    captionScrimBottom: 0,
    captionScrimStrength: 0,
    // Lying down, all of the overlay is in the bottom few lines of the frame, and the scrim is held
    // from under the axis to the frame's bottom.
    scrimTop: axisY - px(250),
    scrimFull: axisY + px(50),
    scrimHold: height,
    scrimFall: height + px(100),
    scrimStrength: 0.56,
    scrimTailStrength: 0.56,
    fonts
  };
}

/** How dark the overlay's scrim is at `y`, from 0 to its strength. */
export function getScrimAlpha(y: number, metrics: OverlayMetrics): number {
  const {scrimTop, scrimFull, scrimHold, scrimFall, scrimStrength, scrimTailStrength} = metrics;
  const tail = smoothstep(scrimHold, scrimFall, y);
  return smoothstep(scrimTop, scrimFull, y) * lerp(scrimStrength, scrimTailStrength, tail);
}

/**
 * Below this opacity a mark is left out of a layout, and a piece of the ribbon narrower than this
 * many pixels: one only just starting, as the Day 0 axis's is just after the swap.
 */
const UNSEEN = 0.002;
const UNSEEN_WIDTH = 0.02;

/** Where a chart is drawn: `offset` pixels along the axis from its place, at `alpha`. */
type ChartPlace = {offset: number; alpha: number};

const IN_PLACE: ChartPlace = {offset: 0, alpha: 1};

/** A tick label before the edges of the axis fade it: its centre, half its width, its opacity. */
type TickLabelPlace = {x: number; text: string; half: number; alpha: number};

/** Where a year of a chart falls on the axis, the chart in its place. */
function getYearX(year: number, chart: StoryTimelineChart, metrics: OverlayMetrics): number {
  const fraction = (year - chart.spanStart) / (chart.spanEnd - chart.spanStart);
  return lerp(metrics.axisLeft, metrics.axisRight, fraction);
}

/**
 * How much of a mark from `left` to `right` still shows on a chart slid along the axis. A chart slid
 * left of its place fades out over `edgeFade` inside `windowLeft`, the way it leaves, and one slid
 * right of it fades in over `edgeFade` inside `windowRight`, the way it comes, so neither passes the
 * ends. Within `edgeFade` of its place the fade comes in only as far as the chart has moved: a chart
 * in its place is left exactly as it is, and a mark at rest at an end fades as it leaves, never
 * jumps.
 */
function getEdgeAlpha(
  left: number,
  right: number,
  windowLeft: number,
  windowRight: number,
  metrics: OverlayMetrics,
  place: ChartPlace
): number {
  const {offset} = place;
  if (offset === 0) return 1;
  const fade = metrics.edgeFade;
  const shown =
    offset < 0
      ? smoothstep(windowLeft, windowLeft + fade, left)
      : 1 - smoothstep(windowRight - fade, windowRight, right);
  return 1 - smoothstep(0, fade, Math.abs(offset)) * (1 - shown);
}

/** Every tick in view, with what a coarser tick at the same place makes of a finer one. */
function layOutTicks(
  chart: StoryTimelineChart,
  metrics: OverlayMetrics,
  place: ChartPlace
): OverlayTick[] {
  const ticks = new Map<number, OverlayTick>();
  for (const level of TICK_LEVELS) {
    const alpha = chart.tickAlpha[level];
    if (alpha > UNSEEN) {
      const step = TICK_STEP[level];
      const first = Math.ceil(chart.spanStart / step - 1e-6);
      const last = Math.floor(chart.spanEnd / step + 1e-6);
      for (let index = first; index <= last; index++) {
        const year = index * step;
        const key = Math.round(year * 1e6);
        const known = ticks.get(key);
        if (known) {
          known.height = lerp(known.height, metrics.tickHeight[level], alpha);
          known.alpha = Math.max(known.alpha, alpha);
        } else {
          ticks.set(key, {
            x: getYearX(year, chart, metrics) + place.offset,
            height: metrics.tickHeight[level],
            alpha
          });
        }
      }
    }
  }
  const placed: OverlayTick[] = [];
  for (const tick of ticks.values()) {
    const {axisLeft, axisRight} = metrics;
    const edge = getEdgeAlpha(tick.x, tick.x, axisLeft, axisRight, metrics, place);
    const alpha = tick.alpha * place.alpha * edge;
    if (alpha > UNSEEN) placed.push({...tick, alpha});
  }
  return placed;
}

/** A chart's tick labels where they stand, before the edges of the axis fade them. */
function placeTickLabels(
  chart: StoryTimelineChart,
  metrics: OverlayMetrics,
  measure: MeasureText,
  place: ChartPlace
): TickLabelPlace[] {
  const labels: TickLabelPlace[] = [];
  const {tickLabelLeft, tickLabelRight} = metrics;
  const span = chart.spanEnd - chart.spanStart;
  const logSpan = Math.log(span);
  const pixelsPerYear = (metrics.axisRight - metrics.axisLeft) / span;
  // Labels keep inside the chart's own ends, which slide with it.
  const left = tickLabelLeft + place.offset;
  const right = tickLabelRight + place.offset;
  for (const {name, step, every, from, to} of TICK_LABELS) {
    const shown = from ? smoothstep(Math.log(from[0]), Math.log(from[1]), logSpan) : 1;
    const hidden = to ? smoothstep(Math.log(to[0]), Math.log(to[1]), logSpan) : 0;
    const alpha = shown * (1 - hidden) * place.alpha;
    if (alpha > UNSEEN) {
      const first = Math.ceil(chart.spanStart / step - 1e-6);
      const last = Math.floor(chart.spanEnd / step + 1e-6);
      // Wide enough for any label on this axis, and half of one more, as the one at the end may
      // move in.
      const widest = measure(`${name} ${last}`, metrics.fonts.tick);
      const room = 1.5 * widest + metrics.fonts.tick.size;
      for (let index = first; index <= last; index++) {
        const text = `${name} ${index}`;
        let fit = 0;
        for (const multiple of every) {
          if (index % multiple === 0) {
            fit = Math.max(
              fit,
              smoothstep(room, room * LABEL_FADE_ROOM, multiple * step * pixelsPerYear)
            );
          }
        }
        if (fit * alpha > UNSEEN) {
          const half = measure(text, metrics.fonts.tick) / 2;
          const x = clamp(
            getYearX(index * step, chart, metrics) + place.offset,
            left + half,
            right - half
          );
          labels.push({x, text, half, alpha: fit * alpha});
        }
      }
    }
  }
  return labels;
}

/**
 * The labels at the join, the last of the chart sliding out and the first of the one coming in,
 * part where they would come closer than `joinGap`, each moving by the other's share of their
 * opacity: a label only just showing gives way, and neither jumps. A chart's labels come in order
 * along the axis, as only one level of them shows at a time.
 */
function partTickLabels(before: TickLabelPlace[], after: TickLabelPlace[], gap: number): void {
  const a = before[before.length - 1];
  const b = after[0];
  const total = a && b ? a.alpha + b.alpha : 0;
  const short = total > 0 ? a.x + a.half + gap - (b.x - b.half) : 0;
  if (short > 0) {
    a.x -= (short * b.alpha) / total;
    b.x += (short * a.alpha) / total;
  }
}

/** Tick labels as the edges of the axis leave them, without those that cannot be seen. */
function fadeTickLabels(
  labels: TickLabelPlace[],
  metrics: OverlayMetrics,
  place: ChartPlace
): OverlayTickLabel[] {
  const faded: OverlayTickLabel[] = [];
  for (const {x, text, half, alpha} of labels) {
    const {tickLabelLeft, tickLabelRight} = metrics;
    const edge = getEdgeAlpha(x - half, x + half, tickLabelLeft, tickLabelRight, metrics, place);
    if (alpha * edge > UNSEEN) faded.push({x, text, alpha: alpha * edge});
  }
  return faded;
}

/** The seasons from the start of the axis to the playhead, each a fine piece of color. */
function layOutRibbon(
  chart: StoryTimelineChart,
  metrics: OverlayMetrics,
  place: ChartPlace
): OverlayRibbonPiece[] {
  const pieces: OverlayRibbonPiece[] = [];
  const lastYear = Math.min(chart.playhead, chart.spanEnd);
  const firstSeason = Math.floor(chart.spanStart * 4);
  const lastSeason = Math.floor(lastYear * 4);
  for (let season = firstSeason; season <= lastSeason; season++) {
    const from = Math.max(season / 4, chart.spanStart);
    const to = Math.min((season + 1) / 4, lastYear);
    if (to > from) {
      const left = getYearX(from, chart, metrics) + place.offset;
      const right = getYearX(to, chart, metrics) + place.offset;
      const {axisLeft, axisRight} = metrics;
      const alpha = place.alpha * getEdgeAlpha(left, right, axisLeft, axisRight, metrics, place);
      if (alpha > UNSEEN && right - left > UNSEEN_WIDTH) {
        pieces.push({left, right, color: SEASON_COLORS[((season % 4) + 4) % 4], alpha});
      }
    }
  }
  return pieces;
}

function layOutBars(
  chart: StoryTimelineChart,
  metrics: OverlayMetrics,
  place: ChartPlace
): OverlayBar[] {
  const span = chart.spanEnd - chart.spanStart;
  const pixelsPerYear = (metrics.axisRight - metrics.axisLeft) / span;
  const width = clamp(pixelsPerYear * 0.46, 2 * metrics.unit, BAR_MOST_WIDTH * metrics.unit);
  const pixelsPerBox = metrics.barHeight / BAR_SCALE_BOXES;
  const bars: OverlayBar[] = [];
  chart.bars.forEach((bar, index) => {
    // What the year before it bore is what a storm's year would have.
    const before = index > 0 ? chart.bars[index - 1].boxes : bar.boxes;
    const x = getYearX(bar.year, chart, metrics) + place.offset;
    const edge = getEdgeAlpha(x, x, metrics.axisLeft, metrics.axisRight, metrics, place);
    const alpha = smoothstep(0, 0.18, bar.rise) * place.alpha * edge;
    if (alpha > UNSEEN) {
      bars.push({
        x,
        width,
        height: bar.boxes * bar.rise * pixelsPerBox,
        alpha,
        lostHeight: bar.broken ? Math.max(before - bar.boxes, 0) * bar.rise * pixelsPerBox : 0
      });
    }
  });
  return bars;
}

/**
 * Flags, from the latest back. A label that reaches the pole of a flag to its right stands one row
 * above it, so labels never touch and a pole never strikes through a label. It starts rising
 * `flagLift` before it gets there and arrives in time, and a new flag holds back its own label
 * until its neighbours have made room, so nothing jumps. So: wherever two labels share any width,
 * they are a whole row apart. A chart slid along the axis keeps its rows, and a flag fades as a
 * whole, pole and label, as it slides past an end.
 */
function layOutFlags(
  chart: StoryTimelineChart,
  metrics: OverlayMetrics,
  measure: MeasureText,
  place: ChartPlace
): OverlayFlag[] {
  const {flagGap, flagClear, flagLift, flagRow, flagBaseline, flagMostRow, axisY} = metrics;
  const font = metrics.fonts.flag;
  const capHeight = font.size * 0.74;
  const right = metrics.axisRight + place.offset;
  const sorted = chart.flags
    .map(flag => ({flag, x: getYearX(flag.year, chart, metrics) + place.offset}))
    .sort((a, b) => b.x - a.x);
  const placed: {
    blockLeft: number;
    row: number;
    lift: number;
  }[] = [];
  const flags: OverlayFlag[] = [];
  for (const {flag, x} of sorted) {
    const textWidth = measure(flag.label, font);
    const textX = Math.min(x + flagGap, right - textWidth);
    const textRight = textX + textWidth;
    let row = 0;
    for (const other of placed) {
      const distance = other.blockLeft - textRight;
      const reach = 1 - smoothstep(flagClear, flagClear + flagLift, distance);
      row = Math.max(row, (other.row + 1) * reach * other.lift);
    }
    const kept = 1 - smoothstep(flagMostRow + 0.1, flagMostRow + 0.6, row);
    const presence = clamp01(flag.alpha);
    const blockLeft = Math.min(x, textX);
    placed.push({blockLeft, row, lift: smoothstep(0, FLAG_LIFT_UNTIL, presence) * kept});
    const rise = smoothstep(0, FLAG_LIFT_UNTIL, presence);
    const textY = flagBaseline - row * flagRow;
    const {axisLeft, axisRight} = metrics;
    const blockRight = Math.max(x, textRight);
    const shown =
      place.alpha * getEdgeAlpha(blockLeft, blockRight, axisLeft, axisRight, metrics, place);
    const poleAlpha = presence * shown;
    const textAlpha = smoothstep(FLAG_LIFT_UNTIL, 1, presence) * kept * shown;
    if (poleAlpha > UNSEEN || textAlpha > UNSEEN) {
      flags.push({
        id: flag.id,
        label: flag.label,
        x,
        poleTop: lerp(axisY, textY - capHeight, rise * kept),
        poleAlpha,
        textX,
        textY,
        textWidth,
        textAlpha,
        row
      });
    }
  }
  return flags;
}

function formatBoxes(boxes: number): string {
  return boxes >= 100 ? boxes.toFixed(0) : boxes.toFixed(1);
}

/** The yield numbers of a chart at `alpha`, or `null` before its first harvest. */
function layOutYield(chart: StoryTimelineChart, alpha: number): OverlayLayout['yield'] {
  if (!chart.yield || chart.bars.length === 0) return null;
  const shown = smoothstep(0, 0.5, chart.bars[0].rise) * alpha;
  return shown > UNSEEN
    ? {
        thisYear: formatBoxes(chart.yield.thisYear),
        total: formatBoxes(chart.yield.total),
        alpha: shown
      }
    : null;
}

/**
 * The readout, which turns over like an odometer's drum through the roll-over, in a window a line
 * tall: the Year 30 chart's line rolls up and out of the top of the window as the Day 0 axis's
 * rolls up from under it into place, a sixth of a turn apart. Each line's letters shorten and darken
 * as the drum turns them away, and what turns through the window's edges fades, so no letter is
 * ever cut hard. The window softens its edges only once the drum has started and hardens them
 * before it stops, while the other line is out of it, so the line in place shows whole.
 */
function layOutReadout(
  timeline: StoryTimeline,
  metrics: OverlayMetrics
): Pick<OverlayLayout, 'readout' | 'readoutWindow' | 'subReadout'> {
  const {rollover} = timeline;
  const roll = rollover ? clamp01(rollover.roll) : 0;
  const settled = rollover ? (roll < 0.5 ? rollover.previous : rollover.next) : timeline;
  const subReadout = settled.subReadout.toUpperCase();
  if (!rollover || roll <= 0 || roll >= 1) {
    return {
      readout: [{text: settled.readout, y: metrics.readoutY, alpha: 1, scale: 1}],
      readoutWindow: null,
      subReadout
    };
  }
  const {size} = metrics.fonts.readout;
  const {readoutY, readoutDrum, readoutWindowTop: top, readoutWindowBottom: bottom} = metrics;
  // A line's letters, from the top of its ascenders to the foot of its descenders, about their
  // middle, which is where its baseline is from. The drum turns about the middle of the line in
  // place.
  const half = ((READOUT_ASCENT + READOUT_DESCENT) * size) / 2;
  const toBaseline = ((READOUT_ASCENT - READOUT_DESCENT) * size) / 2;
  const axis = readoutY - toBaseline;
  const readout: OverlayReadoutLine[] = [];
  for (const [text, turn] of [
    [rollover.previous.readout, roll],
    [rollover.next.readout, roll - 1]
  ] as const) {
    const angle = turn * READOUT_TURN;
    const facing = Math.cos(angle);
    const middle = axis - readoutDrum * Math.sin(angle);
    if (middle - half * facing < bottom && middle + half * facing > top) {
      readout.push({text, y: middle + toBaseline * facing, alpha: facing, scale: facing});
    }
  }
  const [softening, hardening] = READOUT_SOFTEN;
  const soften = smoothstep(0, softening, roll) * (1 - smoothstep(1 - hardening, 1, roll));
  return {
    readout,
    readoutWindow: {top, bottom, feather: metrics.readoutFeather * soften},
    subReadout
  };
}

/**
 * The whole overlay for one frame. Through the roll-over it lays out both of its charts, the Year
 * 30 chart slid left by `slide` of the axis and the Day 0 axis joined to its right end, with the
 * playhead on the Day 0 axis, so at the join until the swap.
 */
export function layOutTimelineOverlay(
  timeline: StoryTimeline,
  caption: StoryCaption,
  metrics: OverlayMetrics,
  measure: MeasureText
): OverlayLayout {
  const {rollover} = timeline;
  const axisWidth = metrics.axisRight - metrics.axisLeft;
  const charts: {chart: StoryTimelineChart; place: ChartPlace}[] = rollover
    ? [
        {
          chart: rollover.previous,
          place: {offset: -rollover.slide * axisWidth, alpha: clamp01(rollover.previousAlpha)}
        },
        {
          chart: rollover.next,
          place: {offset: (1 - rollover.slide) * axisWidth, alpha: clamp01(rollover.nextAlpha)}
        }
      ]
    : [{chart: timeline, place: IN_PLACE}];
  const layout: OverlayLayout = {
    metrics,
    alpha: clamp01(timeline.alpha),
    playheadX: 0,
    charts: charts.map(({place}) => ({offset: place.offset, alpha: place.alpha})),
    ribbon: [],
    ticks: [],
    tickLabels: [],
    bars: [],
    flags: [],
    ...layOutReadout(timeline, metrics),
    yield: rollover
      ? layOutYield(rollover.previous, clamp01(rollover.yieldAlpha))
      : layOutYield(timeline, 1),
    caption: caption && caption.alpha > 0 ? {text: caption.text, alpha: caption.alpha} : null
  };
  const tickLabels = charts.map(({chart, place}) =>
    place.alpha > UNSEEN ? placeTickLabels(chart, metrics, measure, place) : []
  );
  if (tickLabels.length === 2) partTickLabels(tickLabels[0], tickLabels[1], metrics.joinGap);
  charts.forEach(({chart, place}, index) => {
    if (place.alpha > UNSEEN) {
      layout.ribbon.push(...layOutRibbon(chart, metrics, place));
      layout.ticks.push(...layOutTicks(chart, metrics, place));
      layout.tickLabels.push(...fadeTickLabels(tickLabels[index], metrics, place));
      layout.bars.push(...layOutBars(chart, metrics, place));
      layout.flags.push(...layOutFlags(chart, metrics, measure, place));
    }
  });
  // The playhead is on the last chart, the newest.
  const {chart, place} = charts[charts.length - 1];
  layout.playheadX =
    getYearX(Math.min(chart.playhead, chart.spanEnd), chart, metrics) + place.offset;
  return layout;
}

/** The label of each flag that can be seen, as a box around its letters. */
export function getFlagBoxes(layout: OverlayLayout): OverlayBox[] {
  const {size} = layout.metrics.fonts.flag;
  return layout.flags
    .filter(flag => flag.textAlpha > 0)
    .map(flag => ({
      id: flag.id,
      left: flag.textX,
      right: flag.textX + flag.textWidth,
      top: flag.textY - size * 0.8,
      bottom: flag.textY + size * 0.25
    }));
}

/** Pairs of flag labels that overlap, as `a+b`, which must always come back empty. */
export function findFlagOverlaps(layout: OverlayLayout): string[] {
  const boxes = getFlagBoxes(layout);
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        overlaps.push(`${a.id}+${b.id}`);
      }
    }
  }
  return overlaps;
}

/** Poles that strike through a label other than their own, as `pole/label`. Also always empty. */
export function findPoleCrossings(layout: OverlayLayout): string[] {
  const boxes = getFlagBoxes(layout);
  const crossings: string[] = [];
  for (const flag of layout.flags) {
    if (flag.poleAlpha > 0) {
      for (const box of boxes) {
        if (
          box.id !== flag.id &&
          flag.x > box.left &&
          flag.x < box.right &&
          flag.poleTop < box.bottom
        ) {
          crossings.push(`${flag.id}/${box.id}`);
        }
      }
    }
  }
  return crossings;
}

// Painting. Nothing below decides where anything goes.

function getFontString({family, weight, size, italic}: OverlayFont): string {
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`;
}

function setFont(context: CanvasRenderingContext2D, font: OverlayFont): void {
  context.font = getFontString(font);
  context.letterSpacing = `${font.tracking}px`;
}

/** Measures text on a context, remembering it, as most of the overlay's text repeats. */
export function createCanvasMeasure(context: CanvasRenderingContext2D): MeasureText {
  const known = new Map<string, number>();
  return (text, font) => {
    const {family, weight, size, tracking, italic} = font;
    const key = `${family}|${weight}|${size}|${tracking}|${italic}|${text}`;
    let width = known.get(key);
    if (width === undefined) {
      setFont(context, font);
      width = context.measureText(text).width;
      known.set(key, width);
    }
    return width;
  };
}

function getInk(alpha: number): string {
  return `rgba(${INK}, ${alpha})`;
}

function setInk(context: CanvasRenderingContext2D, alpha: number): void {
  context.fillStyle = getInk(alpha);
}

/** A soft dark shade cast behind a mark, as a canvas shadow, in design pixels. */
type Shade = {blur: number; alpha: number; offsetY: number};

const SHADE = '4, 6, 8';
/**
 * Behind type that sits on the picture, so it holds on bright sand or cloud as well as on the
 * scrim: a wide soft shade, then a close one that edges the letters. Small type takes tighter and
 * darker ones, as its thin strokes cast little, and the caption, on the sky, the widest.
 */
const LARGE_TYPE_SHADES: readonly Shade[] = [
  {blur: 22, alpha: 0.42, offsetY: 0},
  {blur: 3, alpha: 0.45, offsetY: 1}
];
const SMALL_TYPE_SHADES: readonly Shade[] = [
  {blur: 8, alpha: 0.55, offsetY: 0},
  {blur: 3.5, alpha: 0.55, offsetY: 0},
  {blur: 1.4, alpha: 0.55, offsetY: 0.5}
];
const CAPTION_SHADES: readonly Shade[] = [
  {blur: 30, alpha: 0.5, offsetY: 0},
  {blur: 10, alpha: 0.6, offsetY: 0},
  {blur: 3, alpha: 0.5, offsetY: 1}
];
/** Behind the flags' poles, which reach over the picture above the scrim. */
const POLE_SHADE: Shade = {blur: 3, alpha: 0.5, offsetY: 0};

/** Casts `shade` from what is drawn next, `castX` pixels to the right of it. */
function setShade(context: CanvasRenderingContext2D, shade: Shade, unit: number, castX = 0): void {
  context.shadowColor = `rgba(${SHADE}, ${shade.alpha})`;
  context.shadowBlur = shade.blur * unit;
  context.shadowOffsetX = castX;
  context.shadowOffsetY = shade.offsetY * unit;
}

function clearShade(context: CanvasRenderingContext2D): void {
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
}

/**
 * Fills text in the context's fill over its shades. Every shade but the last is cast alone, from
 * the text filled far off the canvas, and the last is cast with the text itself. A shade fades with
 * the fill, so type fading out takes its shade with it, unless the shades cast alone are given a
 * fill of their own, `shadeFill`, to fade ahead of the text.
 */
function fillShadedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  shades: readonly Shade[],
  unit: number,
  shadeFill?: string
): void {
  // Shadows are offset in the canvas's pixels whatever the transform, and only ever squashed here,
  // so this is off the canvas in both.
  const away = 2 * (context.canvas.width + context.canvas.height);
  const fill = context.fillStyle;
  shades.forEach((shade, index) => {
    const alone = index < shades.length - 1;
    context.fillStyle = alone && shadeFill ? shadeFill : fill;
    setShade(context, shade, unit, alone ? away : 0);
    context.fillText(text, alone ? x - away : x, y);
  });
  clearShade(context);
}

/** Stops along each of the scrim's eases, as a straight ramp shows where it starts. */
const SCRIM_STEPS = 12;

/** The overlay's scrim, as `getScrimAlpha` has it, from its top to the bottom of the frame. */
function drawScrim(
  context: CanvasRenderingContext2D,
  metrics: OverlayMetrics,
  strength: number
): void {
  const {scrimTop, scrimFull, scrimHold, scrimFall, width, height} = metrics;
  const ys = new Set([height]);
  for (let step = 0; step <= SCRIM_STEPS; step++) {
    ys.add(lerp(scrimTop, scrimFull, step / SCRIM_STEPS));
    ys.add(lerp(scrimHold, scrimFall, step / SCRIM_STEPS));
  }
  const gradient = context.createLinearGradient(0, scrimTop, 0, height);
  for (const y of [...ys].sort((a, b) => a - b)) {
    if (y >= scrimTop && y <= height) {
      const alpha = getScrimAlpha(y, metrics) * strength;
      gradient.addColorStop((y - scrimTop) / (height - scrimTop), `rgba(${SCRIM}, ${alpha})`);
    }
  }
  context.fillStyle = gradient;
  context.fillRect(0, scrimTop, width, height - scrimTop);
}

/**
 * A caption's own scrim: `strength` dark along its line from `left` to `right` at `y`, and fading
 * out over `reach` all round it, so only the picture right behind the words darkens.
 */
function drawCaptionScrim(
  context: CanvasRenderingContext2D,
  [left, right]: [number, number],
  y: number,
  reach: number,
  strength: number
): void {
  // Whole pixels, so the middle and the rounded ends meet without a seam.
  const [from, to] = [Math.round(left), Math.round(right)];
  const middle = context.createLinearGradient(0, y - reach, 0, y + reach);
  const ends = [from, to].map(x => context.createRadialGradient(x, y, 0, x, y, reach));
  for (let step = 0; step <= SCRIM_STEPS; step++) {
    // `u` of the way out from the line.
    const u = step / SCRIM_STEPS;
    const color = `rgba(${SCRIM}, ${(1 - u * u * (3 - 2 * u)) * strength})`;
    middle.addColorStop(0.5 - u / 2, color);
    middle.addColorStop(0.5 + u / 2, color);
    for (const end of ends) end.addColorStop(u, color);
  }
  const top = y - reach;
  context.fillStyle = middle;
  context.fillRect(from, top, to - from, 2 * reach);
  context.fillStyle = ends[0];
  context.fillRect(from - reach, top, reach, 2 * reach);
  context.fillStyle = ends[1];
  context.fillRect(to, top, reach, 2 * reach);
}

/**
 * The axis's line, which stays put while charts slide along it in the roll-over, then each chart's
 * seasons and ticks.
 */
function drawAxis(context: CanvasRenderingContext2D, layout: OverlayLayout): void {
  const {metrics, ribbon, ticks} = layout;
  const {axisLeft, axisRight, axisY, lineWidth, ribbonHeight} = metrics;
  setInk(context, 0.5);
  context.fillRect(axisLeft, axisY, axisRight - axisLeft, lineWidth);
  const ribbonTop = axisY - ribbonHeight + lineWidth;
  for (const {left, right, color, alpha} of ribbon) {
    context.globalAlpha = layout.alpha * alpha;
    context.fillStyle = color;
    context.fillRect(left, ribbonTop, right - left, ribbonHeight);
  }
  context.globalAlpha = layout.alpha;
  for (const {x, height, alpha} of ticks) {
    setInk(context, 0.62 * alpha);
    context.fillRect(x - lineWidth / 2, axisY + lineWidth, lineWidth, height);
  }
}

function drawTickLabels(context: CanvasRenderingContext2D, layout: OverlayLayout): void {
  const {metrics, tickLabels} = layout;
  setFont(context, metrics.fonts.tick);
  context.textAlign = 'center';
  for (const {x, text, alpha} of tickLabels) {
    setInk(context, 0.72 * alpha);
    fillShadedText(context, text, x, metrics.tickLabelY, SMALL_TYPE_SHADES, metrics.unit);
  }
  context.textAlign = 'left';
}

function drawBars(context: CanvasRenderingContext2D, layout: OverlayLayout): void {
  const {axisY, unit, lineWidth} = layout.metrics;
  const ribbonTop = axisY - layout.metrics.ribbonHeight + lineWidth;
  for (const {x, width, height, alpha, lostHeight} of layout.bars) {
    const left = x - width / 2;
    if (lostHeight > 0) {
      // Snapped: a stub with a torn top, and what it lost hanging askew above a gap.
      const top = ribbonTop - height;
      const tear = Math.min(2.5 * unit, width / 2);
      const gap = 3.5 * unit;
      const lean = 2.2 * unit;
      setInk(context, 0.92 * alpha);
      context.beginPath();
      context.moveTo(left, ribbonTop);
      context.lineTo(left, top + tear);
      context.lineTo(left + width * 0.42, top - tear);
      context.lineTo(left + width * 0.62, top + tear * 0.4);
      context.lineTo(left + width, top - tear * 0.5);
      context.lineTo(left + width, ribbonTop);
      context.closePath();
      context.fill();
      const lostBottom = top - gap;
      const lostTop = lostBottom - lostHeight;
      context.fillStyle = `rgba(226, 142, 96, ${0.5 * alpha})`;
      context.beginPath();
      context.moveTo(left + lean * 0.5, lostBottom);
      context.lineTo(left + lean, lostTop);
      context.lineTo(left + lean + width, lostTop);
      context.lineTo(left + lean * 0.5 + width, lostBottom - tear);
      context.lineTo(left + lean * 0.5 + width * 0.6, lostBottom + tear * 0.3);
      context.lineTo(left + lean * 0.5 + width * 0.35, lostBottom - tear);
      context.closePath();
      context.fill();
    } else {
      setInk(context, 0.82 * alpha);
      context.fillRect(left, ribbonTop - height, width, height);
    }
  }
}

function drawFlags(context: CanvasRenderingContext2D, layout: OverlayLayout): void {
  const {metrics, flags} = layout;
  const {axisY, lineWidth, unit} = metrics;
  setShade(context, POLE_SHADE, unit);
  for (const {x, poleTop, poleAlpha} of flags) {
    setInk(context, 0.5 * poleAlpha);
    context.fillRect(x - lineWidth / 2, poleTop, lineWidth, axisY - poleTop);
  }
  clearShade(context);
  setFont(context, metrics.fonts.flag);
  for (const {label, textX, textY, textAlpha} of flags) {
    if (textAlpha > 0) {
      setInk(context, 0.94 * textAlpha);
      fillShadedText(context, label, textX, textY, SMALL_TYPE_SHADES, unit);
    }
  }
}

function drawPlayhead(context: CanvasRenderingContext2D, layout: OverlayLayout): void {
  const {axisY, unit, lineWidth, tickHeight} = layout.metrics;
  const x = layout.playheadX;
  const reach = tickHeight.fiveYears;
  setInk(context, 0.95);
  context.fillRect(x - lineWidth / 2, axisY - reach, lineWidth, reach * 2 + lineWidth);
  context.beginPath();
  context.arc(x, axisY + lineWidth / 2, 3.6 * unit, 0, Math.PI * 2);
  context.fill();
}

/** Steps of the fade at each edge of the readout's window. */
const FEATHER_STEPS = 6;

/**
 * The ink of a line of the readout: as it is, or seen through the drum's window, which fades what
 * turns through its edges and hides what is beyond them. The line is drawn from its baseline,
 * squashed by its scale, so the window is set in the line's own terms.
 */
function getReadoutInk(
  context: CanvasRenderingContext2D,
  line: OverlayReadoutLine,
  window: OverlayLayout['readoutWindow']
): string | CanvasGradient {
  const alpha = 0.98 * line.alpha;
  if (!window) return getInk(alpha);
  const top = (window.top - line.y) / line.scale;
  const bottom = (window.bottom - line.y) / line.scale;
  const gradient = context.createLinearGradient(0, top, 0, bottom);
  const edge = Math.min(window.feather / (window.bottom - window.top), 0.5);
  // Down the window: in over its top edge, then out over its bottom one.
  for (let step = 0; step <= FEATHER_STEPS; step++) {
    const u = step / FEATHER_STEPS;
    gradient.addColorStop(edge * u, getInk(alpha * u * u * (3 - 2 * u)));
  }
  for (let step = FEATHER_STEPS; step >= 0; step--) {
    const u = step / FEATHER_STEPS;
    gradient.addColorStop(1 - edge * u, getInk(alpha * u * u * (3 - 2 * u)));
  }
  return gradient;
}

function drawReadouts(context: CanvasRenderingContext2D, layout: OverlayLayout): void {
  const {metrics, readoutWindow} = layout;
  const {fonts, unit, yieldRight, yieldColumn} = metrics;
  setFont(context, fonts.readout);
  for (const line of layout.readout) {
    context.save();
    context.translate(metrics.readoutX, line.y);
    context.scale(1, line.scale);
    context.fillStyle = getReadoutInk(context, line, readoutWindow);
    fillShadedText(context, line.text, 0, 0, LARGE_TYPE_SHADES, unit);
    context.restore();
  }
  setFont(context, fonts.subReadout);
  setInk(context, 0.78);
  fillShadedText(
    context,
    layout.subReadout,
    metrics.readoutX,
    metrics.subReadoutY,
    SMALL_TYPE_SHADES,
    unit
  );
  if (layout.yield) {
    const {thisYear, total, alpha} = layout.yield;
    context.textAlign = 'right';
    setFont(context, fonts.number);
    setInk(context, 0.96 * alpha);
    fillShadedText(context, total, yieldRight, metrics.yieldY, LARGE_TYPE_SHADES, unit);
    const thisYearRight = yieldRight - yieldColumn;
    fillShadedText(context, thisYear, thisYearRight, metrics.yieldY, LARGE_TYPE_SHADES, unit);
    setFont(context, fonts.numberLabel);
    setInk(context, 0.74 * alpha);
    const labelY = metrics.yieldLabelY;
    fillShadedText(context, 'BOXES TOTAL', yieldRight, labelY, SMALL_TYPE_SHADES, unit);
    fillShadedText(context, 'THIS YEAR', thisYearRight, labelY, SMALL_TYPE_SHADES, unit);
    context.textAlign = 'left';
  }
}

function drawCaption(context: CanvasRenderingContext2D, layout: OverlayLayout): void {
  if (layout.caption) {
    const {metrics} = layout;
    const {alpha, text} = layout.caption;
    const {captionX, captionY, captionScrimY, captionScrimReach, captionScrimStrength} = metrics;
    // Over a bright sky the caption needs a shade, and its scrim and its own wide shade come ahead
    // of the words and go after them, so the words never fade into the cloud.
    const lead = Math.sqrt(alpha);
    setFont(context, metrics.fonts.caption);
    if (captionScrimStrength > 0) {
      const words: [number, number] = [captionX, captionX + context.measureText(text).width];
      const strength = captionScrimStrength * lead;
      drawCaptionScrim(context, words, captionScrimY, captionScrimReach, strength);
    }
    setInk(context, 0.96 * alpha);
    const shadeFill = getInk(0.96 * lead);
    fillShadedText(context, text, captionX, captionY, CAPTION_SHADES, metrics.unit, shadeFill);
  }
}

/** Paints a layout onto a context with nothing on it. */
export function drawTimelineOverlay(
  context: CanvasRenderingContext2D,
  layout: OverlayLayout
): void {
  const {metrics, alpha} = layout;
  context.clearRect(0, 0, metrics.width, metrics.height);
  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  context.fontKerning = 'normal';
  context.textRendering = 'geometricPrecision';
  if (alpha > 0) {
    drawScrim(context, metrics, alpha);
    context.save();
    context.globalAlpha = alpha;
    drawAxis(context, layout);
    drawBars(context, layout);
    drawTickLabels(context, layout);
    drawFlags(context, layout);
    drawPlayhead(context, layout);
    drawReadouts(context, layout);
    context.restore();
  }
  drawCaption(context, layout);
}
