import {describe, expect, it, vi} from 'vitest';

import {buildArrowTraceSameProcessDependencyTableFromColumns} from '../ingestion/arrow-trace';
import {
  buildSyntheticArrowTraceFixture,
  SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME
} from '../test-stubs/synthetic-arrow-trace';
import {buildTraceDatasetFromReadyTraceChunks} from '../trace-chunk-graph-assembler';
import {
  encodeLocalSpanRef,
  encodeSameProcessDependencyRef,
  encodeSpanRef
} from '../trace-graph/trace-id-encoder';
import {buildTraceViewSnapshot} from '../trace-view-snapshot';
import {
  buildTraceDenseSameProcessDependencyRefSource,
  buildTraceDenseSpanRefSource
} from './trace-ref-source';

describe('buildTraceDenseSpanRefSource', () => {
  it('resolves boundary indexes without materializing the full range sequence', () => {
    const source = buildTraceDenseSpanRefSource([
      {chunkIndex: 2, rowStart: 3, rowCount: 2},
      {chunkIndex: 9, rowStart: 1, rowCount: 3}
    ]);

    expect(source.length).toBe(5);
    expect(source.at(-1)).toBeUndefined();
    expect(source.at(0)).toBe(encodeSpanRef(2, 3));
    expect(source.at(1)).toBe(encodeSpanRef(2, 4));
    expect(source.at(2)).toBe(encodeSpanRef(9, 1));
    expect(source.at(4)).toBe(encodeSpanRef(9, 3));
    expect(source.at(5)).toBeUndefined();
    expect(source.at(1.5)).toBeUndefined();
    expect(source.denseRanges).toEqual([
      {chunkIndex: 2, rowStart: 3, rowCount: 2, outputStart: 0},
      {chunkIndex: 9, rowStart: 1, rowCount: 3, outputStart: 2}
    ]);
    expect(Array.from(source)).toEqual([
      encodeSpanRef(2, 3),
      encodeSpanRef(2, 4),
      encodeSpanRef(9, 1),
      encodeSpanRef(9, 2),
      encodeSpanRef(9, 3)
    ]);
  });

  it('borrows chunk-local filter masks and compacts visible rows without ref arrays', () => {
    const firstChunkFilterMask = new Uint8Array([0, 4, 0, 1, 0, 0]);
    const secondChunkFilterMask = new Uint8Array([0, 0, 2]);
    const source = buildTraceDenseSpanRefSource([
      {
        chunkIndex: 2,
        rowStart: 1,
        rowCount: 4,
        filterMaskByRow: firstChunkFilterMask
      },
      {
        chunkIndex: 9,
        rowStart: 0,
        rowCount: 3,
        filterMaskByRow: secondChunkFilterMask
      }
    ]);

    expect(Array.isArray(source)).toBe(false);
    expect(source.length).toBe(4);
    expect(source.denseRanges).toHaveLength(2);
    expect(source.denseRanges?.[0]?.filterMaskByRow).toBe(firstChunkFilterMask);
    expect(source.denseRanges?.[0]?.visibleRowCount).toBe(2);
    expect(source.denseRanges?.[1]?.filterMaskByRow).toBe(secondChunkFilterMask);
    expect(source.denseRanges?.[1]?.visibleRowCount).toBe(2);
    expect(source.denseRanges?.[1]?.outputStart).toBe(2);
    expect(source.at(-1)).toBeUndefined();
    expect(source.at(0)).toBe(encodeSpanRef(2, 2));
    expect(source.at(1)).toBe(encodeSpanRef(2, 4));
    expect(source.at(2)).toBe(encodeSpanRef(9, 0));
    expect(source.at(3)).toBe(encodeSpanRef(9, 1));
    expect(source.at(4)).toBeUndefined();
    expect(Array.from(source)).toEqual([
      encodeSpanRef(2, 2),
      encodeSpanRef(2, 4),
      encodeSpanRef(9, 0),
      encodeSpanRef(9, 1)
    ]);
  });

  it('drops fully hidden masked ranges from the compacted source', () => {
    const source = buildTraceDenseSpanRefSource([
      {
        chunkIndex: 2,
        rowStart: 1,
        rowCount: 2,
        filterMaskByRow: new Uint8Array([0, 1, 2])
      },
      {chunkIndex: 9, rowStart: 1, rowCount: 1}
    ]);

    expect(source.length).toBe(1);
    expect(source.denseRanges).toEqual([{chunkIndex: 9, rowStart: 1, rowCount: 1, outputStart: 0}]);
    expect(Array.from(source)).toEqual([encodeSpanRef(9, 1)]);
  });

  it('rejects invalid or non-canonical dense range descriptors', () => {
    expect(() => buildTraceDenseSpanRefSource([{chunkIndex: 0, rowStart: 0, rowCount: 0}])).toThrow(
      'Dense span-ref ranges must be positive, canonical, and chunk-sorted.'
    );
    expect(() =>
      buildTraceDenseSpanRefSource([
        {chunkIndex: 2, rowStart: 0, rowCount: 1},
        {chunkIndex: 2, rowStart: 1, rowCount: 1}
      ])
    ).toThrow('Dense span-ref ranges must be positive, canonical, and chunk-sorted.');
    expect(() =>
      buildTraceDenseSpanRefSource([{chunkIndex: 0, rowStart: -1, rowCount: 1}])
    ).toThrow('Dense span-ref ranges must be positive, canonical, and chunk-sorted.');
    expect(() =>
      buildTraceDenseSpanRefSource([
        {
          chunkIndex: 0,
          rowStart: 1,
          rowCount: 2,
          filterMaskByRow: new Uint8Array(2)
        }
      ])
    ).toThrow('Dense span-ref filter masks must cover their canonical chunk range.');
  });
});

describe('buildTraceDenseSameProcessDependencyRefSource', () => {
  it('synthesizes canonical table-order refs without retaining a ref array', () => {
    const source = buildTraceDenseSameProcessDependencyRefSource(3, 4);
    const expected = Array.from({length: 4}, (_, rowIndex) =>
      encodeSameProcessDependencyRef(encodeLocalSpanRef(3, rowIndex))
    );

    expect(Array.isArray(source)).toBe(false);
    expect(Object.isFrozen(source)).toBe(true);
    expect(source.denseProcessIndex).toBe(3);
    expect(source.denseVisibility).toBeUndefined();
    expect(source.length).toBe(expected.length);
    expect(source.at(-1)).toBeUndefined();
    expect(source.at(0)).toBe(expected[0]);
    expect(source.at(3)).toBe(expected[3]);
    expect(source.at(4)).toBeUndefined();
    expect(source.at(1.5)).toBeUndefined();
    expect(Array.from(source)).toEqual(expected);
  });

  it('borrows text-filter snapshot columns and compacts hidden dependency endpoints', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'dense-dependency-ref-text-mask',
      processCount: 1,
      rowCount: 6,
      textFilterMatchEvery: 2
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'dense-dependency-ref-text-mask',
      ...fixture.materializationInputs
    });
    const traceViewSnapshot = buildTraceViewSnapshot(traceDataset, {
      spanFilters: [SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME]
    });
    const dependencyTable = buildArrowTraceSameProcessDependencyTableFromColumns({
      startSpanRef: [
        encodeSpanRef(0, 1),
        encodeSpanRef(0, 0),
        encodeSpanRef(0, 3),
        encodeSpanRef(0, 5)
      ],
      endSpanRef: [
        encodeSpanRef(0, 3),
        encodeSpanRef(0, 1),
        encodeSpanRef(0, 5),
        encodeSpanRef(0, 4)
      ],
      waitMode: Array(4).fill('end-to-start'),
      bidirectional: Array(4).fill(false),
      waitTimeMs: Array(4).fill(0),
      hasParentKeyword: Array(4).fill(false)
    });
    const startSpanRef = dependencyTable.getChild('startSpanRef');
    const endSpanRef = dependencyTable.getChild('endSpanRef');
    if (!startSpanRef || !endSpanRef) {
      throw new Error('Expected canonical endpoint columns.');
    }
    const startGetSpy = vi.spyOn(startSpanRef, 'get');
    const endGetSpy = vi.spyOn(endSpanRef, 'get');
    const source = buildTraceDenseSameProcessDependencyRefSource(0, dependencyTable.numRows, {
      dependencyTable,
      traceViewSnapshot
    });
    expect(startGetSpy).not.toHaveBeenCalled();
    expect(endGetSpy).not.toHaveBeenCalled();
    const scalarOnlyDependencyTable = {
      numRows: dependencyTable.numRows,
      getChild(columnName: string) {
        const column = dependencyTable.getChild(columnName);
        return columnName === 'startSpanRef' || columnName === 'endSpanRef'
          ? column && {get: (rowIndex: number) => column.get(rowIndex)}
          : column;
      }
    } as unknown as typeof dependencyTable;
    const fallbackSource = buildTraceDenseSameProcessDependencyRefSource(
      0,
      scalarOnlyDependencyTable.numRows,
      {
        dependencyTable: scalarOnlyDependencyTable,
        traceViewSnapshot
      }
    );
    const expected = [0, 2].map(rowIndex =>
      encodeSameProcessDependencyRef(encodeLocalSpanRef(0, rowIndex))
    );

    expect(Array.isArray(source)).toBe(false);
    expect(Object.isFrozen(source)).toBe(true);
    expect(source.denseProcessIndex).toBe(0);
    expect(source.denseVisibility?.dependencyTable).toBe(dependencyTable);
    expect(source.denseVisibility?.traceViewSnapshot).toBe(traceViewSnapshot);
    expect(source.length).toBe(expected.length);
    expect(source.at(-1)).toBeUndefined();
    expect(source.at(0)).toBe(expected[0]);
    expect(source.at(1)).toBe(expected[1]);
    expect(source.at(2)).toBeUndefined();
    expect(source.at(0.5)).toBeUndefined();
    expect(Array.from(source)).toEqual(expected);
    expect(fallbackSource.length).toBe(source.length);
    expect(Array.from(fallbackSource)).toEqual(expected);
  });

  it('rejects mismatched canonical dependency tables', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'dense-dependency-ref-mismatched-table',
      processCount: 1,
      rowCount: 2
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'dense-dependency-ref-mismatched-table',
      ...fixture.materializationInputs
    });
    const dependencyTable = buildArrowTraceSameProcessDependencyTableFromColumns({
      startSpanRef: [encodeSpanRef(0, 0)],
      endSpanRef: [encodeSpanRef(0, 1)],
      waitMode: ['end-to-start'],
      bidirectional: [false],
      waitTimeMs: [0],
      hasParentKeyword: [false]
    });

    expect(() =>
      buildTraceDenseSameProcessDependencyRefSource(0, dependencyTable.numRows + 1, {
        dependencyTable,
        traceViewSnapshot: buildTraceViewSnapshot(traceDataset)
      })
    ).toThrow('Dense masked dependency-ref sources require a matching table.');
  });

  it('rejects invalid dense process indexes and row counts', () => {
    expect(() => buildTraceDenseSameProcessDependencyRefSource(-1, 1)).toThrow(
      'Dense dependency-ref sources require a valid process index and row count.'
    );
    expect(() => buildTraceDenseSameProcessDependencyRefSource(0, -1)).toThrow(
      'Dense dependency-ref sources require a valid process index and row count.'
    );
  });
});
