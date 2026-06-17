import {ReactNode} from 'react';

import {formatTimeMs, lowerCase, pluralize} from '../../../../trace/index';

import type {
  ResolvedTraceLabels,
  TraceSpanCardLabelInput
} from './trace-span-card/trace-span-card-types';

/**
 * Resolve optional trace labels into the normalized card-local label bundle.
 */
export function resolveTraceSpanCardLabels(
  traceLabels?: TraceSpanCardLabelInput
): ResolvedTraceLabels {
  const spanLabel = traceLabels?.spanLabel?.trim() || 'Span';
  const processLabel = traceLabels?.processLabel?.trim() || 'Process';
  const threadLabel = traceLabels?.threadLabel?.trim() || 'Thread';

  return {
    spanLabel,
    processLabel,
    threadLabel,
    spanLabelUpper: spanLabel.toUpperCase(),
    processLabelUpper: processLabel.toUpperCase(),
    spanLabelLower: lowerCase(spanLabel),
    processLabelLower: lowerCase(processLabel),
    spanLabelPlural: pluralize(spanLabel),
    processLabelPlural: pluralize(processLabel),
    threadLabelUpper: threadLabel.toUpperCase(),
    threadLabelLower: lowerCase(threadLabel)
  };
}

/**
 * Format a trace-relative timestamp with stable sub-minute precision.
 */
export function formatRelativeTraceTimeLabel(timeMs: number, traceStartTimeMs: number): string {
  const relativeMs = Math.max(0, timeMs - traceStartTimeMs);
  if (relativeMs === 0) {
    return '0s';
  }
  if (relativeMs < 1) {
    return formatFixedTimeUnit(relativeMs, 0.001, 'µs');
  }
  if (relativeMs < 1000) {
    return formatFixedTimeUnit(relativeMs, 1, 'ms');
  }
  if (relativeMs < 3_600_000) {
    return formatFixedTimeUnit(relativeMs, 1000, 's');
  }
  return formatTimeMs(relativeMs, {space: false, roundDigits: 4});
}

/**
 * Format a userData value for the generic Span Data tab.
 */
export function formatUserDataValue(value: unknown): ReactNode {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  try {
    return (
      <pre className="whitespace-pre-wrap break-words">
        {JSON.stringify(toJsonSafeSpanDataValue(value), null, 2)}
      </pre>
    );
  } catch {
    return String(value);
  }
}

/**
 * Format a millisecond value in a fixed unit with three decimal places.
 */
function formatFixedTimeUnit(value: number, unitMs: number, suffix: string): string {
  return `${parseFloat((value / unitMs).toFixed(3)).toString()}${suffix}`;
}

/**
 * Convert nested span-data values into a JSON-safe shape that preserves bigint precision.
 */
function toJsonSafeSpanDataValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'symbol') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(entry => toJsonSafeSpanDataValue(entry, seen));
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    if (ArrayBuffer.isView(value)) {
      const arrayLikeView = value as ArrayBufferView & {length?: number};
      if (typeof arrayLikeView.length === 'number') {
        return Array.from(arrayLikeView as unknown as ArrayLike<unknown>, entry =>
          toJsonSafeSpanDataValue(entry, seen)
        );
      }
      return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), entry =>
        toJsonSafeSpanDataValue(entry, seen)
      );
    }
    if (value instanceof Map) {
      return Object.fromEntries(
        Array.from(value.entries()).map(([key, entryValue]) => [
          String(key),
          toJsonSafeSpanDataValue(entryValue, seen)
        ])
      );
    }
    if (value instanceof Set) {
      return Array.from(value.values(), entry => toJsonSafeSpanDataValue(entry, seen));
    }
    if (isSpanDataIterable(value)) {
      return Array.from(value, entry => toJsonSafeSpanDataValue(entry, seen));
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        toJsonSafeSpanDataValue(entryValue, seen)
      ])
    );
  }
  return value;
}

function isSpanDataIterable(value: object): value is Iterable<unknown> {
  return typeof (value as {[Symbol.iterator]?: unknown})[Symbol.iterator] === 'function';
}
