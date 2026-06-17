// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Viewport} from '@deck.gl/core';

/** Numeric start and end values for one time range. */
export type TimeRange = [start: number, end: number];
type Bounds = [minX: number, minY: number, maxX: number, maxY: number];

/** One major or minor tick on a time axis. */
export type Tick = {
  /** Whether the tick is a labeled major step or an in-between minor step. */
  type: 'major' | 'minor';
  /** Coordinate to display this tick at. */
  x: number;
  /** Timestamp or duration in milliseconds. */
  value: number;
  /** Value rounded down to the nearest perceptual start within the visible range. */
  stepStart: number;
};

/**
 * Returns the visible x range inside explicit bounds.
 * @param startTime - Minimum allowed x value.
 * @param endTime - Maximum allowed x value.
 * @param bounds - Flat viewport bounds as `[minX, minY, maxX, maxY]`.
 * @returns Visible x range clamped to the allowed range.
 */
export function getZoomedRange(startTime: number, endTime: number, bounds: Bounds): TimeRange;
/**
 * Returns the visible x range from a viewport, optionally padded and clamped.
 * @param viewport - Viewport whose bounds should be inspected.
 * @param extentFactor - Visible-range multiplier used to add symmetric padding.
 * @param clampMin - Minimum allowed x value.
 * @param clampMax - Maximum allowed x value.
 * @returns Visible x range or `null` when bounds are unavailable or empty.
 */
export function getZoomedRange(
  viewport: Viewport,
  extentFactor?: number,
  clampMin?: number,
  clampMax?: number
): TimeRange | null;
export function getZoomedRange(
  startTimeOrViewport: number | Viewport,
  endTimeOrExtentFactor: number = 1,
  boundsOrClampMin: Bounds | number = -Infinity,
  clampMax: number = Infinity
): TimeRange | null {
  if (typeof startTimeOrViewport === 'number') {
    const [startTimeZoomed, , endTimeZoomed] = boundsOrClampMin as Bounds;
    return [
      Math.max(startTimeOrViewport, startTimeZoomed),
      Math.min(endTimeOrExtentFactor, endTimeZoomed)
    ];
  }

  const clampMin = boundsOrClampMin as number;
  if (clampMin >= clampMax) {
    return null;
  }

  const bounds = getViewportBounds(startTimeOrViewport);
  if (!bounds) {
    return null;
  }

  let [minX, , maxX] = bounds;
  if (maxX <= minX) {
    return null;
  }

  const extentFactor =
    Number.isFinite(endTimeOrExtentFactor) && endTimeOrExtentFactor > 0 ? endTimeOrExtentFactor : 1;
  const padding = ((maxX - minX) * (extentFactor - 1)) / 2;
  minX -= padding;
  maxX += padding;

  const start = Math.max(clampMin, minX);
  const end = Math.min(clampMax, maxX);
  return end > start ? [start, end] : null;
}

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1000;
const STEP_BREAK_POINTS: number[] = [
  ...[1, 2, 5, 10, 15, 20, 30].map(multiple => multiple * MS_PER_SECOND),
  ...[1, 2, 5, 10, 15, 20, 30].map(multiple => multiple * MS_PER_MINUTE),
  ...[1, 2, 3, 4, 6, 8, 12].map(multiple => multiple * MS_PER_HOUR),
  MS_PER_DAY
];
const MULTIPLES = [1, 2, 5, 10];

/**
 * Returns a human-friendly major tick step for a time span.
 * @param timeSpanMs - Visible time span in milliseconds.
 * @param tickCount - Desired number of major ticks.
 * @returns Rounded major tick step in milliseconds.
 */
export function getTickStep(timeSpanMs: number, tickCount: number): number {
  if (!Number.isFinite(timeSpanMs) || timeSpanMs <= 0) {
    return 1;
  }

  const roughStep = timeSpanMs / Math.max(1, tickCount);
  const base = STEP_BREAK_POINTS.find(point => point >= roughStep) ?? MS_PER_DAY;
  if (base === MS_PER_DAY || base === MS_PER_SECOND) {
    const exponent = Math.floor(Math.log10(roughStep / base));
    const magnitudeBase = Math.pow(10, exponent) * base;
    const multiple = MULTIPLES.find(candidate => candidate * magnitudeBase >= roughStep) ?? 10;
    return multiple * magnitudeBase;
  }
  return base;
}

/**
 * Returns rounded tick coordinates inside a numeric range.
 * @param startTime - Numeric range start.
 * @param endTime - Numeric range end.
 * @param tickCount - Desired number of rounded ticks.
 * @returns Rounded numeric tick coordinates.
 */
export function getPrettyTicks(startTime: number, endTime: number, tickCount?: number): number[];
/**
 * Returns major and minor ticks inside a timestamp or duration range.
 * @param mode - Timestamp or duration tick mode.
 * @param startTimeMs - Time range start in milliseconds.
 * @param endTimeMs - Time range end in milliseconds.
 * @param step - Major tick step in milliseconds.
 * @param minorTickCount - Desired density of minor ticks between major ticks.
 * @returns Major and minor tick descriptors.
 */
export function getPrettyTicks(
  mode: 'timestamp' | 'duration',
  startTimeMs: number,
  endTimeMs: number,
  step: number,
  minorTickCount: number
): Tick[];
export function getPrettyTicks(
  startTimeOrMode: number | 'timestamp' | 'duration',
  endTimeOrStartTimeMs: number,
  tickCountOrEndTimeMs: number = 5,
  step?: number,
  minorTickCount?: number
): number[] | Tick[] {
  if (typeof startTimeOrMode === 'number') {
    return getLegacyPrettyTicks(startTimeOrMode, endTimeOrStartTimeMs, tickCountOrEndTimeMs);
  }
  return getTimeAxisTicks(
    startTimeOrMode,
    endTimeOrStartTimeMs,
    tickCountOrEndTimeMs,
    step ?? 1,
    minorTickCount ?? 0
  );
}

/**
 * Formats a UTC timestamp for a multiline axis label.
 * @param timestampMs - Timestamp in milliseconds since epoch.
 * @returns ISO date and time separated by a newline.
 */
export function formatTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  const [day, time] = date
    .toISOString()
    .replace(/\.?0*Z/, '')
    .split('T');
  return `${day}\n${time}`;
}

/**
 * Formats a duration for a time-axis label.
 * @param milliseconds - Duration in milliseconds.
 * @param format - Long major-tick or short minor-tick label format.
 * @returns Formatted duration label.
 */
export function formatDuration(milliseconds: number, format: 'long' | 'short'): string {
  let result = milliseconds < 0 ? '-' : '';
  milliseconds = Math.abs(milliseconds);
  let hours = 0;
  let minutes = 0;
  let seconds = milliseconds / 1000;
  if (seconds >= 60) {
    minutes = Math.floor(seconds / 60);
    seconds %= 60;
  }
  if (minutes >= 60) {
    hours = Math.floor(minutes / 60);
    minutes %= 60;
  }
  if (hours > 0) {
    result += `${hours.toString().padStart(2, '0')}:`;
  }
  if (format === 'long' || hours > 0) {
    result += `${minutes.toString().padStart(2, '0')}:`;
  } else if (minutes > 0) {
    result += `${minutes}:`;
  } else if (seconds >= 1) {
    result += ':';
  }
  const secondParts = seconds.toFixed(3).replace(/0+$/, '').split('.');
  secondParts[0] = secondParts[0]!.padStart(2, '0');
  if (secondParts[1] === '') {
    secondParts.length = 1;
  }
  if (milliseconds < 1000 && format === 'short') {
    result += `.${secondParts[1] ?? '0'}`;
  } else {
    result += secondParts.join('.');
  }
  return result;
}

function getViewportBounds(viewport: Viewport): Bounds | null {
  let bounds: unknown;
  try {
    bounds = viewport.getBounds();
  } catch {
    return null;
  }

  if (!Array.isArray(bounds) || bounds.length < 4) {
    return null;
  }

  const [minX, minY, maxX, maxY] = bounds;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return null;
  }

  return [minX, minY, maxX, maxY];
}

function getLegacyPrettyTicks(startTime: number, endTime: number, tickCount: number): number[] {
  const range = endTime - startTime;
  if (!Number.isFinite(range) || range <= 0) {
    return [];
  }

  const roughStep = range / Math.max(1, tickCount - 1);
  const exponent = Math.floor(Math.log10(roughStep));
  const base = Math.pow(10, exponent);
  const niceStep = (MULTIPLES.find(multiple => base * multiple >= roughStep) ?? 10) * base;
  const niceStart = Math.ceil(startTime / niceStep) * niceStep;
  const niceEnd = Math.floor(endTime / niceStep) * niceStep;

  const ticks: number[] = [];
  for (let tick = niceStart; tick <= niceEnd; tick += niceStep) {
    ticks.push(tick);
  }
  return ticks;
}

function getTimeAxisTicks(
  mode: 'timestamp' | 'duration',
  startTimeMs: number,
  endTimeMs: number,
  step: number,
  minorTickCount: number
): Tick[] {
  if (!Number.isFinite(step) || step <= 0 || endTimeMs <= startTimeMs) {
    return [];
  }

  const offset = mode === 'timestamp' ? getStartOfDay(startTimeMs) : 0;
  const niceStart = Math.floor((startTimeMs - offset) / step) * step;
  const niceEnd = Math.floor((endTimeMs - offset) / step + 1) * step;
  const minorStep = minorTickCount === 0 ? 0 : getMinorTickStep(step, minorTickCount);
  const stepCeiling =
    step <= MS_PER_SECOND
      ? MS_PER_SECOND
      : step <= MS_PER_MINUTE
        ? MS_PER_MINUTE
        : step <= MS_PER_HOUR
          ? MS_PER_HOUR
          : MS_PER_DAY;

  const ticks: Tick[] = [];
  for (let tick = niceStart; tick <= niceEnd; tick += step) {
    const stepStart = Math.floor(tick / stepCeiling) * stepCeiling + offset;
    ticks.push({
      x: tick + offset,
      value: tick + offset,
      stepStart,
      type: 'major'
    });
    if (minorStep > 0) {
      for (let minorTick = tick + minorStep; minorTick < tick + step; minorTick += minorStep) {
        ticks.push({
          x: minorTick + offset,
          value: minorTick + offset,
          stepStart,
          type: 'minor'
        });
      }
    }
  }

  return ticks;
}

function getMinorTickStep(step: number, minorTickCount: number): number {
  if (!step || minorTickCount <= 0) {
    return 0;
  }

  let minorStep = step;
  let breakPointIndex = STEP_BREAK_POINTS.findIndex(point => point === minorStep);
  const minStep = step / minorTickCount / 10;
  while (minorStep >= minStep) {
    if (breakPointIndex <= 0) {
      const base = minorStep > MS_PER_DAY ? MS_PER_DAY : 1;
      const exponent = Math.floor(Math.log10(minorStep / base));
      const magnitudeBase = Math.pow(10, exponent) * base;
      const multiple = Math.round(minorStep / magnitudeBase);
      minorStep = multiple === 5 ? (minorStep * 2) / 5 : minorStep / 2;
    } else {
      breakPointIndex -= 1;
      minorStep = STEP_BREAK_POINTS[breakPointIndex]!;
    }
    const stepRatio = step / minorStep;
    if (Number.isInteger(stepRatio) && stepRatio > minorTickCount) {
      return minorStep;
    }
  }
  return 0;
}

function getStartOfDay(startTimeMs: number): number {
  const date = new Date(startTimeMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
