import {createColorWheel, getPerfettoSliceColor, interpolateColor} from './color-palette';

import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceProcess,
  TraceSpan,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';

/** RGBA tuple used by rendering layers, in 0-255 channel order. */
export type TraceColor = Readonly<[number, number, number, number]>;

/** RGBA tuple used by deck renderers. */
export type TraceDeckColor = TraceColor;

/** Minimal span payload required by color-scheme hooks. */
export type TraceSpanColorSource = Pick<
  TraceSpan,
  | 'spanRef'
  | 'spanId'
  | 'threadId'
  | 'processName'
  | 'name'
  | 'keywords'
  | 'primaryTimingKey'
  | 'timings'
  | 'crossProcessEndpointId'
  | 'crossProcessDependencyEndpoints'
  | 'userData'
>;

/** Optional span-level colors returned by a combined color style hook. */
export type TraceSpanColorStyle = {
  /** Optional fill color for the span body. */
  spanFillColor?: TraceColor;
  /** Optional stroke color for span borders/lines. */
  spanBorderColor?: TraceColor;
  /** Optional text color for labels rendered inside spans. */
  spanTextColor?: TraceColor;
};

/** Input passed to span color hooks. */
export type TraceSpanColorParams = {
  /** Span currently being styled. */
  span: TraceSpanColorSource;
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
  /** Returns decoded user data for one span ref. */
  getSpanUserData(spanRef: SpanRef): Record<string, unknown> | undefined;
  /** Returns the primary timing key for one span ref. */
  getSpanPrimaryTimingKey(spanRef: SpanRef): string | null;
  /** Returns the primary timing status for one span ref. */
  getSpanStatus(spanRef: SpanRef): TraceSpan['timings'][string]['status'] | null;
  /** Returns the primary start time in milliseconds for one span ref. */
  getSpanStartTimeMs(spanRef: SpanRef): number | null;
  /** Returns the primary end time in milliseconds for one span ref. */
  getSpanEndTimeMs(spanRef: SpanRef): number | null;
};

/** Input passed to ref-native span color hooks. */
export type TraceSpanColorRefParams = Omit<TraceSpanColorParams, 'span'> & {
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

/** Inputs for process background color hooks. */
export type TraceProcessColorParams = {
  /** Zero-based process index in process ordering. */
  processIndex: number;
  /** Stable process identifier. */
  processId: string;
  /** Full process metadata object. */
  process: TraceProcess;
};

/** Contract for a trace color strategy used across trace graph renderers. */
export type TraceColorScheme = {
  /** Unique scheme identifier. */
  id: string;
  /** Human-readable scheme name shown in selectors. */
  name: string;
  /** Optional selector subtext explaining how the scheme colors spans. */
  description?: string;
  /** Resolve keyword-driven badge/tooltip presentation. */
  getKeywordPresentation?: (params: {
    /** Keywords attached to the span. */
    keywords: readonly string[];
  }) => TraceKeywordPresentation | undefined;

  /** Resolve a fill color override for the given span. */
  getSpanFillColor?: (params: TraceSpanColorParams) => TraceColor | undefined;

  /** Resolve a border color override for the given span. */
  getSpanBorderColor?: (params: TraceSpanColorParams) => TraceColor | undefined;

  /** Resolve a combined span style including fill/border/text overrides. */
  getSpanStyle?: (params: TraceSpanColorParams) => TraceSpanColorStyle | undefined;

  /** Resolve a span text color override. */
  getSpanTextColor?: (params: TraceSpanColorParams) => TraceColor | undefined;

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

  /** Resolve process background colors. */
  getProcessBackgroundColor?: (params: TraceProcessColorParams) => TraceColor | undefined;
};

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

const SPAN_BORDER_CONTRAST_AMOUNT = 0.24;
const SPAN_BORDER_LUMINANCE_THRESHOLD = 140;
const processColorWheel = createColorWheel();

function getProcessColorKey(span: TraceSpanColorSource): string {
  return typeof span.userData?.processId === 'string' && span.userData.processId.length > 0
    ? span.userData.processId
    : span.processName;
}

function getProcessColorKeyForRef(params: TraceSpanColorRefParams): string {
  const userData = params.traceGraph.getSpanUserData(params.spanRef);
  const processId = userData?.processId;
  return typeof processId === 'string' && processId.length > 0
    ? processId
    : (params.traceGraph.getSpanRankName(params.spanRef) ?? '');
}

function getProcessColor(processId: string): TraceColor {
  return processColorWheel.getColorByKey(processId || '__unknown_process__');
}

function withAlpha(color: TraceColor, alpha: number): TraceColor {
  return [color[0], color[1], color[2], alpha];
}

/** Built-in color scheme that assigns a stable wheel color per process id. */
export const PROCESS_TRACE_COLOR_SCHEME: TraceColorScheme = {
  id: 'processes',
  name: 'Process Id',
  description: 'Color spans by process/rank id.',
  getSpanFillColor: ({span}) => getProcessColor(getProcessColorKey(span)),
  getSpanBorderColor: ({span}) =>
    getReadableSpanBorderColor(getProcessColor(getProcessColorKey(span))),
  getSpanFillColorForRef: params => getProcessColor(getProcessColorKeyForRef(params)),
  getSpanBorderColorForRef: params =>
    getReadableSpanBorderColor(getProcessColor(getProcessColorKeyForRef(params))),
  getThreadColor: ({thread, threadId}) => getProcessColor(thread?.processId ?? threadId),
  getProcessBackgroundColor: ({processId}) => withAlpha(getProcessColor(processId), 32)
};

/** Built-in color scheme that assigns a stable wheel color per span name. */
export const PERFETTO_TRACE_COLOR_SCHEME: TraceColorScheme = {
  id: 'perfetto',
  name: 'Perfetto (Span Names)',
  description: 'Color spans with Perfetto-style colors derived from span names.',
  getSpanStyle: ({span}) => {
    const spanColor = getPerfettoSliceColor(span.name || '__unknown_span__');
    return {
      spanFillColor: spanColor,
      spanBorderColor: getReadableSpanBorderColor(spanColor)
    };
  },
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
