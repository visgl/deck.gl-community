import {encodeSpanRef, getLocalDependencyRefRowIndex} from './trace-id-encoder';

import type {ArrowTraceLocalDependencyTable, ArrowTraceSpanTable} from '../ingestion/arrow-trace';
import type {LocalDependencyRef} from './trace-id-encoder';
import type {SpanRef, TraceDependencyId, TraceLocalDependency, TraceSpanId} from './trace-types';

/** Parameters used to materialize local-dependency objects from Arrow rows. */
export type TraceLocalDependencyArrowAccessParams = {
  /** Canonical process-local Arrow dependency table. */
  localDependencyTable: Readonly<ArrowTraceLocalDependencyTable>;
  /** Canonical process-local Arrow span table used to resolve endpoint span refs. */
  spanTable: Readonly<ArrowTraceSpanTable>;
  /** Graph-local chunk/process index encoded into local dependency refs. */
  processIndex: number;
};

/**
 * Returns one local dependency object from a canonical Arrow dependency table row.
 *
 * This is a compatibility boundary for code that still expects `TraceLocalDependency` objects.
 * Runtime ingestion should pass the Arrow table through unchanged and call this only for rows that
 * are actually inspected.
 */
export function materializeTraceLocalDependencyFromArrowRow(
  params: TraceLocalDependencyArrowAccessParams & {
    /** Process-local dependency row index to materialize. */
    rowIndex: number;
  }
): TraceLocalDependency {
  const {localDependencyTable, rowIndex} = params;
  const dependencyId = localDependencyTable.getChild('dependencyId')?.get(rowIndex);
  const startSpanRef = normalizeSpanRef(
    localDependencyTable.getChild('startSpanRef')?.get(rowIndex)
  );
  const startSpanId = localDependencyTable.getChild('startSpanId')?.get(rowIndex);
  const endSpanRef = normalizeSpanRef(localDependencyTable.getChild('endSpanRef')?.get(rowIndex));
  const endSpanId = localDependencyTable.getChild('endSpanId')?.get(rowIndex);
  const waitMode = localDependencyTable.getChild('waitMode')?.get(rowIndex);
  const bidirectional = localDependencyTable.getChild('bidirectional')?.get(rowIndex);
  const waitTimeMs = localDependencyTable.getChild('waitTimeMs')?.get(rowIndex);
  const hasParentKeyword = localDependencyTable.getChild('hasParentKeyword')?.get(rowIndex);
  const keywords = localDependencyTable.getChild('keywords')?.get(rowIndex);
  if (
    typeof dependencyId !== 'string' ||
    typeof startSpanId !== 'string' ||
    typeof endSpanId !== 'string' ||
    !isTraceLocalDependencyWaitMode(waitMode)
  ) {
    throw new Error(`Invalid local dependency Arrow row ${rowIndex}`);
  }

  return {
    type: 'trace-local-dependency',
    startSpanRef: startSpanRef ?? resolveSpanRefForSpanId(params, startSpanId as TraceSpanId),
    endSpanRef: endSpanRef ?? resolveSpanRefForSpanId(params, endSpanId as TraceSpanId),
    dependencyId: dependencyId as TraceDependencyId,
    startSpanId: startSpanId as TraceSpanId,
    endSpanId: endSpanId as TraceSpanId,
    keywords:
      keywords == null
        ? new Set(hasParentKeyword ? ['PARENT'] : [])
        : new Set(Array.from(keywords as Iterable<string>)),
    waitMode,
    bidirectional: Boolean(bidirectional),
    waitTimeMs: typeof waitTimeMs === 'number' ? waitTimeMs : 0
  };
}

/**
 * Returns a lazy array-compatible view over a local dependency Arrow table.
 *
 * The returned value supports the array operations used by existing TraceGraph consumers, but rows
 * are materialized only when accessed or iterated.
 */
export function createLazyTraceLocalDependencyArray(
  params: TraceLocalDependencyArrowAccessParams
): TraceLocalDependency[] {
  const cache = new Map<number, TraceLocalDependency>();
  const getDependency = (rowIndex: number) => {
    let dependency = cache.get(rowIndex);
    if (!dependency) {
      dependency = materializeTraceLocalDependencyFromArrowRow({...params, rowIndex});
      cache.set(rowIndex, dependency);
    }
    return dependency;
  };
  const toArray = () =>
    Array.from({length: params.localDependencyTable.numRows}, (_, rowIndex) =>
      getDependency(rowIndex)
    );
  const lazyArray = {
    length: params.localDependencyTable.numRows,
    at: (index: number) =>
      getDependency(normalizeArrayIndex(index, params.localDependencyTable.numRows)),
    entries: function* () {
      for (let rowIndex = 0; rowIndex < params.localDependencyTable.numRows; rowIndex += 1) {
        yield [rowIndex, getDependency(rowIndex)] as [number, TraceLocalDependency];
      }
    },
    every: (callback: ArrayEveryCallback<TraceLocalDependency>) => toArray().every(callback),
    filter: (callback: ArrayFilterCallback<TraceLocalDependency>) => toArray().filter(callback),
    find: (callback: ArrayFindCallback<TraceLocalDependency>) => toArray().find(callback),
    flatMap: <ResultT>(callback: ArrayMapCallback<TraceLocalDependency, ResultT | ResultT[]>) =>
      toArray().flatMap(callback),
    forEach: (callback: ArrayForEachCallback<TraceLocalDependency>) => toArray().forEach(callback),
    map: <ResultT>(callback: ArrayMapCallback<TraceLocalDependency, ResultT>) =>
      toArray().map(callback),
    reduce: <ResultT>(
      callback: (
        previousValue: ResultT,
        currentValue: TraceLocalDependency,
        currentIndex: number,
        array: TraceLocalDependency[]
      ) => ResultT,
      initialValue: ResultT
    ) => toArray().reduce(callback, initialValue),
    some: (callback: ArraySomeCallback<TraceLocalDependency>) => toArray().some(callback),
    toJSON: toArray,
    values: function* () {
      for (let rowIndex = 0; rowIndex < params.localDependencyTable.numRows; rowIndex += 1) {
        yield getDependency(rowIndex);
      }
    },
    [Symbol.iterator]: function* () {
      for (let rowIndex = 0; rowIndex < params.localDependencyTable.numRows; rowIndex += 1) {
        yield getDependency(rowIndex);
      }
    }
  };

  return new Proxy(lazyArray, {
    get(target, property, receiver) {
      if (typeof property === 'string' && isArrayIndexProperty(property)) {
        const rowIndex = Number(property);
        return rowIndex < params.localDependencyTable.numRows ? getDependency(rowIndex) : undefined;
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      return (
        (typeof property === 'string' &&
          isArrayIndexProperty(property) &&
          Number(property) < params.localDependencyTable.numRows) ||
        Reflect.has(target, property)
      );
    }
  }) as unknown as TraceLocalDependency[];
}

/**
 * Iterates materialized local dependency objects for one Arrow-backed process.
 */
export function* iterateTraceLocalDependenciesFromArrowTable(
  params: TraceLocalDependencyArrowAccessParams
): IterableIterator<TraceLocalDependency> {
  for (let rowIndex = 0; rowIndex < params.localDependencyTable.numRows; rowIndex += 1) {
    yield materializeTraceLocalDependencyFromArrowRow({...params, rowIndex});
  }
}

/**
 * Resolves one local dependency ref to a materialized dependency object.
 */
export function getTraceLocalDependencyByRefFromArrowTable(
  params: TraceLocalDependencyArrowAccessParams & {
    /** Packed local dependency ref whose row index should be resolved. */
    dependencyRef: LocalDependencyRef;
  }
): TraceLocalDependency | null {
  const rowIndex = getLocalDependencyRefRowIndex(params.dependencyRef);
  if (rowIndex < 0 || rowIndex >= params.localDependencyTable.numRows) {
    return null;
  }
  return materializeTraceLocalDependencyFromArrowRow({...params, rowIndex});
}

/**
 * Builds a block-id adjacency map from one process-local Arrow dependency table.
 */
export function buildLocalDependencyBlockAdjacencyFromArrowTable(
  params: TraceLocalDependencyArrowAccessParams
): Readonly<Record<TraceSpanId, readonly TraceLocalDependency[]>> {
  const map = Object.create(null) as Record<TraceSpanId, TraceLocalDependency[]>;
  for (const dependency of iterateTraceLocalDependenciesFromArrowTable(params)) {
    map[dependency.startSpanId] ??= [];
    map[dependency.startSpanId].push(dependency);
    map[dependency.endSpanId] ??= [];
    map[dependency.endSpanId].push(dependency);
  }
  return map;
}

function resolveSpanRefForSpanId(
  params: TraceLocalDependencyArrowAccessParams,
  spanId: TraceSpanId
): SpanRef | undefined {
  const spanIdColumn = params.spanTable.getChild('span_id');
  for (let rowIndex = 0; rowIndex < params.spanTable.numRows; rowIndex += 1) {
    if (spanIdColumn?.get(rowIndex) === spanId) {
      return encodeSpanRef(params.processIndex, rowIndex);
    }
  }
  return undefined;
}

/** Normalizes an Arrow scalar span-ref value, treating null and NaN as unresolved. */
function normalizeSpanRef(value: unknown): SpanRef | undefined {
  const spanRef =
    typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : null;
  return spanRef != null && Number.isSafeInteger(spanRef) && spanRef >= 0
    ? (spanRef as SpanRef)
    : undefined;
}

function isTraceLocalDependencyWaitMode(value: unknown): value is TraceLocalDependency['waitMode'] {
  return value === 'end-to-start' || value === 'end-to-end' || value === 'start-to-start';
}

function isArrayIndexProperty(property: string): boolean {
  if (property.length === 0) {
    return false;
  }
  const value = Number(property);
  return Number.isInteger(value) && value >= 0 && String(value) === property;
}

function normalizeArrayIndex(index: number, length: number): number {
  return index < 0 ? Math.max(0, length + index) : index;
}

type ArrayEveryCallback<ValueT> = (value: ValueT, index: number, array: ValueT[]) => unknown;
type ArrayFilterCallback<ValueT> = (value: ValueT, index: number, array: ValueT[]) => unknown;
type ArrayFindCallback<ValueT> = (value: ValueT, index: number, array: ValueT[]) => unknown;
type ArrayForEachCallback<ValueT> = (value: ValueT, index: number, array: ValueT[]) => void;
type ArrayMapCallback<ValueT, ResultT> = (value: ValueT, index: number, array: ValueT[]) => ResultT;
type ArraySomeCallback<ValueT> = (value: ValueT, index: number, array: ValueT[]) => unknown;
