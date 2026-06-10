import * as arrow from 'apache-arrow';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {estimateTraceGraphSize} from './trace-graph-size';

describe('estimateTraceGraphSize', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('estimates Arrow tables when SharedArrayBuffer is unavailable', () => {
    vi.stubGlobal('SharedArrayBuffer', undefined);

    const table = new arrow.Table({
      value: arrow.vectorFromArray([1, 2, 3], new arrow.Float64())
    });

    const report = estimateTraceGraphSize({
      processes: [],
      crossDependencies: [],
      crossDependencyTable: table
    });

    expect(report.totalBytes).toBeGreaterThan(0);
  });

  it('counts Arrow table maps without deep-walking runtime maps in shallow mode', () => {
    const table = new arrow.Table({
      value: arrow.vectorFromArray([1, 2, 3], new arrow.Float64())
    });
    const largeRuntimeMap = new Map<number, {value: string}>();
    for (let index = 0; index < 100; index += 1) {
      largeRuntimeMap.set(index, {value: `entry-${index}`});
    }

    const report = estimateTraceGraphSize(
      {
        processes: [],
        crossDependencies: [],
        processSpanTableMap: {process: table},
        crossProcessEndpointsBySpanRef: largeRuntimeMap
      },
      {maxObjectDepth: 0}
    );

    expect(report.entries.some(entry => entry.path === 'processSpanTableMap.process')).toBe(true);
    expect(
      report.entries.some(entry => entry.path.startsWith('crossProcessEndpointsBySpanRef.value'))
    ).toBe(false);
  });

  it('does not double-count Arrow table buffers through parent table maps', () => {
    const table = new arrow.Table({
      value: arrow.vectorFromArray([1, 2, 3], new arrow.Float64())
    });

    const report = estimateTraceGraphSize(
      {
        processSpanTableMap: {process: table}
      },
      {maxObjectDepth: 0}
    );

    const tableMapEntry = report.entries.find(entry => entry.path === 'processSpanTableMap');
    const tableEntry = report.entries.find(entry => entry.path === 'processSpanTableMap.process');

    expect(tableMapEntry?.kind).toBe('object');
    expect(tableEntry?.kind).toBe('arrow');
    expect(report.totalBytes).toBe((tableMapEntry?.bytes ?? 0) + (tableEntry?.bytes ?? 0));
  });
});
