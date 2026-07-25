import {describe, expect, it} from 'vitest';

import {
  CROSS_PROCESS_DEPENDENCY_REF_OFFSET,
  decodeChunkRef,
  decodeCrossProcessDependencyRef,
  decodeSameProcessDependencySpanRef,
  decodeTaggedSameProcessDependencyRef,
  decodeTraceRef,
  decodeTraceRefInto,
  encodeChunkRef,
  encodeCounterRef,
  encodeCounterRefFromChunkRow,
  encodeCrossProcessDependencyRef,
  encodeEventRef,
  encodeEventRefFromChunkRow,
  encodeInstantRef,
  encodeInstantRefFromChunkRow,
  encodeLocalSpanRef,
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSameProcessDependencyRef,
  encodeSpanRef,
  getChunkRefIndex,
  getCounterRefChunkIndex,
  getCounterRefIndex,
  getCounterRefRowIndex,
  getCrossProcessDependencyRefChunkIndex,
  getCrossProcessDependencyRefIndex,
  getCrossProcessDependencyRefRowIndex,
  getEventRefChunkIndex,
  getEventRefIndex,
  getEventRefRowIndex,
  getInstantRefChunkIndex,
  getInstantRefIndex,
  getInstantRefRowIndex,
  getProcessRefIndex,
  getSameProcessDependencyRefChunkIndex,
  getSameProcessDependencyRefPayload,
  getSameProcessDependencyRefProcessIndex,
  getSameProcessDependencyRefRowIndex,
  getSpanRefChunkIndex,
  getSpanRefProcessId,
  getSpanRefRowIndex,
  getThreadRefPayload,
  getThreadRefProcessIndex,
  getThreadRefThreadIndex,
  getTraceRefKind,
  isChunkRef,
  MAX_CHUNK_REF_INDEX,
  MAX_CHUNK_ROW_ENTITY_REF_ROW_INDEX,
  MAX_COUNTER_REF_CHUNK_INDEX,
  MAX_EVENT_REF_CHUNK_INDEX,
  MAX_INSTANT_REF_CHUNK_INDEX,
  MAX_SPAN_REF_CHUNK_INDEX,
  MAX_SPAN_REF_ROW_INDEX,
  PROCESS_REF_OFFSET,
  SAME_PROCESS_DEPENDENCY_REF_OFFSET,
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

  it('round-trips directional same-process dependency refs from span refs', () => {
    const spanRef = encodeLocalSpanRef(2, 7);
    const encoded = encodeSameProcessDependencyRef(spanRef);
    expect(encoded).toBeGreaterThanOrEqual(SAME_PROCESS_DEPENDENCY_REF_OFFSET);
    expect(encoded).toBeLessThan(CROSS_PROCESS_DEPENDENCY_REF_OFFSET);
    expect(decodeSameProcessDependencySpanRef(encoded)).toBe(spanRef);
    expect(decodeTaggedSameProcessDependencyRef(encoded, 10)).toBe(7);
    expect(decodeTaggedSameProcessDependencyRef(encoded, 7)).toBeNull();
    expect(decodeTaggedSameProcessDependencyRef(7, 10)).toBeNull();
  });

  it('rejects raw same-process dependency row indexes', () => {
    expect(decodeTaggedSameProcessDependencyRef(0, 4)).toBeNull();
    expect(decodeTaggedSameProcessDependencyRef(3, 4)).toBeNull();
    expect(decodeTaggedSameProcessDependencyRef(4, 4)).toBeNull();
    expect(decodeTaggedSameProcessDependencyRef(-1, 4)).toBeNull();
  });

  it('round-trips cross-process dependency refs and rejects local-style values', () => {
    const encodedCross = encodeCrossProcessDependencyRef(21);
    expect(encodedCross).toBeGreaterThanOrEqual(CROSS_PROCESS_DEPENDENCY_REF_OFFSET);
    expect(decodeCrossProcessDependencyRef(encodedCross)).toBe(21);
    expect(decodeCrossProcessDependencyRef(SAME_PROCESS_DEPENDENCY_REF_OFFSET)).toBeNull();
    expect(decodeCrossProcessDependencyRef(21)).toBeNull();
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
    const sameProcessDependencyRef = encodeSameProcessDependencyRef(spanRef);
    const eventRef = encodeEventRef(21);
    const crossProcessDependencyRef = encodeCrossProcessDependencyRef(42);
    const threadRef = encodeProcessThreadRef(2, 3);
    const processRef = encodeProcessRef(2);
    const chunkRef = encodeChunkRef(2);
    const instantRef = encodeInstantRef(3);
    const counterRef = encodeCounterRef(4);

    expect(getTraceRefKind(spanRef)).toBe('span');
    expect(getTraceRefKind(sameProcessDependencyRef)).toBe('sameProcessDependency');
    expect(getTraceRefKind(eventRef)).toBe('event');
    expect(getTraceRefKind(crossProcessDependencyRef)).toBe('crossProcessDependency');
    expect(getTraceRefKind(threadRef)).toBe('thread');
    expect(getTraceRefKind(processRef)).toBe('process');
    expect(getTraceRefKind(chunkRef)).toBe('chunk');
    expect(getTraceRefKind(instantRef)).toBe('instant');
    expect(getTraceRefKind(counterRef)).toBe('counter');

    expect(decodeTraceRef(spanRef)).toMatchObject({
      kind: 'span',
      chunkIndex: 2,
      rowIndex: 7
    });
    expect(decodeTraceRef(sameProcessDependencyRef)).toMatchObject({
      kind: 'sameProcessDependency',
      processIndex: 2,
      chunkIndex: 2,
      rowIndex: 7
    });
    expect(decodeTraceRef(eventRef)).toMatchObject({
      kind: 'event',
      chunkIndex: 0,
      rowIndex: 21
    });
    expect(decodeTraceRef(crossProcessDependencyRef)).toMatchObject({
      kind: 'crossProcessDependency',
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
    const sameProcessDependencyRef = encodeSameProcessDependencyRef(localSpanRef);
    const eventRef = encodeEventRef(21);
    const crossProcessDependencyRef = encodeCrossProcessDependencyRef(42);
    const threadRef = encodeProcessThreadRef(6, 8);
    const processRef = encodeProcessRef(6);
    const instantRef = encodeInstantRef(3);
    const counterRef = encodeCounterRef(4);

    expect(getSpanRefChunkIndex(spanRef)).toBe(9);
    expect(getSpanRefRowIndex(spanRef)).toBe(17);
    expect(getSameProcessDependencyRefPayload(sameProcessDependencyRef)).toBe(localSpanRef);
    expect(getSameProcessDependencyRefProcessIndex(sameProcessDependencyRef)).toBe(9);
    expect(getSameProcessDependencyRefChunkIndex(sameProcessDependencyRef)).toBe(9);
    expect(getSameProcessDependencyRefRowIndex(sameProcessDependencyRef)).toBe(17);
    expect(getEventRefIndex(eventRef)).toBe(21);
    expect(getEventRefChunkIndex(eventRef)).toBe(0);
    expect(getEventRefRowIndex(eventRef)).toBe(21);
    expect(getCrossProcessDependencyRefIndex(crossProcessDependencyRef)).toBe(42);
    expect(getCrossProcessDependencyRefChunkIndex(crossProcessDependencyRef)).toBe(0);
    expect(getCrossProcessDependencyRefRowIndex(crossProcessDependencyRef)).toBe(42);
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
    const sameProcessDependencyRef = encodeSameProcessDependencyRef(encodeLocalSpanRef(4, 5));
    const threadRef = encodeProcessThreadRef(2, 3);

    expect(decodeTraceRefInto(spanRef, scratch)).toBe(true);
    expect(scratch).toMatchObject({
      kind: 'span',
      ref: spanRef,
      chunkIndex: 2,
      rowIndex: 7
    });

    expect(decodeTraceRefInto(sameProcessDependencyRef, scratch)).toBe(true);
    expect(scratch).toMatchObject({
      kind: 'sameProcessDependency',
      ref: sameProcessDependencyRef,
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
