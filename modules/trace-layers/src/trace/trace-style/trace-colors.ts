import {log} from '../log';
import {DEFAULT_SUBMIT_MIN_WAIT_TIME_MS} from '../trace-layout/same-process-dependency-filter';
import {interpolateColor, makeDeckColor} from './color-palette';
import {getReadableSpanBorderColor} from './trace-color-scheme';

import type {TraceSelectedDependencyDirection} from '../trace-graph/trace-graph-types';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {SpanRef, TraceThread} from '../trace-graph/trace-types';
import type {
  TraceColor,
  TraceColorScheme,
  TraceDeckColor,
  TraceSpanColorAccessorSource,
  TraceSpanColorRefParams,
  TraceSpanColorStyle
} from './trace-color-scheme';

/** Parameters used to create a ref-native trace color resolver for one render context. */
export type TraceGraphColorResolverParams = {
  /** TraceGraph accessor source used to read span fields without materializing span objects. */
  traceGraph: TraceSpanColorAccessorSource;
  /** Active color scheme used for application-specific color hooks. */
  colorScheme?: TraceColorScheme;
  /** Active visualization settings used for fallback and fade behavior. */
  settings: TraceVisSettings;
  /** Runtime span refs that should remain emphasized when highlight fading is active. */
  highlightedSpanRefs?: ReadonlySet<SpanRef>;
};

/** Resolver for span-ref keyed render colors after scheme hooks and fallbacks are applied. */
export type TraceGraphColorResolver = {
  /**
   * Writes final block fill and border channels directly into caller-owned byte buffers.
   *
   * This block-only path intentionally skips label text-color resolution and shares one
   * ref-style lookup plus one visibility/fade calculation across both output colors.
   *
   * @param primaryStartTimeMs Optional raw primary start time already bound by the caller. Pass
   *   both raw timing arguments, using null for a missing field, to avoid TraceGraph timing reads.
   * @param primaryEndTimeMs Optional raw primary end time already bound by the caller. Pass both
   *   raw timing arguments, using null for a missing field, to avoid TraceGraph timing reads.
   */
  writeSpanBlockColors: (
    spanRef: SpanRef,
    fillColors: Uint8Array,
    fillColorOffset: number,
    lineColors: Uint8Array,
    lineColorOffset: number,
    path?: 'path' | 'any',
    primaryStartTimeMs?: number | null,
    primaryEndTimeMs?: number | null
  ) => void;
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

type SameProcessDependencyColorSource = {
  /** Dependency keywords used to detect submit edges. */
  keywords: ReadonlySet<string>;
  /** Wait duration used to color warning states. */
  waitTimeMs: number;
};
type CrossProcessDependencyColorSource = {
  /** Wait duration used to color warning states. */
  waitTimeMs: number;
};
type TraceSpanColorResolverRefParams = TraceSpanColorRefParams & {
  /** Active color scheme used for application-specific color hooks. */
  colorScheme?: TraceColorScheme;
  /** Combined ref-native color override already resolved for this span. */
  refColorStyle?: TraceSpanColorStyle;
  /** Whether the combined ref-native color override was already resolved. */
  hasRefColorStyle?: boolean;
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
  TraceSpanColorAccessorSource,
  TraceSpanColorRefParams,
  TraceSpanColorStyle,
  TraceColorScheme,
  TraceColor,
  TraceDeckColor
} from './trace-color-scheme';

/** Create a color resolver that reads span fields through TraceGraph accessors. */
export function createTraceGraphColorResolver({
  traceGraph,
  colorScheme,
  settings,
  highlightedSpanRefs
}: TraceGraphColorResolverParams): TraceGraphColorResolver {
  return {
    writeSpanBlockColors: (
      spanRef,
      fillColors,
      fillColorOffset,
      lineColors,
      lineColorOffset,
      path,
      primaryStartTimeMs,
      primaryEndTimeMs
    ) =>
      writeSpanBlockColorsForRef(
        traceGraph,
        colorScheme,
        settings,
        highlightedSpanRefs,
        spanRef,
        path,
        fillColors,
        fillColorOffset,
        lineColors,
        lineColorOffset,
        primaryStartTimeMs,
        primaryEndTimeMs
      ),
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

/**
 * Writes pre-resolved block fill and border colors while preserving per-span visibility alpha.
 *
 * Row-local render builders use this seam when a style is provably constant for the entire row,
 * so they can skip per-span color hooks without duplicating fade or minimum-duration semantics.
 */
export function writeFixedSpanBlockColorsForRef(
  traceGraph: TraceSpanColorAccessorSource,
  settings: TraceVisSettings,
  highlightedSpanRefs: ReadonlySet<SpanRef> | undefined,
  spanRef: SpanRef,
  fillColor: TraceDeckColor,
  borderColor: TraceDeckColor,
  fillColors: Uint8Array,
  fillColorOffset: number,
  lineColors: Uint8Array,
  lineColorOffset: number,
  primaryStartTimeMs?: number | null,
  primaryEndTimeMs?: number | null
): void {
  const alphaMultiplier = getSpanVisibilityAlphaMultiplierForRef(
    spanRef,
    traceGraph,
    settings,
    highlightedSpanRefs,
    primaryStartTimeMs,
    primaryEndTimeMs
  );

  writeTraceDeckColorBytes(fillColors, fillColorOffset, fillColor, alphaMultiplier);
  writeTraceDeckColorBytes(lineColors, lineColorOffset, borderColor, alphaMultiplier);
}

/**
 * Writes pre-resolved block colors from already-borrowed primary timing fields.
 *
 * Dense Arrow row writers use this when no highlighted-ref membership is active. It preserves the
 * path/min-duration alpha rules without synthesizing a packed span ref solely for color output.
 */
export function writeFixedSpanBlockColorsForTiming(
  settings: TraceVisSettings,
  fillColor: TraceDeckColor,
  borderColor: TraceDeckColor,
  fillColors: Uint8Array,
  fillColorOffset: number,
  lineColors: Uint8Array,
  lineColorOffset: number,
  primaryStartTimeMs?: number | null,
  primaryEndTimeMs?: number | null
): void {
  const alphaMultiplier = getSpanVisibilityAlphaMultiplierForTiming(
    settings,
    primaryStartTimeMs,
    primaryEndTimeMs
  );

  writeTraceDeckColorBytes(fillColors, fillColorOffset, fillColor, alphaMultiplier);
  writeTraceDeckColorBytes(lineColors, lineColorOffset, borderColor, alphaMultiplier);
}

export const TRACE_COLOR = {
  THREAD_LINE: makeDeckColor('#cccccc66'),
  THREAD_TEXT: makeDeckColor('#333333ff'),
  SECOND_STEP_BACKGROUND: makeDeckColor('#e5e7ebff'),
  SPAN_FINISHED_LINE: makeDeckColor('#2f85a4ff'),
  SPAN_FINISHED_FILL: makeDeckColor('#2f85a4ff'),
  SPAN_NOT_FINISHED_LINE: makeDeckColor('#c14e0bff'),
  SPAN_NOT_FINISHED_FILL: makeDeckColor('#c14e0bff'),
  SPAN_HIGHLIGHT: makeDeckColor('#ff000080'),
  DEPENDENCY_LINE: makeDeckColor('#eab308ff'),
  DEPENDENCY_HIGHLIGHT: makeDeckColor('#ff0000ff'),
  WARNING_DEPENDENCY_LINE: makeDeckColor('#ef4444ff'),
  SUBMIT_DEPENDENCY_LINE: makeDeckColor('#ec407a'),
  CROSS_PROCESS_DEPENDENCY_LINE: makeDeckColor('#0ea5e9ff'),
  CROSS_PROCESS_DEPENDENCY_HIDDEN_ENDPOINT_LINE: makeDeckColor('#64748bff'),

  SPAN_IN_CRITICAL_PATH_FILL: makeDeckColor('#ff4d4d80'),
  SPAN_IN_CRITICAL_PATH_LINE: makeDeckColor('#ff4d4d99'),
  SPAN_IN_CRITICAL_PATH_HIGHLIGHT_FILL: makeDeckColor('#ff1a1ad9'),
  SPAN_IN_CRITICAL_PATH_HIGHLIGHT_LINE: makeDeckColor('#ff1a1aff'),
  DEPENDENCY_IN_CRITICAL_PATH_LINE: makeDeckColor('#ff4d4dff'),
  CROSS_PROCESS_DEPENDENCY_IN_CRITICAL_PATH_LINE: makeDeckColor('#ff8033ff')
} as const;

export const NOT_IN_PATH_FADE_FACTOR = 0.2;
export const DEFAULT_PATH_HIGHLIGHT_TRAIL_LENGTH = 1;
export const MIN_PATH_HIGHLIGHT_TRAIL_LENGTH = 1;
export const MAX_PATH_HIGHLIGHT_TRAIL_LENGTH = 10;
export const PATH_HIGHLIGHT_TRAIL_LENGTH = DEFAULT_PATH_HIGHLIGHT_TRAIL_LENGTH;
const SELECTED_CROSS_PROCESS_DEPENDENCY_COLOR_START = makeDeckColor('#ff2a2aff');
const SELECTED_CROSS_PROCESS_DEPENDENCY_COLOR_END = makeDeckColor('#ff0000ff');
const SELECTED_SAME_PROCESS_DEPENDENCY_COLOR_START = SELECTED_CROSS_PROCESS_DEPENDENCY_COLOR_START;
const SELECTED_SAME_PROCESS_DEPENDENCY_COLOR_END = SELECTED_CROSS_PROCESS_DEPENDENCY_COLOR_END;
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

function getSpanTextColorFromFill(
  fillColor: TraceDeckColor,
  backgroundColor: TraceDeckColor = SPAN_TEXT_BACKGROUND_COLOR
): TraceDeckColor {
  return getContrastTextColor(fillColor, backgroundColor);
}

export function getDependencyLineColor(
  dependency: SameProcessDependencyColorSource,
  _settings: TraceVisSettings,
  type?: 'path' | 'selected'
): TraceDeckColor {
  switch (type) {
    case 'path':
      return TRACE_COLOR.DEPENDENCY_IN_CRITICAL_PATH_LINE;

    case 'selected':
      return getSelectedDependencyColor(
        Math.abs(dependency.waitTimeMs),
        SELECTED_SAME_PROCESS_DEPENDENCY_COLOR_START,
        SELECTED_SAME_PROCESS_DEPENDENCY_COLOR_END
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
 * Returns whether a same-process dependency should use the submit-warning dependency color.
 */
export function isSubmitWarningDependency(dependency: SameProcessDependencyColorSource): boolean {
  return (
    dependency.keywords.has('SUBMIT') && dependency.waitTimeMs < DEFAULT_SUBMIT_MIN_WAIT_TIME_MS
  );
}

export function getCrossRankDependencyLineColor(
  dependency: CrossProcessDependencyColorSource,
  _settings: TraceVisSettings,
  type?: 'path' | 'selected'
): TraceDeckColor {
  switch (type) {
    case 'path':
      log.log(
        'CRITICAL CROSS_DEP:',
        dependency,
        TRACE_COLOR.CROSS_PROCESS_DEPENDENCY_IN_CRITICAL_PATH_LINE
      )();

      return TRACE_COLOR.CROSS_PROCESS_DEPENDENCY_IN_CRITICAL_PATH_LINE;

    case 'selected':
      return getSelectedDependencyColor(
        Math.abs(dependency.waitTimeMs),
        SELECTED_CROSS_PROCESS_DEPENDENCY_COLOR_START,
        SELECTED_CROSS_PROCESS_DEPENDENCY_COLOR_END
      );

    default:
    // fall through
  }

  return TRACE_COLOR.CROSS_PROCESS_DEPENDENCY_LINE;
}

/** Returns the selected same-process-dependency overlay color for one wait duration. */
export function getSelectedSameProcessDependencyLineColor(
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
    SELECTED_SAME_PROCESS_DEPENDENCY_COLOR_START,
    SELECTED_SAME_PROCESS_DEPENDENCY_COLOR_END
  );
}

/** Returns the selected cross-process-dependency overlay color for one wait duration. */
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
    SELECTED_CROSS_PROCESS_DEPENDENCY_COLOR_START,
    SELECTED_CROSS_PROCESS_DEPENDENCY_COLOR_END
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

/** Resolve the final thread/lane color for one thread. */
export function getTraceThreadColor(
  thread: TraceThread | undefined,
  colorScheme?: TraceColorScheme
): TraceDeckColor | undefined {
  return colorScheme?.getThreadColor?.({
    thread,
    threadId: thread?.threadId ?? ''
  });
}

function resolveSpanFillColorForRef(params: TraceSpanColorResolverRefParams): TraceDeckColor {
  const {traceGraph, spanRef, settings, path, colorScheme, highlightedSpanRefs} = params;
  if (path === 'path') {
    return TRACE_COLOR.SPAN_IN_CRITICAL_PATH_FILL;
  }

  const colorStyle = getSpanRefColorStyle(params);
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

  const colorStyle = getSpanRefColorStyle(params);
  const baseFillColor =
    colorStyle?.spanFillColor ??
    colorScheme?.getSpanFillColorForRef?.(params) ??
    getDefaultSpanFillColorForRef(params);
  const refColor =
    colorStyle?.spanBorderColor ??
    colorScheme?.getSpanBorderColorForRef?.(params) ??
    getReadableSpanBorderColor(baseFillColor);
  return applySpanVisibilityAdjustmentsForRef(
    refColor,
    spanRef,
    traceGraph,
    settings,
    highlightedSpanRefs
  );
}

function resolveSpanTextColorForRef(params: TraceSpanColorResolverRefParams): TraceDeckColor {
  const {spanRef, settings, colorScheme, highlightedSpanRefs, labelPlacement = 'inside'} = params;
  if (labelPlacement === 'outside') {
    return applySpanTextVisibilityAdjustmentsForRef(
      SPAN_TEXT_COLOR_BLACK,
      spanRef,
      settings,
      highlightedSpanRefs
    );
  }

  const colorStyle = getSpanRefColorStyle(params);
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

/**
 * Writes block-only fill and border colors without constructing a combined style or text color.
 *
 * The direct writer keeps the typed-array ownership with its caller and computes the shared
 * ref-style and fade multiplier only once for the pair of block colors.
 */
function writeSpanBlockColorsForRef(
  traceGraph: TraceSpanColorAccessorSource,
  colorScheme: TraceColorScheme | undefined,
  settings: TraceVisSettings,
  highlightedSpanRefs: ReadonlySet<SpanRef> | undefined,
  spanRef: SpanRef,
  path: 'path' | 'any' | undefined,
  fillColors: Uint8Array,
  fillColorOffset: number,
  lineColors: Uint8Array,
  lineColorOffset: number,
  primaryStartTimeMs?: number | null,
  primaryEndTimeMs?: number | null
): void {
  if (path === 'path') {
    writeTraceDeckColorBytes(fillColors, fillColorOffset, TRACE_COLOR.SPAN_IN_CRITICAL_PATH_FILL);
    writeTraceDeckColorBytes(lineColors, lineColorOffset, TRACE_COLOR.SPAN_IN_CRITICAL_PATH_LINE);
    return;
  }

  const params: TraceSpanColorResolverRefParams = {
    traceGraph,
    spanRef,
    settings,
    path,
    colorScheme,
    highlightedSpanRefs
  };
  const refColorStyle = colorScheme?.getSpanStyleForRef?.(params);

  const fillColor =
    refColorStyle?.spanFillColor ??
    colorScheme?.getSpanFillColorForRef?.(params) ??
    getDefaultSpanFillColorForRef(params);
  const borderColor =
    refColorStyle?.spanBorderColor ??
    colorScheme?.getSpanBorderColorForRef?.(params) ??
    getReadableSpanBorderColor(fillColor);
  writeFixedSpanBlockColorsForRef(
    traceGraph,
    settings,
    highlightedSpanRefs,
    spanRef,
    fillColor,
    borderColor,
    fillColors,
    fillColorOffset,
    lineColors,
    lineColorOffset,
    primaryStartTimeMs,
    primaryEndTimeMs
  );
}

/** Writes one RGBA tuple into caller-owned byte storage with an optional alpha multiplier. */
function writeTraceDeckColorBytes(
  target: Uint8Array,
  offset: number,
  color: TraceDeckColor,
  alphaMultiplier = 1
): void {
  target[offset] = color[0];
  target[offset + 1] = color[1];
  target[offset + 2] = color[2];
  target[offset + 3] = color[3] * alphaMultiplier;
}

function getSpanRefColorStyle(
  params: TraceSpanColorResolverRefParams
): TraceSpanColorStyle | undefined {
  return params.hasRefColorStyle
    ? params.refColorStyle
    : params.colorScheme?.getSpanStyleForRef?.(params);
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

function applySpanVisibilityAdjustmentsForRef(
  baseColor: TraceDeckColor,
  spanRef: SpanRef,
  traceGraph: TraceSpanColorAccessorSource,
  settings: TraceVisSettings,
  highlightedSpanRefs?: ReadonlySet<SpanRef>
): TraceDeckColor {
  const color: [number, number, number, number] = [...baseColor];
  color[3] *= getSpanVisibilityAlphaMultiplierForRef(
    spanRef,
    traceGraph,
    settings,
    highlightedSpanRefs
  );
  return color;
}

/** Returns the shared alpha multiplier used by block fill and border visibility adjustments. */
function getSpanVisibilityAlphaMultiplierForRef(
  spanRef: SpanRef,
  traceGraph: TraceSpanColorAccessorSource,
  settings: TraceVisSettings,
  highlightedSpanRefs?: ReadonlySet<SpanRef>,
  primaryStartTimeMs?: number | null,
  primaryEndTimeMs?: number | null
): number {
  const hasRawPrimaryTiming = primaryStartTimeMs !== undefined || primaryEndTimeMs !== undefined;
  const startTimeMs = hasRawPrimaryTiming
    ? (primaryStartTimeMs ?? null)
    : traceGraph.getSpanStartTimeMs(spanRef);
  const endTimeMs = hasRawPrimaryTiming
    ? (primaryEndTimeMs ?? null)
    : traceGraph.getSpanEndTimeMs(spanRef);
  let alphaMultiplier = getSpanVisibilityAlphaMultiplierForTiming(settings, startTimeMs, endTimeMs);
  if (highlightedSpanRefs && !highlightedSpanRefs.has(spanRef)) {
    alphaMultiplier *= getHighlightFadeMultiplier(settings);
  }
  return alphaMultiplier;
}

/** Returns ref-independent alpha adjustments from already-resolved primary timing fields. */
function getSpanVisibilityAlphaMultiplierForTiming(
  settings: TraceVisSettings,
  primaryStartTimeMs?: number | null,
  primaryEndTimeMs?: number | null
): number {
  let alphaMultiplier = settings.showPathsOnly ? NOT_IN_PATH_FADE_FACTOR : 1;
  if (
    primaryStartTimeMs != null &&
    primaryEndTimeMs != null &&
    primaryEndTimeMs - primaryStartTimeMs < settings.minSpanTimeMs
  ) {
    alphaMultiplier *= 0.2;
  }
  return alphaMultiplier;
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
  const backgroundLuminance = computeRelativeLuminance(compositedColor);
  // White has relative luminance 1, so this preserves the previous contrast-ratio result without
  // recomputing a fixed candidate color for every span label.
  const whiteContrast = 1.05 / (backgroundLuminance + 0.05);
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

function computeRelativeLuminance(color: TraceDeckColor): number {
  const red = color[0] / 255;
  const green = color[1] / 255;
  const blue = color[2] / 255;
  const linearRed = red <= 0.03928 ? red / 12.92 : ((red + 0.055) / 1.055) ** 2.4;
  const linearGreen = green <= 0.03928 ? green / 12.92 : ((green + 0.055) / 1.055) ** 2.4;
  const linearBlue = blue <= 0.03928 ? blue / 12.92 : ((blue + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linearRed + 0.7152 * linearGreen + 0.0722 * linearBlue;
}
