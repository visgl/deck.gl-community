import {DEFAULT_TRACE_COLOR_SCHEME} from './trace-color-scheme';

import type {TraceColorScheme} from './trace-color-scheme';

/** Complete visual style configuration consumed by shared Tracevis surfaces. */
export type TraceStyle = {
  /** Active color scheme used to style spans, threads, and processes. */
  colorScheme: TraceColorScheme;

  /** CSS font stack used by Tracevis deck text layers. */
  fontFamily: string;

  /** Human-readable labels used by trace UI surfaces. */
  labels: {
    /** Singular label for process-level rows. */
    processLabel: string;
    /** Singular label for thread-level lanes. */
    threadLabel: string;
    /** Singular label for span-level spans. */
    spanLabel: string;
  };

  /** Minimum wait time for a SUBMIT dependency to be considered valid. */
  SUBMIT_MIN_WAIT_TIME_MS?: number;
  /** List of stream types to hide from the trace graph. */
  HIDDEN_STREAMS?: string[];
};

/** Human-readable trace entity labels shown by Tracevis UI components. */
export type TraceLabels = TraceStyle['labels'];

/** Default CSS font stack used by OSS Tracevis deck text layers. */
export const DEFAULT_TRACE_FONT_FAMILY = 'system-ui, sans-serif';

/** Default OSS-safe Tracevis style. */
export const DEFAULT_TRACE_STYLE = {
  colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
  fontFamily: DEFAULT_TRACE_FONT_FAMILY,
  labels: {
    processLabel: 'Process',
    threadLabel: 'Thread',
    spanLabel: 'Span'
  }
} as const satisfies TraceStyle;

/** Merges partial trace-style overrides onto the OSS-safe default style. */
export function makeTraceStyle(overrides: Partial<TraceStyle>): TraceStyle {
  return {
    ...DEFAULT_TRACE_STYLE,
    ...overrides,
    labels: {
      ...DEFAULT_TRACE_STYLE.labels,
      ...overrides.labels
    }
  };
}
