import {describe, expect, it} from 'vitest';
import {createForestSpecimens, getTreeCount} from './forest-data';

describe('forest workload contracts', () => {
  it('keeps 10K and 20K counts exact instead of silently truncating the requested workload', () => {
    for (const count of [10000, 20000]) {
      const trees = createForestSpecimens(getTreeCount(String(count)));
      expect(trees).toHaveLength(count);
      expect(trees.at(-1)!.index).toBe(count - 1);
      expect(new Set(trees.map(tree => tree.species)).size).toBe(5);
      expect(new Set(trees.map(tree => tree.position.join(','))).size).toBe(count);
      expect(
        trees.every(tree => tree.height > 0 && tree.canopyRadius > 0 && tree.trunkRadius > 0)
      ).toBe(true);
    }
  });
  it('preserves source positions and dimensions across repeated count changes', () => {
    expect(createForestSpecimens(20000)).toEqual(createForestSpecimens(20000));
  });
  it('uses finite bounded integer counts for malformed or unsupported links', () => {
    for (const value of ['invalid', 'Infinity', 'NaN', '']) expect(getTreeCount(value)).toBe(1000);
    expect(getTreeCount('20000')).toBe(20000);
    expect(getTreeCount('30000')).toBe(20000);
    expect(getTreeCount('-1')).toBe(1);
    expect(getTreeCount('1234.5')).toBe(1234);
  });
});
