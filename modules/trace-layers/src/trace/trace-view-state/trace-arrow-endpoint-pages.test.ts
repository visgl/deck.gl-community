import {describe, expect, it, vi} from 'vitest';

import {buildArrowTraceSpanTableFromColumns} from '../ingestion/arrow-trace';
import {
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef
} from '../trace-graph/trace-id-encoder';
import {
  bindTraceArrowTrustedPrimaryEndpointCursorRow,
  buildTraceArrowPrimaryEndpointPages,
  createTraceArrowTrustedPrimaryEndpointCursor,
  fillTraceArrowPrimaryEndpointFields,
  resolveTraceArrowTrustedPrimaryEndpointEndTime
} from './trace-arrow-endpoint-pages';

import type {TraceLayout, TraceLayoutSpanLaneColumn} from '../trace-layout/trace-layout';
import type {TraceArrowPrimaryEndpointFields} from './trace-arrow-endpoint-pages';

describe('trace-arrow-endpoint-pages', () => {
  it('borrows sparse chunk pages and resolves primary endpoint fields without row objects', () => {
    const fixture = createEndpointPageFixture();
    const pages = buildTraceArrowPrimaryEndpointPages(fixture.layout);
    const target = createEndpointTarget();

    expect(pages).not.toBeNull();
    expect([...pages!.pagesByChunkIndex.keys()]).toEqual([2, 9]);
    const secondPage = pages!.pagesByChunkIndex.get(9);
    expect(secondPage?.laneIndexBySpanRefRow).toBe(fixture.lanesByChunkIndex[9]);
    expect(secondPage?.fixedWidthBatches?.[0]?.processRef.values).toBe(
      fixture.secondChunkSpanTable.getChild('process_ref')?.data[0]?.values
    );
    expect(secondPage?.fixedWidthBatches?.[0]?.statusCode.values).toBe(
      fixture.secondChunkSpanTable.getChild('status_code')?.data[0]?.values
    );
    const processRefGetSpy = vi.spyOn(secondPage!.processRefColumn, 'get');
    const threadRefGetSpy = vi.spyOn(secondPage!.threadRefColumn, 'get');
    const statusCodeGetSpy = vi.spyOn(secondPage!.statusCodeColumn, 'get');
    const startTimeMsGetSpy = vi.spyOn(secondPage!.startTimeMsColumn, 'get');
    const endTimeMsGetSpy = vi.spyOn(secondPage!.endTimeMsColumn, 'get');
    expect(fillTraceArrowPrimaryEndpointFields(pages!, encodeSpanRef(9, 1), target)).toBe(true);
    expect(target).toEqual({
      processRef: fixture.processRef,
      threadRef: fixture.threadRef,
      laneIndex: 7,
      startTimeMs: 3,
      endTimeMs: 10,
      sourceEndTimeMs: 3
    });
    expect(processRefGetSpy).not.toHaveBeenCalled();
    expect(threadRefGetSpy).not.toHaveBeenCalled();
    expect(statusCodeGetSpy).not.toHaveBeenCalled();
    expect(startTimeMsGetSpy).not.toHaveBeenCalled();
    expect(endTimeMsGetSpy).not.toHaveBeenCalled();
    processRefGetSpy.mockRestore();
    threadRefGetSpy.mockRestore();
    statusCodeGetSpy.mockRestore();
    startTimeMsGetSpy.mockRestore();
    endTimeMsGetSpy.mockRestore();
  });

  it('reads aligned fixed-width endpoint values across Arrow record batches', () => {
    const fixture = createEndpointPageFixture({secondChunkMode: 'split-batches'});
    const pages = buildTraceArrowPrimaryEndpointPages(fixture.layout);
    const target = createEndpointTarget();
    const secondPage = pages?.pagesByChunkIndex.get(9);
    if (!pages || !secondPage) {
      throw new Error('Expected one generated-primary endpoint page.');
    }
    const processRefGetSpy = vi.spyOn(secondPage.processRefColumn, 'get');
    const threadRefGetSpy = vi.spyOn(secondPage.threadRefColumn, 'get');
    const statusCodeGetSpy = vi.spyOn(secondPage.statusCodeColumn, 'get');
    const startTimeMsGetSpy = vi.spyOn(secondPage.startTimeMsColumn, 'get');
    const endTimeMsGetSpy = vi.spyOn(secondPage.endTimeMsColumn, 'get');

    expect(secondPage.fixedWidthBatches).toHaveLength(2);
    expect(fillTraceArrowPrimaryEndpointFields(pages, encodeSpanRef(9, 1), target)).toBe(true);
    expect(target).toEqual({
      processRef: fixture.processRef,
      threadRef: fixture.threadRef,
      laneIndex: 7,
      startTimeMs: 3,
      endTimeMs: 10,
      sourceEndTimeMs: 3
    });
    expect(processRefGetSpy).not.toHaveBeenCalled();
    expect(threadRefGetSpy).not.toHaveBeenCalled();
    expect(statusCodeGetSpy).not.toHaveBeenCalled();
    expect(startTimeMsGetSpy).not.toHaveBeenCalled();
    expect(endTimeMsGetSpy).not.toHaveBeenCalled();
    processRefGetSpy.mockRestore();
    threadRefGetSpy.mockRestore();
    statusCodeGetSpy.mockRestore();
    startTimeMsGetSpy.mockRestore();
    endTimeMsGetSpy.mockRestore();
  });

  it('binds null-free endpoint pages for raw trusted reads without scalar accessors', () => {
    const fixture = createEndpointPageFixture({secondChunkMode: 'split-batches'});
    const pages = buildTraceArrowPrimaryEndpointPages(fixture.layout);
    const cursor = pages ? createTraceArrowTrustedPrimaryEndpointCursor(pages) : null;
    const secondPage = pages?.pagesByChunkIndex.get(9);
    if (!pages || !cursor || !secondPage) {
      throw new Error('Expected one trusted generated-primary endpoint cursor.');
    }
    const processRefGetSpy = vi.spyOn(secondPage.processRefColumn, 'get');
    const threadRefGetSpy = vi.spyOn(secondPage.threadRefColumn, 'get');
    const statusCodeGetSpy = vi.spyOn(secondPage.statusCodeColumn, 'get');
    const startTimeMsGetSpy = vi.spyOn(secondPage.startTimeMsColumn, 'get');
    const endTimeMsGetSpy = vi.spyOn(secondPage.endTimeMsColumn, 'get');

    const firstLocalRowIndex = bindTraceArrowTrustedPrimaryEndpointCursorRow(cursor, 2, 0);
    const firstPage = cursor.currentPage;
    const firstBatch = cursor.currentBatch;
    if (!firstPage || !firstBatch) {
      throw new Error('Expected one bound first trusted endpoint row.');
    }
    expect({
      processRef: firstBatch.processRef[firstLocalRowIndex],
      threadRef: firstBatch.threadRef[firstLocalRowIndex],
      laneIndex: firstPage.laneIndexBySpanRefRow[0],
      startTimeMs: firstBatch.startTimeMs[firstLocalRowIndex],
      endTimeMs: resolveTraceArrowTrustedPrimaryEndpointEndTime(
        firstBatch.statusCode[firstLocalRowIndex]!,
        firstBatch.startTimeMs[firstLocalRowIndex]!,
        firstBatch.endTimeMs[firstLocalRowIndex]!,
        cursor.maxTimeMs
      ),
      sourceEndTimeMs: firstBatch.endTimeMs[firstLocalRowIndex]
    }).toEqual({
      processRef: fixture.processRef,
      threadRef: fixture.threadRef,
      laneIndex: 0,
      startTimeMs: 1,
      endTimeMs: 2,
      sourceEndTimeMs: 2
    });
    const secondLocalRowIndex = bindTraceArrowTrustedPrimaryEndpointCursorRow(cursor, 9, 1);
    const boundSecondPage = cursor.currentPage;
    const secondBatch = cursor.currentBatch;
    if (!boundSecondPage || !secondBatch) {
      throw new Error('Expected one bound second trusted endpoint row.');
    }
    expect({
      processRef: secondBatch.processRef[secondLocalRowIndex],
      threadRef: secondBatch.threadRef[secondLocalRowIndex],
      laneIndex: boundSecondPage.laneIndexBySpanRefRow[1],
      startTimeMs: secondBatch.startTimeMs[secondLocalRowIndex],
      endTimeMs: resolveTraceArrowTrustedPrimaryEndpointEndTime(
        secondBatch.statusCode[secondLocalRowIndex]!,
        secondBatch.startTimeMs[secondLocalRowIndex]!,
        secondBatch.endTimeMs[secondLocalRowIndex]!,
        cursor.maxTimeMs
      ),
      sourceEndTimeMs: secondBatch.endTimeMs[secondLocalRowIndex]
    }).toEqual({
      processRef: fixture.processRef,
      threadRef: fixture.threadRef,
      laneIndex: 7,
      startTimeMs: 3,
      endTimeMs: 10,
      sourceEndTimeMs: 3
    });
    expect(processRefGetSpy).not.toHaveBeenCalled();
    expect(threadRefGetSpy).not.toHaveBeenCalled();
    expect(statusCodeGetSpy).not.toHaveBeenCalled();
    expect(startTimeMsGetSpy).not.toHaveBeenCalled();
    expect(endTimeMsGetSpy).not.toHaveBeenCalled();
    processRefGetSpy.mockRestore();
    threadRefGetSpy.mockRestore();
    statusCodeGetSpy.mockRestore();
    startTimeMsGetSpy.mockRestore();
    endTimeMsGetSpy.mockRestore();
  });

  it('preserves numeric trusted timing-end semantics without string status decoding', () => {
    expect(resolveTraceArrowTrustedPrimaryEndpointEndTime(0, 3, 3, 10)).toBe(1_003);
    expect(resolveTraceArrowTrustedPrimaryEndpointEndTime(1, 3, 3, 10)).toBe(10);
    expect(resolveTraceArrowTrustedPrimaryEndpointEndTime(2, 3, 3, 10)).toBe(3);
    expect(resolveTraceArrowTrustedPrimaryEndpointEndTime(2, 3, 4, 10)).toBe(4);
    expect(() => resolveTraceArrowTrustedPrimaryEndpointEndTime(9, 3, 3, 10)).toThrow(
      'invalid canonical timing status'
    );
  });

  it('rejects one trusted cursor when any endpoint page is sliced or nullable', () => {
    const fixture = createEndpointPageFixture({secondChunkMode: 'sliced-null'});
    const pages = buildTraceArrowPrimaryEndpointPages(fixture.layout);
    if (!pages) {
      throw new Error('Expected generated-primary endpoint pages.');
    }

    expect(createTraceArrowTrustedPrimaryEndpointCursor(pages)).toBeNull();
  });

  it('keeps sliced fixed-width values and validity offsets aligned', () => {
    const fixture = createEndpointPageFixture({secondChunkMode: 'sliced-null'});
    const pages = buildTraceArrowPrimaryEndpointPages(fixture.layout);
    const target = createEndpointTarget();
    const secondPage = pages?.pagesByChunkIndex.get(9);
    if (!pages || !secondPage) {
      throw new Error('Expected one generated-primary endpoint page.');
    }

    expect(secondPage.fixedWidthBatches?.[0]?.processRef.validityOffset).toBe(1);
    expect(fillTraceArrowPrimaryEndpointFields(pages, encodeSpanRef(9, 0), target)).toBe(false);
    expect(target).toEqual({
      processRef: null,
      threadRef: null,
      laneIndex: -1,
      startTimeMs: 0,
      endTimeMs: 0,
      sourceEndTimeMs: 0
    });
    expect(fillTraceArrowPrimaryEndpointFields(pages, encodeSpanRef(9, 1), target)).toBe(true);
    expect(target).toEqual({
      processRef: fixture.processRef,
      threadRef: fixture.threadRef,
      laneIndex: 7,
      startTimeMs: 3,
      endTimeMs: 10,
      sourceEndTimeMs: 3
    });
  });

  it('falls back to scalar columns when fixed-width Arrow batches are unsupported', () => {
    const fixture = createEndpointPageFixture();
    const originalGetChild = fixture.secondChunkSpanTable.getChild.bind(
      fixture.secondChunkSpanTable
    );
    const startTimeMsGet = vi.fn((rowIndex: number) =>
      originalGetChild('start_time_ms')?.get(rowIndex)
    );
    const getChildSpy = vi
      .spyOn(fixture.secondChunkSpanTable, 'getChild')
      .mockImplementation(name => {
        const column = originalGetChild(name);
        return name === 'start_time_ms' && column
          ? ({get: startTimeMsGet, data: []} as never)
          : column;
      });
    const pages = buildTraceArrowPrimaryEndpointPages(fixture.layout);
    const target = createEndpointTarget();
    const secondPage = pages?.pagesByChunkIndex.get(9);
    if (!pages || !secondPage) {
      throw new Error('Expected one generated-primary endpoint page.');
    }

    expect(secondPage.fixedWidthBatches).toBeNull();
    expect(fillTraceArrowPrimaryEndpointFields(pages, encodeSpanRef(9, 1), target)).toBe(true);
    expect(startTimeMsGet).toHaveBeenCalledWith(1);
    getChildSpy.mockRestore();
  });

  it('clears caller-owned fields when a sparse page or row cannot resolve', () => {
    const fixture = createEndpointPageFixture();
    const pages = buildTraceArrowPrimaryEndpointPages(fixture.layout);
    const target = {
      processRef: fixture.processRef,
      threadRef: fixture.threadRef,
      laneIndex: 99,
      startTimeMs: 99,
      endTimeMs: 99,
      sourceEndTimeMs: 99
    } satisfies TraceArrowPrimaryEndpointFields;

    expect(pages).not.toBeNull();
    expect(fillTraceArrowPrimaryEndpointFields(pages!, encodeSpanRef(5, 0), target)).toBe(false);
    expect(target).toEqual({
      processRef: null,
      threadRef: null,
      laneIndex: -1,
      startTimeMs: 0,
      endTimeMs: 0,
      sourceEndTimeMs: 0
    });
    expect(fillTraceArrowPrimaryEndpointFields(pages!, encodeSpanRef(9, 4), target)).toBe(false);
  });

  it('returns null for filtered, manual, secondary-timing, or incomplete lane layouts', () => {
    expect(
      buildTraceArrowPrimaryEndpointPages(createEndpointPageFixture({filtered: true}).layout)
    ).toBeNull();
    expect(
      buildTraceArrowPrimaryEndpointPages(createEndpointPageFixture({spanLayout: 'manual'}).layout)
    ).toBeNull();
    expect(
      buildTraceArrowPrimaryEndpointPages(
        createEndpointPageFixture({timingKey: 'secondary'}).layout
      )
    ).toBeNull();
    expect(
      buildTraceArrowPrimaryEndpointPages(
        createEndpointPageFixture({withPrimaryTimingSidecars: true}).layout
      )
    ).not.toBeNull();
    expect(
      buildTraceArrowPrimaryEndpointPages(createEndpointPageFixture({omitLaneChunkIndex: 9}).layout)
    ).toBeNull();
  });
});

/** Creates one caller-owned endpoint target with the documented failed-fill sentinel values. */
function createEndpointTarget(): TraceArrowPrimaryEndpointFields {
  return {
    processRef: null,
    threadRef: null,
    laneIndex: -1,
    startTimeMs: 0,
    endTimeMs: 0,
    sourceEndTimeMs: 0
  };
}

/** Creates sparse canonical chunk fixtures without requiring a retained runtime graph cache. */
function createEndpointPageFixture(options?: {
  /** Whether the mock graph reports a filtered visible projection. */
  filtered?: boolean;
  /** Span layout mode exposed by the mock graph. */
  spanLayout?: 'auto' | 'manual';
  /** Optional non-primary layout timing projection. */
  timingKey?: string;
  /** Whether unrelated primary timing sidecars should be present on the mock graph. */
  withPrimaryTimingSidecars?: boolean;
  /** Optional sparse chunk whose generated lane page should be omitted. */
  omitLaneChunkIndex?: number;
  /** Optional second-chunk Arrow batch shape used by fixed-width endpoint tests. */
  secondChunkMode?: 'default' | 'split-batches' | 'sliced-null';
}): {
  layout: TraceLayout;
  processRef: ReturnType<typeof encodeProcessRef>;
  threadRef: ReturnType<typeof encodeProcessThreadRef>;
  lanesByChunkIndex: Readonly<Record<number, Int32Array>>;
  secondChunkSpanTable: ReturnType<typeof buildArrowTraceSpanTableFromColumns>;
} {
  const processRef = encodeProcessRef(1);
  const threadRef = encodeProcessThreadRef(1, 0);
  const firstChunkSpanTable = buildArrowTraceSpanTableFromColumns({
    process_ref: [processRef],
    thread_ref: [threadRef],
    span_id: ['span-2-0'],
    thread_id: ['thread-1'],
    name: ['span 2 0'],
    primary_timing_key: ['primary'],
    status: ['finished'],
    start_time_ms: [1],
    end_time_ms: [2],
    duration_ms: [1]
  });
  const secondChunkSpanTable = buildSecondEndpointPageSpanTable({
    processRef,
    threadRef,
    mode: options?.secondChunkMode ?? 'default'
  });
  const lanesByChunkIndex = {
    2: new Int32Array([0]),
    9: new Int32Array([4, 7])
  };
  const timingSidecar = options?.withPrimaryTimingSidecars
    ? {getChild: (name: string) => (name === 'timings' ? {} : null)}
    : undefined;
  const spanLaneColumnsByChunkIndex = new Map<number, TraceLayoutSpanLaneColumn>();
  for (const [chunkIndex, values] of Object.entries(lanesByChunkIndex)) {
    const numericChunkIndex = Number(chunkIndex);
    if (options?.omitLaneChunkIndex === numericChunkIndex) {
      continue;
    }
    spanLaneColumnsByChunkIndex.set(numericChunkIndex, {
      values
    });
  }
  const traceGraph = {
    hasActiveSpanFilter: () => options?.filtered === true,
    spanLayout: options?.spanLayout ?? 'auto',
    maxTimeMs: 10,
    spanSidecarTableMap: timingSidecar ? {rank: timingSidecar} : undefined,
    chunks: [
      {chunkIndex: 2, spanTable: firstChunkSpanTable, spanSidecarTable: timingSidecar},
      {chunkIndex: 9, spanTable: secondChunkSpanTable, spanSidecarTable: timingSidecar}
    ]
  };
  return {
    layout: {
      traceGraph,
      spanLaneColumnsByChunkIndex,
      layoutConfiguration: options?.timingKey == null ? undefined : {timingKey: options.timingKey}
    } as unknown as TraceLayout,
    processRef,
    threadRef,
    lanesByChunkIndex,
    secondChunkSpanTable
  };
}

/** Builds one second sparse chunk with the Arrow batch shape requested by a page test. */
function buildSecondEndpointPageSpanTable(params: {
  /** Canonical process ref encoded into every valid second-chunk row. */
  processRef: ReturnType<typeof encodeProcessRef>;
  /** Canonical thread ref encoded into every second-chunk row. */
  threadRef: ReturnType<typeof encodeProcessThreadRef>;
  /** Arrow batch/slice shape needed by the current fixed-width page test. */
  mode: 'default' | 'split-batches' | 'sliced-null';
}): ReturnType<typeof buildArrowTraceSpanTableFromColumns> {
  if (params.mode === 'split-batches') {
    const firstBatch = buildArrowTraceSpanTableFromColumns({
      process_ref: [params.processRef],
      thread_ref: [params.threadRef],
      span_id: ['span-9-0'],
      thread_id: ['thread-1'],
      name: ['span 9 0'],
      primary_timing_key: ['primary'],
      status: ['finished'],
      start_time_ms: [2],
      end_time_ms: [4],
      duration_ms: [2]
    });
    const secondBatch = buildArrowTraceSpanTableFromColumns({
      process_ref: [params.processRef],
      thread_ref: [params.threadRef],
      span_id: ['span-9-1'],
      thread_id: ['thread-1'],
      name: ['span 9 1'],
      primary_timing_key: ['primary'],
      status: ['not-finished'],
      start_time_ms: [3],
      end_time_ms: [3],
      duration_ms: [0]
    });
    return firstBatch.concat(secondBatch) as ReturnType<typeof buildArrowTraceSpanTableFromColumns>;
  }
  if (params.mode === 'sliced-null') {
    const sourceTable = buildArrowTraceSpanTableFromColumns({
      process_ref: [params.processRef, null, params.processRef],
      thread_ref: [params.threadRef, params.threadRef, params.threadRef],
      span_id: ['ignored-span', 'span-9-0', 'span-9-1'],
      thread_id: ['thread-1', 'thread-1', 'thread-1'],
      name: ['ignored span', 'span 9 0', 'span 9 1'],
      primary_timing_key: ['primary', 'primary', 'primary'],
      status: ['finished', 'finished', 'not-finished'],
      start_time_ms: [0, 2, 3],
      end_time_ms: [1, 4, 3],
      duration_ms: [1, 2, 0]
    });
    return sourceTable.slice(1, 3) as ReturnType<typeof buildArrowTraceSpanTableFromColumns>;
  }
  return buildArrowTraceSpanTableFromColumns({
    process_ref: [params.processRef, params.processRef],
    thread_ref: [params.threadRef, params.threadRef],
    span_id: ['span-9-0', 'span-9-1'],
    thread_id: ['thread-1', 'thread-1'],
    name: ['span 9 0', 'span 9 1'],
    primary_timing_key: ['primary', 'primary'],
    status: ['finished', 'not-finished'],
    start_time_ms: [2, 3],
    end_time_ms: [4, 3],
    duration_ms: [2, 0]
  });
}
