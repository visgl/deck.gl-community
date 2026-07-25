import {
  decodeTraceDependencyWaitModeCode,
  traceDependencyKeywordFlagsHasParent,
  traceDependencyKeywordFlagsHasSubmit
} from '../ingestion/trace-dependency-arrow-fields';
import {
  encodeLocalSpanRef,
  encodeProcessThreadRef,
  encodeSameProcessDependencyRef,
  encodeSpanRef,
  getProcessRefIndex,
  getSameProcessDependencyRefProcessIndex,
  getSameProcessDependencyRefRowIndex,
  getSpanRefChunkIndex,
  getSpanRefRowIndex,
  isCrossProcessDependencyRef,
  isSameProcessDependencyRef,
  MAX_PROCESS_LOCAL_THREAD_REF_INDEX
} from '../trace-graph/trace-id-encoder';
import {
  DEFAULT_SUBMIT_MIN_WAIT_TIME_MS,
  shouldShowSameProcessDependencyByModeFields
} from '../trace-layout/same-process-dependency-filter';
import {
  buildTraceLayoutGeometryDerivationContext,
  fillTraceLayoutCrossProcessDependencyGeometry,
  fillTraceLayoutSameProcessDependencyGeometry,
  fillTraceLayoutSpanGeometry,
  getTraceLayoutSpanVisibility
} from '../trace-layout/trace-derived-geometry';
import {
  fillGeneratedPrimarySpanBoundingBoxFromFields,
  getLaneYPosition
} from '../trace-layout/trace-geometry-layout-common';
import {
  DEFAULT_TRACE_COLOR_SCHEME,
  getProcessTraceColor,
  getReadableSpanBorderColor,
  PROCESS_TRACE_COLOR_SCHEME
} from '../trace-style/trace-color-scheme';
import {
  createTraceGraphColorResolver,
  NOT_IN_PATH_FADE_FACTOR,
  TRACE_COLOR,
  writeFixedSpanBlockColorsForRef,
  writeFixedSpanBlockColorsForTiming
} from '../trace-style/trace-colors';
import {getTraceViewChunkFilterMask} from '../trace-view-snapshot';
import {
  bindTraceArrowTrustedPrimaryEndpointCursorRow,
  buildTraceArrowPrimaryEndpointPages,
  createTraceArrowTrustedPrimaryEndpointCursor,
  fillTraceArrowPrimaryEndpointFields,
  fillTraceArrowPrimaryEndpointFieldsFromPageRow,
  resolveTraceArrowTrustedPrimaryEndpointEndTime
} from './trace-arrow-endpoint-pages';
import {
  buildTraceDenseDependencyFixedWidthBatchesForTable,
  buildTraceTrustedDenseDependencyFixedWidthBatches
} from './trace-dense-dependency-fixed-width';

import type {ArrowTraceSameProcessDependencyTable} from '../ingestion/arrow-trace';
import type {
  CrossProcessDependencyRef,
  ProcessRef,
  SameProcessDependencyRef
} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {SpanRef, TraceProcessId} from '../trace-graph/trace-types';
import type {TraceLayoutGeometryDerivationContext} from '../trace-layout/trace-derived-geometry';
import type {ProcessLayout, ThreadLayout, TraceLayout} from '../trace-layout/trace-layout';
import type {TraceRefSource} from '../trace-ref-source';
import type {TraceColorScheme, TraceDeckColor} from '../trace-style/trace-color-scheme';
import type {
  ResolvedTraceArrowPrimaryEndpointFields,
  TraceArrowPrimaryEndpointFields,
  TraceArrowPrimaryEndpointPage,
  TraceArrowPrimaryEndpointPages,
  TraceArrowTrustedPrimaryEndpointCursor
} from './trace-arrow-endpoint-pages';
import type {
  TraceDenseDependencyFixedWidthBatch,
  TraceTrustedDenseDependencyFixedWidthBatch
} from './trace-dense-dependency-fixed-width';
import type {
  TraceDenseSpanRefRange,
  TraceSameProcessDependencyRefSource,
  TraceSpanRefSource
} from './trace-ref-source';

/** Canonical parent bit carried by trusted dependency keywordFlags Uint8 rows. */
const TRACE_DECK_DEPENDENCY_KEYWORD_FLAG_PARENT = 1 << 0;
/** Canonical submit bit carried by trusted dependency keywordFlags Uint8 rows. */
const TRACE_DECK_DEPENDENCY_KEYWORD_FLAG_SUBMIT = 1 << 1;
/** Canonical end-to-start wait-mode code carried by trusted dependency Uint8 rows. */
const TRACE_DECK_DEPENDENCY_WAIT_MODE_END_TO_START = 0;
/** Canonical end-to-end wait-mode code carried by trusted dependency Uint8 rows. */
const TRACE_DECK_DEPENDENCY_WAIT_MODE_END_TO_END = 1;
/** Canonical start-to-start wait-mode code carried by trusted dependency Uint8 rows. */
const TRACE_DECK_DEPENDENCY_WAIT_MODE_START_TO_START = 2;
/** Existing minimum-duration fade multiplier copied into trusted block color palette bytes. */
const TRACE_DECK_BLOCK_MIN_DURATION_FADE_FACTOR = 0.2;

/** deck.gl binary attribute payload shared by row-local binary render data. */
export type TraceDeckBinaryAttributeData = {
  /** Number of logical rows represented by the binary attribute payload. */
  readonly length: number;
  /** deck.gl binary attributes keyed by accessor or shader attribute name. */
  readonly attributes: Readonly<
    Record<string, {readonly value: Float32Array | Uint8Array | Uint32Array; readonly size: number}>
  >;
};

/** deck.gl binary payload for span block rectangles. */
export type TraceDeckBinaryBlockData = {
  /** Binary attribute payload passed to the block rectangle layer. */
  readonly data: TraceDeckBinaryAttributeData;
  /** Span refs keyed by binary row index for picking and debug access. */
  readonly spans: TraceSpanRefSource;
};

/** deck.gl binary payload for straight same-process dependency line segments. */
export type TraceDeckBinaryDependencyLineData = {
  /** Binary attribute payload passed to the straight dependency line layer. */
  readonly data: TraceDeckBinaryAttributeData;
  /** Dependency refs keyed by binary row index for picking and non-binary routing fallback. */
  readonly dependencies: TraceSameProcessDependencyRefSource;
};

/** deck.gl binary payload for straight cross-process dependency line segments. */
export type TraceDeckBinaryCrossProcessDependencyLineData = {
  /** Binary attribute payload passed to the straight cross-process dependency line layer. */
  readonly data: TraceDeckBinaryAttributeData;
  /** Cross-process dependency refs keyed by compact binary row index for picking. */
  readonly dependencies: TraceRefSource<CrossProcessDependencyRef>;
  /**
   * Typed binary-row to canonical dependency-ref mapping when invalid rows were compacted.
   *
   * Undefined means every input ref produced one output row and `dependencies` preserves the
   * caller's source identity. The Float64 storage keeps tagged safe-integer refs exact without
   * retaining one JavaScript object or array cell per edge.
   */
  readonly compactedDependencyRefs?: Float64Array;
};

/** Builds row-local binary rectangle attributes for visible trace spans. */
export function buildTraceDeckBinaryBlockData(params: {
  /** Visible span-ref source to render as block rectangles. */
  readonly spans: TraceSpanRefSource;
  /** Canonical owning process name shared by every span in this process-local batch. */
  readonly processName: string;
  /** Layout containing current span timing, lane state, and TraceGraph accessors. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Optional batch-scoped direct geometry lookup state for repeated span resolution. */
  readonly geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Optional caller-owned batch-local endpoint pages shared with sibling row builders. */
  readonly endpointPages?: TraceArrowPrimaryEndpointPages | null;
  /** Active visualization settings used for span colors. */
  readonly settings: TraceVisSettings;
  /** Active trace color scheme used for span colors. */
  readonly colorScheme?: TraceColorScheme;
  /** Highlighted span refs used by fade-aware span color resolution. */
  readonly highlightedSpanRefs?: ReadonlySet<SpanRef>;
}): TraceDeckBinaryBlockData {
  const colorScheme = params.colorScheme ?? DEFAULT_TRACE_COLOR_SCHEME;
  const writeBlockColors = createTraceDeckBinaryBlockColorWriter(params, colorScheme);
  const positions = new Float32Array(params.spans.length * 3);
  const sizes = new Float32Array(params.spans.length * 2);
  const fillColors = new Uint8Array(params.spans.length * 4);
  const lineColors = new Uint8Array(params.spans.length * 4);
  fillTraceDeckBinaryBlockRows({
    ...params,
    positions,
    sizes,
    fillColors,
    lineColors,
    writeBlockColors
  });

  return {
    data: {
      length: params.spans.length,
      attributes: {
        getPosition: {value: positions, size: 3},
        getSize: {value: sizes, size: 2},
        getFillColor: {value: fillColors, size: 4},
        getLineColor: {value: lineColors, size: 4}
      }
    },
    spans: params.spans
  };
}

/**
 * Builds only the mutable position and size attributes for one span block batch.
 *
 * Geometry refreshes use this seam to reuse the same Arrow-bound scalar writer as cold scene
 * construction while preserving previously prepared color buffers.
 */
export function buildTraceDeckBinaryBlockGeometryData(params: {
  /** Visible span-ref source whose geometry should be rebuilt. */
  readonly spans: TraceSpanRefSource;
  /** Layout containing current span timing, lane state, and TraceGraph accessors. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Optional batch-scoped direct geometry lookup state for repeated span resolution. */
  readonly geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Optional caller-owned batch-local endpoint pages shared with sibling row builders. */
  readonly endpointPages?: TraceArrowPrimaryEndpointPages | null;
}): TraceDeckBinaryAttributeData {
  const positions = new Float32Array(params.spans.length * 3);
  const sizes = new Float32Array(params.spans.length * 2);
  fillTraceDeckBinaryBlockRows({
    ...params,
    positions,
    sizes
  });
  return {
    length: params.spans.length,
    attributes: {
      getPosition: {value: positions, size: 3},
      getSize: {value: sizes, size: 2}
    }
  };
}

/** Builds row-local binary straight-line attributes for same-process dependencies. */
export function buildTraceDeckBinaryDependencyLineData(params: {
  /** Same-process dependency-ref source to render as straight dependency lines. */
  readonly dependencyRefs: TraceSameProcessDependencyRefSource;
  /** Layout containing current span timing, lane state, and TraceGraph accessors. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Optional batch-scoped direct geometry lookup state for repeated dependency resolution. */
  readonly geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Optional caller-owned batch-local endpoint pages shared across sibling process rows. */
  readonly endpointPages?: TraceArrowPrimaryEndpointPages | null;
  /** Active visualization settings used for dependency opacity and warning colors. */
  readonly settings: TraceVisSettings;
}): TraceDeckBinaryDependencyLineData {
  const sourcePositions = new Float32Array(params.dependencyRefs.length * 3);
  const targetPositions = new Float32Array(params.dependencyRefs.length * 3);
  const colors = new Uint8Array(params.dependencyRefs.length * 4);
  const opacityMultiplier = getTraceDependencyOpacityMultiplier(params.settings) * 0.75;
  const colorPalette = buildTraceDeckBinaryDependencyColorPalette(opacityMultiplier);
  fillTraceDeckBinaryDependencyRows({
    ...params,
    sourcePositions,
    targetPositions,
    colors,
    opacityMultiplier,
    colorPalette
  });

  return {
    data: {
      length: params.dependencyRefs.length,
      attributes: {
        getSourcePosition: {value: sourcePositions, size: 3},
        getTargetPosition: {value: targetPositions, size: 3},
        getColor: {value: colors, size: 4}
      }
    },
    dependencies: params.dependencyRefs
  };
}

/**
 * Builds compact binary straight-line attributes for cross-process dependencies.
 *
 * The writer streams exact dependency refs through graph scalar accessors into fresh typed output
 * buffers. Missing, filtered, malformed, or layout-ineligible rows are omitted instead of leaving
 * zero-length origin lines in deck data; only the compact output-to-ref mapping is retained when
 * compaction actually occurred.
 */
export function buildTraceDeckBinaryCrossProcessDependencyLineData(params: {
  /** Cross-process dependency refs to stream in source order. */
  readonly dependencyRefs: TraceRefSource<CrossProcessDependencyRef>;
  /** Layout containing current span timing, lane state, and TraceGraph scalar accessors. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Optional batch-scoped direct geometry lookup state for repeated dependency resolution. */
  readonly geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Active visualization settings used for dependency opacity. */
  readonly settings: TraceVisSettings;
}): TraceDeckBinaryCrossProcessDependencyLineData {
  const sourcePositions = new Float32Array(params.dependencyRefs.length * 3);
  const targetPositions = new Float32Array(params.dependencyRefs.length * 3);
  const colors = new Uint8Array(params.dependencyRefs.length * 4);
  const dependencyRefsByOutputRow = new Float64Array(params.dependencyRefs.length);
  const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
  const geometryContext =
    params.geometryContext ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);
  const opacityMultiplier = getTraceDependencyOpacityMultiplier(params.settings) * 0.75;
  let outputRowIndex = 0;

  for (const dependencyRef of params.dependencyRefs) {
    if (
      dependencyRef == null ||
      !isCrossProcessDependencyRef(dependencyRef) ||
      !fillTraceLayoutCrossProcessDependencyGeometry({
        traceLayout: params.traceLayout,
        dependencyRef,
        target: geometry,
        context: geometryContext
      })
    ) {
      continue;
    }

    writeTraceDeckBinaryDependencyGeometry(
      {sourcePositions, targetPositions},
      geometry,
      outputRowIndex
    );
    writeTraceDependencyLineColor(
      colors,
      outputRowIndex * 4,
      getTraceDeckCrossProcessDependencyLineColor(
        params.traceLayout,
        dependencyRef,
        geometryContext
      ),
      opacityMultiplier,
      0
    );
    dependencyRefsByOutputRow[outputRowIndex] = dependencyRef;
    outputRowIndex += 1;
  }

  const compactedDependencyRefs =
    outputRowIndex === params.dependencyRefs.length
      ? undefined
      : dependencyRefsByOutputRow.subarray(0, outputRowIndex);
  const dependencies = compactedDependencyRefs
    ? buildTraceDeckCrossProcessDependencyRefSource(compactedDependencyRefs)
    : params.dependencyRefs;

  return {
    data: {
      length: outputRowIndex,
      attributes: {
        getSourcePosition: {value: sourcePositions.subarray(0, outputRowIndex * 3), size: 3},
        getTargetPosition: {value: targetPositions.subarray(0, outputRowIndex * 3), size: 3},
        getColor: {value: colors.subarray(0, outputRowIndex * 4), size: 4}
      }
    },
    dependencies,
    ...(compactedDependencyRefs ? {compactedDependencyRefs} : {})
  };
}

/**
 * Builds only mutable endpoint position attributes for one same-process dependency batch.
 *
 * Geometry refreshes use this seam to reuse the batch-local borrowed Arrow endpoint pages while
 * retaining previously prepared color buffers.
 */
export function buildTraceDeckBinaryDependencyGeometryData(params: {
  /** Same-process dependency-ref source whose endpoint geometry should be rebuilt. */
  readonly dependencyRefs: TraceSameProcessDependencyRefSource;
  /** Layout containing current span timing, lane state, and TraceGraph accessors. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Optional batch-scoped direct geometry lookup state for repeated dependency resolution. */
  readonly geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Optional caller-owned batch-local endpoint pages shared across sibling process rows. */
  readonly endpointPages?: TraceArrowPrimaryEndpointPages | null;
}): TraceDeckBinaryAttributeData {
  const sourcePositions = new Float32Array(params.dependencyRefs.length * 3);
  const targetPositions = new Float32Array(params.dependencyRefs.length * 3);
  fillTraceDeckBinaryDependencyRows({
    ...params,
    sourcePositions,
    targetPositions
  });
  return {
    length: params.dependencyRefs.length,
    attributes: {
      getSourcePosition: {value: sourcePositions, size: 3},
      getTargetPosition: {value: targetPositions, size: 3}
    }
  };
}

/** Caller-owned block buffers filled by one shared Arrow/generic row traversal. */
type TraceDeckBinaryBlockRowTargets = {
  /** Position attribute storage with three values per span. */
  readonly positions: Float32Array;
  /** Size attribute storage with two values per span. */
  readonly sizes: Float32Array;
  /** Optional fill-color storage with four values per span. */
  readonly fillColors?: Uint8Array;
  /** Optional outline-color storage with four values per span. */
  readonly lineColors?: Uint8Array;
  /** Optional row-local block-color writer paired with both color storages. */
  readonly writeBlockColors?: TraceDeckBinaryBlockColorWriter;
};

/**
 * Four fixed process-color tuples copied by trusted dense block rows.
 *
 * Slots are normal fill, normal line, short-duration fill, and short-duration line. The palette
 * is batch-local and never retained as graph or scene state.
 */
type TraceDeckTrustedDenseBlockColorPalette = {
  /** Packed RGBA bytes for the two timing visibility states. */
  readonly values: Uint8Array;
  /** Current minimum-duration threshold selecting the short-span slots. */
  readonly minSpanTimeMs: number;
};

/** Writes one block color pair into caller-owned byte buffers. */
type TraceDeckBinaryBlockColorWriter = {
  /**
   * Whether direct dense Arrow rows must synthesize a packed ref before writing this color.
   *
   * The canonical process scheme only needs a ref when highlighted membership is active. Custom
   * schemes remain ref-native because their hooks may inspect arbitrary span fields.
   */
  readonly needsSpanRefForDenseRow: boolean;
  /** Fixed process-color bytes available only to trusted no-highlight dense rows. */
  readonly trustedDensePalette?: TraceDeckTrustedDenseBlockColorPalette;
  /** Writes one optional-ref block color pair into caller-owned byte buffers. */
  readonly write: (
    spanRef: SpanRef | undefined,
    fillColors: Uint8Array,
    fillColorOffset: number,
    lineColors: Uint8Array,
    lineColorOffset: number,
    primaryStartTimeMs?: number | null,
    primaryEndTimeMs?: number | null
  ) => void;
};

/**
 * Creates the narrowest block-color writer for one process-local binary batch.
 *
 * Only the exact built-in process scheme can use one canonical row color. Custom schemes keep the
 * ref-native resolver because their hooks may vary for every span.
 */
function createTraceDeckBinaryBlockColorWriter(
  params: Pick<
    Parameters<typeof buildTraceDeckBinaryBlockData>[0],
    'spans' | 'processName' | 'traceLayout' | 'settings' | 'highlightedSpanRefs'
  >,
  colorScheme: TraceColorScheme
): TraceDeckBinaryBlockColorWriter | undefined {
  if (params.spans.length === 0) {
    return undefined;
  }

  if (colorScheme === PROCESS_TRACE_COLOR_SCHEME) {
    const fillColor = getProcessTraceColor(params.processName);
    const borderColor = getReadableSpanBorderColor(fillColor);
    return {
      needsSpanRefForDenseRow: params.highlightedSpanRefs != null,
      trustedDensePalette:
        params.highlightedSpanRefs == null
          ? buildTraceDeckTrustedDenseBlockColorPalette(params.settings, fillColor, borderColor)
          : undefined,
      write: (
        spanRef,
        fillColors,
        fillColorOffset,
        lineColors,
        lineColorOffset,
        primaryStartTimeMs,
        primaryEndTimeMs
      ) => {
        if (spanRef == null && params.highlightedSpanRefs == null) {
          writeFixedSpanBlockColorsForTiming(
            params.settings,
            fillColor,
            borderColor,
            fillColors,
            fillColorOffset,
            lineColors,
            lineColorOffset,
            primaryStartTimeMs,
            primaryEndTimeMs
          );
          return;
        }
        if (spanRef == null) {
          return;
        }
        writeFixedSpanBlockColorsForRef(
          params.traceLayout.traceGraph,
          params.settings,
          params.highlightedSpanRefs,
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
    };
  }

  const graphColorResolver = createTraceGraphColorResolver({
    traceGraph: params.traceLayout.traceGraph,
    colorScheme,
    settings: params.settings,
    highlightedSpanRefs: params.highlightedSpanRefs
  });
  return {
    needsSpanRefForDenseRow: true,
    write: (
      spanRef,
      fillColors,
      fillColorOffset,
      lineColors,
      lineColorOffset,
      primaryStartTimeMs,
      primaryEndTimeMs
    ) => {
      if (spanRef == null) {
        return;
      }
      graphColorResolver.writeSpanBlockColors(
        spanRef,
        fillColors,
        fillColorOffset,
        lineColors,
        lineColorOffset,
        'any',
        primaryStartTimeMs,
        primaryEndTimeMs
      );
    }
  };
}

/**
 * Fills block rows through the narrowest available representation.
 *
 * The Arrow path is deliberately row-local: malformed or authored-manual rows fall back for that
 * row only, so a late bad cell never abandons already-written buffers or invokes color hooks twice.
 */
function fillTraceDeckBinaryBlockRows(
  params: Pick<
    Parameters<typeof buildTraceDeckBinaryBlockData>[0],
    'spans' | 'traceLayout' | 'geometryContext' | 'endpointPages'
  > &
    TraceDeckBinaryBlockRowTargets
): void {
  const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
  const geometryContext =
    params.geometryContext ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);
  const denseRanges = params.spans.denseRanges;
  const canUseUnfilteredGeneratedRows = canUseUnfilteredGeneratedPrimaryBlockRows(
    params.traceLayout
  );

  if (canUseDenseGeneratedPrimaryBlockRows(params.traceLayout, denseRanges)) {
    const endpointPages =
      params.endpointPages === undefined
        ? buildTraceArrowPrimaryEndpointPages(params.traceLayout, {
            allowRowLocalSnapshotFilters: !canUseUnfilteredGeneratedRows
          })
        : params.endpointPages;
    if (endpointPages) {
      if (denseRanges && denseRanges.length > 0) {
        if (
          tryFillTrustedDenseGeneratedPrimaryTraceDeckBinaryBlockRows(
            params,
            geometryContext,
            endpointPages,
            denseRanges
          )
        ) {
          return;
        }
        fillDenseGeneratedPrimaryTraceDeckBinaryBlockRows(
          params,
          geometry,
          geometryContext,
          endpointPages,
          denseRanges
        );
        return;
      }
      if (canUseUnfilteredGeneratedRows) {
        fillUnfilteredGeneratedPrimaryTraceDeckBinaryBlockRows(
          params,
          geometry,
          geometryContext,
          endpointPages
        );
        return;
      }
    }
  }

  for (let index = 0; index < params.spans.length; index += 1) {
    const spanRef = params.spans.at(index);
    if (spanRef != null) {
      fillGenericTraceDeckBinaryBlockRow(params, geometry, geometryContext, spanRef, index);
    }
  }
}

/**
 * Returns whether dense canonical block rows can use generated primary Arrow geometry.
 *
 * Unfiltered graphs retain the original broad Arrow path. Active filters are accepted for a dense
 * source borrowing the exact snapshot masks.
 */
function canUseDenseGeneratedPrimaryBlockRows(
  traceLayout: Readonly<TraceLayout>,
  denseRanges: readonly TraceDenseSpanRefRange[] | undefined
): boolean {
  if (!canUseGeneratedPrimaryBlockRowShape(traceLayout)) {
    return false;
  }
  const traceGraph = traceLayout.traceGraph;
  if (!traceGraph.hasActiveSpanFilter()) {
    return true;
  }
  if (!denseRanges || denseRanges.length === 0) {
    return false;
  }
  return denseRanges.every(
    range =>
      (range.filterMaskByRow ?? null) ===
      getTraceViewChunkFilterMask(traceGraph.traceViewSnapshot, range.chunkIndex)
  );
}

/** Returns whether the batch can attempt generated-primary Arrow rows. */
function canUseUnfilteredGeneratedPrimaryBlockRows(traceLayout: Readonly<TraceLayout>): boolean {
  return (
    !traceLayout.traceGraph.hasActiveSpanFilter() &&
    canUseGeneratedPrimaryBlockRowShape(traceLayout)
  );
}

/** Returns whether layout state exposes the generated-primary Arrow geometry prerequisites. */
function canUseGeneratedPrimaryBlockRowShape(traceLayout: Readonly<TraceLayout>): boolean {
  return (
    traceLayout.traceGraph.spanLayout === 'auto' &&
    traceLayout.layoutConfiguration?.timingKey == null &&
    traceLayout.spanLaneColumnsByChunkIndex != null
  );
}

/**
 * Fills generated-primary rows directly from canonical Arrow columns.
 *
 * Secondary timing sidecars do not matter here: a null timing key explicitly selects primary
 * timing, exactly like the generic geometry accessor path.
 */
function fillUnfilteredGeneratedPrimaryTraceDeckBinaryBlockRows(
  params: Pick<
    Parameters<typeof buildTraceDeckBinaryBlockData>[0],
    'spans' | 'traceLayout' | 'geometryContext' | 'endpointPages'
  > &
    TraceDeckBinaryBlockRowTargets,
  geometry: {x1: number; y1: number; x2: number; y2: number},
  geometryContext: TraceLayoutGeometryDerivationContext,
  endpointPages: TraceArrowPrimaryEndpointPages
): void {
  let currentChunkIndex = -1;
  let currentPage: TraceArrowPrimaryEndpointPage | null = null;
  const endpointFields = createTraceArrowPrimaryEndpointFields();

  for (let index = 0; index < params.spans.length; index += 1) {
    const spanRef = params.spans.at(index);
    if (spanRef == null) {
      continue;
    }
    const chunkIndex = getSpanRefChunkIndex(spanRef);
    const spanRefRowIndex = getSpanRefRowIndex(spanRef);
    if (chunkIndex !== currentChunkIndex) {
      currentChunkIndex = chunkIndex;
      currentPage = endpointPages.pagesByChunkIndex.get(chunkIndex) ?? null;
    }

    fillGeneratedPrimaryTraceDeckBinaryBlockRow(
      params,
      geometry,
      geometryContext,
      endpointPages,
      currentPage,
      chunkIndex,
      spanRefRowIndex,
      index,
      endpointFields,
      spanRef
    );
  }
}

/**
 * Streams one trusted dense span source straight into fresh block buffers.
 *
 * This path is intentionally narrow: finalized dataset rows, dense canonical ranges, exact
 * built-in process colors, no highlights, null-free endpoint pages, and generated non-manual
 * layouts. Text/source masks are borrowed by identity and compact output rows while the same
 * canonical range scan is already in flight. Any richer batch stays on the complete checked
 * writer before this loop starts. Its per-process setup visits only low-cardinality pages,
 * batches, and threads; it never scans spans outside the one required output write.
 */
function tryFillTrustedDenseGeneratedPrimaryTraceDeckBinaryBlockRows(
  params: Pick<
    Parameters<typeof buildTraceDeckBinaryBlockData>[0],
    'spans' | 'traceLayout' | 'geometryContext' | 'endpointPages'
  > &
    TraceDeckBinaryBlockRowTargets,
  geometryContext: TraceLayoutGeometryDerivationContext,
  endpointPages: TraceArrowPrimaryEndpointPages,
  denseRanges: readonly TraceDenseSpanRefRange[]
): boolean {
  const fillColors = params.fillColors;
  const lineColors = params.lineColors;
  const colorPalette = params.writeBlockColors?.trustedDensePalette;
  if (!fillColors || !lineColors || !colorPalette) {
    return false;
  }

  const endpointCursor = createTraceArrowTrustedPrimaryEndpointCursor(endpointPages);
  if (!endpointCursor) {
    return false;
  }

  const firstRange = denseRanges[0];
  if (!firstRange) {
    return false;
  }
  const firstLocalRowIndex = bindTraceArrowTrustedPrimaryEndpointCursorRow(
    endpointCursor,
    firstRange.chunkIndex,
    firstRange.rowStart
  );
  const firstBatch = endpointCursor.currentBatch;
  if (!firstBatch) {
    throw new Error('Trusted block endpoint cursor did not bind its first batch.');
  }
  const firstProcessRef = firstBatch.processRef[firstLocalRowIndex] as ProcessRef;
  const processLayout = geometryContext.layoutLookup.processLayoutsByRef.get(firstProcessRef);
  const trustedLaneTable = buildTraceDeckTrustedGeneratedLaneTable(
    geometryContext,
    firstProcessRef
  );
  if (processLayout?.isCollapsed || !trustedLaneTable) {
    return false;
  }
  const {baseThreadRef, descriptors: laneDescriptors} = trustedLaneTable;
  const minTimeMs = geometryContext.minTimeMs;
  const spanHeight = geometryContext.spanHeight;
  const halfSpanHeight = spanHeight / 2;
  const positions = params.positions;
  const sizes = params.sizes;
  const paletteValues = colorPalette.values;
  const fillColorWords = getTraceDeckAlignedUint32View(fillColors);
  const lineColorWords = getTraceDeckAlignedUint32View(lineColors);
  const paletteWords = getTraceDeckAlignedUint32View(paletteValues);
  const maxTimeMs = endpointCursor.maxTimeMs;

  for (const range of denseRanges) {
    const filterMaskByRow = range.filterMaskByRow;
    const rowEnd = range.rowStart + range.rowCount;
    let index = range.outputStart;
    for (let spanRefRowIndex = range.rowStart; spanRefRowIndex < rowEnd; spanRefRowIndex += 1) {
      if (filterMaskByRow != null && filterMaskByRow[spanRefRowIndex] !== 0) {
        continue;
      }
      const localRowIndex = bindTraceArrowTrustedPrimaryEndpointCursorRow(
        endpointCursor,
        range.chunkIndex,
        spanRefRowIndex
      );
      const page = endpointCursor.currentPage;
      const batch = endpointCursor.currentBatch;
      if (!page || !batch) {
        throw new Error('Trusted block endpoint cursor did not bind a raw endpoint row.');
      }
      const threadRef = batch.threadRef[localRowIndex] as number;
      const laneDescriptor = laneDescriptors[threadRef - baseThreadRef];
      if (!laneDescriptor) {
        throw new Error('Trusted block endpoint cursor received an unbound thread layout.');
      }

      const laneIndex = page.laneIndexBySpanRefRow[spanRefRowIndex]!;
      const startTimeMs = batch.startTimeMs[localRowIndex]!;
      const sourceEndTimeMs = batch.endTimeMs[localRowIndex]!;
      const endTimeMs = resolveTraceArrowTrustedPrimaryEndpointEndTime(
        batch.statusCode[localRowIndex]!,
        startTimeMs,
        sourceEndTimeMs,
        maxTimeMs
      );
      if (laneDescriptor.visible && laneIndex >= 0) {
        const isVisibleLane =
          (laneDescriptor.renderedLaneCount == null ||
            laneIndex < laneDescriptor.renderedLaneCount) &&
          (!laneDescriptor.onlyTopLaneVisible || laneIndex === 0);
        if (isVisibleLane) {
          const laneYPositions = laneDescriptor.laneYPositions;
          const yPosition =
            laneYPositions == null
              ? laneDescriptor.yPosition
              : laneDescriptor.lanesCollapsed
                ? (laneYPositions[0] ?? laneDescriptor.yPosition)
                : (laneYPositions[Math.min(laneIndex, laneYPositions.length - 1)] ??
                  laneYPositions[0] ??
                  laneDescriptor.yPosition);
          // Match the existing Float32 geometry boundary before deriving width and height.
          const x1 = Math.fround(startTimeMs - minTimeMs);
          const x2 = Math.fround(endTimeMs - minTimeMs);
          const y1 = Math.fround(yPosition - halfSpanHeight);
          const y2 = Math.fround(yPosition + halfSpanHeight);
          const positionOffset = index * 3;
          positions[positionOffset] = x1;
          positions[positionOffset + 1] = y1;
          // Fresh Float32Array rows already own zero z values; do not store them again.
          const sizeOffset = index * 2;
          sizes[sizeOffset] = x2 - x1;
          sizes[sizeOffset + 1] = y2 - y1;
        }
      }

      const paletteOffset = sourceEndTimeMs - startTimeMs < colorPalette.minSpanTimeMs ? 8 : 0;
      if (fillColorWords && lineColorWords && paletteWords) {
        const paletteWordOffset = paletteOffset / 4;
        fillColorWords[index] = paletteWords[paletteWordOffset]!;
        lineColorWords[index] = paletteWords[paletteWordOffset + 1]!;
      } else {
        const fillColorOffset = index * 4;
        fillColors[fillColorOffset] = paletteValues[paletteOffset]!;
        fillColors[fillColorOffset + 1] = paletteValues[paletteOffset + 1]!;
        fillColors[fillColorOffset + 2] = paletteValues[paletteOffset + 2]!;
        fillColors[fillColorOffset + 3] = paletteValues[paletteOffset + 3]!;
        const linePaletteOffset = paletteOffset + 4;
        lineColors[fillColorOffset] = paletteValues[linePaletteOffset]!;
        lineColors[fillColorOffset + 1] = paletteValues[linePaletteOffset + 1]!;
        lineColors[fillColorOffset + 2] = paletteValues[linePaletteOffset + 2]!;
        lineColors[fillColorOffset + 3] = paletteValues[linePaletteOffset + 3]!;
      }
      index += 1;
    }
  }
  return true;
}

/**
 * Fills dense canonical chunk ranges without first materializing or decoding packed span refs.
 *
 * Borrowed text/source masks skip nonzero canonical rows and advance the output index only for
 * visible rows. A packed ref is synthesized only when a custom/highlight color writer needs
 * identity or when one malformed row falls back to the generic accessor path.
 */
function fillDenseGeneratedPrimaryTraceDeckBinaryBlockRows(
  params: Pick<
    Parameters<typeof buildTraceDeckBinaryBlockData>[0],
    'spans' | 'traceLayout' | 'geometryContext' | 'endpointPages'
  > &
    TraceDeckBinaryBlockRowTargets,
  geometry: {x1: number; y1: number; x2: number; y2: number},
  geometryContext: TraceLayoutGeometryDerivationContext,
  endpointPages: TraceArrowPrimaryEndpointPages,
  denseRanges: readonly TraceDenseSpanRefRange[]
): void {
  const endpointFields = createTraceArrowPrimaryEndpointFields();
  for (const range of denseRanges) {
    const currentPage = endpointPages.pagesByChunkIndex.get(range.chunkIndex) ?? null;
    const filterMaskByRow = range.filterMaskByRow;
    const rowEnd = range.rowStart + range.rowCount;
    let index = range.outputStart;
    for (let spanRefRowIndex = range.rowStart; spanRefRowIndex < rowEnd; spanRefRowIndex += 1) {
      if (filterMaskByRow != null && filterMaskByRow[spanRefRowIndex] !== 0) {
        continue;
      }
      fillGeneratedPrimaryTraceDeckBinaryBlockRow(
        params,
        geometry,
        geometryContext,
        endpointPages,
        currentPage,
        range.chunkIndex,
        spanRefRowIndex,
        index,
        endpointFields
      );
      index += 1;
    }
  }
}

/** Fills one generated-primary row, synthesizing its ref only for ref-native work. */
function fillGeneratedPrimaryTraceDeckBinaryBlockRow(
  params: Pick<
    Parameters<typeof buildTraceDeckBinaryBlockData>[0],
    'spans' | 'traceLayout' | 'geometryContext' | 'endpointPages'
  > &
    TraceDeckBinaryBlockRowTargets,
  geometry: {x1: number; y1: number; x2: number; y2: number},
  geometryContext: TraceLayoutGeometryDerivationContext,
  endpointPages: TraceArrowPrimaryEndpointPages,
  page: TraceArrowPrimaryEndpointPage | null,
  chunkIndex: number,
  spanRefRowIndex: number,
  index: number,
  endpointFields: TraceArrowPrimaryEndpointFields,
  spanRef?: SpanRef
): void {
  const hasEndpointFields =
    page != null &&
    fillTraceArrowPrimaryEndpointFieldsFromPageRow(
      endpointPages,
      page,
      spanRefRowIndex,
      endpointFields
    );
  const threadLayout = !hasEndpointFields
    ? undefined
    : geometryContext.layoutLookup.threadLayoutsByRef.get(endpointFields.threadRef);

  if (hasEndpointFields && threadLayout?.manualContentHeight == null) {
    if (
      fillGeneratedPrimarySpanBoundingBoxFromFields(
        endpointFields.processRef,
        endpointFields.threadRef,
        endpointFields.laneIndex,
        endpointFields.startTimeMs,
        endpointFields.endTimeMs,
        geometryContext.layoutLookup,
        geometryContext.minTimeMs,
        geometry,
        geometryContext.spanHeight
      )
    ) {
      writeTraceDeckBinaryBlockGeometry(params, geometry, index);
    }
    const colorSpanRef =
      spanRef ??
      (params.writeBlockColors?.needsSpanRefForDenseRow
        ? encodeSpanRef(chunkIndex, spanRefRowIndex)
        : undefined);
    writeTraceDeckBinaryBlockColors(
      params,
      colorSpanRef,
      index,
      endpointFields.startTimeMs,
      endpointFields.sourceEndTimeMs
    );
    return;
  }

  fillGenericTraceDeckBinaryBlockRow(
    params,
    geometry,
    geometryContext,
    spanRef ?? encodeSpanRef(chunkIndex, spanRefRowIndex),
    index
  );
}

/** Fills one row through the full accessor path retained for unsupported semantics. */
function fillGenericTraceDeckBinaryBlockRow(
  params: Pick<
    Parameters<typeof buildTraceDeckBinaryBlockData>[0],
    'spans' | 'traceLayout' | 'geometryContext'
  > &
    TraceDeckBinaryBlockRowTargets,
  geometry: {x1: number; y1: number; x2: number; y2: number},
  geometryContext: TraceLayoutGeometryDerivationContext,
  spanRef: SpanRef,
  index: number
): void {
  if (
    fillTraceLayoutSpanGeometry({
      traceLayout: params.traceLayout,
      spanRef,
      target: geometry,
      context: geometryContext
    })
  ) {
    writeTraceDeckBinaryBlockGeometry(params, geometry, index);
  }
  writeTraceDeckBinaryBlockColors(params, spanRef, index);
}

/** Writes one visible block rectangle into caller-owned position and size buffers. */
function writeTraceDeckBinaryBlockGeometry(
  targets: TraceDeckBinaryBlockRowTargets,
  geometry: {x1: number; y1: number; x2: number; y2: number},
  index: number
): void {
  targets.positions[index * 3] = geometry.x1;
  targets.positions[index * 3 + 1] = geometry.y1;
  targets.positions[index * 3 + 2] = 0;
  targets.sizes[index * 2] = geometry.x2 - geometry.x1;
  targets.sizes[index * 2 + 1] = geometry.y2 - geometry.y1;
}

/** Writes one optional block color pair exactly once for the current row. */
function writeTraceDeckBinaryBlockColors(
  targets: TraceDeckBinaryBlockRowTargets,
  spanRef: SpanRef | undefined,
  index: number,
  primaryStartTimeMs?: number | null,
  primaryEndTimeMs?: number | null
): void {
  if (!targets.writeBlockColors || !targets.fillColors || !targets.lineColors) {
    return;
  }
  targets.writeBlockColors.write(
    spanRef,
    targets.fillColors,
    index * 4,
    targets.lineColors,
    index * 4,
    primaryStartTimeMs,
    primaryEndTimeMs
  );
}

/**
 * Builds two fixed process-color pairs for trusted dense block timing visibility states.
 *
 * The normal and short-duration tuples preserve the same path/min-duration alpha math as the
 * general fixed-color writer, but the hot loop only copies already-resolved bytes.
 */
function buildTraceDeckTrustedDenseBlockColorPalette(
  settings: TraceVisSettings,
  fillColor: TraceDeckColor,
  lineColor: TraceDeckColor
): TraceDeckTrustedDenseBlockColorPalette {
  const values = new Uint8Array(16);
  const normalAlpha = settings.showPathsOnly ? NOT_IN_PATH_FADE_FACTOR : 1;
  const shortAlpha = normalAlpha * TRACE_DECK_BLOCK_MIN_DURATION_FADE_FACTOR;
  writeTraceDeckTrustedDenseBlockPaletteColor(values, 0, fillColor, normalAlpha);
  writeTraceDeckTrustedDenseBlockPaletteColor(values, 4, lineColor, normalAlpha);
  writeTraceDeckTrustedDenseBlockPaletteColor(values, 8, fillColor, shortAlpha);
  writeTraceDeckTrustedDenseBlockPaletteColor(values, 12, lineColor, shortAlpha);
  return {
    values,
    minSpanTimeMs: settings.minSpanTimeMs
  };
}

/** Writes one cold-path trusted block palette color into its fixed byte slot. */
function writeTraceDeckTrustedDenseBlockPaletteColor(
  target: Uint8Array,
  offset: number,
  color: TraceDeckColor,
  alphaMultiplier: number
): void {
  target[offset] = color[0];
  target[offset + 1] = color[1];
  target[offset + 2] = color[2];
  target[offset + 3] = color[3] * alphaMultiplier;
}

/** Caller-owned dependency buffers filled by one shared Arrow/generic row traversal. */
type TraceDeckBinaryDependencyRowTargets = {
  /** Source endpoint storage with three values per dependency. */
  readonly sourcePositions: Float32Array;
  /** Target endpoint storage with three values per dependency. */
  readonly targetPositions: Float32Array;
  /** Optional composited line-color storage with four values per dependency. */
  readonly colors?: Uint8Array;
  /** Optional already-resolved opacity multiplier paired with the color storage. */
  readonly opacityMultiplier?: number;
  /** Optional precomposited regular/submit/warning colors paired with the color storage. */
  readonly colorPalette?: TraceDeckBinaryDependencyColorPalette;
  /** Optional active settings required before selecting the trusted all-mode dense writer. */
  readonly settings?: TraceVisSettings;
};

/**
 * Three precomposited dependency colors packed into one tiny batch-local byte buffer.
 *
 * Offsets are regular=0, submit=4, warning=8. The palette is rebuilt with each binary payload and
 * is never retained as a graph or scene cache.
 */
type TraceDeckBinaryDependencyColorPalette = {
  /** Regular, submit, and warning RGBA bytes in fixed four-byte slots. */
  readonly values: Uint8Array;
};

/** Shared dependency-row inputs used by the general ref-routed Arrow and fallback writer. */
type TraceDeckBinaryDependencyRowsParams = Pick<
  Parameters<typeof buildTraceDeckBinaryDependencyLineData>[0],
  'dependencyRefs' | 'traceLayout' | 'geometryContext' | 'endpointPages'
> &
  TraceDeckBinaryDependencyRowTargets;

/** Borrowed canonical dependency columns bound once for one table traversal. */
type TraceDeckBinaryDependencyColumns = {
  /** Borrowed source span-ref column. */
  readonly startSpanRef: {get(rowIndex: number): unknown} | null;
  /** Borrowed target span-ref column. */
  readonly endSpanRef: {get(rowIndex: number): unknown} | null;
  /** Borrowed compact wait-mode discriminator column. */
  readonly waitModeCode: {get(rowIndex: number): unknown} | null;
  /** Borrowed wait-duration column used only while writing colors. */
  readonly waitTimeMs: {get(rowIndex: number): unknown} | null;
  /** Borrowed compact parent/submit keyword predicate flags. */
  readonly keywordFlags: {get(rowIndex: number): unknown} | null;
};

/**
 * One process-local generated lane shape shared by trusted block and dependency loops.
 *
 * The descriptor borrows existing layout-owned lane positions and keeps only scalar branch state;
 * it is created and dropped with one binary dependency build.
 */
type TraceDeckTrustedGeneratedLaneDescriptor = {
  /** Whether this thread contributes visible generated-lane Y positions. */
  readonly visible: boolean;
  /** Base thread Y used when no generated lane array exists. */
  readonly yPosition: number;
  /** Existing generated lane positions, or null when the base thread Y is used. */
  readonly laneYPositions: readonly number[] | null;
  /** Whether every visible lane collapses to the first generated lane Y. */
  readonly lanesCollapsed: boolean;
  /** Finite rendered-lane bound used by block visibility, or null when unbounded. */
  readonly renderedLaneCount: number | null;
  /** Whether block visibility admits only generated lane zero. */
  readonly onlyTopLaneVisible: boolean;
};

/**
 * Dense process-local thread table indexed by `threadRef - baseThreadRef`.
 *
 * Sparse local thread slots, manual layouts, and compact visible-lane indexes stay on the checked
 * path so trusted loops can use direct array lookups instead of per-row Map lookups.
 */
type TraceDeckTrustedGeneratedLaneTable = {
  /** Canonical thread ref for process-local thread slot zero. */
  readonly baseThreadRef: number;
  /** Dense generated lane descriptors in process-local thread index order. */
  readonly descriptors: readonly TraceDeckTrustedGeneratedLaneDescriptor[];
};

/** One dense same-process table plus loop invariants bound outside its row traversal. */
type TraceDeckDenseDependencyTableBinding = {
  /** Canonical same-process dependency table traversed by row index. */
  readonly table: ArrowTraceSameProcessDependencyTable;
  /** Stable process ref shared by every canonical row in the table. */
  readonly processRef: ProcessRef;
  /** Current layout row shared by every canonical endpoint in the table. */
  readonly processLayout?: ProcessLayout;
  /** Borrowed canonical columns bound once before the dense loop. */
  readonly columns: TraceDeckBinaryDependencyColumns;
  /**
   * Optional borrowed snapshot/table identity for compact text/source-masked dependency rows.
   *
   * Undefined keeps canonical table-row indexes equal to prepared output indexes.
   */
  readonly denseVisibility?: NonNullable<TraceSameProcessDependencyRefSource['denseVisibility']>;
  /**
   * Optional aligned borrowed Float64 batches for the dense numeric hot path.
   *
   * Null preserves the scalar-vector fallback when Arrow vectors are unsupported or their batch
   * boundaries do not align.
   */
  readonly fixedWidthBatches: readonly TraceDenseDependencyFixedWidthBatch[] | null;
};

/** Dataset-only dense table binding whose endpoint and dependency columns are null-free. */
type TraceDeckTrustedDenseDependencyTableBinding = TraceDeckDenseDependencyTableBinding & {
  /** Null-free offset-zero dependency batches accepted before entering the hot loop. */
  readonly trustedFixedWidthBatches: readonly TraceTrustedDenseDependencyFixedWidthBatch[];
  /** Dense process-local generated lane lookup accepted before entering the hot loop. */
  readonly trustedLaneTable: TraceDeckTrustedGeneratedLaneTable;
};

/** Dense writer inputs that derive dependency identity directly from one table row index. */
type TraceDeckDenseDependencyRowsParams = TraceDeckBinaryDependencyRowsParams & {
  /** One canonical table and its current layout invariants. */
  readonly boundTable: TraceDeckDenseDependencyTableBinding;
};

/**
 * Fills dependency rows through borrowed endpoint pages when the batch permits it.
 *
 * Pages are built and dropped inside this call. Unsupported dependency rows fall back one at a
 * time so malformed canonical data cannot discard already-written typed buffers.
 */
function fillTraceDeckBinaryDependencyRows(params: TraceDeckBinaryDependencyRowsParams): void {
  if (params.dependencyRefs.length === 0) {
    return;
  }
  const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
  const geometryContext =
    params.geometryContext ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);
  const endpointPages =
    params.endpointPages === undefined
      ? buildTraceArrowPrimaryEndpointPages(params.traceLayout, {
          allowRowLocalSnapshotFilters: params.dependencyRefs.denseVisibility != null
        })
      : params.endpointPages;

  if (endpointPages) {
    if (
      tryFillDenseTraceDeckBinaryDependencyRows(params, geometry, geometryContext, endpointPages)
    ) {
      return;
    }
    fillUnfilteredTraceDeckBinaryDependencyRows(params, geometry, geometryContext, endpointPages);
    return;
  }

  for (let index = 0; index < params.dependencyRefs.length; index += 1) {
    const dependencyRef = params.dependencyRefs.at(index);
    if (dependencyRef == null) {
      continue;
    }
    fillGenericTraceDeckBinaryDependencyRow(
      params,
      geometry,
      geometryContext,
      dependencyRef,
      index
    );
  }
}

/**
 * Streams one dense canonical same-process table when the ref source encodes table order.
 *
 * The source retains only its process index and length. This binder recovers the ephemeral Arrow
 * table from the current graph for one write, then drops it with the borrowed endpoint pages.
 */
function tryFillDenseTraceDeckBinaryDependencyRows(
  params: TraceDeckBinaryDependencyRowsParams,
  geometry: {x1: number; y1: number; x2: number; y2: number},
  geometryContext: TraceLayoutGeometryDerivationContext,
  endpointPages: TraceArrowPrimaryEndpointPages
): boolean {
  const processIndex = params.dependencyRefs.denseProcessIndex;
  const denseVisibility = params.dependencyRefs.denseVisibility;
  const graph = params.traceLayout.traceGraph;
  if (processIndex == null) {
    return false;
  }
  if (
    denseVisibility != null
      ? !canUseMaskedDenseSameProcessDependencyRows(params)
      : graph.hasActiveSpanFilter()
  ) {
    return false;
  }

  const processId = graph.processIdsByIndex[processIndex] as TraceProcessId | undefined;
  const table = processId ? graph.sameProcessDependencyTableMap[processId] : null;
  const processRef = graph.getProcessRefs()[processIndex] ?? null;
  if (
    !table ||
    !processRef ||
    (denseVisibility == null && table.numRows !== params.dependencyRefs.length) ||
    (denseVisibility != null &&
      (denseVisibility.dependencyTable !== table ||
        denseVisibility.traceViewSnapshot !== graph.traceViewSnapshot ||
        params.dependencyRefs.length > table.numRows))
  ) {
    return false;
  }

  const columns = getTraceDeckBinaryDependencyColumns(table);
  const fixedWidthBatches = buildTraceDenseDependencyFixedWidthBatchesForTable(table);
  const trustedFixedWidthBatches =
    params.settings?.sameProcessDependencyMode !== 'all'
      ? null
      : buildTraceTrustedDenseDependencyFixedWidthBatches(fixedWidthBatches);
  const trustedLaneTable =
    trustedFixedWidthBatches == null
      ? null
      : buildTraceDeckTrustedGeneratedLaneTable(geometryContext, processRef);
  const endpointCursor =
    trustedFixedWidthBatches == null || trustedLaneTable == null
      ? null
      : createTraceArrowTrustedPrimaryEndpointCursor(endpointPages);
  if (trustedFixedWidthBatches && trustedLaneTable && endpointCursor) {
    fillTrustedDenseTraceDeckBinaryDependencyRows(
      {
        ...params,
        boundTable: {
          table,
          processRef,
          processLayout: geometryContext.layoutLookup.processLayoutsByRef.get(processRef),
          columns,
          denseVisibility,
          fixedWidthBatches,
          trustedFixedWidthBatches,
          trustedLaneTable
        }
      },
      geometryContext,
      endpointCursor
    );
    return true;
  }

  fillDenseUnfilteredTraceDeckBinaryDependencyRows(
    {
      ...params,
      boundTable: {
        table,
        processRef,
        processLayout: geometryContext.layoutLookup.processLayoutsByRef.get(processRef),
        columns,
        denseVisibility,
        fixedWidthBatches
      }
    },
    geometry,
    geometryContext,
    endpointPages
  );
  return true;
}

/**
 * Returns whether a filtered dependency source can stay on canonical dense table rows.
 *
 * Snapshot filters only hide endpoints. Selected subsets and non-all dependency modes can change
 * row semantics and remain on the visible-ref fallback.
 */
function canUseMaskedDenseSameProcessDependencyRows(
  params: TraceDeckBinaryDependencyRowsParams
): boolean {
  const graph = params.traceLayout.traceGraph;
  return (
    graph.hasActiveSpanFilter() &&
    graph.spanRefs == null &&
    params.settings?.sameProcessDependencyMode === 'all'
  );
}

/**
 * Build-local chunk-mask cursor reused only while one dense dependency writer scan is active.
 *
 * The cursor borrows one snapshot mask at chunk transitions and is discarded with the writer; it
 * does not retain a chunk map, dependency-row mask, or reuse key.
 */
type TraceDeckDenseDependencyMaskCursor = {
  /** Last endpoint chunk slot bound by this writer cursor. */
  chunkIndex: number;
  /** Borrowed endpoint page for the bound chunk, or null when the chunk is unsupported. */
  page: TraceArrowPrimaryEndpointPage | null;
  /** Borrowed mask for the bound chunk, or null when every chunk row is visible. */
  filterMaskByRow: Readonly<Uint8Array> | null;
};

/** Creates one empty chunk-mask cursor for a single dependency endpoint scan. */
function createTraceDeckDenseDependencyMaskCursor(): TraceDeckDenseDependencyMaskCursor {
  return {
    chunkIndex: -1,
    page: null,
    filterMaskByRow: null
  };
}

/**
 * Returns whether one canonical endpoint row is hidden by the current text/source snapshot.
 *
 * Trusted dependency rows already proved their endpoint refs are valid, so this helper only
 * decodes the packed chunk/row address and borrows the existing chunk mask at transitions.
 */
function isTraceDeckDenseDependencyEndpointHidden(
  traceViewSnapshot: NonNullable<
    TraceSameProcessDependencyRefSource['denseVisibility']
  >['traceViewSnapshot'],
  spanRef: SpanRef,
  cursor: TraceDeckDenseDependencyMaskCursor
): boolean {
  const chunkIndex = getSpanRefChunkIndex(spanRef);
  if (cursor.chunkIndex !== chunkIndex) {
    cursor.chunkIndex = chunkIndex;
    cursor.filterMaskByRow = getTraceViewChunkFilterMask(traceViewSnapshot, chunkIndex);
  }
  const filterMaskByRow = cursor.filterMaskByRow;
  if (filterMaskByRow == null) {
    return false;
  }
  const spanRefRowIndex = getSpanRefRowIndex(spanRef);
  return (
    spanRefRowIndex >= 0 &&
    spanRefRowIndex < filterMaskByRow.length &&
    filterMaskByRow[spanRefRowIndex] !== 0
  );
}

/** One masked endpoint read result used by the dense dependency writer. */
type TraceDeckMaskedDenseEndpointResult = 'visible' | 'hidden' | 'invalid';

/**
 * Resolves one visible masked endpoint while binding its page and mask at the same chunk edge.
 *
 * The previous dense path decoded the packed ref once for the mask and again for endpoint fields.
 * This cursor keeps those reads together without retaining any row-index state after the write.
 */
function fillTraceDeckMaskedDenseDependencyEndpointFields(
  endpointPages: TraceArrowPrimaryEndpointPages,
  traceViewSnapshot: NonNullable<
    TraceSameProcessDependencyRefSource['denseVisibility']
  >['traceViewSnapshot'],
  spanRef: SpanRef,
  cursor: TraceDeckDenseDependencyMaskCursor,
  target: TraceArrowPrimaryEndpointFields
): TraceDeckMaskedDenseEndpointResult {
  const chunkIndex = getSpanRefChunkIndex(spanRef);
  if (cursor.chunkIndex !== chunkIndex) {
    cursor.chunkIndex = chunkIndex;
    cursor.page = endpointPages.pagesByChunkIndex.get(chunkIndex) ?? null;
    cursor.filterMaskByRow = getTraceViewChunkFilterMask(traceViewSnapshot, chunkIndex);
  }
  const spanRefRowIndex = getSpanRefRowIndex(spanRef);
  const filterMaskByRow = cursor.filterMaskByRow;
  if (
    filterMaskByRow != null &&
    spanRefRowIndex >= 0 &&
    spanRefRowIndex < filterMaskByRow.length &&
    filterMaskByRow[spanRefRowIndex] !== 0
  ) {
    return 'hidden';
  }
  const page = cursor.page;
  return page &&
    fillTraceArrowPrimaryEndpointFieldsFromPageRow(endpointPages, page, spanRefRowIndex, target)
    ? 'visible'
    : 'invalid';
}

/**
 * Builds one dense process-local lane table for the trusted dependency loop.
 *
 * This is ephemeral O(threads) setup, not retained runtime state. Sparse thread slots, manual
 * layouts, or compact visible-lane indexes keep the whole dependency table on the checked path.
 */
function buildTraceDeckTrustedGeneratedLaneTable(
  geometryContext: TraceLayoutGeometryDerivationContext,
  processRef: ProcessRef
): TraceDeckTrustedGeneratedLaneTable | null {
  const processIndex = getProcessRefIndex(processRef);
  const baseThreadRef = encodeProcessThreadRef(processIndex, 0);
  const processThreadLayouts: Array<{
    threadIndex: number;
    threadLayout: ThreadLayout;
  }> = [];
  let maxThreadIndex = -1;

  for (const [threadRef, threadLayout] of geometryContext.layoutLookup.threadLayoutsByRef) {
    const threadIndex = threadRef - baseThreadRef;
    if (
      !Number.isSafeInteger(threadIndex) ||
      threadIndex < 0 ||
      threadIndex > MAX_PROCESS_LOCAL_THREAD_REF_INDEX
    ) {
      continue;
    }
    if (threadLayout.manualContentHeight != null || threadLayout.lanes?.visibleLaneIndices) {
      return null;
    }
    processThreadLayouts.push({threadIndex, threadLayout});
    maxThreadIndex = Math.max(maxThreadIndex, threadIndex);
  }
  if (processThreadLayouts.length === 0 || maxThreadIndex + 1 !== processThreadLayouts.length) {
    return null;
  }

  const descriptors: Array<TraceDeckTrustedGeneratedLaneDescriptor | undefined> = new Array(
    processThreadLayouts.length
  );
  for (const {threadIndex, threadLayout} of processThreadLayouts) {
    if (descriptors[threadIndex]) {
      return null;
    }
    const lanes = threadLayout.lanes;
    descriptors[threadIndex] = {
      visible: threadLayout.visible,
      yPosition: threadLayout.yPosition,
      laneYPositions: lanes?.laneYPositions.length ? lanes.laneYPositions : null,
      lanesCollapsed: Boolean(lanes?.isCollapsed),
      renderedLaneCount:
        lanes?.renderedLaneCount != null && Number.isFinite(lanes.renderedLaneCount)
          ? lanes.renderedLaneCount
          : null,
      onlyTopLaneVisible: Boolean(lanes?.isCollapsed) && lanes?.collapseMode !== 'stack-all'
    };
  }
  return {
    baseThreadRef,
    descriptors: descriptors as TraceDeckTrustedGeneratedLaneDescriptor[]
  };
}

/**
 * Streams direct same-process dependency rows and borrowed primary endpoint fields.
 *
 * The only directory retained during this loop is the current batch's chunk-page map; a packed
 * SpanRef already identifies the endpoint page and row, so no per-span index is needed.
 */
function fillUnfilteredTraceDeckBinaryDependencyRows(
  params: TraceDeckBinaryDependencyRowsParams,
  geometry: {x1: number; y1: number; x2: number; y2: number},
  geometryContext: TraceLayoutGeometryDerivationContext,
  endpointPages: TraceArrowPrimaryEndpointPages
): void {
  const graph = params.traceLayout.traceGraph;
  const processRefs = graph.getProcessRefs();
  const startEndpoint = createTraceArrowPrimaryEndpointFields();
  const endEndpoint = createTraceArrowPrimaryEndpointFields();
  const shouldWriteColor = params.colors != null && params.opacityMultiplier != null;
  let currentProcessIndex = -1;
  let currentProcessRef: ProcessRef | null = null;
  let currentProcessLayout: ProcessLayout | undefined;
  let currentTable: (typeof graph.sameProcessDependencyTableMap)[TraceProcessId] | null = null;
  let currentColumns: TraceDeckBinaryDependencyColumns | null = null;

  for (let index = 0; index < params.dependencyRefs.length; index += 1) {
    const dependencyRef = params.dependencyRefs.at(index);
    if (dependencyRef == null) {
      continue;
    }
    if (!isSameProcessDependencyRef(dependencyRef)) {
      fillGenericTraceDeckBinaryDependencyRow(
        params,
        geometry,
        geometryContext,
        dependencyRef,
        index
      );
      continue;
    }

    const processIndex = getSameProcessDependencyRefProcessIndex(dependencyRef);
    const rowIndex = getSameProcessDependencyRefRowIndex(dependencyRef);
    if (processIndex !== currentProcessIndex) {
      const processId = graph.processIdsByIndex[processIndex] as TraceProcessId | undefined;
      const table = processId ? graph.sameProcessDependencyTableMap[processId] : null;
      currentProcessIndex = processIndex;
      currentProcessRef = processRefs[processIndex] ?? null;
      currentProcessLayout =
        currentProcessRef == null
          ? undefined
          : geometryContext.layoutLookup.processLayoutsByRef.get(currentProcessRef);
      currentTable = table ?? null;
      currentColumns = currentTable ? getTraceDeckBinaryDependencyColumns(currentTable) : null;
    }

    const rowIndexIsValid =
      currentTable != null && rowIndex >= 0 && rowIndex < currentTable.numRows;
    const startSpanRef = rowIndexIsValid
      ? normalizeArrowRefNumber(currentColumns?.startSpanRef?.get(rowIndex))
      : null;
    const endSpanRef = rowIndexIsValid
      ? normalizeArrowRefNumber(currentColumns?.endSpanRef?.get(rowIndex))
      : null;
    const waitMode = rowIndexIsValid
      ? decodeTraceDependencyWaitModeCode(currentColumns?.waitModeCode?.get(rowIndex))
      : null;
    if (
      !currentProcessRef ||
      startSpanRef == null ||
      endSpanRef == null ||
      waitMode == null ||
      !fillTraceArrowPrimaryEndpointFields(endpointPages, startSpanRef as SpanRef, startEndpoint) ||
      !fillTraceArrowPrimaryEndpointFields(endpointPages, endSpanRef as SpanRef, endEndpoint) ||
      startEndpoint.processRef !== currentProcessRef ||
      endEndpoint.processRef !== currentProcessRef
    ) {
      fillGenericTraceDeckBinaryDependencyRow(
        params,
        geometry,
        geometryContext,
        dependencyRef,
        index
      );
      continue;
    }

    if (
      (startEndpoint.laneIndex < 0 &&
        currentProcessLayout?.isCollapsed &&
        !graph.isSpanVisible(startSpanRef as SpanRef)) ||
      (endEndpoint.laneIndex < 0 &&
        currentProcessLayout?.isCollapsed &&
        !graph.isSpanVisible(endSpanRef as SpanRef))
    ) {
      fillGenericTraceDeckBinaryDependencyRow(
        params,
        geometry,
        geometryContext,
        dependencyRef,
        index
      );
      continue;
    }

    const keywordFlags = currentColumns?.keywordFlags?.get(rowIndex);
    const hasParentKeyword = traceDependencyKeywordFlagsHasParent(keywordFlags);
    const hasSubmitKeyword = shouldWriteColor && traceDependencyKeywordFlagsHasSubmit(keywordFlags);
    const waitTimeMs = shouldWriteColor
      ? (normalizeArrowNumber(currentColumns?.waitTimeMs?.get(rowIndex)) ?? 0)
      : 0;
    const isWarning =
      shouldWriteColor &&
      shouldShowSameProcessDependencyByModeFields('warnings', hasSubmitKeyword, waitTimeMs);
    const hasGeometry = fillGeneratedPrimarySameProcessDependencyGeometryFromFields({
      startEndpoint: startEndpoint as ResolvedTraceArrowPrimaryEndpointFields,
      endEndpoint: endEndpoint as ResolvedTraceArrowPrimaryEndpointFields,
      waitMode,
      isParentDependency: hasParentKeyword,
      layoutLookup: geometryContext.layoutLookup,
      processLayout: currentProcessLayout,
      minTimeMs: geometryContext.minTimeMs,
      target: geometry
    });
    if (hasGeometry == null) {
      fillGenericTraceDeckBinaryDependencyRow(
        params,
        geometry,
        geometryContext,
        dependencyRef,
        index
      );
      continue;
    }
    if (hasGeometry) {
      writeTraceDeckBinaryDependencyGeometry(params, geometry, index);
    }
    if (shouldWriteColor) {
      writeTraceDeckBinaryDependencyColor(params, index, hasSubmitKeyword, isWarning);
    }
  }
}

/**
 * Streams one dataset-owned null-free dependency table through a raw trusted endpoint cursor.
 *
 * The table-level gate has already proven aligned offset-zero fixed-width batches and trusted
 * generated-primary endpoint pages. This loop therefore does no validity checks, scalar vector
 * reads, packed-ref synthesis, broad endpoint target writes, or row-local generic fallback.
 * Text/source snapshots keep the same trusted loop and only compact rows whose two borrowed
 * endpoint masks remain visible.
 */
function fillTrustedDenseTraceDeckBinaryDependencyRows(
  params: TraceDeckDenseDependencyRowsParams & {
    /** Null-free dataset-owned table binding accepted before this loop begins. */
    readonly boundTable: TraceDeckTrustedDenseDependencyTableBinding;
  },
  geometryContext: TraceLayoutGeometryDerivationContext,
  endpointCursor: TraceArrowTrustedPrimaryEndpointCursor
): void {
  const {processLayout, trustedFixedWidthBatches, trustedLaneTable, denseVisibility} =
    params.boundTable;
  const {baseThreadRef, descriptors: laneDescriptors} = trustedLaneTable;
  const minTimeMs = geometryContext.minTimeMs;
  const isCollapsedDependency = Boolean(processLayout?.isCollapsed);
  const collapsedActivityY =
    typeof processLayout?.collapsedActivityY === 'number' &&
    Number.isFinite(processLayout.collapsedActivityY)
      ? processLayout.collapsedActivityY
      : undefined;
  const sourcePositions = params.sourcePositions;
  const targetPositions = params.targetPositions;
  const colors = params.colors;
  const paletteValues = params.colorPalette?.values;
  const colorWords = colors ? getTraceDeckAlignedUint32View(colors) : null;
  const paletteWords = paletteValues ? getTraceDeckAlignedUint32View(paletteValues) : null;
  const maxTimeMs = endpointCursor.maxTimeMs;
  let outputIndex = 0;
  const startMaskCursor =
    denseVisibility == null ? null : createTraceDeckDenseDependencyMaskCursor();
  const endMaskCursor = denseVisibility == null ? null : createTraceDeckDenseDependencyMaskCursor();
  // Start and end refs usually advance through the same endpoint batch in table order. Keep one
  // build-local cursor per side so the hot row loop can stay on borrowed page/batch arrays until
  // that side actually crosses a sparse chunk or Arrow record-batch boundary.
  const startEndpointCursor = endpointCursor;
  const endEndpointCursor: TraceArrowTrustedPrimaryEndpointCursor = {
    pagesByChunkIndex: endpointCursor.pagesByChunkIndex,
    maxTimeMs,
    currentChunkIndex: -1,
    currentPage: null,
    currentBatch: null
  };
  let startCurrentChunkIndex = startEndpointCursor.currentChunkIndex;
  let startPage = startEndpointCursor.currentPage;
  let startBatch = startEndpointCursor.currentBatch;
  let endCurrentChunkIndex = endEndpointCursor.currentChunkIndex;
  let endPage = endEndpointCursor.currentPage;
  let endBatch = endEndpointCursor.currentBatch;
  for (const fixedWidthBatch of trustedFixedWidthBatches) {
    const {
      rowStart,
      rowEnd,
      startSpanRef: startSpanRefValues,
      endSpanRef: endSpanRefValues,
      waitModeCode: waitModeCodeValues,
      waitTimeMs: waitTimeMsValues,
      keywordFlags: keywordFlagsValues
    } = fixedWidthBatch;
    const rowCount = rowEnd - rowStart;
    for (let localRowIndex = 0; localRowIndex < rowCount; localRowIndex += 1) {
      const rowIndex = rowStart + localRowIndex;
      const keywordFlags = keywordFlagsValues[localRowIndex]!;
      const waitModeCode = waitModeCodeValues[localRowIndex]!;
      const isStartToStart =
        (keywordFlags & TRACE_DECK_DEPENDENCY_KEYWORD_FLAG_PARENT) !== 0 ||
        waitModeCode === TRACE_DECK_DEPENDENCY_WAIT_MODE_START_TO_START;
      const startSpanRef = startSpanRefValues[localRowIndex]! as SpanRef;
      const endSpanRef = endSpanRefValues[localRowIndex]! as SpanRef;
      if (
        denseVisibility != null &&
        startMaskCursor != null &&
        endMaskCursor != null &&
        (isTraceDeckDenseDependencyEndpointHidden(
          denseVisibility.traceViewSnapshot,
          startSpanRef,
          startMaskCursor
        ) ||
          isTraceDeckDenseDependencyEndpointHidden(
            denseVisibility.traceViewSnapshot,
            endSpanRef,
            endMaskCursor
          ))
      ) {
        continue;
      }
      const preparedRowIndex = denseVisibility == null ? rowIndex : outputIndex;
      if (denseVisibility != null) {
        outputIndex += 1;
      }
      const startSpanRefRowIndex = getSpanRefRowIndex(startSpanRef);
      const startSpanRefChunkIndex = getSpanRefChunkIndex(startSpanRef);
      let startEndpointLocalRowIndex: number;
      if (
        startCurrentChunkIndex === startSpanRefChunkIndex &&
        startBatch != null &&
        startSpanRefRowIndex >= startBatch.rowStart &&
        startSpanRefRowIndex < startBatch.rowEnd
      ) {
        startEndpointLocalRowIndex = startSpanRefRowIndex - startBatch.rowStart;
      } else {
        startEndpointLocalRowIndex = bindTraceArrowTrustedPrimaryEndpointCursorRow(
          startEndpointCursor,
          startSpanRefChunkIndex,
          startSpanRefRowIndex
        );
        startCurrentChunkIndex = startEndpointCursor.currentChunkIndex;
        startPage = startEndpointCursor.currentPage;
        startBatch = startEndpointCursor.currentBatch;
      }
      if (!startPage || !startBatch) {
        throw new Error('Trusted dependency cursor did not bind its start endpoint.');
      }
      const startThreadRef = startBatch.threadRef[startEndpointLocalRowIndex] as number;
      const startLaneIndexValue = startPage.laneIndexBySpanRefRow[startSpanRefRowIndex]!;
      const startStartTimeMs = startBatch.startTimeMs[startEndpointLocalRowIndex]!;
      const endSpanRefRowIndex = getSpanRefRowIndex(endSpanRef);
      const endSpanRefChunkIndex = getSpanRefChunkIndex(endSpanRef);
      let endEndpointLocalRowIndex: number;
      if (
        endCurrentChunkIndex === endSpanRefChunkIndex &&
        endBatch != null &&
        endSpanRefRowIndex >= endBatch.rowStart &&
        endSpanRefRowIndex < endBatch.rowEnd
      ) {
        endEndpointLocalRowIndex = endSpanRefRowIndex - endBatch.rowStart;
      } else {
        endEndpointLocalRowIndex = bindTraceArrowTrustedPrimaryEndpointCursorRow(
          endEndpointCursor,
          endSpanRefChunkIndex,
          endSpanRefRowIndex
        );
        endCurrentChunkIndex = endEndpointCursor.currentChunkIndex;
        endPage = endEndpointCursor.currentPage;
        endBatch = endEndpointCursor.currentBatch;
      }
      if (!endPage || !endBatch) {
        throw new Error('Trusted dependency cursor did not bind its end endpoint.');
      }
      const endThreadRef = endBatch.threadRef[endEndpointLocalRowIndex] as number;
      const endLaneIndexValue = endPage.laneIndexBySpanRefRow[endSpanRefRowIndex]!;
      const endStartTimeMs = endBatch.startTimeMs[endEndpointLocalRowIndex]!;

      const startLaneDescriptor = laneDescriptors[startThreadRef - baseThreadRef];
      const endLaneDescriptor = laneDescriptors[endThreadRef - baseThreadRef];
      if (!startLaneDescriptor || !endLaneDescriptor) {
        throw new Error('Trusted dependency endpoint cursor received unsupported owner layout.');
      }

      const startLaneIndex =
        startLaneIndexValue < 0 && isCollapsedDependency ? 0 : startLaneIndexValue;
      const endLaneIndex = endLaneIndexValue < 0 && isCollapsedDependency ? 0 : endLaneIndexValue;
      if (startLaneIndex >= 0 && endLaneIndex >= 0) {
        const startLaneYPositions = startLaneDescriptor.laneYPositions;
        const startY = startLaneDescriptor.visible
          ? startLaneYPositions == null
            ? startLaneDescriptor.yPosition
            : startLaneDescriptor.lanesCollapsed
              ? (startLaneYPositions[0] ?? startLaneDescriptor.yPosition)
              : (startLaneYPositions[
                  Math.min(Math.max(0, startLaneIndex), startLaneYPositions.length - 1)
                ] ??
                startLaneYPositions[0] ??
                startLaneDescriptor.yPosition)
          : isCollapsedDependency
            ? collapsedActivityY
            : undefined;
        const endLaneYPositions = endLaneDescriptor.laneYPositions;
        const endY = endLaneDescriptor.visible
          ? endLaneYPositions == null
            ? endLaneDescriptor.yPosition
            : endLaneDescriptor.lanesCollapsed
              ? (endLaneYPositions[0] ?? endLaneDescriptor.yPosition)
              : (endLaneYPositions[
                  Math.min(Math.max(0, endLaneIndex), endLaneYPositions.length - 1)
                ] ??
                endLaneYPositions[0] ??
                endLaneDescriptor.yPosition)
          : isCollapsedDependency
            ? collapsedActivityY
            : undefined;

        if (startY != null && endY != null) {
          let startTimeMs: number;
          let endTimeMs: number;
          if (isStartToStart) {
            startTimeMs = startStartTimeMs;
            endTimeMs = endStartTimeMs;
          } else if (waitModeCode === TRACE_DECK_DEPENDENCY_WAIT_MODE_END_TO_END) {
            startTimeMs = resolveTraceArrowTrustedPrimaryEndpointEndTime(
              startBatch.statusCode[startEndpointLocalRowIndex]!,
              startStartTimeMs,
              startBatch.endTimeMs[startEndpointLocalRowIndex]!,
              maxTimeMs
            );
            endTimeMs = resolveTraceArrowTrustedPrimaryEndpointEndTime(
              endBatch.statusCode[endEndpointLocalRowIndex]!,
              endStartTimeMs,
              endBatch.endTimeMs[endEndpointLocalRowIndex]!,
              maxTimeMs
            );
          } else if (waitModeCode === TRACE_DECK_DEPENDENCY_WAIT_MODE_END_TO_START) {
            startTimeMs = resolveTraceArrowTrustedPrimaryEndpointEndTime(
              startBatch.statusCode[startEndpointLocalRowIndex]!,
              startStartTimeMs,
              startBatch.endTimeMs[startEndpointLocalRowIndex]!,
              maxTimeMs
            );
            endTimeMs = endStartTimeMs;
          } else {
            throw new Error(
              'Trusted dependency cursor received an invalid canonical wait-mode code.'
            );
          }
          const positionOffset = preparedRowIndex * 3;
          sourcePositions[positionOffset] = startTimeMs - minTimeMs;
          sourcePositions[positionOffset + 1] = startY;
          targetPositions[positionOffset] = endTimeMs - minTimeMs;
          targetPositions[positionOffset + 1] = endY;
          // Fresh Float32Array rows already own zero z values; do not store them again.
        }
      }

      if (colors && paletteValues) {
        const hasSubmitKeyword = (keywordFlags & TRACE_DECK_DEPENDENCY_KEYWORD_FLAG_SUBMIT) !== 0;
        const paletteOffset =
          hasSubmitKeyword && waitTimeMsValues[localRowIndex]! < DEFAULT_SUBMIT_MIN_WAIT_TIME_MS
            ? 8
            : hasSubmitKeyword
              ? 4
              : 0;
        if (colorWords && paletteWords) {
          colorWords[preparedRowIndex] = paletteWords[paletteOffset / 4]!;
        } else {
          const colorOffset = preparedRowIndex * 4;
          colors[colorOffset] = paletteValues[paletteOffset]!;
          colors[colorOffset + 1] = paletteValues[paletteOffset + 1]!;
          colors[colorOffset + 2] = paletteValues[paletteOffset + 2]!;
          colors[colorOffset + 3] = paletteValues[paletteOffset + 3]!;
        }
      }
    }
  }
  if (denseVisibility != null && outputIndex !== params.dependencyRefs.length) {
    throw new Error('Masked trusted dependency output count diverged from its ref source.');
  }
}

/**
 * Streams one canonical same-process table without ref routing or process-layout rediscovery.
 *
 * The dense prepared path already knows that every output row belongs to one process and one
 * canonical table. Keeping those invariants outside this loop removes the mixed-ref branches
 * while malformed rows still fall back individually through the complete accessor path.
 */
function fillDenseUnfilteredTraceDeckBinaryDependencyRows(
  params: TraceDeckDenseDependencyRowsParams,
  geometry: {x1: number; y1: number; x2: number; y2: number},
  geometryContext: TraceLayoutGeometryDerivationContext,
  endpointPages: TraceArrowPrimaryEndpointPages
): void {
  const graph = params.traceLayout.traceGraph;
  const {table, processRef, processLayout, columns, fixedWidthBatches, denseVisibility} =
    params.boundTable;
  const processIndex = getProcessRefIndex(processRef);
  const startEndpoint = createTraceArrowPrimaryEndpointFields();
  const endEndpoint = createTraceArrowPrimaryEndpointFields();
  const shouldWriteColor = params.colors != null && params.opacityMultiplier != null;
  let outputIndex = 0;
  const startMaskCursor = createTraceDeckDenseDependencyMaskCursor();
  const endMaskCursor = createTraceDeckDenseDependencyMaskCursor();
  /** Falls back one malformed dense row through complete graph accessors on demand. */
  function fillDenseDependencyFallbackRow(rowIndex: number, preparedRowIndex: number): void {
    const dependencyRef =
      denseVisibility == null
        ? params.dependencyRefs.at(preparedRowIndex)
        : encodeSameProcessDependencyRef(encodeLocalSpanRef(processIndex, rowIndex));
    if (dependencyRef == null) {
      return;
    }
    fillGenericTraceDeckBinaryDependencyRow(
      params,
      geometry,
      geometryContext,
      dependencyRef,
      preparedRowIndex
    );
  }
  /** Writes one row after its hot numeric cells have been resolved by the active reader. */
  function fillDenseDependencyRow(
    rowIndex: number,
    preparedRowIndex: number,
    startSpanRef: number | null,
    endSpanRef: number | null,
    waitModeCode: number | null,
    waitTimeMs: number,
    keywordFlags: number | null,
    endpointsAlreadyResolved = false
  ): void {
    const waitMode = decodeTraceDependencyWaitModeCode(waitModeCode);
    if (
      startSpanRef == null ||
      endSpanRef == null ||
      waitMode == null ||
      (!endpointsAlreadyResolved &&
        (!fillTraceArrowPrimaryEndpointFields(
          endpointPages,
          startSpanRef as SpanRef,
          startEndpoint
        ) ||
          !fillTraceArrowPrimaryEndpointFields(
            endpointPages,
            endSpanRef as SpanRef,
            endEndpoint
          ))) ||
      startEndpoint.processRef !== processRef ||
      endEndpoint.processRef !== processRef
    ) {
      fillDenseDependencyFallbackRow(rowIndex, preparedRowIndex);
      return;
    }

    if (
      (startEndpoint.laneIndex < 0 &&
        processLayout?.isCollapsed &&
        !graph.isSpanVisible(startSpanRef as SpanRef)) ||
      (endEndpoint.laneIndex < 0 &&
        processLayout?.isCollapsed &&
        !graph.isSpanVisible(endSpanRef as SpanRef))
    ) {
      fillDenseDependencyFallbackRow(rowIndex, preparedRowIndex);
      return;
    }

    const hasParentKeyword = traceDependencyKeywordFlagsHasParent(keywordFlags);
    const hasSubmitKeyword = shouldWriteColor && traceDependencyKeywordFlagsHasSubmit(keywordFlags);
    const isWarning =
      shouldWriteColor &&
      shouldShowSameProcessDependencyByModeFields('warnings', hasSubmitKeyword, waitTimeMs);
    const hasGeometry = fillGeneratedPrimarySameProcessDependencyGeometryFromFields({
      startEndpoint: startEndpoint as ResolvedTraceArrowPrimaryEndpointFields,
      endEndpoint: endEndpoint as ResolvedTraceArrowPrimaryEndpointFields,
      waitMode,
      isParentDependency: hasParentKeyword,
      layoutLookup: geometryContext.layoutLookup,
      processLayout,
      minTimeMs: geometryContext.minTimeMs,
      target: geometry
    });
    if (hasGeometry == null) {
      fillDenseDependencyFallbackRow(rowIndex, preparedRowIndex);
      return;
    }
    if (hasGeometry) {
      writeTraceDeckBinaryDependencyGeometry(params, geometry, preparedRowIndex);
    }
    if (shouldWriteColor) {
      writeTraceDeckBinaryDependencyColor(params, preparedRowIndex, hasSubmitKeyword, isWarning);
    }
  }
  /** Skips hidden endpoint rows and maps canonical rows to compact prepared output indexes. */
  function fillMaybeMaskedDenseDependencyRow(
    rowIndex: number,
    startSpanRef: number | null,
    endSpanRef: number | null,
    waitModeCode: number | null,
    waitTimeMs: number,
    keywordFlags: number | null
  ): void {
    if (denseVisibility != null && (startSpanRef == null || endSpanRef == null)) {
      return;
    }
    const preparedRowIndex = denseVisibility == null ? rowIndex : outputIndex;
    if (denseVisibility != null) {
      const startResult = fillTraceDeckMaskedDenseDependencyEndpointFields(
        endpointPages,
        denseVisibility.traceViewSnapshot,
        startSpanRef as SpanRef,
        startMaskCursor,
        startEndpoint
      );
      if (startResult === 'hidden') {
        return;
      }
      const endResult = fillTraceDeckMaskedDenseDependencyEndpointFields(
        endpointPages,
        denseVisibility.traceViewSnapshot,
        endSpanRef as SpanRef,
        endMaskCursor,
        endEndpoint
      );
      if (endResult === 'hidden') {
        return;
      }
      if (startResult !== 'visible' || endResult !== 'visible') {
        fillDenseDependencyFallbackRow(rowIndex, preparedRowIndex);
        outputIndex += 1;
        return;
      }
    }
    fillDenseDependencyRow(
      rowIndex,
      preparedRowIndex,
      startSpanRef,
      endSpanRef,
      waitModeCode,
      waitTimeMs,
      keywordFlags,
      denseVisibility != null
    );
    if (denseVisibility != null) {
      outputIndex += 1;
    }
  }

  if (fixedWidthBatches) {
    for (const fixedWidthBatch of fixedWidthBatches) {
      const {
        rowStart,
        startSpanRef: startSpanRefBatch,
        endSpanRef: endSpanRefBatch,
        waitModeCode: waitModeCodeBatch,
        waitTimeMs: waitTimeMsBatch,
        keywordFlags: keywordFlagsBatch
      } = fixedWidthBatch;
      for (let localRowIndex = 0; localRowIndex < startSpanRefBatch.length; localRowIndex += 1) {
        const rowIndex = rowStart + localRowIndex;
        const startSpanRefValue = startSpanRefBatch.values[localRowIndex];
        const startSpanRefValidityIndex = startSpanRefBatch.validityOffset + localRowIndex;
        const startSpanRefIsValid =
          startSpanRefBatch.nullBitmap == null ||
          (startSpanRefBatch.nullBitmap[startSpanRefValidityIndex >> 3]! &
            (1 << (startSpanRefValidityIndex & 7))) !==
            0;
        const startSpanRef =
          startSpanRefIsValid && Number.isSafeInteger(startSpanRefValue) ? startSpanRefValue : null;

        const endSpanRefValue = endSpanRefBatch.values[localRowIndex];
        const endSpanRefValidityIndex = endSpanRefBatch.validityOffset + localRowIndex;
        const endSpanRefIsValid =
          endSpanRefBatch.nullBitmap == null ||
          (endSpanRefBatch.nullBitmap[endSpanRefValidityIndex >> 3]! &
            (1 << (endSpanRefValidityIndex & 7))) !==
            0;
        const endSpanRef =
          endSpanRefIsValid && Number.isSafeInteger(endSpanRefValue) ? endSpanRefValue : null;

        const waitModeCodeValue = waitModeCodeBatch.values[localRowIndex];
        const waitModeCodeValidityIndex = waitModeCodeBatch.validityOffset + localRowIndex;
        const waitModeCodeIsValid =
          waitModeCodeBatch.nullBitmap == null ||
          (waitModeCodeBatch.nullBitmap[waitModeCodeValidityIndex >> 3]! &
            (1 << (waitModeCodeValidityIndex & 7))) !==
            0;
        const waitModeCode = waitModeCodeIsValid ? waitModeCodeValue : null;

        let waitTimeMs = 0;
        if (shouldWriteColor) {
          const waitTimeMsValue = waitTimeMsBatch.values[localRowIndex];
          const waitTimeMsValidityIndex = waitTimeMsBatch.validityOffset + localRowIndex;
          const waitTimeMsIsValid =
            waitTimeMsBatch.nullBitmap == null ||
            (waitTimeMsBatch.nullBitmap[waitTimeMsValidityIndex >> 3]! &
              (1 << (waitTimeMsValidityIndex & 7))) !==
              0;
          waitTimeMs = waitTimeMsIsValid && Number.isFinite(waitTimeMsValue) ? waitTimeMsValue : 0;
        }

        const keywordFlagsValue = keywordFlagsBatch.values[localRowIndex];
        const keywordFlagsValidityIndex = keywordFlagsBatch.validityOffset + localRowIndex;
        const keywordFlagsIsValid =
          keywordFlagsBatch.nullBitmap == null ||
          (keywordFlagsBatch.nullBitmap[keywordFlagsValidityIndex >> 3]! &
            (1 << (keywordFlagsValidityIndex & 7))) !==
            0;
        const keywordFlags = keywordFlagsIsValid ? keywordFlagsValue : null;

        fillMaybeMaskedDenseDependencyRow(
          rowIndex,
          startSpanRef,
          endSpanRef,
          waitModeCode,
          waitTimeMs,
          keywordFlags
        );
      }
    }
    if (denseVisibility != null && outputIndex !== params.dependencyRefs.length) {
      throw new Error('Masked dense dependency output count diverged from its ref source.');
    }
    return;
  }

  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
    fillMaybeMaskedDenseDependencyRow(
      rowIndex,
      normalizeArrowRefNumber(columns.startSpanRef?.get(rowIndex)),
      normalizeArrowRefNumber(columns.endSpanRef?.get(rowIndex)),
      normalizeArrowNumber(columns.waitModeCode?.get(rowIndex)),
      shouldWriteColor ? (normalizeArrowNumber(columns.waitTimeMs?.get(rowIndex)) ?? 0) : 0,
      normalizeArrowNumber(columns.keywordFlags?.get(rowIndex))
    );
  }
  if (denseVisibility != null && outputIndex !== params.dependencyRefs.length) {
    throw new Error('Masked dense dependency output count diverged from its ref source.');
  }
}

/** Binds the canonical dependency columns used by direct Arrow row writers. */
function getTraceDeckBinaryDependencyColumns(
  table: Readonly<ArrowTraceSameProcessDependencyTable>
): TraceDeckBinaryDependencyColumns {
  return {
    startSpanRef: table.getChild('startSpanRef') ?? null,
    endSpanRef: table.getChild('endSpanRef') ?? null,
    waitModeCode: table.getChild('waitModeCode') ?? null,
    waitTimeMs: table.getChild('waitTimeMs') ?? null,
    keywordFlags: table.getChild('keywordFlags') ?? null
  };
}

/** Fills one dependency row through the complete accessor path retained for unsupported cases. */
function fillGenericTraceDeckBinaryDependencyRow(
  params: Pick<
    Parameters<typeof buildTraceDeckBinaryDependencyLineData>[0],
    'dependencyRefs' | 'traceLayout' | 'geometryContext' | 'endpointPages'
  > &
    TraceDeckBinaryDependencyRowTargets,
  geometry: {x1: number; y1: number; x2: number; y2: number},
  geometryContext: TraceLayoutGeometryDerivationContext,
  dependencyRef: SameProcessDependencyRef,
  index: number
): void {
  if (
    fillTraceLayoutSameProcessDependencyGeometry({
      traceLayout: params.traceLayout,
      dependencyRef,
      target: geometry,
      context: geometryContext
    })
  ) {
    writeTraceDeckBinaryDependencyGeometry(params, geometry, index);
  }
  if (!params.colors || params.opacityMultiplier == null) {
    return;
  }
  params.colors.set(
    applyTraceDependencyLineOpacity(
      getTraceRenderSameProcessDependencyLineColor(params.traceLayout, dependencyRef),
      params.opacityMultiplier,
      getTraceRenderDependencyVisibilityOptions(params.traceLayout, dependencyRef)
    ),
    index * 4
  );
}

/** Creates one reusable failed-fill endpoint target for the current dependency batch. */
function createTraceArrowPrimaryEndpointFields(): TraceArrowPrimaryEndpointFields {
  return {
    processRef: null,
    threadRef: null,
    laneIndex: -1,
    startTimeMs: 0,
    endTimeMs: 0,
    sourceEndTimeMs: 0
  };
}

/**
 * Resolves one generated-primary dependency segment from raw endpoint fields.
 *
 * A null result means the endpoint needs authored/manual semantics and must use the generic path;
 * false means supported generated semantics produced the same legacy zero segment.
 */
function fillGeneratedPrimarySameProcessDependencyGeometryFromFields(params: {
  /** Already-resolved primary source endpoint fields. */
  readonly startEndpoint: ResolvedTraceArrowPrimaryEndpointFields;
  /** Already-resolved primary target endpoint fields. */
  readonly endEndpoint: ResolvedTraceArrowPrimaryEndpointFields;
  /** Wait-mode discriminator used to choose endpoint timestamps. */
  readonly waitMode: 'end-to-start' | 'end-to-end' | 'start-to-start';
  /** Whether this edge uses parent-child start-to-start timing. */
  readonly isParentDependency: boolean;
  /** Ref-native owner layout lookup for endpoint Y resolution. */
  readonly layoutLookup: TraceLayoutGeometryDerivationContext['layoutLookup'];
  /** Same-process layout shared by both already-validated endpoint refs. */
  readonly processLayout?: ProcessLayout;
  /** Timeline origin subtracted from rendered X coordinates. */
  readonly minTimeMs: number;
  /** Caller-owned scalar geometry target. */
  readonly target: {x1: number; y1: number; x2: number; y2: number};
}): boolean | null {
  const startThreadLayout = params.layoutLookup.threadLayoutsByRef.get(
    params.startEndpoint.threadRef
  );
  const endThreadLayout = params.layoutLookup.threadLayoutsByRef.get(params.endEndpoint.threadRef);
  if (!startThreadLayout || !endThreadLayout) {
    return null;
  }
  if (
    startThreadLayout.manualContentHeight != null ||
    endThreadLayout.manualContentHeight != null
  ) {
    return null;
  }

  const isCollapsed = Boolean(params.processLayout?.isCollapsed);
  const startLaneIndex =
    params.startEndpoint.laneIndex < 0 && isCollapsed ? 0 : params.startEndpoint.laneIndex;
  const endLaneIndex =
    params.endEndpoint.laneIndex < 0 && isCollapsed ? 0 : params.endEndpoint.laneIndex;
  if (startLaneIndex < 0 || endLaneIndex < 0) {
    return clearTraceDeckBinaryDependencyGeometry(params.target);
  }

  const startY = resolveGeneratedPrimaryDependencyEndpointY(
    startThreadLayout,
    params.processLayout,
    startLaneIndex,
    isCollapsed
  );
  const endY = resolveGeneratedPrimaryDependencyEndpointY(
    endThreadLayout,
    params.processLayout,
    endLaneIndex,
    isCollapsed
  );
  if (startY == null || endY == null) {
    return clearTraceDeckBinaryDependencyGeometry(params.target);
  }

  const startTimeMs = params.isParentDependency
    ? params.startEndpoint.startTimeMs
    : params.waitMode === 'start-to-start'
      ? params.startEndpoint.startTimeMs
      : params.startEndpoint.endTimeMs;
  const endTimeMs =
    params.isParentDependency || params.waitMode === 'start-to-start'
      ? params.endEndpoint.startTimeMs
      : params.waitMode === 'end-to-end'
        ? params.endEndpoint.endTimeMs
        : params.endEndpoint.startTimeMs;
  params.target.x1 = startTimeMs - params.minTimeMs;
  params.target.y1 = startY;
  params.target.x2 = endTimeMs - params.minTimeMs;
  params.target.y2 = endY;
  return true;
}

/** Resolves one non-manual generated dependency endpoint Y with collapsed routing parity. */
function resolveGeneratedPrimaryDependencyEndpointY(
  threadLayout: ThreadLayout,
  processLayout: ProcessLayout | undefined,
  laneIndex: number,
  isCollapsedDependency: boolean
): number | undefined {
  if (threadLayout.visible) {
    const renderedLaneIndex =
      threadLayout.lanes?.laneYPositions.length && !threadLayout.lanes.visibleLaneIndices
        ? Math.min(laneIndex, threadLayout.lanes.laneYPositions.length - 1)
        : laneIndex;
    return getLaneYPosition(threadLayout, Math.max(0, renderedLaneIndex));
  }
  if (!isCollapsedDependency) {
    return undefined;
  }
  const collapsedActivityY = processLayout?.collapsedActivityY;
  return typeof collapsedActivityY === 'number' && Number.isFinite(collapsedActivityY)
    ? collapsedActivityY
    : undefined;
}

/** Clears one unsupported generated dependency target to the legacy zero tuple. */
function clearTraceDeckBinaryDependencyGeometry(target: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}): false {
  target.x1 = 0;
  target.y1 = 0;
  target.x2 = 0;
  target.y2 = 0;
  return false;
}

/** Writes one visible dependency segment into caller-owned endpoint buffers. */
function writeTraceDeckBinaryDependencyGeometry(
  targets: TraceDeckBinaryDependencyRowTargets,
  geometry: {x1: number; y1: number; x2: number; y2: number},
  index: number
): void {
  targets.sourcePositions[index * 3] = geometry.x1;
  targets.sourcePositions[index * 3 + 1] = geometry.y1;
  targets.sourcePositions[index * 3 + 2] = 0;
  targets.targetPositions[index * 3] = geometry.x2;
  targets.targetPositions[index * 3 + 1] = geometry.y2;
  targets.targetPositions[index * 3 + 2] = 0;
}

/** Writes one optional direct Arrow dependency color into caller-owned byte storage. */
function writeTraceDeckBinaryDependencyColor(
  targets: TraceDeckBinaryDependencyRowTargets,
  index: number,
  hasSubmitKeyword: boolean,
  isWarning: boolean
): void {
  if (!targets.colors || targets.opacityMultiplier == null) {
    return;
  }
  writeTraceDependencyLineColor(
    targets.colors,
    index * 4,
    isWarning
      ? TRACE_COLOR.WARNING_DEPENDENCY_LINE
      : hasSubmitKeyword
        ? TRACE_COLOR.SUBMIT_DEPENDENCY_LINE
        : TRACE_COLOR.DEPENDENCY_LINE,
    targets.opacityMultiplier,
    isWarning ? 1 : 0
  );
}

/**
 * Builds one tiny batch-local palette of already-composited dependency line colors.
 *
 * The trusted dense loop selects among these bytes instead of recomputing opacity and background
 * compositing for every canonical dependency row.
 */
function buildTraceDeckBinaryDependencyColorPalette(
  opacityMultiplier: number
): TraceDeckBinaryDependencyColorPalette {
  const values = new Uint8Array(12);
  writeTraceDependencyLineColor(values, 0, TRACE_COLOR.DEPENDENCY_LINE, opacityMultiplier, 0);
  writeTraceDependencyLineColor(
    values,
    4,
    TRACE_COLOR.SUBMIT_DEPENDENCY_LINE,
    opacityMultiplier,
    0
  );
  writeTraceDependencyLineColor(
    values,
    8,
    TRACE_COLOR.WARNING_DEPENDENCY_LINE,
    opacityMultiplier,
    1
  );
  return {values};
}

/**
 * Returns one build-local word view for aligned RGBA byte copies.
 *
 * Uint8 output buffers are freshly allocated and normally aligned, but the trusted loop keeps the
 * byte-copy fallback for any future sliced caller-owned view instead of assuming alignment.
 */
function getTraceDeckAlignedUint32View(values: Uint8Array): Uint32Array | null {
  return values.byteOffset % Uint32Array.BYTES_PER_ELEMENT === 0 &&
    values.byteLength % Uint32Array.BYTES_PER_ELEMENT === 0
    ? new Uint32Array(
        values.buffer,
        values.byteOffset,
        values.byteLength / Uint32Array.BYTES_PER_ELEMENT
      )
    : null;
}

/**
 * Resolves the base cross-process line color for one compact binary row.
 *
 * Straight binary lines preserve the existing hidden-endpoint styling by asking the same layout
 * visibility seam used by the object layer; ordinary visible rows use the canonical cross-process
 * line color without materializing a dependency object.
 */
function getTraceDeckCrossProcessDependencyLineColor(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: CrossProcessDependencyRef,
  geometryContext: TraceLayoutGeometryDerivationContext
): TraceDeckColor {
  const traceGraph = traceLayout.traceGraph;
  const startSpanRef = traceGraph.getDependencyStartSpan(dependencyRef);
  const endSpanRef = traceGraph.getDependencyEndSpan(dependencyRef);
  const startVisibility =
    startSpanRef == null
      ? undefined
      : getTraceLayoutSpanVisibility({
          traceLayout,
          spanRef: startSpanRef,
          context: geometryContext
        });
  const endVisibility =
    endSpanRef == null
      ? undefined
      : getTraceLayoutSpanVisibility({
          traceLayout,
          spanRef: endSpanRef,
          context: geometryContext
        });
  return startVisibility?.visible === false || endVisibility?.visible === false
    ? TRACE_COLOR.CROSS_PROCESS_DEPENDENCY_HIDDEN_ENDPOINT_LINE
    : TRACE_COLOR.CROSS_PROCESS_DEPENDENCY_LINE;
}

/**
 * Wraps one compact typed ref mapping as a random-access ref source for picking.
 *
 * The wrapper retains the caller-owned Float64 mapping by identity and never copies tagged safe
 * integers into a JavaScript array.
 */
function buildTraceDeckCrossProcessDependencyRefSource(
  dependencyRefs: Float64Array
): TraceRefSource<CrossProcessDependencyRef> {
  return Object.freeze({
    length: dependencyRefs.length,
    at(index: number): CrossProcessDependencyRef | undefined {
      if (!Number.isSafeInteger(index) || index < 0 || index >= dependencyRefs.length) {
        return undefined;
      }
      const dependencyRef = dependencyRefs[index];
      return Number.isSafeInteger(dependencyRef) && isCrossProcessDependencyRef(dependencyRef)
        ? dependencyRef
        : undefined;
    },
    *[Symbol.iterator](): Iterator<CrossProcessDependencyRef> {
      for (let index = 0; index < dependencyRefs.length; index += 1) {
        const dependencyRef = dependencyRefs[index];
        if (Number.isSafeInteger(dependencyRef) && isCrossProcessDependencyRef(dependencyRef)) {
          yield dependencyRef;
        }
      }
    }
  } satisfies TraceRefSource<CrossProcessDependencyRef>);
}

/** Returns the effective dependency opacity multiplier after path-only dimming. */
function getTraceDependencyOpacityMultiplier(settings: TraceVisSettings): number {
  const dependencyOpacity = Number.isFinite(settings.dependencyOpacity)
    ? settings.dependencyOpacity
    : 1;
  return clampUnitInterval(dependencyOpacity * (settings.showPathsOnly ? 0.2 : 1));
}

/** Folds dependency opacity into an opaque color composited over the trace background. */
function applyTraceDependencyLineOpacity(
  color: readonly [number, number, number, number],
  opacityMultiplier: number,
  options?: {minimumVisibility?: number}
): TraceDeckColor {
  const opacity = clampUnitInterval(opacityMultiplier);
  const visibility = Math.max(
    Math.sqrt(opacity),
    clampUnitInterval(options?.minimumVisibility ?? 0)
  );
  const alphaVisibility = (color[3] / 255) * visibility;
  return [
    compositeChannelOverTraceBackground(color[0], alphaVisibility),
    compositeChannelOverTraceBackground(color[1], alphaVisibility),
    compositeChannelOverTraceBackground(color[2], alphaVisibility),
    255
  ];
}

/** Writes one composited dependency line color directly into a caller-owned byte buffer. */
function writeTraceDependencyLineColor(
  target: Uint8Array,
  offset: number,
  color: readonly [number, number, number, number],
  opacityMultiplier: number,
  minimumVisibility: number
): void {
  const visibility = Math.max(
    Math.sqrt(clampUnitInterval(opacityMultiplier)),
    clampUnitInterval(minimumVisibility)
  );
  const alphaVisibility = (color[3] / 255) * visibility;
  target[offset] = compositeChannelOverTraceBackground(color[0], alphaVisibility);
  target[offset + 1] = compositeChannelOverTraceBackground(color[1], alphaVisibility);
  target[offset + 2] = compositeChannelOverTraceBackground(color[2], alphaVisibility);
  target[offset + 3] = 255;
}

/** Composites one foreground color channel over the white trace background. */
function compositeChannelOverTraceBackground(foregroundChannel: number, alpha: number): number {
  return Math.round(foregroundChannel * alpha + 255 * (1 - alpha));
}

/** Clamps a finite number into the inclusive unit interval. */
function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

/** Returns dependency visibility overrides for warning-level same-process dependencies. */
function getTraceRenderDependencyVisibilityOptions(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: SameProcessDependencyRef
): {minimumVisibility?: number} | undefined {
  return shouldShowSameProcessDependencyByModeFields(
    'warnings',
    traceLayout.traceGraph.getDependencyHasKeyword(dependencyRef, 'SUBMIT'),
    traceLayout.traceGraph.getDependencyWaitTimeMs(dependencyRef) ?? 0
  )
    ? {minimumVisibility: 1}
    : undefined;
}

/** Resolves the base same-process-dependency line color before opacity compositing. */
function getTraceRenderSameProcessDependencyLineColor(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: SameProcessDependencyRef
): TraceDeckColor {
  if (
    shouldShowSameProcessDependencyByModeFields(
      'warnings',
      traceLayout.traceGraph.getDependencyHasKeyword(dependencyRef, 'SUBMIT'),
      traceLayout.traceGraph.getDependencyWaitTimeMs(dependencyRef) ?? 0
    )
  ) {
    return TRACE_COLOR.WARNING_DEPENDENCY_LINE;
  }
  if (traceLayout.traceGraph.getDependencyHasKeyword(dependencyRef, 'SUBMIT')) {
    return TRACE_COLOR.SUBMIT_DEPENDENCY_LINE;
  }
  return TRACE_COLOR.DEPENDENCY_LINE;
}

/** Returns one Arrow numeric ref cell as a JavaScript safe integer. */
function normalizeArrowRefNumber(value: unknown): number | null {
  const numberValue =
    typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : null;
  return numberValue != null && Number.isSafeInteger(numberValue) ? numberValue : null;
}

/** Returns one Arrow numeric cell as a finite JavaScript number. */
function normalizeArrowNumber(value: unknown): number | null {
  const numberValue =
    typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : null;
  return numberValue != null && Number.isFinite(numberValue) ? numberValue : null;
}
