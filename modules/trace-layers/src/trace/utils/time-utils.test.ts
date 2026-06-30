import {describe, expect, it} from 'vitest';

import {formatTS, formatTSDate, formatTSRange, formatTSTime} from './time-utils';

describe('formatTS', () => {
  it('formats UTC timestamps as time followed by date', () => {
    expect(formatTS('2026-03-06T22:53:04Z', 'UTC')).toBe('10:53:04 PM, Mar 6, 2026 UTC');
  });

  it('preserves fractional seconds when requested', () => {
    expect(formatTS('2026-03-06T22:53:04.123Z', 'UTC', 3)).toBe('10:53:04.123 PM, Mar 6, 2026 UTC');
  });
});

describe('formatTSRange', () => {
  it('formats same-date timestamp ranges with the date at the end', () => {
    expect(formatTSRange('2026-03-25T14:07:04Z', '2026-03-25T14:24:24Z', 'UTC')).toBe(
      '2:07:04 PM -> 2:24:24 PM, Mar 25, 2026 UTC'
    );
  });

  it('preserves both dates when a timestamp range crosses a date boundary', () => {
    expect(formatTSRange('2026-03-25T23:55:00Z', '2026-03-26T00:05:00Z', 'UTC')).toBe(
      '11:55:00 PM, Mar 25, 2026 UTC -> 12:05:00 AM, Mar 26, 2026 UTC'
    );
  });
});

describe('formatTSDate', () => {
  it('formats the date and timezone without the clock time', () => {
    expect(formatTSDate('2026-03-25T14:07:04Z', 'UTC')).toBe('Mar 25, 2026 UTC');
  });
});

describe('formatTSTime', () => {
  it('formats the clock time without the date or timezone', () => {
    expect(formatTSTime('2026-03-25T14:07:04Z', 'UTC')).toBe('2:07:04 PM');
  });
});
