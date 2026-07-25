import {bench, describe} from 'vitest';

import {buildTraceDatasetFromReadyTraceChunks} from '../trace-chunk-graph-assembler';
import {buildCollapsedActivityByTraceGraphRows} from '../trace-graph/collapsed-activity';
import {TraceGraph} from '../trace-graph/trace-graph';
import {buildTraceLayoutGeometryDerivationContext} from '../trace-layout/trace-derived-geometry';
import {buildTraceLayout, buildTraceLayouts} from '../trace-layout/trace-geometry-layout';
import {estimateTraceLayoutSize} from '../trace-layout/trace-layout-size';
import {DEFAULT_TRACE_COLOR_SCHEME} from '../trace-style/trace-color-scheme';
import {buildTraceViewSnapshot} from '../trace-view-snapshot';
import {
  buildTraceDeckBinaryProcessActivityData,
  buildTracePreparedGraphScenes,
  buildTracePreparedOverviewGraphScenes,
  buildTracePreparedProcessRows,
  estimateTracePreparedRenderDataSize
} from '../trace-view-state/trace-prepared-scene';
import {buildTracePreparedPathData} from '../trace-view-state/trace-prepared-scene-paths';
import {
  buildSyntheticArrowTraceFixture,
  SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME
} from './synthetic-arrow-trace';

import type {TraceDataset} from '../trace-dataset';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {TraceLayout} from '../trace-layout/trace-layout';
import type {TraceViewSnapshot} from '../trace-view-snapshot';
import type {SyntheticArrowTraceFixture} from './synthetic-arrow-trace';

const DEFAULT_TRACE_BENCHMARK_ROW_COUNTS = [10_000, 100_000, 1_000_000] as const;
const TRACE_BENCHMARK_ROW_COUNTS = getTraceBenchmarkRowCounts();
const TRACE_BENCHMARK_OPTIONS = {
  iterations: 1,
  time: 0,
  warmupIterations: 0,
  warmupTime: 0
} as const;
const TRACE_BENCHMARK_SETTINGS: TraceVisSettings = {
  showDependencies: true,
  sameProcessDependencyMode: 'all',
  showCrossProcessDependencies: true,
  showInstants: false,
  showCounters: false,
  showGlobalEvents: false,
  transitions: false,
  showPathsOnly: false,
  showOverview: true,
  dependencyDisplayMode: 'all',
  dependencyKeywords: [],
  dependencyOpacity: 0.1,
  minSpanTimeMs: 0,
  threadDisplayMode: 'all',
  selectedThreadNames: [],
  sortThreads: false,
  lineRoutingMode: 'straight',
  layoutDensity: 'comfortable',
  processLayoutMode: 'interleaved',
  trackAggregationMode: 'separate-threads',
  traceOffsetMs: 0,
  traceScale: 1,
  traceColorSchemeId: 'processes',
  traceTimingKey: 'latest',
  showEmptyProcesses: false
};

/** Benchmark-local grouping of the three explicit render owners. */
type SyntheticTracePreparedRenderData = ReturnType<typeof buildSyntheticTracePreparedRenderData>;

describe.each(TRACE_BENCHMARK_ROW_COUNTS)('synthetic Arrow trace pipeline (%i rows)', rowCount => {
  let fixture: SyntheticArrowTraceFixture | null = null;
  let traceDataset: TraceDataset | null = null;
  let traceGraph: TraceGraph | null = null;
  let filteredTraceGraph: TraceGraph | null = null;
  let traceViewSnapshot: TraceViewSnapshot | null = null;
  let traceLayout: TraceLayout | null = null;
  let filteredTraceLayout: TraceLayout | null = null;
  let traceLayoutWithMinimap: TraceLayout | null = null;
  let filteredTraceLayoutWithMinimap: TraceLayout | null = null;
  let preparedRenderData: SyntheticTracePreparedRenderData | null = null;
  let filteredPreparedRenderData: SyntheticTracePreparedRenderData | null = null;

  /**
   * Prepare shared fixture inputs before Tinybench starts timing one task.
   *
   * The 1m fixture deliberately exercises several expensive synchronous phases. Yielding
   * between phases keeps Vitest's worker RPC responsive without changing the measured tasks.
   */
  async function prepareSyntheticBenchmarkState(): Promise<void> {
    if (fixture) {
      return;
    }
    fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'synthetic-arrow-trace-bench-' + rowCount,
      rowCount,
      textFilterMatchEvery: 1_000
    });
    await yieldTraceBenchmarkWorker();
    traceDataset = materializeSyntheticTraceDataset(fixture);
    await yieldTraceBenchmarkWorker();
    traceViewSnapshot = buildTraceViewSnapshot(traceDataset, {
      spanFilters: [SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME]
    });
    await yieldTraceBenchmarkWorker();
    traceGraph = new TraceGraph({
      traceDataset,
      traceStore: fixture.traceStore
    });
    await yieldTraceBenchmarkWorker();
    filteredTraceGraph = new TraceGraph(
      {
        traceDataset,
        traceStore: fixture.traceStore
      },
      traceViewSnapshot
    );
    await yieldTraceBenchmarkWorker();
    traceLayout = buildTraceLayout({
      traceGraph,
      settings: TRACE_BENCHMARK_SETTINGS
    });
    await yieldTraceBenchmarkWorker();
    filteredTraceLayout = buildTraceLayout({
      traceGraph: filteredTraceGraph,
      settings: TRACE_BENCHMARK_SETTINGS
    });
    await yieldTraceBenchmarkWorker();
    traceLayoutWithMinimap = buildSyntheticTraceLayoutWithMinimap(traceGraph);
    await yieldTraceBenchmarkWorker();
    filteredTraceLayoutWithMinimap = buildSyntheticTraceLayoutWithMinimap(filteredTraceGraph);
    await yieldTraceBenchmarkWorker();
    preparedRenderData = buildSyntheticTracePreparedRenderData(traceGraph, traceLayoutWithMinimap);
    await yieldTraceBenchmarkWorker();
    filteredPreparedRenderData = buildSyntheticTracePreparedRenderData(
      filteredTraceGraph,
      filteredTraceLayoutWithMinimap
    );
    await yieldTraceBenchmarkWorker();
  }

  /** Emit one explicit NDJSON summary after the final benchmark task finishes. */
  function emitSyntheticBenchmarkSummary(): void {
    if (
      !traceDataset ||
      !traceViewSnapshot ||
      !traceLayout ||
      !filteredTraceLayout ||
      !preparedRenderData ||
      !filteredPreparedRenderData
    ) {
      throw new Error('Expected synthetic benchmark state before summary emission.');
    }
    process.stdout.write(
      JSON.stringify({
        type: 'tracevis-benchmark-summary',
        rowCount,
        semanticCounts: {
          spans: traceDataset.stats.spanCount,
          processes: traceDataset.stats.processCount,
          threads: traceDataset.stats.threadCount,
          sameProcessDependencies: traceDataset.stats.sameProcessDependencyCount,
          crossProcessDependencies: traceDataset.stats.crossProcessDependencyCount,
          textFilteredSpans: traceViewSnapshot.filteredSpanCount
        },
        timeExtents: {
          minTimeMs: traceDataset.timeExtents.minTimeMs,
          maxTimeMs: traceDataset.timeExtents.maxTimeMs
        },
        retainedSizeEstimates: {
          layoutBytes: estimateTraceLayoutSize([traceLayout]).totalBytes,
          filteredLayoutBytes: estimateTraceLayoutSize([filteredTraceLayout]).totalBytes,
          preparedSceneBytes: estimateTracePreparedRenderDataSize(
            preparedRenderData.foreground,
            preparedRenderData.overview,
            preparedRenderData.paths
          ),
          filteredPreparedSceneBytes: estimateTracePreparedRenderDataSize(
            filteredPreparedRenderData.foreground,
            filteredPreparedRenderData.overview,
            filteredPreparedRenderData.paths
          )
        }
      }) + '\n'
    );
  }
  const benchmarkOptions = {
    ...TRACE_BENCHMARK_OPTIONS,
    setup: prepareSyntheticBenchmarkState
  };

  // Tinybench probes synchronous callbacks once before both warmup and run, even when warmup
  // iterations are zero. Async wrappers keep each expensive phase to the requested one run.
  bench(
    'dataset assembly',
    async () => {
      if (!fixture) {
        throw new Error('Expected synthetic benchmark fixture before dataset assembly.');
      }
      materializeSyntheticTraceDataset(fixture);
    },
    benchmarkOptions
  );

  bench(
    'text view snapshot',
    async () => {
      if (!traceDataset) {
        throw new Error('Expected synthetic dataset before text view projection.');
      }
      buildTraceViewSnapshot(traceDataset, {
        spanFilters: [SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME]
      });
    },
    benchmarkOptions
  );

  bench(
    'runtime graph construction',
    async () => {
      if (!traceDataset || !fixture) {
        throw new Error('Expected synthetic dataset and store before graph construction.');
      }
      new TraceGraph({
        traceDataset,
        traceStore: fixture.traceStore
      });
    },
    benchmarkOptions
  );

  bench(
    'layout',
    async () => {
      if (!traceGraph) {
        throw new Error('Expected synthetic runtime graph before layout.');
      }
      buildTraceLayout({
        traceGraph,
        settings: TRACE_BENCHMARK_SETTINGS
      });
    },
    benchmarkOptions
  );

  bench(
    'filtered layout',
    async () => {
      if (!filteredTraceGraph) {
        throw new Error('Expected synthetic filtered runtime graph before layout.');
      }
      buildTraceLayout({
        traceGraph: filteredTraceGraph,
        settings: TRACE_BENCHMARK_SETTINGS
      });
    },
    benchmarkOptions
  );

  bench(
    'prepared scene',
    async () => {
      if (!traceGraph || !traceLayout) {
        throw new Error('Expected synthetic graph and layout before scene preparation.');
      }
      buildSyntheticTracePreparedRenderData(traceGraph, traceLayout);
    },
    benchmarkOptions
  );

  bench(
    'legacy overview activity',
    async () => {
      if (!traceGraph || !traceLayoutWithMinimap) {
        throw new Error('Expected synthetic graph and minimap layout before overview activity.');
      }
      buildSyntheticLegacyOverviewActivityData(traceGraph, traceLayoutWithMinimap);
    },
    benchmarkOptions
  );

  bench(
    'overview activity',
    async () => {
      if (!traceGraph || !traceLayoutWithMinimap) {
        throw new Error('Expected synthetic graph and minimap layout before overview activity.');
      }
      buildSyntheticTraceOverviewActivityData(traceGraph, traceLayoutWithMinimap);
    },
    benchmarkOptions
  );

  bench(
    'filtered block rows',
    async () => {
      if (!filteredTraceGraph || !filteredTraceLayout) {
        throw new Error('Expected synthetic filtered graph and layout before block rows.');
      }
      buildSyntheticTracePreparedRows(filteredTraceGraph, filteredTraceLayout, {
        includeSpans: true,
        includeDependencies: false
      });
    },
    benchmarkOptions
  );

  bench(
    'dependency rows',
    async () => {
      if (!traceGraph || !traceLayout) {
        throw new Error('Expected synthetic graph and layout before dependency rows.');
      }
      buildSyntheticTracePreparedRows(traceGraph, traceLayout, {
        includeSpans: false,
        includeDependencies: true
      });
    },
    benchmarkOptions
  );

  bench(
    'filtered dependency rows',
    async () => {
      if (!filteredTraceGraph || !filteredTraceLayout) {
        throw new Error('Expected synthetic filtered graph and layout before dependency rows.');
      }
      buildSyntheticTracePreparedRows(filteredTraceGraph, filteredTraceLayout, {
        includeSpans: false,
        includeDependencies: true
      });
    },
    benchmarkOptions
  );

  bench(
    'filtered prepared scene',
    async () => {
      if (!filteredTraceGraph || !filteredTraceLayout) {
        throw new Error('Expected synthetic filtered graph and layout before scene preparation.');
      }
      buildSyntheticTracePreparedRenderData(filteredTraceGraph, filteredTraceLayout);
    },
    {
      ...benchmarkOptions,
      teardown: (_task: unknown, mode: 'warmup' | 'run') => {
        if (mode === 'run') {
          emitSyntheticBenchmarkSummary();
        }
      }
    }
  );
});

/** Materialize one columnar dataset snapshot from finalized synthetic Arrow chunks. */
function materializeSyntheticTraceDataset(fixture: SyntheticArrowTraceFixture): TraceDataset {
  return buildTraceDatasetFromReadyTraceChunks({
    name: 'synthetic-arrow-trace-' + fixture.summary.spanCount,
    ...fixture.materializationInputs
  });
}

/** Build prepared deck inputs for one synthetic benchmark graph and layout. */
function buildSyntheticTracePreparedRenderData(traceGraph: TraceGraph, traceLayout: TraceLayout) {
  const params = {
    primaryTraceGraph: traceGraph,
    sourceTraceGraphs: [traceGraph],
    traceLayouts: [traceLayout],
    paths: [],
    settings: TRACE_BENCHMARK_SETTINGS,
    colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
    showCollapsedActivitySummary: false,
    isOverviewEnabled: true,
    getTraceModelMatrixForGraph: () => undefined
  };
  return {
    foreground: buildTracePreparedGraphScenes(params),
    overview: buildTracePreparedOverviewGraphScenes(params),
    paths: buildTracePreparedPathData(params)
  };
}

/** Build a benchmark-only layout with the real minimap attachment used by overview preparation. */
function buildSyntheticTraceLayoutWithMinimap(traceGraph: TraceGraph): TraceLayout {
  const traceLayout = buildTraceLayouts({
    traceGraphs: [traceGraph],
    settings: TRACE_BENCHMARK_SETTINGS,
    buildMinimapLayouts: true
  })[0];
  if (!traceLayout?.minimapLayout) {
    throw new Error('Expected synthetic minimap layout.');
  }
  return traceLayout;
}

/** Build the pre-columnar density overview path for direct benchmark comparison. */
function buildSyntheticLegacyOverviewActivityData(
  traceGraph: TraceGraph,
  traceLayout: TraceLayout
): void {
  const minimapLayout = traceLayout.minimapLayout?.traceLayout;
  if (!minimapLayout) {
    throw new Error('Expected synthetic minimap layout.');
  }
  const geometryContext = buildTraceLayoutGeometryDerivationContext(traceLayout);
  const collapsedActivityByProcessRef = buildCollapsedActivityByTraceGraphRows({
    graph: traceGraph,
    rows: minimapLayout.renderRows,
    geometryLayout: traceLayout,
    geometryContext,
    colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
    settings: TRACE_BENCHMARK_SETTINGS
  });
  const rows = buildTracePreparedProcessRows({
    graph: traceGraph,
    layout: minimapLayout,
    settings: TRACE_BENCHMARK_SETTINGS,
    collapsedActivityByProcessRef,
    includeSpans: false,
    includeDependencies: false,
    includeOverflowLabels: false
  });
  buildTraceDeckBinaryProcessActivityData({
    rows,
    traceLayout: minimapLayout,
    settings: TRACE_BENCHMARK_SETTINGS
  });
}

/** Build only the current direct overview payload for comparison with the legacy object path. */
function buildSyntheticTraceOverviewActivityData(
  traceGraph: TraceGraph,
  traceLayout: TraceLayout
): void {
  buildTracePreparedOverviewGraphScenes({
    isOverviewEnabled: true,
    sourceTraceGraphs: [traceGraph],
    traceLayouts: [traceLayout],
    settings: TRACE_BENCHMARK_SETTINGS,
    colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
    getTraceModelMatrixForGraph: () => undefined
  });
}

/** Build one foreground prepared-row subset so the benchmark isolates hot binary writers. */
function buildSyntheticTracePreparedRows(
  traceGraph: TraceGraph,
  traceLayout: TraceLayout,
  options: {
    /** Whether row-local span binary buffers should be written. */
    readonly includeSpans: boolean;
    /** Whether row-local dependency binary buffers should be written. */
    readonly includeDependencies: boolean;
  }
): void {
  buildTracePreparedProcessRows({
    graph: traceGraph,
    layout: traceLayout,
    settings: TRACE_BENCHMARK_SETTINGS,
    colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
    includeSpans: options.includeSpans,
    includeDependencies: options.includeDependencies,
    includeOverflowLabels: false
  });
}

/** Resolve optional comma-separated benchmark row-count overrides for focused local runs. */
function getTraceBenchmarkRowCounts(): readonly number[] {
  const configuredRowCounts = process.env.TRACEVIS_BENCHMARK_ROW_COUNTS;
  if (!configuredRowCounts) {
    return DEFAULT_TRACE_BENCHMARK_ROW_COUNTS;
  }
  const rowCounts = configuredRowCounts.split(',').map(value => Number(value.trim()));
  if (
    rowCounts.length === 0 ||
    rowCounts.some(rowCount => !Number.isInteger(rowCount) || rowCount <= 0)
  ) {
    throw new Error(
      'TRACEVIS_BENCHMARK_ROW_COUNTS must be a comma-separated list of positive integers.'
    );
  }
  return rowCounts;
}

/** Yield one event-loop turn so long synthetic setup phases do not starve Vitest worker RPC. */
function yieldTraceBenchmarkWorker(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
