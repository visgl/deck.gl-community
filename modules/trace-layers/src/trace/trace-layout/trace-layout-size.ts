import type {
  ProcessLayout,
  ThreadLayout,
  TraceLayout,
  TraceLayoutGeometryColumn,
  TraceLayoutProcessGeometryCacheEntry
} from './trace-layout';

/** A byte-size estimate for one TraceLayout component. */
export type TraceLayoutSizeEntry = {
  /** Dot-separated path to the layout component. */
  path: string;
  /** Estimated stored bytes for this layout component after de-duplicating shared buffers. */
  bytes: number;
  /** Broad storage category used for grouping the estimate. */
  kind: 'array' | 'map' | 'object' | 'string' | 'typed-array' | 'primitive';
  /** Optional row count when the component is aligned to trace rows. */
  rowCount?: number;
};

/** Summary of estimated TraceLayout chunk storage. */
export type TraceLayoutSizeReport = {
  /** Total estimated stored bytes across all visited layout components. */
  totalBytes: number;
  /** Estimated bytes grouped by storage category. */
  bytesByKind: Record<TraceLayoutSizeEntry['kind'], number>;
  /** Per-component estimates sorted by descending byte count. */
  entries: TraceLayoutSizeEntry[];
};

/** Options for {@link estimateTraceLayoutSize}. */
export type TraceLayoutSizeOptions = {
  /** Whether to include reusable geometry caches kept on layout outputs. */
  includeGeometryCache?: boolean;
  /** Whether to include nested minimap layouts stored by primary layouts. */
  includeMinimapLayouts?: boolean;
};

/**
 * Estimates chunk storage for one or more TraceLayout outputs without walking source
 * TraceGraphs. Geometry buffers are de-duplicated by backing ArrayBuffer, and large maps are
 * estimated from entry counts so status updates stay cheap on large traces.
 */
export function estimateTraceLayoutSize(
  traceLayouts: Readonly<TraceLayout> | readonly TraceLayout[],
  options: TraceLayoutSizeOptions = {}
): TraceLayoutSizeReport {
  const layouts = Array.isArray(traceLayouts) ? traceLayouts : [traceLayouts];
  const context: TraceLayoutSizeContext = {
    entries: [],
    seenBuffers: new WeakSet<ArrayBufferLike>(),
    seenObjects: new WeakSet<object>(),
    includeGeometryCache: options.includeGeometryCache ?? true,
    includeMinimapLayouts: options.includeMinimapLayouts ?? true
  };

  addArrayEntry(context, 'layouts', layouts.length);
  layouts.forEach((layout, index) => estimateLayout(layout, `layouts[${index}]`, context));

  const bytesByKind = createEmptyBytesByKind();
  let totalBytes = 0;
  for (const entry of context.entries) {
    totalBytes += entry.bytes;
    bytesByKind[entry.kind] += entry.bytes;
  }

  return {
    totalBytes,
    bytesByKind,
    entries: context.entries.sort((left, right) => right.bytes - left.bytes)
  };
}

type TraceLayoutSizeContext = {
  entries: TraceLayoutSizeEntry[];
  seenBuffers: WeakSet<ArrayBufferLike>;
  seenObjects: WeakSet<object>;
  includeGeometryCache: boolean;
  includeMinimapLayouts: boolean;
};

/** Adds estimated stored bytes for one complete TraceLayout object. */
function estimateLayout(
  layout: Readonly<TraceLayout>,
  path: string,
  context: TraceLayoutSizeContext
): void {
  if (!markObjectSeen(layout, context)) {
    return;
  }

  addObjectEntry(context, path, 20);
  estimateProcessLayouts(layout.processLayouts, `${path}.processLayouts`, context);
  estimateRenderRows(layout.renderRows, `${path}.renderRows`, context);
  estimateObjectRecordShallow(layout.threadLayoutMap, `${path}.threadLayoutMap`, context);
  estimateMapShallow(layout.threadLayoutMapByRef, `${path}.threadLayoutMapByRef`, context);
  estimateGeometryColumns(layout.spanGeometryChunks, `${path}.spanGeometryChunks`, context);
  estimateMapShallow(
    layout.spanVisibilityMapBySpanRef,
    `${path}.spanVisibilityMapBySpanRef`,
    context,
    48
  );
  estimateGeometryColumns(
    layout.localDependencyGeometryChunks,
    `${path}.localDependencyGeometryChunks`,
    context
  );
  estimateGeometryColumns(
    layout.crossDependencyGeometryChunks,
    `${path}.crossDependencyGeometryChunks`,
    context
  );
  estimateGeometryCache(layout.geometryCache, `${path}.geometryCache`, context);
  addArrayEntry(context, `${path}.overflowLabels`, layout.overflowLabels.length, 64);
  addArrayEntry(context, `${path}.currentBounds`, 2, 32);
  addArrayEntry(context, `${path}.expandedBounds`, 2, 32);

  if (layout.globalEventRow) {
    addObjectEntry(context, `${path}.globalEventRow`, 2);
  }
  if (context.includeMinimapLayouts && layout.minimapLayout) {
    addObjectEntry(context, `${path}.minimapLayout`, 2);
    estimateLayout(layout.minimapLayout.traceLayout, `${path}.minimapLayout.traceLayout`, context);
    addArrayEntry(context, `${path}.minimapLayout.bounds`, 2, 32);
  }
}

/** Adds estimated stored bytes for process layout rows. */
function estimateProcessLayouts(
  processLayouts: readonly ProcessLayout[],
  path: string,
  context: TraceLayoutSizeContext
): void {
  if (!markObjectSeen(processLayouts, context)) {
    return;
  }

  addArrayEntry(context, path, processLayouts.length, 128);
  processLayouts.forEach((processLayout, index) => {
    const processPath = `${path}[${index}]`;
    if (!markObjectSeen(processLayout, context)) {
      return;
    }
    addObjectEntry(context, processPath, 15);
    estimateTypedArray(
      processLayout.backgroundPolygon,
      `${processPath}.backgroundPolygon`,
      context
    );
    estimateTypedArray(
      processLayout.backgroundPolygonInfinite,
      `${processPath}.backgroundPolygonInfinite`,
      context
    );
    estimateTypedArray(
      processLayout.separatorLineInfinite,
      `${processPath}.separatorLineInfinite`,
      context
    );
    estimateTypedArray(
      processLayout.terminalSeparatorLineInfinite,
      `${processPath}.terminalSeparatorLineInfinite`,
      context
    );
    addArrayEntry(context, `${processPath}.startPosition`, processLayout.startPosition.length, 8);
    estimateString(processLayout.label, `${processPath}.label`, context);
    estimateThreadLayouts(processLayout.threadLayouts, `${processPath}.threadLayouts`, context);
  });
}

/** Adds estimated stored bytes for thread layout rows. */
function estimateThreadLayouts(
  threadLayouts: readonly ThreadLayout[],
  path: string,
  context: TraceLayoutSizeContext
): void {
  if (!markObjectSeen(threadLayouts, context)) {
    return;
  }

  addArrayEntry(context, path, threadLayouts.length, 104);
  threadLayouts.forEach((threadLayout, index) => {
    const threadPath = `${path}[${index}]`;
    if (!markObjectSeen(threadLayout, context)) {
      return;
    }
    addObjectEntry(context, threadPath, 10);
    estimateString(threadLayout.threadId, `${threadPath}.threadId`, context);
    addArrayEntry(context, `${threadPath}.startPosition`, threadLayout.startPosition.length, 8);
    addArrayEntry(context, `${threadPath}.targetPosition`, threadLayout.targetPosition.length, 8);
    estimateMapShallow(threadLayout.spanLaneMap, `${threadPath}.spanLaneMap`, context, 16);
    if (threadLayout.lanes) {
      addObjectEntry(context, `${threadPath}.lanes`, 6);
      addArrayEntry(
        context,
        `${threadPath}.lanes.visibleLaneIndices`,
        threadLayout.lanes.visibleLaneIndices?.length ?? 0,
        8
      );
      addArrayEntry(
        context,
        `${threadPath}.lanes.laneYPositions`,
        threadLayout.lanes.laneYPositions.length,
        8
      );
    }
    if (threadLayout.overflowLabel) {
      addObjectEntry(context, `${threadPath}.overflowLabel`, 4);
      estimateString(threadLayout.overflowLabel.text, `${threadPath}.overflowLabel.text`, context);
    }
  });
}

/** Adds estimated stored bytes for render-row metadata. */
function estimateRenderRows(
  renderRows: TraceLayout['renderRows'],
  path: string,
  context: TraceLayoutSizeContext
): void {
  if (!markObjectSeen(renderRows, context)) {
    return;
  }

  addArrayEntry(context, path, renderRows.length, 80);
  renderRows.forEach((row, index) => {
    const rowPath = `${path}[${index}]`;
    addObjectEntry(context, rowPath, 8);
    estimateString(row.processId, `${rowPath}.processId`, context);
    estimateString(row.name, `${rowPath}.name`, context);
    addArrayEntry(context, `${rowPath}.threadRefs`, row.threadRefs?.length ?? 0, 8);
  });
}

/** Adds estimated stored bytes for reusable geometry cache state. */
function estimateGeometryCache(
  geometryCache: TraceLayout['geometryCache'],
  path: string,
  context: TraceLayoutSizeContext
): void {
  if (!context.includeGeometryCache || !geometryCache || !markObjectSeen(geometryCache, context)) {
    return;
  }

  addObjectEntry(context, path, 5);
  estimateObjectRecordShallow(geometryCache.processesById, `${path}.processesById`, context);
  Object.entries(geometryCache.processesById).forEach(([processId, entry]) =>
    estimateGeometryCacheEntry(entry, `${path}.processesById.${processId}`, context)
  );
  estimateGeometryColumns(geometryCache.spanGeometryChunks, `${path}.spanGeometryChunks`, context);
  estimateGeometryColumns(
    geometryCache.localDependencyGeometryChunks,
    `${path}.localDependencyGeometryChunks`,
    context
  );
  estimateGeometryColumns(
    geometryCache.crossDependencyGeometryChunks,
    `${path}.crossDependencyGeometryChunks`,
    context
  );
  estimateMapShallow(
    geometryCache.crossDependencyReuseKeyByVisibleRef,
    `${path}.crossDependencyReuseKeyByVisibleRef`,
    context,
    32
  );
}

/** Adds estimated stored bytes for one process geometry cache entry. */
function estimateGeometryCacheEntry(
  entry: TraceLayoutProcessGeometryCacheEntry,
  path: string,
  context: TraceLayoutSizeContext
): void {
  if (!markObjectSeen(entry, context)) {
    return;
  }

  addObjectEntry(context, path, 10);
  estimateString(entry.processId, `${path}.processId`, context);
  estimateString(entry.fastReuseKey, `${path}.fastReuseKey`, context);
  estimateString(entry.reuseKey, `${path}.reuseKey`, context);
  estimateGeometryColumns(entry.spanGeometryChunks, `${path}.spanGeometryChunks`, context);
  estimateGeometryColumns(
    entry.localDependencyGeometryChunks,
    `${path}.localDependencyGeometryChunks`,
    context
  );
}

/** Adds estimated stored bytes for sparse geometry column chunks. */
function estimateGeometryColumns(
  chunks: readonly TraceLayoutGeometryColumn[] | undefined,
  path: string,
  context: TraceLayoutSizeContext
): void {
  if (!chunks || !markObjectSeen(chunks, context)) {
    return;
  }

  addArrayEntry(context, path, chunks.length, 64);
  chunks.forEach((chunk, index) => estimateGeometryColumn(chunk, `${path}[${index}]`, context));
}

/** Adds estimated stored bytes for one packed geometry column. */
function estimateGeometryColumn(
  column: TraceLayoutGeometryColumn | undefined,
  path: string,
  context: TraceLayoutSizeContext
): void {
  if (!column || !markObjectSeen(column, context)) {
    return;
  }

  addObjectEntry(context, path, 2);
  estimateTypedArray(column.values, `${path}.values`, context, column.values.length / 4);
}

/** Adds a shallow size estimate for a plain object record. */
function estimateObjectRecordShallow(
  record: object | undefined,
  path: string,
  context: TraceLayoutSizeContext,
  valueBytes = 16
): void {
  if (!record || !markObjectSeen(record, context)) {
    return;
  }
  const keys = Object.keys(record);
  addObjectEntry(
    context,
    path,
    keys.length,
    keys.reduce((sum, key) => sum + key.length * 2, 0) + keys.length * valueBytes
  );
}

/** Adds a shallow size estimate for a map. */
function estimateMapShallow(
  map: ReadonlyMap<unknown, unknown> | undefined,
  path: string,
  context: TraceLayoutSizeContext,
  valueBytes = 0
): void {
  if (!map || !markObjectSeen(map, context)) {
    return;
  }
  addMapEntry(context, path, map.size, valueBytes);
}

/** Adds stored bytes for a typed array buffer while de-duplicating shared buffers. */
function estimateTypedArray(
  value: ArrayBufferView,
  path: string,
  context: TraceLayoutSizeContext,
  rowCount?: number
): void {
  if (context.seenBuffers.has(value.buffer)) {
    return;
  }
  context.seenBuffers.add(value.buffer);
  addEntry(context, path, value.buffer.byteLength, 'typed-array', rowCount);
}

/** Adds estimated stored bytes for one JavaScript string. */
function estimateString(
  value: string | null | undefined,
  path: string,
  context: TraceLayoutSizeContext
): void {
  if (value == null || value.length === 0) {
    return;
  }
  addEntry(context, path, value.length * 2, 'string');
}

/** Adds an array estimate entry when the array contains at least one item. */
function addArrayEntry(
  context: TraceLayoutSizeContext,
  path: string,
  length: number,
  perItemBytes = 8
): void {
  if (length <= 0) {
    return;
  }
  addEntry(context, path, 24 + length * perItemBytes, 'array', length);
}

/** Adds an object estimate entry using a field-count based approximation. */
function addObjectEntry(
  context: TraceLayoutSizeContext,
  path: string,
  fieldCount: number,
  extraBytes = 0
): void {
  addEntry(context, path, 32 + fieldCount * 16 + extraBytes, 'object');
}

/** Adds a map estimate entry when the map contains at least one item. */
function addMapEntry(
  context: TraceLayoutSizeContext,
  path: string,
  size: number,
  valueBytes = 0
): void {
  if (size <= 0) {
    return;
  }
  addEntry(context, path, 48 + size * (32 + valueBytes), 'map', size);
}

/** Records one size estimate entry. */
function addEntry(
  context: TraceLayoutSizeContext,
  path: string,
  bytes: number,
  kind: TraceLayoutSizeEntry['kind'],
  rowCount?: number
): void {
  if (bytes <= 0) {
    return;
  }
  context.entries.push({path, bytes, kind, rowCount});
}

/** Returns whether an object should be estimated for the first time. */
function markObjectSeen(value: object, context: TraceLayoutSizeContext): boolean {
  if (context.seenObjects.has(value)) {
    return false;
  }
  context.seenObjects.add(value);
  return true;
}

/** Creates an empty byte counter keyed by estimate-entry kind. */
function createEmptyBytesByKind(): Record<TraceLayoutSizeEntry['kind'], number> {
  return {
    array: 0,
    map: 0,
    object: 0,
    string: 0,
    'typed-array': 0,
    primitive: 0
  };
}
