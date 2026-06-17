import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  DeckProps,
  OrthographicView,
  OrthographicViewState,
  ViewStateChangeParameters,
  Widget
} from '@deck.gl/core';
import {DeckGL, DeckGLRef} from '@deck.gl/react';
import {
  DeckWidgetTheme,
  FullscreenWidget,
  LightTheme,
  ScrollbarWidget,
  _StatsWidget as StatsWidget,
  ZoomWidget
} from '@deck.gl/widgets';
import {fitBoundsOrthographic} from '@deck.gl-community/infovis-layers';

import {buildViewsFromViewLayout} from '@deck.gl-community/infovis-layers';
import {commandManager} from '@deck.gl-community/panels';
import {CommandResetViewWidget} from '@deck.gl-community/widgets';
import {HeapMemoryWidget} from '@deck.gl-community/widgets';
import {buildTracevisViewLayout, DeckTraceGraphController} from '../../../layers/index';
import {type SpanBoundingBox} from '../../../trace/index';

import type {TraceDragInteractionMode} from '../../../layers/index';
import type {ZoomWidgetProps} from '@deck.gl/widgets';
import type {Bounds} from '@deck.gl-community/infovis-layers';
import type {Dispatch, SetStateAction} from 'react';
// @ts-expect-error typescript does not find the CSS files
import '@deck.gl/widgets/stylesheet.css';

// Attempt to fix the widget click through problem by stopping propagation of the fullscreen change event, which is what triggers the cursor update logic that causes the issue. This is a bit of a hack and may have unintended consequences, but it seems to work for now.
// class CustomFullscreenWidget extends FullscreenWidget {
//   // @ts-expect-error we want the event
//   override onFullscreenChange(e: Event): void {
//     super.onFullscreenChange();
//     e.stopPropagation();
//     e.preventDefault();
//   }
// }

const MAIN_VIEW_ID = 'main';
const INTERACTION_CAPTURE_VIEW_ID = 'interaction-capture';
const OVERVIEW_VIEW_ID = 'minimap';
const HEADER_VIEW_HEIGHT = 36;
const RUN_EVENT_VIEW_HEIGHT = 40;
const LEGEND_VIEW_WIDTH = 150;
const OVERVIEW_VIEW_HEIGHT = 150;
const OVERVIEW_MAX_ZOOM_Y = 4;
const DEFAULT_MAIN_ZOOM = [-5, 5] as const;
const MIN_ZOOM = [-12, 0] as const;
const MAX_ZOOM = [6, 6] as const;
const MAIN_X_ZOOM_FIT_HORIZONTAL_MARGIN_PX = 75;
const MAIN_X_ZOOM_OUT_BUFFER_LEVELS = 0.5;
const TRACEVIS_TRACE_CATALOG_WIDGET_ID = 'tracevis-trace-catalog';
const TRACEVIS_HELP_WIDGET_ID = 'tracevis-help';
const TRACEVIS_STUDIO_SETTINGS_WIDGET_ID = 'tracevis-studio-settings';
const TRACEVIS_HOVER_POPUP_WIDGET_ID = 'tracevis-hover-popup';
const TRACEVIS_OVERVIEW_TOGGLE_WIDGET_ID = 'tracevis-overview-toggle';
const TRACEVIS_MAIN_VERTICAL_SCROLLBAR_WIDGET_ID = 'tracevis-main-vertical-scrollbar';
const TRACEVIS_RESET_TIMELINE_WIDGET_ID = 'tracevis-reset-timeline-view';
const TRACEVIS_RESET_BOUNDS_WIDGET_ID = 'tracevis-reset-bounds-view';
const TRACEVIS_TIME_MEASURE_WIDGET_ID = 'time-measure';
const TRACEVIS_THEME_WIDGET_ID = 'tracevis-theme';
const TRACEVIS_ZOOM_WIDGET_DELTA = 0.25;
const TOP_LEFT_WIDGET_PRIORITY_ORDER = [
  TRACEVIS_TRACE_CATALOG_WIDGET_ID,
  TRACEVIS_HELP_WIDGET_ID
] as const;
const TOP_RIGHT_WIDGET_PRIORITY_ORDER = [
  TRACEVIS_HELP_WIDGET_ID,
  TRACEVIS_TIME_MEASURE_WIDGET_ID,
  TRACEVIS_STUDIO_SETTINGS_WIDGET_ID,
  TRACEVIS_THEME_WIDGET_ID,
  'fullscreen',
  TRACEVIS_RESET_TIMELINE_WIDGET_ID,
  TRACEVIS_RESET_BOUNDS_WIDGET_ID
] as const;
const OVERVIEW_SEPARATOR_WIDGET_ID = 'overview-separator';
const OVERVIEW_SEPARATOR_COLOR = 'rgba(148, 163, 184, 0.55)';
const OVERVIEW_SEPARATOR_SHADOW = '0 0 8px rgba(0, 0, 0, 0.2)';
const RESET_TIMELINE_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" fill="none" stroke="black" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 14h12"/><path d="M8 10l-4 4 4 4"/><path d="M20 10l4 4-4 4"/></svg>'
)}`;
const RESET_BOUNDS_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" fill="none" stroke="black" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 11 6 6"/><path d="M6 10V6h4"/><path d="M17 11l5-5"/><path d="M18 6h4v4"/><path d="M11 17l-5 5"/><path d="M6 18v4h4"/><path d="M17 17l5 5"/><path d="M18 22h4v-4"/></svg>'
)}`;
const MAIN_VERTICAL_SCROLLBAR_STYLE = {
  '--range-step-button-size': '0px',
  '--widget-margin': '0px'
} as Partial<CSSStyleDeclaration>;
const TOP_RIGHT_WIDGET_SCROLLBAR_OFFSET_STYLE = {
  marginRight: '20px'
} as Partial<CSSStyleDeclaration>;
const DECK_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'relative',
  left: '0',
  top: '0',
  height: '100%',
  width: '100%'
} satisfies Partial<CSSStyleDeclaration>;
const DECK_DEVICE_PROPS = Object.freeze({
  debug: false
});
/** Avoids deck.gl's default 2x typed-array capacity for trace-sized attribute buffers. */
const DECK_TYPED_ARRAY_MANAGER_PROPS = Object.freeze({
  overAlloc: 1,
  poolSize: 0
} satisfies NonNullable<DeckProps['_typedArrayManagerProps']>);

type LumaTimingQuerySet = {
  /** Reads resolved timestamp query values from the query set. */
  readResults: (options: {firstQuery: number; queryCount: number}) => Promise<Array<bigint>>;
  /** Releases the query-set resource. */
  destroy?: () => void;
};

type LumaTimingCommandEncoder = {
  /** Writes a timestamp query into the provided luma query set. */
  writeTimestamp: (querySet: LumaTimingQuerySet, queryIndex: number) => void;
};

type LumaTimingDevice = {
  /** Feature set advertised by luma's device adapter. */
  features?: ReadonlySet<string>;
  /** Current luma command encoder used by deck.gl's render loop. */
  commandEncoder?: LumaTimingCommandEncoder;
  /** Creates a luma query set resource. */
  createQuerySet?: (props: {id: string; type: 'timestamp'; count: number}) => LumaTimingQuerySet;
  /** Submits pending luma commands so timestamp queries can resolve. */
  submit?: () => void;
};

type GpuFrameTimerMetrics = {
  /** Most recent resolved GPU frame duration in milliseconds. */
  lastFrameMs: number | null;
  /** Rolling average GPU frame duration in milliseconds. */
  averageFrameMs: number | null;
  /** Number of resolved GPU frame timings. */
  sampleCount: number;
};

type DeckStatsTarget = {
  /** Deck's probe.gl stats object. Protected in TypeScript, present at runtime. */
  stats?: {
    get?: (
      name: string,
      type?: string
    ) => {
      addTime?: (timeMs: number) => void;
      time?: number;
      getAverageTime?: () => number;
    };
  };
  /** Deck's metrics object consumed by the built-in StatsWidget. */
  metrics?: {
    gpuTime?: number;
    gpuTimePerFrame?: number;
  };
};

type TraceZoomWidgetProps = ZoomWidgetProps & {
  /** Zoom-level delta applied by each plus or minus button press. */
  readonly zoomDelta?: number;
};

/** A deck.gl zoom widget variant with a configurable button step size. */
class TraceZoomWidget extends ZoomWidget {
  constructor(props: TraceZoomWidgetProps = {}) {
    super(props);
  }

  /** Zooms the controlled view in using the configured Tracevis button step. */
  override handleZoomIn() {
    this.handleZoomBy(this.getZoomDelta());
  }

  /** Zooms the controlled view out using the configured Tracevis button step. */
  override handleZoomOut() {
    this.handleZoomBy(-this.getZoomDelta());
  }

  /** Returns the positive zoom-level step applied by one button press. */
  private getZoomDelta(): number {
    const zoomDelta = (this.props as ZoomWidgetProps & {zoomDelta?: number}).zoomDelta;
    return typeof zoomDelta === 'number' && Number.isFinite(zoomDelta) && zoomDelta > 0
      ? zoomDelta
      : TRACEVIS_ZOOM_WIDGET_DELTA;
  }

  /** Applies a signed zoom delta to every view controlled by this widget. */
  private handleZoomBy(delta: number) {
    const viewIds = this.viewId
      ? [this.viewId]
      : (this.deck?.getViews().map(view => view.id) ?? []);
    for (const viewId of viewIds) {
      this.handleZoom(viewId, delta);
    }
  }
}

/** Options for imperative managed deck view updates. */
export type DeckWithManagedViewUpdateOptions = {
  /** Whether the view update should animate with the default transition. */
  transition?: boolean;
  /** Optional transition duration in milliseconds when `transition` is enabled. */
  transitionDurationMs?: number;
};

/** One-shot main-view Y correction that preserves a layout anchor across row relayout. */
export type DeckWithManagedViewsAnchorTransition = {
  /** Stable transition identity used to apply each correction at most once. */
  readonly key: string;
  /** Trace-coordinate Y delta between the old and new anchor positions. */
  readonly deltaY: number;
};

/** Pixel dimensions reported by deck.gl for the managed deck canvas. */
export type ManagedDeckViewDimensions = {
  /** Current deck canvas width in pixels. */
  readonly width: number;
  /** Current deck canvas height in pixels. */
  readonly height: number;
};

/** Parameters for building the synchronized deck views used by Tracevis. */
export type BuildManagedDeckViewsParams = {
  /** Current deck canvas dimensions in pixels. */
  readonly deckDimensions: ManagedDeckViewDimensions;
  /** Whether process labels render over the timeline instead of reserving a legend column. */
  readonly collapseLegendToProcessLabelOverlay: boolean;
  /** Whether the fixed run-event strip should be included below the header. */
  readonly isRunEventViewEnabled: boolean;
  /** Whether the overview minimap view should be included. */
  readonly isOverviewEnabled: boolean;
  /** Trackpad swipe behavior configured for timeline navigation. */
  readonly traceDragInteractionMode: TraceDragInteractionMode;
};

/** Parameters for deriving the minimum main-view X zoom. */
export type BuildManagedMainMinZoomXParams = {
  /** Current deck canvas width in pixels. */
  readonly deckWidth: number;
  /** Main trace bounds used when the overview minimap is disabled. */
  readonly bounds: Bounds;
  /** Optional overview-specific bounds used when the overview minimap is enabled. */
  readonly overviewBounds?: Bounds;
  /** Whether overview-specific bounds should drive the horizontal fit floor. */
  readonly isOverviewEnabled: boolean;
  /** Whether process labels render over the timeline instead of reserving a legend column. */
  readonly collapseLegendToProcessLabelOverlay: boolean;
};

/** Parameters for deriving the overview minimap view state. */
export type BuildManagedOverviewViewStateParams = {
  /** Current deck canvas dimensions in pixels. */
  readonly deckDimensions: ManagedDeckViewDimensions;
  /** Main trace bounds used when no overview-specific bounds are provided. */
  readonly bounds: Bounds;
  /** Optional overview-specific bounds used for minimap fitting. */
  readonly overviewBounds?: Bounds;
  /** Whether the overview minimap is enabled. */
  readonly isOverviewEnabled: boolean;
};

/** Applies an anchor transition to a main orthographic view state without changing zoom or X. */
export function applyDeckViewAnchorTransition(
  viewState: OrthographicViewState,
  transition: DeckWithManagedViewsAnchorTransition
): OrthographicViewState {
  const target = viewState.target ?? [0, 0, 0];
  const targetY = (target[1] ?? 0) + transition.deltaY;
  if (!Number.isFinite(targetY)) {
    return viewState;
  }
  return {
    ...viewState,
    target: [target[0] ?? 0, targetY, target[2] ?? 0],
    transitionDuration: 0,
    transitionInterpolator: undefined
  };
}

/** Builds the synchronized deck.gl views for the current managed Tracevis view layout. */
export function buildManagedDeckViews({
  deckDimensions,
  collapseLegendToProcessLabelOverlay,
  isRunEventViewEnabled,
  isOverviewEnabled,
  traceDragInteractionMode
}: BuildManagedDeckViewsParams): OrthographicView[] {
  return buildViewsFromViewLayout({
    layout: buildTracevisViewLayout({
      headerViewHeight: HEADER_VIEW_HEIGHT,
      collapseLegendToProcessLabelOverlay,
      runEventViewHeight: isRunEventViewEnabled ? RUN_EVENT_VIEW_HEIGHT : 0,
      minimap: isOverviewEnabled,
      minimapViewHeight: OVERVIEW_VIEW_HEIGHT,
      traceDragInteractionMode
    }),
    width: deckDimensions.width,
    height: deckDimensions.height
  }).views as OrthographicView[];
}

/** Builds the smallest allowed X zoom for the managed main timeline view. */
export function buildManagedMainMinZoomX({
  deckWidth,
  bounds,
  overviewBounds,
  isOverviewEnabled,
  collapseLegendToProcessLabelOverlay
}: BuildManagedMainMinZoomXParams): number {
  return getMainMinZoomX({
    deckWidth,
    bounds: isOverviewEnabled ? (overviewBounds ?? bounds) : bounds,
    reservedLegendViewWidth: collapseLegendToProcessLabelOverlay ? 0 : LEGEND_VIEW_WIDTH
  });
}

/** Builds the managed overview minimap view state, including Tracevis' Y-zoom cap. */
export function buildManagedOverviewViewState({
  deckDimensions,
  bounds,
  overviewBounds,
  isOverviewEnabled
}: BuildManagedOverviewViewStateParams): Partial<OrthographicViewState> {
  if (!isOverviewEnabled) {
    return {};
  }

  return capOverviewViewStateZoomY(
    fitBoundsOrthographic(
      deckDimensions.width,
      OVERVIEW_VIEW_HEIGHT,
      overviewBounds ?? bounds,
      'per-axis'
    )
  );
}

/** Applies render-time constraints to a main view state without mutating the source state. */
export function applyManagedMainViewConstraints(
  viewState: OrthographicViewState,
  mainMinZoomX: number
): OrthographicViewState {
  if (viewState.minZoomX === mainMinZoomX) {
    return viewState;
  }
  return {
    ...viewState,
    minZoomX: mainMinZoomX
  };
}

/**
 * Owns one luma timestamp query set and mirrors resolved frame durations into deck stats.
 */
class GpuFrameTimer {
  /** Resolved GPU timing samples exposed for debugging and tests. */
  readonly metrics: GpuFrameTimerMetrics = {
    lastFrameMs: null,
    averageFrameMs: null,
    sampleCount: 0
  };

  /** Luma device that owns the current query set. */
  private device: LumaTimingDevice | null = null;
  /** Returns the current deck instance whose stats should receive resolved timings. */
  private getDeck: () => DeckStatsTarget | null;
  /** Whether the first timestamp has been written without a matching end timestamp. */
  private isActive = false;
  /** Whether an asynchronous query result read is currently pending. */
  private isReading = false;
  /** Two-slot timestamp query set reused across frames while the luma device is stable. */
  private querySet: LumaTimingQuerySet | null = null;

  /**
   * Creates a timer that reports resolved durations into the current deck instance.
   */
  constructor(getDeck: () => DeckStatsTarget | null) {
    this.getDeck = getDeck;
  }

  /**
   * Updates the deck lookup used when async query results resolve.
   */
  setDeckGetter(getDeck: () => DeckStatsTarget | null): void {
    this.getDeck = getDeck;
  }

  /**
   * Releases any live query set and clears in-flight frame state.
   */
  reset(): void {
    this.querySet?.destroy?.();
    this.device = null;
    this.querySet = null;
    this.isActive = false;
    this.isReading = false;
  }

  /**
   * Writes the start timestamp for one deck render frame.
   */
  beginFrame(device: unknown): void {
    const timingDevice = getLumaTimingDevice(device);
    const querySet = this.getQuerySet(timingDevice);
    if (!querySet || !timingDevice?.commandEncoder || this.isActive || this.isReading) {
      return;
    }

    timingDevice.commandEncoder.writeTimestamp(querySet, 0);
    this.isActive = true;
  }

  /**
   * Writes the end timestamp and starts resolving the current frame query.
   */
  endFrame(device: unknown): void {
    const timingDevice = getLumaTimingDevice(device);
    const querySet = this.getQuerySet(timingDevice);
    if (!querySet || !timingDevice?.commandEncoder || !this.isActive) {
      return;
    }

    timingDevice.commandEncoder.writeTimestamp(querySet, 1);
    timingDevice.submit?.();
    this.isActive = false;
    this.collectResults(querySet);
  }

  /**
   * Returns the query set for the active timing device, recreating it when deck swaps devices.
   */
  private getQuerySet(device: LumaTimingDevice | null): LumaTimingQuerySet | null {
    if (!device?.features?.has('timestamp-query') || typeof device.createQuerySet !== 'function') {
      return null;
    }
    if (this.device !== device) {
      this.reset();
      this.device = device;
    }
    this.querySet ??= device.createQuerySet({
      id: 'trace-gpu-frame-timing-query-set',
      type: 'timestamp',
      count: 2
    });
    return this.querySet;
  }

  /**
   * Reads the timestamp pair and updates the StatsWidget-facing deck metrics.
   */
  private collectResults(querySet: LumaTimingQuerySet): void {
    if (this.isReading) {
      return;
    }
    this.isReading = true;
    querySet
      .readResults({firstQuery: 0, queryCount: 2})
      .then(results => {
        const startTimeNs = Number(results[0] ?? 0n);
        const endTimeNs = Number(results[1] ?? 0n);
        const durationMs = Math.max(0, (endTimeNs - startTimeNs) / 1e6);
        if (Number.isFinite(durationMs)) {
          this.recordDuration(durationMs);
        }
      })
      .catch(() => {
        // GPU timing is best-effort debug telemetry. Ignore unavailable or disjoint timer results.
      })
      .finally(() => {
        this.isReading = false;
      });
  }

  /**
   * Stores one resolved duration and publishes it to deck's stat surfaces.
   */
  private recordDuration(durationMs: number): void {
    this.metrics.lastFrameMs = durationMs;
    this.metrics.sampleCount += 1;
    this.metrics.averageFrameMs =
      this.metrics.averageFrameMs == null
        ? durationMs
        : this.metrics.averageFrameMs +
          (durationMs - this.metrics.averageFrameMs) / this.metrics.sampleCount;
    updateDeckGpuTimeStats(this.getDeck(), durationMs);
  }
}

/**
 * Creates callbacks that record one GPU timestamp pair around deck.gl's outer frame render.
 */
function useGpuFrameTimer(enabled: boolean, getDeck: () => DeckStatsTarget | null) {
  const enabledRef = useRef(enabled);
  const timerRef = useRef<GpuFrameTimer | null>(null);
  enabledRef.current = enabled;
  timerRef.current ??= new GpuFrameTimer(getDeck);
  timerRef.current.setDeckGetter(getDeck);

  useEffect(() => {
    const timer = timerRef.current;
    if (!timer) {
      return undefined;
    }
    if (!enabled) {
      timer.reset();
      return undefined;
    }
    return () => timer.reset();
  }, [enabled]);

  const handleBeforeRender = useCallback(
    ({device}: {device: unknown; gl: WebGL2RenderingContext}) => {
      if (enabledRef.current) {
        timerRef.current?.beginFrame(device);
      }
    },
    []
  );

  const handleAfterRender = useCallback(
    ({device}: {device: unknown; gl: WebGL2RenderingContext}) => {
      if (enabledRef.current) {
        timerRef.current?.endFrame(device);
      }
    },
    []
  );

  return {
    handleAfterRender,
    handleBeforeRender,
    metrics: timerRef.current.metrics
  };
}

/**
 * Returns deck widgets with managed placement-local priorities applied.
 */
function prioritizeManagedWidgets(widgets: Widget[]): Widget[] {
  const prioritizedTopLeftWidgets: Widget[] = [];
  const prioritizedTopRightWidgets: Widget[] = [];
  const remainingWidgets: Widget[] = [];
  const topLeftPriorityIds = new Set<string>(TOP_LEFT_WIDGET_PRIORITY_ORDER);
  const topRightPriorityIds = new Set<string>(TOP_RIGHT_WIDGET_PRIORITY_ORDER);

  for (const widget of widgets) {
    if (widget.placement === 'top-left' && topLeftPriorityIds.has(widget.props.id ?? '')) {
      prioritizedTopLeftWidgets.push(widget);
      continue;
    }
    if (widget.placement === 'top-right' && topRightPriorityIds.has(widget.props.id ?? '')) {
      prioritizedTopRightWidgets.push(widget);
      continue;
    }
    remainingWidgets.push(widget);
  }

  prioritizedTopLeftWidgets.sort(
    (left, right) =>
      TOP_LEFT_WIDGET_PRIORITY_ORDER.indexOf(
        (left.props.id ?? '') as (typeof TOP_LEFT_WIDGET_PRIORITY_ORDER)[number]
      ) -
      TOP_LEFT_WIDGET_PRIORITY_ORDER.indexOf(
        (right.props.id ?? '') as (typeof TOP_LEFT_WIDGET_PRIORITY_ORDER)[number]
      )
  );
  prioritizedTopRightWidgets.sort(
    (left, right) =>
      TOP_RIGHT_WIDGET_PRIORITY_ORDER.indexOf(
        (left.props.id ?? '') as (typeof TOP_RIGHT_WIDGET_PRIORITY_ORDER)[number]
      ) -
      TOP_RIGHT_WIDGET_PRIORITY_ORDER.indexOf(
        (right.props.id ?? '') as (typeof TOP_RIGHT_WIDGET_PRIORITY_ORDER)[number]
      )
  );

  return [...prioritizedTopLeftWidgets, ...prioritizedTopRightWidgets, ...remainingWidgets];
}

/**
 * Deck widget that renders the overview separator inside the widget layer.
 */
class OverviewSeparatorWidget extends Widget {
  static override defaultProps = {
    ...Widget.defaultProps,
    id: OVERVIEW_SEPARATOR_WIDGET_ID,
    placement: 'bottom-left' as const
  };

  className = 'deck-widget-overview-separator';
  placement = 'bottom-left' as const;

  /**
   * Creates one overview separator widget.
   */
  constructor(props: Partial<Widget['props']> = {}) {
    super({
      ...OverviewSeparatorWidget.defaultProps,
      ...props
    });
  }

  /**
   * Renders the overview separator into the widget root.
   */
  override onRenderHTML(rootElement: HTMLElement): void {
    rootElement.className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');
    rootElement.style.position = 'absolute';
    rootElement.style.left = '0';
    rootElement.style.right = '0';
    rootElement.style.bottom = '0';
    rootElement.style.height = `${OVERVIEW_VIEW_HEIGHT}px`;
    rootElement.style.width = '100%';
    rootElement.style.margin = '0';
    rootElement.style.padding = '0';
    rootElement.style.pointerEvents = 'none';
    rootElement.replaceChildren();

    const separatorElement = document.createElement('hr');
    separatorElement.setAttribute('aria-hidden', 'true');
    separatorElement.style.height = `${OVERVIEW_VIEW_HEIGHT}px`;
    separatorElement.style.width = '100%';
    separatorElement.style.margin = '0';
    separatorElement.style.border = '0';
    separatorElement.style.borderTop = `1px solid ${OVERVIEW_SEPARATOR_COLOR}`;
    separatorElement.style.backgroundColor = 'transparent';
    separatorElement.style.boxShadow = OVERVIEW_SEPARATOR_SHADOW;
    separatorElement.style.pointerEvents = 'none';
    rootElement.append(separatorElement);
  }
}

export type DeckWithManagedViewsRef = {
  /** Resets the main view to fit the provided bounds. */
  resetView: (bounds: Bounds) => void;
  /** Zooms the main view to the provided block geometry. */
  zoomToSpan: (block: SpanBoundingBox) => void;
  /** Centers the main view on the provided block geometry. */
  centerOnSpan: (block: SpanBoundingBox) => void;
  /** Tracks the provided time at the preferred horizontal screen anchor. */
  trackTime: (timeMs: number) => void;
  /** Fits the main view to the provided vertical graph bounds. */
  fitYToBounds: (bounds: Bounds) => void;
  /** Centers the main view on time while fitting the provided vertical graph bounds. */
  centerOnTimeAndFitY: (timeMs: number, bounds: Bounds) => void;
  /** Pans the main view to an absolute target position. */
  panTo: (target: [x: number, y: number], options?: DeckWithManagedViewUpdateOptions) => void;
  /** Pans the main view by a viewport-pixel delta. */
  panBy: (x: number, y: number, options?: DeckWithManagedViewUpdateOptions) => void;
  /** Changes the main view X zoom by the provided delta. */
  zoomXBy: (delta: number, options?: DeckWithManagedViewUpdateOptions) => void;
  /** Returns the current synchronized main-view state. */
  getMainViewState: () => OrthographicViewState | null;
};

type ManagedDeckViewStateSetter = Dispatch<SetStateAction<OrthographicViewState>>;

type ManagedDeckViewSessionParams = {
  /** Returns the current deck.gl React ref target. */
  readonly getDeckRef: () => DeckGLRef<OrthographicView[]> | null;
  /** Publishes the next main view state to React. */
  readonly setMainViewState: ManagedDeckViewStateSetter;
};

/**
 * Owns imperative managed-view state that should stay outside React render derivation.
 */
class ManagedDeckViewSession {
  private readonly controller: DeckTraceGraphController;
  private readonly getDeckRef: () => DeckGLRef<OrthographicView[]> | null;
  private readonly setMainViewState: ManagedDeckViewStateSetter;
  private bounds: Bounds = [
    [0, 0],
    [0, 0]
  ];
  private currentMainViewState: OrthographicViewState = {
    target: [0, 0],
    zoomX: DEFAULT_MAIN_ZOOM[0],
    zoomY: DEFAULT_MAIN_ZOOM[1],
    minZoomX: MIN_ZOOM[0],
    maxZoomX: MAX_ZOOM[0],
    minZoomY: MIN_ZOOM[1],
    maxZoomY: MAX_ZOOM[1]
  };
  private currentOverviewViewState: Partial<OrthographicViewState> = {};
  private mainMinZoomX: number = MIN_ZOOM[0];
  private pendingControllerRequest: (() => OrthographicViewState | null) | null = null;
  private minimapDragAnchor: {
    mainTargetX: number;
    overviewTargetX: number;
  } | null = null;
  private appliedViewAnchorTransitionKey: string | null = null;
  private previousMainViewportHeight: number | null = null;

  /** Imperative API exposed through React's forwarded ref. */
  readonly imperativeHandle: DeckWithManagedViewsRef = {
    resetView: bounds => {
      this.updateViewStateFromController(() => this.controller.fitToBounds(bounds, true));
    },
    zoomToSpan: block => {
      this.updateViewStateFromController(() => this.controller.zoomToSpan(block));
    },
    centerOnSpan: block => {
      this.updateViewStateFromController(() => this.controller.centerOnSpan(block));
    },
    trackTime: timeMs => {
      this.updateViewStateFromController(() => this.controller.trackTime(timeMs));
    },
    fitYToBounds: bounds => {
      this.updateViewStateFromController(() => this.controller.fitYToBounds(bounds));
    },
    centerOnTimeAndFitY: (timeMs, bounds) => {
      this.updateViewStateFromController(() => this.controller.centerOnTimeAndFitY(timeMs, bounds));
    },
    panTo: (target, options) => {
      this.updateViewStateFromController(() =>
        this.controller.panTo(target, {
          transition: options?.transition ?? true,
          transitionDurationMs: options?.transitionDurationMs
        })
      );
    },
    panBy: (x, y, options) => {
      this.updateViewStateFromController(() =>
        this.controller.panBy([x, y], {
          transition: options?.transition ?? true,
          transitionDurationMs: options?.transitionDurationMs
        })
      );
    },
    zoomXBy: (delta, options) => {
      this.updateViewStateFromController(() =>
        this.controller.zoomXBy(delta, {
          transition: options?.transition ?? true,
          transitionDurationMs: options?.transitionDurationMs
        })
      );
    },
    getMainViewState: () => this.currentMainViewState ?? null
  };

  /**
   * Creates one managed-view session for a mounted deck wrapper.
   */
  constructor({getDeckRef, setMainViewState}: ManagedDeckViewSessionParams) {
    this.getDeckRef = getDeckRef;
    this.setMainViewState = setMainViewState;
    this.controller = new DeckTraceGraphController(
      () =>
        ({
          ...this.currentMainViewState,
          minZoom: this.mainMinZoomX
        }) as any
    );
  }

  /** Stores the current trace bounds used by reset commands. */
  setBounds(bounds: Bounds): void {
    this.bounds = bounds;
  }

  /** Stores the current main-view X zoom floor. */
  setMainMinZoomX(mainMinZoomX: number): void {
    this.mainMinZoomX = mainMinZoomX;
  }

  /** Stores the latest render-facing main view state. */
  setCurrentMainViewState(viewState: OrthographicViewState): void {
    this.currentMainViewState = applyManagedMainViewConstraints(viewState, this.mainMinZoomX);
  }

  /** Stores the latest render-facing overview view state. */
  setCurrentOverviewViewState(viewState: Partial<OrthographicViewState>): void {
    this.currentOverviewViewState = viewState;
  }

  /** Applies a one-shot focused-layout anchor transition when its key changes. */
  applyAnchorTransition(transition: DeckWithManagedViewsAnchorTransition | null): void {
    if (!transition || this.appliedViewAnchorTransitionKey === transition.key) {
      return;
    }
    this.appliedViewAnchorTransitionKey = transition.key;
    if (!Number.isFinite(transition.deltaY) || Math.abs(transition.deltaY) < 1e-3) {
      return;
    }
    this.updateMainViewState(previousViewState =>
      applyDeckViewAnchorTransition(previousViewState, transition)
    );
  }

  /** Replays a deferred controller request once deck dimensions are available. */
  flushPendingControllerRequest(deckDimensions: ManagedDeckViewDimensions): void {
    if (!deckDimensions.width || !deckDimensions.height || !this.pendingControllerRequest) {
      return;
    }
    this.updateViewStateFromController(this.pendingControllerRequest);
  }

  /** Preserves the main view's top edge when the vertical viewport height changes. */
  preserveMainViewportTopEdge(deckHeight: number, isOverviewEnabled: boolean): void {
    if (!deckHeight) {
      return;
    }

    const nextMainViewportHeight = getMainViewportHeight(deckHeight, isOverviewEnabled);
    const previousMainViewportHeight = this.previousMainViewportHeight;
    this.previousMainViewportHeight = nextMainViewportHeight;
    if (
      previousMainViewportHeight == null ||
      previousMainViewportHeight === nextMainViewportHeight
    ) {
      return;
    }

    this.updateMainViewState(previousViewState =>
      preserveMainViewTopEdge(previousViewState, previousMainViewportHeight, nextMainViewportHeight)
    );
  }

  /** Updates the main view in response to deck.gl view-state changes. */
  readonly handleViewStateChange = ({
    viewState,
    viewId,
    oldViewState,
    interactionState
  }: ViewStateChangeParameters<OrthographicViewState>): void => {
    if (viewId === MAIN_VIEW_ID || viewId === INTERACTION_CAPTURE_VIEW_ID) {
      this.publishMainViewState(viewState);
      return;
    }
    if (viewId !== OVERVIEW_VIEW_ID) {
      return;
    }

    const targetX = viewState.target?.[0];
    const oldTargetX = oldViewState?.target?.[0] ?? this.currentOverviewViewState.target?.[0];
    if (
      typeof targetX !== 'number' ||
      !Number.isFinite(targetX) ||
      typeof oldTargetX !== 'number' ||
      !Number.isFinite(oldTargetX)
    ) {
      return;
    }

    const isActivePan = Boolean(interactionState?.isPanning || interactionState?.isDragging);
    this.updateMainViewState(previousViewState => {
      const anchor = this.minimapDragAnchor ?? {
        mainTargetX: previousViewState.target?.[0] ?? 0,
        overviewTargetX: oldTargetX
      };
      this.minimapDragAnchor = isActivePan ? anchor : null;
      return {
        ...previousViewState,
        target: [
          anchor.mainTargetX - (targetX - anchor.overviewTargetX),
          previousViewState.target?.[1] ?? 0
        ],
        transitionDuration: 0
      };
    });
  };

  /** Resets the main view to the current timeline bounds. */
  readonly resetTimelineView = (): void => {
    this.updateViewStateFromController(() => this.controller.fitToBounds(this.bounds, true));
  };

  /** Resets the main view to the current full trace bounds. */
  readonly resetEntireBoundsView = (): void => {
    this.updateViewStateFromController(() => this.controller.fitEntireBounds(this.bounds, true));
  };

  private updateViewStateFromController(getViewState: () => OrthographicViewState | null): void {
    const dims = getViewportDimensions(this.getDeckRef(), MAIN_VIEW_ID);
    if (!dims) {
      this.pendingControllerRequest = getViewState;
      return;
    }
    this.controller.width = dims.width;
    this.controller.height = dims.height;
    const nextViewState = getViewState();
    if (nextViewState) {
      this.publishMainViewState(nextViewState);
    }
    this.pendingControllerRequest = null;
  }

  private updateMainViewState(
    buildNextViewState: (viewState: OrthographicViewState) => OrthographicViewState
  ): void {
    this.setMainViewState(previousViewState => {
      const constrainedPreviousViewState = applyManagedMainViewConstraints(
        previousViewState,
        this.mainMinZoomX
      );
      const nextViewState = applyManagedMainViewConstraints(
        buildNextViewState(constrainedPreviousViewState),
        this.mainMinZoomX
      );
      this.currentMainViewState = nextViewState;
      return nextViewState;
    });
  }

  private publishMainViewState(viewState: OrthographicViewState): void {
    const nextViewState = applyManagedMainViewConstraints(viewState, this.mainMinZoomX);
    this.currentMainViewState = nextViewState;
    this.setMainViewState(nextViewState);
  }
}

function DeckWithManagedViewsWithRef(
  {
    bounds,
    overviewBounds,
    layers,
    layerFilter,
    widgets = [],
    onHover,
    onClick,
    isOverviewEnabled = false,
    isRunEventViewEnabled = false,
    collapseLegendToProcessLabelOverlay = false,
    showMainVerticalScrollbar = false,
    showDefaultWidgets = false,
    interactionMode = null,
    traceDragInteractionMode = 'drag-to-zoom',
    enableDeckGpuTimeStats = false,
    enableDeckAnimation = false,
    viewAnchorTransition = null,
    deckTheme = LightTheme
  }: {
    bounds: Bounds;
    /** Optional bounds used only for fitting the overview minimap. */
    overviewBounds?: Bounds;
    layers: DeckProps['layers'];
    layerFilter: DeckProps['layerFilter'];
    widgets: DeckProps['widgets'];
    onHover: DeckProps['onHover'];
    onClick: DeckProps['onClick'];
    isOverviewEnabled?: boolean;
    /** Whether to reserve the fixed run-event strip below the header. */
    isRunEventViewEnabled?: boolean;
    /** Whether the timeline should use full width while process labels render over the left edge. */
    collapseLegendToProcessLabelOverlay?: boolean;
    /** Whether to render a vertical scrollbar scoped to the main timeline view. */
    showMainVerticalScrollbar?: boolean;
    /** Whether to render Tracevis-owned default deck widgets. Defaults to false. */
    showDefaultWidgets?: boolean;
    interactionMode?: 'measure-time' | null;
    /** Trackpad swipe behavior used for timeline navigation. */
    traceDragInteractionMode?: TraceDragInteractionMode;
    /** Whether to collect app-owned luma timestamp queries for Deck GPU timing stats. */
    enableDeckGpuTimeStats?: boolean;
    /** Whether deck.gl should continuously redraw for active layer animations. */
    enableDeckAnimation?: boolean;
    /** Optional one-shot Y correction for preserving an anchor across a trace layout transition. */
    viewAnchorTransition?: DeckWithManagedViewsAnchorTransition | null;
    deckTheme?: DeckWidgetTheme;
  },
  ref: React.Ref<DeckWithManagedViewsRef>
) {
  const deckRef = useRef<DeckGLRef<OrthographicView[]>>(null);
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const [isWidgetContainerReady, setIsWidgetContainerReady] = useState(false);

  const [deckDimensions, setDeckDimensions] = useState<{width: number; height: number}>({
    width: 0,
    height: 0
  });
  const deckViews = useMemo(
    () =>
      buildManagedDeckViews({
        deckDimensions,
        collapseLegendToProcessLabelOverlay,
        isRunEventViewEnabled,
        isOverviewEnabled,
        traceDragInteractionMode
      }),
    [
      collapseLegendToProcessLabelOverlay,
      deckDimensions,
      isOverviewEnabled,
      isRunEventViewEnabled,
      traceDragInteractionMode
    ]
  );
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const mainMinZoomX = buildManagedMainMinZoomX({
    deckWidth: deckDimensions.width,
    bounds,
    overviewBounds,
    isOverviewEnabled,
    collapseLegendToProcessLabelOverlay
  });

  const [mainViewState, setMainViewState] = useState<OrthographicViewState>({
    target: [0, 0],
    zoomX: DEFAULT_MAIN_ZOOM[0],
    zoomY: DEFAULT_MAIN_ZOOM[1],
    minZoomX: mainMinZoomX,
    maxZoomX: MAX_ZOOM[0],
    minZoomY: MIN_ZOOM[1],
    maxZoomY: MAX_ZOOM[1]
  });
  const managedMainViewState = applyManagedMainViewConstraints(mainViewState, mainMinZoomX);
  const viewSessionRef = useRef<ManagedDeckViewSession | null>(null);
  viewSessionRef.current ??= new ManagedDeckViewSession({
    getDeckRef: () => deckRef.current,
    setMainViewState
  });
  const viewSession = viewSessionRef.current;
  viewSession.setBounds(bounds);
  viewSession.setMainMinZoomX(mainMinZoomX);
  viewSession.setCurrentMainViewState(managedMainViewState);
  const overviewViewState = useMemo(
    () =>
      buildManagedOverviewViewState({
        deckDimensions,
        bounds,
        overviewBounds,
        isOverviewEnabled
      }),
    [bounds, deckDimensions, isOverviewEnabled, overviewBounds]
  );
  viewSession.setCurrentOverviewViewState(overviewViewState);

  useLayoutEffect(() => {
    if (widgetContainerRef.current) {
      setIsWidgetContainerReady(true);
    }
  }, []);

  // Track whether the initial auto-fit has been applied so later layout changes
  // don't recentre the user's current view.
  useEffect(() => {
    viewSession.flushPendingControllerRequest(deckDimensions);
  }, [deckDimensions, viewSession]);

  useLayoutEffect(() => {
    viewSession.preserveMainViewportTopEdge(deckDimensions.height, isOverviewEnabled);
  }, [deckDimensions.height, isOverviewEnabled, viewSession]);

  useLayoutEffect(() => {
    viewSession.applyAnchorTransition(viewAnchorTransition);
  }, [viewAnchorTransition?.deltaY, viewAnchorTransition?.key, viewSession]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setIsShiftPressed(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setIsShiftPressed(false);
      }
    };
    const handleBlur = () => {
      setIsShiftPressed(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  useImperativeHandle(ref, () => viewSession.imperativeHandle, [viewSession]);

  const getCursor = useCallback(
    ({isHovering}: {isHovering: boolean}) =>
      interactionMode === 'measure-time' || isShiftPressed
        ? 'ew-resize'
        : isHovering
          ? 'pointer'
          : 'grab',
    [interactionMode, isShiftPressed]
  );
  const getDeckStatsTarget = useCallback(
    () => (deckRef.current?.deck as unknown as DeckStatsTarget | undefined) ?? null,
    []
  );
  const gpuFrameTimer = useGpuFrameTimer(enableDeckGpuTimeStats, getDeckStatsTarget);
  const resetTimelineView = viewSession.resetTimelineView;
  const resetEntireBoundsView = viewSession.resetEntireBoundsView;

  useEffect(() => {
    commandManager.registerCommand({
      id: TRACEVIS_RESET_TIMELINE_WIDGET_ID,
      label: 'Show full timeline',
      description: 'Resets the trace viewport to show the full timeline.',
      exposure: 'all',
      do: resetTimelineView
    });
    commandManager.registerCommand({
      id: TRACEVIS_RESET_BOUNDS_WIDGET_ID,
      label: 'Show entire trace',
      description: 'Resets the trace viewport to show the entire trace bounds.',
      exposure: 'all',
      do: resetEntireBoundsView
    });
  }, [resetEntireBoundsView, resetTimelineView]);

  const combinedWidgets = useMemo(() => {
    const widgetContainer = widgetContainerRef.current;
    if (!widgetContainer) return [];

    const mainVerticalScrollbarWidget = showMainVerticalScrollbar
      ? new ScrollbarWidget({
          id: TRACEVIS_MAIN_VERTICAL_SCROLLBAR_WIDGET_ID,
          viewId: MAIN_VIEW_ID,
          orientation: 'vertical',
          placement: 'top-right',
          contentBounds: bounds,
          startButtonAriaLabel: 'Scroll timeline rows up',
          endButtonAriaLabel: 'Scroll timeline rows down',
          style: MAIN_VERTICAL_SCROLLBAR_STYLE
        })
      : null;
    const defaultWidgets = showDefaultWidgets
      ? [
          new FullscreenWidget({
            id: 'fullscreen',
            container: widgetContainer,
            placement: 'top-right'
          }),
          new TraceZoomWidget({
            viewId: MAIN_VIEW_ID,
            placement: 'top-right',
            zoomAxis: 'Y',
            zoomDelta: TRACEVIS_ZOOM_WIDGET_DELTA
          }),
          new CommandResetViewWidget({
            id: TRACEVIS_RESET_TIMELINE_WIDGET_ID,
            commandId: TRACEVIS_RESET_TIMELINE_WIDGET_ID,
            placement: 'top-right',
            label: 'Show full timeline',
            icon: RESET_TIMELINE_ICON,
            tooltipPlacement: 'left',
            onCommand: resetTimelineView
          }),
          new CommandResetViewWidget({
            id: TRACEVIS_RESET_BOUNDS_WIDGET_ID,
            commandId: TRACEVIS_RESET_BOUNDS_WIDGET_ID,
            placement: 'top-right',
            label: 'Show Entire Trace',
            icon: RESET_BOUNDS_ICON,
            tooltipPlacement: 'left',
            onCommand: resetEntireBoundsView
          }),
          new HeapMemoryWidget({placement: 'top-right'}),
          new StatsWidget({
            id: 'deck-stats',
            title: 'Deck Stats',
            placement: 'top-right',
            style: {
              marginTop: '0px'
            }
          }),
          ...(isOverviewEnabled ? [new OverviewSeparatorWidget()] : [])
        ]
      : [];
    const arr = [
      ...(mainVerticalScrollbarWidget ? [mainVerticalScrollbarWidget] : []),
      ...prioritizeManagedWidgets([...widgets, ...defaultWidgets])
    ];

    for (const widget of arr) {
      if (
        showMainVerticalScrollbar &&
        widget.placement === 'top-right' &&
        widget.props.id !== TRACEVIS_MAIN_VERTICAL_SCROLLBAR_WIDGET_ID
      ) {
        widget.props.style = {
          ...widget.props.style,
          ...TOP_RIGHT_WIDGET_SCROLLBAR_OFFSET_STYLE
        };
      }
      if (
        widget.props.id === TRACEVIS_TRACE_CATALOG_WIDGET_ID ||
        widget.props.id === TRACEVIS_HOVER_POPUP_WIDGET_ID ||
        widget.props.id === TRACEVIS_OVERVIEW_TOGGLE_WIDGET_ID ||
        widget.props.id === OVERVIEW_SEPARATOR_WIDGET_ID
      ) {
        widget.props._container = null;
        continue;
      }
      if (widget.props.id === TRACEVIS_MAIN_VERTICAL_SCROLLBAR_WIDGET_ID) {
        widget.props._container = MAIN_VIEW_ID;
        continue;
      }
      widget.props._container = INTERACTION_CAPTURE_VIEW_ID;
    }

    return arr;
  }, [
    bounds,
    isOverviewEnabled,
    isWidgetContainerReady,
    resetEntireBoundsView,
    resetTimelineView,
    showDefaultWidgets,
    showMainVerticalScrollbar,
    widgets
  ]);

  return (
    <div
      className="absolute w-full h-full bg-white overflow-hidden"
      ref={widgetContainerRef}
      style={deckTheme as any}
    >
      <DeckGL<OrthographicView[]>
        ref={deckRef}
        style={DECK_STYLE}
        views={deckViews}
        viewState={{
          [MAIN_VIEW_ID]: managedMainViewState,
          [OVERVIEW_VIEW_ID]: overviewViewState
        }}
        onViewStateChange={viewSession.handleViewStateChange}
        layers={layers}
        layerFilter={layerFilter}
        widgets={combinedWidgets}
        onHover={onHover}
        onClick={onClick}
        onResize={setDeckDimensions}
        getCursor={getCursor}
        onBeforeRender={gpuFrameTimer.handleBeforeRender}
        onAfterRender={gpuFrameTimer.handleAfterRender}
        deviceProps={DECK_DEVICE_PROPS}
        _typedArrayManagerProps={DECK_TYPED_ARRAY_MANAGER_PROPS}
        _animate={enableDeckAnimation}
      />
    </div>
  );
}

export const DeckWithManagedViews = forwardRef(DeckWithManagedViewsWithRef);

function getViewportDimensions(
  deckRef: DeckGLRef<any> | null,
  viewId: string
): {width: number; height: number} | null {
  if (!deckRef || !deckRef.deck || !deckRef.deck.isInitialized) return null;
  const viewport = deckRef.deck.getViewports().find(vp => vp.id === viewId);
  if (!viewport) return null;
  return {width: viewport.width, height: viewport.height};
}

function getLumaTimingDevice(device: unknown): LumaTimingDevice | null {
  if (!device || typeof device !== 'object') {
    return null;
  }
  const maybeDevice = device as LumaTimingDevice;
  if (typeof maybeDevice.createQuerySet !== 'function') {
    return null;
  }
  return maybeDevice;
}

function updateDeckGpuTimeStats(deck: DeckStatsTarget | null, durationMs: number): void {
  const gpuTimeStat = deck?.stats?.get?.('GPU Time', 'time');
  gpuTimeStat?.addTime?.(durationMs);
  if (!deck?.metrics) {
    return;
  }
  deck.metrics.gpuTime = gpuTimeStat?.time ?? (deck.metrics.gpuTime ?? 0) + durationMs;
  deck.metrics.gpuTimePerFrame = gpuTimeStat?.getAverageTime?.() ?? durationMs;
}

function getMainViewportHeight(deckHeight: number, isOverviewEnabled: boolean): number {
  return Math.max(
    1,
    deckHeight - HEADER_VIEW_HEIGHT - (isOverviewEnabled ? OVERVIEW_VIEW_HEIGHT : 0)
  );
}

/** Returns the smallest allowed X zoom needed to fit the provided horizontal bounds. */
function getMainMinZoomX({
  deckWidth,
  bounds,
  reservedLegendViewWidth
}: {
  deckWidth: number;
  bounds: Bounds;
  /** Width in pixels reserved outside the main timeline viewport. */
  reservedLegendViewWidth: number;
}): number {
  const contentWidth = bounds[1][0] - bounds[0][0];
  if (!Number.isFinite(contentWidth) || contentWidth <= 0 || deckWidth <= reservedLegendViewWidth) {
    return MIN_ZOOM[0];
  }

  const fitViewportWidth = Math.max(
    1,
    deckWidth - reservedLegendViewWidth - MAIN_X_ZOOM_FIT_HORIZONTAL_MARGIN_PX * 2
  );
  const fitZoomX = Math.log2(fitViewportWidth / contentWidth);
  if (!Number.isFinite(fitZoomX)) {
    return MIN_ZOOM[0];
  }

  return Math.min(MIN_ZOOM[0], fitZoomX - MAIN_X_ZOOM_OUT_BUFFER_LEVELS);
}

/** Caps only the overview Y zoom so one-row minimaps do not render at extreme height. */
function capOverviewViewStateZoomY<ViewStateT extends {readonly zoomY?: number}>(
  viewState: ViewStateT
): ViewStateT {
  if (typeof viewState.zoomY !== 'number' || viewState.zoomY <= OVERVIEW_MAX_ZOOM_Y) {
    return viewState;
  }
  return {
    ...viewState,
    zoomY: OVERVIEW_MAX_ZOOM_Y
  };
}

function preserveMainViewTopEdge(
  viewState: OrthographicViewState,
  previousMainViewportHeight: number,
  nextMainViewportHeight: number
): OrthographicViewState {
  const target = viewState.target ?? [0, 0, 0];
  const zoomY = viewState.zoomY!;
  const yScale = 2 ** zoomY;
  if (!Number.isFinite(yScale) || yScale <= 0) {
    return viewState;
  }

  const previousTopY = target[1] - previousMainViewportHeight / (2 * yScale);
  const nextTargetY = previousTopY + nextMainViewportHeight / (2 * yScale);
  if (!Number.isFinite(nextTargetY) || Math.abs(target[1] - nextTargetY) < 1e-9) {
    return viewState;
  }

  return {
    ...viewState,
    target: [target[0], nextTargetY, target[2] ?? 0],
    transitionDuration: 0,
    transitionInterpolator: undefined
  };
}
