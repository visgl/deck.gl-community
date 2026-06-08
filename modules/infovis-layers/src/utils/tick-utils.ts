import type {Viewport} from '@deck.gl/core';

export type Tick = {
  type: 'major' | 'minor';
  /** coordinate to display this tick at */
  x: number;
  /** Timestamp or duration in ms */
  value: number;
  /** Value rouded down to the nearest "perceptual" start within the current visible range.
   * Typically the start of day/hour/minute depending on the current zoom level.
   * This is useful for reducing the verbosity of labels
   */
  stepStart: number;
};

export function getZoomedRange(
  viewport: Viewport,
  extentFactor: number = 1,
  clampMin: number = -Infinity,
  clampMax: number = Infinity
): [start: number, end: number] | null {
  if (clampMin >= clampMax) {
    return null;
  }
  let bounds: unknown;
  try {
    bounds = viewport.getBounds();
  } catch {
    return null;
  }
  if (!Array.isArray(bounds)) {
    return null;
  }
  let [minX, , maxX] = bounds;
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || maxX <= minX) {
    return null;
  }
  const safeExtentFactor = Number.isFinite(extentFactor) && extentFactor > 0 ? extentFactor : 1;
  const padding = ((maxX - minX) * (safeExtentFactor - 1)) / 2;
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
const StepBreakPoints: number[] = [
  ...[1, 2, 5, 10, 15, 20, 30].map(m => m * MS_PER_SECOND),
  ...[1, 2, 5, 10, 15, 20, 30].map(m => m * MS_PER_MINUTE),
  ...[1, 2, 3, 4, 6, 8, 12].map(m => m * MS_PER_HOUR),
  MS_PER_DAY
];
const Multiples = [1, 2, 5, 10];

export function getTickStep(timeSpanMs: number, tickCount: number): number {
  const roughStep = timeSpanMs / Math.max(1, tickCount);
  const base = StepBreakPoints.find(p => p >= roughStep) ?? MS_PER_DAY;
  if (base === MS_PER_DAY || base === MS_PER_SECOND) {
    const exponent = Math.floor(Math.log10(roughStep / base));
    const mbase = Math.pow(10, exponent) * base;
    // Find the smallest multiple that is greater than or equal to roughStep
    const niceStep = Multiples.find(m => m * mbase >= roughStep)! * mbase;
    return niceStep;
  }
  return base;
}

function getMinorTickStep(step: number, minorTickCount: number): number {
  if (!step) return 0;
  let minorStep = step;
  let i = StepBreakPoints.findIndex(p => p === minorStep);
  // An arbitrary hard stop to the recursion to prevent infinite loop
  // minorStep should never get smaller than this number as long as step is a "nice" multiple
  const minStep = step / minorTickCount / 10;
  while (minorStep >= minStep) {
    if (i <= 0) {
      const base = minorStep > MS_PER_DAY ? MS_PER_DAY : 1;
      const exponent = Math.floor(Math.log10(minorStep / base));
      const mbase = Math.pow(10, exponent) * base;
      const m0 = Math.round(minorStep / mbase);
      minorStep = m0 === 5 ? (minorStep * 2) / 5 : minorStep / 2;
    } else {
      i -= 1;
      minorStep = StepBreakPoints[i]!;
    }
    const t = step / minorStep;
    if (Number.isInteger(t) && t > minorTickCount) {
      return minorStep;
    }
  }
  // Something is wrong, we don't expect to get here
  return 0;
}

function getStartOfDay(startTimeMs: number) {
  const d = new Date(startTimeMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Get nicely rounded tick close to the natural spacing
 * @param startTime
 * @param endTime
 * @param tickCount
 * @returns
 */
export function getPrettyTicks(
  mode: 'timestamp' | 'duration',
  startTimeMs: number,
  endTimeMs: number,
  step: number,
  minorTickCount: number
): Tick[] {
  const offset = mode === 'timestamp' ? getStartOfDay(startTimeMs) : 0;

  const niceStart = Math.floor((startTimeMs - offset) / step) * step;
  const niceEnd = Math.floor((endTimeMs - offset) / step + 1) * step;
  const minorStep = minorTickCount === 0 ? 0 : getMinorTickStep(step, minorTickCount);
  const stepCeil =
    step <= MS_PER_SECOND
      ? MS_PER_SECOND
      : step <= MS_PER_MINUTE
        ? MS_PER_MINUTE
        : step <= MS_PER_HOUR
          ? MS_PER_HOUR
          : MS_PER_DAY;

  const ticks: Tick[] = [];
  for (let t = niceStart; t <= niceEnd; t += step) {
    const stepStart = Math.floor(t / stepCeil) * stepCeil + offset;
    ticks.push({
      x: t + offset,
      value: t + offset,
      stepStart,
      type: 'major'
    });
    if (minorStep > 0) {
      for (let t1 = t + minorStep; t1 < t + step; t1 += minorStep) {
        ticks.push({
          x: t1 + offset,
          value: t1 + offset,
          stepStart,
          type: 'minor'
        });
      }
    }
  }

  return ticks;
}

export function formatTimestamp(ts: number) {
  const d = new Date(ts);
  const [date, time] = d
    .toISOString()
    .replace(/\.?0*Z/, '')
    .split('T');
  return `${date}\n${time}`;
}

export function formatDuration(ms: number, format: 'long' | 'short') {
  let str = ms < 0 ? '-' : '';
  ms = Math.abs(ms);
  let h = 0,
    m = 0,
    s = ms / 1000;
  if (s >= 60) {
    m = Math.floor(s / 60);
    s = s % 60;
  }
  if (m >= 60) {
    h = Math.floor(m / 60);
    m = m % 60;
  }
  if (h > 0) {
    str += `${h.toString().padStart(2, '0')}:`;
  }
  if (format === 'long' || h > 0) {
    str += `${m.toString().padStart(2, '0')}:`;
  } else if (m > 0) {
    str += `${m}:`;
  } else if (s >= 1) {
    str += ':';
  }
  const ss = s.toFixed(3).replace(/0+$/, '').split('.');
  ss[0] = ss[0]!.padStart(2, '0');
  if (ss[1] === '') ss.length = 1;
  if (ms < 1000 && format === 'short') {
    str += `.${ss[1]}`;
  } else {
    str += ss.join('.');
  }
  return str;
}
