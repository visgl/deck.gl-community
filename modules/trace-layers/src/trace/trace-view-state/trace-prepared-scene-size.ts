import type {
  TraceDeckBinaryBlockData,
  TraceDeckBinaryCrossProcessDependencyLineData,
  TraceDeckBinaryDependencyLineData
} from './trace-deck-binary-data';
import type {
  DerivedTraceData,
  TracePreparedGraphScene,
  TracePreparedProcessRow
} from './trace-prepared-scene';
import type {
  TraceCrossProcessDependencyRefSource,
  TraceSameProcessDependencyRefSource,
  TraceSpanRefSource
} from './trace-ref-source';

/** Mutable state used to de-duplicate prepared render-data heap estimates. */
export type TracePreparedRenderDataSizeContext = {
  /** Typed-array backing buffers that have already contributed their byte length. */
  seenBuffers: WeakSet<ArrayBufferLike>;
  /** Render-data objects that have already contributed their shallow object estimate. */
  seenObjects: WeakSet<object>;
};

/** Estimate retained bytes for prepared foreground or overview graph scenes. */
export function estimatePreparedLayoutInputsSize(
  layoutInputs: readonly TracePreparedGraphScene[],
  context: TracePreparedRenderDataSizeContext
): number {
  let bytes = estimateArrayOwnBytes(layoutInputs.length, 96);
  for (const layoutInput of layoutInputs) {
    if (!markPreparedObjectSeen(layoutInput, context)) {
      continue;
    }
    bytes += 96;
    bytes += estimatePreparedRowsSize(layoutInput.rows, context);
    bytes += estimateTraceCrossProcessDependencyRefSourceSize(
      layoutInput.crossProcessDependencyRefs,
      context
    );
    bytes += estimateBinaryAttributeDataSize(
      layoutInput.binaryCrossProcessDependencyLineData?.data,
      context
    );
    if (layoutInput.binaryCrossProcessDependencyLineData) {
      bytes += estimateTraceCrossProcessDependencyRefSourceSize(
        layoutInput.binaryCrossProcessDependencyLineData.dependencies,
        context
      );
      const compactedDependencyRefs =
        layoutInput.binaryCrossProcessDependencyLineData.compactedDependencyRefs;
      if (compactedDependencyRefs) {
        bytes += countPreparedArrayBufferBytes(compactedDependencyRefs.buffer, context);
      }
    }
    bytes += estimateArrayOwnBytes(layoutInput.minimapSpanIndicators.length, 80);
  }
  return bytes;
}

/**
 * Estimates the marker projections retained by one render snapshot.
 *
 * Marker sources are counted shallowly: the snapshot owns the projected arrays, maps, position
 * tuples, colors, and sparkline paths, while source payloads remain graph/dataset-owned.
 */
export function estimateDerivedTraceDataSize(
  derivedDataByGraph: readonly DerivedTraceData[]
): number {
  const context: TracePreparedRenderDataSizeContext = {
    seenBuffers: new WeakSet<ArrayBufferLike>(),
    seenObjects: new WeakSet<object>()
  };
  let bytes = estimateArrayOwnBytes(derivedDataByGraph.length, 8);
  for (const derivedData of derivedDataByGraph) {
    if (!markPreparedObjectSeen(derivedData, context)) {
      continue;
    }
    bytes += 64;
    bytes += estimateMarkerProjectionSize(
      derivedData.globalEvents,
      derivedData.globalEvents.visibleEvents,
      derivedData.globalEvents.positionMap,
      derivedData.globalEvents.colorMap,
      context
    );
    bytes += estimateMarkerProjectionSize(
      derivedData.instants,
      derivedData.instants.visibleInstants,
      derivedData.instants.positionMap,
      derivedData.instants.colorMap,
      context
    );
    bytes += estimateMarkerProjectionSize(
      derivedData.counters,
      derivedData.counters.counterPoints,
      derivedData.counters.positionMap,
      derivedData.counters.colorMap,
      context
    );
    bytes += estimateCounterSparklineDataSize(derivedData.counters.sparklineData, context);
  }
  return bytes;
}

/** Estimates one derived array's own storage while de-duplicating shared empty arrays. */
function estimateReferencedArraySize(
  values: readonly unknown[],
  bytesPerEntry: number,
  context: TracePreparedRenderDataSizeContext
): number {
  if (!markPreparedObjectSeen(values, context)) {
    return 0;
  }
  return estimateArrayOwnBytes(values.length, bytesPerEntry);
}

/**
 * Estimates one event/instant/counter projection's arrays and tuple-valued maps.
 */
function estimateMarkerProjectionSize(
  projection: object,
  sources: readonly unknown[],
  positionMap: ReadonlyMap<unknown, readonly number[]>,
  colorMap: ReadonlyMap<unknown, readonly number[]>,
  context: TracePreparedRenderDataSizeContext
): number {
  if (!markPreparedObjectSeen(projection, context)) {
    return 0;
  }
  return (
    64 +
    estimateReferencedArraySize(sources, 8, context) +
    estimateTupleMapSize(positionMap, context) +
    estimateTupleMapSize(colorMap, context)
  );
}

/**
 * Estimates one ref-keyed map whose values are newly allocated numeric tuples.
 */
function estimateTupleMapSize(
  values: ReadonlyMap<unknown, readonly number[]>,
  context: TracePreparedRenderDataSizeContext
): number {
  if (!markPreparedObjectSeen(values, context)) {
    return 0;
  }
  let bytes = 56 + values.size * 48;
  for (const tuple of values.values()) {
    bytes += estimateReferencedArraySize(tuple, 8, context);
  }
  return bytes;
}

/**
 * Estimates counter sparkline descriptors and their point/color tuple arrays.
 */
function estimateCounterSparklineDataSize(
  sparklines: DerivedTraceData['counters']['sparklineData'],
  context: TracePreparedRenderDataSizeContext
): number {
  let bytes = estimateReferencedArraySize(sparklines, 8, context);
  for (const sparkline of sparklines) {
    if (!markPreparedObjectSeen(sparkline, context)) {
      continue;
    }
    bytes += 64;
    bytes += estimateReferencedArraySize(sparkline.path, 8, context);
    for (const point of sparkline.path) {
      bytes += estimateReferencedArraySize(point, 8, context);
    }
    bytes += estimateReferencedArraySize(sparkline.color, 8, context);
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
  context: TracePreparedRenderDataSizeContext
): number {
  let bytes = estimateArrayOwnBytes(rows.length, 160);
  for (const row of rows) {
    if (!markPreparedObjectSeen(row, context)) {
      continue;
    }
    bytes += 160;
    bytes += estimateBinaryAttributeDataSize(row.binaryBlockData?.data, context);
    if (row.binaryBlockData) {
      bytes += estimateTraceSpanRefSourceSize(row.binaryBlockData.spans, context);
    }
    bytes += estimateBinaryAttributeDataSize(row.binaryDependencyLineData?.data, context);
    if (row.binaryDependencyLineData) {
      bytes += estimateTraceSameProcessDependencyRefSourceSize(
        row.binaryDependencyLineData.dependencies,
        context
      );
    }
    bytes += estimateArrayOwnBytes(row.collapsedActivityIntervals.length, 56);
    bytes += estimateArrayOwnBytes(row.overflowLabels.length, 80);
  }
  return bytes;
}

/** Estimates one prepared span-ref source without charging range-backed rows per span. */
function estimateTraceSpanRefSourceSize(
  source: TraceSpanRefSource,
  context: TracePreparedRenderDataSizeContext
): number {
  if (!markPreparedObjectSeen(source, context)) {
    return 0;
  }
  const denseRanges = source.denseRanges;
  if (!denseRanges) {
    return estimateArrayOwnBytes(source.length, 8);
  }
  return 64 + estimateReferencedArraySize(denseRanges, 32, context);
}

/** Estimates one prepared dependency-ref source without charging dense rows per dependency. */
function estimateTraceSameProcessDependencyRefSourceSize(
  source: TraceSameProcessDependencyRefSource,
  context: TracePreparedRenderDataSizeContext
): number {
  if (!markPreparedObjectSeen(source, context)) {
    return 0;
  }
  return source.denseProcessIndex == null ? estimateArrayOwnBytes(source.length, 8) : 64;
}

/** Estimates one cross-process dependency ref source without charging streamed rows per edge. */
function estimateTraceCrossProcessDependencyRefSourceSize(
  source: TraceCrossProcessDependencyRefSource,
  context: TracePreparedRenderDataSizeContext
): number {
  if (!markPreparedObjectSeen(source, context)) {
    return 0;
  }
  return Array.isArray(source) ? estimateArrayOwnBytes(source.length, 8) : 64;
}

/** Estimates retained bytes for one deck.gl binary attribute data object. */
function estimateBinaryAttributeDataSize(
  data:
    | TraceDeckBinaryBlockData['data']
    | TraceDeckBinaryDependencyLineData['data']
    | TraceDeckBinaryCrossProcessDependencyLineData['data']
    | undefined,
  context: TracePreparedRenderDataSizeContext
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

/** Counts one backing buffer once across the whole render-data estimate. */
function countPreparedArrayBufferBytes(
  buffer: ArrayBufferLike,
  context: TracePreparedRenderDataSizeContext
): number {
  if (context.seenBuffers.has(buffer)) {
    return 0;
  }
  context.seenBuffers.add(buffer);
  return buffer.byteLength;
}

/** Marks an object as counted and returns whether this is the first visit. */
function markPreparedObjectSeen(
  value: object,
  context: TracePreparedRenderDataSizeContext
): boolean {
  if (context.seenObjects.has(value)) {
    return false;
  }
  context.seenObjects.add(value);
  return true;
}
