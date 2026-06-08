/**
 * Convert a time in microseconds to a human-readable string
 * @param us Time in microseconds
 */
export function formatTimeMs(
  timeMs: number,
  options?: {
    space?: boolean;
    roundDigits?: number;
  }
): string {
  const {space = true, roundDigits = 5} = options || {};
  const sep = space ? ' ' : '';
  const us = timeMs * 1000;
  if (us === 0) {
    return '0s';
  }
  if (Math.abs(us) < 1000) {
    return `${floatToStr(us, roundDigits)}${sep}µs`;
  }
  const ms = us / 1000;
  if (Math.abs(ms) < 1000) {
    return `${floatToStr(ms, roundDigits)}${sep}ms`;
  }
  const s = ms / 1000;
  if (Math.abs(s) < 60) {
    return `${floatToStr(s, roundDigits)}${sep}s`;
  }
  const m = s / 60;
  if (Math.abs(m) < 60) {
    return formatMinuteDuration(s);
  }
  const h = m / 60;
  if (Math.abs(h) < 24) {
    return formatHourDuration(s);
  }
  return formatDayDuration(s);
}

export function formatTimeRangeMs(startMs: number, endMs: number): string {
  return `${formatTimeMs(startMs)} - ${formatTimeMs(endMs)}`;
}

/**
 * Convert a float to a string with a specified number of significant digits.
 * @param f The float to convert.
 * @param roundDigits The number of significant digits to round to (default is 5).
 * @returns The float as a string, rounded to the specified precision.
 */
export function floatToStr(f: number, roundDigits: number = 5): string {
  if (roundDigits < 1 || Number.isInteger(f)) {
    return f.toString();
  }

  // Round the float to the specified precision
  const precision = f.toPrecision(roundDigits);
  return parseFloat(precision).toString();
}

/**
 * Format a duration between one minute and one hour with whole seconds.
 * @param seconds Duration in seconds.
 * @returns A compact minutes-and-seconds duration label.
 */
function formatMinuteDuration(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const totalSeconds = Math.floor(Math.abs(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  if (remainingSeconds === 0) {
    return `${sign}${minutes}m`;
  }

  return `${sign}${minutes}m${remainingSeconds}s`;
}

/**
 * Format a duration between one hour and one day with whole minutes.
 * @param seconds Duration in seconds.
 * @returns A compact hours-and-minutes duration label.
 */
function formatHourDuration(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const totalMinutes = Math.floor(Math.abs(seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  if (remainingMinutes === 0) {
    return `${sign}${hours}h`;
  }

  return `${sign}${hours}h${remainingMinutes}m`;
}

/**
 * Format a duration of at least one day with whole hours.
 * @param seconds Duration in seconds.
 * @returns A compact days-and-hours duration label.
 */
function formatDayDuration(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const totalHours = Math.floor(Math.abs(seconds) / 3600);
  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;

  if (remainingHours === 0) {
    return `${sign}${days}d`;
  }

  return `${sign}${days}d${remainingHours}h`;
}
