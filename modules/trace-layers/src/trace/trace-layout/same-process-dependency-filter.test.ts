import {describe, expect, it} from 'vitest';

import {
  DEFAULT_SUBMIT_MIN_WAIT_TIME_MS,
  shouldShowSameProcessDependencyByModeFields
} from './same-process-dependency-filter';

describe('shouldShowSameProcessDependencyByModeFields', () => {
  it('checks mode fields without constructing dependency objects', () => {
    expect(shouldShowSameProcessDependencyByModeFields('submit', true, 100)).toBe(true);
    expect(shouldShowSameProcessDependencyByModeFields('submit', false, 100)).toBe(false);
    expect(shouldShowSameProcessDependencyByModeFields('warnings', true, 1)).toBe(true);
    expect(
      shouldShowSameProcessDependencyByModeFields('warnings', true, DEFAULT_SUBMIT_MIN_WAIT_TIME_MS)
    ).toBe(false);
    expect(shouldShowSameProcessDependencyByModeFields('warnings', false, 1)).toBe(false);
    expect(shouldShowSameProcessDependencyByModeFields('all', false, 1)).toBe(true);
  });

  it('supports a caller-provided submit warning threshold', () => {
    expect(shouldShowSameProcessDependencyByModeFields('warnings', true, 15, 20)).toBe(true);
    expect(shouldShowSameProcessDependencyByModeFields('warnings', true, 20, 20)).toBe(false);
  });
});
