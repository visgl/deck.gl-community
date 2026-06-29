import * as arrow from 'apache-arrow';

import {getHeapUsageProbeFields, log} from '../log';

import type {TraceGraphData} from '../ingestion/arrow-trace';

/** A byte-size estimate for one TraceGraph component. */
export type TraceGraphSizeEntry = {
  /** Dot-separated path to the component. */
  path: string;
  /** Estimated stored bytes for this component after de-duplicating shared buffers. */
  bytes: number;
  /** Broad storage category used for grouping the estimate. */
  kind: 'arrow' | 'map' | 'array' | 'object' | 'string' | 'typed-array' | 'primitive';
  /** Optional row count when the component is an Arrow table. */
  rowCount?: number;
  /** Optional column count when the component is an Arrow table. */
  columnCount?: number;
};

/** Summary of estimated TraceGraph chunk storage. */
export type TraceGraphSizeReport = {
  /** Total estimated stored bytes across all visited components. */
  totalBytes: number;
  /** Estimated bytes grouped by storage category. */
  bytesByKind: Record<TraceGraphSizeEntry['kind'], number>;
  /** Per-component estimates sorted by descending byte count. */
  entries: TraceGraphSizeEntry[];
};

/** Caller-selected retained component measured by {@link estimateTraceGraphComponentSizes}. */
export type TraceGraphSizeComponent = {
  /** Stable report path emitted for this retained component. */
  path: string;
  /** Retained value to estimate while sharing de-duplication state with sibling components. */
  value: unknown;
  /** Optional report kind override for grouped components such as many Arrow tables. */
  kind?: TraceGraphSizeEntry['kind'];
  /** Optional aggregate row count surfaced for grouped Arrow-backed components. */
  rowCount?: number;
  /** Optional aggregate column count surfaced for grouped Arrow-backed components. */
  columnCount?: number;
};

/** Options for {@link estimateTraceGraphSize}. */
export type TraceGraphSizeOptions = {
  /** Whether to include enumerable private caches currently kept on the TraceGraph instance. */
  includeRuntimeCaches?: boolean;
  /** Maximum recursion depth for non-Arrow JS object/map/array estimates. */
  maxObjectDepth?: number;
};

/**
 * Estimates chunk storage for a TraceGraph-like object by walking Arrow tables, maps, arrays,
 * typed arrays, strings, and plain objects.
 *
 * Arrow buffers are counted by backing `ArrayBuffer.byteLength` and de-duplicated, which makes this
 * effective for comparing table-heavy TraceGraph snapshots. JS object and Map sizes are necessarily
 * estimates because engines do not expose exact object heap sizes.
 */
export function estimateTraceGraphSize(
  traceGraph: Readonly<TraceGraphData> | object,
  options: TraceGraphSizeOptions = {}
): TraceGraphSizeReport {
  const estimateStartTime = performance.now();
  const graphStats = (traceGraph as Partial<TraceGraphData>).stats;
  log.probe(0, 'TraceGraph size calculation start', {
    processCount: graphStats?.processCount,
    spanCount: graphStats?.spanCount,
    localDependencyCount: graphStats?.localDependencyCount,
    crossDependencyCount: graphStats?.crossDependencyCount,
    includeRuntimeCaches: options.includeRuntimeCaches === true,
    maxObjectDepth: options.maxObjectDepth ?? 4,
    ...getHeapUsageProbeFields()
  })();

  const context = createTraceGraphSizeContext(options, true);

  const rootEntries = options.includeRuntimeCaches
    ? Object.entries(traceGraph)
    : getKnownTraceGraphEntries(traceGraph as Partial<TraceGraphData>);

  for (const [key, value] of rootEntries) {
    estimateValueSize(value, key, context, 0);
  }

  const report = {
    totalBytes: context.totalBytes,
    bytesByKind: context.bytesByKind,
    entries: context.entries.sort((left, right) => right.bytes - left.bytes)
  };

  log.probe(0, 'TraceGraph size calculation done', {
    processCount: graphStats?.processCount,
    spanCount: graphStats?.spanCount,
    localDependencyCount: graphStats?.localDependencyCount,
    crossDependencyCount: graphStats?.crossDependencyCount,
    totalBytes: report.totalBytes,
    entryCount: report.entries.length,
    bytesByKind: report.bytesByKind,
    durationMs: performance.now() - estimateStartTime,
    ...getHeapUsageProbeFields()
  })();
  log.probe(0, 'TraceGraph size breakdown', buildTraceGraphSizeBreakdown(report, graphStats))();

  return report;
}

/**
 * Estimates caller-selected retained components while emitting only one bounded entry per path.
 *
 * This keeps shared object and Arrow-buffer de-duplication from {@link estimateTraceGraphSize}
 * without retaining one report entry per visited nested value.
 */
export function estimateTraceGraphComponentSizes(
  components: Iterable<TraceGraphSizeComponent>,
  options: Omit<TraceGraphSizeOptions, 'includeRuntimeCaches'> = {}
): TraceGraphSizeReport {
  const context = createTraceGraphSizeContext(options, false);
  const entriesByPath = new Map<string, TraceGraphSizeEntry>();

  for (const component of components) {
    const bytesBefore = context.totalBytes;
    estimateValueSize(component.value, component.path, context, 0);
    const bytes = context.totalBytes - bytesBefore;
    if (bytes <= 0) {
      continue;
    }
    mergeTraceGraphSizeEntry(entriesByPath, {
      path: component.path,
      bytes,
      kind: component.kind ?? inferTraceGraphSizeKind(component.value),
      ...(component.rowCount === undefined ? {} : {rowCount: component.rowCount}),
      ...(component.columnCount === undefined ? {} : {columnCount: component.columnCount})
    });
  }

  return {
    totalBytes: context.totalBytes,
    bytesByKind: context.bytesByKind,
    entries: [...entriesByPath.values()].sort((left, right) => right.bytes - left.bytes)
  };
}

type TraceGraphSizeContext = {
  entries: TraceGraphSizeEntry[];
  /** Whether per-path retained-size entries should be recorded. */
  collectDetailedEntries: boolean;
  /** Running retained byte estimate for the visited graph. */
  totalBytes: number;
  /** Running retained byte estimate grouped by entry kind. */
  bytesByKind: Record<TraceGraphSizeEntry['kind'], number>;
  seenObjects: WeakSet<object>;
  seenBuffers: WeakSet<ArrayBufferLike>;
  maxObjectDepth: number;
};

type TraceGraphSizeStats = Partial<NonNullable<TraceGraphData['stats']>>;

type TraceGraphSizeBreakdownGroup = {
  label: string;
  bytes: number;
  rowCount: number | null;
  bytesPerRow: number | null;
  entryCount: number;
};

/** Creates one TraceGraph size-estimation context with optional nested-entry retention. */
function createTraceGraphSizeContext(
  options: Pick<TraceGraphSizeOptions, 'maxObjectDepth'>,
  collectDetailedEntries: boolean
): TraceGraphSizeContext {
  return {
    entries: [],
    collectDetailedEntries,
    totalBytes: 0,
    bytesByKind: createEmptyBytesByKind(),
    seenObjects: new WeakSet<object>(),
    seenBuffers: new WeakSet<ArrayBufferLike>(),
    maxObjectDepth: options.maxObjectDepth ?? 4
  };
}

function getKnownTraceGraphEntries(traceGraph: Partial<TraceGraphData>): Array<[string, unknown]> {
  return [
    ['processes', traceGraph.processes],
    ['crossDependencies', traceGraph.crossDependencies],
    ['threadMap', traceGraph.threadMap],
    ['threadInstantMap', traceGraph.threadInstantMap],
    ['threadCounterMap', traceGraph.threadCounterMap],
    ['instantMap', traceGraph.instantMap],
    ['counterMap', traceGraph.counterMap],
    ['counterExtents', traceGraph.counterExtents],
    ['events', traceGraph.events],
    ['eventMap', traceGraph.eventMap],
    ['processSpanTableMap', traceGraph.processSpanTableMap],
    ['localDependencyTableMap', traceGraph.localDependencyTableMap],
    ['crossDependencyTable', traceGraph.crossDependencyTable],
    ['spanSidecarMap', traceGraph.spanSidecarMap],
    ['spanSidecarTableMap', traceGraph.spanSidecarTableMap],
    ['crossProcessEndpointsBySpanRef', traceGraph.crossProcessEndpointsBySpanRef],
    ['spanCrossDependencyRefMap', traceGraph.spanCrossDependencyRefMap],
    ['chunks', traceGraph.chunks],
    ['processIdsByIndex', traceGraph.processIdsByIndex],
    ['crossDependencyIdToIndexMap', traceGraph.crossDependencyIdToIndexMap],
    ['dependencyMap', traceGraph.dependencyMap],
    ['stats', traceGraph.stats]
  ];
}

function estimateValueSize(
  value: unknown,
  path: string,
  context: TraceGraphSizeContext,
  depth: number
): number {
  if (value == null) {
    return 0;
  }
  if (typeof value === 'string') {
    return addEntry(context, path, value.length * 2, 'string');
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return addEntry(context, path, 8, 'primitive');
  }
  if (typeof value !== 'object') {
    return 0;
  }
  if (context.seenObjects.has(value)) {
    return 0;
  }
  context.seenObjects.add(value);

  if (isArrowTable(value)) {
    return estimateArrowTableSize(value, path, context);
  }
  if (ArrayBuffer.isView(value)) {
    return addEntry(context, path, countArrayBufferBytes(value.buffer, context), 'typed-array');
  }
  if (isArrowTableRecord(value)) {
    return estimateArrowTableRecordSize(value, path, context);
  }
  if (value instanceof Map) {
    return estimateMapSize(value, path, context, depth);
  }
  if (value instanceof Set) {
    return estimateArrayLikeObjectSize(Array.from(value), path, 'array', context, depth);
  }
  if (Array.isArray(value)) {
    return estimateArrayLikeObjectSize(value, path, 'array', context, depth);
  }

  return estimatePlainObjectSize(value as Record<string, unknown>, path, context, depth);
}

function isArrowTable(value: object): value is arrow.Table {
  if (value instanceof arrow.Table) {
    return true;
  }

  const tableLike = value as {
    numRows?: unknown;
    schema?: {fields?: unknown};
    batches?: unknown;
  };
  return (
    typeof tableLike.numRows === 'number' &&
    Array.isArray(tableLike.schema?.fields) &&
    Array.isArray(tableLike.batches)
  );
}

function isArrowTableRecord(value: object): value is Readonly<Record<string, arrow.Table>> {
  if (value instanceof Map || value instanceof Set || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(([, child]) => child != null && typeof child === 'object' && isArrowTable(child))
  );
}

function estimateArrowTableRecordSize(
  value: Readonly<Record<string, arrow.Table>>,
  path: string,
  context: TraceGraphSizeContext
): number {
  let ownBytes = 32 + Object.keys(value).length * 16;
  let childBytes = 0;
  for (const [key, table] of Object.entries(value)) {
    ownBytes += key.length * 2;
    childBytes += estimateArrowTableSize(table, `${path}.${key}`, context);
  }
  addEntry(context, path, ownBytes, 'object');
  return ownBytes + childBytes;
}

function estimateArrowTableSize(
  table: arrow.Table,
  path: string,
  context: TraceGraphSizeContext
): number {
  const bytes = estimateArrowLikeStorage(table, context);
  return addEntry(context, path, bytes, 'arrow', {
    rowCount: table.numRows,
    columnCount: table.schema.fields.length
  });
}

function estimateArrowLikeStorage(value: unknown, context: TraceGraphSizeContext): number {
  if (value == null || typeof value !== 'object') {
    return 0;
  }
  let bytes = 0;
  const record = value as Record<string, unknown>;
  for (const key of ['data', 'values', 'valueOffsets', 'nullBitmap', 'typeIds']) {
    bytes += estimateArrowBufferValue(record[key], context);
  }
  for (const key of ['children', 'batches', 'chunks']) {
    const childValue = record[key];
    if (Array.isArray(childValue)) {
      for (const child of childValue) {
        bytes += estimateArrowLikeStorage(child, context);
      }
    }
  }
  return bytes;
}

function estimateArrowBufferValue(value: unknown, context: TraceGraphSizeContext): number {
  if (value == null) {
    return 0;
  }
  if (ArrayBuffer.isView(value)) {
    return countArrayBufferBytes(value.buffer, context);
  }
  const SharedArrayBufferConstructor = globalThis.SharedArrayBuffer;
  if (
    value instanceof ArrayBuffer ||
    (typeof SharedArrayBufferConstructor === 'function' &&
      value instanceof SharedArrayBufferConstructor)
  ) {
    return countArrayBufferBytes(value, context);
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, entry) => sum + estimateArrowBufferValue(entry, context), 0);
  }
  if (typeof value === 'object') {
    return estimateArrowLikeStorage(value, context);
  }
  return 0;
}

function estimateMapSize(
  map: ReadonlyMap<unknown, unknown>,
  path: string,
  context: TraceGraphSizeContext,
  depth: number
): number {
  const ownBytes = 48 + map.size * 32;
  let childBytes = 0;
  if (depth < context.maxObjectDepth) {
    let index = 0;
    for (const [key, value] of map) {
      childBytes += estimateValueSize(key, `${path}.key[${index}]`, context, depth + 1);
      childBytes += estimateValueSize(value, `${path}.value[${index}]`, context, depth + 1);
      index += 1;
    }
  }
  addEntry(context, path, ownBytes, 'map');
  return ownBytes + childBytes;
}

function estimateArrayLikeObjectSize(
  values: readonly unknown[],
  path: string,
  kind: 'array' | 'object',
  context: TraceGraphSizeContext,
  depth: number
): number {
  const ownBytes = 24 + values.length * 8;
  let childBytes = 0;
  if (depth < context.maxObjectDepth) {
    for (let index = 0; index < values.length; index += 1) {
      childBytes += estimateValueSize(values[index], `${path}[${index}]`, context, depth + 1);
    }
  }
  addEntry(context, path, ownBytes, kind);
  return ownBytes + childBytes;
}

function estimatePlainObjectSize(
  value: Record<string, unknown>,
  path: string,
  context: TraceGraphSizeContext,
  depth: number
): number {
  const entries = Object.entries(value);
  let ownBytes = 32 + entries.length * 16;
  let childBytes = 0;
  if (depth < context.maxObjectDepth) {
    for (const [key, child] of entries) {
      ownBytes += key.length * 2;
      childBytes += estimateValueSize(child, `${path}.${key}`, context, depth + 1);
    }
  }
  addEntry(context, path, ownBytes, 'object');
  return ownBytes + childBytes;
}

function buildTraceGraphSizeBreakdown(
  report: TraceGraphSizeReport,
  graphStats?: TraceGraphSizeStats
): {
  totalBytes: number;
  rows: {
    spans: number | null;
    localDependencies: number | null;
    crossDependencies: number | null;
    spanAndDependencyRows: number | null;
  };
  bytesPerSpanAndDependencyRow: number | null;
  tableGroups: TraceGraphSizeBreakdownGroup[];
  rootGroups: TraceGraphSizeBreakdownGroup[];
  topEntries: TraceGraphSizeBreakdownGroup[];
} {
  const spanCount = getFiniteCount(graphStats?.spanCount);
  const localDependencyCount = getFiniteCount(graphStats?.localDependencyCount);
  const crossDependencyCount = getFiniteCount(graphStats?.crossDependencyCount);
  const spanAndDependencyRows =
    spanCount == null || localDependencyCount == null || crossDependencyCount == null
      ? null
      : spanCount + localDependencyCount + crossDependencyCount;

  return {
    totalBytes: report.totalBytes,
    rows: {
      spans: spanCount,
      localDependencies: localDependencyCount,
      crossDependencies: crossDependencyCount,
      spanAndDependencyRows
    },
    bytesPerSpanAndDependencyRow: getBytesPerRow(report.totalBytes, spanAndDependencyRows),
    tableGroups: [
      buildTableBreakdownGroup(
        report.entries,
        'SpanRef index tables',
        'processSpanTableMap',
        spanCount
      ),
      buildTableBreakdownGroup(
        report.entries,
        'Local dependency tables',
        'localDependencyTableMap',
        localDependencyCount
      ),
      buildTableBreakdownGroup(
        report.entries,
        'Span sidecar tables',
        'spanSidecarTableMap',
        spanCount
      ),
      buildTableBreakdownGroup(
        report.entries,
        'Cross dependency table',
        'crossDependencyTable',
        crossDependencyCount
      ),
      buildTableBreakdownGroup(report.entries, 'Event table', 'events', null)
    ].filter(group => group.bytes > 0),
    rootGroups: buildRootBreakdownGroups(report.entries).slice(0, 12),
    topEntries: report.entries.slice(0, 12).map(entry => ({
      label: entry.path,
      bytes: entry.bytes,
      rowCount: entry.rowCount ?? null,
      bytesPerRow: getBytesPerRow(entry.bytes, entry.rowCount ?? null),
      entryCount: 1
    }))
  };
}

function buildTableBreakdownGroup(
  entries: readonly TraceGraphSizeEntry[],
  label: string,
  pathPrefix: string,
  fallbackRowCount: number | null
): TraceGraphSizeBreakdownGroup {
  const tableEntries = entries.filter(
    entry =>
      entry.kind === 'arrow' &&
      (entry.path === pathPrefix || entry.path.startsWith(`${pathPrefix}.`))
  );
  const bytes = sumEntryBytes(tableEntries);
  const rowCount = fallbackRowCount ?? sumEntryRowCounts(tableEntries);
  return {
    label,
    bytes,
    rowCount,
    bytesPerRow: getBytesPerRow(bytes, rowCount),
    entryCount: tableEntries.length
  };
}

function buildRootBreakdownGroups(
  entries: readonly TraceGraphSizeEntry[]
): TraceGraphSizeBreakdownGroup[] {
  const rootGroups = new Map<string, TraceGraphSizeBreakdownGroup>();
  for (const entry of entries) {
    const label = entry.path.split(/[.[\]]/, 1)[0] || entry.path;
    const group = rootGroups.get(label) ?? {
      label,
      bytes: 0,
      rowCount: null,
      bytesPerRow: null,
      entryCount: 0
    };
    group.bytes += entry.bytes;
    group.rowCount = addNullableCounts(group.rowCount, entry.rowCount ?? null);
    group.entryCount += 1;
    rootGroups.set(label, group);
  }

  return [...rootGroups.values()]
    .map(group => ({
      ...group,
      bytesPerRow: getBytesPerRow(group.bytes, group.rowCount)
    }))
    .sort((left, right) => right.bytes - left.bytes);
}

function sumEntryBytes(entries: readonly TraceGraphSizeEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.bytes, 0);
}

function sumEntryRowCounts(entries: readonly TraceGraphSizeEntry[]): number | null {
  let rowCount = 0;
  for (const entry of entries) {
    if (typeof entry.rowCount === 'number') {
      rowCount += entry.rowCount;
    }
  }
  return rowCount > 0 ? rowCount : null;
}

function addNullableCounts(left: number | null, right: number | null): number | null {
  if (left == null) {
    return right;
  }
  if (right == null) {
    return left;
  }
  return left + right;
}

function getFiniteCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getBytesPerRow(bytes: number, rowCount: number | null | undefined): number | null {
  return typeof rowCount === 'number' && rowCount > 0 ? bytes / rowCount : null;
}

function countArrayBufferBytes(buffer: ArrayBufferLike, context: TraceGraphSizeContext): number {
  if (context.seenBuffers.has(buffer)) {
    return 0;
  }
  context.seenBuffers.add(buffer);
  return buffer.byteLength;
}

function addEntry(
  context: TraceGraphSizeContext,
  path: string,
  bytes: number,
  kind: TraceGraphSizeEntry['kind'],
  extra: Pick<TraceGraphSizeEntry, 'rowCount' | 'columnCount'> = {}
): number {
  if (bytes > 0) {
    context.totalBytes += bytes;
    context.bytesByKind[kind] += bytes;
    if (context.collectDetailedEntries) {
      context.entries.push({path, bytes, kind, ...extra});
    }
  }
  return bytes;
}

/** Merges one bounded component entry into a path-keyed TraceGraph size report accumulator. */
function mergeTraceGraphSizeEntry(
  entriesByPath: Map<string, TraceGraphSizeEntry>,
  entry: TraceGraphSizeEntry
): void {
  const existingEntry = entriesByPath.get(entry.path);
  if (!existingEntry) {
    entriesByPath.set(entry.path, entry);
    return;
  }
  entriesByPath.set(entry.path, {
    ...existingEntry,
    bytes: existingEntry.bytes + entry.bytes,
    rowCount: sumOptionalTraceGraphSizeEntryCount(existingEntry.rowCount, entry.rowCount),
    columnCount: sumOptionalTraceGraphSizeEntryCount(existingEntry.columnCount, entry.columnCount)
  });
}

/** Infers the broad storage kind used by one bounded TraceGraph component entry. */
function inferTraceGraphSizeKind(value: unknown): TraceGraphSizeEntry['kind'] {
  if (typeof value === 'string') {
    return 'string';
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return 'primitive';
  }
  if (value && typeof value === 'object') {
    if (isArrowTable(value)) {
      return 'arrow';
    }
    if (ArrayBuffer.isView(value)) {
      return 'typed-array';
    }
    if (value instanceof Map) {
      return 'map';
    }
    if (Array.isArray(value) || value instanceof Set) {
      return 'array';
    }
  }
  return 'object';
}

/** Sums optional aggregate TraceGraph size entry counts when either side is present. */
function sumOptionalTraceGraphSizeEntryCount(
  left: number | undefined,
  right: number | undefined
): number | undefined {
  if (left === undefined && right === undefined) {
    return undefined;
  }
  return (left ?? 0) + (right ?? 0);
}

function createEmptyBytesByKind(): Record<TraceGraphSizeEntry['kind'], number> {
  return {
    arrow: 0,
    map: 0,
    array: 0,
    object: 0,
    string: 0,
    'typed-array': 0,
    primitive: 0
  };
}
