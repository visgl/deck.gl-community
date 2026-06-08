import * as arrow from 'apache-arrow';
import {describe, expect, it} from 'vitest';

import {buildFastRowAccessorWithScratchGeneric} from './arrow-accessors';

type TestSpanRow = {
  startTimeMs: number;
  durationMs: number;
  processName: string;
};

describe('buildFastRowAccessorWithScratchGeneric', () => {
  it('fills caller-provided scratch objects and arrays for a single-batch table', () => {
    const table = new arrow.Table({
      startTimeMs: arrow.vectorFromArray([10, 20], new arrow.Float64()),
      durationMs: arrow.vectorFromArray([5, 7], new arrow.Float64()),
      processName: arrow.vectorFromArray(['rank-1', 'rank-2'], new arrow.Utf8())
    });
    const accessor = buildFastRowAccessorWithScratchGeneric<TestSpanRow>(table, [
      'startTimeMs',
      'durationMs',
      'processName'
    ]);

    const scratchArray = new Array<TestSpanRow[keyof TestSpanRow]>(3);
    const scratchObject: Partial<TestSpanRow> = {};

    expect(accessor.columns).toEqual(['startTimeMs', 'durationMs', 'processName']);
    expect(accessor.totalRows).toBe(2);
    expect(accessor.getValuesInto(1, scratchArray)).toBe(scratchArray);
    expect(scratchArray).toEqual([20, 7, 'rank-2']);
    expect(accessor.getRowInto(0, scratchObject)).toBe(scratchObject);
    expect(scratchObject).toEqual({
      startTimeMs: 10,
      durationMs: 5,
      processName: 'rank-1'
    });
    expect(accessor.getRowInto(-1, scratchObject)).toBeNull();
  });

  it('reads across multiple Arrow batches and reuses scratch singletons', () => {
    const batchA = new arrow.Table({
      startTimeMs: arrow.vectorFromArray([1, 2], new arrow.Float64()),
      durationMs: arrow.vectorFromArray([10, 20], new arrow.Float64()),
      processName: arrow.vectorFromArray(['rank-a', 'rank-a'], new arrow.Utf8())
    });
    const batchB = new arrow.Table({
      startTimeMs: arrow.vectorFromArray([3], new arrow.Float64()),
      durationMs: arrow.vectorFromArray([30], new arrow.Float64()),
      processName: arrow.vectorFromArray(['rank-b'], new arrow.Utf8())
    });
    const combinedTable = new arrow.Table(batchA.schema, [...batchA.batches, ...batchB.batches]);
    const accessor = buildFastRowAccessorWithScratchGeneric<TestSpanRow>(combinedTable);

    const firstScratchRow = accessor.getRowIntoScratch(0);
    const secondScratchRow = accessor.getRowIntoScratch(2);
    const firstScratchValues = accessor.getValuesIntoScratch(1);
    const secondScratchValues = accessor.getValuesIntoScratch(2);

    expect(accessor.totalRows).toBe(3);
    expect(firstScratchRow).toBe(secondScratchRow);
    expect(secondScratchRow).toEqual({
      startTimeMs: 3,
      durationMs: 30,
      processName: 'rank-b'
    });
    expect(firstScratchValues).toBe(secondScratchValues);
    expect(secondScratchValues).toEqual([3, 30, 'rank-b']);
  });
});
