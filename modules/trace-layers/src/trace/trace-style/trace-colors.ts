import {log} from '../log';
import {getPrimaryTiming} from '../trace-graph/trace-types';
import {DEFAULT_SUBMIT_MIN_WAIT_TIME_MS} from '../trace-layout/local-dependency-filter';
import {interpolateColor, makeDeckColor} from './color-palette';
import {getReadableSpanBorderColor} from './trace-color-scheme';

import type {TraceSelectedDependencyDirection} from '../trace-graph/trace-graph-types';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {SpanRef, TraceProcess, TraceThread} from '../trace-graph/trace-types';
import type {
  TraceColor,
  TraceColorScheme,
  TraceDeckColor,
  TraceSpanColorAccessorSource,
  TraceSpanColorRefParams,
  TraceSpanColorSource,
  TraceSpanColorStyle
} from './trace-color-scheme';

/** Parameters used to create a trace color resolver for one render context. */
export type TraceColorResolverParams = {
  /** Active color scheme used for application-specific color hooks. */
  colorScheme?: TraceColorScheme;
  /** Active visualization settings used for fallback and fade behavior. */
  settings: TraceVisSettings;
  /** Runtime span refs that should remain emphasized when highlight fading is active. */
  highlightedSpanRefs?: ReadonlySet<SpanRef>;
  /** Whether non-highlighted span fill and border alpha should be faded. */
  applyHighlightFade?: boolean;
};

/** Resolver for final trace render colors after scheme hooks and fallbacks are applied. */
export type TraceColorResolver = {
  /** Resolve the final combined style for one span. */
  getSpanStyle: (
    span: TraceSpanColorSource,
    path?: 'path' | 'any',
    labelPlacement?: 'inside' | 'outside'
  ) => TraceSpanColorStyle;
  /** Resolve the final fill color for one span. */
  getSpanFillColor: (span: TraceSpanColorSource, path?: 'path' | 'any') => TraceDeckColor;
  /** Resolve the final border color for one span. */
  getSpanBorderColor: (span: TraceSpanColorSource, path?: 'path') => TraceDeckColor;
  /** Resolve the final label text color for one span. */
  getSpanTextColor: (
    span: TraceSpanColorSource,
    path?: 'path' | 'any',
    labelPlacement?: 'inside' | 'outside'
  ) => TraceDeckColor;
  /** Resolve the final thread/lane color for one thread. */
  getThreadColor: (thread: TraceThread | undefined) => TraceDeckColor | undefined;
  /** Resolve the final process background color for one process. */
  getProcessBackgroundColor: (params: {
    /** Zero-based process index in process ordering. */
    processIndex: number;
    /** Process metadata object being colored. */
    process: TraceProcess;
  }) => TraceDeckColor | undefined;
};

/** Parameters used to create a ref-native trace color resolver for one render context. */
export type TraceGraphColorResolverParams = TraceColorResolverParams & {
  /** TraceGraph accessor source used to read span fields without materializing span objects. */
  traceGraph: TraceSpanColorAccessorSource & {
    /** Optional compatibility fallback for color schemes that have not implemented ref hooks. */
    getSpanDisplaySource?: (spanRef: SpanRef) => TraceSpanColorSource | null;
  };
};

/** Resolver for span-ref keyed render colors after scheme hooks and fallbacks are applied. */
export type TraceGraphColorResolver = {
  /** Resolve the final fill color for one span ref. */
  getSpanFillColor: (spanRef: SpanRef, path?: 'path' | 'any') => TraceDeckColor;
  /** Resolve the final border color for one span ref. */
  getSpanBorderColor: (spanRef: SpanRef, path?: 'path') => TraceDeckColor;
  /** Resolve the final label text color for one span ref. */
  getSpanTextColor: (
    spanRef: SpanRef,
    path?: 'path' | 'any',
    labelPlacement?: 'inside' | 'outside'
  ) => TraceDeckColor;
};

type LocalDependencyColorSource = {
  /** Dependency keywords used to detect submit edges. */
  keywords: ReadonlySet<string>;
  /** Wait duration used to color warning states. */
  waitTimeMs: number;
};
type CrossDependencyColorSource = {
  /** Wait duration used to color warning states. */
  waitTimeMs: number;
};
type TraceSpanColorResolverRefParams = TraceSpanColorRefParams & {
  /** Active color scheme used for application-specific color hooks. */
  colorScheme?: TraceColorScheme;
};

export {
  COLORS,
  COLORS_LIST,
  createColorWheel,
  getPerfettoSliceColor,
  interpolateColor,
  makeDeckColor
} from './color-palette';

export {
  DEFAULT_TRACE_COLOR_SCHEME,
  getReadableSpanBorderColor,
  PERFETTO_TRACE_COLOR_SCHEME,
  PROCESS_TRACE_COLOR_SCHEME
} from './trace-color-scheme';
export type {
  TraceSpanColorParams,
  TraceSpanColorAccessorSource,
  TraceSpanColorRefParams,
  TraceSpanColorSource,
  TraceSpanColorStyle,
  TraceColorScheme,
  TraceColor,
  TraceDeckColor
} from './trace-color-scheme';

/** Create a color resolver for one trace render context. */
export function createTraceColorResolver({
  colorScheme,
  settings,
  highlightedSpanRefs,
  applyHighlightFade = true
}: TraceColorResolverParams): TraceColorResolver {
  return {
    getSpanStyle: (span, path, labelPlacement = 'inside') => ({
      spanFillColor: resolveSpanFillColor(
        span,
        settings,
        path,
        colorScheme,
        highlightedSpanRefs,
        applyHighlightFade
      ),
      spanBorderColor: resolveSpanBorderColor(
        span,
        settings,
        path === 'path' ? path : undefined,
        colorScheme,
        highlightedSpanRefs,
        applyHighlightFade
      ),
      spanTextColor: resolveSpanTextColor(
        span,
        settings,
        path,
        colorScheme,
        highlightedSpanRefs,
        labelPlacement
      )
    }),
    getSpanFillColor: (span, path) =>
      resolveSpanFillColor(
        span,
        settings,
        path,
        colorScheme,
        highlightedSpanRefs,
        applyHighlightFade
      ),
    getSpanBorderColor: (span, path) =>
      resolveSpanBorderColor(
        span,
        settings,
        path,
        colorScheme,
        highlightedSpanRefs,
        applyHighlightFade
      ),
    getSpanTextColor: (span, path, labelPlacement = 'inside') =>
      resolveSpanTextColor(span, settings, path, colorScheme, highlightedSpanRefs, labelPlacement),
    getThreadColor: thread => resolveThreadColor(thread, colorScheme),
    getProcessBackgroundColor: params => resolveProcessBackgroundColor(params, colorScheme)
  };
}

/** Create a color resolver that reads span fields through TraceGraph accessors. */
export function createTraceGraphColorResolver({
  traceGraph,
  colorScheme,
  settings,
  highlightedSpanRefs
}: TraceGraphColorResolverParams): TraceGraphColorResolver {
  return {
    getSpanFillColor: (spanRef, path) =>
      resolveSpanFillColorForRef({
        traceGraph,
        spanRef,
        settings,
        path,
        colorScheme,
        highlightedSpanRefs
      }),
    getSpanBorderColor: (spanRef, path) =>
      resolveSpanBorderColorForRef({
        traceGraph,
        spanRef,
        settings,
        path,
        colorScheme,
        highlightedSpanRefs
      }),
    getSpanTextColor: (spanRef, path, labelPlacement = 'inside') =>
      resolveSpanTextColorForRef({
        traceGraph,
        spanRef,
        settings,
        path,
        colorScheme,
        highlightedSpanRefs,
        labelPlacement
      })
  };
}

export const TRACE_COLOR = {
  THREAD_LINE: makeDeckColor('#cccccc66'),
  THREAD_TEXT: makeDeckColor('#333333ff'),
  SECOND_STEP_BACKGROUND: makeDeckColor('#e5e7ebff'),
  SPAN_FINISHED_LINE: makeDeckColor('#2f85a4ff'),
  SPAN_FINISHED_FILL: makeDeckColor('#2f85a4ff'),
  SPAN_NOT_FINISHED_LINE: makeDeckColor('#c14e0bff'),
  SPAN_NOT_FINISHED_FILL: makeDeckColor('#c14e0bff'),
  SPAN_CROSS_RANK: makeDeckColor('#ff00ff80'),
  SPAN_HIGHLIGHT: makeDeckColor('#ff000080'),
  DEPENDENCY_LINE: makeDeckColor('#eab308ff'),
  DEPENDENCY_HIGHLIGHT: makeDeckColor('#ff0000ff'),
  WARNING_DEPENDENCY_LINE: makeDeckColor('#ef4444ff'),
  SUBMIT_DEPENDENCY_LINE: makeDeckColor('#ec407a'),
  CROSS_DEPENDENCY_LINE: makeDeckColor('#0ea5e9ff'),
  CROSS_DEPENDENCY_HIDDEN_ENDPOINT_LINE: makeDeckColor('#64748bff'),

  SPAN_IN_CRITICAL_PATH_FILL: makeDeckColor('#ff4d4d80'),
  SPAN_IN_CRITICAL_PATH_LINE: makeDeckColor('#ff4d4d99'),
  SPAN_IN_CRITICAL_PATH_HIGHLIGHT_FILL: makeDeckColor('#ff1a1ad9'),
  SPAN_IN_CRITICAL_PATH_HIGHLIGHT_LINE: makeDeckColor('#ff1a1aff'),
  DEPENDENCY_IN_CRITICAL_PATH_LINE: makeDeckColor('#ff4d4dff'),
  CROSS_DEPENDENCY_IN_CRITICAL_PATH_LINE: makeDeckColor('#ff8033ff')
} as const;

export const NOT_IN_PATH_FADE_FACTOR = 0.2;
export const DEFAULT_PATH_HIGHLIGHT_TRAIL_LENGTH = 1;
export const MIN_PATH_HIGHLIGHT_TRAIL_LENGTH = 1;
export const MAX_PATH_HIGHLIGHT_TRAIL_LENGTH = 10;
export const PATH_HIGHLIGHT_TRAIL_LENGTH = DEFAULT_PATH_HIGHLIGHT_TRAIL_LENGTH;
const SELECTED_CROSS_DEPENDENCY_COLOR_START = makeDeckColor('#ff2a2aff');
const SELECTED_CROSS_DEPENDENCY_COLOR_END = makeDeckColor('#ff0000ff');
const SELECTED_LOCAL_DEPENDENCY_COLOR_START = SELECTED_CROSS_DEPENDENCY_COLOR_START;
const SELECTED_LOCAL_DEPENDENCY_COLOR_END = SELECTED_CROSS_DEPENDENCY_COLOR_END;
const SELECTED_OUTGOING_DEPENDENCY_COLOR_START = makeDeckColor('#e11d48ff');
const SELECTED_OUTGOING_DEPENDENCY_COLOR_END = makeDeckColor('#a21cafff');
const SPAN_TEXT_COLOR_BLACK: TraceColor = [0, 0, 0, 255];
const SPAN_TEXT_COLOR_WHITE: TraceColor = [255, 255, 255, 255];
const SPAN_TEXT_COLOR_MUTED_DARK: TraceColor = makeDeckColor('#5f6368ff');
const SPAN_TEXT_CONTRAST_ALPHA_MIN = 0.35;
const SPAN_TEXT_MUTED_FADE_THRESHOLD = 0.75;
const SPAN_TEXT_LIGHT_LUMINANCE_THRESHOLD = 0.7;
const SPAN_TEXT_BACKGROUND_COLOR: TraceColor = [255, 255, 255, 255];

export function getHighlightFadeMultiplier(settings: TraceVisSettings): number {
  const fade = settings.useExtendedSelectionFadeOpacity
    ? (settings.extendedSelectionFadeOpacity ?? settings.highlightFadeFactor ?? 0.5)
    : (settings.highlightFadeFactor ?? 0.5);
  if (!Number.isFinite(fade)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, fade));
}

function getTextHighlightFadeMultiplier(settings: TraceVisSettings): number {
  const fillFade = getHighlightFadeMultiplier(settings);
  return 0.55 + 0.45 * fillFade;
}

function resolveSpanFillColor(
  span: TraceSpanColorSource,
  settings: TraceVisSettings,
  path?: 'path' | 'any',
  colorScheme?: TraceColorScheme,
  highlightedSpanRefs?: ReadonlySet<SpanRef>,
  applyHighlightFade = true
): TraceDeckColor {
  const inPath = path === 'path';
  if (inPath) {
    return TRACE_COLOR.SPAN_IN_CRITICAL_PATH_FILL;
  }

  const colorStyle = colorScheme?.getSpanStyle?.({
    span,
    settings,
    path,
    highlightedSpanRefs
  });
  const baseColor: TraceDeckColor =
    colorStyle?.spanFillColor ??
    colorScheme?.getSpanFillColor?.({
      span,
      settings,
      path,
      highlightedSpanRefs
    }) ??
    getDefaultSpanFillColor(span, colorScheme);

  return applySpanVisibilityAdjustments(
    baseColor,
    span,
    settings,
    highlightedSpanRefs,
    applyHighlightFade
  );
}

function resolveSpanBorderColor(
  span: TraceSpanColorSource,
  settings: TraceVisSettings,
  path?: 'path',
  colorScheme?: TraceColorScheme,
  highlightedSpanRefs?: ReadonlySet<SpanRef>,
  applyHighlightFade = true
): TraceDeckColor {
  const inPath = path === 'path';
  if (inPath) {
    return TRACE_COLOR.SPAN_IN_CRITICAL_PATH_LINE;
  }

  const colorStyle = colorScheme?.getSpanStyle?.({
    span,
    settings,
    path,
    highlightedSpanRefs
  });
  const baseFillColor: TraceDeckColor =
    colorStyle?.spanFillColor ??
    colorScheme?.getSpanFillColor?.({
      span,
      settings,
      path,
      highlightedSpanRefs
    }) ??
    getDefaultSpanFillColor(span, colorScheme);
  const baseColor: TraceDeckColor =
    colorStyle?.spanBorderColor ??
    colorScheme?.getSpanBorderColor?.({
      span,
      settings,
      path,
      highlightedSpanRefs
    }) ??
    getReadableSpanBorderColor(baseFillColor);

  return applySpanVisibilityAdjustments(
    baseColor,
    span,
    settings,
    highlightedSpanRefs,
    applyHighlightFade
  );
}

function resolveSpanTextColor(
  span: TraceSpanColorSource,
  settings: TraceVisSettings,
  path?: 'path' | 'any',
  colorScheme?: TraceColorScheme,
  highlightedSpanRefs?: ReadonlySet<SpanRef>,
  labelPlacement: 'inside' | 'outside' = 'inside'
): TraceDeckColor {
  if (labelPlacement === 'outside') {
    return applySpanTextVisibilityAdjustments(
      SPAN_TEXT_COLOR_BLACK,
      span,
      settings,
      highlightedSpanRefs
    );
  }

  const colorStyle = colorScheme?.getSpanStyle?.({
    span,
    settings,
    path,
    highlightedSpanRefs,
    labelPlacement
  });
  if (colorStyle?.spanTextColor) {
    return applySpanTextVisibilityAdjustments(
      getFadeAwareSpanTextColor(colorStyle.spanTextColor, span, settings, highlightedSpanRefs),
      span,
      settings,
      highlightedSpanRefs
    );
  }

  const baseColor = colorScheme?.getSpanTextColor?.({
    span,
    settings,
    path,
    highlightedSpanRefs,
    labelPlacement
  });
  if (baseColor) {
    return applySpanTextVisibilityAdjustments(
      getFadeAwareSpanTextColor(baseColor, span, settings, highlightedSpanRefs),
      span,
      settings,
      highlightedSpanRefs
    );
  }

  const fillColor = resolveSpanFillColor(span, settings, path, colorScheme, highlightedSpanRefs);
  const contrastColor = getFadeAwareSpanTextColor(
    getSpanTextColorFromFill(fillColor),
    span,
    settings,
    highlightedSpanRefs
  );
  return applySpanTextVisibilityAdjustments(contrastColor, span, settings, highlightedSpanRefs);
}

function getSpanTextColorFromFill(
  fillColor: TraceDeckColor,
  backgroundColor: TraceDeckColor = SPAN_TEXT_BACKGROUND_COLOR
): TraceDeckColor {
  return getContrastTextColor(fillColor, backgroundColor);
}

export function getDependencyLineColor(
  dependency: LocalDependencyColorSource,
  _settings: TraceVisSettings,
  type?: 'path' | 'selected'
): TraceDeckColor {
  switch (type) {
    case 'path':
      return TRACE_COLOR.DEPENDENCY_IN_CRITICAL_PATH_LINE;

    case 'selected':
      return getSelectedDependencyColor(
        Math.abs(dependency.waitTimeMs),
        SELECTED_LOCAL_DEPENDENCY_COLOR_START,
        SELECTED_LOCAL_DEPENDENCY_COLOR_END
      );

    default:
    // fall through
  }

  if (isSubmitWarningDependency(dependency)) {
    return TRACE_COLOR.WARNING_DEPENDENCY_LINE;
  }

  if (dependency.keywords.has('SUBMIT')) {
    return TRACE_COLOR.SUBMIT_DEPENDENCY_LINE;
  }

  return TRACE_COLOR.DEPENDENCY_LINE;
}

/**
 * Returns whether a local dependency should use the submit-warning dependency color.
 */
export function isSubmitWarningDependency(dependency: LocalDependencyColorSource): boolean {
  return (
    dependency.keywords.has('SUBMIT') && dependency.waitTimeMs < DEFAULT_SUBMIT_MIN_WAIT_TIME_MS
  );
}

export function getCrossRankDependencyLineColor(
  dependency: CrossDependencyColorSource,
  _settings: TraceVisSettings,
  type?: 'path' | 'selected'
): TraceDeckColor {
  switch (type) {
    case 'path':
      log.log(
        'CRITICAL CROSS_DEP:',
        dependency,
        TRACE_COLOR.CROSS_DEPENDENCY_IN_CRITICAL_PATH_LINE
      )();

      return TRACE_COLOR.CROSS_DEPENDENCY_IN_CRITICAL_PATH_LINE;

    case 'selected':
      return getSelectedDependencyColor(
        Math.abs(dependency.waitTimeMs),
        SELECTED_CROSS_DEPENDENCY_COLOR_START,
        SELECTED_CROSS_DEPENDENCY_COLOR_END
      );

    default:
    // fall through
  }

  return TRACE_COLOR.CROSS_DEPENDENCY_LINE;
}

/** Returns the selected local-dependency overlay color for one wait duration. */
export function getSelectedLocalDependencyLineColor(
  waitTimeMs: number,
  selectedDirection: TraceSelectedDependencyDirection = 'incoming'
): TraceDeckColor {
  if (selectedDirection === 'outgoing') {
    return getSelectedDependencyColor(
      Math.abs(waitTimeMs),
      SELECTED_OUTGOING_DEPENDENCY_COLOR_START,
      SELECTED_OUTGOING_DEPENDENCY_COLOR_END
    );
  }
  return getSelectedDependencyColor(
    Math.abs(waitTimeMs),
    SELECTED_LOCAL_DEPENDENCY_COLOR_START,
    SELECTED_LOCAL_DEPENDENCY_COLOR_END
  );
}

/** Returns the selected cross-dependency overlay color for one wait duration. */
export function getSelectedCrossRankDependencyLineColor(
  waitTimeMs: number,
  selectedDirection: TraceSelectedDependencyDirection = 'incoming'
): TraceDeckColor {
  if (selectedDirection === 'outgoing') {
    return getSelectedDependencyColor(
      Math.abs(waitTimeMs),
      SELECTED_OUTGOING_DEPENDENCY_COLOR_START,
      SELECTED_OUTGOING_DEPENDENCY_COLOR_END
    );
  }
  return getSelectedDependencyColor(
    Math.abs(waitTimeMs),
    SELECTED_CROSS_DEPENDENCY_COLOR_START,
    SELECTED_CROSS_DEPENDENCY_COLOR_END
  );
}

function getSelectedDependencyColor(
  waitTimeMs: number,
  startColor: TraceDeckColor,
  endColor: TraceDeckColor
): TraceDeckColor {
  const normalizedDelay = mapValueToUnitRange(waitTimeMs, [0, 20, 50, 100, 200, 500, 1000, 2000]);
  return interpolateColor(startColor, endColor, normalizedDelay);
}

/**
 * maps a numeric input value to a normalized range [0, 1] using an array of sorted stepValues.
 * @param value
 * @param stepValues
 * @returns value in the normalized range [0, 1]
 * For a given value, it finds the highest index i such that value >= stepValues[i].
 * It returns i / stepValues.length.
 * If the value is less than all step values, it returns 0.
 */
function mapValueToUnitRange(value: number, stepValues: number[]): number {
  // Ensure steps are sorted ascending
  const steps = [...stepValues].sort((a, b) => a - b);

  let index = 0;
  for (let i = 0; i < steps.length; i++) {
    if (value >= steps[i]) {
      index = i + 1; // +1 because we divide by steps.length later
    } else {
      break;
    }
  }

  return index / steps.length;
}

export const SELECTED_SPAN_HIGHLIGHT_STYLES = [
  {
    lineColor: makeDeckColor('#ffffffff'),
    lineWidth: 4
  },
  {
    lineColor: makeDeckColor('#385cff'),
    lineWidth: 4
  },
  {
    lineColor: makeDeckColor('#33ffff'),
    lineWidth: 4
  },
  {
    lineColor: makeDeckColor('#ffd800'),
    lineWidth: 4
  }
] as const;

function resolveThreadColor(
  thread: TraceThread | undefined,
  colorScheme?: TraceColorScheme
): TraceDeckColor | undefined {
  return colorScheme?.getThreadColor?.({
    thread,
    threadId: thread?.threadId ?? ''
  });
}

function resolveProcessBackgroundColor(
  params: {processIndex: number; process: TraceProcess},
  colorScheme?: TraceColorScheme
): TraceDeckColor | undefined {
  return colorScheme?.getProcessBackgroundColor?.({
    processIndex: params.processIndex,
    processId: params.process.processId,
    process: params.process
  });
}

function resolveSpanFillColorForRef(params: TraceSpanColorResolverRefParams): TraceDeckColor {
  const {traceGraph, spanRef, settings, path, colorScheme, highlightedSpanRefs} = params;
  if (path === 'path') {
    return TRACE_COLOR.SPAN_IN_CRITICAL_PATH_FILL;
  }

  const colorStyle = colorScheme?.getSpanStyleForRef?.(params);
  const refColor =
    colorStyle?.spanFillColor ?? colorScheme?.getSpanFillColorForRef?.(params) ?? null;
  if (refColor) {
    return applySpanVisibilityAdjustmentsForRef(
      refColor,
      spanRef,
      traceGraph,
      settings,
      highlightedSpanRefs
    );
  }

  const compatibilitySource = getCompatibilitySpanColorSource(params);
  if (compatibilitySource) {
    return resolveSpanFillColor(
      compatibilitySource,
      settings,
      path,
      colorScheme,
      highlightedSpanRefs
    );
  }

  return applySpanVisibilityAdjustmentsForRef(
    getDefaultSpanFillColorForRef(params),
    spanRef,
    traceGraph,
    settings,
    highlightedSpanRefs
  );
}

function resolveSpanBorderColorForRef(params: TraceSpanColorResolverRefParams): TraceDeckColor {
  const {traceGraph, spanRef, settings, path, colorScheme, highlightedSpanRefs} = params;
  if (path === 'path') {
    return TRACE_COLOR.SPAN_IN_CRITICAL_PATH_LINE;
  }

  const colorStyle = colorScheme?.getSpanStyleForRef?.(params);
  const baseFillColor =
    colorStyle?.spanFillColor ??
    colorScheme?.getSpanFillColorForRef?.(params) ??
    getDefaultSpanFillColorForRef(params);
  const refColor =
    colorStyle?.spanBorderColor ??
    colorScheme?.getSpanBorderColorForRef?.(params) ??
    getReadableSpanBorderColor(baseFillColor);
  if (colorStyle?.spanBorderColor || colorScheme?.getSpanBorderColorForRef) {
    return applySpanVisibilityAdjustmentsForRef(
      refColor,
      spanRef,
      traceGraph,
      settings,
      highlightedSpanRefs
    );
  }

  const compatibilitySource = getCompatibilitySpanColorSource(params);
  if (compatibilitySource) {
    return resolveSpanBorderColor(
      compatibilitySource,
      settings,
      undefined,
      colorScheme,
      highlightedSpanRefs
    );
  }

  return applySpanVisibilityAdjustmentsForRef(
    refColor,
    spanRef,
    traceGraph,
    settings,
    highlightedSpanRefs
  );
}

function resolveSpanTextColorForRef(params: TraceSpanColorResolverRefParams): TraceDeckColor {
  const {
    spanRef,
    settings,
    path,
    colorScheme,
    highlightedSpanRefs,
    labelPlacement = 'inside'
  } = params;
  if (labelPlacement === 'outside') {
    return applySpanTextVisibilityAdjustmentsForRef(
      SPAN_TEXT_COLOR_BLACK,
      spanRef,
      settings,
      highlightedSpanRefs
    );
  }

  const colorStyle = colorScheme?.getSpanStyleForRef?.(params);
  if (colorStyle?.spanTextColor) {
    return applySpanTextVisibilityAdjustmentsForRef(
      getFadeAwareSpanTextColorForRef(
        colorStyle.spanTextColor,
        spanRef,
        settings,
        highlightedSpanRefs
      ),
      spanRef,
      settings,
      highlightedSpanRefs
    );
  }

  const baseColor = colorScheme?.getSpanTextColorForRef?.(params);
  if (baseColor) {
    return applySpanTextVisibilityAdjustmentsForRef(
      getFadeAwareSpanTextColorForRef(baseColor, spanRef, settings, highlightedSpanRefs),
      spanRef,
      settings,
      highlightedSpanRefs
    );
  }

  const compatibilitySource = getCompatibilitySpanColorSource(params);
  if (compatibilitySource) {
    return resolveSpanTextColor(
      compatibilitySource,
      settings,
      path,
      colorScheme,
      highlightedSpanRefs,
      labelPlacement
    );
  }

  const fillColor = resolveSpanFillColorForRef(params);
  const contrastColor = getFadeAwareSpanTextColorForRef(
    getSpanTextColorFromFill(fillColor),
    spanRef,
    settings,
    highlightedSpanRefs
  );
  return applySpanTextVisibilityAdjustmentsForRef(
    contrastColor,
    spanRef,
    settings,
    highlightedSpanRefs
  );
}

function getCompatibilitySpanColorSource(
  params: TraceSpanColorResolverRefParams
): TraceSpanColorSource | null {
  if (
    params.colorScheme?.getSpanStyle ||
    params.colorScheme?.getSpanFillColor ||
    params.colorScheme?.getSpanBorderColor ||
    params.colorScheme?.getSpanTextColor
  ) {
    return (
      (
        params.traceGraph as TraceSpanColorAccessorSource & {
          getSpanDisplaySource?: (spanRef: SpanRef) => TraceSpanColorSource | null;
        }
      ).getSpanDisplaySource?.(params.spanRef) ?? null
    );
  }
  return null;
}

function getDefaultSpanFillColor(
  span: TraceSpanColorSource,
  colorScheme?: TraceColorScheme
): TraceDeckColor {
  const status = getPrimaryTiming(span).status;
  let color: TraceDeckColor;
  switch (status) {
    case 'finished':
    default:
      color = TRACE_COLOR.SPAN_FINISHED_FILL;
  }

  if (
    span.crossProcessDependencyEndpoints?.length &&
    status !== 'not-finished' &&
    status !== 'not-started'
  ) {
    // If this span has cross-rank dependencies, use a different color.
    color = TRACE_COLOR.SPAN_CROSS_RANK;
  }

  const keywordPresentation = colorScheme?.getKeywordPresentation?.({
    keywords: span.keywords ?? []
  });
  if (keywordPresentation?.color) {
    color = [...keywordPresentation.color];
  }

  return color;
}

function getDefaultSpanFillColorForRef(params: TraceSpanColorResolverRefParams): TraceDeckColor {
  let color: TraceDeckColor = TRACE_COLOR.SPAN_FINISHED_FILL;

  const keywordPresentation = params.colorScheme?.getKeywordPresentation?.({
    keywords: params.traceGraph.getSpanKeywords(params.spanRef)
  });
  if (keywordPresentation?.color) {
    color = [...keywordPresentation.color];
  }

  return color;
}

function applySpanVisibilityAdjustments(
  baseColor: TraceDeckColor,
  span: TraceSpanColorSource,
  settings: TraceVisSettings,
  highlightedSpanRefs?: ReadonlySet<SpanRef>,
  applyHighlightFade = true
): TraceDeckColor {
  const color: [number, number, number, number] = [...baseColor];
  if (settings.showPathsOnly) {
    color[3] *= NOT_IN_PATH_FADE_FACTOR;
  }
  const timing = getPrimaryTiming(span);
  if (timing.endTimeMs - timing.startTimeMs < settings.minSpanTimeMs) {
    color[3] *= 0.2;
  }
  if (
    applyHighlightFade &&
    highlightedSpanRefs &&
    span.spanRef != null &&
    !highlightedSpanRefs.has(span.spanRef)
  ) {
    color[3] *= getHighlightFadeMultiplier(settings);
  }
  return color;
}

function applySpanTextVisibilityAdjustments(
  baseColor: TraceDeckColor,
  span: TraceSpanColorSource,
  settings: TraceVisSettings,
  highlightedSpanRefs?: ReadonlySet<SpanRef>
): TraceDeckColor {
  const color: [number, number, number, number] = [...baseColor];
  if (highlightedSpanRefs && span.spanRef != null && !highlightedSpanRefs.has(span.spanRef)) {
    color[3] = Math.max(0, color[3] * getTextHighlightFadeMultiplier(settings));
  }
  if (color[3] < SPAN_TEXT_CONTRAST_ALPHA_MIN * 255) {
    color[3] = Math.max(color[3], SPAN_TEXT_CONTRAST_ALPHA_MIN * 255);
  }
  return color;
}

function applySpanVisibilityAdjustmentsForRef(
  baseColor: TraceDeckColor,
  spanRef: SpanRef,
  traceGraph: TraceSpanColorAccessorSource,
  settings: TraceVisSettings,
  highlightedSpanRefs?: ReadonlySet<SpanRef>
): TraceDeckColor {
  const color: [number, number, number, number] = [...baseColor];
  if (settings.showPathsOnly) {
    color[3] *= NOT_IN_PATH_FADE_FACTOR;
  }
  const startTimeMs = traceGraph.getSpanStartTimeMs(spanRef);
  const endTimeMs = traceGraph.getSpanEndTimeMs(spanRef);
  if (
    startTimeMs != null &&
    endTimeMs != null &&
    endTimeMs - startTimeMs < settings.minSpanTimeMs
  ) {
    color[3] *= 0.2;
  }
  if (highlightedSpanRefs && !highlightedSpanRefs.has(spanRef)) {
    color[3] *= getHighlightFadeMultiplier(settings);
  }
  return color;
}

function applySpanTextVisibilityAdjustmentsForRef(
  baseColor: TraceDeckColor,
  spanRef: SpanRef,
  settings: TraceVisSettings,
  highlightedSpanRefs?: ReadonlySet<SpanRef>
): TraceDeckColor {
  const color: [number, number, number, number] = [...baseColor];
  if (highlightedSpanRefs && !highlightedSpanRefs.has(spanRef)) {
    color[3] = Math.max(0, color[3] * getTextHighlightFadeMultiplier(settings));
  }
  if (color[3] < SPAN_TEXT_CONTRAST_ALPHA_MIN * 255) {
    color[3] = Math.max(color[3], SPAN_TEXT_CONTRAST_ALPHA_MIN * 255);
  }
  return color;
}

/**
 * Switch faded light inside-label text to a muted dark color once highlight fading is strong.
 */
function getFadeAwareSpanTextColor(
  baseColor: TraceDeckColor,
  span: TraceSpanColorSource,
  settings: TraceVisSettings,
  highlightedSpanRefs: ReadonlySet<SpanRef> | undefined
): TraceDeckColor {
  if (!shouldUseMutedFadedSpanText(baseColor, span, settings, highlightedSpanRefs)) {
    return baseColor;
  }
  return SPAN_TEXT_COLOR_MUTED_DARK;
}

function getFadeAwareSpanTextColorForRef(
  baseColor: TraceDeckColor,
  spanRef: SpanRef,
  settings: TraceVisSettings,
  highlightedSpanRefs: ReadonlySet<SpanRef> | undefined
): TraceDeckColor {
  if (!shouldUseMutedFadedSpanTextForRef(baseColor, spanRef, settings, highlightedSpanRefs)) {
    return baseColor;
  }
  return SPAN_TEXT_COLOR_MUTED_DARK;
}

/**
 * Return true when one span label is subject to highlight fading.
 */
function isSpanSubjectToHighlightFade(
  span: TraceSpanColorSource,
  highlightedSpanRefs: ReadonlySet<SpanRef> | undefined
): boolean {
  return !!(highlightedSpanRefs && span.spanRef != null && !highlightedSpanRefs.has(span.spanRef));
}

/**
 * Return true when a text color is light enough that strong highlight fading should mute it.
 */
function shouldUseMutedFadedSpanText(
  baseColor: TraceDeckColor,
  span: TraceSpanColorSource,
  settings: TraceVisSettings,
  highlightedSpanRefs: ReadonlySet<SpanRef> | undefined
): boolean {
  return (
    isSpanSubjectToHighlightFade(span, highlightedSpanRefs) &&
    getHighlightFadeMultiplier(settings) <= SPAN_TEXT_MUTED_FADE_THRESHOLD &&
    computeRelativeLuminance(baseColor) >= SPAN_TEXT_LIGHT_LUMINANCE_THRESHOLD
  );
}

function shouldUseMutedFadedSpanTextForRef(
  baseColor: TraceDeckColor,
  spanRef: SpanRef,
  settings: TraceVisSettings,
  highlightedSpanRefs: ReadonlySet<SpanRef> | undefined
): boolean {
  return (
    !!(highlightedSpanRefs && !highlightedSpanRefs.has(spanRef)) &&
    getHighlightFadeMultiplier(settings) <= SPAN_TEXT_MUTED_FADE_THRESHOLD &&
    computeRelativeLuminance(baseColor) >= SPAN_TEXT_LIGHT_LUMINANCE_THRESHOLD
  );
}

function getContrastTextColor(
  fillColor: TraceDeckColor,
  backgroundColor: TraceDeckColor = SPAN_TEXT_BACKGROUND_COLOR
): TraceDeckColor {
  const compositedColor = getCompositedColor(fillColor, backgroundColor);
  // const blackContrast = getContrastRatio(compositedColor, SPAN_TEXT_COLOR_BLACK);
  const whiteContrast = getContrastRatio(compositedColor, SPAN_TEXT_COLOR_WHITE);
  return whiteContrast >= 2 ? SPAN_TEXT_COLOR_WHITE : SPAN_TEXT_COLOR_BLACK;
}

function getCompositedColor(
  foregroundColor: TraceDeckColor,
  backgroundColor: TraceDeckColor
): TraceDeckColor {
  const backgroundAlpha = Math.max(0, Math.min(1, backgroundColor[3] / 255));
  const foregroundAlpha = Math.max(0, Math.min(1, foregroundColor[3] / 255));

  const effectiveAlpha = foregroundAlpha + backgroundAlpha * (1 - foregroundAlpha);
  if (!Number.isFinite(effectiveAlpha) || effectiveAlpha <= 0) {
    return [0, 0, 0, 0];
  }

  const r =
    (foregroundColor[0] * foregroundAlpha +
      backgroundColor[0] * backgroundAlpha * (1 - foregroundAlpha)) /
    effectiveAlpha;
  const g =
    (foregroundColor[1] * foregroundAlpha +
      backgroundColor[1] * backgroundAlpha * (1 - foregroundAlpha)) /
    effectiveAlpha;
  const b =
    (foregroundColor[2] * foregroundAlpha +
      backgroundColor[2] * backgroundAlpha * (1 - foregroundAlpha)) /
    effectiveAlpha;

  return [Math.round(r), Math.round(g), Math.round(b), Math.round(effectiveAlpha * 255)];
}

function getContrastRatio(backgroundColor: TraceDeckColor, textColor: TraceDeckColor): number {
  const backgroundLuminance = computeRelativeLuminance(backgroundColor);
  const textLuminance = computeRelativeLuminance(textColor);
  const lighter = Math.max(backgroundLuminance, textLuminance);
  const darker = Math.min(backgroundLuminance, textLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function computeRelativeLuminance(color: TraceDeckColor): number {
  const normalized = color.slice(0, 3).map(component => component / 255);
  const linear = normalized.map(value =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
