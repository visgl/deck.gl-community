import {
  forwardRef,
  ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react';
import {DeckWidgetTheme} from '@deck.gl/widgets';
import {Matrix4} from '@math.gl/core';
import {h} from 'preact';
import {boundsAreEqual, formatTimeMs, makeLayerFilter} from '@deck.gl-community/infovis-layers';

import {
  CommandDocumentationPanel,
  commandManager,
  DEFAULT_SHORTCUTS,
  DocumentationLinksPanel,
  formatShortcutKeyHTML,
  KeyboardShortcutsPanel,
  TabbedPanel,
  URLParametersPanel
} from '@deck.gl-community/panels';
import {
  CommandToggleWidget,
  createStudioSettingsWidget,
  ModalPanelWidget,
  OmniBoxWidget,
  ToastWidget
} from '@deck.gl-community/widgets';
import {getTraceBounds, getVerticalBounds, imperativeDeckController} from '../../../layers/index';
import {
  buildDeckBackgroundLayersForTrace,
  buildDeckLayerForCriticalPath,
  buildDeckLayerForTraceProcessActivitySummary,
  buildDeckLayersForGrid,
  buildDeckLayersForInstantsAndCounter,
  buildDeckLayersForLegend,
  buildDeckLayersForMinimapSpanIndicators,
  buildDeckLayersForTrace,
  buildOverviewLayers
} from '../../../layers/layers/deck-layers';
import {
  buildTraceFilterSummary,
  buildTracePreparedOverviewViewModel,
  buildTraceSelectedCrossDependencySources,
  buildTraceSelectedLocalDependencySourcesByProcessId,
  buildTraceSelectionPreparedScene,
  computeTracePathHighlighting,
  createTraceComparisonModelMatrix,
  createTraceSpanNameSearchPredicate,
  formatTS,
  getTraceSelectedSpanFromRef,
  getTraceSelectedSpanFromRenderSpan,
  hasTraceFilteredItems,
  resolveTraceProcessRefTarget,
  resolveTraceThreadRefTarget,
  TRACE_COLOR,
  TRACE_SPAN_FILTER_MASK_NONE,
  TraceEngine,
  truncateMiddle
} from '../../../trace/index';
import {getHeapUsageProbeFields, log as traceLog} from '../../../trace/log';
import {getTraceSpanBadgePresentation} from '../../utils/trace-span-badge-presentation';
import {getTraceSpanBadgeStyle} from '../../utils/trace-span-badge-style';
import {CopyShortcutHint} from '../copy-shortcut-hint';
import {isTraceRenderSpanObject, resolveDeckTraceGraphHoverPayload} from './deck-trace-graph-hover';
import {formatRelativeTimeAxisDuration} from './deck-trace-graph-time-format';
import {DeckWithManagedViews, DeckWithManagedViewsRef} from './deck-with-managed-views';
import {useTimeMeasure} from './hooks/use-time-measure';
import {TRACE_HOVER_POPUP_WIDGET_ID, TraceHoverPopupWidget} from './trace-hover-popup-widget';
import {
  findTraceLayoutRankLabelAnchor,
  findTraceLayoutSpanGeometry,
  findTraceLayoutThreadLabelAnchor,
  getTraceLayoutSpanAnchorDeltaY,
  resolvePendingTraceLayoutAnchor
} from './trace-layout-anchors';
import {TraceTooltip} from './trace-tooltip';

import type {
  DocumentationLinkItem,
  KeyboardShortcut,
  URLParameter
} from '@deck.gl-community/panels';
import type {SettingsSchema, SettingsState} from '@deck.gl-community/panels';
import type {SettingsChangeDescriptor} from '@deck.gl-community/panels';
import type {OmniBoxOption, OmniBoxResultsSummaryArgs} from '@deck.gl-community/widgets';
import type {
  ProcessRef,
  SpanRef,
  ThreadRef,
  TraceColorScheme,
  TraceCrossDependencySource,
  TraceDependencyRenderSource,
  TraceEngineDiagnostics,
  TraceEvent,
  TraceFilterSummary,
  TraceGraph,
  TraceGraphSpanFilterReason,
  TraceLayout,
  TraceLayoutBounds,
  TraceLocalDependencySource,
  TraceObject,
  TracePreparedGraphScene,
  TracePreparedOverviewViewModel,
  TracePreparedScene,
  TraceProcessInfo,
  TraceProcessInfoObject,
  TraceRenderSpan,
  TraceSelectedCrossDependencySources,
  TraceSelectedLocalDependencySourcesByProcessId,
  TraceSelectedSpan,
  TraceSelectionPreparedScene,
  TraceSpan,
  TraceSpanFilterMask,
  TraceSpanId,
  TraceStyle,
  TraceThreadId,
  TraceVisSettings,
  VisibleCrossDependencyRef,
  VisibleLocalDependencyRef
} from '../../../trace/index';
import type {TraceSpanCardTabOptions} from './cards/trace-span-card';
import type {DeckWithManagedViewsAnchorTransition} from './deck-with-managed-views';
import type {PendingTraceLayoutAnchor} from './trace-layout-anchors';
import type {TraceEventCardRenderer} from './trace-tooltip';
import type {DeckProps, PickingInfo, Widget} from '@deck.gl/core';
import type {Bounds, LayerFilter} from '@deck.gl-community/infovis-layers';
import type {Tick} from '@deck.gl-community/timeline-layers';

export type {TraceSelectedSpan} from '../../../trace/index';

const OMNIBOX_DESCRIPTION_NAME_MAX_LENGTH = 28;
const OMNIBOX_BADGE_NAME_MAX_LENGTH = 32;
const OMNIBOX_FALLBACK_BADGE_COLOR = 'rgba(71, 85, 105, 0.92)';
const OMNIBOX_SEARCH_PLACEHOLDER = 'type to search, use /.../ for regex or > for commands';
const OMNIBOX_QUERY_HISTORY_STORAGE_KEY = 'tracevis.deck-trace-graph.omnibox.query-history';
const OMNIBOX_SPAN_SEARCH_LIMIT = 200;
const OMNIBOX_EXTERNAL_SEARCH_LIMIT = 50;
const RUN_EVENT_VIEW_Y_POSITION = -15;
const EMPTY_SELECTED_SPAN_REFS: readonly SpanRef[] = [];
const EMPTY_SELECTED_LOCAL_DEPENDENCIES: readonly TraceLocalDependencySource[] = [];
const EMPTY_SELECTED_CROSS_DEPENDENCIES: readonly TraceCrossDependencySource[] = [];
const EMPTY_SELECTED_LOCAL_DEPENDENCY_REFS: readonly VisibleLocalDependencyRef[] = [];
const EMPTY_SELECTED_CROSS_DEPENDENCY_REFS: readonly VisibleCrossDependencyRef[] = [];
const EMPTY_SELECTED_LOCAL_DEPENDENCY_SOURCES_BY_PROCESS_ID: TraceSelectedLocalDependencySourcesByProcessId =
  {};
const EMPTY_SELECTED_CROSS_DEPENDENCY_SOURCES: TraceSelectedCrossDependencySources = [];
/** Emits a level-0 probe for selection interactions in DeckTraceGraph. */
function logDeckTraceSelectionProbe(
  label: string,
  metadata: Readonly<Record<string, unknown>>
): void {
  traceLog.probe(0, label, {
    ...metadata,
    ...getHeapUsageProbeFields()
  })();
}

/** Returns true when a hover payload carries process-info tooltip data. */
function isTraceProcessInfoObject(value: unknown): value is TraceProcessInfoObject {
  return (
    value != null &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'trace-process-info'
  );
}

/** Returns true when a deck picking payload can be inspected with property guards. */
function isDeckPickingObject(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === 'object';
}

/** Unwraps built-in and app-owned deck.gl picking payloads into Tracevis objects. */
function resolveDeckTraceGraphPickedObject(
  object: unknown,
  resolvePickedTraceObjectFromHost?: DeckTraceGraphPickedObjectResolver
): DeckTraceGraphPickedObject | null {
  if (typeof object === 'number') {
    return object as SpanRef;
  }
  if (!isDeckPickingObject(object)) {
    return null;
  }
  const objectType = object.type;
  if (typeof objectType === 'string' && objectType.startsWith('trace-')) {
    return object as DeckTraceGraphPickedObject;
  }
  if (isTraceRenderSpanObject(object)) {
    return object;
  }
  if ('block' in object) {
    const block = resolveDeckTraceGraphPickedObject(object.block, resolvePickedTraceObjectFromHost);
    if (block !== null) {
      return block;
    }
  }
  if ('blockSource' in object) {
    const blockSource = object.blockSource;
    if (isDeckPickingObject(blockSource)) {
      const span = resolveDeckTraceGraphPickedObject(
        blockSource.span,
        resolvePickedTraceObjectFromHost
      );
      if (span !== null) {
        return span;
      }
    }
  }
  const hostPickedObject = resolvePickedTraceObjectFromHost?.(object);
  return hostPickedObject != null && hostPickedObject !== object
    ? resolveDeckTraceGraphPickedObject(hostPickedObject, resolvePickedTraceObjectFromHost)
    : null;
}

type DeckTraceRendererProps = {
  /** Imperative deck ref owned by the container. */
  deckRef: React.Ref<DeckWithManagedViewsRef>;
  /** Bounds used to fit the main trace viewport. */
  bounds: Bounds;
  /** Prepared minimap view model used by the overview viewport and controls. */
  overviewViewModel: TracePreparedOverviewViewModel;
  /** Static/background rank layers assembled by the container. */
  traceBackgroundLayers: DeckProps['layers'];
  /** Shared time grid layers assembled by the container. */
  gridLayers: DeckProps['layers'];
  /** Rank/process legend layers assembled by the container. */
  legendLayers: DeckProps['layers'];
  /** Interactive time-measure overlay layers assembled by the container. */
  timeMeasureLayers: DeckProps['layers'];
  /** Prepared overview trace scenes rendered by this renderer. */
  overviewScenes: readonly TracePreparedGraphScene[];
  /** Prepared foreground trace scenes rendered by this renderer. */
  foregroundScenes: readonly TracePreparedGraphScene[];
  /** Instant and counter layers assembled by the container. */
  instantAndCounterLayers: DeckProps['layers'];
  /** Critical-path overlay layers assembled by the container. */
  criticalPathLayers: DeckProps['layers'];
  /** Overview control/marker layers assembled by the container. */
  overviewLayers: DeckProps['layers'] | null;
  /** Layer-filter callback passed directly to deck.gl. */
  layerFilter: DeckProps['layerFilter'];
  /** Optional deck widget theme override. */
  deckTheme?: DeckWidgetTheme;
  /** Deck widgets assembled by the container. */
  widgets: Widget[];
  /** Whether to render the main timeline's vertical scrollbar widget. */
  showMainVerticalScrollbar?: boolean;
  /** Whether to render Tracevis-owned default widgets. Defaults to false. */
  showDefaultWidgets?: boolean;
  /** Whether to collect app-owned luma timestamp queries for Deck GPU timing stats. */
  enableDeckGpuTimeStats?: boolean;
  /** Optional one-shot Y correction for preserving a span across trace layout transitions. */
  viewAnchorTransition?: DeckWithManagedViewsAnchorTransition | null;
  /** Whether to render dashed process row separator lines in foreground trace layers. */
  showRowSeparators: boolean;
  /** Hover callback passed directly to deck.gl. */
  onHover: DeckProps['onHover'];
  /** Click callback passed directly to deck.gl. */
  onClick: DeckProps['onClick'];
  /** Whether the overview/minimap view should be enabled. */
  isOverviewEnabled: boolean;
  /** Whether to reserve the fixed run-event strip below the header. */
  isRunEventViewEnabled: boolean;
  /** Whether to collapse the thread legend while preserving process labels as a timeline overlay. */
  collapseLegendToProcessLabelOverlay: boolean;
  /** Optional active interaction mode that changes deck interaction behavior. */
  interactionMode: 'measure-time' | null;
  /** Trace visualization settings shared by the trace deck layers. */
  settings: TraceVisSettings;
  /** Currently hovered block selection used by trace foreground layers. */
  hoveredSpan: {rankIndex: number; block?: TraceRenderSpan} | null;
  /** Span refs rendered by selected-span overlay foreground layers. */
  selectedSpanRefs: readonly SpanRef[];
  /** Currently selected local dependencies resolved from direct click or extended selection. */
  selectedDependencies: readonly TraceLocalDependencySource[];
  /** Currently selected cross dependencies resolved from direct click or extended selection. */
  selectedCrossDependencies: readonly TraceCrossDependencySource[];
  /** Currently selected local-dependency sources grouped by process id. */
  selectedLocalDependencySourcesByProcessId: TraceSelectedLocalDependencySourcesByProcessId;
  /** Currently selected cross-dependency sources, when one ref-native selection is active. */
  selectedCrossDependencySources?: TraceSelectedCrossDependencySources;
  /** Click callback used by trace foreground span/dependency layers. */
  onSpanClick: (info: PickingInfo, event?: {srcEvent?: {shiftKey?: boolean}}) => boolean;
  /** Callback used by trace foreground process-label affordances. */
  onToggleProcess: (processId: string, processRef: ProcessRef, graphIndex: number) => void;
  /** Callback used by overview process activity affordances. */
  onExpandProcess: (processId: string, processRef: ProcessRef, graphIndex: number) => void;
  /** Trace color scheme shared by the trace deck layers. */
  colorScheme: TraceColorScheme;
  /** CSS font stack used by deck text layers. */
  fontFamily: string;
  /** Effective highlight set shared by the trace foreground layers. */
  highlightedSpanRefs: ReadonlySet<SpanRef> | undefined;
};

/** Normalized hover-popup state projected through the shared deck.gl popup widget. */
type DeckTraceHoverPopupState = {
  /** Deck view id used to project the popup anchor inside multi-view trace layouts. */
  readonly viewId: string;
  /** Deck/world coordinates used as the popup anchor. */
  readonly position: [number, number];
  /** Trace object rendered through the shared tooltip surface when present. */
  readonly object: TraceDependencyRenderSource | TraceObject | TraceRenderSpan | null;
  /** Custom React content rendered for non-trace hover targets. */
  readonly content: ReactNode | null;
  /** Whether the popup should show the copy shortcut affordance. */
  readonly isCopyable: boolean;
};

/** Overview marker rendered in the minimap with optional custom tooltip content. */
export type DeckTraceGraphOverviewMarker = {
  /** Stable marker id used for deck.gl diffing. */
  id: string;
  /** Absolute timestamp in milliseconds for the source event. */
  timeMs: number;
  /** Optional app-owned label associated with selecting this overview event marker. */
  label?: string;
  /** Optional radius multiplier applied to the minimap marker size. */
  radiusScale?: number;
  /** Optional RGBA fill color override for the minimap event marker. */
  fillColor?: readonly [number, number, number, number];
  /** Optional RGBA stroke color override for the minimap event marker. */
  lineColor?: readonly [number, number, number, number];
  /** Optional custom tooltip content shown while hovering the minimap marker. */
  tooltip?: ReactNode | null;
};

/** Absolute time range used to override minimap context. */
export type DeckTraceGraphTimeRange = {
  /** Inclusive absolute start timestamp in milliseconds. */
  readonly startTimeMs?: number;
  /** Inclusive absolute end timestamp in milliseconds. */
  readonly endTimeMs?: number;
};

const KEYBOARD_NAV_HORIZONTAL_PAN_PX = 20;
const KEYBOARD_NAV_VERTICAL_PAN_PX = 20;
const KEYBOARD_NAV_FAST_VERTICAL_PAN_PX = 150;
const KEYBOARD_NAV_X_ZOOM_DELTA = 0.125;
const KEYBOARD_NAV_TRANSITION_DURATION_MS = 75;
const MINIMAP_ACTIVITY_TOP_RESERVED_FRACTION = 0.26;
const TRACEVIS_TOGGLE_OVERVIEW_COMMAND_ID = 'trace.toggle-overview-minimap';
const DEFAULT_CONTROL_WIDGET_PLACEMENT = 'top-left';
const OVERVIEW_TOGGLE_ICON =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="-4 -4 32 32" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ><path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"></path><rect width="10" height="7" x="12" y="13" rx="2"></rect></svg>';

/** Deck placement supported by Tracevis built-in control widgets. */
export type DeckTraceGraphControlWidgetPlacement = 'top-left' | 'top-right';

export type DeckTraceGraphSettingsWidgetConfig = {
  /** Local-storage-backed settings rendered in the settings widget. */
  applicationSchema?: SettingsSchema;
  /** URL-shareable settings rendered in the settings widget. */
  visualizationSchema?: SettingsSchema;
  /** Whether DeckTraceGraph should render the Studio settings widget from this config. */
  showStudioSettingsWidget?: boolean;
  /** Optional Studio settings widget placement override. */
  placement?: DeckTraceGraphControlWidgetPlacement;
  settings: SettingsState;
  onSettingsChange?: (
    settings: SettingsState,
    changedSettings?: SettingsChangeDescriptor[]
  ) => void;
  label?: string;
};

/** App-provided help link rendered in the trace graph help modal. */
export type DeckTraceGraphHelpLink = DocumentationLinkItem;

/** App-owned hidden result returned by an external Omnibox search provider. */
export type DeckTraceGraphExternalOmniBoxResult = {
  /** Stable app-owned result id, unique for one query response. */
  readonly id: string;
  /** Primary result text rendered by the Omnibox. */
  readonly label: string;
  /** Secondary result text rendered by the Omnibox. */
  readonly description?: string;
  /** Compact hidden-result reason label, for example "Hidden by: time window". */
  readonly reasonLabel: string;
  /** App-owned select callback fired when the result is chosen. */
  readonly onSelect: () => void;
};

/** App-owned provider for hidden Omnibox results outside the visible TraceGraph. */
export type DeckTraceGraphExternalOmniBoxSearchProvider = (params: {
  /** Raw non-empty query entered in the Omnibox. */
  readonly query: string;
  /** Shared Tracevis predicate used to match candidate search text. */
  readonly matchesQuery: (searchText: string) => boolean;
  /** Maximum external result count requested by Tracevis. */
  readonly limit: number;
}) => readonly DeckTraceGraphExternalOmniBoxResult[];

/** Carries block-identifying data for Omnibox options. */
type OmniBoxBlockOptionData = {
  /** Distinguishes built-in graph results from app-owned external results. */
  readonly kind: 'span';
  /** Identifies the block selected from the Omnibox. */
  readonly spanId: TraceSpanId;
  /** Canonical span ref for the span matched by the Omnibox query. */
  readonly spanRef: SpanRef;
  /** Preserves filter provenance for filtered-result copy and badge treatment. */
  readonly filterMask: TraceSpanFilterMask;
  /** Preserves full filter/window state for result copy and badge treatment. */
  readonly filterReason: TraceGraphSpanFilterReason;
};

/** Carries app-owned hidden-result data for Omnibox options. */
type OmniBoxExternalOptionData = {
  /** Distinguishes app-owned external results from built-in graph results. */
  readonly kind: 'external';
  /** App-owned hidden search result payload. */
  readonly result: DeckTraceGraphExternalOmniBoxResult;
};

type OmniBoxOptionData = OmniBoxBlockOptionData | OmniBoxExternalOptionData;

/** Counts built-in span results in a mixed Omnibox option list. */
function getOmniBoxSpanResultCount(options: readonly OmniBoxOption[]): number {
  let spanResultCount = 0;
  for (const option of options) {
    const optionData = option.data as OmniBoxOptionData | undefined;
    if (optionData?.kind === 'span') {
      spanResultCount += 1;
    }
  }
  return spanResultCount;
}

/** Builds compact status text for one store-backed span search result. */
function getOmniBoxSpanSearchStatusLabel(params: {
  /** Full active filter/window reason for the matched span. */
  readonly filterReason: TraceGraphSpanFilterReason;
  /** Filter-only status label derived from the span badge helper. */
  readonly filterStatusLabel: string | null;
}): string | null {
  if (params.filterReason.state === 'outside-window') {
    const filterReason =
      params.filterStatusLabel?.startsWith('Hidden by: ') === true
        ? params.filterStatusLabel.slice('Hidden by: '.length)
        : params.filterStatusLabel;
    return filterReason ? `Hidden by: time window, ${filterReason}` : 'Hidden by: time window';
  }
  if (params.filterReason.state === 'not-loaded') {
    return params.filterStatusLabel ? `Not loaded · ${params.filterStatusLabel}` : 'Not loaded';
  }
  if (params.filterReason.state === 'unknown') {
    return params.filterStatusLabel ? `Hidden span · ${params.filterStatusLabel}` : 'Hidden span';
  }
  return params.filterStatusLabel;
}

/**
 * Returns a trace-family identity for deciding when a mounted graph should receive a fresh initial
 * viewport fit.
 *
 * The key intentionally ignores process count and max time so streaming/rank-append updates keep
 * the user's current viewport, while replacing the loaded trace can reset the view.
 */
function getInitialViewportFitKey(traceGraphs: readonly TraceGraph[]): string {
  return traceGraphs
    .map(traceGraph => `${traceGraph.name}\u0000${traceGraph.minTimeMs}`)
    .join('\u0001');
}

/** Returns a model matrix that fits minimap activity below the reserved time-axis band. */
function createMinimapActivityModelMatrix(
  bounds: Bounds | TraceLayoutBounds,
  modelMatrix?: Matrix4
): Matrix4 {
  const minY = bounds[0][1];
  const maxY = bounds[1][1];
  const height = maxY - minY;
  const activityScaleY = 1 - MINIMAP_ACTIVITY_TOP_RESERVED_FRACTION;
  const activityTopY = minY + height * MINIMAP_ACTIVITY_TOP_RESERVED_FRACTION;
  const activityTranslateY = activityTopY - minY * activityScaleY;
  const matrix = modelMatrix ? new Matrix4(modelMatrix) : new Matrix4().identity();
  matrix.translate([0, activityTranslateY, 0]);
  matrix.scale([1, activityScaleY, 1]);
  return matrix;
}

/**
 * Returns whether a tooltip payload has copyable trace span or trace object metadata.
 */
function isTraceTooltipCopyableObject(
  object: TraceDependencyRenderSource | TraceObject | TraceRenderSpan | null
): boolean {
  if (!object) {
    return false;
  }
  return (
    isTraceRenderSpanObject(object) ||
    ('type' in object && typeof object.type === 'string' && object.type.startsWith('trace-'))
  );
}

/**
 * Resolves one stable popup anchor from the hovered deck picking payload near the pointer location.
 */
function resolveTraceHoverPopupAnchor(
  pickInfo: Pick<PickingInfo, 'coordinate' | 'viewport' | 'x' | 'y'>,
  modelMatrix?: Matrix4
): {viewId: string; position: [number, number]} | null {
  const viewId = pickInfo.viewport?.id;
  if (typeof viewId !== 'string' || viewId.length === 0) {
    return null;
  }

  const directCoordinate = getFinitePopupCoordinate(pickInfo.coordinate);
  if (directCoordinate && modelMatrix) {
    return {
      viewId,
      position: transformTraceHoverPopupCoordinate(directCoordinate, modelMatrix)
    };
  }

  const hoveredX = pickInfo.x;
  const hoveredY = pickInfo.y;
  if (Number.isFinite(hoveredX) && Number.isFinite(hoveredY)) {
    // Anchor from the hovered pointer position first so the popup arrow follows the cursor
    // instead of snapping to object-center coordinates when deck provides both.
    const unprojectedCoordinate = getFinitePopupCoordinate(
      pickInfo.viewport?.unproject?.([hoveredX, hoveredY]) as number[] | null | undefined
    );
    if (unprojectedCoordinate) {
      return {
        viewId,
        position: unprojectedCoordinate
      };
    }
  }

  if (directCoordinate) {
    return {
      viewId,
      position: directCoordinate
    };
  }

  return null;
}

/**
 * Applies a graph comparison transform to a popup anchor while preserving PopupWidget's world-space
 * positioning contract.
 */
function transformTraceHoverPopupCoordinate(
  coordinate: [number, number],
  modelMatrix: Matrix4
): [number, number] {
  const transformed = modelMatrix.transformAsPoint([coordinate[0], coordinate[1], 0]);
  return [
    Number.isFinite(transformed[0]) ? transformed[0] : coordinate[0],
    Number.isFinite(transformed[1]) ? transformed[1] : coordinate[1]
  ];
}

/**
 * Returns whether the current deck click event should be treated as a double click.
 */
function isDeckDoubleClick(
  event:
    | {
        tapCount?: number;
        srcEvent?: {
          detail?: number;
        };
      }
    | null
    | undefined
): boolean {
  return (event?.tapCount ?? 0) >= 2 || (event?.srcEvent?.detail ?? 0) >= 2;
}

/**
 * Returns whether a deck pointer event should trigger primary-button selection behavior.
 */
function isPrimarySelectionButton(
  event:
    | {
        srcEvent?: {
          button?: number;
        };
      }
    | null
    | undefined
): boolean {
  const button = event?.srcEvent?.button;
  return button == null || button === 0;
}

/**
 * Returns whether a deck picking result targets the process label/caret layer.
 */
function isRankLabelPick(info: Pick<PickingInfo, 'layer'>): boolean {
  const layerId = info.layer?.id ?? '';
  return layerId.includes('legend-rank-label');
}

/**
 * Returns whether a deck picking result targets the process info node-name layer.
 */
function isRankNodeNamePick(info: Pick<PickingInfo, 'layer'>): boolean {
  const layerId = info.layer?.id ?? '';
  return layerId.includes('legend-rank-node-name');
}

/**
 * Returns whether a deck picking result targets any process metadata label layer.
 */
function isRankMetadataLabelPick(info: Pick<PickingInfo, 'layer'>): boolean {
  return isRankLabelPick(info) || isRankNodeNamePick(info);
}

/**
 * Resolves the compared-graph index encoded in prefixed deck layer ids.
 */
function getPickedGraphIndex(info: Pick<PickingInfo, 'layer'>): number | undefined {
  const layerId = info.layer?.id ?? '';
  const match = /^(?:minimap-)?trace-graph-(\d+)-/.exec(layerId);
  return match?.[1] == null ? undefined : Number(match[1]);
}

/**
 * Resolves the process id carried by a picked process-label row.
 */
function getPickedRankId(object: unknown): string | null {
  if (!object || typeof object !== 'object') {
    return null;
  }

  const directRankId = (object as {processId?: unknown}).processId;
  if (typeof directRankId === 'string' && directRankId.length > 0) {
    return directRankId;
  }

  const nestedObject = (object as {object?: unknown}).object;
  if (nestedObject && nestedObject !== object) {
    return getPickedRankId(nestedObject);
  }

  return null;
}

/** Returns one finite XY coordinate pair when the provided deck coordinate is usable as a popup anchor. */
function getFinitePopupCoordinate(
  coordinate: number[] | null | undefined
): [number, number] | null {
  if (!coordinate || coordinate.length < 2) {
    return null;
  }

  const x = coordinate[0];
  const y = coordinate[1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return [x, y];
}

/**
 * Resolves the process ref carried by a picked process-label row.
 */
function getPickedProcessRef(object: unknown): ProcessRef | null {
  if (!object || typeof object !== 'object') {
    return null;
  }

  const directProcessRef = (object as {processRef?: unknown}).processRef;
  if (typeof directProcessRef === 'number') {
    return directProcessRef as ProcessRef;
  }

  const nestedObject = (object as {object?: unknown}).object;
  if (nestedObject && nestedObject !== object) {
    return getPickedProcessRef(nestedObject);
  }

  return null;
}

/**
 * Returns whether two arrays contain the same values in the same order.
 */
function areArraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

/** Tracevis object returned after unwrapping a custom deck.gl picking payload. */
export type DeckTraceGraphPickedObject =
  | SpanRef
  | TraceDependencyRenderSource
  | TraceObject
  | TraceRenderSpan;

/** App-owned adapter that unwraps custom deck.gl picking payloads into Tracevis objects. */
export type DeckTraceGraphPickedObjectResolver = (
  object: unknown
) => DeckTraceGraphPickedObject | null | undefined;

/** App-owned renderer for graph-global trace-event tooltip cards. */
export type DeckTraceGraphTraceEventCardRenderer = TraceEventCardRenderer;

/** Viewer configuration layered around the mounted TraceEngine. */
export type DeckTraceGraphConfig = {
  /** Whether to append graph names to rank labels when multiple graphs are rendered. */
  readonly showGraphNames?: boolean;
  /** Whether to render dashed process row separator lines. */
  readonly showRowSeparators?: boolean;
  /** Extra per-process information keyed by trace process id. */
  readonly processInfoMap?: Record<string, TraceProcessInfo>;
  /** Optional tab and dependency-display overrides for TraceSpanCard surfaces. */
  readonly traceSpanCardOptions?: TraceSpanCardTabOptions;
  /** Optional app-owned adapter for custom deck.gl picking payload wrappers. */
  readonly resolvePickedTraceObject?: DeckTraceGraphPickedObjectResolver;
  /** Optional app-owned renderer for graph-global trace-event tooltip cards. */
  readonly renderTraceEventCard?: DeckTraceGraphTraceEventCardRenderer;
  /** Callback fired when a process-info node label was clicked. */
  readonly onProcessInfoClick?: (processId: string, processInfo?: TraceProcessInfo) => void;
  /** Callback fired with an on-demand expensive Tracevis-owned memory report provider. */
  readonly onTraceMemoryReportProviderChange?: (
    provider: (() => DeckTraceGraphMemoryReport) | null
  ) => void;
  /** Callback fired with an on-demand visible-versus-total trace entity summary provider. */
  readonly onTraceFilterSummaryProviderChange?: (
    provider: DeckTraceGraphFilterSummaryProvider | null
  ) => void;
  /** Callback fired while the interactive time-range selection changes. */
  readonly onTimeRangeSelectionChange?: (
    timeRange: {
      /** Absolute selected time-range start. */
      startTimeMs: number;
      /** Absolute selected time-range end. */
      endTimeMs: number;
    } | null
  ) => void;
  /** Callback that customizes tooltip React content. */
  readonly getTooltipReact?: (
    pickInfo: PickingInfo<TraceObject>,
    spanMap: Record<string, TraceSpan>
  ) => ReactNode | null;
  /** Callback that serializes picked Tracevis objects for JSON inspection. */
  readonly getJSONForTraceObject?: (object?: TraceObject) => Record<string, unknown>;
  /** Optional keyboard shortcuts rendered in the deck widget panel. */
  readonly keyboardShortcuts?: KeyboardShortcut[];
  /** Optional documentation/resource links rendered in the deck help modal. */
  readonly helpLinks?: readonly DeckTraceGraphHelpLink[];
  /** Optional app-owned search provider for hidden results outside the visible TraceGraph. */
  readonly externalOmniBoxSearchProvider?: DeckTraceGraphExternalOmniBoxSearchProvider;
  /** Optional URL-parameter descriptors rendered in the deck help modal. */
  readonly urlParameters?: readonly URLParameter[];
  /** Optional dat.gui-like visualization settings widget. */
  readonly settingsConfig?: DeckTraceGraphSettingsWidgetConfig;
  /** Placement for built-in control widgets such as help, settings, and overview toggle. */
  readonly controlWidgetPlacement?: DeckTraceGraphControlWidgetPlacement;
  /** Theme overrides passed to deck widget container. */
  readonly deckWidgetTheme?: DeckWidgetTheme;
  /** Optional minimap markers rendered at absolute event timestamps. */
  readonly overviewEventMarkers?: ReadonlyArray<DeckTraceGraphOverviewMarker>;
  /** Optional absolute time range used to fit the minimap independently of the main trace. */
  readonly overviewTimeRange?: DeckTraceGraphTimeRange;
  /** Optional absolute time range describing data currently loaded into the minimap. */
  readonly overviewLoadedTimeRange?: DeckTraceGraphTimeRange;
  /** Optional callback fired when a minimap marker is double-clicked. */
  readonly onOverviewMarkerDoubleClick?: (marker: DeckTraceGraphOverviewMarker) => void;
  /** Optional callback fired when a shared trace event is double-clicked. */
  readonly onTraceEventDoubleClick?: (event: TraceEvent) => void;
  /** Optional caller-owned deck widgets rendered in the trace deck. */
  readonly widgets?: Widget[];
  /** Whether to render Tracevis-owned default widgets. */
  readonly showDefaultWidgets?: boolean;
  /** Whether to show the vertical scrollbar around the main timeline view. */
  readonly showMainVerticalScrollbar?: boolean;
};

/** React adapter props around one mounted TraceEngine. */
export type DeckTraceGraphProps = {
  /** Mounted mutable trace engine that owns viewer interaction and prepared scene state. */
  readonly engine: TraceEngine;
  /** CSS classnames for the deck component. */
  readonly className?: string;
  /** Viewer configuration layered around the mounted engine. */
  readonly reactConfig?: DeckTraceGraphConfig;
};

/** On-demand retained-size report for Tracevis-owned DeckTraceGraph data. */
export type DeckTraceGraphMemoryReport = {
  /** Cheap retained-state and build diagnostics for the mounted TraceEngine. */
  traceEngineDiagnostics: TraceEngineDiagnostics;
};

/** On-demand visible-versus-total trace entity diagnostics registered with host shells. */
export type DeckTraceGraphFilterSummaryProvider = {
  /** Whether current displayed graphs already know that at least one item is filtered out. */
  readonly hasFilteredItems: boolean;
  /** Builds the full visible-versus-total entity count summary on demand. */
  readonly buildTraceFilterSummary: () => TraceFilterSummary;
};

export type DeckTraceGraphHandle = {
  /** Pans the viewport toward earlier times. */
  panLeft: () => void;
  /** Pans the viewport toward later times. */
  panRight: () => void;
  /** Pans the viewport upward. */
  panUp: () => void;
  /** Pans the viewport downward. */
  panDown: () => void;
  /** Pans the viewport upward by the fast keyboard navigation step. */
  panUpFast: () => void;
  /** Pans the viewport downward by the fast keyboard navigation step. */
  panDownFast: () => void;
  /** Zooms the viewport in along the horizontal axis. */
  zoomInHorizontal: () => void;
  /** Zooms the viewport out along the horizontal axis. */
  zoomOutHorizontal: () => void;
  /** Zooms the viewport to the requested span ref. */
  zoomToSpanRef: (spanRef: SpanRef) => void;
  /** Centers the viewport horizontally on the requested absolute trace time. */
  centerOnTime: (timeMs: number) => void;
  /** Tracks the requested absolute trace time at the preferred horizontal screen anchor. */
  trackTime: (timeMs: number) => void;
  /** Fits the viewport vertically to the current graph bounds while preserving horizontal state. */
  fitYToBounds: () => void;
  /** Centers the viewport on time and fits the current graph vertically. */
  centerOnTimeAndFitY: (timeMs: number) => void;
  /** Resets the viewport to the current graph bounds. */
  resetView: () => void;
  /** Expands or collapses every valid process row in the current graph set. */
  expandAllProcesses: (expand: boolean) => void;
  /** Returns whether every valid process row is currently expanded. */
  areAllProcessesExpanded: () => boolean;
};

// Renderer boundary: this component should receive precomputed scenes/layer groups and instantiate
// deck.gl layers. Do not add graph scans, layout construction, geometry construction, or render-row
// projection here; add those to scene/build helpers and pass the prepared result in.
function DeckTraceRenderer({
  deckRef,
  bounds,
  overviewViewModel,
  traceBackgroundLayers,
  gridLayers,
  legendLayers,
  timeMeasureLayers,
  overviewScenes,
  foregroundScenes,
  instantAndCounterLayers,
  criticalPathLayers,
  overviewLayers,
  layerFilter,
  deckTheme,
  widgets,
  showMainVerticalScrollbar,
  showDefaultWidgets,
  enableDeckGpuTimeStats,
  viewAnchorTransition,
  showRowSeparators,
  onHover,
  onClick,
  isOverviewEnabled,
  isRunEventViewEnabled,
  collapseLegendToProcessLabelOverlay,
  interactionMode,
  settings,
  hoveredSpan,
  selectedSpanRefs,
  selectedDependencies,
  selectedCrossDependencies,
  selectedLocalDependencySourcesByProcessId,
  selectedCrossDependencySources,
  onSpanClick,
  onToggleProcess,
  onExpandProcess,
  colorScheme,
  fontFamily,
  highlightedSpanRefs
}: DeckTraceRendererProps) {
  const overviewForegroundBuildStartTime = performance.now();
  const overviewTraceForegroundLayers = overviewScenes.flatMap((scene, graphIndex) =>
    buildDeckLayerForTraceProcessActivitySummary({
      data: scene.processActivitySummaryData,
      layerIdPrefix: scene.layerIdPrefix,
      modelMatrix: createMinimapActivityModelMatrix(scene.layout.currentBounds, scene.modelMatrix),
      onProcessClick: row => onExpandProcess(row.processId, row.processRef, graphIndex)
    })
  );
  const overviewSpanIndicatorLayers = overviewScenes.flatMap(scene =>
    buildDeckLayersForMinimapSpanIndicators({
      indicators: scene.minimapSpanIndicators,
      bounds: scene.layout.currentBounds,
      layerIdPrefix: scene.layerIdPrefix,
      modelMatrix: createMinimapActivityModelMatrix(scene.layout.currentBounds, scene.modelMatrix),
      fontFamily
    })
  );
  traceLog.probe(0, 'DeckTraceRenderer overviewTraceForegroundLayers done', {
    sceneCount: overviewScenes.length,
    layerCount: overviewTraceForegroundLayers.length,
    spanIndicatorLayerCount: overviewSpanIndicatorLayers.length,
    durationMs: performance.now() - overviewForegroundBuildStartTime,
    ...getHeapUsageProbeFields()
  })();
  const traceForegroundBaseLayers = useMemo(() => {
    const baseBuildStartTime = performance.now();
    const result = foregroundScenes.flatMap((scene, graphIndex) =>
      buildDeckLayersForTrace({
        scene,
        settings,
        stepNum: 0, // TODO - pass the step number
        selection: {
          hoveredSpan: null,
          selectedSpanRefs: EMPTY_SELECTED_SPAN_REFS,
          selectedDependencies: EMPTY_SELECTED_LOCAL_DEPENDENCIES,
          selectedCrossDependencies: EMPTY_SELECTED_CROSS_DEPENDENCIES,
          selectedLocalDependencySourcesByProcessId:
            EMPTY_SELECTED_LOCAL_DEPENDENCY_SOURCES_BY_PROCESS_ID,
          selectedCrossDependencySources: EMPTY_SELECTED_CROSS_DEPENDENCY_SOURCES,
          highlightedSpanRefs
        },
        handlers: {
          onSpanClick,
          onToggleProcess: (processId, processRef) =>
            onToggleProcess(processId, processRef, graphIndex)
        },
        colorScheme,
        fontFamily,
        showRowSeparators,
        layerGroup: 'base'
      })
    );
    traceLog.probe(0, 'DeckTraceRenderer traceForegroundBaseLayers memo done', {
      sceneCount: foregroundScenes.length,
      layerCount: result.length,
      durationMs: performance.now() - baseBuildStartTime,
      ...getHeapUsageProbeFields()
    })();
    return result;
  }, [
    colorScheme,
    foregroundScenes,
    fontFamily,
    highlightedSpanRefs,
    onSpanClick,
    onToggleProcess,
    settings,
    showRowSeparators
  ]);
  const foregroundBuildStartTime = performance.now();
  const selectionBuildStartTime = performance.now();
  const traceForegroundSelectionLayers = foregroundScenes.flatMap(scene =>
    buildDeckLayersForTrace({
      scene,
      settings,
      stepNum: 0,
      selection: {
        hoveredSpan,
        selectedSpanRefs,
        selectedDependencies,
        selectedCrossDependencies,
        selectedLocalDependencySourcesByProcessId,
        selectedCrossDependencySources,
        highlightedSpanRefs
      },
      handlers: {onSpanClick},
      colorScheme,
      fontFamily,
      showRowSeparators,
      layerGroup: 'selection'
    })
  );
  traceLog.probe(0, 'DeckTraceRenderer traceForegroundSelectionLayers done', {
    sceneCount: foregroundScenes.length,
    layerCount: traceForegroundSelectionLayers.length,
    selectedSpanCount: selectedSpanRefs.length,
    selectedLocalDependencyCount: selectedDependencies.length,
    selectedCrossDependencyCount: selectedCrossDependencies.length,
    durationMs: performance.now() - selectionBuildStartTime,
    ...getHeapUsageProbeFields()
  })();
  traceLog.probe(0, 'DeckTraceRenderer traceForegroundLayers done', {
    sceneCount: foregroundScenes.length,
    layerCount: traceForegroundBaseLayers.length + traceForegroundSelectionLayers.length,
    baseLayerCount: traceForegroundBaseLayers.length,
    selectionLayerCount: traceForegroundSelectionLayers.length,
    selectedSpanCount: selectedSpanRefs.length,
    selectedLocalDependencyCount: selectedDependencies.length,
    selectedCrossDependencyCount: selectedCrossDependencies.length,
    highlightedSpanCount: highlightedSpanRefs?.size ?? 0,
    durationMs: performance.now() - foregroundBuildStartTime,
    ...getHeapUsageProbeFields()
  })();

  const layers = [
    gridLayers,
    traceBackgroundLayers,
    legendLayers,
    timeMeasureLayers,
    overviewTraceForegroundLayers,
    overviewSpanIndicatorLayers,
    traceForegroundBaseLayers,
    instantAndCounterLayers,
    criticalPathLayers,
    traceForegroundSelectionLayers,
    overviewLayers
  ];
  const enableDeckAnimation = false;

  return (
    <DeckWithManagedViews
      ref={deckRef}
      bounds={bounds}
      overviewBounds={overviewViewModel.bounds}
      layers={layers}
      layerFilter={layerFilter ?? undefined}
      deckTheme={deckTheme}
      widgets={widgets}
      showMainVerticalScrollbar={showMainVerticalScrollbar}
      showDefaultWidgets={showDefaultWidgets}
      enableDeckGpuTimeStats={enableDeckGpuTimeStats}
      enableDeckAnimation={enableDeckAnimation}
      viewAnchorTransition={viewAnchorTransition}
      onHover={onHover}
      onClick={onClick}
      isOverviewEnabled={isOverviewEnabled}
      isRunEventViewEnabled={isRunEventViewEnabled}
      collapseLegendToProcessLabelOverlay={collapseLegendToProcessLabelOverlay}
      interactionMode={interactionMode}
      traceDragInteractionMode={settings.interactionMode ?? 'drag-to-zoom'}
    />
  );
}

const POST_DESELECT_ANCHOR_COMMIT_COUNT = 2;

/** Committed layout snapshot used to preserve focused-selection anchors across renders. */
type FocusedSelectionAnchorSnapshot = {
  /** Previously committed trace layouts. Null before the first committed layout pass. */
  readonly traceLayouts: readonly TraceLayout[] | null;
  /** Focused-selection span refs for the committed layouts. */
  readonly focusedSelectionSpanRefs: readonly SpanRef[];
  /** Most recent primary selected span, retained briefly after deselect. */
  readonly primarySelectedSpanRef: SpanRef | null;
  /** Anchor span used for the short post-deselect full-layout correction window. */
  readonly postDeselectAnchorSpanRef: SpanRef | null;
  /** Remaining committed layout passes that may still correct post-deselect shifts. */
  readonly postDeselectRemainingCommits: number;
  /** Monotonic snapshot version used to key one-shot managed-view corrections. */
  readonly version: number;
};

/** Current layout inputs for focused-selection anchor preservation. */
type FocusedSelectionAnchorInputs = {
  /** Current trace layouts after optional focused-selection compaction. */
  readonly traceLayouts: readonly TraceLayout[];
  /** Current focused-selection span refs. Empty means the full layout is active. */
  readonly focusedSelectionSpanRefs: readonly SpanRef[];
  /** Current primary selected span, or null after deselect. */
  readonly primarySelectedSpanRef: SpanRef | null;
};

/** Returns the one-shot managed-view correction for focused-selection layout transitions. */
function useFocusedSelectionViewAnchorTransition(
  inputs: FocusedSelectionAnchorInputs
): DeckWithManagedViewsAnchorTransition | null {
  const snapshotRef = useRef<FocusedSelectionAnchorSnapshot>({
    traceLayouts: null,
    focusedSelectionSpanRefs: EMPTY_SELECTED_SPAN_REFS,
    primarySelectedSpanRef: inputs.primarySelectedSpanRef,
    postDeselectAnchorSpanRef: null,
    postDeselectRemainingCommits: 0,
    version: 0
  });

  const transition = useMemo(
    () => getFocusedSelectionViewAnchorTransition(snapshotRef.current, inputs),
    [inputs.focusedSelectionSpanRefs, inputs.primarySelectedSpanRef, inputs.traceLayouts]
  );

  useLayoutEffect(() => {
    snapshotRef.current = getNextFocusedSelectionAnchorSnapshot(snapshotRef.current, inputs);
  }, [inputs.focusedSelectionSpanRefs, inputs.primarySelectedSpanRef, inputs.traceLayouts]);

  return transition;
}

/** Builds the next committed focused-selection anchor snapshot. */
function getNextFocusedSelectionAnchorSnapshot(
  previous: FocusedSelectionAnchorSnapshot,
  inputs: FocusedSelectionAnchorInputs
): FocusedSelectionAnchorSnapshot {
  if (inputs.primarySelectedSpanRef != null) {
    return {
      traceLayouts: inputs.traceLayouts,
      focusedSelectionSpanRefs: inputs.focusedSelectionSpanRefs,
      primarySelectedSpanRef: inputs.primarySelectedSpanRef,
      postDeselectAnchorSpanRef: null,
      postDeselectRemainingCommits: 0,
      version: previous.version + 1
    };
  }

  const didLeaveFocusedSelection =
    previous.focusedSelectionSpanRefs.length > 0 &&
    inputs.focusedSelectionSpanRefs.length === 0 &&
    previous.primarySelectedSpanRef != null;
  if (didLeaveFocusedSelection) {
    return {
      traceLayouts: inputs.traceLayouts,
      focusedSelectionSpanRefs: inputs.focusedSelectionSpanRefs,
      primarySelectedSpanRef: previous.primarySelectedSpanRef,
      postDeselectAnchorSpanRef: previous.primarySelectedSpanRef,
      postDeselectRemainingCommits: POST_DESELECT_ANCHOR_COMMIT_COUNT,
      version: previous.version + 1
    };
  }

  const postDeselectRemainingCommits =
    inputs.focusedSelectionSpanRefs.length === 0
      ? Math.max(0, previous.postDeselectRemainingCommits - 1)
      : 0;
  return {
    traceLayouts: inputs.traceLayouts,
    focusedSelectionSpanRefs: inputs.focusedSelectionSpanRefs,
    primarySelectedSpanRef: previous.primarySelectedSpanRef,
    postDeselectAnchorSpanRef:
      postDeselectRemainingCommits > 0 ? previous.postDeselectAnchorSpanRef : null,
    postDeselectRemainingCommits,
    version: previous.version + 1
  };
}

/** Computes the pending focused-selection managed-view transition from a committed snapshot. */
function getFocusedSelectionViewAnchorTransition(
  previous: FocusedSelectionAnchorSnapshot,
  inputs: FocusedSelectionAnchorInputs
): DeckWithManagedViewsAnchorTransition | null {
  if (!previous.traceLayouts) {
    return null;
  }

  const didFocusedSelectionChange = !areArraysEqual(
    previous.focusedSelectionSpanRefs,
    inputs.focusedSelectionSpanRefs
  );
  const shouldAnchorFocusedLayoutUpdate =
    didFocusedSelectionChange &&
    inputs.focusedSelectionSpanRefs.length > 0 &&
    inputs.primarySelectedSpanRef != null;
  const shouldAnchorPostDeselectLayoutUpdate =
    inputs.focusedSelectionSpanRefs.length === 0 &&
    inputs.primarySelectedSpanRef == null &&
    previous.postDeselectRemainingCommits > 0;
  if (
    !didFocusedSelectionChange &&
    !shouldAnchorFocusedLayoutUpdate &&
    !shouldAnchorPostDeselectLayoutUpdate
  ) {
    return null;
  }

  const anchorSpanRef =
    inputs.primarySelectedSpanRef ??
    previous.postDeselectAnchorSpanRef ??
    previous.primarySelectedSpanRef;
  if (anchorSpanRef == null) {
    return null;
  }

  const deltaY = getTraceLayoutSpanAnchorDeltaY({
    previousTraceLayouts: previous.traceLayouts,
    nextTraceLayouts: inputs.traceLayouts,
    spanRef: anchorSpanRef
  });
  if (deltaY == null || Math.abs(deltaY) < 1e-3) {
    return null;
  }

  return {
    key: [previous.version, anchorSpanRef, inputs.traceLayouts.length].join('|'),
    deltaY
  };
}

export const DeckTraceGraph = forwardRef(function DeckTraceGraph(
  props: DeckTraceGraphProps,
  ref: React.Ref<DeckTraceGraphHandle>
) {
  const {className = '', engine, reactConfig} = props;
  const subscribeToEngine = useCallback(
    (listener: Parameters<TraceEngine['subscribe']>[0]) => engine.subscribe(listener),
    [engine]
  );
  const getEngineSnapshot = useCallback(() => engine.getSnapshot(), [engine]);
  const engineSnapshot = useSyncExternalStore(
    subscribeToEngine,
    getEngineSnapshot,
    getEngineSnapshot
  );
  const {
    traceGraph,
    traceStyle,
    paths,
    settings,
    colorScheme,
    selectedSpanRefs,
    extendedSelectionSpanRefs,
    extendedSelectionMode,
    highlightedSpanRefs,
    selectedLocalDependencyRefs,
    selectedCrossDependencyRefs,
    selectedLocalDependencyDirectionByRef,
    selectedCrossDependencyDirectionByRef,
    collapseState,
    traceGraphs,
    primaryTraceGraph,
    traceViewState,
    isOverviewEnabled
  } = engineSnapshot;
  const {
    showGraphNames: showGraphNamesProp = true,
    showRowSeparators = true,
    traceSpanCardOptions,
    resolvePickedTraceObject: resolvePickedTraceObjectFromHost,
    renderTraceEventCard,
    processInfoMap,
    onProcessInfoClick,
    getJSONForTraceObject,
    onTimeRangeSelectionChange = () => {},
    keyboardShortcuts,
    helpLinks = [],
    externalOmniBoxSearchProvider,
    urlParameters,
    settingsConfig,
    controlWidgetPlacement = DEFAULT_CONTROL_WIDGET_PLACEMENT,
    deckWidgetTheme,
    overviewEventMarkers = [],
    overviewTimeRange,
    overviewLoadedTimeRange,
    onOverviewMarkerDoubleClick,
    onTraceEventDoubleClick,
    onTraceMemoryReportProviderChange,
    onTraceFilterSummaryProviderChange,
    widgets: appWidgets = [],
    showDefaultWidgets = false,
    showMainVerticalScrollbar = false
  } = reactConfig ?? {};
  const processLabel = traceStyle.labels.processLabel;
  const threadLabel = traceStyle.labels?.threadLabel;
  const {minTimeMs, maxTimeMs} = traceGraph.getTimeBounds();

  const resolvedTraceStyle = useMemo<TraceStyle>(
    () => ({
      ...traceStyle,
      colorScheme
    }),
    [traceStyle, colorScheme]
  );

  const renderProbeKeyRef = useRef<string | null>(null);
  const renderProbeKey = traceGraphs
    .map(
      graph =>
        `${graph.name}:${graph.processes.length}:${graph.stats.spanCount}:${graph.stats.localDependencyCount}:${graph.stats.crossDependencyCount}`
    )
    .join('|');
  if (renderProbeKeyRef.current !== renderProbeKey) {
    renderProbeKeyRef.current = renderProbeKey;
    traceLog.probe(0, 'DeckTraceGraph render traceGraphs changed', {
      graphCount: traceGraphs.length,
      processCount: traceGraphs.reduce((sum, graph) => sum + graph.processes.length, 0),
      spanCount: traceGraphs.reduce((sum, graph) => sum + graph.stats.spanCount, 0),
      localDependencyCount: traceGraphs.reduce(
        (sum, graph) => sum + graph.stats.localDependencyCount,
        0
      ),
      crossDependencyCount: traceGraphs.reduce(
        (sum, graph) => sum + graph.stats.crossDependencyCount,
        0
      ),
      controlledSelectedSpanCount: selectedSpanRefs.length,
      ...getHeapUsageProbeFields()
    })();
  }
  const initialViewportFitKey = getInitialViewportFitKey(traceGraphs);
  const shouldAnnotateGraphNames = showGraphNamesProp && traceGraphs.length > 1;
  const validRankCount = traceGraphs.reduce((sum, graph) => sum + graph.processes.length, 0);
  // Stores the label Y position before a collapse/expand so we can keep the
  // corresponding label/caret anchored after the layout recomputes.
  const pendingAnchorRef = useRef<PendingTraceLayoutAnchor | null>(null);

  const expandAllProcesses = useCallback(
    (expand: boolean) => {
      engine.dispatch({type: 'setAllProcessesExpanded', expand});
    },
    [engine]
  );

  const areAllProcessesExpanded = useCallback(
    () => collapseState.graphs.every(graphState => graphState.collapsedProcessRefs.size === 0),
    [collapseState]
  );

  const aggregationMode = settings.trackAggregationMode;
  const getTraceModelMatrixForGraph = useCallback(
    (graphIndex: number) =>
      graphIndex === 1
        ? createTraceComparisonModelMatrix(settings.traceOffsetMs, settings.traceScale)
        : undefined,
    [settings.traceOffsetMs, settings.traceScale]
  );
  const sourceTraceGraphs = traceGraphs;
  const focusedSelectionSpanRefs = traceViewState.focusedSelectionSpanRefs;
  const renderSelectedSpanRefs =
    selectedSpanRefs.length > 0 ? selectedSpanRefs : EMPTY_SELECTED_SPAN_REFS;
  const traceLayouts = traceViewState.activeLayouts;
  // Canvas-originated selection should not move the viewport. Inspector and
  // search navigation pan explicitly through zoomToSpanRef/centerOnSpan, while
  // focused shift-click layouts preserve the clicked span's screen position.
  const viewAnchorTransition = useFocusedSelectionViewAnchorTransition({
    traceLayouts,
    focusedSelectionSpanRefs,
    primarySelectedSpanRef: renderSelectedSpanRefs[0] ?? null
  });

  const findRankLabelAnchor = useCallback(
    (processId: string, graphIndexHint?: number) =>
      findTraceLayoutRankLabelAnchor({traceLayouts, processId, graphIndexHint}),
    [traceLayouts]
  );

  const findThreadLabelAnchor = useCallback(
    (threadRef: ThreadRef) => findTraceLayoutThreadLabelAnchor({traceLayouts, threadRef}),
    [traceLayouts]
  );

  const findSpanGeometry = useCallback(
    (spanRef: SpanRef) => findTraceLayoutSpanGeometry({traceLayouts, spanRef}),
    [traceLayouts]
  );

  const handleToggleStream = useCallback(
    (threadId: TraceThreadId, threadRef: ThreadRef, graphIndex: number) => {
      const targetThread = resolveTraceThreadRefTarget({
        threadRef,
        graphIndex
      });
      const anchor = findThreadLabelAnchor(targetThread.threadRef);
      if (anchor) {
        pendingAnchorRef.current = {
          kind: 'stream',
          id: threadId,
          threadRef: targetThread.threadRef,
          graphIndex: targetThread.graphIndex,
          labelY: anchor.labelY
        };
      }
      engine.dispatch({
        type: 'toggleThread',
        graphIndex: targetThread.graphIndex,
        threadRef: targetThread.threadRef
      });
    },
    [engine, findThreadLabelAnchor]
  );

  // Capture the pre-toggle label position so we can pan the view to keep it fixed.
  const handleToggleRank = useCallback(
    (
      processId: string,
      processRef: ProcessRef,
      graphIndexHint?: number
      /* processInfo?: TraceProcessInfo */
    ) => {
      const targetProcess = resolveTraceProcessRefTarget({
        traceGraphs,
        processId,
        processRef,
        graphIndexHint
      });
      if (!targetProcess) {
        return;
      }

      const anchor = findRankLabelAnchor(processId, targetProcess.graphIndex);
      if (anchor) {
        pendingAnchorRef.current = {
          kind: 'rank',
          id: processId,
          graphIndex: targetProcess.graphIndex,
          labelY: anchor.labelY
        };
      }

      engine.dispatch({
        type: 'toggleProcess',
        graphIndex: targetProcess.graphIndex,
        processRef: targetProcess.processRef
      });
    },
    [engine, findRankLabelAnchor, traceGraphs]
  );

  /** Expands one process row when the requested target is currently collapsed. */
  const handleExpandRank = useCallback(
    (processId: string, processRef: ProcessRef, graphIndexHint?: number) => {
      const targetProcess = resolveTraceProcessRefTarget({
        traceGraphs,
        processId,
        processRef,
        graphIndexHint
      });
      if (
        !targetProcess ||
        !collapseState.graphs[targetProcess.graphIndex]?.collapsedProcessRefs.has(
          targetProcess.processRef
        )
      ) {
        return;
      }

      handleToggleRank(processId, targetProcess.processRef, targetProcess.graphIndex);
    },
    [collapseState, handleToggleRank, traceGraphs]
  );

  useLayoutEffect(() => {
    // After the layout recomputes, pan the view so the toggled label appears
    // stationary in the viewport.
    const pendingAnchor = pendingAnchorRef.current;
    if (!pendingAnchor) {
      return;
    }
    const nextAnchor = resolvePendingTraceLayoutAnchor({pendingAnchor, traceLayouts});
    pendingAnchorRef.current = null;
    if (!nextAnchor) {
      return;
    }
    const previousAnchorY =
      pendingAnchor.kind === 'span' ? pendingAnchor.centerY : pendingAnchor.labelY;
    const nextAnchorY = 'centerY' in nextAnchor ? nextAnchor.centerY : nextAnchor.labelY;
    const deltaY = nextAnchorY - previousAnchorY;
    if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 1e-3) {
      return;
    }
    const viewState = deckRef.current?.getMainViewState?.();
    const target = viewState?.target as [number, number, number] | undefined;
    if (!target) {
      return;
    }
    deckRef.current?.panTo([target[0], target[1] + deltaY], {transition: false});
  }, [traceLayouts]);

  const verticalBounds = useMemo(() => {
    const result: [number, number] = [0, 0];
    for (const layout of traceLayouts) {
      const [minY, maxY] = getVerticalBounds(layout);
      result[0] = Math.min(result[0], minY);
      result[1] = Math.max(result[1], maxY);
    }
    return result;
  }, [traceLayouts]);

  // EVENT HANDLING LOGIC
  const deckRef = useRef<DeckWithManagedViewsRef>(null);

  const {timeMeasureLayers, timeMeasureWidget, interactionMode} = useTimeMeasure(
    minTimeMs,
    onTimeRangeSelectionChange,
    controlWidgetPlacement,
    resolvedTraceStyle.fontFamily,
    showDefaultWidgets
  );

  // HOVER LOGIC

  const [hoverPopup, setHoverPopup] = useState<DeckTraceHoverPopupState | null>(null);
  const hoverPopupWidget = useMemo(() => {
    if (!showDefaultWidgets) {
      return null;
    }
    return new TraceHoverPopupWidget({
      id: TRACE_HOVER_POPUP_WIDGET_ID
    });
  }, [showDefaultWidgets]);

  // HOVER LOGIC

  const [hoveredSpan, setHoveredBlock] = useState<{
    rankIndex: number;
    block?: TraceRenderSpan;
  } | null>(null);
  const [hoveredSpanRef, setHoveredSpanRef] = useState<SpanRef | null>(null);
  const suppressNextDeckClickRef = useRef(false);

  const applySelectedSpanRefs = useCallback(
    (spanRefs: readonly SpanRef[]) => {
      const applyStartTime = performance.now();
      const didChange = !areArraysEqual(selectedSpanRefs, spanRefs);
      if (didChange) {
        engine.dispatch({type: 'setSelection', selectedSpanRefs: spanRefs});
      }
      logDeckTraceSelectionProbe('DeckTraceGraph applySelectedSpanRefs done', {
        nextSelectedSpanCount: spanRefs.length,
        didChange,
        durationMs: performance.now() - applyStartTime
      });
    },
    [engine, selectedSpanRefs]
  );
  const selectionAwareHighlightedSpanRefs = useMemo(() => {
    const shouldFadeToSelection =
      extendedSelectionMode === 'fade' || extendedSelectionMode === 'both';
    const shouldFadeToExtendedSelection =
      shouldFadeToSelection && extendedSelectionSpanRefs.length > 0;
    const merged = new Set<SpanRef>(highlightedSpanRefs ?? []);
    if (shouldFadeToExtendedSelection) {
      selectedSpanRefs.forEach(spanRef => merged.add(spanRef));
      extendedSelectionSpanRefs.forEach(spanRef => merged.add(spanRef));
    }
    return merged.size > 0 ? merged : undefined;
  }, [extendedSelectionMode, extendedSelectionSpanRefs, highlightedSpanRefs, selectedSpanRefs]);
  const effectiveHighlightedSpanRefs = selectionAwareHighlightedSpanRefs;

  const selectedLocalDependencySourcesByProcessId = useMemo(() => {
    const selectedSources = buildTraceSelectedLocalDependencySourcesByProcessId(
      primaryTraceGraph,
      selectedLocalDependencyRefs,
      EMPTY_SELECTED_LOCAL_DEPENDENCY_REFS,
      {
        selectedLocalDependencyDirectionByRef
      }
    );
    return Object.keys(selectedSources).length > 0
      ? selectedSources
      : EMPTY_SELECTED_LOCAL_DEPENDENCY_SOURCES_BY_PROCESS_ID;
  }, [primaryTraceGraph, selectedLocalDependencyDirectionByRef, selectedLocalDependencyRefs]);
  const selectedCrossDependencySources = useMemo(() => {
    const selectedSources = buildTraceSelectedCrossDependencySources(
      primaryTraceGraph,
      selectedCrossDependencyRefs,
      EMPTY_SELECTED_CROSS_DEPENDENCY_REFS,
      {
        selectedCrossDependencyDirectionByRef
      }
    );
    return selectedSources.length > 0 ? selectedSources : EMPTY_SELECTED_CROSS_DEPENDENCY_SOURCES;
  }, [primaryTraceGraph, selectedCrossDependencyDirectionByRef, selectedCrossDependencyRefs]);
  const [animationStep, setAnimationStep] = useState(0);

  const animationIntervalMs = Math.max(
    30,
    Math.min(1000, settings.criticalPathAnimationIntervalMs ?? 75)
  );
  const pathAnimationMode = settings.followCriticalPathAnimationMode ?? 'none';

  const {
    highlightedPathSpanRefs,
    highlightedPathBlockSources,
    highlightedPathTrail,
    pathHighlightTrailLength,
    shouldAnimatePaths
  } = useMemo(
    () =>
      computeTracePathHighlighting({
        paths,
        traceGraph: primaryTraceGraph,
        animationStep,
        settings: {
          criticalPathTrailSpanLength: settings.criticalPathTrailSpanLength,
          followCriticalPathAnimationMode: settings.followCriticalPathAnimationMode
        }
      }),
    [
      animationStep,
      paths,
      settings.criticalPathTrailSpanLength,
      settings.followCriticalPathAnimationMode,
      primaryTraceGraph
    ]
  );

  useEffect(() => {
    const shouldAnimate = shouldAnimatePaths;
    if (!shouldAnimate) {
      setAnimationStep(0);
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    const intervalId = window.setInterval(() => {
      setAnimationStep(previousStep => previousStep + 1);
    }, animationIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [animationIntervalMs, selectedSpanRefs.length, shouldAnimatePaths]);

  const lastFollowedPathSpanRefRef = useRef<SpanRef | null>(null);

  const resolvePickedTraceObject = useCallback(
    (object: unknown) =>
      resolveDeckTraceGraphPickedObject(object, resolvePickedTraceObjectFromHost),
    [resolvePickedTraceObjectFromHost]
  );

  /** Resolves selected span data from any deck.gl picking payload used by trace block layers. */
  const resolvePickedBlockSelection = useCallback(
    (object: unknown): TraceSelectedSpan | null => {
      const pickedObject = resolvePickedTraceObject(object);
      if (typeof pickedObject === 'number') {
        const spanRef = pickedObject;
        const span = getTraceSelectedSpanFromRef(primaryTraceGraph, spanRef);
        return span ? {spanRef, span} : null;
      }
      if (!pickedObject || typeof pickedObject !== 'object') {
        return null;
      }
      if ('type' in pickedObject && pickedObject.type === 'trace-span') {
        const block = pickedObject as TraceSpan;
        const spanRef = block.spanRef ?? null;
        const span =
          spanRef != null ? getTraceSelectedSpanFromRef(primaryTraceGraph, spanRef) : null;
        return spanRef != null && span ? {spanRef, span} : null;
      }
      if (isTraceRenderSpanObject(pickedObject)) {
        const span = getTraceSelectedSpanFromRenderSpan(primaryTraceGraph, pickedObject);
        return span ? {spanRef: pickedObject.spanRef, span} : null;
      }
      return null;
    },
    [primaryTraceGraph, resolvePickedTraceObject]
  );

  /** Applies span selection from a resolved deck.gl picking payload. */
  const selectPickedTraceSpan = useCallback(
    (
      {spanRef}: TraceSelectedSpan,
      options?: {
        /** Whether this selection came from an extended-selection gesture. */
        isExtendedSelection?: boolean;
      }
    ) => {
      const selectionStartTime = performance.now();
      const isExtendedSelection = options?.isExtendedSelection === true;

      engine.dispatch({type: 'selectSpan', spanRef, isExtendedSelection});
      logDeckTraceSelectionProbe('DeckTraceGraph selectPickedTraceSpan done', {
        spanRef,
        isExtendedSelection,
        computedDependencySelection: false,
        usedImmediateDependencyRefs: false,
        localDependencyCount: 0,
        crossDependencyCount: 0,
        durationMs: performance.now() - selectionStartTime
      });
    },
    [engine]
  );

  /**
   * Applies the shared side effects for span selection interactions triggered by clicks or menu
   * actions.
   */
  const applySpanSelectionInteraction = useCallback(
    (
      selection: TraceSelectedSpan,
      options?: {
        /** Whether this interaction should apply extended-selection lane filtering semantics. */
        isExtendedSelection?: boolean;
      }
    ) => {
      setHoveredBlock(null);
      setHoveredSpanRef(null);
      const isExtendedSelection = options?.isExtendedSelection ?? false;
      selectPickedTraceSpan(selection, {isExtendedSelection});
    },
    [selectPickedTraceSpan]
  );

  const onSpanClickCallback = useCallback(
    (info: PickingInfo, event?: {srcEvent?: {button?: number; shiftKey?: boolean}}) => {
      if (!isPrimarySelectionButton(event)) {
        return false;
      }
      const selection = resolvePickedBlockSelection(info.object);
      if (!selection) {
        return false;
      }
      suppressNextDeckClickRef.current = true;
      queueMicrotask(() => {
        suppressNextDeckClickRef.current = false;
      });
      const isExtendedSelection = Boolean(event?.srcEvent?.shiftKey);
      applySpanSelectionInteraction(selection, {isExtendedSelection});
      return true;
    },
    [applySpanSelectionInteraction, resolvePickedBlockSelection]
  );

  const layoutBoundsRef = useRef<Bounds | null>(null);

  /** Callback on first resize to center the rank */
  const bounds = useMemo(() => {
    const primaryLayout = traceLayouts[0];
    if (!primaryLayout) {
      return (
        layoutBoundsRef.current ??
        ([
          [0, 0],
          [Math.max(maxTimeMs - minTimeMs, 1), 1]
        ] as Bounds)
      );
    }

    const nextBounds = getTraceBounds({
      traceLayout: primaryLayout,
      verticalBounds,
      minTimeMs,
      maxTimeMs
    });
    const previousBounds = layoutBoundsRef.current;
    if (!previousBounds || !boundsAreEqual(previousBounds, nextBounds)) {
      layoutBoundsRef.current = nextBounds;
      return nextBounds;
    }
    return previousBounds;
  }, [maxTimeMs, minTimeMs, traceLayouts, verticalBounds]);
  const primaryMinimapBounds = traceLayouts[0]?.minimapLayout?.bounds;
  const overviewViewModel = useMemo(
    () =>
      buildTracePreparedOverviewViewModel({
        isOverviewEnabled,
        mainBounds: bounds,
        minimapBounds: primaryMinimapBounds,
        originTimeMs: minTimeMs,
        overviewTimeRange,
        overviewLoadedTimeRange
      }),
    [
      bounds,
      isOverviewEnabled,
      minTimeMs,
      overviewLoadedTimeRange?.endTimeMs,
      overviewLoadedTimeRange?.startTimeMs,
      overviewTimeRange?.endTimeMs,
      overviewTimeRange?.startTimeMs,
      primaryMinimapBounds?.[0][0],
      primaryMinimapBounds?.[0][1],
      primaryMinimapBounds?.[1][0],
      primaryMinimapBounds?.[1][1]
    ]
  );

  const zoomToSpanRef = useCallback(
    (spanRef: SpanRef) => {
      const span = primaryTraceGraph.getTraceSpanCardModel(spanRef)?.span;
      if (!span) {
        return false;
      }

      applySelectedSpanRefs([spanRef]);
      const geometry = findSpanGeometry(spanRef);
      if (!geometry) {
        return true;
      }
      deckRef.current?.centerOnSpan(geometry);
      return true;
    },
    [applySelectedSpanRefs, findSpanGeometry, primaryTraceGraph]
  );
  /** Selects the exact span and centers it only when that exact span has visible geometry. */
  const selectExactSpanRef = useCallback(
    (spanRef: SpanRef) => {
      const span = primaryTraceGraph.getTraceSpanCardModel(spanRef)?.span;
      if (!span) {
        return;
      }

      applySelectedSpanRefs([spanRef]);
      const geometry = findSpanGeometry(spanRef);
      if (geometry) {
        deckRef.current?.centerOnSpan(geometry);
      }
    },
    [applySelectedSpanRefs, findSpanGeometry, primaryTraceGraph]
  );
  const appliedInitialViewportFitKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      appliedInitialViewportFitKeyRef.current === initialViewportFitKey ||
      traceLayouts.length === 0 ||
      validRankCount === 0
    ) {
      return;
    }
    deckRef.current?.resetView(bounds);
    appliedInitialViewportFitKeyRef.current = initialViewportFitKey;
  }, [bounds, initialViewportFitKey, traceLayouts.length, validRankCount]);

  /**
   * Pans the current view toward earlier times.
   */
  const panLeft = useCallback(() => {
    deckRef.current?.panBy(-KEYBOARD_NAV_HORIZONTAL_PAN_PX, 0, {
      transition: true,
      transitionDurationMs: KEYBOARD_NAV_TRANSITION_DURATION_MS
    });
  }, []);

  /**
   * Pans the current view toward later times.
   */
  const panRight = useCallback(() => {
    deckRef.current?.panBy(KEYBOARD_NAV_HORIZONTAL_PAN_PX, 0, {
      transition: true,
      transitionDurationMs: KEYBOARD_NAV_TRANSITION_DURATION_MS
    });
  }, []);

  /**
   * Pans the current view upward.
   */
  const panUp = useCallback(() => {
    deckRef.current?.panBy(0, -KEYBOARD_NAV_VERTICAL_PAN_PX, {
      transition: true,
      transitionDurationMs: KEYBOARD_NAV_TRANSITION_DURATION_MS
    });
  }, []);

  /**
   * Pans the current view downward.
   */
  const panDown = useCallback(() => {
    deckRef.current?.panBy(0, KEYBOARD_NAV_VERTICAL_PAN_PX, {
      transition: true,
      transitionDurationMs: KEYBOARD_NAV_TRANSITION_DURATION_MS
    });
  }, []);

  /**
   * Pans the current view upward by the fast keyboard navigation step.
   */
  const panUpFast = useCallback(() => {
    deckRef.current?.panBy(0, -KEYBOARD_NAV_FAST_VERTICAL_PAN_PX, {
      transition: true,
      transitionDurationMs: KEYBOARD_NAV_TRANSITION_DURATION_MS
    });
  }, []);

  /**
   * Pans the current view downward by the fast keyboard navigation step.
   */
  const panDownFast = useCallback(() => {
    deckRef.current?.panBy(0, KEYBOARD_NAV_FAST_VERTICAL_PAN_PX, {
      transition: true,
      transitionDurationMs: KEYBOARD_NAV_TRANSITION_DURATION_MS
    });
  }, []);

  /**
   * Zooms the current view in along the horizontal axis.
   */
  const zoomInHorizontal = useCallback(() => {
    deckRef.current?.zoomXBy(KEYBOARD_NAV_X_ZOOM_DELTA, {
      transition: true,
      transitionDurationMs: KEYBOARD_NAV_TRANSITION_DURATION_MS
    });
  }, []);

  /**
   * Zooms the current view out along the horizontal axis.
   */
  const zoomOutHorizontal = useCallback(() => {
    deckRef.current?.zoomXBy(-KEYBOARD_NAV_X_ZOOM_DELTA, {
      transition: true,
      transitionDurationMs: KEYBOARD_NAV_TRANSITION_DURATION_MS
    });
  }, []);

  const renderOmniBoxOption = useCallback(
    ({option}: {option: OmniBoxOption}) => {
      const optionData = option.data as OmniBoxOptionData | undefined;
      if (optionData?.kind === 'external') {
        const badgeLabel = truncateMiddle(option.label, {
          maxLabelLength: OMNIBOX_BADGE_NAME_MAX_LENGTH,
          ellipsisPosition: 5
        });

        return h(
          'div',
          {
            style: {
              width: '100%',
              height: '100%',
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 230px) minmax(0, 1fr)',
              alignItems: 'center',
              gap: '10px'
            }
          },
          h(
            'span',
            {
              title: `${option.label} (${optionData.result.reasonLabel})`,
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: '999px',
                borderColor: 'hsl(var(--border))',
                borderStyle: 'solid',
                borderWidth: '1px',
                backgroundColor: 'hsl(var(--background))',
                color: 'hsl(var(--muted-foreground))',
                fontSize: '10px',
                fontWeight: 600,
                lineHeight: '16px',
                padding: '0 8px',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }
            },
            badgeLabel
          ),
          h(
            'span',
            {
              style: {
                fontSize: '11px',
                color: 'rgba(100, 116, 139, 1)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }
            },
            option.description ?? optionData.result.reasonLabel
          )
        );
      }
      const span =
        optionData?.kind === 'span' && optionData.spanRef != null
          ? primaryTraceGraph.getTraceSpanCardModel(optionData.spanRef)?.span
          : undefined;
      const badgeSource = span ? {...span, keywords: span.keywords ?? []} : undefined;
      const badgeStyle = getTraceSpanBadgeStyle(
        badgeSource,
        settings,
        colorScheme,
        effectiveHighlightedSpanRefs
      );
      const badgeColor = badgeStyle.backgroundColor ?? OMNIBOX_FALLBACK_BADGE_COLOR;
      const badgeTextColor = badgeStyle.color ?? '#ffffff';
      const filterPresentation = getTraceSpanBadgePresentation({
        label: option.label,
        filtered: optionData?.kind === 'span' ? optionData.filterReason.state !== 'visible' : false,
        filterMask:
          optionData?.kind === 'span' ? optionData.filterMask : TRACE_SPAN_FILTER_MASK_NONE,
        maxLabelLength: OMNIBOX_BADGE_NAME_MAX_LENGTH,
        ellipsisPosition: 5,
        backgroundColor: badgeColor,
        textColor: badgeTextColor
      });

      return h(
        'div',
        {
          style: {
            width: '100%',
            height: '100%',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 230px) minmax(0, 1fr)',
            alignItems: 'center',
            gap: '10px'
          }
        },
        h(
          'span',
          {
            title: filterPresentation.tooltipText,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: '999px',
              borderColor: filterPresentation.badgeBorderColor,
              borderStyle: 'solid',
              borderWidth: '1px',
              backgroundColor: filterPresentation.badgeBackgroundColor,
              color: filterPresentation.badgeTextColor,
              fontSize: '10px',
              fontWeight: 600,
              lineHeight: '16px',
              padding: '0 8px',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }
          },
          filterPresentation.truncatedLabel
        ),
        h(
          'span',
          {
            style: {
              fontSize: '11px',
              color: 'rgba(100, 116, 139, 1)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }
          },
          option.description ?? ''
        )
      );
    },
    [colorScheme, effectiveHighlightedSpanRefs, primaryTraceGraph, settings]
  );

  const renderOmniBoxResultsSummary = useCallback(({mode, options}: OmniBoxResultsSummaryArgs) => {
    if (mode !== 'search') {
      return null;
    }
    const spanResultCount = getOmniBoxSpanResultCount(options);
    const resultNoun = spanResultCount === 1 ? 'result' : 'results';
    return `Showing ${spanResultCount} of up to ${OMNIBOX_SPAN_SEARCH_LIMIT} loaded span ${resultNoun}`;
  }, []);

  const omniBoxWidget = useMemo(() => {
    if (!showDefaultWidgets) {
      return null;
    }
    return new OmniBoxWidget({
      placement: controlWidgetPlacement,
      placeholder: OMNIBOX_SEARCH_PLACEHOLDER,
      defaultOpen: true,
      closeOnSelect: false,
      rememberQueries: true,
      queryHistoryStorageKey: OMNIBOX_QUERY_HISTORY_STORAGE_KEY,
      showAnchorButton: true,
      topOffsetPx: 48,
      commandManager,
      getOptions: query => {
        const normalizedQuery = query.trim();
        if (!normalizedQuery) {
          return [];
        }

        const matchesQuery = createTraceSpanNameSearchPredicate(normalizedQuery);
        if (!matchesQuery) {
          return [];
        }

        const options: OmniBoxOption[] = [];
        primaryTraceGraph.searchSpans(
          matchesQuery,
          record => {
            const duration = formatTimeMs(record.primaryTiming.durationMs, {roundDigits: 3});
            const threadLabelForDescription = threadLabel?.trim() || 'Thread';
            const truncatedProcessName = truncateMiddle(record.processName, {
              maxLabelLength: OMNIBOX_DESCRIPTION_NAME_MAX_LENGTH
            });
            const threadName = truncateMiddle(record.threadName, {
              maxLabelLength: OMNIBOX_DESCRIPTION_NAME_MAX_LENGTH
            });
            const filterStatusLabel = getTraceSpanBadgePresentation({
              label: record.blockName,
              filterMask: record.filterMask
            }).statusLabel;
            const searchStatusLabel = getOmniBoxSpanSearchStatusLabel({
              filterReason: record.filterReason,
              filterStatusLabel
            });
            const filterStatusPrefix = searchStatusLabel ? `${searchStatusLabel} · ` : '';
            options.push({
              id: String(record.spanRef),
              label: record.blockName,
              description: `${filterStatusPrefix}${duration} · ${truncatedProcessName} · ${threadLabelForDescription} ${threadName}`,
              data: {
                spanId: record.spanId,
                kind: 'span',
                spanRef: record.spanRef,
                filterMask: record.filterMask,
                filterReason: record.filterReason
              } as OmniBoxBlockOptionData
            } satisfies OmniBoxOption);
          },
          OMNIBOX_SPAN_SEARCH_LIMIT
        );
        for (const result of (
          externalOmniBoxSearchProvider?.({
            query: normalizedQuery,
            matchesQuery,
            limit: OMNIBOX_EXTERNAL_SEARCH_LIMIT
          }) ?? []
        ).slice(0, OMNIBOX_EXTERNAL_SEARCH_LIMIT)) {
          options.push({
            id: `external:${result.id}`,
            label: result.label,
            description: result.description
              ? `${result.reasonLabel} · ${result.description}`
              : result.reasonLabel,
            data: {
              kind: 'external',
              result
            } satisfies OmniBoxExternalOptionData
          } satisfies OmniBoxOption);
        }
        return options;
      },
      renderOption: renderOmniBoxOption,
      renderResultsSummary: renderOmniBoxResultsSummary,
      onSelectOption: option => {
        const optionData = option.data as OmniBoxOptionData | undefined;
        if (optionData?.kind === 'external') {
          optionData.result.onSelect();
          return;
        }
        if (optionData?.kind !== 'span' || optionData.spanRef == null) {
          return;
        }
        selectExactSpanRef(optionData.spanRef);
      }
    });
  }, [
    controlWidgetPlacement,
    externalOmniBoxSearchProvider,
    primaryTraceGraph,
    processLabel,
    renderOmniBoxOption,
    renderOmniBoxResultsSummary,
    selectExactSpanRef,
    showDefaultWidgets,
    threadLabel
  ]);

  useEffect(() => {
    if (pathAnimationMode !== 'follow') {
      lastFollowedPathSpanRefRef.current = null;
      return;
    }

    const [primaryHighlightedBlockSource] = highlightedPathBlockSources;
    if (!primaryHighlightedBlockSource) {
      return;
    }

    if (lastFollowedPathSpanRefRef.current === primaryHighlightedBlockSource.spanRef) {
      return;
    }

    lastFollowedPathSpanRefRef.current = primaryHighlightedBlockSource.spanRef;
    zoomToSpanRef(primaryHighlightedBlockSource.spanRef);
  }, [highlightedPathBlockSources, pathAnimationMode, zoomToSpanRef]);

  const panMainViewTo = useCallback((target: [number, number]) => {
    const viewState = deckRef.current?.getMainViewState?.();
    const currentTarget = viewState?.target as [number, number, number] | undefined;
    const targetY =
      currentTarget && Number.isFinite(currentTarget[1]) ? currentTarget[1] : target[1];
    deckRef.current?.panTo([target[0], targetY]);
  }, []);

  const centerOnTime = useCallback(
    (timeMs: number) => {
      const viewState = deckRef.current?.getMainViewState?.();
      const target = viewState?.target as [number, number, number] | undefined;
      if (!target || !Number.isFinite(timeMs)) {
        return;
      }
      deckRef.current?.panTo([timeMs - minTimeMs, target[1]], {transition: false});
    },
    [minTimeMs]
  );

  /** Tracks an absolute trace time at the preferred horizontal screen anchor. */
  const trackTime = useCallback(
    (timeMs: number) => {
      if (!Number.isFinite(timeMs)) {
        return;
      }
      deckRef.current?.trackTime(timeMs - minTimeMs);
    },
    [minTimeMs]
  );

  /** Fits the main view vertically to the current graph bounds. */
  const fitYToBounds = useCallback(() => {
    deckRef.current?.fitYToBounds(bounds);
  }, [bounds]);

  /** Tracks an absolute trace time while keeping the full graph Y extent visible. */
  const centerOnTimeAndFitY = useCallback(
    (timeMs: number) => {
      if (!Number.isFinite(timeMs)) {
        return;
      }
      deckRef.current?.centerOnTimeAndFitY(timeMs - minTimeMs, bounds);
    },
    [bounds, minTimeMs]
  );

  const handleHover = useCallback(
    (
      pickInfo: PickingInfo<TraceDependencyRenderSource | TraceObject | TraceRenderSpan>,
      _event: {srcEvent?: {clientX?: number; clientY?: number}} | undefined
    ) => {
      const pickedGraphIndex = getPickedGraphIndex(pickInfo) ?? 0;
      const pickedGraphModelMatrix = getTraceModelMatrixForGraph(pickedGraphIndex);
      if (isRankMetadataLabelPick(pickInfo)) {
        setHoveredSpanRef(null);
        const processId = getPickedRankId(pickInfo.object);
        const rank = processId
          ? primaryTraceGraph.processes.find(process => process.processId === processId)
          : undefined;
        const processInfo = processId ? processInfoMap?.[processId] : undefined;
        const nodeName = processInfo?.node_name;
        const anchor = resolveTraceHoverPopupAnchor(pickInfo, pickedGraphModelMatrix);
        setHoverPopup(
          processId && anchor
            ? {
                viewId: anchor.viewId,
                position: anchor.position,
                object: {
                  type: 'trace-process-info',
                  processId,
                  rankNum: rank?.rankNum ?? -1,
                  processName: rank?.name ?? processId,
                  processInfo,
                  nodeName: typeof nodeName === 'string' ? nodeName : undefined,
                  copyText: JSON.stringify(
                    {
                      processId,
                      rankNum: rank?.rankNum,
                      processName: rank?.name ?? processId,
                      processInfo
                    },
                    null,
                    2
                  )
                },
                content: null,
                isCopyable: true
              }
            : null
        );
        return;
      }

      const objectFromInfo = pickInfo.object;
      const pickedTraceObject = resolvePickedTraceObject(objectFromInfo);

      const {object: hoveredObject, content: hoveredContent} = resolveDeckTraceGraphHoverPayload(
        pickedTraceObject ?? objectFromInfo
      );
      const enrichedHoveredObject = isTraceProcessInfoObject(hoveredObject)
        ? (() => {
            const rank = primaryTraceGraph.processes.find(
              process => process.processId === hoveredObject.processId
            );
            const processInfo = processInfoMap?.[hoveredObject.processId];
            const nodeName = processInfo?.node_name;
            return {
              ...hoveredObject,
              rankNum: rank?.rankNum ?? hoveredObject.rankNum,
              processName: rank?.name ?? hoveredObject.processName,
              processInfo,
              nodeName: typeof nodeName === 'string' ? nodeName : undefined,
              copyText: JSON.stringify(
                {
                  processId: hoveredObject.processId,
                  rankNum: rank?.rankNum ?? hoveredObject.rankNum,
                  processName: rank?.name ?? hoveredObject.processName,
                  processInfo
                },
                null,
                2
              )
            };
          })()
        : hoveredObject;
      setHoveredSpanRef(
        resolvePickedBlockSelection(enrichedHoveredObject ?? pickedTraceObject ?? objectFromInfo)
          ?.spanRef ?? null
      );
      const anchor = resolveTraceHoverPopupAnchor(pickInfo, pickedGraphModelMatrix);

      setHoverPopup(
        anchor && (enrichedHoveredObject || hoveredContent)
          ? {
              viewId: anchor.viewId,
              position: anchor.position,
              object: enrichedHoveredObject,
              content: hoveredContent,
              isCopyable: isTraceTooltipCopyableObject(enrichedHoveredObject)
            }
          : null
      );
    },
    [
      getTraceModelMatrixForGraph,
      primaryTraceGraph,
      processInfoMap,
      resolvePickedBlockSelection,
      resolvePickedTraceObject
    ]
  );

  const hoverPopupObject = hoverPopup?.object ?? null;

  const handleClick = useCallback(
    (
      info: PickingInfo<TraceObject | TraceRenderSpan>,
      event:
        | {
            tapCount?: number;
            srcEvent?: {
              button?: number;
              detail?: number;
              shiftKey?: boolean;
            };
          }
        | undefined
    ) => {
      const clickStartTime = performance.now();
      if (!isPrimarySelectionButton(event)) {
        return;
      }
      if (isOverviewEnabled && info.viewport?.id === 'minimap') {
        const overviewMarker = (info.object as {object?: DeckTraceGraphOverviewMarker} | null)
          ?.object;
        const pickedObject = info.object as TraceEvent | {object?: TraceEvent} | null;
        const overviewTraceEvent =
          pickedObject && 'type' in pickedObject && pickedObject.type === 'trace-event'
            ? pickedObject
            : pickedObject && 'object' in pickedObject
              ? pickedObject.object
              : undefined;
        if (overviewTraceEvent?.type === 'trace-event' && isDeckDoubleClick(event)) {
          onTraceEventDoubleClick?.(overviewTraceEvent);
          return;
        }
        if (overviewMarker && isDeckDoubleClick(event)) {
          onOverviewMarkerDoubleClick?.(overviewMarker);
          return;
        }
        const coordinate =
          info.coordinate ??
          (Number.isFinite(info.x) && Number.isFinite(info.y)
            ? (info.viewport?.unproject([info.x, info.y]) as [number, number])
            : null);

        const x = coordinate?.[0];
        const y = coordinate?.[1];
        if (
          typeof x === 'number' &&
          Number.isFinite(x) &&
          typeof y === 'number' &&
          Number.isFinite(y)
        ) {
          panMainViewTo([x, y]);
        }
        logDeckTraceSelectionProbe('DeckTraceGraph handleClick overview done', {
          viewportId: info.viewport?.id ?? null,
          didPanMainView:
            typeof x === 'number' &&
            Number.isFinite(x) &&
            typeof y === 'number' &&
            Number.isFinite(y),
          durationMs: performance.now() - clickStartTime
        });
        return;
      }

      if (isRankNodeNamePick(info)) {
        logDeckTraceSelectionProbe('DeckTraceGraph handleClick rankNodeNamePick done', {
          durationMs: performance.now() - clickStartTime
        });
        return;
      }

      if (isRankLabelPick(info)) {
        const processId = getPickedRankId(info.object);
        const processRef = getPickedProcessRef(info.object);
        if (processId && processRef != null) {
          handleToggleRank(processId, processRef, getPickedGraphIndex(info));
          logDeckTraceSelectionProbe('DeckTraceGraph handleClick rankLabelPick done', {
            processId,
            durationMs: performance.now() - clickStartTime
          });
          return;
        }
      }

      if (suppressNextDeckClickRef.current) {
        suppressNextDeckClickRef.current = false;
        logDeckTraceSelectionProbe('DeckTraceGraph handleClick suppressed done', {
          durationMs: performance.now() - clickStartTime
        });
        return;
      }

      setHoveredBlock(null);

      const objectFromInfo = info.object;
      const pickedObject = resolvePickedTraceObject(objectFromInfo) ?? hoverPopupObject;

      const blockSelection = resolvePickedBlockSelection(pickedObject ?? objectFromInfo);
      if (blockSelection) {
        const isExtendedSelection = Boolean(event?.srcEvent?.shiftKey);
        applySpanSelectionInteraction(blockSelection, {isExtendedSelection});
        logDeckTraceSelectionProbe('DeckTraceGraph handleClick blockSelection done', {
          spanRef: blockSelection.spanRef,
          isExtendedSelection,
          durationMs: performance.now() - clickStartTime
        });
      } else {
        engine.dispatch({type: 'clearSelection'});
        logDeckTraceSelectionProbe('DeckTraceGraph handleClick clearSelection done', {
          hadTooltipObject: hoverPopupObject != null,
          durationMs: performance.now() - clickStartTime
        });
      }
    },
    [
      isOverviewEnabled,
      onOverviewMarkerDoubleClick,
      onTraceEventDoubleClick,
      applySpanSelectionInteraction,
      engine,
      handleToggleRank,
      panMainViewTo,
      resolvePickedBlockSelection,
      resolvePickedTraceObject,
      hoverPopupObject
    ]
  );

  useImperativeHandle(
    ref,
    () => ({
      panLeft,
      panRight,
      panUp,
      panDown,
      panUpFast,
      panDownFast,
      zoomInHorizontal,
      zoomOutHorizontal,
      zoomToSpanRef,
      centerOnTime,
      trackTime,
      fitYToBounds,
      centerOnTimeAndFitY,
      resetView: () => deckRef.current?.resetView(bounds),
      expandAllProcesses,
      areAllProcessesExpanded
    }),
    [
      areAllProcessesExpanded,
      bounds,
      expandAllProcesses,
      panDown,
      panDownFast,
      panLeft,
      panRight,
      panUp,
      panUpFast,
      centerOnTime,
      trackTime,
      fitYToBounds,
      centerOnTimeAndFitY,
      zoomInHorizontal,
      zoomOutHorizontal,
      zoomToSpanRef
    ]
  );

  useEffect(() => {
    const controllerTarget = {
      panLeft,
      panRight,
      panUp,
      panUpFast,
      panDown,
      panDownFast,
      zoomInHorizontal,
      zoomOutHorizontal,
      zoomToSpanRef,
      centerOnTime,
      trackTime,
      fitYToBounds,
      centerOnTimeAndFitY,
      resetView: () => deckRef.current?.resetView(bounds),
      expandAllProcesses,
      areAllProcessesExpanded
    };
    imperativeDeckController.attach(controllerTarget);
    return () => imperativeDeckController.detach(controllerTarget);
  }, [
    areAllProcessesExpanded,
    bounds,
    expandAllProcesses,
    panDown,
    panDownFast,
    panLeft,
    panRight,
    panUp,
    panUpFast,
    centerOnTime,
    trackTime,
    fitYToBounds,
    centerOnTimeAndFitY,
    zoomInHorizontal,
    zoomOutHorizontal,
    zoomToSpanRef
  ]);

  // CREATE DECK.GL LAYERS

  const longestSpan = sourceTraceGraphs.reduce(
    (maxSpan, graph) => Math.max(maxSpan, graph.maxTimeMs - graph.minTimeMs),
    0
  );

  const gridLayers = useMemo(
    () =>
      buildDeckLayersForGrid({
        minTimeMs: 0,
        maxTimeMs: longestSpan,
        layerIdPrefix: sourceTraceGraphs.length > 1 ? 'shared' : undefined,
        fontFamily: resolvedTraceStyle.fontFamily,
        formatTick: tick => {
          if (tick.type === 'major') {
            return `${formatTS(tick.value + minTimeMs, settings.timezone)}\n${formatRelativeTimeAxisDuration(tick.value, 'long', true)}`;
          }
          return formatRelativeTimeAxisDuration(tick.value - tick.stepStart, 'short', false);
        }
      }),
    [minTimeMs, resolvedTraceStyle.fontFamily, settings.timezone, sourceTraceGraphs, longestSpan]
  );

  const traceBackgroundLayers = useMemo(() => {
    const result = sourceTraceGraphs.flatMap((_, graphIndex) => {
      const layout = traceLayouts[graphIndex] ?? traceLayouts[0];
      if (!layout) {
        return [];
      }
      const layerIdPrefix = sourceTraceGraphs.length > 1 ? `trace-graph-${graphIndex}` : undefined;
      const modelMatrix = getTraceModelMatrixForGraph(graphIndex);
      const rankBackgroundColor = graphIndex > 0 ? TRACE_COLOR.SECOND_STEP_BACKGROUND : undefined;

      return buildDeckBackgroundLayersForTrace({
        processRows: layout.renderRows,
        traceLayout: layout,
        layerIdPrefix,
        rankBackgroundColor,
        modelMatrix
      });
    });
    return result;
  }, [getTraceModelMatrixForGraph, sourceTraceGraphs, traceLayouts]);

  const preparedScene: TracePreparedScene = traceViewState.preparedScene;
  const traceMemoryReportProvider = useCallback(() => {
    const traceEngineDiagnostics = engine.getDiagnostics({includeRetainedSizeEstimates: true});
    return {traceEngineDiagnostics};
  }, [engine]);
  const onTraceMemoryReportProviderChangeRef = useRef(onTraceMemoryReportProviderChange);
  useEffect(() => {
    onTraceMemoryReportProviderChangeRef.current = onTraceMemoryReportProviderChange;
  }, [onTraceMemoryReportProviderChange]);
  useEffect(() => {
    onTraceMemoryReportProviderChangeRef.current?.(traceMemoryReportProvider);
  }, [traceMemoryReportProvider]);
  useEffect(
    () => () => {
      onTraceMemoryReportProviderChangeRef.current?.(null);
    },
    []
  );
  const traceFilterSummaryProvider = useMemo<DeckTraceGraphFilterSummaryProvider>(
    () => ({
      hasFilteredItems: hasTraceFilteredItems(traceGraphs),
      buildTraceFilterSummary: () => buildTraceFilterSummary(traceGraphs)
    }),
    [traceGraphs]
  );
  const onTraceFilterSummaryProviderChangeRef = useRef(onTraceFilterSummaryProviderChange);
  useEffect(() => {
    onTraceFilterSummaryProviderChangeRef.current = onTraceFilterSummaryProviderChange;
  }, [onTraceFilterSummaryProviderChange]);
  useEffect(() => {
    onTraceFilterSummaryProviderChangeRef.current?.(traceFilterSummaryProvider);
  }, [traceFilterSummaryProvider]);
  useEffect(
    () => () => {
      onTraceFilterSummaryProviderChangeRef.current?.(null);
    },
    []
  );
  const {pathBlockSources, pathDependencySources} = preparedScene.paths;
  const selectionPreparedScene: TraceSelectionPreparedScene = useMemo(
    () =>
      buildTraceSelectionPreparedScene({
        preparedScene,
        sourceTraceGraphs,
        settings,
        colorScheme,
        selectedSpanRefs,
        hoveredSpanRef
      }),
    [preparedScene, colorScheme, hoveredSpanRef, selectedSpanRefs, settings, sourceTraceGraphs]
  );

  const legendLayers = useMemo(() => {
    const result = sourceTraceGraphs.flatMap((graph, graphIndex) => {
      const layout = traceLayouts[graphIndex] ?? traceLayouts[0];
      if (!layout) {
        return [];
      }
      const layerIdPrefix = sourceTraceGraphs.length > 1 ? `trace-graph-${graphIndex}` : undefined;
      const graphName = shouldAnnotateGraphNames ? graph.name : undefined;
      const modelMatrix = getTraceModelMatrixForGraph(graphIndex);

      return buildDeckLayersForLegend({
        processRows: layout.renderRows,
        settings,
        processInfoMap: processInfoMap || {},
        onProcessInfoClick,
        onToggleRank: (processId, processInfo, processRef) => {
          void processInfo;
          handleToggleRank(processId, processRef, graphIndex);
        },
        onToggleStream:
          aggregationMode === 'separate-threads'
            ? (threadId, stream, threadRef) => {
                void stream;
                handleToggleStream(threadId, threadRef, graphIndex);
              }
            : undefined,
        traceLayout: layout,
        colorScheme,
        fontFamily: resolvedTraceStyle.fontFamily,
        layerIdPrefix,
        graphName,
        modelMatrix
      });
    });
    return result;
  }, [
    shouldAnnotateGraphNames,
    colorScheme,
    handleToggleRank,
    handleToggleStream,
    onProcessInfoClick,
    processInfoMap,
    aggregationMode,
    resolvedTraceStyle.fontFamily,
    settings,
    sourceTraceGraphs,
    traceLayouts
  ]);

  const instantAndCounterLayers = useMemo(() => {
    const result = sourceTraceGraphs.flatMap((graph, graphIndex) => {
      const layout = traceLayouts[graphIndex] ?? traceLayouts[0];
      if (!layout) {
        return [];
      }
      const layerIdPrefix = sourceTraceGraphs.length > 1 ? `trace-graph-${graphIndex}` : undefined;
      const modelMatrix = getTraceModelMatrixForGraph(graphIndex);

      return buildDeckLayersForInstantsAndCounter({
        settings,
        traceGraph: graph,
        traceLayout: layout,
        colorScheme,
        layerIdPrefix,
        modelMatrix,
        globalEventYPosition: RUN_EVENT_VIEW_Y_POSITION
      });
    });
    return result;
  }, [settings, colorScheme, getTraceModelMatrixForGraph, sourceTraceGraphs, traceLayouts]);

  const criticalPathLayers = useMemo(() => {
    const result = sourceTraceGraphs.flatMap((_, graphIndex) => {
      const layout = traceLayouts[graphIndex] ?? traceLayouts[0];
      if (!layout) {
        return [];
      }
      const layerIdPrefix = sourceTraceGraphs.length > 1 ? `trace-graph-${graphIndex}` : undefined;
      const modelMatrix = getTraceModelMatrixForGraph(graphIndex);

      return buildDeckLayerForCriticalPath({
        pathBlockSources,
        pathDependencySources,
        pathHighlightSpanRefs: highlightedPathSpanRefs,
        pathHighlightTrail: highlightedPathTrail,
        pathHighlightTrailLength,
        onSpanClick: onSpanClickCallback,
        traceLayout: layout,
        settings,
        colorScheme,
        highlightedSpanRefs: effectiveHighlightedSpanRefs,
        layerIdPrefix,
        modelMatrix
      });
    });
    return result;
  }, [
    pathBlockSources,
    pathDependencySources,
    effectiveHighlightedSpanRefs,
    highlightedPathSpanRefs,
    highlightedPathTrail,
    pathHighlightTrailLength,
    onSpanClickCallback,
    settings,
    colorScheme,
    getTraceModelMatrixForGraph,
    sourceTraceGraphs,
    traceLayouts
  ]);

  const projectedOverviewEventMarkers = useMemo(
    () =>
      overviewEventMarkers
        .filter(marker => Number.isFinite(marker.timeMs))
        .map(marker => ({
          id: marker.id,
          x: marker.timeMs - minTimeMs,
          radiusScale: marker.radiusScale,
          fillColor: marker.fillColor,
          lineColor: marker.lineColor,
          object: marker
        })),
    [minTimeMs, overviewEventMarkers]
  );
  const formatOverviewTick = useCallback(
    (tick: Tick) => {
      if (tick.type === 'major') {
        return `${formatTS(tick.value + minTimeMs, settings.timezone)}\n${formatRelativeTimeAxisDuration(tick.value, 'long', true)}`;
      }
      return '';
    },
    [minTimeMs, settings.timezone]
  );

  const overviewLayers = useMemo(() => {
    if (!isOverviewEnabled) {
      return null;
    }
    return buildOverviewLayers({
      bounds: overviewViewModel.bounds,
      highlightViewportId: 'main',
      loadedContentBounds: overviewViewModel.loadedContentBounds,
      formatTick: formatOverviewTick,
      fontFamily: resolvedTraceStyle.fontFamily,
      eventMarkers: projectedOverviewEventMarkers
    });
  }, [
    formatOverviewTick,
    isOverviewEnabled,
    overviewViewModel,
    projectedOverviewEventMarkers,
    resolvedTraceStyle.fontFamily
  ]);

  const isRunEventViewEnabled =
    Boolean(settings.showGlobalEvents) && sourceTraceGraphs.some(graph => graph.events.numRows > 0);

  // SETUP VIEWS

  const viewLayerFilter = useMemo<LayerFilter>(() => {
    const shouldCollapseLegendToProcessLabelOverlay = aggregationMode === 'combine-threads';
    const filter = makeLayerFilter({
      header: {include: ['header']},
      'legend-background': {include: ['rank-background']},
      legend: {include: ['legend']},
      'run-events': {include: ['trace-global-events']},
      'run-events-legend': {include: []},
      main: {exclude: ['header', 'legend', 'minimap', 'rank-label', 'trace-global-events']},
      minimap: {
        include: ['minimap'],
        exclude: [
          'dependency',
          'dependencies',
          'rank-label',
          'rank-node-name',
          'block-labels',
          'block-names',
          'overflow-labels'
        ]
      }
    });
    return context => {
      if (context.viewport.id === 'legend' && shouldCollapseLegendToProcessLabelOverlay) {
        return isRankMetadataLabelPick(context);
      }
      if (context.isPicking && isRankMetadataLabelPick(context)) {
        return true;
      }
      if (context.isPicking && context.viewport.id === 'minimap') {
        const layerId = context.layer?.id ?? '';
        return (
          layerId === 'minimap-model-timeline-events' ||
          layerId.includes('collapsed-activity') ||
          layerId.includes('process-activity-summary')
        );
      }
      if (
        context.viewport.id === 'minimap' &&
        context.layer?.id?.includes('minimap-time-grids-tick-labels')
      ) {
        return true;
      }
      return filter(context);
    };
  }, [aggregationMode]);

  const layerFilter = viewLayerFilter;

  const hoverPopupContent = useMemo(() => {
    if (!hoverPopup || interactionMode) {
      return null;
    }

    return (
      <div className="pointer-events-none relative max-w-[500px] rounded-sm bg-muted text-foreground shadow-md">
        {hoverPopup.object ? (
          <TraceTooltip
            object={hoverPopup.object}
            traceGraph={primaryTraceGraph}
            traceSpanCardOptions={traceSpanCardOptions}
            paths={paths}
            getJSON={getJSONForTraceObject}
            traceLabels={resolvedTraceStyle.labels}
            traceStyle={resolvedTraceStyle}
            traceSettings={settings}
            onProcessInfoClick={onProcessInfoClick}
            renderTraceEventCard={renderTraceEventCard}
          />
        ) : (
          <div className="p-3 text-xs">{hoverPopup.content}</div>
        )}
        {hoverPopup.isCopyable && (
          <CopyShortcutHint className="absolute left-0 top-[-1.5rem] rounded-sm bg-muted px-1.5 py-1 text-xs drop-shadow" />
        )}
      </div>
    );
  }, [
    hoverPopup,
    interactionMode,
    onProcessInfoClick,
    paths,
    primaryTraceGraph,
    getJSONForTraceObject,
    resolvedTraceStyle,
    renderTraceEventCard,
    settings,
    traceSpanCardOptions
  ]);

  useEffect(() => {
    if (!hoverPopupWidget) {
      return;
    }
    hoverPopupWidget.setTraceHoverPopupProps({
      isVisible: hoverPopup != null && !interactionMode,
      viewId: hoverPopup?.viewId ?? null,
      position: hoverPopup?.position ?? [0, 0],
      reactContent: hoverPopupContent
    });
  }, [hoverPopup, hoverPopupContent, hoverPopupWidget, interactionMode]);

  const helpWidget = useMemo(() => {
    if (!showDefaultWidgets) {
      return null;
    }
    const documentedUrlParameters = urlParameters?.filter(parameter => Boolean(parameter)) ?? [];
    const hasHelpLinks = helpLinks.length > 0;
    const hasUrlParameters = documentedUrlParameters.length > 0;

    if (!keyboardShortcuts && !hasHelpLinks && !hasUrlParameters) {
      return null;
    }

    const keyboardPanelShortcuts = [...DEFAULT_SHORTCUTS, ...(keyboardShortcuts ?? [])];
    const helpPanels = [
      new KeyboardShortcutsPanel({keyboardShortcuts: keyboardPanelShortcuts}),
      ...(hasUrlParameters
        ? [new URLParametersPanel({urlParameters: documentedUrlParameters})]
        : []),
      new CommandDocumentationPanel({manager: commandManager}),
      ...(hasHelpLinks ? [new DocumentationLinksPanel({links: helpLinks})] : [])
    ];

    return new ModalPanelWidget({
      id: 'tracevis-help',
      title: 'Help',
      showTitleBar: false,
      triggerLabel: 'Help',
      placement: controlWidgetPlacement,
      openShortcuts: DEFAULT_SHORTCUTS,
      shortcuts: keyboardShortcuts ?? [],
      panel: new TabbedPanel({panels: helpPanels})
    });
  }, [controlWidgetPlacement, helpLinks, keyboardShortcuts, showDefaultWidgets, urlParameters]);

  const studioSettingsWidget = useMemo(() => {
    if (!showDefaultWidgets) {
      return null;
    }
    if (
      !settingsConfig?.showStudioSettingsWidget ||
      !settingsConfig.visualizationSchema ||
      !settingsConfig.onSettingsChange
    ) {
      return null;
    }

    const label = settingsConfig.label ?? 'Settings';
    return createStudioSettingsWidget({
      id: 'tracevis-studio-settings',
      title: label,
      triggerLabel: label,
      placement: settingsConfig.placement ?? controlWidgetPlacement,
      schema: settingsConfig.visualizationSchema,
      applicationSchema: settingsConfig.applicationSchema,
      settings: settingsConfig.settings,
      onSettingsChange: settingsConfig.onSettingsChange
    });
  }, [controlWidgetPlacement, settingsConfig, showDefaultWidgets]);

  const overviewWidget = useMemo(() => {
    if (!showDefaultWidgets) {
      return null;
    }
    if (!settingsConfig?.settings || !settingsConfig.onSettingsChange) {
      return null;
    }
    const showOverview = settingsConfig.settings.showOverview;
    if (typeof showOverview !== 'boolean') {
      return null;
    }
    const overviewShortcut = keyboardShortcuts?.find(
      shortcut => shortcut.commandId === TRACEVIS_TOGGLE_OVERVIEW_COMMAND_ID
    );
    return new CommandToggleWidget({
      id: 'tracevis-overview-toggle',
      placement: 'bottom-right',
      viewId: showOverview ? 'minimap' : 'interaction-capture',
      icon: OVERVIEW_TOGGLE_ICON,
      label: 'Show overview minimap',
      onLabel: 'Hide overview minimap',
      onColor: '#3b82f6',
      commandId: TRACEVIS_TOGGLE_OVERVIEW_COMMAND_ID,
      shortcutKeyHTML: overviewShortcut ? formatShortcutKeyHTML(overviewShortcut) : undefined,
      tooltipPlacement: 'top-end',
      initialChecked: showOverview,
      onChange: checked =>
        settingsConfig.onSettingsChange?.({
          ...settingsConfig.settings,
          showOverview: checked
        })
    });
  }, [keyboardShortcuts, settingsConfig, showDefaultWidgets]);

  const widgets = useMemo(
    () =>
      [
        helpWidget,
        studioSettingsWidget,
        overviewWidget,
        timeMeasureWidget,
        omniBoxWidget,
        hoverPopupWidget,
        showDefaultWidgets ? new ToastWidget() : null,
        ...appWidgets
      ].filter(widget => widget !== null) satisfies Widget[],
    [
      appWidgets,
      timeMeasureWidget,
      helpWidget,
      hoverPopupWidget,
      overviewWidget,
      omniBoxWidget,
      showDefaultWidgets,
      studioSettingsWidget
    ]
  );

  return (
    <div className={`flex-1 w-full overflow-visible ${className}`}>
      <div className="relative h-full w-full">
        <DeckTraceRenderer
          deckRef={deckRef}
          bounds={bounds}
          overviewViewModel={overviewViewModel}
          traceBackgroundLayers={traceBackgroundLayers}
          gridLayers={gridLayers}
          legendLayers={legendLayers}
          timeMeasureLayers={timeMeasureLayers}
          overviewScenes={selectionPreparedScene.overview}
          foregroundScenes={preparedScene.foreground}
          instantAndCounterLayers={instantAndCounterLayers}
          criticalPathLayers={criticalPathLayers}
          overviewLayers={overviewLayers}
          layerFilter={layerFilter}
          deckTheme={deckWidgetTheme}
          widgets={widgets}
          showMainVerticalScrollbar={showMainVerticalScrollbar}
          showDefaultWidgets={showDefaultWidgets}
          enableDeckGpuTimeStats={settings.enableDeckGpuTimeStats}
          viewAnchorTransition={viewAnchorTransition}
          showRowSeparators={showRowSeparators}
          onHover={handleHover}
          onClick={handleClick}
          isOverviewEnabled={isOverviewEnabled}
          isRunEventViewEnabled={isRunEventViewEnabled}
          collapseLegendToProcessLabelOverlay={aggregationMode === 'combine-threads'}
          interactionMode={interactionMode}
          settings={settings}
          hoveredSpan={hoveredSpan}
          selectedSpanRefs={renderSelectedSpanRefs}
          selectedDependencies={EMPTY_SELECTED_LOCAL_DEPENDENCIES}
          selectedCrossDependencies={EMPTY_SELECTED_CROSS_DEPENDENCIES}
          selectedLocalDependencySourcesByProcessId={selectedLocalDependencySourcesByProcessId}
          selectedCrossDependencySources={selectedCrossDependencySources}
          onSpanClick={onSpanClickCallback}
          onToggleProcess={handleToggleRank}
          onExpandProcess={handleExpandRank}
          colorScheme={colorScheme}
          fontFamily={resolvedTraceStyle.fontFamily}
          highlightedSpanRefs={effectiveHighlightedSpanRefs}
        />
      </div>
    </div>
  );
});
