import {describe, expect, it} from 'vitest';

import {
  DEFAULT_SUBMIT_MIN_WAIT_TIME_MS,
  filterLocalDependenciesByMode,
  shouldShowLocalDependencyByModeFields
} from './local-dependency-filter';

const dependencies = [
  {
    id: 'compute',
    keywords: new Set(['COMPUTE']),
    waitTimeMs: 2
  },
  {
    id: 'submit-warning',
    keywords: new Set(['SUBMIT']),
    waitTimeMs: DEFAULT_SUBMIT_MIN_WAIT_TIME_MS - 1
  },
  {
    id: 'submit-ok',
    keywords: new Set(['SUBMIT']),
    waitTimeMs: DEFAULT_SUBMIT_MIN_WAIT_TIME_MS + 5
  }
];

describe('filterLocalDependenciesByMode', () => {
  it('keeps every local dependency in all mode', () => {
    const result = filterLocalDependenciesByMode(dependencies, 'all');

    expect(result.map(dependency => dependency.id)).toEqual([
      'compute',
      'submit-warning',
      'submit-ok'
    ]);
  });

  it('keeps only submit dependencies in submit mode', () => {
    const result = filterLocalDependenciesByMode(dependencies, 'submit');

    expect(result.map(dependency => dependency.id)).toEqual(['submit-warning', 'submit-ok']);
  });

  it('keeps only short submit dependencies in warning mode', () => {
    const result = filterLocalDependenciesByMode(dependencies, 'warnings');

    expect(result.map(dependency => dependency.id)).toEqual(['submit-warning']);
  });

  it('checks mode fields without constructing dependency objects', () => {
    expect(shouldShowLocalDependencyByModeFields('submit', true, 100)).toBe(true);
    expect(shouldShowLocalDependencyByModeFields('submit', false, 100)).toBe(false);
    expect(shouldShowLocalDependencyByModeFields('warnings', true, 1)).toBe(true);
    expect(
      shouldShowLocalDependencyByModeFields('warnings', true, DEFAULT_SUBMIT_MIN_WAIT_TIME_MS)
    ).toBe(false);
    expect(shouldShowLocalDependencyByModeFields('warnings', false, 1)).toBe(false);
    expect(shouldShowLocalDependencyByModeFields('all', false, 1)).toBe(true);
  });

  it('supports a caller-provided submit warning threshold', () => {
    const result = filterLocalDependenciesByMode(dependencies, 'warnings', 20);

    expect(result.map(dependency => dependency.id)).toEqual(['submit-warning', 'submit-ok']);
  });
});
