import {createColorWheel, getPerfettoSliceColor, interpolateColor} from './color-palette';

import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceSpanAttributePath,
  TraceSpanTiming,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';

/** RGBA tuple used by rendering layers, in 0-255 channel order. */
export type TraceColor = Readonly<[number, number, number, number]>;

/** RGBA tuple used by deck renderers. */
export type TraceDeckColor = TraceColor;

/** Optional span-level colors returned by a combined color style hook. */
export type TraceSpanColorStyle = {
  /** Optional fill color for the span body. */
  spanFillColor?: TraceColor;
  /** Optional stroke color for span borders/lines. */
  spanBorderColor?: TraceColor;
  /** Optional text color for labels rendered inside spans. */
  spanTextColor?: TraceColor;
};

/** Shared visualization context passed to ref-native span color hooks. */
export type TraceSpanColorContext = {
  /** Active visualization settings. */
  settings: TraceVisSettings;
  /** Optional path context used by critical-path highlighting. */
  path?: 'path' | 'any';
  /** Runtime span refs to keep fully opaque when path highlighting is active. */
  highlightedSpanRefs?: ReadonlySet<SpanRef>;
  /** Label placement hint for text color decisions. */
  labelPlacement?: 'inside' | 'outside';
};

/** Minimal TraceGraph accessor surface required by ref-native span color hooks. */
export type TraceSpanColorAccessorSource = {
  /** Returns the display process label for one span ref. */
  getSpanRankName(spanRef: SpanRef): string | null;
  /** Returns the thread id for one span ref. */
  getSpanStreamId(spanRef: SpanRef): TraceThreadId | null;
  /** Returns the display name for one span ref. */
  getSpanName(spanRef: SpanRef): string | null;
  /** Returns keyword labels for one span ref. */
  getSpanKeywords(spanRef: SpanRef): readonly string[];
  /** Returns one declared row-aligned user-data attribute for one span ref. */
  getSpanAttribute(spanRef: SpanRef, path: TraceSpanAttributePath): unknown;
  /** Returns whether every loaded span table declares one optional attribute path. */
  hasSpanAttribute?(path: TraceSpanAttributePath): boolean;
  /** Returns the primary timing key for one span ref. */
  getSpanPrimaryTimingKey(spanRef: SpanRef): string | null;
  /** Returns the primary timing status for one span ref. */
  getSpanStatus(spanRef: SpanRef): TraceSpanTiming['status'] | null;
  /** Returns the primary start time in milliseconds for one span ref. */
  getSpanStartTimeMs(spanRef: SpanRef): number | null;
  /** Returns the primary end time in milliseconds for one span ref. */
  getSpanEndTimeMs(spanRef: SpanRef): number | null;
};

/** Input passed to ref-native span color hooks. */
export type TraceSpanColorRefParams = TraceSpanColorContext & {
  /** Span currently being styled. */
  spanRef: SpanRef;
  /** TraceGraph accessor source used to read fields without materializing a span object. */
  traceGraph: TraceSpanColorAccessorSource;
};

/** Optional keyword badge presentation metadata. */
export type TraceKeywordPresentation = {
  /** Preferred color for keyword chips and badges. */
  color?: TraceColor;
  /** Optional keyword tooltip text. */
  description?: string;
};

/** Inputs for thread-level color hooks. */
export type TraceThreadColorParams = {
  /** Thread object being colored, when available. */
  thread?: TraceThread;
  /** Stable fallback thread id used for deterministic mappings. */
  threadId: string;
};

/** Contract for a trace color strategy used across trace graph renderers. */
export type TraceColorScheme = {
  /** Unique scheme identifier. */
  id: string;
  /** Human-readable scheme name shown in selectors. */
  name: string;
  /** Optional selector subtext explaining how the scheme colors spans. */
  description?: string;
  /** User-data leaves required by this scheme's ref-native color hooks. */
  requiredSpanAttributePaths?: readonly TraceSpanAttributePath[];
  /** Resolve keyword-driven badge/tooltip presentation. */
  getKeywordPresentation?: (params: {
    /** Keywords attached to the span. */
    keywords: readonly string[];
  }) => TraceKeywordPresentation | undefined;

  /** Resolve a fill color override from a span ref without materializing a span object. */
  getSpanFillColorForRef?: (params: TraceSpanColorRefParams) => TraceColor | undefined;

  /** Resolve a border color override from a span ref without materializing a span object. */
  getSpanBorderColorForRef?: (params: TraceSpanColorRefParams) => TraceColor | undefined;

  /** Resolve a combined style from a span ref without materializing a span object. */
  getSpanStyleForRef?: (params: TraceSpanColorRefParams) => TraceSpanColorStyle | undefined;

  /** Resolve a text color override from a span ref without materializing a span object. */
  getSpanTextColorForRef?: (params: TraceSpanColorRefParams) => TraceColor | undefined;

  /** Resolve thread/lane colors. */
  getThreadColor?: (params: TraceThreadColorParams) => TraceColor | undefined;
};

/** Collects stable unique span-attribute paths declared by registered color schemes. */
export function collectTraceColorSchemeAttributePaths(
  schemes: readonly TraceColorScheme[]
): readonly TraceSpanAttributePath[] {
  const pathsByKey = new Map<string, TraceSpanAttributePath>();
  for (const scheme of schemes) {
    for (const path of scheme.requiredSpanAttributePaths ?? []) {
      pathsByKey.set(JSON.stringify(path), path);
    }
  }
  return [...pathsByKey.values()];
}

/** Returns whether one color scheme's declared span attributes exist in the loaded graph. */
export function isTraceColorSchemeAvailable(
  traceGraph: Pick<TraceSpanColorAccessorSource, 'hasSpanAttribute'>,
  scheme: TraceColorScheme
): boolean {
  return (scheme.requiredSpanAttributePaths ?? []).every(
    path => traceGraph.hasSpanAttribute?.(path) === true
  );
}

/** Reads one declared attribute path from already-materialized user data. */
export function getTraceSpanAttributeValue(
  userData: Record<string, unknown> | undefined,
  path: TraceSpanAttributePath
): unknown {
  let value: unknown = userData;
  for (const key of path) {
    if (value == null || typeof value !== 'object' || Array.isArray(value) || !(key in value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * Derive a visible span border color from a fill color while preserving the fill alpha.
 */
export function getReadableSpanBorderColor(spanFillColor: TraceColor): TraceColor {
  const [red, green, blue, alpha] = spanFillColor;
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  const contrastTarget: TraceColor =
    luminance >= SPAN_BORDER_LUMINANCE_THRESHOLD ? [0, 0, 0, alpha] : [255, 255, 255, alpha];

  return interpolateColor(spanFillColor, contrastTarget, SPAN_BORDER_CONTRAST_AMOUNT);
}

/** Resolves the built-in process palette color for one canonical process display name. */
export function getProcessTraceColor(processName: string): TraceColor {
  return processColorWheel.getColorByKey(processName || '__unknown_process__');
}

const SPAN_BORDER_CONTRAST_AMOUNT = 0.24;
const SPAN_BORDER_LUMINANCE_THRESHOLD = 140;
const processColorWheel = createColorWheel();

/** Resolves one span's built-in color from its canonical owning process display name. */
function getProcessColorForRef(params: TraceSpanColorRefParams): TraceColor {
  return getProcessTraceColor(params.traceGraph.getSpanRankName(params.spanRef) ?? '');
}

/** Built-in color scheme that assigns a stable wheel color per canonical process name. */
export const PROCESS_TRACE_COLOR_SCHEME: TraceColorScheme = {
  id: 'processes',
  name: 'Process',
  description: 'Color spans by canonical process name.',
  getSpanFillColorForRef: params => getProcessColorForRef(params),
  getSpanBorderColorForRef: params => getReadableSpanBorderColor(getProcessColorForRef(params)),
  getSpanStyleForRef: params => {
    const spanFillColor = getProcessColorForRef(params);
    return {
      spanFillColor,
      spanBorderColor: getReadableSpanBorderColor(spanFillColor)
    };
  },
  getThreadColor: ({thread, threadId}) => getProcessTraceColor(thread?.processId ?? threadId)
};

/** Built-in color scheme that assigns a stable wheel color per span name. */
export const PERFETTO_TRACE_COLOR_SCHEME: TraceColorScheme = {
  id: 'perfetto',
  name: 'Perfetto (Span Names)',
  description: 'Color spans with Perfetto-style colors derived from span names.',
  getSpanStyleForRef: ({traceGraph, spanRef}) => {
    const spanColor = getPerfettoSliceColor(traceGraph.getSpanName(spanRef) || '__unknown_span__');
    return {
      spanFillColor: spanColor,
      spanBorderColor: getReadableSpanBorderColor(spanColor)
    };
  }
};

/** Default color scheme used when a view does not provide an app-specific scheme. */
export const DEFAULT_TRACE_COLOR_SCHEME: TraceColorScheme = PROCESS_TRACE_COLOR_SCHEME;
