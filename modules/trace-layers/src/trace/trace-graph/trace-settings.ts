import type {TraceProcessActivityAggregation} from './collapsed-activity';
import type {TrackAggregationMode} from './trace-types';

/** Trackpad swipe behavior used for timeline interaction. */
export type TraceInteractionMode = 'drag-to-zoom' | 'drag-to-pan';

export type TraceVisSettings = {
  showDependencies: boolean;
  /** Mode for filtering local dependencies when shown */
  localDependencyMode: 'all' | 'warnings' | 'submit';
  showCrossProcessDependencies: boolean;
  showInstants: boolean;
  showCounters: boolean;
  /** Whether to render graph-global events on a dedicated top row. */
  showGlobalEvents?: boolean;
  /** Whether to enable deck.gl layer transitions. */
  transitions: boolean;
  /** Whether to fade to highlighted critical paths and how to animate them. */
  followCriticalPathAnimationMode?: 'none' | 'animate' | 'follow';
  showPathsOnly: boolean;
  /** Whether to render the interactive overview mini-map. */
  showOverview: boolean;
  dependencyDisplayMode: 'all' | 'exclude' | 'include';
  dependencyKeywords: string[];
  dependencyOpacity: number;
  /** Alpha multiplier applied to non-highlighted spans when highlighted span refs are set. */
  highlightFadeFactor?: number;
  /** Alpha multiplier applied to non-highlighted spans when extended selection fade is active. */
  extendedSelectionFadeOpacity?: number;
  /** Whether to use the extended selection fade opacity for non-highlighted spans. */
  useExtendedSelectionFadeOpacity?: boolean;
  /** Milliseconds between steps of the critical path animation. */
  criticalPathAnimationIntervalMs?: number;
  /** Number of spans to keep in the animation trail when animating critical paths. */
  criticalPathTrailSpanLength?: number;
  minSpanTimeMs: number;
  /** Minimum rendered span width in screen pixels. Defaults to 2. */
  minSpanWidthPixels?: number;
  threadDisplayMode: 'all' | 'active' | 'selected' | 'minimal';
  selectedThreadNames?: string[];
  /** Whether to sort streams by numeric-aware thread names. */
  sortThreads: boolean;
  lineRoutingMode: 'straight' | 'curve';
  /** Vertical spacing preset for the timeline layout. */
  layoutDensity:
    | 'comfortable'
    | 'compact'
    | 'compact-spacious-processes'
    | 'ultra-compact'
    | 'flamegraph';
  /** Maximum lanes rendered before deeper lanes are folded into overflow summaries. */
  maxVisibleLanesPerThread?: number;
  /** Whether to render all lanes without applying maxVisibleLanesPerThread. Defaults to true. */
  maxVisibleLanesUnlimited?: boolean;
  processLayoutMode: 'step1' | 'sequential' | 'interleaved';
  /** Whether to retain process rows that have no displayable spans after filtering. */
  showEmptyProcesses?: boolean;
  /** Horizontal translation applied to trace geometry in milliseconds. */
  traceOffsetMs: number;
  /** Horizontal scale multiplier applied to trace geometry. */
  traceScale: number;
  /** Comma/newline/semicolon-separated literal prefixes or explicit `/regex/flags` filters. */
  spanFilter?: string;
  /** IATA time zone name */
  timezone?: string;
  /** Select from multiple trace color schemes */
  traceColorSchemeId: string;
  /** Optional timing key used by aggregated traces to choose an active timing projection. */
  timingAggregationKey?: string;
  /** Controls whether layout rows are per thread or combined by process. */
  trackAggregationMode: TrackAggregationMode;
  /** Aggregation algorithm used to summarize collapsed process activity rows. */
  processOverviewAggregation?: TraceProcessActivityAggregation;
  /** Trackpad swipe behavior used for timeline interaction. */
  interactionMode?: TraceInteractionMode;
  /** Whether selecting a span should hide the overview minimap while the selection is active. */
  selectHidesMinimap?: boolean;
  /** Whether to collect app-owned luma timestamp queries for Deck GPU timing stats. */
  enableDeckGpuTimeStats?: boolean;
  /** Whether to render span labels through the experimental packed FastTextLayer. */
  enableFastTextLayer?: boolean;
};
