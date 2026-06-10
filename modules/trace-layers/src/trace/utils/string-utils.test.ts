import {describe, expect, it} from 'vitest';

import {
  capitalize,
  capitalizeFirstLetter,
  lowerCase,
  pluralize,
  truncateMiddle,
  wrapText
} from './string-utils';

describe('string-utils', () => {
  it('capitalizes strings', () => {
    expect(capitalize('rank')).toBe('RANK');
  });

  it('capitalizes only the first letter', () => {
    expect(capitalizeFirstLetter('rank')).toBe('Rank');
    expect(capitalizeFirstLetter('')).toBe('');
  });

  it('lowercases strings', () => {
    expect(lowerCase('Rank')).toBe('rank');
  });

  it('pluralizes strings', () => {
    expect(pluralize('Rank')).toBe('Ranks');
    expect(pluralize('bus')).toBe('buses');
    expect(pluralize('')).toBe('');
  });

  describe('truncateMiddle', () => {
    it('leaves short strings untouched', () => {
      expect(truncateMiddle('short')).toBe('short');
    });

    it('truncates in the middle using default settings', () => {
      const value = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      expect(truncateMiddle(value)).toBe('abcdefghijklmnopqrs…GHIJKLMNOPQRSTUVWXYZ');
    });

    it('truncates using ellipsisPosition', () => {
      const value = 'abcdefghijklmnopqrstuvwxyz0123456789';
      expect(truncateMiddle(value, {maxLabelLength: 20, ellipsisPosition: 5})).toBe(
        'abcde…wxyz0123456789'
      );
    });

    it('truncates with ellipsis at end when ellipsisPosition is -1', () => {
      const value = 'abcdefghijklmnopqrstuvwxyz';
      expect(truncateMiddle(value, {maxLabelLength: 8, ellipsisPosition: -1})).toBe('abcdefg…');
    });

    it('respects custom maxLabelLength', () => {
      const value = 'abcdefghijklmnopqrstuvwxyz0123456789';
      const truncated = truncateMiddle(value, {maxLabelLength: 10});
      expect(truncated.length).toBe(10);
      expect(truncated).toBe('abcd…56789');
    });

    it('handles extremely small maxLabelLength', () => {
      expect(truncateMiddle('longer text', {maxLabelLength: 1})).toBe('…');
    });
  });

  describe('wrapText', () => {
    it('returns the original string when under the limit', () => {
      expect(wrapText('short', {maxLineLength: 10})).toBe('short');
    });

    it('wraps text at the specified line length', () => {
      expect(wrapText('abcdefghij', {maxLineLength: 4})).toBe('abcd\nefgh\nij');
    });
  });
});
