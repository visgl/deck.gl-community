import type {TraceProcessActivityAggregation} from '@deck.gl-community/trace-layers/trace';

/**
 * Normalizes legacy routed dependency settings to the supported direct-line mode.
 */
export function normalizeLineRoutingMode(
  value: string | null | undefined
): 'straight' | 'curve' | undefined {
  if (value === 'route') {
    return 'straight';
  }
  if (value === 'straight' || value === 'curve') {
    return value;
  }
  return undefined;
}

/** Trackpad swipe behavior used for timeline interaction. */
export type TraceInteractionMode = 'drag-to-zoom' | 'drag-to-pan';

/** Starting expansion preset used when a trace graph initializes process rows. */
export type StartingProcessesMode = 'all-expanded' | 'group-collapsed' | 'all-collapsed';

/** Settings for visualization */
export type VisSettings = {
  /** Scheme ID used to select a color scheme for the trace graph. */
  traceColorSchemeId: string;
  /** Aggregation key used for the Beam trace run summary graph. */
  traceRunSummaryAggregationKey: string;

  /** Mode for displaying local dependencies */
  localDependencyMode: 'all' | 'none' | 'warnings' | 'submit';
  /** Whether to show submits in the visualization */
  showSubmits: boolean;
  /** Whether to render instant events */
  showInstants: boolean;
  /** Whether to render counter samples */
  showCounters: boolean;
  /** Whether to render graph-global events above the process rows. */
  showGlobalEvents: boolean;
  /** Whether to enable deck.gl layer transitions */
  transitions: boolean;
  /** Whether to animate critical paths and whether to recenter while animating */
  followCriticalPathAnimationMode?: 'none' | 'animate' | 'follow';
  /** Milliseconds between steps of the critical path animation */
  criticalPathAnimationIntervalMs?: number;
  /** Number of spans to keep visible in the critical path animation trail. */
  criticalPathTrailLength?: number;
  /** Mode for displaying cross-rank dependencies */
  crossDependencyMode: 'all' | 'none';
  /** Whether to show only paths in the visualization */
  showPathsOnly: boolean;
  /** Whether to overlay the interactive overview mini-map */
  showOverview: boolean;
  /** Opacity level for dependencies */
  dependencyOpacity: number;
  /** Opacity multiplier applied to spans that are not highlighted. */
  highlightFadeFactor: number;
  /** Opacity multiplier applied when extended selection fade is active. */
  extendedSelectionFadeOpacity: number;
  /** Line routing mode for visualization ('straight' or 'curve'). */
  lineRoutingMode: 'straight' | 'curve';
  /** Rank layout arrangement for multiple trace graphs */
  processLayoutMode: 'step1' | 'sequential' | 'interleaved';
  /** Whether process rows with no remaining visible spans should stay visible. */
  showEmptyProcesses: boolean;
  /** Controls whether rows are per thread or per process. */
  trackAggregationMode: 'separate-threads' | 'combine-threads';
  /** Aggregation algorithm used to summarize collapsed process activity rows. */
  processOverviewAggregation: TraceProcessActivityAggregation;
  /** Starting expansion preset for process rows. */
  startingProcessesMode: StartingProcessesMode;
  /** Vertical density preset for the timeline layout. */
  layoutDensity:
    | 'comfortable'
    | 'compact'
    | 'compact-spacious-processes'
    | 'ultra-compact'
    | 'flamegraph';
  /** Maximum lanes rendered before deeper lanes are folded into overflow summaries. */
  maxVisibleLanesPerThread?: number;
  /** Whether to render all lanes without applying the visible-lane limiter. */
  maxVisibleLanesUnlimited: boolean;

  /** Horizontal translation applied to secondary traces in milliseconds. */
  traceOffsetMs: number;
  /** Horizontal scaling applied to secondary traces. */
  traceScale: number;

  /** IATA time zone name to format timestamps with */
  timezone: string;

  // FILTER SETTINGS
  /** Minimum block time in milliseconds for filtering */
  minBlockTimeMs: number;
  /** Minimum rendered span width in screen pixels. */
  minSpanWidthPixels: number;
  /** Stream display mode ('active', 'all', 'selected', or 'minimal') */
  threadDisplayMode: 'active' | 'all' | 'selected' | 'minimal';
  /** Names of selected streams. If empty or not supplied, all streams are selected. */
  selectedThreadNames?: string[];
  /** Whether to sort streams by numeric-aware thread names. */
  sortThreads: boolean;

  // APPLICATION SETTINGS
  /** Theme for deck widget chrome ('light', 'dark', or 'auto'). */
  widgetTheme: 'light' | 'dark' | 'auto';
  /** Popup mode for visualization ('popup' or 'tab') */
  popupMode: 'popup' | 'tab';
  /** Trackpad swipe behavior used for timeline interaction. */
  interactionMode: TraceInteractionMode;
  /** Whether selecting a span should hide the overview minimap while the selection is active. */
  selectHidesMinimap: boolean;
  /** Whether to collect app-owned luma timestamp queries for Deck GPU timing stats. */
  enableDeckGpuTimeStats: boolean;
  /** Whether to render span labels through the experimental packed FastTextLayer. */
  enableFastTextLayer: boolean;
};

export const DEFAULT_VIS_SETTINGS: VisSettings = {
  traceColorSchemeId: 'processes',
  traceRunSummaryAggregationKey: 'latest',
  localDependencyMode: 'warnings',
  crossDependencyMode: 'none',
  showPathsOnly: false,
  showOverview: true,
  dependencyOpacity: 0.05,
  highlightFadeFactor: 0.2,
  extendedSelectionFadeOpacity: 0.6,
  showSubmits: true,
  showInstants: true,
  showCounters: true,
  showGlobalEvents: true,
  transitions: false,
  followCriticalPathAnimationMode: 'none',
  criticalPathAnimationIntervalMs: 75,
  criticalPathTrailLength: 1,
  lineRoutingMode: 'straight',
  processLayoutMode: 'interleaved',
  showEmptyProcesses: false,
  trackAggregationMode: 'separate-threads',
  processOverviewAggregation: 'density',
  startingProcessesMode: 'all-expanded',
  layoutDensity: 'compact',
  maxVisibleLanesPerThread: 0,
  maxVisibleLanesUnlimited: true,
  traceOffsetMs: 0,
  traceScale: 1,
  timezone: 'UTC',
  minBlockTimeMs: 0,
  minSpanWidthPixels: 2,
  threadDisplayMode: 'active',
  selectedThreadNames: [],
  sortThreads: false,
  widgetTheme: 'light',
  popupMode: 'tab',
  interactionMode: 'drag-to-zoom',
  selectHidesMinimap: false,
  enableDeckGpuTimeStats: false,
  enableFastTextLayer: false
};
