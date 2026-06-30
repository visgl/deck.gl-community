import type {
  TraceDeckBinaryBlockData,
  TraceDeckBinaryDependencyLineData,
  TracePreparedGraphScene,
  TracePreparedProcessRow
} from './trace-prepared-scene';

/** Mutable state used to de-duplicate prepared-scene heap estimates. */
export type TracePreparedSceneSizeContext = {
  /** Typed-array backing buffers that have already contributed their byte length. */
  seenBuffers: WeakSet<ArrayBufferLike>;
  /** Prepared scene objects that have already contributed their shallow object estimate. */
  seenObjects: WeakSet<object>;
};

/** Estimate retained bytes for prepared foreground or overview graph scenes. */
export function estimatePreparedLayoutInputsSize(
  layoutInputs: readonly TracePreparedGraphScene[],
  context: TracePreparedSceneSizeContext
): number {
  let bytes = estimateArrayOwnBytes(layoutInputs.length, 96);
  for (const layoutInput of layoutInputs) {
    if (!markPreparedObjectSeen(layoutInput, context)) {
      continue;
    }
    bytes += 96;
    bytes += estimatePreparedRowsSize(layoutInput.rows, context);
    bytes += estimateArrayOwnBytes(layoutInput.visibleCrossDependencies.length, 112);
    bytes += estimateArrayOwnBytes(layoutInput.minimapSpanIndicators.length, 80);
  }
  return bytes;
}

/** Estimate shallow array storage with a fixed per-entry heuristic. */
export function estimateArrayOwnBytes(length: number, bytesPerEntry: number): number {
  return length > 0 ? 24 + length * bytesPerEntry : 24;
}

/** Estimates retained bytes for prepared process rows and their binary attributes. */
function estimatePreparedRowsSize(
  rows: readonly TracePreparedProcessRow[],
  context: TracePreparedSceneSizeContext
): number {
  let bytes = estimateArrayOwnBytes(rows.length, 160);
  for (const row of rows) {
    if (!markPreparedObjectSeen(row, context)) {
      continue;
    }
    bytes += 160;
    bytes += estimateArrayOwnBytes(row.spans.length, 8);
    bytes += estimateArrayOwnBytes(row.dependencies.length, 8);
    bytes += estimateBinaryAttributeDataSize(row.binaryBlockData?.data, context);
    bytes += estimateArrayOwnBytes(row.binaryBlockData?.spans.length ?? 0, 8);
    bytes += estimateBinaryAttributeDataSize(row.binaryDependencyLineData?.data, context);
    bytes += estimateArrayOwnBytes(row.binaryDependencyLineData?.dependencyRefs.length ?? 0, 8);
    bytes += estimateArrayOwnBytes(row.collapsedActivityIntervals.length, 56);
    bytes += estimateArrayOwnBytes(row.overflowLabels.length, 80);
    if (row.reuseInfo) {
      bytes += 224;
    }
    if (row.binaryBlockReuseInfo && row.binaryBlockReuseInfo !== row.reuseInfo) {
      bytes += 224;
    }
    if (
      row.binaryDependencyReuseInfo &&
      row.binaryDependencyReuseInfo !== row.reuseInfo &&
      row.binaryDependencyReuseInfo !== row.binaryBlockReuseInfo
    ) {
      bytes += 224;
    }
  }
  return bytes;
}

/** Estimates retained bytes for one deck.gl binary attribute data object. */
function estimateBinaryAttributeDataSize(
  data: TraceDeckBinaryBlockData['data'] | TraceDeckBinaryDependencyLineData['data'] | undefined,
  context: TracePreparedSceneSizeContext
): number {
  if (!data || !markPreparedObjectSeen(data, context)) {
    return 0;
  }
  let bytes = 48;
  for (const [attributeName, attribute] of Object.entries(data.attributes)) {
    bytes += 48 + attributeName.length * 2;
    bytes += countPreparedArrayBufferBytes(attribute.value.buffer, context);
  }
  return bytes;
}

/** Counts one backing buffer once across the whole prepared-scene estimate. */
function countPreparedArrayBufferBytes(
  buffer: ArrayBufferLike,
  context: TracePreparedSceneSizeContext
): number {
  if (context.seenBuffers.has(buffer)) {
    return 0;
  }
  context.seenBuffers.add(buffer);
  return buffer.byteLength;
}

/** Marks an object as counted and returns whether this is the first visit. */
function markPreparedObjectSeen(value: object, context: TracePreparedSceneSizeContext): boolean {
  if (context.seenObjects.has(value)) {
    return false;
  }
  context.seenObjects.add(value);
  return true;
}
