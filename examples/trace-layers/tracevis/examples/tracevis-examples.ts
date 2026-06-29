import type {
  ChromeTraceFileSchema,
  TraceCrossProcessDependency,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceSpanLayoutMode,
  TraceThread,
  TraceThreadId
} from '@deck.gl-community/trace-layers/trace';

/** Looks up one built-in demo example by its stable trace identifier. */
export function getTracevisExampleTrace(traceId: string): TracevisExampleTrace | null {
  return TRACEVIS_EXAMPLE_TRACES.find(example => example.traceId === traceId) ?? null;
}

/** Compact graph statistics shown in a standalone demo example tile. */
export type TracevisExampleStats = {
  /** Number of logical trace processes in the example payload. */
  processCount: number;
  /** Number of logical trace threads in the example payload. */
  threadCount: number;
  /** Number of spans that render as duration blocks in the example payload. */
  spanCount: number;
  /** Number of local and cross-process dependencies built from the example payload. */
  dependencyCount: number;
};

/** One built-in dataset shown in the standalone Tracevis demo catalog. */
export type TracevisExampleTrace = {
  /** Stable trace identifier used by selection state and parsed trace storage. */
  traceId: string;
  /** Human-readable example name shown in the sidebar tile. */
  name: string;
  /** Short format label shown under the example name. */
  formatLabel: string;
  /** Compact graph statistics shown before the example is parsed by the viewer. */
  stats: TracevisExampleStats;
  /** Whether the example should use generated lanes or authored span geometry. */
  spanLayout?: TraceSpanLayoutMode;
  /** Chrome Trace payload parsed lazily when the example is selected. */
  traceJson?: ChromeTraceFileSchema;
  /** Prebuilt Tracevis processes used by examples that exercise Tracevis-native features. */
  ranks?: Readonly<TraceProcess[]>;
  /** Prebuilt Tracevis dependencies paired with the prebuilt processes. */
  crossDependencies?: Readonly<TraceCrossProcessDependency[]>;
};

const SIMPLE_SYNTHETIC_CHROME_TRACE_JSON = {
  displayTimeUnit: 'us',
  metadata: {
    source: 'tracevis-demo',
    synthetic: true
  },
  traceEvents: [
    {
      name: 'process_name',
      ph: 'M',
      pid: 1,
      tid: 10,
      args: {name: 'Synthetic browser'}
    },
    {
      name: 'thread_name',
      ph: 'M',
      pid: 1,
      tid: 10,
      args: {name: 'Network'}
    },
    {
      name: 'thread_name',
      ph: 'M',
      pid: 1,
      tid: 20,
      args: {name: 'Renderer'}
    },
    {
      name: 'Fetch request',
      ph: 'X',
      pid: 1,
      tid: 10,
      ts: 1_000,
      dur: 6_000,
      cat: 'net',
      args: {route: '/demo'}
    },
    {
      name: 'Parse response',
      ph: 'X',
      pid: 1,
      tid: 10,
      ts: 7_600,
      dur: 2_300,
      cat: 'blink'
    },
    {
      name: 'Render frame',
      ph: 'X',
      pid: 1,
      tid: 20,
      ts: 8_000,
      dur: 5_000,
      cat: 'gpu'
    },
    {
      name: 'Commit UI',
      ph: 'X',
      pid: 1,
      tid: 20,
      ts: 13_500,
      dur: 1_500,
      cat: 'v8'
    },
    {
      name: 'response-ready',
      ph: 's',
      pid: 1,
      tid: 10,
      ts: 5_500,
      bind_id: 'response-ready'
    },
    {
      name: 'response-ready',
      ph: 'f',
      pid: 1,
      tid: 20,
      ts: 9_000,
      bind_id: 'response-ready'
    }
  ]
} satisfies ChromeTraceFileSchema;

const MANUAL_LAYOUT_THREAD = {
  type: 'trace-thread',
  name: 'Authored layout',
  threadId: 'manual-layout-thread' as TraceThreadId,
  processId: 'manual-layout-process'
} satisfies TraceThread;

const MANUAL_LAYOUT_SPANS = [
  buildManualLayoutSpan({
    spanId: 'manual-layout-ingest',
    name: 'Ingest',
    startTimeMs: 0,
    endTimeMs: 18,
    layoutTopY: 0,
    layoutHeight: 2.75,
    color: [66, 133, 244, 255]
  }),
  buildManualLayoutSpan({
    spanId: 'manual-layout-transform',
    name: 'Transform',
    startTimeMs: 6,
    endTimeMs: 32,
    layoutTopY: 3.25,
    layoutHeight: 4.5,
    color: [15, 157, 88, 255]
  }),
  buildManualLayoutSpan({
    spanId: 'manual-layout-validate',
    name: 'Validate',
    startTimeMs: 22,
    endTimeMs: 46,
    layoutTopY: 8.4,
    layoutHeight: 1.75,
    color: [244, 180, 0, 255]
  }),
  buildManualLayoutSpan({
    spanId: 'manual-layout-render',
    name: 'Render large band',
    startTimeMs: 38,
    endTimeMs: 72,
    layoutTopY: 10.8,
    layoutHeight: 6,
    color: [171, 71, 188, 255]
  }),
  buildManualLayoutSpan({
    spanId: 'manual-layout-export',
    name: 'Export',
    startTimeMs: 70,
    endTimeMs: 90,
    layoutTopY: 17.6,
    layoutHeight: 3.25,
    color: [219, 68, 55, 255]
  })
] satisfies TraceSpan[];

const MANUAL_LAYOUT_PROCESSES = [
  {
    type: 'trace-process',
    processId: 'manual-layout-process',
    name: 'Manual layout process',
    rankNum: 0,
    stepNum: 0,
    threads: [MANUAL_LAYOUT_THREAD],
    threadMap: {
      [MANUAL_LAYOUT_THREAD.threadId]: MANUAL_LAYOUT_THREAD
    },
    spans: MANUAL_LAYOUT_SPANS,
    spanMap: Object.fromEntries(MANUAL_LAYOUT_SPANS.map(span => [span.spanId, span])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies: [],
    remoteDependencies: []
  }
] satisfies TraceProcess[];

/** Built-in example datasets available from the standalone Tracevis demo sidebar. */
export const TRACEVIS_EXAMPLE_TRACES: ReadonlyArray<TracevisExampleTrace> = [
  {
    traceId: 'simple-synthetic-chrome-trace',
    name: 'Simple Chrome Trace',
    formatLabel: 'Chrome trace',
    stats: {
      processCount: 1,
      threadCount: 2,
      spanCount: 4,
      dependencyCount: 1
    },
    traceJson: SIMPLE_SYNTHETIC_CHROME_TRACE_JSON
  },
  {
    traceId: 'manual-layout-trace',
    name: 'Manual Layout Trace',
    formatLabel: 'Custom layout',
    spanLayout: 'manual',
    stats: {
      processCount: 1,
      threadCount: 1,
      spanCount: 5,
      dependencyCount: 0
    },
    ranks: MANUAL_LAYOUT_PROCESSES,
    crossDependencies: []
  }
];

function buildManualLayoutSpan({
  spanId,
  name,
  startTimeMs,
  endTimeMs,
  layoutTopY,
  layoutHeight,
  color
}: {
  spanId: string;
  name: string;
  startTimeMs: number;
  endTimeMs: number;
  layoutTopY: number;
  layoutHeight: number;
  color: readonly [number, number, number, number];
}): TraceSpan {
  const durationMs = endTimeMs - startTimeMs;
  return {
    type: 'trace-span',
    spanId: spanId as TraceSpanId,
    threadId: MANUAL_LAYOUT_THREAD.threadId,
    processName: 'Manual layout process',
    name,
    keywords: [],
    primaryTimingKey: 'primary',
    timings: {
      primary: {
        status: 'finished',
        startTimeMs,
        endTimeMs,
        durationMs,
        durationMsAsString: `${durationMs}ms`
      }
    },
    layoutTopY,
    layoutHeight,
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: [],
    userData: {
      color
    }
  };
}
