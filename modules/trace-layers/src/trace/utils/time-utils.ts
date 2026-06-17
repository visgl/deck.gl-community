/**
 * @param ts  e.g. "2025-05-13 13:23:24.121000" or epoch timestamp
 * @returns Date
 */
export function parseTS(ts: string | number): Date | null {
  if (typeof ts === 'number') {
    const ms = ts < 100_000_000_000 ? ts * 1000 : ts;
    const date = new Date(ms);
    if (!date || Number.isNaN(date.getTime())) {
      console.log('Failed to parse timestamp:', ts);
      return null;
    }
    return date;
  }
  // Convert to ISO 8601 format
  // "YYYY-MM-DD HH:mm:ss.µµµµµµ" -> "YYYY-MM-DDTHH:mm:ss.µµµ"
  try {
    const isoIn = ts.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
    // TODO(ib) Check if the string includes timezone offset (either +zz:zz or Z), add Z if none.
    // ISO8601 permits only one timezone offset.
    const date = new Date(isoIn);
    if (!date || Number.isNaN(date.getTime())) {
      console.log('Failed to parse timestamp:', ts);
      return null;
    }
    return date;
  } catch (error) {
    console.log('Error parsing timestamp:', ts, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * @param ts  e.g. "2025-05-13 13:23:24.121000"
 * @returns pretty printed time
 */
export function formatTS(
  ts: string | number | Date,
  /** IATA timezone name
   * @default UTC
   */
  timeZone?: string,
  fractionalSecondDigits?: 1 | 2 | 3
): string {
  const d = typeof ts === 'string' || typeof ts === 'number' ? parseTS(ts) : ts;
  if (!d || Number.isNaN(d.getTime())) {
    return typeof ts === 'string' ? ts || '' : '';
  }

  const parts = formatTimestampParts(d, timeZone, fractionalSecondDigits);

  return joinFormattedTimestampParts(parts);
}

/**
 * Formats only the calendar date and timezone portion of a timestamp.
 */
export function formatTSDate(
  ts: string | number | Date,
  /** IATA timezone name
   * @default UTC
   */
  timeZone?: string
): string {
  const d = typeof ts === 'string' || typeof ts === 'number' ? parseTS(ts) : ts;
  if (!d || Number.isNaN(d.getTime())) {
    return typeof ts === 'string' ? ts || '' : '';
  }

  const parts = formatTimestampParts(d, timeZone);

  return joinFormattedTimestampDateParts(parts);
}

/**
 * Formats only the clock-time portion of a timestamp.
 */
export function formatTSTime(
  ts: string | number | Date,
  /** IATA timezone name
   * @default UTC
   */
  timeZone?: string,
  fractionalSecondDigits?: 1 | 2 | 3
): string {
  const d = typeof ts === 'string' || typeof ts === 'number' ? parseTS(ts) : ts;
  if (!d || Number.isNaN(d.getTime())) {
    return typeof ts === 'string' ? ts || '' : '';
  }

  return formatTimestampParts(d, timeZone, fractionalSecondDigits).time;
}

/**
 * Formats a timestamp range, omitting the first date when both endpoints land on the same date.
 */
export function formatTSRange(
  startTS: string | number | Date,
  endTS: string | number | Date,
  /** IATA timezone name
   * @default UTC
   */
  timeZone?: string,
  fractionalSecondDigits?: 1 | 2 | 3
): string {
  const startDate =
    typeof startTS === 'string' || typeof startTS === 'number' ? parseTS(startTS) : startTS;
  const endDate = typeof endTS === 'string' || typeof endTS === 'number' ? parseTS(endTS) : endTS;
  if (
    !startDate ||
    Number.isNaN(startDate.getTime()) ||
    !endDate ||
    Number.isNaN(endDate.getTime())
  ) {
    return `${formatTS(startTS, timeZone, fractionalSecondDigits)} -> ${formatTS(
      endTS,
      timeZone,
      fractionalSecondDigits
    )}`;
  }

  const startParts = formatTimestampParts(startDate, timeZone, fractionalSecondDigits);
  const endParts = formatTimestampParts(endDate, timeZone, fractionalSecondDigits);
  if (startParts.date === endParts.date && startParts.timeZoneName === endParts.timeZoneName) {
    return `${startParts.time} -> ${endParts.time}, ${endParts.date}${endParts.timeZoneName ? ` ${endParts.timeZoneName}` : ''}`.trim();
  }

  return `${joinFormattedTimestampParts(startParts)} -> ${joinFormattedTimestampParts(endParts)}`;
}

/**
 * Returns the difference between two timestamps in "Xh Ym" format.
 */
export function diffTS(ts1: string | number, ts2: string | number): string {
  const d1 = parseTS(ts1);
  const d2 = parseTS(ts2);

  if (!d1 || !d2 || Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) {
    console.log('Failed to calculate timestamp difference:', ts1, ts2);
    return 'N/A: Invalid / missing timestamp(s)';
  }

  let diffMs = Math.abs(d2.getTime() - d1.getTime());
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  diffMs -= hours * 1000 * 60 * 60;
  const minutes = Math.floor(diffMs / (1000 * 60));
  diffMs -= minutes * 1000 * 60;
  const seconds = Math.floor(diffMs / 1000);

  let formattedDiff = '';
  if (hours > 0) {
    formattedDiff += `${hours}h `;
  }
  if (minutes > 0 || hours > 0) {
    formattedDiff += `${minutes}m `;
  }
  formattedDiff += `${seconds}s`;
  return formattedDiff.trim();
}

type TimestampFormatParts = {
  /** Clock-time label without date or timezone. */
  time: string;
  /** Calendar-date label without the timezone. */
  date: string;
  /** Short timezone label resolved for the timestamp. */
  timeZoneName: string;
};

/**
 * Formats a timestamp into reusable time, date, and timezone labels.
 */
function formatTimestampParts(
  date: Date,
  timeZone?: string,
  fractionalSecondDigits?: 1 | 2 | 3
): TimestampFormatParts {
  const resolvedTimeZone = timeZone ?? 'UTC';
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    ...(fractionalSecondDigits ? {fractionalSecondDigits} : {}),
    timeZone: resolvedTimeZone
  });
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: resolvedTimeZone
  });
  const zoneFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvedTimeZone,
    timeZoneName: 'short'
  });
  const timeZoneName =
    zoneFormatter.formatToParts(date).find(part => part.type === 'timeZoneName')?.value ?? '';

  return {
    time: timeFormatter.format(date),
    date: dateFormatter.format(date),
    timeZoneName
  };
}

/**
 * Joins timestamp parts into the default full timestamp label.
 */
function joinFormattedTimestampParts(parts: TimestampFormatParts): string {
  return `${parts.time}, ${joinFormattedTimestampDateParts(parts)}`.trim();
}

/**
 * Joins timestamp parts into a date-with-timezone label.
 */
function joinFormattedTimestampDateParts(parts: TimestampFormatParts): string {
  return `${parts.date}${parts.timeZoneName ? ` ${parts.timeZoneName}` : ''}`.trim();
}
