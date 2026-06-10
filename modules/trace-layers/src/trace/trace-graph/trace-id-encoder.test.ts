import {describe, expect, it} from 'vitest';

import {
  CROSS_DEPENDENCY_REF_OFFSET,
  decodeChunkRef,
  decodeCrossDependencyRef,
  decodeLocalDependencySpanRef,
  decodeTaggedLocalDependencyRef,
  decodeTraceRef,
  decodeTraceRefInto,
  encodeChunkRef,
  encodeCounterRef,
  encodeCounterRefFromChunkRow,
  encodeCrossDependencyRef,
  encodeEventRef,
  encodeEventRefFromChunkRow,
  encodeInstantRef,
  encodeInstantRefFromChunkRow,
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef,
  encodeVisibleCrossDependencyRef,
  encodeVisibleLocalDependencyRef,
  getChunkRefIndex,
  getCounterRefChunkIndex,
  getCounterRefIndex,
  getCounterRefRowIndex,
  getCrossDependencyRefChunkIndex,
  getCrossDependencyRefIndex,
  getCrossDependencyRefRowIndex,
  getEventRefChunkIndex,
  getEventRefIndex,
  getEventRefRowIndex,
  getInstantRefChunkIndex,
  getInstantRefIndex,
  getInstantRefRowIndex,
  getLocalDependencyRefPayload,
  getLocalDependencyRefProcessIndex,
  getLocalDependencyRefRowIndex,
  getProcessRefIndex,
  getSpanRefChunkIndex,
  getSpanRefProcessId,
  getSpanRefRowIndex,
  getThreadRefPayload,
  getThreadRefProcessIndex,
  getThreadRefThreadIndex,
  getTraceRefKind,
  getVisibleCrossDependencyRefIndex,
  getVisibleLocalDependencyRefIndex,
  isChunkRef,
  LOCAL_DEPENDENCY_REF_OFFSET,
  MAX_CHUNK_REF_INDEX,
  MAX_CHUNK_ROW_ENTITY_REF_ROW_INDEX,
  MAX_COUNTER_REF_CHUNK_INDEX,
  MAX_EVENT_REF_CHUNK_INDEX,
  MAX_INSTANT_REF_CHUNK_INDEX,
  MAX_SPAN_REF_CHUNK_INDEX,
  MAX_SPAN_REF_ROW_INDEX,
  PROCESS_REF_OFFSET,
  THREAD_REF_OFFSET,
  TraceIdEncoder
} from './trace-id-encoder';

import type {TraceRefDecodeScratch} from './trace-id-encoder';
import type {TraceProcessId} from './trace-types';

describe('trace-id-encoder', () => {
  it('assigns stable process indexes and round-trips packed span refs', () => {
    const encoder = new TraceIdEncoder();
    const rank1 = 'rank-1' as TraceProcessId;
    const rank2 = 'rank-2' as TraceProcessId;

    expect(encoder.getProcessIndex(rank1)).toBe(0);
    expect(encoder.getProcessIndex(rank2)).toBe(1);
    expect(encoder.getProcessIndex(rank1)).toBe(0);

    const spanRef = encoder.getSpanRef(rank2, 42);

    expect(getSpanRefChunkIndex(spanRef)).toBe(1);
    expect(getSpanRefRowIndex(spanRef)).toBe(42);
    expect(encoder.getProcessIdFromSpanRef(spanRef)).toBe(rank2);
    expect(getSpanRefProcessId(encoder.getProcessIdsByIndex(), spanRef)).toBe(rank2);
    expect(encoder.getRowFromSpanRef(spanRef)).toBe(42);
  });

  it('round-trips row indexes above the previous 16-bit limit', () => {
    const spanRef = encodeSpanRef(7, 65_536);

    expect(getSpanRefChunkIndex(spanRef)).toBe(7);
    expect(getSpanRefRowIndex(spanRef)).toBe(65_536);
  });

  it('throws when packing a chunk index or row index outside the safe packed range', () => {
    expect(() => encodeSpanRef(MAX_SPAN_REF_CHUNK_INDEX + 1, 0)).toThrow(/chunkIndex/);
    expect(() => encodeSpanRef(0, MAX_SPAN_REF_ROW_INDEX + 1)).toThrow(/rowIndex/);
  });

  it('round-trips chunk refs', () => {
    const chunkRef = encodeChunkRef(12);

    expect(isChunkRef(chunkRef)).toBe(true);
    expect(getChunkRefIndex(chunkRef)).toBe(12);
    expect(decodeChunkRef(chunkRef)).toBe(12);
    expect(getTraceRefKind(chunkRef)).toBe('chunk');
    expect(decodeTraceRef(chunkRef)).toMatchObject({
      kind: 'chunk',
      chunkIndex: 12,
      index: 12
    });
    expect(() => encodeChunkRef(MAX_CHUNK_REF_INDEX + 1)).toThrow(/chunk ref index/);
  });

  it('round-trips directional local dependency refs from span refs', () => {
    const spanRef = encodeLocalSpanRef(2, 7);
    const encoded = encodeLocalDependencyRef(spanRef);
    expect(encoded).toBeGreaterThanOrEqual(LOCAL_DEPENDENCY_REF_OFFSET);
    expect(encoded).toBeLessThan(CROSS_DEPENDENCY_REF_OFFSET);
    expect(decodeLocalDependencySpanRef(encoded)).toBe(spanRef);
    expect(decodeTaggedLocalDependencyRef(encoded, 10)).toBe(7);
    expect(decodeTaggedLocalDependencyRef(encoded, 7)).toBeNull();
    expect(decodeTaggedLocalDependencyRef(7, 10)).toBeNull();
  });

  it('rejects raw local dependency row indexes', () => {
    expect(decodeTaggedLocalDependencyRef(0, 4)).toBeNull();
    expect(decodeTaggedLocalDependencyRef(3, 4)).toBeNull();
    expect(decodeTaggedLocalDependencyRef(4, 4)).toBeNull();
    expect(decodeTaggedLocalDependencyRef(-1, 4)).toBeNull();
  });

  it('round-trips cross dependency refs and rejects local-style values', () => {
    const encodedCross = encodeCrossDependencyRef(21);
    expect(encodedCross).toBeGreaterThanOrEqual(CROSS_DEPENDENCY_REF_OFFSET);
    expect(decodeCrossDependencyRef(encodedCross)).toBe(21);
    expect(decodeCrossDependencyRef(LOCAL_DEPENDENCY_REF_OFFSET)).toBeNull();
    expect(decodeCrossDependencyRef(21)).toBeNull();
  });

  it('packs chunk-row entity refs for events, instants, and counters', () => {
    const eventRef = encodeEventRefFromChunkRow(7, 11);
    const instantRef = encodeInstantRefFromChunkRow(8, 12);
    const counterRef = encodeCounterRefFromChunkRow(9, 13);

    expect(getEventRefChunkIndex(eventRef)).toBe(7);
    expect(getEventRefRowIndex(eventRef)).toBe(11);
    expect(getInstantRefChunkIndex(instantRef)).toBe(8);
    expect(getInstantRefRowIndex(instantRef)).toBe(12);
    expect(getCounterRefChunkIndex(counterRef)).toBe(9);
    expect(getCounterRefRowIndex(counterRef)).toBe(13);

    expect(() => encodeEventRefFromChunkRow(MAX_EVENT_REF_CHUNK_INDEX + 1, 0)).toThrow(
      /event chunkIndex/
    );
    expect(() => encodeInstantRefFromChunkRow(MAX_INSTANT_REF_CHUNK_INDEX + 1, 0)).toThrow(
      /instant chunkIndex/
    );
    expect(() => encodeCounterRefFromChunkRow(MAX_COUNTER_REF_CHUNK_INDEX + 1, 0)).toThrow(
      /counter chunkIndex/
    );
    expect(() => encodeCounterRefFromChunkRow(0, MAX_CHUNK_ROW_ENTITY_REF_ROW_INDEX + 1)).toThrow(
      /counter rowIndex/
    );
  });

  it('classifies refs with high-order numeric prefixes', () => {
    const spanRef = encodeLocalSpanRef(2, 7);
    const localDependencyRef = encodeLocalDependencyRef(spanRef);
    const eventRef = encodeEventRef(21);
    const crossDependencyRef = encodeCrossDependencyRef(42);
    const threadRef = encodeProcessThreadRef(2, 3);
    const processRef = encodeProcessRef(2);
    const chunkRef = encodeChunkRef(2);
    const instantRef = encodeInstantRef(3);
    const counterRef = encodeCounterRef(4);
    const visibleLocalDependencyRef = encodeVisibleLocalDependencyRef(5);
    const visibleCrossDependencyRef = encodeVisibleCrossDependencyRef(6);

    expect(getTraceRefKind(spanRef)).toBe('span');
    expect(getTraceRefKind(localDependencyRef)).toBe('localDependency');
    expect(getTraceRefKind(eventRef)).toBe('event');
    expect(getTraceRefKind(crossDependencyRef)).toBe('crossDependency');
    expect(getTraceRefKind(threadRef)).toBe('thread');
    expect(getTraceRefKind(processRef)).toBe('process');
    expect(getTraceRefKind(chunkRef)).toBe('chunk');
    expect(getTraceRefKind(instantRef)).toBe('instant');
    expect(getTraceRefKind(counterRef)).toBe('counter');
    expect(getTraceRefKind(visibleLocalDependencyRef)).toBe('visibleLocalDependency');
    expect(getTraceRefKind(visibleCrossDependencyRef)).toBe('visibleCrossDependency');

    expect(decodeTraceRef(spanRef)).toMatchObject({
      kind: 'span',
      chunkIndex: 2,
      rowIndex: 7
    });
    expect(decodeTraceRef(localDependencyRef)).toMatchObject({
      kind: 'localDependency',
      processIndex: 2,
      chunkIndex: 2,
      rowIndex: 7
    });
    expect(decodeTraceRef(eventRef)).toMatchObject({
      kind: 'event',
      chunkIndex: 0,
      rowIndex: 21
    });
    expect(decodeTraceRef(crossDependencyRef)).toMatchObject({
      kind: 'crossDependency',
      chunkIndex: 0,
      rowIndex: 42
    });
    expect(decodeTraceRef(threadRef)).toMatchObject({
      kind: 'thread',
      processIndex: 2,
      threadIndex: 3
    });
    expect(decodeTraceRef(processRef)).toMatchObject({
      kind: 'process',
      processIndex: 2
    });
    expect(decodeTraceRef(instantRef)).toMatchObject({
      kind: 'instant',
      chunkIndex: 0,
      rowIndex: 3
    });
    expect(decodeTraceRef(counterRef)).toMatchObject({
      kind: 'counter',
      chunkIndex: 0,
      rowIndex: 4
    });
  });

  it('exposes direct allocation-free field accessors for every ref family', () => {
    const spanRef = encodeSpanRef(9, 17);
    const localSpanRef = encodeLocalSpanRef(9, 17);
    const localDependencyRef = encodeLocalDependencyRef(localSpanRef);
    const eventRef = encodeEventRef(21);
    const crossDependencyRef = encodeCrossDependencyRef(42);
    const threadRef = encodeProcessThreadRef(6, 8);
    const processRef = encodeProcessRef(6);
    const instantRef = encodeInstantRef(3);
    const counterRef = encodeCounterRef(4);
    const visibleLocalDependencyRef = encodeVisibleLocalDependencyRef(5);
    const visibleCrossDependencyRef = encodeVisibleCrossDependencyRef(6);

    expect(getSpanRefChunkIndex(spanRef)).toBe(9);
    expect(getSpanRefRowIndex(spanRef)).toBe(17);
    expect(getLocalDependencyRefPayload(localDependencyRef)).toBe(localSpanRef);
    expect(getLocalDependencyRefProcessIndex(localDependencyRef)).toBe(9);
    expect(getLocalDependencyRefRowIndex(localDependencyRef)).toBe(17);
    expect(getEventRefIndex(eventRef)).toBe(21);
    expect(getEventRefChunkIndex(eventRef)).toBe(0);
    expect(getEventRefRowIndex(eventRef)).toBe(21);
    expect(getCrossDependencyRefIndex(crossDependencyRef)).toBe(42);
    expect(getCrossDependencyRefChunkIndex(crossDependencyRef)).toBe(0);
    expect(getCrossDependencyRefRowIndex(crossDependencyRef)).toBe(42);
    expect(getThreadRefPayload(threadRef)).toBeGreaterThan(0);
    expect(getThreadRefProcessIndex(threadRef)).toBe(6);
    expect(getThreadRefThreadIndex(threadRef)).toBe(8);
    expect(getProcessRefIndex(processRef)).toBe(6);
    expect(getInstantRefIndex(instantRef)).toBe(3);
    expect(getInstantRefChunkIndex(instantRef)).toBe(0);
    expect(getInstantRefRowIndex(instantRef)).toBe(3);
    expect(getCounterRefIndex(counterRef)).toBe(4);
    expect(getCounterRefChunkIndex(counterRef)).toBe(0);
    expect(getCounterRefRowIndex(counterRef)).toBe(4);
    expect(getVisibleLocalDependencyRefIndex(visibleLocalDependencyRef)).toBe(5);
    expect(getVisibleCrossDependencyRefIndex(visibleCrossDependencyRef)).toBe(6);
  });

  it('decodes into caller-owned scratch without allocating a decoded object', () => {
    const scratch: TraceRefDecodeScratch = {
      kind: null,
      ref: -1,
      chunkIndex: -1,
      rowIndex: -1,
      processIndex: -1,
      threadIndex: -1,
      index: -1
    };
    const spanRef = encodeSpanRef(2, 7);
    const localDependencyRef = encodeLocalDependencyRef(encodeLocalSpanRef(4, 5));
    const threadRef = encodeProcessThreadRef(2, 3);

    expect(decodeTraceRefInto(spanRef, scratch)).toBe(true);
    expect(scratch).toMatchObject({
      kind: 'span',
      ref: spanRef,
      chunkIndex: 2,
      rowIndex: 7
    });

    expect(decodeTraceRefInto(localDependencyRef, scratch)).toBe(true);
    expect(scratch).toMatchObject({
      kind: 'localDependency',
      ref: localDependencyRef,
      processIndex: 4,
      chunkIndex: 4,
      rowIndex: 5
    });

    expect(decodeTraceRefInto(threadRef, scratch)).toBe(true);
    expect(scratch).toMatchObject({
      kind: 'thread',
      ref: threadRef,
      processIndex: 2,
      threadIndex: 3,
      index: getThreadRefPayload(threadRef)
    });

    expect(decodeTraceRefInto(-1, scratch)).toBe(false);
    expect(scratch).toMatchObject({
      kind: null,
      ref: -1
    });
  });

  it('keeps process and thread refs out of the span numeric range', () => {
    expect(encodeProcessRef(0)).toBeGreaterThanOrEqual(PROCESS_REF_OFFSET);
    expect(encodeProcessThreadRef(0, 0)).toBeGreaterThanOrEqual(THREAD_REF_OFFSET);
    expect(getTraceRefKind(encodeProcessRef(0))).toBe('process');
    expect(getTraceRefKind(encodeProcessThreadRef(0, 0))).toBe('thread');
  });
});
