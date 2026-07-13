import type {TraceSpanTiming} from '../trace-graph/trace-types';

/** Compact canonical Arrow code for the closed primary-timing status domain. */
export type TraceSpanTimingStatusCode = 0 | 1 | 2;

/**
 * Encodes one trace timing status into its canonical Uint8-compatible scalar.
 *
 * @param status Closed-domain trace timing status owned by the source row.
 * @returns Stable compact timing-status code.
 */
export function encodeTraceSpanTimingStatusCode(
  status: TraceSpanTiming['status']
): TraceSpanTimingStatusCode {
  switch (status) {
    case 'not-started':
      return 0;
    case 'not-finished':
      return 1;
    case 'finished':
      return 2;
  }
}

/**
 * Decodes one canonical compact timing-status scalar without reading Utf8.
 *
 * @param value Unknown Arrow scalar read from a status_code column.
 * @returns Decoded timing status, or null for invalid and missing codes.
 */
export function decodeTraceSpanTimingStatusCode(value: unknown): TraceSpanTiming['status'] | null {
  switch (value) {
    case 0:
      return 'not-started';
    case 1:
      return 'not-finished';
    case 2:
      return 'finished';
    default:
      return null;
  }
}
