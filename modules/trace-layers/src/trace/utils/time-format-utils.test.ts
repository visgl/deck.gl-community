import {describe, expect, it} from 'vitest';

import {floatToStr, formatTimeMs, formatTimeRangeMs} from './time-format-utils';

describe('floatToStr', () => {
  it('should return the integer as a string if the input is an integer', () => {
    expect(floatToStr(123)).toBe('123');
    expect(floatToStr(-456)).toBe('-456');
  });

  it('should round the float to the specified number of significant digits', () => {
    expect(floatToStr(123.456789, 3)).toBe('123');
    expect(floatToStr(0.000123456, 5)).toBe('0.00012346');
    expect(floatToStr(123.456, 1)).toBe('100');
  });

  it('should handle small numbers with scientific notation', () => {
    expect(floatToStr(1.23e-7, 3)).toBe('1.23e-7');
    expect(floatToStr(-4.56e-8, 2)).toBe('-4.6e-8');
  });

  // it('should handle large numbers with scientific notation', () => {
  //   expect(floatToStr(1.23e10, 3)).toBe('1.23e+10');
  //   expect(floatToStr(-4.56e12, 2)).toBe('-4.6e+12');
  // });

  it('should return the float as a string if roundDigits is less than 1', () => {
    expect(floatToStr(123.456, 0)).toBe('123.456');
    expect(floatToStr(-456.789, -1)).toBe('-456.789');
  });

  it('should handle edge cases with rounding', () => {
    expect(floatToStr(0.999999, 3)).toBe('1');
    expect(floatToStr(0.0009999, 3)).toBe('0.001');
  });

  it('should handle numbers without scientific notation when possible', () => {
    expect(floatToStr(123.456789, 6)).toBe('123.457');
    expect(floatToStr(0.000123456, 6)).toBe('0.000123456');
  });
});

describe('formatTimeMs', () => {
  it('should format 0 microseconds as "0s"', () => {
    expect(formatTimeMs(0)).toBe('0s');
  });

  it('should format ms less than 1 as microseconds', () => {
    expect(formatTimeMs(0.5)).toBe('500 µs');
  });

  it('should format microseconds less than 100 as microsecond', () => {
    expect(formatTimeMs(0.05)).toBe('50 µs');
  });

  it('should format microseconds less than 10 as µs', () => {
    expect(formatTimeMs(0.005)).toBe('5 µs');
  });

  it('should format microseconds less than 1 as µs', () => {
    expect(formatTimeMs(0.0005)).toBe('0.5 µs');
  });

  it('should format microseconds less than 0.1 as µs', () => {
    expect(formatTimeMs(0.00005)).toBe('0.05 µs');
  });

  it('should format seconds less than 60 as s', () => {
    expect(formatTimeMs(1500)).toBe('1.5 s');
  });

  it('should format minutes less than 60 as minutes and seconds', () => {
    expect(formatTimeMs(90000)).toBe('1m30s');
  });

  it('should truncate minute-range durations to whole seconds', () => {
    expect(formatTimeMs(119400)).toBe('1m59s');
    expect(formatTimeMs(90600)).toBe('1m30s');
  });

  it('should omit the seconds component for exact minute durations', () => {
    expect(formatTimeMs(120000)).toBe('2m');
  });

  it('should format negative minute-range durations', () => {
    expect(formatTimeMs(-119400)).toBe('-1m59s');
  });

  it('should format hours less than 24 as hours and minutes', () => {
    expect(formatTimeMs(5400000)).toBe('1h30m');
  });

  it('should truncate hour-range durations to whole minutes', () => {
    expect(formatTimeMs(7196400)).toBe('1h59m');
    expect(formatTimeMs(5436000)).toBe('1h30m');
  });

  it('should omit the minutes component for exact hour durations', () => {
    expect(formatTimeMs(7200000)).toBe('2h');
  });

  it('should format negative hour-range durations', () => {
    expect(formatTimeMs(-7196400)).toBe('-1h59m');
  });

  it('should format days as days and hours', () => {
    expect(formatTimeMs(129600000)).toBe('1d12h');
  });

  it('should truncate day-range durations to whole hours', () => {
    expect(formatTimeMs(172713600)).toBe('1d23h');
    expect(formatTimeMs(172836000)).toBe('2d');
  });

  it('should format negative day-range durations', () => {
    expect(formatTimeMs(-129600000)).toBe('-1d12h');
  });

  it('should respect the space option', () => {
    expect(formatTimeMs(1500, {space: false})).toBe('1.5s');
    expect(formatTimeMs(119400, {space: false})).toBe('1m59s');
  });

  // We remove the trailing zeros for simplicity
  //   it('should respect the roundDigits option', () => {
  //     expect(formatTimeMs(1500, { roundDigits: 2 })).toBe('1.50 s');
  //   });
});

describe('formatTimeRangeMs', () => {
  it('should format a time range correctly', () => {
    expect(formatTimeRangeMs(1500, 3000)).toBe('1.5 s - 3 s');
  });

  it('should handle a range with 0 start time', () => {
    expect(formatTimeRangeMs(0, 1500)).toBe('0s - 1.5 s');
  });

  it('should handle a range with large times', () => {
    expect(formatTimeRangeMs(5400000, 10800000)).toBe('1h30m - 3h');
  });
});
