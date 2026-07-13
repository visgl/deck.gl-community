import {
  createRef,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef
} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  getTraceLayoutSpanGeometryBySpanRef,
  getTraceLayoutVisibleDependencyGeometry
} from '../../../layers/layers/trace-layout-geometry';
import {
  buildJSONTrace,
  DEFAULT_TRACE_STYLE,
  getTraceLayoutSpanLaneIndex,
  getTraceSpanDependencySelection,
  TraceEngine,
  TraceGraph
} from '../../../trace';
import {createRuntimeTraceGraph} from '../../../trace/trace-graph/trace-graph-test-fixtures';
import {
  getRequiredCrossProcessDependencyRefById,
  getRequiredSpanRefBySpanId,
  getRequiredVisibleDisplaySourceBySpanId
} from '../../../trace/trace-graph/trace-graph-test-utils';
import {getTraceSpanExactExternalIdQuery} from '../../../trace/trace-graph/trace-span-name-search';
import {DeckTraceGraph} from './deck-trace-graph';

import type {
  CrossProcessDependencyRef,
  SameProcessDependencyRef,
  SpanRef,
  ThreadRef,
  TraceCrossProcessDependency,
  TraceDependencyId,
  TraceEngineInputs,
  TraceEngineUpdate,
  TraceLayout,
  TraceLayoutRow,
  TracePreparedProcessRow,
  TraceProcess,
  TraceRenderSpan,
  TraceSameProcessDependency,
  TraceSelectedDependencyDirection,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../../../trace';
import type {
  DeckTraceGraphExternalOmniBoxSearchProvider,
  DeckTraceGraphHandle,
  DeckTraceGraphPickedObject,
  DeckTraceGraphPickedObjectResolver,
  DeckTraceGraphConfig
} from './deck-trace-graph';
import type {Widget} from '@deck.gl/core';
import type {Ref} from 'react';
import type {Root} from 'react-dom/client';

function createTestTraceGraph(
  traceGraph: Parameters<typeof createRuntimeTraceGraph>[0],
  options?: Parameters<typeof createRuntimeTraceGraph>[1]
): TraceGraph {
  return createRuntimeTraceGraph(traceGraph, options);
}

/** Materializes one prepared span source only at assertion boundaries. */
function getPreparedSpanRefs(source: Iterable<SpanRef> | undefined): SpanRef[] | undefined {
  return source ? Array.from(source) : undefined;
}

function getRequiredProcessRef(traceGraph: TraceGraph, processId: string) {
  const processIndex = traceGraph.processes.findIndex(process => process.processId === processId);
  const processRef = processIndex >= 0 ? (traceGraph.getProcessRefs()[processIndex] ?? null) : null;
  if (processRef == null) {
    throw new Error(`Expected process ref for ${processId}`);
  }
  return processRef;
}

/** Resolves visible detail rows only for test fixtures after the production detail helper was removed. */
function getVisibleSpanDetailsByProcess(
  traceGraph: TraceGraph,
  processRef: Parameters<TraceGraph['iterateVisibleSpanRefsByProcess']>[0]
) {
  return Array.from(traceGraph.iterateVisibleSpanRefsByProcess(processRef)).flatMap(
    spanRef => traceGraph.getSpanDetailSource(spanRef) ?? []
  );
}

/** Returns the rendered thread layout containing one selected span ref. */
function getLayoutThreadForSpanRef(
  traceLayout: TraceLayout | undefined,
  traceGraph: TraceGraph,
  spanRef: SpanRef
) {
  const threadRef = traceGraph.getThreadRefBySpanRef(spanRef);
  return threadRef == null ? undefined : traceLayout?.threadLayoutMapByRef.get(threadRef);
}

const renderedDeckProps = vi.hoisted(() => ({current: null as Record<string, unknown> | null}));
const renderedTraceEngine = vi.hoisted(() => ({current: null as TraceEngine | null}));
const buildDeckLayersForTraceSpy = vi.hoisted(() => vi.fn());
const buildDeckLayerForTraceProcessActivitySummarySpy = vi.hoisted(() => vi.fn());
const buildDeckLayersForMinimapSpanIndicatorsSpy = vi.hoisted(() => vi.fn());
const buildDeckLayersForInstantsAndCounterSpy = vi.hoisted(() => vi.fn());
const buildDeckLayersForTimeMeasureSpy = vi.hoisted(() => vi.fn());
const buildDeckLayersForTimeAnchorSpy = vi.hoisted(() => vi.fn());
const buildDeckLayersForLegendSpy = vi.hoisted(() => vi.fn());
const buildOverviewLayersSpy = vi.hoisted(() =>
  vi.fn((arg: unknown) => {
    void arg;
    return null;
  })
);
const mockManagedViewsController = vi.hoisted(() => ({
  centerOnBlock: vi.fn(),
  centerOnSpan: vi.fn(),
  getMainViewState: vi.fn(() => null),
  panBy: vi.fn(),
  panTo: vi.fn(),
  resetView: vi.fn(),
  zoomToBlock: vi.fn(),
  zoomXBy: vi.fn()
}));
const mockImperativeDeckController = vi.hoisted(() => ({
  attach: vi.fn(),
  detach: vi.fn(),
  zoomToSpanRef: vi.fn(),
  centerOnBlock: vi.fn(),
  centerOnTime: vi.fn(),
  panTo: vi.fn(),
  panLeft: vi.fn(),
  panRight: vi.fn(),
  panUp: vi.fn(),
  panDown: vi.fn(),
  panUpFast: vi.fn(),
  panDownFast: vi.fn(),
  zoomInHorizontal: vi.fn(),
  zoomOutHorizontal: vi.fn(),
  resetView: vi.fn(),
  expandAllProcesses: vi.fn(),
  areAllProcessesExpanded: vi.fn(() => false)
}));

vi.mock('./deck-with-managed-views', () => ({
  DeckWithManagedViews: forwardRef((props: Record<string, unknown>, ref) => {
    const hoverPopupHostRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(ref, () => mockManagedViewsController);
    renderedDeckProps.current = props;
    useLayoutEffect(() => {
      const host = hoverPopupHostRef.current;
      if (!host) {
        return;
      }

      const widgets = Array.isArray(props.widgets) ? props.widgets : [];
      const hoverPopupWidget = widgets.find(
        (
          widget
        ): widget is {
          getContentElement?: () => HTMLDivElement | null;
        } => typeof widget === 'object' && widget !== null && 'getContentElement' in widget
      );
      const contentElement = hoverPopupWidget?.getContentElement?.();
      if (!contentElement) {
        return;
      }

      host.appendChild(contentElement);
      return () => {
        if (contentElement.parentElement === host) {
          host.removeChild(contentElement);
        }
      };
    }, [props.widgets]);

    return (
      <div data-testid="deck-with-managed-views">
        <div ref={hoverPopupHostRef} data-testid="deck-hover-popup-host" />
      </div>
    );
  })
}));

vi.mock('../../../layers', () => ({
  getTraceBounds: () => [
    [0, 0],
    [100, 100]
  ],
  getVerticalBounds: () => [0, 1],
  imperativeDeckController: mockImperativeDeckController,
  DEFAULT_SHORTCUTS: [
    {key: '/', commandKey: true, name: 'Show Shortcuts', description: 'Show help'}
  ],
  formatShortcutKeyHTML: (shortcut: {commandKey?: boolean; key: string}) =>
    `${shortcut.commandKey ? 'Ctrl+' : ''}${shortcut.key.toUpperCase()}`,
  DocumentationLinksPanel: class {
    props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
    }
  },
  KeyboardShortcutsPanel: class {
    props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
    }
  },
  URLParametersPanel: class {
    props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
    }
  },
  CommandToggleWidget: class {
    props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
    }
  },
  OmniBoxWidget: class {
    props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
    }
  },
  SettingsWidget: class {
    props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
    }
  },
  ToastWidget: class {
    props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
    }
  },
  ToggleWidget: class {
    props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
    }
  }
}));

vi.mock('../../../layers/layers/deck-layers', () => ({
  buildDeckBackgroundLayersForTrace: () => [],
  buildDeckLayerForCriticalPath: () => [],
  buildDeckLayerForTraceProcessActivitySummary: (...args: any[]) => {
    buildDeckLayerForTraceProcessActivitySummarySpy(...args);
    return [];
  },
  buildDeckLayersForGrid: () => [],
  buildDeckLayersForInstantsAndCounter: (...args: any[]) => {
    buildDeckLayersForInstantsAndCounterSpy(...args);
    return [];
  },
  buildDeckLayersForLegend: (args: unknown) => {
    buildDeckLayersForLegendSpy(args);
    return [];
  },
  buildDeckLayersForMinimapSpanIndicators: (...args: any[]) => {
    buildDeckLayersForMinimapSpanIndicatorsSpy(...args);
    return [];
  },
  buildDeckLayersForTimeMeasure: (...args: any[]) => {
    buildDeckLayersForTimeMeasureSpy(...args);
    return [];
  },
  buildDeckLayersForTimeAnchor: (...args: any[]) => {
    buildDeckLayersForTimeAnchorSpy(...args);
    return [];
  },
  buildDeckLayersForTrace: (...args: any[]) => {
    const params = args[0];
    buildDeckLayersForTraceSpy(
      params && typeof params === 'object' && 'scene' in params
        ? {
            ...params,
            ...params.scene,
            ...(params.selection ?? {}),
            ...(params.handlers ?? {}),
            processRows: params.scene.rows,
            traceGraph: params.scene.layout.traceGraph,
            traceLayout: params.scene.layout
          }
        : params,
      ...args.slice(1)
    );
    return [];
  },
  buildOverviewLayers: (arg: unknown) => buildOverviewLayersSpy(arg)
}));

vi.mock('@deck.gl-community/widgets', () => {
  class MockWidget {
    props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
    }
  }

  return {
    CommandToggleWidget: MockWidget,
    createStudioSettingsWidget: (props: Record<string, unknown>) => new MockWidget(props),
    ModalPanelWidget: MockWidget,
    OmniBoxWidget: MockWidget,
    TimeMeasureWidget: MockWidget,
    ToastWidget: MockWidget
  };
});

vi.mock('./trace-tooltip', () => ({
  TraceTooltip: ({
    object,
    traceGraph
  }: {
    object: TraceSpan | TraceRenderSpan | null;
    traceGraph: TraceGraph;
  }) => (
    <div data-testid="trace-tooltip" data-trace-graph-name={traceGraph.name}>
      {object?.name ?? 'empty'}
    </div>
  )
}));

const defaultTraceVisSettings: TraceVisSettings = {
  showDependencies: true,
  sameProcessDependencyMode: 'all',
  showCrossProcessDependencies: true,
  showInstants: false,
  showCounters: false,
  showGlobalEvents: false,
  transitions: false,
  showPathsOnly: false,
  showOverview: false,
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
  traceTimingKey: 'latest'
};

function createProcess(processId: string, rankNum: number, spanId: string): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: `${processId}-thread`,
    threadId: `${processId}-thread` as TraceThreadId,
    processId
  };
  const span: TraceSpan = {
    type: 'trace-span',
    spanId: spanId as TraceSpanId,
    threadId: thread.threadId,
    processName: processId,
    name: spanId,
    keywords: [],
    primaryTimingKey: 'primary',
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: 0,
        endTimeMs: 10,
        durationMs: 10,
        durationMsAsString: '10ms'
      }
    },
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };

  return {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [span],
    spanMap: {[span.spanId]: span},
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    sameProcessDependencies: [],
    remoteDependencies: []
  };
}

/** Builds a visible cross-process parent dependency for deck selection regressions. */
function createCrossProcessDependency(
  dependencyId: TraceDependencyId,
  startSpanId: TraceSpanId,
  endSpanId: TraceSpanId,
  startRankNum: number,
  endRankNum: number
): TraceCrossProcessDependency {
  return {
    type: 'trace-cross-process-dependency',
    dependencyId,
    endpointId: `${dependencyId}:endpoint` as any,
    startRankNum,
    endRankNum,
    startSpanId,
    endSpanId,
    waitMode: 'start-to-start',
    bidirectional: false,
    topology: 'parent',
    waitTimeMs: 0,
    waiting: false,
    waitNotFinished: false,
    keywords: new Set(['PARENT'])
  };
}

function createDuplicateBlockIdTraceGraph() {
  const correctProcess = createProcess('rank-correct', 0, 'shared-span');
  correctProcess.spans[0] = {
    ...correctProcess.spans[0]!,
    name: 'selected-correct'
  };
  correctProcess.spanMap = {
    [correctProcess.spans[0]!.spanId]: correctProcess.spans[0]!
  };

  const wrongProcess = createProcess('rank-wrong', 1, 'shared-span');
  wrongProcess.spans[0] = {
    ...wrongProcess.spans[0]!,
    name: 'selected-wrong'
  };
  wrongProcess.spanMap = {
    [wrongProcess.spans[0]!.spanId]: wrongProcess.spans[0]!
  };

  const traceGraph = createTestTraceGraph(
    buildJSONTrace([correctProcess, wrongProcess], [], {
      name: 'deck-trace-graph-duplicate-span-id-test'
    })
  );
  const selectedBlock = getVisibleSpanDetailsByProcess(
    traceGraph,
    getRequiredProcessRef(traceGraph, 'rank-correct')
  ).find(span => {
    return span.name === 'selected-correct';
  });
  if (!selectedBlock) {
    throw new Error('Expected selected span for duplicate-id regression test');
  }
  const selectedSpanRef = selectedBlock.spanRef;
  if (selectedSpanRef == null) {
    throw new Error('Expected span ref for duplicate-id regression test');
  }

  const wrongBlock = getVisibleSpanDetailsByProcess(
    traceGraph,
    getRequiredProcessRef(traceGraph, 'rank-wrong')
  ).find(span => {
    return span.name === 'selected-wrong';
  });
  if (!wrongBlock?.spanRef) {
    throw new Error('Expected wrong-process span ref for duplicate-id regression test');
  }

  return {
    traceGraph,
    selectedBlock,
    selectedSpanRef,
    wrongBlock,
    wrongSpanRef: wrongBlock.spanRef
  };
}

function createParentSelectionTraceGraph() {
  const process = createProcess('parent-rank', 0, 'parent');
  const childBlock: TraceSpan = {
    ...process.spans[0]!,
    spanId: 'child' as TraceSpanId,
    name: 'child'
  };
  const parentBlock = process.spans[0]!;
  process.spans.push(childBlock);
  process.spanMap = {
    [parentBlock.spanId]: parentBlock,
    [childBlock.spanId]: childBlock
  };

  const dependencyId = 'dep-parent' as TraceDependencyId;
  const dependency: TraceSameProcessDependency = {
    type: 'trace-same-process-dependency',
    dependencyId,
    startSpanId: parentBlock.spanId,
    endSpanId: childBlock.spanId,
    keywords: new Set(['PARENT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 0
  };
  parentBlock.sameProcessDependencyIds = [dependencyId];
  process.sameProcessDependencies = [dependency];

  const traceGraph = createTestTraceGraph(
    buildJSONTrace([process], [], {
      name: 'deck-trace-graph-extended-parent-selection-test'
    })
  );
  const parentBlockFromGraph = getVisibleSpanDetailsByProcess(
    traceGraph,
    getRequiredProcessRef(traceGraph, 'parent-rank')
  ).find(span => span.name === 'parent');
  const childBlockFromGraph = getVisibleSpanDetailsByProcess(
    traceGraph,
    getRequiredProcessRef(traceGraph, 'parent-rank')
  ).find(span => span.name === 'child');
  if (!parentBlockFromGraph || !childBlockFromGraph) {
    throw new Error('Expected parent and child spans for extended parent selection test');
  }
  const parentSpanRef = parentBlockFromGraph.spanRef;
  const childSpanRef = childBlockFromGraph.spanRef;

  return {traceGraph, parentSpanRef, childSpanRef, childBlockFromGraph};
}

function createParentSelectionTraceGraphWithUnrelated(): {
  traceGraph: TraceGraph;
  parentSpanRef: SpanRef;
  childSpanRef: SpanRef;
  childBlockFromGraph: TraceRenderSpan;
  unrelatedBlockId: TraceSpanId;
} {
  const process = createProcess('parent-rank', 0, 'parent');
  const childBlock: TraceSpan = {
    ...process.spans[0]!,
    spanId: 'child' as TraceSpanId,
    name: 'child'
  };
  const unrelatedBlock: TraceSpan = {
    ...process.spans[0]!,
    spanId: 'unrelated' as TraceSpanId,
    name: 'unrelated'
  };
  const parentBlock = process.spans[0]!;
  process.spans.push(childBlock, unrelatedBlock);
  process.spanMap = {
    [parentBlock.spanId]: parentBlock,
    [childBlock.spanId]: childBlock,
    [unrelatedBlock.spanId]: unrelatedBlock
  };

  const parentDependencyId = 'dep-parent' as TraceDependencyId;
  const dependency: TraceSameProcessDependency = {
    type: 'trace-same-process-dependency',
    dependencyId: parentDependencyId,
    startSpanId: parentBlock.spanId,
    endSpanId: childBlock.spanId,
    keywords: new Set(['PARENT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 0
  };
  parentBlock.sameProcessDependencyIds = [parentDependencyId];
  process.sameProcessDependencies = [dependency];

  const traceGraph = createTestTraceGraph(
    buildJSONTrace([process], [], {
      name: 'deck-trace-graph-extended-parent-selection-visible-test'
    })
  );
  const childBlockFromGraph = getVisibleSpanDetailsByProcess(
    traceGraph,
    getRequiredProcessRef(traceGraph, 'parent-rank')
  ).find(span => span.name === 'child');
  const parentBlockFromGraph = getVisibleSpanDetailsByProcess(
    traceGraph,
    getRequiredProcessRef(traceGraph, 'parent-rank')
  ).find(span => span.name === 'parent');
  if (!childBlockFromGraph || !parentBlockFromGraph) {
    throw new Error('Expected parent and child spans for extended parent visibility test');
  }
  const parentSpanRef = parentBlockFromGraph.spanRef;
  const childSpanRef = childBlockFromGraph.spanRef;

  return {
    traceGraph,
    parentSpanRef,
    childSpanRef,
    childBlockFromGraph,
    unrelatedBlockId: unrelatedBlock.spanId
  };
}

function createSelectionTraceGraph(): {
  traceGraph: TraceGraph;
  selectedBlock: TraceRenderSpan;
  selectedSpanRef: SpanRef;
  parentSpanRef: SpanRef;
  childSpanRef: SpanRef;
  unrelatedBlockId: TraceSpanId;
} {
  const process = createProcess('selection-rank', 0, 'selection-base');
  const baseBlock = process.spans[0]!;
  const spans: TraceSpan[] = [
    {
      ...baseBlock,
      spanId: 'focus-parent' as TraceSpanId,
      name: 'focus-parent',
      timings: {
        primary: {
          status: 'finished',
          startTimeMs: 0,
          endTimeMs: 100,
          durationMs: 100,
          durationMsAsString: '100ms'
        }
      }
    },
    {
      ...baseBlock,
      spanId: 'focus-selected' as TraceSpanId,
      name: 'focus-selected',
      timings: {
        primary: {
          status: 'finished',
          startTimeMs: 10,
          endTimeMs: 90,
          durationMs: 80,
          durationMsAsString: '80ms'
        }
      }
    },
    {
      ...baseBlock,
      spanId: 'focus-child' as TraceSpanId,
      name: 'focus-child',
      timings: {
        primary: {
          status: 'finished',
          startTimeMs: 20,
          endTimeMs: 80,
          durationMs: 60,
          durationMsAsString: '60ms'
        }
      }
    },
    {
      ...baseBlock,
      spanId: 'focus-unrelated' as TraceSpanId,
      name: 'focus-unrelated',
      timings: {
        primary: {
          status: 'finished',
          startTimeMs: 30,
          endTimeMs: 70,
          durationMs: 40,
          durationMsAsString: '40ms'
        }
      }
    }
  ];
  const dependencies: TraceSameProcessDependency[] = [
    {
      type: 'trace-same-process-dependency',
      dependencyId: 'dep-focus-parent' as TraceDependencyId,
      startSpanId: spans[0]!.spanId,
      endSpanId: spans[1]!.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    },
    {
      type: 'trace-same-process-dependency',
      dependencyId: 'dep-focus-child' as TraceDependencyId,
      startSpanId: spans[1]!.spanId,
      endSpanId: spans[2]!.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    }
  ];
  spans[0]!.sameProcessDependencyIds = ['dep-focus-parent' as TraceDependencyId];
  spans[1]!.sameProcessDependencyIds = ['dep-focus-child' as TraceDependencyId];
  process.spans = spans;
  process.spanMap = Object.fromEntries(spans.map(span => [span.spanId, span])) as Record<
    string,
    TraceSpan
  >;
  process.sameProcessDependencies = dependencies;

  const traceGraph = createTestTraceGraph(
    buildJSONTrace([process], [], {
      name: 'deck-trace-graph-selection-test'
    })
  );

  const selectedBlock = getRequiredVisibleDisplaySourceBySpanId(
    traceGraph,
    'focus-selected' as TraceSpanId
  );
  const parentBlock = getRequiredVisibleDisplaySourceBySpanId(
    traceGraph,
    'focus-parent' as TraceSpanId
  );
  const childBlock = getRequiredVisibleDisplaySourceBySpanId(
    traceGraph,
    'focus-child' as TraceSpanId
  );

  return {
    traceGraph,
    selectedBlock,
    selectedSpanRef: selectedBlock.spanRef,
    parentSpanRef: parentBlock.spanRef,
    childSpanRef: childBlock.spanRef,
    unrelatedBlockId: 'focus-unrelated' as TraceSpanId
  };
}

/** Builds a combined-thread head-process graph with one selected span and one unrelated span. */
function createCombinedThreadSelectionTraceGraph(): {
  traceGraph: TraceGraph;
  selectedBlock: TraceRenderSpan;
  selectedSpanRef: SpanRef;
  unrelatedSpanRef: SpanRef;
} {
  const process = createProcess('head-rank', 0, 'head-thread-a-base');
  const primaryThread = process.threads[0]!;
  const secondaryThread: TraceThread = {
    ...primaryThread,
    name: 'head-thread-b',
    threadId: 'head-thread-b' as TraceThreadId
  };
  const baseBlock = process.spans[0]!;
  const selectedBlock: TraceSpan = {
    ...baseBlock,
    spanId: 'head-thread-a-selected' as TraceSpanId,
    name: 'head-thread-a-selected',
    threadId: primaryThread.threadId,
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: 10,
        endTimeMs: 90,
        durationMs: 80,
        durationMsAsString: '80ms'
      }
    }
  };
  const unrelatedBlock: TraceSpan = {
    ...baseBlock,
    spanId: 'head-thread-b-unrelated' as TraceSpanId,
    name: 'head-thread-b-unrelated',
    threadId: secondaryThread.threadId,
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: 0,
        endTimeMs: 100,
        durationMs: 100,
        durationMsAsString: '100ms'
      }
    }
  };
  process.threads = [primaryThread, secondaryThread];
  process.threadMap = {
    [primaryThread.threadId]: primaryThread,
    [secondaryThread.threadId]: secondaryThread
  };
  process.spans = [selectedBlock, unrelatedBlock];
  process.spanMap = {
    [selectedBlock.spanId]: selectedBlock,
    [unrelatedBlock.spanId]: unrelatedBlock
  };

  const traceGraph = createTestTraceGraph(
    buildJSONTrace([process], [], {
      name: 'deck-trace-graph-combined-thread-selection-test'
    })
  );

  const visibleSelectedBlock = getRequiredVisibleDisplaySourceBySpanId(
    traceGraph,
    selectedBlock.spanId
  );
  const selectedSpanRef = visibleSelectedBlock.spanRef;
  const visibleUnrelatedBlock = getRequiredVisibleDisplaySourceBySpanId(
    traceGraph,
    unrelatedBlock.spanId
  );
  const unrelatedSpanRef = visibleUnrelatedBlock.spanRef;

  return {
    traceGraph,
    selectedBlock: visibleSelectedBlock,
    selectedSpanRef,
    unrelatedSpanRef
  };
}

/** Builds a combined-thread head-process parent chain with an interior spacer lane. */
function createCombinedThreadDependencySelectionTraceGraph(): {
  traceGraph: TraceGraph;
  childBlock: TraceRenderSpan;
  childSpanRef: SpanRef;
  parentSpanRef: SpanRef;
  spacerSpanRef: SpanRef;
  dependencyId: TraceDependencyId;
} {
  const process = createProcess('head-rank', 0, 'head-thread-a-parent');
  const parentThread = process.threads[0]!;
  const childThread: TraceThread = {
    ...parentThread,
    name: 'head-thread-b',
    threadId: 'head-thread-b' as TraceThreadId
  };
  const parentBlock: TraceSpan = {
    ...process.spans[0]!,
    spanId: 'head-thread-a-parent' as TraceSpanId,
    name: 'head-thread-a-parent',
    threadId: parentThread.threadId,
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: 0,
        endTimeMs: 100,
        durationMs: 100,
        durationMsAsString: '100ms'
      }
    }
  };
  const spacerBlock: TraceSpan = {
    ...process.spans[0]!,
    spanId: 'head-thread-b-spacer' as TraceSpanId,
    name: 'head-thread-b-spacer',
    threadId: childThread.threadId,
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: 5,
        endTimeMs: 95,
        durationMs: 90,
        durationMsAsString: '90ms'
      }
    }
  };
  const childBlock: TraceSpan = {
    ...process.spans[0]!,
    spanId: 'head-thread-b-child' as TraceSpanId,
    name: 'head-thread-b-child',
    threadId: childThread.threadId,
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: 20,
        endTimeMs: 30,
        durationMs: 10,
        durationMsAsString: '10ms'
      }
    }
  };
  const dependencyId = 'dep-head-parent-child' as TraceDependencyId;
  const dependency: TraceSameProcessDependency = {
    type: 'trace-same-process-dependency',
    dependencyId,
    startSpanId: parentBlock.spanId,
    endSpanId: childBlock.spanId,
    keywords: new Set(['PARENT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 0
  };
  childBlock.sameProcessDependencyIds = [dependencyId];
  process.threads = [parentThread, childThread];
  process.threadMap = {
    [parentThread.threadId]: parentThread,
    [childThread.threadId]: childThread
  };
  process.spans = [parentBlock, spacerBlock, childBlock];
  process.spanMap = {
    [parentBlock.spanId]: parentBlock,
    [spacerBlock.spanId]: spacerBlock,
    [childBlock.spanId]: childBlock
  };
  process.sameProcessDependencies = [dependency];

  const traceGraph = createTestTraceGraph(
    buildJSONTrace([process], [], {
      name: 'deck-trace-graph-combined-thread-dependency-selection-test'
    })
  );
  const visibleChildBlock = getRequiredVisibleDisplaySourceBySpanId(traceGraph, childBlock.spanId);
  const visibleParentBlock = getRequiredVisibleDisplaySourceBySpanId(
    traceGraph,
    parentBlock.spanId
  );
  const visibleSpacerBlock = getRequiredVisibleDisplaySourceBySpanId(
    traceGraph,
    spacerBlock.spanId
  );
  const childSpanRef = visibleChildBlock.spanRef;
  const parentSpanRef = visibleParentBlock.spanRef;
  const spacerSpanRef = visibleSpacerBlock.spanRef;

  return {
    traceGraph,
    childBlock: visibleChildBlock,
    childSpanRef,
    parentSpanRef,
    spacerSpanRef,
    dependencyId
  };
}

/** Builds a simple head-to-logical cross-parent selection graph. */
function createCrossSelectionTraceGraph(): {
  traceGraph: TraceGraph;
  selectedBlock: TraceRenderSpan;
  selectedSpanRef: SpanRef;
} {
  const headProcess = createProcess('head-rank', 0, 'head-parent');
  const logicalProcess = createProcess('logical-rank', 1, 'logical-child');
  const headBlock = headProcess.spans[0]!;
  const logicalBlock = logicalProcess.spans[0]!;

  const traceGraph = createTestTraceGraph(
    buildJSONTrace(
      [headProcess, logicalProcess],
      [
        createCrossProcessDependency(
          'dep-head-logical' as TraceDependencyId,
          headBlock.spanId,
          logicalBlock.spanId,
          headProcess.rankNum,
          logicalProcess.rankNum
        )
      ],
      {
        name: 'deck-trace-graph-cross-selection-test'
      }
    )
  );
  const selectedBlock = getRequiredVisibleDisplaySourceBySpanId(traceGraph, headBlock.spanId);
  const selectedSpanRef = selectedBlock.spanRef;

  return {
    traceGraph,
    selectedBlock,
    selectedSpanRef
  };
}

function getTraceTooltipMock(): HTMLDivElement {
  const tooltip = document.querySelector('[data-testid="trace-tooltip"]');
  if (!(tooltip instanceof HTMLDivElement)) {
    throw new Error('Expected trace tooltip content');
  }
  return tooltip;
}

function createHoverPickInfo(object: unknown, x = 10, y = 20) {
  return {
    object,
    x,
    y,
    viewport: {
      id: 'main',
      unproject: ([hoveredX, hoveredY]: [number, number]) =>
        [hoveredX, hoveredY] as [number, number]
    }
  };
}

async function waitForHoverPopupRender(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

/** Waits until one deferred trace layout update has crossed its paint boundary and finished. */
async function waitForDeferredTraceLayoutUpdate(): Promise<void> {
  await new Promise<void>(resolve => {
    window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
  });
  await Promise.resolve();
}

/** Creates a trace graph whose rank list can be expanded across rerenders. */
function createRankAppendTraceGraph(
  processIds: readonly string[],
  name = 'deck-trace-graph-rank-append-test'
): TraceGraph {
  const processes = processIds.map((processId, rankNum) =>
    createProcess(processId, rankNum, `${processId}-span`)
  );
  return createTestTraceGraph(buildJSONTrace(processes, [], {name}));
}

function createSyncSearchTraceGraph(): TraceGraph {
  const process = createProcess('rank-a', 0, 'sync-without-four');
  const syncWithoutFour: TraceSpan = {
    ...process.spans[0]!,
    spanId: 'sync-without-four' as TraceSpanId,
    name: 'GRAD_SYNC s63',
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: 0,
        endTimeMs: 64.9,
        durationMs: 64.9,
        durationMsAsString: '64.9us'
      }
    }
  };
  const syncWithFour: TraceSpan = {
    ...process.spans[0]!,
    spanId: 'sync-with-four' as TraceSpanId,
    name: 'GRAD_SYNC s63 (4)'
  };
  const invokeSpan: TraceSpan = {
    ...process.spans[0]!,
    spanId: 'invoke-span' as TraceSpanId,
    name: 'invoke'
  };
  process.spans = [syncWithoutFour, syncWithFour, invokeSpan];
  process.spanMap = {
    [syncWithoutFour.spanId]: syncWithoutFour,
    [syncWithFour.spanId]: syncWithFour,
    [invokeSpan.spanId]: invokeSpan
  };

  return createTestTraceGraph(buildJSONTrace([process], [], {name: 'sync-search-test'}));
}

function createFilteredCrossProcessDependencySelectionTraceGraph(): {
  traceGraph: TraceGraph;
  filteredLogicalSpanRef: SpanRef;
  visibleLogicalChild: TraceRenderSpan;
} {
  const rankA = createProcess('rank-a', 0, 'head-root');
  const rankB = createProcess('rank-b', 1, 'filtered-logical');
  const logicalChild: TraceSpan = {
    ...rankB.spans[0]!,
    spanId: 'logical-child' as TraceSpanId,
    name: 'logical-child'
  };
  const filteredLogical = rankB.spans[0]!;
  rankB.spans.push(logicalChild);
  rankB.spanMap = {
    [filteredLogical.spanId]: filteredLogical,
    [logicalChild.spanId]: logicalChild
  };

  const sameProcessDependencyId = 'rank-b:parent-stitched' as TraceDependencyId;
  const sameProcessDependency: TraceSameProcessDependency = {
    type: 'trace-same-process-dependency',
    dependencyId: sameProcessDependencyId,
    startSpanId: filteredLogical.spanId,
    endSpanId: logicalChild.spanId,
    keywords: new Set(['PARENT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 0
  };
  filteredLogical.sameProcessDependencyIds = [sameProcessDependencyId];
  rankB.sameProcessDependencies = [sameProcessDependency];

  const traceGraph = createTestTraceGraph(
    buildJSONTrace(
      [rankA, rankB],
      [
        {
          type: 'trace-cross-process-dependency',
          dependencyId: 'cross:parent-visible' as TraceDependencyId,
          endpointId: 'endpoint:parent-visible' as TraceCrossProcessDependency['endpointId'],
          startRankNum: 0,
          endRankNum: 1,
          startSpanId: rankA.spans[0]!.spanId,
          endSpanId: filteredLogical.spanId,
          waitMode: 'start-to-start',
          bidirectional: false,
          topology: 'parent',
          waitTimeMs: 0,
          waiting: false,
          waitNotFinished: false,
          keywords: new Set(['PARENT'])
        }
      ],
      {
        name: 'deck-trace-graph-stitched-cross-selection-test'
      }
    ),
    {spanFilters: ['filtered-logical']}
  );

  const visibleLogicalChild = getRequiredVisibleDisplaySourceBySpanId(
    traceGraph,
    logicalChild.spanId
  );
  const filteredLogicalSpanRef = getRequiredSpanRefBySpanId(traceGraph, filteredLogical.spanId);

  return {traceGraph, filteredLogicalSpanRef, visibleLogicalChild};
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const EMPTY_TEST_SPAN_REFS = [] as const satisfies readonly SpanRef[];

/** Unwraps the neutral app-owned payload used by picking tests. */
const resolveTestPickedTraceObject: DeckTraceGraphPickedObjectResolver = object =>
  object !== null && typeof object === 'object' && 'pickedObject' in object
    ? ((object as {pickedObject?: DeckTraceGraphPickedObject}).pickedObject ?? null)
    : null;

/** Wraps one span in the neutral app-owned payload used by picking tests. */
function wrapTestPickedTraceObject(object: DeckTraceGraphPickedObject): {
  pickedObject: DeckTraceGraphPickedObject;
} {
  return {pickedObject: object};
}

/** DeckTraceGraph prop subset projected by the selection test harness. */
type RenderDeckTraceGraphProps = Partial<
  Pick<
    TraceEngineInputs,
    | 'traceGraph'
    | 'secondaryTraceGraph'
    | 'traceStyle'
    | 'paths'
    | 'settings'
    | 'colorScheme'
    | 'highlightedSpanRefs'
    | 'selectedSpanRefs'
    | 'selectionPolicy'
    | 'focusSelectedSpanRefs'
    | 'extendedSelectionMode'
    | 'showCollapsedActivitySummary'
    | 'collapsedActivityAggregation'
    | 'layoutTimingKey'
    | 'layoutTopPadding'
  >
> &
  Partial<DeckTraceGraphConfig> & {
    /** Initial process expansion default passed into the test harness. */
    defaultExpandProcess?: boolean;
    /** Initial selected span refs passed into the test harness. */
    defaultSelectedSpanRefs?: readonly SpanRef[];
    /** Initial expanded process ids passed into the test harness. */
    defaultExpandedProcessIds?: readonly string[];
    /** Initial collapsed process ids passed into the test harness. */
    defaultCollapsedProcessIds?: readonly string[];
    /** Callback observing serialized expanded process ids. */
    onExpandedProcessIdsChange?: (processIds: string[]) => void;
    /** Optional CSS class applied by the test harness. */
    className?: string;
    /** Visible same-process dependency refs rendered as selected overlays. */
    selectedSameProcessDependencyRefs?: ReadonlySet<SameProcessDependencyRef>;
    /** Visible cross-process dependency refs rendered as selected overlays. */
    selectedCrossProcessDependencyRefs?: ReadonlySet<CrossProcessDependencyRef>;
    /** Selected same-process dependency directions keyed by visible dependency ref. */
    selectedSameProcessDependencyDirectionByRef?: ReadonlyMap<
      SameProcessDependencyRef,
      TraceSelectedDependencyDirection
    >;
    /** Selected cross-process dependency directions keyed by visible dependency ref. */
    selectedCrossProcessDependencyDirectionByRef?: ReadonlyMap<
      CrossProcessDependencyRef,
      TraceSelectedDependencyDirection
    >;
  };

function TestDeckTraceGraphHarness({
  traceGraph,
  additionalProps,
  deckTraceGraphRef,
  onSelectionChange
}: {
  traceGraph: TraceGraph;
  additionalProps?: RenderDeckTraceGraphProps;
  deckTraceGraphRef: Ref<DeckTraceGraphHandle>;
  /** Callback observing TraceEngine selection updates from the harness. */
  onSelectionChange: (selection: TraceEngineUpdate) => void;
}) {
  const {
    defaultExpandProcess = true,
    defaultSelectedSpanRefs = EMPTY_TEST_SPAN_REFS,
    defaultExpandedProcessIds,
    defaultCollapsedProcessIds,
    onExpandedProcessIdsChange,
    traceGraph: traceGraphOverride,
    secondaryTraceGraph,
    traceStyle = DEFAULT_TRACE_STYLE,
    paths = [],
    settings = defaultTraceVisSettings,
    colorScheme,
    highlightedSpanRefs,
    selectedSpanRefs = defaultSelectedSpanRefs,
    selectionPolicy,
    focusSelectedSpanRefs,
    extendedSelectionMode,
    showCollapsedActivitySummary,
    collapsedActivityAggregation,
    layoutTimingKey,
    layoutTopPadding,
    selectedSameProcessDependencyRefs,
    selectedCrossProcessDependencyRefs,
    selectedSameProcessDependencyDirectionByRef,
    selectedCrossProcessDependencyDirectionByRef,
    className,
    resolvePickedTraceObject = resolveTestPickedTraceObject,
    ...reactConfig
  } = additionalProps ?? {};
  const activeTraceGraph = traceGraphOverride ?? traceGraph;
  const resolvedSelectionPolicy =
    selectionPolicy ??
    (selectedSameProcessDependencyRefs || selectedCrossProcessDependencyRefs
      ? ({type: 'raw'} as const)
      : ({type: 'raw'} as const));
  const traceEngineInputs = useMemo(
    () => ({
      traceGraph: activeTraceGraph,
      secondaryTraceGraph,
      traceStyle,
      paths,
      settings,
      colorScheme,
      highlightedSpanRefs,
      selectedSpanRefs,
      selectionPolicy: resolvedSelectionPolicy,
      focusSelectedSpanRefs,
      extendedSelectionMode,
      defaultExpandProcess,
      defaultExpandedProcessIds,
      defaultCollapsedProcessIds,
      defaultSelectedSpanRefs,
      showCollapsedActivitySummary,
      collapsedActivityAggregation,
      layoutTimingKey,
      layoutTopPadding
    }),
    [
      activeTraceGraph,
      collapsedActivityAggregation,
      colorScheme,
      defaultCollapsedProcessIds,
      defaultExpandedProcessIds,
      defaultExpandProcess,
      defaultSelectedSpanRefs,
      extendedSelectionMode,
      focusSelectedSpanRefs,
      highlightedSpanRefs,
      layoutTimingKey,
      layoutTopPadding,
      paths,
      resolvedSelectionPolicy,
      secondaryTraceGraph,
      selectedSpanRefs,
      settings,
      showCollapsedActivitySummary,
      traceStyle
    ]
  );
  const traceEngineRef = useRef<TraceEngine | null>(null);
  if (!traceEngineRef.current) {
    traceEngineRef.current = new TraceEngine(traceEngineInputs);
  }
  const traceEngine = traceEngineRef.current;
  renderedTraceEngine.current = traceEngine;
  useLayoutEffect(() => {
    traceEngine.sync(traceEngineInputs);
  }, [traceEngine, traceEngineInputs]);
  useLayoutEffect(() => {
    if (
      selectedSpanRefs.length === 0 ||
      (!selectedSameProcessDependencyRefs && !selectedCrossProcessDependencyRefs)
    ) {
      return;
    }
    traceEngine.dispatch({
      type: 'setSelection',
      selectedSpanRefs,
      selectedSameProcessDependencyRefs: [...(selectedSameProcessDependencyRefs ?? [])],
      selectedCrossProcessDependencyRefs: [...(selectedCrossProcessDependencyRefs ?? [])],
      selectedSameProcessDependencyDirectionByRef,
      selectedCrossProcessDependencyDirectionByRef,
      isExtendedSelection: focusSelectedSpanRefs === true
    });
  }, [
    focusSelectedSpanRefs,
    selectedCrossProcessDependencyRefs,
    selectedCrossProcessDependencyDirectionByRef,
    selectedSameProcessDependencyRefs,
    selectedSameProcessDependencyDirectionByRef,
    selectedSpanRefs,
    traceEngine
  ]);
  useEffect(() => {
    return traceEngine.subscribe(update => {
      onSelectionChange(update);
      if (update.expandedProcessIdsChanged) {
        onExpandedProcessIdsChange?.([...update.serializedExpandedProcessIds]);
      }
    });
  }, [onExpandedProcessIdsChange, onSelectionChange, traceEngine]);
  const deckTraceGraphConfig = useMemo(
    () => ({
      onTimeRangeSelectionChange: vi.fn(),
      resolvePickedTraceObject,
      ...reactConfig
    }),
    [reactConfig, resolvePickedTraceObject]
  );

  return (
    <DeckTraceGraph
      ref={deckTraceGraphRef}
      className={className}
      engine={traceEngine}
      reactConfig={deckTraceGraphConfig}
    />
  );
}

async function renderDeckTraceGraphElement(
  traceGraph: TraceGraph,
  additionalProps?: RenderDeckTraceGraphProps
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const onSelectionChange = vi.fn();
  const deckTraceGraphRef = createRef<DeckTraceGraphHandle>();
  flushSync(() => {
    root?.render(
      <TestDeckTraceGraphHarness
        traceGraph={traceGraph}
        additionalProps={additionalProps}
        deckTraceGraphRef={deckTraceGraphRef}
        onSelectionChange={onSelectionChange}
      />
    );
  });
  await Promise.resolve();

  return {
    deckTraceGraphRef,
    engine: renderedTraceEngine.current!,
    onSelectionChange,
    deckProps: renderedDeckProps.current,
    rerender: async (nextAdditionalProps?: RenderDeckTraceGraphProps) => {
      flushSync(() => {
        root?.render(
          <TestDeckTraceGraphHarness
            traceGraph={traceGraph}
            additionalProps={{...additionalProps, ...nextAdditionalProps}}
            deckTraceGraphRef={deckTraceGraphRef}
            onSelectionChange={onSelectionChange}
          />
        );
      });
      await Promise.resolve();
    }
  };
}

/** Returns the latest shared trace context-menu widget captured by the Deck test double. */
function getTraceContextMenuWidget(): {props?: Record<string, unknown>} | undefined {
  const widgets = renderedDeckProps.current?.widgets as
    | Array<{props?: Record<string, unknown>}>
    | undefined;
  return widgets?.find(widget => widget.props?.id === 'tracevis-context-menu');
}

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
  renderedDeckProps.current = null;
  renderedTraceEngine.current = null;
  buildDeckLayersForTraceSpy.mockReset();
  buildDeckLayerForTraceProcessActivitySummarySpy.mockReset();
  buildDeckLayersForMinimapSpanIndicatorsSpy.mockReset();
  buildDeckLayersForInstantsAndCounterSpy.mockReset();
  buildDeckLayersForTimeMeasureSpy.mockReset();
  buildDeckLayersForTimeAnchorSpy.mockReset();
  buildDeckLayersForLegendSpy.mockReset();
  buildOverviewLayersSpy.mockClear();
  mockImperativeDeckController.attach.mockReset();
  mockImperativeDeckController.detach.mockReset();
  mockImperativeDeckController.zoomToSpanRef.mockReset();
  Object.keys(mockManagedViewsController).forEach(key => {
    const value = mockManagedViewsController[key as keyof typeof mockManagedViewsController];
    if (typeof value === 'function') {
      value.mockReset();
    }
  });
  Object.keys(mockImperativeDeckController).forEach(key => {
    const value = mockImperativeDeckController[key as keyof typeof mockImperativeDeckController];
    if (typeof value === 'function') {
      value.mockReset();
    }
  });
  vi.restoreAllMocks();
});

describe('DeckTraceGraph context menu', () => {
  it('provides the existing span-selection actions on the main canvas', async () => {
    const {traceGraph, selectedBlock} = createSelectionTraceGraph();
    await renderDeckTraceGraphElement(traceGraph, {showDefaultWidgets: true});
    const getMenuItems = getTraceContextMenuWidget()?.props?.getMenuItems as
      | ((info: {object?: unknown; viewport?: {id?: string}}) => Array<{label: string}> | null)
      | undefined;

    expect(
      getMenuItems?.({
        object: wrapTestPickedTraceObject(selectedBlock),
        viewport: {id: 'main'}
      })?.map(item => item.label)
    ).toEqual(['select span', 'select and filter dependency chain']);
  });

  it('selects the clicked span from the context menu without extended filtering', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createSelectionTraceGraph();
    const {engine, onSelectionChange} = await renderDeckTraceGraphElement(traceGraph, {
      showDefaultWidgets: true
    });
    const getMenuItems = getTraceContextMenuWidget()?.props?.getMenuItems as
      | ((info: {
          object?: unknown;
          viewport?: {id?: string};
        }) => Array<{onSelect?: () => void}> | null)
      | undefined;
    const menuItems = getMenuItems?.({
      object: wrapTestPickedTraceObject(selectedBlock),
      viewport: {id: 'main'}
    });

    flushSync(() => {
      menuItems?.[0]?.onSelect?.();
    });
    await Promise.resolve();

    expect(engine.getSelectedSpanRefs()).toEqual([selectedSpanRef]);
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedSpanRefs: [selectedSpanRef],
        isExtendedSelection: false
      })
    );
  });

  it('applies dependency-chain filtering from the context menu', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createSelectionTraceGraph();
    const {engine, onSelectionChange} = await renderDeckTraceGraphElement(traceGraph, {
      selectionPolicy: {type: 'dependency-chain', keywords: ['PARENT']},
      showDefaultWidgets: true
    });
    const getMenuItems = getTraceContextMenuWidget()?.props?.getMenuItems as
      | ((info: {
          object?: unknown;
          viewport?: {id?: string};
        }) => Array<{onSelect?: () => void}> | null)
      | undefined;
    const menuItems = getMenuItems?.({
      object: wrapTestPickedTraceObject(selectedBlock),
      viewport: {id: 'main'}
    });

    flushSync(() => {
      menuItems?.[1]?.onSelect?.();
    });
    await waitForDeferredTraceLayoutUpdate();

    expect(engine.getSelectedSpanRefs()).toEqual([selectedSpanRef]);
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedSpanRefs: [selectedSpanRef],
        isExtendedSelection: true
      })
    );
  });

  it('does not select a span from secondary-button deck interactions', async () => {
    const {traceGraph, selectedBlock} = createSelectionTraceGraph();
    const {onSelectionChange} = await renderDeckTraceGraphElement(traceGraph);
    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {
          onSpanClick?: (
            info: {object?: unknown},
            event?: {rightButton?: boolean; srcEvent?: {button?: number}}
          ) => boolean;
        }
      | undefined;
    const deckOnClick = renderedDeckProps.current?.onClick as
      | ((
          info: {object?: unknown},
          event?: {rightButton?: boolean; srcEvent?: {button?: number}}
        ) => void)
      | undefined;
    onSelectionChange.mockClear();

    expect(
      latestLayersCall?.onSpanClick?.(
        {object: wrapTestPickedTraceObject(selectedBlock)},
        {rightButton: true, srcEvent: {button: 0}}
      )
    ).toBe(false);
    flushSync(() => {
      deckOnClick?.(
        {object: wrapTestPickedTraceObject(selectedBlock)},
        {rightButton: true, srcEvent: {button: 0}}
      );
    });
    await Promise.resolve();

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('offers an empty-minimap time action using the pointer coordinate', async () => {
    const {traceGraph} = createSelectionTraceGraph();
    const onSelectThirtyMinutes = vi.fn();
    const onSelectFiveMinutes = vi.fn();
    const getOverviewTimeContextMenuActions = vi.fn((timeMs: number) => [
      {
        value: 'load-30-minutes',
        label: `Load 30 minutes around ${timeMs}`,
        onSelect: onSelectThirtyMinutes
      },
      {
        value: 'load-5-minutes',
        label: `Load 5 minutes around ${timeMs}`,
        onSelect: onSelectFiveMinutes
      }
    ]);
    await renderDeckTraceGraphElement(traceGraph, {
      showDefaultWidgets: true,
      getOverviewTimeContextMenuActions,
      overviewTimeRange: {
        startTimeMs: traceGraph.minTimeMs + 100,
        endTimeMs: traceGraph.minTimeMs + 200
      }
    });
    const getMenuItems = getTraceContextMenuWidget()?.props?.getMenuItems as
      | ((
          info: {
            object?: unknown;
            viewport?: {id?: string; unproject?: (position: number[]) => number[]};
            x?: number;
            y?: number;
          },
          widget: {
            deck?: {
              getViewports: () => Array<{
                id: string;
                x: number;
                y: number;
                width: number;
                height: number;
                unproject: (position: number[]) => number[];
              }>;
            };
          }
        ) => Array<{label: string; onSelect?: () => void}> | null)
      | undefined;
    const menuItems = getMenuItems?.(
      {
        object: null,
        x: 10,
        y: 120
      },
      {
        deck: {
          getViewports: () => [
            {
              id: 'minimap',
              x: 0,
              y: 100,
              width: 200,
              height: 50,
              unproject: () => [250, 0]
            }
          ]
        }
      }
    );

    expect(getOverviewTimeContextMenuActions).toHaveBeenCalledWith(traceGraph.minTimeMs + 200);
    expect(menuItems?.map(item => item.label)).toEqual([
      `Load 30 minutes around ${traceGraph.minTimeMs + 200}`,
      `Load 5 minutes around ${traceGraph.minTimeMs + 200}`
    ]);
    menuItems?.[1]?.onSelect?.();
    expect(onSelectThirtyMinutes).not.toHaveBeenCalled();
    expect(onSelectFiveMinutes).toHaveBeenCalledTimes(1);
  });

  it('suppresses empty, rank-metadata, and minimap actions without a callback', async () => {
    const {traceGraph} = createSelectionTraceGraph();
    await renderDeckTraceGraphElement(traceGraph, {
      showDefaultWidgets: true,
      overviewTimeRange: {startTimeMs: traceGraph.minTimeMs, endTimeMs: traceGraph.maxTimeMs}
    });
    const getMenuItems = getTraceContextMenuWidget()?.props?.getMenuItems as
      | ((info: {
          coordinate?: number[];
          layer?: {id?: string};
          object?: unknown;
          viewport?: {id?: string};
        }) => unknown)
      | undefined;

    expect(getMenuItems?.({object: null, viewport: {id: 'main'}})).toBeNull();
    expect(
      getMenuItems?.({
        layer: {id: 'primary-legend-rank-label'},
        object: {processId: 'selection-rank'},
        viewport: {id: 'legend'}
      })
    ).toBeNull();
    expect(getMenuItems?.({viewport: {id: 'minimap'}, coordinate: [10, 0]})).toBeNull();
  });
});

describe('DeckTraceGraph duplicate span-id selection', () => {
  it('passes row separator visibility through to trace foreground layers', async () => {
    const traceGraph = createSyncSearchTraceGraph();
    const {rerender} = await renderDeckTraceGraphElement(traceGraph);

    expect(buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0]?.showRowSeparators).toBe(true);

    buildDeckLayersForTraceSpy.mockClear();
    await rerender({showRowSeparators: false});

    expect(buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0]?.showRowSeparators).toBe(false);
  });

  it('keeps the TraceEngine memory report provider stable across engine actions', async () => {
    const {traceGraph, selectedSpanRef} = createSelectionTraceGraph();
    const onTraceMemoryReportProviderChange = vi.fn();
    const {engine} = await renderDeckTraceGraphElement(traceGraph, {
      onTraceMemoryReportProviderChange
    });
    const provider = onTraceMemoryReportProviderChange.mock.calls.at(-1)?.[0];
    if (typeof provider !== 'function') {
      throw new Error('Expected TraceEngine memory report provider');
    }
    const firstRevision = provider().traceEngineDiagnostics.revision;

    flushSync(() => {
      engine.dispatch({type: 'selectSpan', spanRef: selectedSpanRef});
    });
    await Promise.resolve();

    expect(onTraceMemoryReportProviderChange).toHaveBeenCalledTimes(1);
    expect(onTraceMemoryReportProviderChange.mock.calls.at(-1)?.[0]).toBe(provider);
    expect(provider().traceEngineDiagnostics.revision).toBeGreaterThan(firstRevision);
  });

  it('passes snapshot-owned marker projections into deck layer construction', async () => {
    const traceGraph = createSyncSearchTraceGraph();
    await renderDeckTraceGraphElement(traceGraph, {
      settings: {...defaultTraceVisSettings, showGlobalEvents: true}
    });

    const layerParams = buildDeckLayersForInstantsAndCounterSpy.mock.calls.at(-1)?.[0];
    expect(layerParams).toMatchObject({
      derivedData: {
        globalEvents: expect.any(Object),
        instants: expect.any(Object),
        counters: expect.any(Object)
      }
    });
    expect(layerParams).not.toHaveProperty('traceGraph');
    expect(layerParams).not.toHaveProperty('traceLayout');
    expect(layerParams).not.toHaveProperty('globalEventYPosition');
  });

  it('does not reset the view when ranks are appended after the initial fit', async () => {
    const oneRankTraceGraph = createRankAppendTraceGraph(['rank-a']);
    const twoRankTraceGraph = createRankAppendTraceGraph(['rank-a', 'rank-b']);
    const {deckTraceGraphRef, rerender} = await renderDeckTraceGraphElement(oneRankTraceGraph);

    expect(mockManagedViewsController.resetView).toHaveBeenCalledTimes(1);

    await rerender({traceGraph: twoRankTraceGraph});

    expect(mockManagedViewsController.resetView).toHaveBeenCalledTimes(1);

    deckTraceGraphRef.current?.resetView();

    expect(mockManagedViewsController.resetView).toHaveBeenCalledTimes(2);
  });

  it('resets the view when the loaded trace identity changes', async () => {
    const firstTraceGraph = createRankAppendTraceGraph(['rank-a'], 'first-loaded-trace');
    const secondTraceGraph = createRankAppendTraceGraph(['rank-a'], 'second-loaded-trace');
    const {rerender} = await renderDeckTraceGraphElement(firstTraceGraph);

    expect(mockManagedViewsController.resetView).toHaveBeenCalledTimes(1);

    await rerender({traceGraph: secondTraceGraph});

    expect(mockManagedViewsController.resetView).toHaveBeenCalledTimes(2);
  });

  it('fits the loaded time range once per caller-owned initial viewport key', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);
    const firstLoadedTimeRange = {startTimeMs: 2, endTimeMs: 8};
    const {deckTraceGraphRef, rerender} = await renderDeckTraceGraphElement(traceGraph, {
      fitInitialViewportToLoadedTimeRange: true,
      initialViewportFitKey: 'namespace-a\u0000run-a'
    });
    const fullBounds = renderedDeckProps.current?.bounds as
      | [[number, number], [number, number]]
      | undefined;
    if (!fullBounds) {
      throw new Error('Expected full trace bounds');
    }

    expect(mockManagedViewsController.resetView).not.toHaveBeenCalled();

    await rerender({overviewLoadedTimeRange: firstLoadedTimeRange});

    expect(mockManagedViewsController.resetView).toHaveBeenCalledTimes(1);
    expect(mockManagedViewsController.resetView).toHaveBeenLastCalledWith([
      [firstLoadedTimeRange.startTimeMs - traceGraph.minTimeMs, fullBounds[0][1]],
      [firstLoadedTimeRange.endTimeMs - traceGraph.minTimeMs, fullBounds[1][1]]
    ]);

    await rerender({overviewLoadedTimeRange: {startTimeMs: 3, endTimeMs: 9}});

    expect(mockManagedViewsController.resetView).toHaveBeenCalledTimes(1);

    const secondLoadedTimeRange = {startTimeMs: 4, endTimeMs: 10};
    await rerender({
      initialViewportFitKey: 'namespace-a\u0000run-b',
      overviewLoadedTimeRange: secondLoadedTimeRange
    });

    expect(mockManagedViewsController.resetView).toHaveBeenCalledTimes(2);
    expect(mockManagedViewsController.resetView).toHaveBeenLastCalledWith([
      [secondLoadedTimeRange.startTimeMs - traceGraph.minTimeMs, fullBounds[0][1]],
      [secondLoadedTimeRange.endTimeMs - traceGraph.minTimeMs, fullBounds[1][1]]
    ]);

    deckTraceGraphRef.current?.resetView();

    expect(mockManagedViewsController.resetView).toHaveBeenCalledTimes(3);
    expect(mockManagedViewsController.resetView).toHaveBeenLastCalledWith(fullBounds);
  });

  it('uses full trace bounds for the default automatic initial fit', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);

    await renderDeckTraceGraphElement(traceGraph);

    expect(mockManagedViewsController.resetView).toHaveBeenCalledOnce();
    expect(mockManagedViewsController.resetView).toHaveBeenLastCalledWith(
      renderedDeckProps.current?.bounds
    );
  });

  it('shows keyboard, URL deep link, and documentation tabs in the help modal in order', async () => {
    const {deckProps} = await renderDeckTraceGraphElement(createRankAppendTraceGraph(['rank-a']), {
      showDefaultWidgets: true,
      helpLinks: [
        {
          id: 'docs',
          title: 'Docs',
          href: 'https://example.com/docs'
        }
      ],
      urlParameters: [
        {
          name: 'run',
          description: 'Demo run alias mapping.',
          serialize: () => '',
          deserialize: () => {
            return;
          }
        }
      ]
    });
    const widgets = deckProps?.widgets as Array<{props?: Record<string, unknown>}> | undefined;
    const helpWidget = widgets?.find(widget => widget.props?.id === 'tracevis-help');
    const panel = helpWidget?.props?.panel as
      | {content?: {props?: {panels?: Array<{constructor: {name: string}}>}}}
      | undefined;

    expect(widgets?.[0]?.props?.id).toBe('tracevis-help');
    expect(panel?.content?.props?.panels?.map(helpPanel => helpPanel.constructor.name)).toEqual([
      'KeyboardShortcutsPanel',
      'URLParametersPanel',
      'CommandDocumentationPanel',
      'DocumentationLinksPanel'
    ]);
  });

  it('renders an overview toggle widget that can enable the minimap when it starts disabled', async () => {
    const onSettingsChange = vi.fn();
    const settingsConfig = {
      label: 'Visualization settings',
      visualizationSchema: {sections: []},
      showStudioSettingsWidget: true,
      settings: {
        traceColorSchemeId: 'processes',
        showOverview: false
      },
      onSettingsChange
    };

    const {deckProps} = await renderDeckTraceGraphElement(createRankAppendTraceGraph(['rank-a']), {
      showDefaultWidgets: true,
      settingsConfig
    });
    const widgets = deckProps?.widgets as Array<{props?: Record<string, unknown>}> | undefined;
    const overviewWidget = widgets?.find(widget => widget.props?.id === 'tracevis-overview-toggle');
    const studioSettingsWidget = widgets?.find(
      widget => widget.props?.id === 'tracevis-studio-settings'
    );

    expect(studioSettingsWidget?.props).toMatchObject({
      id: 'tracevis-studio-settings',
      placement: 'top-left',
      title: 'Visualization settings',
      triggerLabel: 'Visualization settings'
    });

    expect(overviewWidget?.props).toMatchObject({
      id: 'tracevis-overview-toggle',
      placement: 'bottom-right',
      initialChecked: false,
      label: 'Show overview minimap',
      onLabel: 'Hide overview minimap'
    });

    (overviewWidget?.props?.onChange as ((checked: boolean) => void) | undefined)?.(true);

    expect(onSettingsChange).toHaveBeenCalledWith({
      traceColorSchemeId: 'processes',
      showOverview: true
    });
  });

  it('suppresses Tracevis default widgets when showDefaultWidgets is omitted', async () => {
    const {deckProps} = await renderDeckTraceGraphElement(createRankAppendTraceGraph(['rank-a']));
    const widgets = deckProps?.widgets as Array<{props?: Record<string, unknown>}> | undefined;

    expect(deckProps?.showDefaultWidgets).toBe(false);
    expect(widgets).toHaveLength(0);
    expect(
      widgets?.some(
        widget =>
          widget.props?.placeholder === 'type to search, use /.../ for regex or > for commands'
      )
    ).toBe(false);
    expect(buildDeckLayersForTimeMeasureSpy).not.toHaveBeenCalled();
  });

  it('renders Tracevis default widgets when showDefaultWidgets is true', async () => {
    const appWidget = {
      placement: 'top-left',
      props: {id: 'app-owned-widget'}
    } as unknown as Widget;
    const {deckProps} = await renderDeckTraceGraphElement(createRankAppendTraceGraph(['rank-a']), {
      showDefaultWidgets: true,
      widgets: [appWidget]
    });
    const widgets = deckProps?.widgets as Array<{props?: Record<string, unknown>}> | undefined;

    expect(deckProps?.showDefaultWidgets).toBe(true);
    expect(widgets).toHaveLength(6);
    expect(widgets).toContain(appWidget);
    expect(
      widgets?.some(
        widget =>
          widget.props?.placeholder === 'type to search, use /.../ for regex or > for commands'
      )
    ).toBe(true);
    expect(buildDeckLayersForTimeMeasureSpy).toHaveBeenCalled();
  });

  it('preserves app-owned widgets when Tracevis defaults are off', async () => {
    const appWidget = {
      placement: 'top-left',
      props: {id: 'app-owned-widget'}
    } as unknown as Widget;
    const {deckProps} = await renderDeckTraceGraphElement(createRankAppendTraceGraph(['rank-a']), {
      widgets: [appWidget]
    });
    const widgets = deckProps?.widgets as Array<{props?: Record<string, unknown>}> | undefined;

    expect(deckProps?.showDefaultWidgets).toBe(false);
    expect(widgets).toEqual([appWidget]);
    expect(
      widgets?.some(
        widget =>
          widget.props?.placeholder === 'type to search, use /.../ for regex or > for commands'
      )
    ).toBe(false);
    expect(buildDeckLayersForTimeMeasureSpy).not.toHaveBeenCalled();
  });

  it('hides the minimap while a span selection is active when configured', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);
    const selectedSpanRef = getRequiredVisibleDisplaySourceBySpanId(
      traceGraph,
      'rank-a-span' as TraceSpanId
    ).spanRef;

    await renderDeckTraceGraphElement(traceGraph, {
      selectedSpanRefs: [selectedSpanRef],
      settings: {
        ...defaultTraceVisSettings,
        showOverview: true,
        selectHidesMinimap: true
      }
    });

    expect(renderedDeckProps.current?.isOverviewEnabled).toBe(false);
  });

  it('supports slash-delimited regex queries in the omnibox', async () => {
    const {deckProps} = await renderDeckTraceGraphElement(
      createRankAppendTraceGraph(['rank-a', 'rank-b']),
      {
        showDefaultWidgets: true
      }
    );
    const widgets = deckProps?.widgets as Array<{props?: Record<string, unknown>}> | undefined;
    const omniBoxWidget = widgets?.find(
      widget =>
        widget.props?.placeholder === 'type to search, use /.../ for regex or > for commands'
    );
    const getOptions = omniBoxWidget?.props?.getOptions as
      | ((query: string) => Array<{data?: unknown; label: string}>)
      | undefined;

    expect(getOptions?.('/rank-[ab]-span/').map(option => option.label)).toEqual([
      'rank-a-span',
      'rank-b-span'
    ]);
    expect(omniBoxWidget?.props?.topOffsetPx).toBe(48);
    expect(getOptions?.('/rank-[z/')).toEqual([]);
  });

  it('does not scan visible spans for empty omnibox queries', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a', 'rank-b']);
    const searchSpansSpy = vi.spyOn(traceGraph, 'searchSpans');
    const searchBlockRecordsSpy = vi.spyOn(traceGraph, 'searchBlockRecords');
    const {deckProps} = await renderDeckTraceGraphElement(traceGraph, {
      showDefaultWidgets: true
    });
    const widgets = deckProps?.widgets as Array<{props?: Record<string, unknown>}> | undefined;
    const omniBoxWidget = widgets?.find(
      widget =>
        widget.props?.placeholder === 'type to search, use /.../ for regex or > for commands'
    );
    const getOptions = omniBoxWidget?.props?.getOptions as
      | ((query: string) => Array<{data?: unknown; label: string}>)
      | undefined;

    expect(getOptions?.('   ')).toEqual([]);
    expect(searchSpansSpy).not.toHaveBeenCalled();
    expect(searchBlockRecordsSpy).not.toHaveBeenCalled();
  });

  it('matches plain omnibox queries case-insensitively', async () => {
    const traceGraph = createSyncSearchTraceGraph();
    const searchSpansSpy = vi.spyOn(traceGraph, 'searchSpans');
    const searchBlockRecordsSpy = vi.spyOn(traceGraph, 'searchBlockRecords');
    const {deckProps} = await renderDeckTraceGraphElement(traceGraph, {
      showDefaultWidgets: true
    });
    const widgets = deckProps?.widgets as Array<{props?: Record<string, unknown>}> | undefined;
    const omniBoxWidget = widgets?.find(
      widget =>
        widget.props?.placeholder === 'type to search, use /.../ for regex or > for commands'
    );
    const getOptions = omniBoxWidget?.props?.getOptions as
      | ((query: string) => Array<{data?: unknown; label: string}>)
      | undefined;
    const renderResultsSummary = omniBoxWidget?.props?.renderResultsSummary as
      | ((params: {mode: string; options: Array<{data?: unknown}>; query: string}) => string)
      | undefined;

    expect(omniBoxWidget?.props?.closeOnSelect).toBe(false);
    expect(omniBoxWidget?.props?.rememberQueries).toBe(true);
    const options = getOptions?.('grad_sync s63 (4)') ?? [];
    expect(options.map(option => option.label)).toEqual(['GRAD_SYNC s63 (4)']);
    expect(
      renderResultsSummary?.({
        mode: 'search',
        options,
        query: 'grad_sync s63 (4)'
      })
    ).toBe('Showing 1 of up to 200 loaded span result');
    expect(searchSpansSpy).toHaveBeenCalled();
    expect(getTraceSpanExactExternalIdQuery(searchSpansSpy.mock.calls[0]![0])).toBe(
      'grad_sync s63 (4)'
    );
    expect(searchBlockRecordsSpy).not.toHaveBeenCalled();
  });

  it('renders omnibox span options without building span card models', async () => {
    const traceGraph = createSyncSearchTraceGraph();
    const {deckProps} = await renderDeckTraceGraphElement(traceGraph, {
      showDefaultWidgets: true
    });
    const widgets = deckProps?.widgets as Array<{props?: Record<string, unknown>}> | undefined;
    const omniBoxWidget = widgets?.find(
      widget =>
        widget.props?.placeholder === 'type to search, use /.../ for regex or > for commands'
    );
    const getOptions = omniBoxWidget?.props?.getOptions as
      | ((query: string) => Array<{label: string}>)
      | undefined;
    const renderOption = omniBoxWidget?.props?.renderOption as
      | ((params: {option: unknown}) => unknown)
      | undefined;
    const [matchingOption] = getOptions?.('grad_sync s63 (4)') ?? [];

    expect(matchingOption?.label).toBe('GRAD_SYNC s63 (4)');
    expect(renderOption?.({option: matchingOption})).toBeDefined();
  });

  it('matches omnibox regex queries against individual search fields', async () => {
    const {deckProps} = await renderDeckTraceGraphElement(createSyncSearchTraceGraph(), {
      showDefaultWidgets: true
    });
    const widgets = deckProps?.widgets as Array<{props?: Record<string, unknown>}> | undefined;
    const omniBoxWidget = widgets?.find(
      widget =>
        widget.props?.placeholder === 'type to search, use /.../ for regex or > for commands'
    );
    const getOptions = omniBoxWidget?.props?.getOptions as
      | ((query: string) => Array<{label: string}>)
      | undefined;

    expect(getOptions?.('/SYNC.*4/').map(option => option.label)).toEqual(['GRAD_SYNC s63 (4)']);
    expect(getOptions?.('/invoke$/').map(option => option.label)).toEqual(['invoke']);
  });

  it('renders app-owned hidden omnibox results and calls their callbacks', async () => {
    const onSelect = vi.fn();
    const onNavigate = vi.fn();
    const externalOmniBoxSearchProvider = vi.fn<DeckTraceGraphExternalOmniBoxSearchProvider>(
      ({query, matchesQuery, limit}) => {
        expect(query).toBe('Hidden-Match');
        expect(limit).toBe(50);
        expect(matchesQuery('prefix hidden-match suffix')).toBe(true);
        return [
          {
            id: 'hidden-result',
            label: 'hidden external span',
            description: '7ms · source.py:10',
            reasonLabel: 'Hidden by: time window',
            onSelect
          }
        ];
      }
    );
    const {deckProps} = await renderDeckTraceGraphElement(createSyncSearchTraceGraph(), {
      externalOmniBoxSearchProvider,
      showDefaultWidgets: true
    });
    const widgets = deckProps?.widgets as Array<{props?: Record<string, unknown>}> | undefined;
    const omniBoxWidget = widgets?.find(
      widget =>
        widget.props?.placeholder === 'type to search, use /.../ for regex or > for commands'
    );
    const getOptions = omniBoxWidget?.props?.getOptions as
      | ((query: string) => Array<{description?: string; label: string}>)
      | undefined;
    const renderOption = omniBoxWidget?.props?.renderOption as
      | ((params: {option: unknown}) => {
          props?: {
            children?: Array<{
              props?: {
                title?: string;
              };
            }>;
          };
        })
      | undefined;
    const onSelectOption = omniBoxWidget?.props?.onSelectOption as
      | ((option: unknown) => void)
      | undefined;

    const options = getOptions?.('Hidden-Match') ?? [];
    const hiddenOption = options.find(option => option.label === 'hidden external span');
    const renderedOption = renderOption?.({option: hiddenOption});

    expect(hiddenOption?.description).toBe('Hidden by: time window · 7ms · source.py:10');
    expect(renderedOption?.props?.children?.[0]?.props?.title).toBe(
      'hidden external span (Hidden by: time window)'
    );

    flushSync(() => {
      onSelectOption?.(hiddenOption);
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(omniBoxWidget?.props?.onNavigateOption).toBeUndefined();
    expect(mockManagedViewsController.centerOnSpan).not.toHaveBeenCalled();
  });

  it('selects filtered omnibox spans without focusing a visible fallback', async () => {
    const {traceGraph, filteredLogicalSpanRef} =
      createFilteredCrossProcessDependencySelectionTraceGraph();
    const {deckProps, onSelectionChange} = await renderDeckTraceGraphElement(traceGraph, {
      showDefaultWidgets: true
    });
    const widgets = deckProps?.widgets as Array<{props?: Record<string, unknown>}> | undefined;
    const omniBoxWidget = widgets?.find(
      widget =>
        widget.props?.placeholder === 'type to search, use /.../ for regex or > for commands'
    );
    const getOptions = omniBoxWidget?.props?.getOptions as
      | ((query: string) => Array<{description?: string; label: string}>)
      | undefined;
    const onSelectOption = omniBoxWidget?.props?.onSelectOption as
      | ((option: unknown) => void)
      | undefined;
    const [filteredOption] = getOptions?.('filtered-logical') ?? [];

    expect(filteredOption?.label).toBe('filtered-logical');
    expect(filteredOption?.description).toContain('Hidden by: span-name filter');

    flushSync(() => {
      onSelectOption?.(filteredOption);
    });
    await Promise.resolve();

    expect(onSelectionChange.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        selectedSpanRefs: [filteredLogicalSpanRef]
      })
    );

    expect(omniBoxWidget?.props?.onNavigateOption).toBeUndefined();
    expect(mockManagedViewsController.centerOnSpan).not.toHaveBeenCalled();
  });

  it('selects a filtered omnibox leaf without fallback navigation', async () => {
    const process = createProcess('rank-a', 0, 'visible-root');
    const root = process.spans[0]!;
    const filteredLeaf: TraceSpan = {
      ...root,
      spanId: 'filtered-leaf' as TraceSpanId,
      name: 'filtered-leaf'
    };
    process.spans = [root, filteredLeaf];
    process.spanMap = {
      [root.spanId]: root,
      [filteredLeaf.spanId]: filteredLeaf
    };
    const dependencyId = 'dep-root-filtered-leaf' as TraceDependencyId;
    const parentDependency: TraceSameProcessDependency = {
      type: 'trace-same-process-dependency',
      dependencyId,
      startSpanId: root.spanId,
      endSpanId: filteredLeaf.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    };
    root.sameProcessDependencyIds = [dependencyId];
    process.sameProcessDependencies = [parentDependency];
    const traceGraph = createTestTraceGraph(
      buildJSONTrace([process], [], {name: 'filtered-leaf-search'}),
      {spanFilters: ['filtered-leaf']}
    );
    const filteredLeafSpanRef = getRequiredSpanRefBySpanId(traceGraph, filteredLeaf.spanId);
    const {deckProps, onSelectionChange} = await renderDeckTraceGraphElement(traceGraph, {
      showDefaultWidgets: true
    });
    const widgets = deckProps?.widgets as Array<{props?: Record<string, unknown>}> | undefined;
    const omniBoxWidget = widgets?.find(
      widget =>
        widget.props?.placeholder === 'type to search, use /.../ for regex or > for commands'
    );
    const getOptions = omniBoxWidget?.props?.getOptions as
      | ((query: string) => Array<{label: string}>)
      | undefined;
    const onSelectOption = omniBoxWidget?.props?.onSelectOption as
      | ((option: unknown) => void)
      | undefined;
    const [filteredOption] = getOptions?.('filtered-leaf') ?? [];

    expect(filteredOption?.label).toBe('filtered-leaf');

    flushSync(() => {
      onSelectOption?.(filteredOption);
    });
    await Promise.resolve();

    expect(onSelectionChange.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        selectedSpanRefs: [filteredLeafSpanRef]
      })
    );

    expect(omniBoxWidget?.props?.onNavigateOption).toBeUndefined();
  });

  it('passes exact selected span refs to deck layers when duplicate spanIds are visible', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createDuplicateBlockIdTraceGraph();
    expect(selectedBlock.spanId).toBe('shared-span');
    expect(selectedBlock.name).toBe('selected-correct');

    const {onSelectionChange} = await renderDeckTraceGraphElement(traceGraph);
    const deckOnClick = renderedDeckProps.current?.onClick as
      | ((info: {object?: unknown}, event?: unknown) => void)
      | undefined;

    expect(typeof deckOnClick).toBe('function');

    flushSync(() => {
      deckOnClick?.({object: wrapTestPickedTraceObject(selectedBlock)});
    });
    await Promise.resolve();

    const selectionPayload = onSelectionChange.mock.calls.at(-1)?.[0];
    expect(selectionPayload).toEqual(
      expect.objectContaining({
        selectedSpanRefs: [selectedSpanRef],
        selectedSpans: [
          {
            spanRef: selectedSpanRef,
            span: expect.objectContaining({spanId: 'shared-span', name: 'selected-correct'})
          }
        ],
        selectedSameProcessDependencyRefs: [],
        selectedCrossProcessDependencyRefs: [],
        isExtendedSelection: false
      })
    );
    expect(selectionPayload).not.toHaveProperty('selectedBlocks');

    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(latestLayersCall?.selectedSpanRefs).toEqual([selectedSpanRef]);
  });

  it('does not fall back to shared span-id geometry when exact span-ref geometry is absent', async () => {
    const {traceGraph, selectedSpanRef, wrongSpanRef} = createDuplicateBlockIdTraceGraph();
    await renderDeckTraceGraphElement(traceGraph, {
      selectedSpanRefs: [selectedSpanRef],
      showDefaultWidgets: true
    });

    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {traceLayout?: TraceLayout}
      | undefined;
    const traceLayout = latestLayersCall?.traceLayout;

    expect(traceLayout).toBeDefined();

    const selectedGeometry =
      traceLayout == null
        ? undefined
        : getTraceLayoutSpanGeometryBySpanRef({traceLayout, spanRef: selectedSpanRef});
    const wrongGeometry =
      traceLayout == null
        ? undefined
        : getTraceLayoutSpanGeometryBySpanRef({traceLayout, spanRef: wrongSpanRef});

    expect(selectedGeometry).toBeDefined();
    expect(wrongGeometry).toBeDefined();
    expect(Array.from(selectedGeometry ?? [])).not.toEqual(Array.from(wrongGeometry ?? []));
  });

  it('updates deck selected span refs when controlled selection changes', async () => {
    const {traceGraph, selectedSpanRef, parentSpanRef} = createSelectionTraceGraph();
    const {rerender} = await renderDeckTraceGraphElement(traceGraph, {
      selectedSpanRefs: [selectedSpanRef]
    });

    expect(buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0]?.selectedSpanRefs).toEqual([
      selectedSpanRef
    ]);

    await rerender({selectedSpanRefs: [parentSpanRef]});

    expect(buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0]?.selectedSpanRefs).toEqual([
      parentSpanRef
    ]);
  });

  it('updates selection from the rank layer span click handler', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createSelectionTraceGraph();
    const {onSelectionChange} = await renderDeckTraceGraphElement(traceGraph);
    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    const onSpanClick = latestLayersCall?.onSpanClick as
      | ((info: {object?: unknown}) => void)
      | undefined;

    expect(typeof onSpanClick).toBe('function');

    flushSync(() => {
      onSpanClick?.({object: wrapTestPickedTraceObject(selectedBlock)});
    });
    await Promise.resolve();

    const selectionPayload = onSelectionChange.mock.calls.at(-1)?.[0];
    expect(selectionPayload).toEqual(
      expect.objectContaining({
        selectedSpanRefs: [selectedSpanRef],
        selectedSpans: [
          {
            spanRef: selectedSpanRef,
            span: expect.objectContaining({
              spanId: selectedBlock.spanId,
              name: selectedBlock.name
            })
          }
        ],
        selectedSameProcessDependencyRefs: [],
        selectedCrossProcessDependencyRefs: [],
        isExtendedSelection: false
      })
    );
    expect(selectionPayload).not.toHaveProperty('selectedBlocks');
    const selectedLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {
          selectedSpanRefs?: readonly SpanRef[];
          selectedSameProcessDependencySourcesByProcessId?: Record<
            string,
            Array<{dependencyRef: number; selectedDirection: string}>
          >;
        }
      | undefined;
    expect(selectedLayersCall?.selectedSpanRefs).toEqual([selectedSpanRef]);
    expect(
      Object.values(
        selectedLayersCall?.selectedSameProcessDependencySourcesByProcessId ?? {}
      ).flat()
    ).toEqual([]);
  });

  it('leaves dependency refs externally owned for span clicks', async () => {
    const {traceGraph, parentSpanRef} = createSelectionTraceGraph();
    const parentBlock = getRequiredVisibleDisplaySourceBySpanId(
      traceGraph,
      'focus-parent' as TraceSpanId
    );
    const {onSelectionChange} = await renderDeckTraceGraphElement(traceGraph);
    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    const onSpanClick = latestLayersCall?.onSpanClick as
      | ((info: {object?: unknown}) => void)
      | undefined;

    flushSync(() => {
      onSpanClick?.({object: wrapTestPickedTraceObject(parentBlock)});
    });
    await Promise.resolve();

    const selectionPayload = onSelectionChange.mock.calls.at(-1)?.[0];
    expect(selectionPayload).toEqual(
      expect.objectContaining({
        selectedSpanRefs: [parentSpanRef],
        selectedSameProcessDependencyRefs: [],
        selectedCrossProcessDependencyRefs: []
      })
    );
    const selectedLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {
          selectedSameProcessDependencySourcesByProcessId?: Record<
            string,
            Array<{dependencyRef: number; selectedDirection: string}>
          >;
        }
      | undefined;
    expect(
      Object.values(
        selectedLayersCall?.selectedSameProcessDependencySourcesByProcessId ?? {}
      ).flat()
    ).toEqual([]);
  });

  it('does not let the deck click handler clear dependency refs immediately after a span click', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createSelectionTraceGraph();
    const {onSelectionChange} = await renderDeckTraceGraphElement(traceGraph);
    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    const onSpanClick = latestLayersCall?.onSpanClick as
      | ((info: {object?: unknown}) => void)
      | undefined;
    const deckOnClick = renderedDeckProps.current?.onClick as
      | ((info: {object?: unknown}, event?: unknown) => void)
      | undefined;

    expect(typeof onSpanClick).toBe('function');
    expect(typeof deckOnClick).toBe('function');

    flushSync(() => {
      onSpanClick?.({object: wrapTestPickedTraceObject(selectedBlock)});
      deckOnClick?.({object: null});
    });
    await Promise.resolve();

    const selectionPayload = onSelectionChange.mock.calls.at(-1)?.[0];
    expect(selectionPayload).toEqual(
      expect.objectContaining({
        selectedSpanRefs: [selectedSpanRef],
        selectedSpans: [
          {
            spanRef: selectedSpanRef,
            span: expect.objectContaining({
              spanId: selectedBlock.spanId,
              name: selectedBlock.name
            })
          }
        ],
        selectedSameProcessDependencyRefs: [],
        selectedCrossProcessDependencyRefs: [],
        isExtendedSelection: false
      })
    );
  });

  it('leaves outgoing cross-process dependency refs externally owned for normal span selection', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createCrossSelectionTraceGraph();
    const {onSelectionChange} = await renderDeckTraceGraphElement(traceGraph);
    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    const onSpanClick = latestLayersCall?.onSpanClick as
      | ((info: {object?: unknown}) => void)
      | undefined;

    expect(typeof onSpanClick).toBe('function');

    flushSync(() => {
      onSpanClick?.({object: wrapTestPickedTraceObject(selectedBlock)});
    });
    await Promise.resolve();

    const selectionPayload = onSelectionChange.mock.calls.at(-1)?.[0];
    expect(selectionPayload).toEqual(
      expect.objectContaining({
        selectedSpanRefs: [selectedSpanRef],
        selectedSpans: [
          {
            spanRef: selectedSpanRef,
            span: expect.objectContaining({
              spanId: selectedBlock.spanId,
              name: selectedBlock.name
            })
          }
        ],
        selectedSameProcessDependencyRefs: [],
        selectedCrossProcessDependencyRefs: [],
        isExtendedSelection: false
      })
    );
    const selectedLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {
          selectedCrossProcessDependencySources?: Array<{
            dependencyRef: number;
            selectedDirection: string;
          }>;
        }
      | undefined;
    expect(selectedLayersCall?.selectedCrossProcessDependencySources).toEqual([]);
  });

  it('toggles a process when the global deck click handler receives a rank label pick', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);
    const onExpandedProcessIdsChange = vi.fn();
    await renderDeckTraceGraphElement(traceGraph, {
      defaultExpandProcess: false,
      onExpandedProcessIdsChange
    });
    onExpandedProcessIdsChange.mockClear();
    const deckOnClick = renderedDeckProps.current?.onClick as
      | ((info: {layer?: {id?: string}; object?: unknown}, event?: unknown) => void)
      | undefined;

    expect(typeof deckOnClick).toBe('function');

    flushSync(() => {
      deckOnClick?.({
        layer: {id: 'primary-legend-rank-label'},
        object: {
          processId: 'rank-a',
          processRef: getRequiredProcessRef(traceGraph, 'rank-a')
        }
      });
    });
    expect(document.querySelector('[data-testid="trace-layout-busy-overlay"]')).not.toBeNull();
    expect(onExpandedProcessIdsChange).not.toHaveBeenCalled();
    await waitForDeferredTraceLayoutUpdate();

    expect(onExpandedProcessIdsChange).toHaveBeenLastCalledWith(['rank-a']);
    expect(document.querySelector('[data-testid="trace-layout-busy-overlay"]')).toBeNull();
  });

  it('defers lane expansion and collapse through the busy overlay', async () => {
    const {traceGraph, selectedSpanRef} = createSelectionTraceGraph();
    const {engine} = await renderDeckTraceGraphElement(traceGraph);
    const threadRef = traceGraph.getThreadRefBySpanRef(selectedSpanRef);
    if (threadRef == null) {
      throw new Error('Expected selected span thread ref');
    }
    const threadSource = traceGraph.getThreadSourceByRef(threadRef);
    if (!threadSource) {
      throw new Error('Expected selected span thread source');
    }
    const getLatestToggleStream = () =>
      (
        buildDeckLayersForLegendSpy.mock.calls.at(-1)?.[0] as
          | {
              onToggleStream?: (
                threadId: TraceThreadId,
                stream: TraceThread,
                threadRef: ThreadRef
              ) => void;
            }
          | undefined
      )?.onToggleStream;

    const collapseStream = getLatestToggleStream();
    expect(typeof collapseStream).toBe('function');
    flushSync(() => {
      collapseStream?.(threadSource.threadId, {} as TraceThread, threadRef);
    });

    expect(document.querySelector('[data-testid="trace-layout-busy-overlay"]')).not.toBeNull();
    expect(engine.getSnapshot().collapseState.graphs[0]?.collapsedThreadRefs.has(threadRef)).toBe(
      false
    );
    await waitForDeferredTraceLayoutUpdate();

    expect(document.querySelector('[data-testid="trace-layout-busy-overlay"]')).toBeNull();
    expect(engine.getSnapshot().collapseState.graphs[0]?.collapsedThreadRefs.has(threadRef)).toBe(
      true
    );

    const expandStream = getLatestToggleStream();
    flushSync(() => {
      expandStream?.(threadSource.threadId, {} as TraceThread, threadRef);
    });

    expect(document.querySelector('[data-testid="trace-layout-busy-overlay"]')).not.toBeNull();
    expect(engine.getSnapshot().collapseState.graphs[0]?.collapsedThreadRefs.has(threadRef)).toBe(
      true
    );
    await waitForDeferredTraceLayoutUpdate();

    expect(document.querySelector('[data-testid="trace-layout-busy-overlay"]')).toBeNull();
    expect(engine.getSnapshot().collapseState.graphs[0]?.collapsedThreadRefs.has(threadRef)).toBe(
      false
    );
  });

  it('defers expand-all and collapse-all through the busy overlay', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a', 'rank-b']);
    const {deckTraceGraphRef, engine} = await renderDeckTraceGraphElement(traceGraph, {
      defaultExpandProcess: false
    });
    const dispatchSpy = vi.spyOn(engine, 'dispatch');

    flushSync(() => {
      deckTraceGraphRef.current?.expandAllProcesses(true);
      deckTraceGraphRef.current?.expandAllProcesses(true);
    });

    const overlay = document.querySelector('[data-testid="trace-layout-busy-overlay"]');
    expect(overlay?.getAttribute('role')).toBe('status');
    expect(overlay?.getAttribute('aria-live')).toBe('polite');
    expect(overlay?.getAttribute('aria-busy')).toBe('true');
    expect(overlay?.textContent).toContain('Updating trace layout…');
    const spinner = overlay?.querySelector<HTMLElement>('.animate-spin');
    expect(spinner).not.toBeNull();
    expect(spinner?.style.willChange).toBe('transform');
    expect(spinner?.parentElement?.style.transform).toMatch(/^translateZ\(0(?:px)?\)$/);
    expect(engine.getSerializedExpandedProcessIds()).toEqual([]);
    expect(dispatchSpy).not.toHaveBeenCalledWith({
      type: 'setAllProcessesExpanded',
      expand: true
    });

    await waitForDeferredTraceLayoutUpdate();

    expect(engine.getSerializedExpandedProcessIds()).toEqual(['rank-a', 'rank-b']);
    expect(
      dispatchSpy.mock.calls.filter(
        ([action]) => action.type === 'setAllProcessesExpanded' && action.expand === true
      )
    ).toHaveLength(1);
    expect(document.querySelector('[data-testid="trace-layout-busy-overlay"]')).toBeNull();

    flushSync(() => {
      deckTraceGraphRef.current?.expandAllProcesses(false);
    });

    expect(engine.getSerializedExpandedProcessIds()).toEqual(['rank-a', 'rank-b']);
    expect(document.querySelector('[data-testid="trace-layout-busy-overlay"]')).not.toBeNull();
    await waitForDeferredTraceLayoutUpdate();

    expect(engine.getSerializedExpandedProcessIds()).toEqual([]);
    expect(document.querySelector('[data-testid="trace-layout-busy-overlay"]')).toBeNull();
  });

  it('cancels a pending expansion when the trace graph unmounts', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);
    const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const {deckTraceGraphRef} = await renderDeckTraceGraphElement(traceGraph, {
      defaultExpandProcess: false
    });

    flushSync(() => {
      deckTraceGraphRef.current?.expandAllProcesses(true);
    });
    expect(document.querySelector('[data-testid="trace-layout-busy-overlay"]')).not.toBeNull();

    root?.unmount();
    root = null;

    expect(cancelAnimationFrameSpy).toHaveBeenCalled();
  });

  it('preserves explicit process toggles while default expansion mode changes', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a', 'rank-b']);
    const onExpandedProcessIdsChange = vi.fn();
    const {rerender} = await renderDeckTraceGraphElement(traceGraph, {
      defaultExpandProcess: true,
      onExpandedProcessIdsChange
    });
    onExpandedProcessIdsChange.mockClear();
    const deckOnClick = renderedDeckProps.current?.onClick as
      | ((info: {layer?: {id?: string}; object?: unknown}, event?: unknown) => void)
      | undefined;

    expect(typeof deckOnClick).toBe('function');

    flushSync(() => {
      deckOnClick?.({
        layer: {id: 'primary-legend-rank-label'},
        object: {
          processId: 'rank-a',
          processRef: getRequiredProcessRef(traceGraph, 'rank-a')
        }
      });
    });
    await waitForDeferredTraceLayoutUpdate();

    expect(onExpandedProcessIdsChange).toHaveBeenLastCalledWith(['rank-b']);

    await rerender({defaultExpandProcess: false});
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));

    const collapsedAfterDefaultCollapse = (
      buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
        | {traceLayout: {processLayouts: Array<{isCollapsed: boolean}>}}
        | undefined
    )?.traceLayout.processLayouts.map(processLayout => processLayout.isCollapsed);
    expect(collapsedAfterDefaultCollapse).toEqual([true, true]);

    await rerender({defaultExpandProcess: true});
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));

    const collapsedAfterDefaultExpand = (
      buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
        | {traceLayout: {processLayouts: Array<{isCollapsed: boolean}>}}
        | undefined
    )?.traceLayout.processLayouts.map(processLayout => processLayout.isCollapsed);
    expect(collapsedAfterDefaultExpand).toEqual([true, false]);
  });

  it('keeps duplicate process refs independent across compared graphs', async () => {
    const primaryTraceGraph = createRankAppendTraceGraph(['rank-a']);
    const secondaryTraceGraph = createRankAppendTraceGraph(['rank-a']);
    await renderDeckTraceGraphElement(primaryTraceGraph, {
      secondaryTraceGraph,
      defaultExpandProcess: false
    });
    buildDeckLayersForTraceSpy.mockClear();
    const deckOnClick = renderedDeckProps.current?.onClick as
      | ((info: {layer?: {id?: string}; object?: unknown}, event?: unknown) => void)
      | undefined;

    expect(typeof deckOnClick).toBe('function');

    flushSync(() => {
      deckOnClick?.({
        layer: {id: 'trace-graph-1-legend-rank-label'},
        object: {
          processId: 'rank-a',
          processRef: getRequiredProcessRef(secondaryTraceGraph, 'rank-a')
        }
      });
    });
    await waitForDeferredTraceLayoutUpdate();

    const collapsedStateByGraph = buildDeckLayersForTraceSpy.mock.calls.slice(-2).map(
      call =>
        (
          call[0] as {
            traceLayout: {processLayouts: Array<{isCollapsed: boolean}>};
          }
        ).traceLayout.processLayouts[0]?.isCollapsed
    );
    expect(collapsedStateByGraph).toEqual([true, false]);
  });

  it('does not toggle a process when the global deck click handler receives a node name pick', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);
    const onExpandedProcessIdsChange = vi.fn();
    await renderDeckTraceGraphElement(traceGraph, {
      defaultExpandProcess: false,
      onExpandedProcessIdsChange
    });
    onExpandedProcessIdsChange.mockClear();
    const deckOnClick = renderedDeckProps.current?.onClick as
      | ((info: {layer?: {id?: string}; object?: unknown}, event?: unknown) => void)
      | undefined;

    expect(typeof deckOnClick).toBe('function');

    flushSync(() => {
      deckOnClick?.({
        layer: {id: 'primary-legend-rank-node-name'},
        object: {
          processId: 'rank-a'
        }
      });
    });
    await Promise.resolve();

    expect(onExpandedProcessIdsChange).not.toHaveBeenCalled();
  });

  it('preserves the main view y target when clicking the minimap', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);
    await renderDeckTraceGraphElement(traceGraph, {
      settings: {
        ...defaultTraceVisSettings,
        showOverview: true
      }
    });
    const getMainViewStateMock = mockManagedViewsController.getMainViewState as unknown as {
      mockReturnValue: (value: unknown) => void;
    };
    getMainViewStateMock.mockReturnValue({
      target: [12, 34, 0],
      zoom: [-5, 5]
    });
    const deckOnClick = renderedDeckProps.current?.onClick as
      | ((
          info: {
            viewport?: {id?: string};
            coordinate?: [number, number];
            object?: unknown;
          },
          event?: unknown
        ) => void)
      | undefined;
    const layerFilter = renderedDeckProps.current?.layerFilter as
      | ((context: {isPicking: boolean; viewport: {id: string}; layer?: {id?: string}}) => boolean)
      | undefined;

    expect(typeof deckOnClick).toBe('function');
    expect(typeof layerFilter).toBe('function');
    expect(
      layerFilter?.({
        isPicking: false,
        viewport: {id: 'minimap'},
        layer: {id: 'minimap-time-grids-tick-labels'}
      })
    ).toBe(true);
    expect(
      layerFilter?.({
        isPicking: true,
        viewport: {id: 'minimap'},
        layer: {id: 'minimap-trace-rank-a-collapsed-activity'}
      })
    ).toBe(true);
    expect(
      layerFilter?.({
        isPicking: true,
        viewport: {id: 'minimap'},
        layer: {id: 'minimap-trace-process-activity-summary'}
      })
    ).toBe(true);

    flushSync(() => {
      deckOnClick?.({
        viewport: {id: 'minimap'},
        coordinate: [42, 999],
        object: null
      });
    });

    expect(mockManagedViewsController.panTo).toHaveBeenCalledWith([42, 34]);
  });

  it('does not pan the minimap for a secondary mjolnir click', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);
    await renderDeckTraceGraphElement(traceGraph, {
      settings: {
        ...defaultTraceVisSettings,
        showOverview: true
      }
    });
    const deckOnClick = renderedDeckProps.current?.onClick as
      | ((
          info: {
            viewport?: {id?: string};
            coordinate?: [number, number];
            object?: unknown;
          },
          event?: unknown
        ) => void)
      | undefined;

    expect(typeof deckOnClick).toBe('function');

    flushSync(() => {
      deckOnClick?.(
        {
          viewport: {id: 'minimap'},
          coordinate: [42, 999],
          object: null
        },
        {leftButton: false, rightButton: true, srcEvent: {button: 0}}
      );
    });

    expect(mockManagedViewsController.panTo).not.toHaveBeenCalled();
  });

  it('prevents the browser context menu over the minimap canvas', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);
    await renderDeckTraceGraphElement(traceGraph, {
      settings: {
        ...defaultTraceVisSettings,
        showOverview: true
      }
    });
    const deckElement = container?.querySelector('[data-testid="deck-with-managed-views"]');
    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true
    });

    deckElement?.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
  });

  it('only renders process metadata labels in the legend overlay when threads are combined', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);
    await renderDeckTraceGraphElement(traceGraph, {
      settings: {...defaultTraceVisSettings, trackAggregationMode: 'combine-threads'}
    });
    const layerFilter = renderedDeckProps.current?.layerFilter as
      | ((context: {isPicking: boolean; viewport: {id: string}; layer?: {id?: string}}) => boolean)
      | undefined;

    expect(renderedDeckProps.current?.collapseLegendToProcessLabelOverlay).toBe(true);
    expect(typeof layerFilter).toBe('function');
    expect(
      layerFilter?.({
        isPicking: false,
        viewport: {id: 'legend'},
        layer: {id: 'primary-legend-rank-label'}
      })
    ).toBe(true);
    expect(
      layerFilter?.({
        isPicking: false,
        viewport: {id: 'legend'},
        layer: {id: 'primary-legend-rank-node-name'}
      })
    ).toBe(true);
    expect(
      layerFilter?.({
        isPicking: false,
        viewport: {id: 'legend'},
        layer: {id: 'primary-legend-rank-a-legend-stream-names'}
      })
    ).toBe(false);
    expect(
      layerFilter?.({
        isPicking: false,
        viewport: {id: 'legend'},
        layer: {id: 'primary-legend-overflow-label'}
      })
    ).toBe(false);
  });

  it('keeps the full legend visible when threads render separately', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);
    await renderDeckTraceGraphElement(traceGraph, {
      showDefaultWidgets: true
    });
    const layerFilter = renderedDeckProps.current?.layerFilter as
      | ((context: {isPicking: boolean; viewport: {id: string}; layer?: {id?: string}}) => boolean)
      | undefined;

    expect(renderedDeckProps.current?.collapseLegendToProcessLabelOverlay).toBe(false);
    expect(
      layerFilter?.({
        isPicking: false,
        viewport: {id: 'legend'},
        layer: {id: 'primary-legend-rank-a-legend-stream-names'}
      })
    ).toBe(true);
    expect(
      layerFilter?.({
        isPicking: false,
        viewport: {id: 'legend'},
        layer: {id: 'trace-graph-1-rank-background'}
      })
    ).toBe(false);
    expect(
      layerFilter?.({
        isPicking: false,
        viewport: {id: 'legend-background'},
        layer: {id: 'trace-graph-1-rank-background'}
      })
    ).toBe(true);
  });

  it('focuses the clicked span lane when shift-clicking the rank layer span payload', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createSelectionTraceGraph();
    const {onSelectionChange} = await renderDeckTraceGraphElement(traceGraph);
    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    const onSpanClick = latestLayersCall?.onSpanClick as
      | ((info: {object?: unknown}, event?: {srcEvent?: {shiftKey?: boolean}}) => boolean)
      | undefined;

    expect(typeof onSpanClick).toBe('function');

    let handled = false;
    flushSync(() => {
      handled =
        onSpanClick?.(
          {object: wrapTestPickedTraceObject(selectedBlock)},
          {srcEvent: {shiftKey: true}}
        ) ?? false;
    });
    expect(document.querySelector('[data-testid="trace-layout-busy-overlay"]')).not.toBeNull();
    await waitForDeferredTraceLayoutUpdate();

    expect(handled).toBe(true);
    const nextLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {
          selectedSpanRefs?: SpanRef[];
          selectedDependencies?: Array<{dependencyId: TraceDependencyId}>;
          traceLayout?: TraceLayout;
        }
      | undefined;
    const threadLayout = getLayoutThreadForSpanRef(
      nextLayersCall?.traceLayout,
      traceGraph,
      selectedSpanRef
    );
    const selectedLaneIndex =
      getTraceLayoutSpanLaneIndex(nextLayersCall?.traceLayout!, selectedSpanRef) ?? 0;
    expect(nextLayersCall?.selectedSpanRefs).toEqual([selectedSpanRef]);
    expect(
      nextLayersCall?.selectedDependencies?.map(dependency => dependency.dependencyId)
    ).toEqual([]);
    expect(threadLayout?.visible).toBe(true);
    expect(threadLayout?.lanes?.visibleLaneIndices).toEqual(
      expect.arrayContaining([selectedLaneIndex])
    );
    expect(threadLayout?.lanes?.laneYPositions.length).toBeGreaterThan(0);
    expect(onSelectionChange.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        selectedSpanRefs: [selectedSpanRef],
        selectedSameProcessDependencyRefs: [],
        selectedCrossProcessDependencyRefs: [],
        isExtendedSelection: true
      })
    );
  });

  it('focuses the clicked span lane from span-ref lane metadata', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createSelectionTraceGraph();
    await renderDeckTraceGraphElement(traceGraph, {
      showDefaultWidgets: true
    });
    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {
          onSpanClick?: (
            info: {object?: unknown},
            event?: {srcEvent?: {shiftKey?: boolean}}
          ) => boolean;
          traceLayout?: TraceLayout;
        }
      | undefined;
    const onSpanClick = latestLayersCall?.onSpanClick as
      | ((info: {object?: unknown}, event?: {srcEvent?: {shiftKey?: boolean}}) => boolean)
      | undefined;
    const threadLayout = getLayoutThreadForSpanRef(
      latestLayersCall?.traceLayout,
      traceGraph,
      selectedSpanRef
    );
    const actualLaneIndex = getTraceLayoutSpanLaneIndex(
      latestLayersCall?.traceLayout!,
      selectedSpanRef
    );

    expect(typeof onSpanClick).toBe('function');
    expect(threadLayout?.lanes?.laneYPositions.length).toBeGreaterThan(1);
    if (actualLaneIndex == null) {
      throw new Error('Expected selected span lane index');
    }

    flushSync(() => {
      onSpanClick?.(
        {object: wrapTestPickedTraceObject(selectedBlock)},
        {srcEvent: {shiftKey: true}}
      );
    });
    await waitForDeferredTraceLayoutUpdate();

    const nextLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {traceLayout?: TraceLayout; selectedSpanRefs?: SpanRef[]}
      | undefined;
    const nextThreadLayout = getLayoutThreadForSpanRef(
      nextLayersCall?.traceLayout,
      traceGraph,
      selectedSpanRef
    );

    expect(nextLayersCall?.selectedSpanRefs).toEqual([selectedSpanRef]);
    expect(nextThreadLayout?.lanes?.visibleLaneIndices).toEqual(
      expect.arrayContaining([actualLaneIndex])
    );
  });

  it('expands the owning process when focused engine selection is provided', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createDuplicateBlockIdTraceGraph();

    const {engine} = await renderDeckTraceGraphElement(traceGraph, {
      defaultExpandProcess: false,
      selectedSpanRefs: [selectedSpanRef],
      focusSelectedSpanRefs: true
    });

    expect(selectedBlock.processName).toBe('rank-correct');
    expect(engine.getSerializedExpandedProcessIds()).toEqual(['rank-correct']);
  });

  it('keeps the clicked combined-thread lane visible when shift-clicking a span', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createSelectionTraceGraph();
    await renderDeckTraceGraphElement(traceGraph, {
      settings: {...defaultTraceVisSettings, trackAggregationMode: 'combine-threads'}
    });
    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    const onSpanClick = latestLayersCall?.onSpanClick as
      | ((info: {object?: unknown}, event?: {srcEvent?: {shiftKey?: boolean}}) => boolean)
      | undefined;

    expect(typeof onSpanClick).toBe('function');

    let handled = false;
    flushSync(() => {
      handled =
        onSpanClick?.(
          {object: wrapTestPickedTraceObject(selectedBlock)},
          {srcEvent: {shiftKey: true}}
        ) ?? false;
    });
    await waitForDeferredTraceLayoutUpdate();

    const nextLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {selectedSpanRefs?: SpanRef[]; traceLayout?: TraceLayout}
      | undefined;
    const threadLayout = getLayoutThreadForSpanRef(
      nextLayersCall?.traceLayout,
      traceGraph,
      selectedSpanRef
    );
    const laneIndex =
      getTraceLayoutSpanLaneIndex(nextLayersCall?.traceLayout!, selectedSpanRef) ?? 0;
    expect(handled).toBe(true);
    expect(nextLayersCall?.selectedSpanRefs).toEqual([selectedSpanRef]);
    expect(threadLayout?.visible).toBe(true);
    expect(threadLayout?.lanes?.visibleLaneIndices).toEqual(expect.arrayContaining([laneIndex]));
    expect(threadLayout?.lanes?.laneYPositions.length).toBeGreaterThan(0);
  });

  it('hides unrelated combined-thread streams when shift-clicking a head-process span', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef, unrelatedSpanRef} =
      createCombinedThreadSelectionTraceGraph();
    await renderDeckTraceGraphElement(traceGraph, {
      settings: {...defaultTraceVisSettings, trackAggregationMode: 'combine-threads'}
    });
    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    const onSpanClick = latestLayersCall?.onSpanClick as
      | ((info: {object?: unknown}, event?: {srcEvent?: {shiftKey?: boolean}}) => boolean)
      | undefined;

    expect(typeof onSpanClick).toBe('function');

    let handled = false;
    flushSync(() => {
      handled =
        onSpanClick?.(
          {object: wrapTestPickedTraceObject(selectedBlock)},
          {srcEvent: {shiftKey: true}}
        ) ?? false;
    });
    await waitForDeferredTraceLayoutUpdate();

    const nextLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {selectedSpanRefs?: SpanRef[]; traceLayout?: TraceLayout}
      | undefined;
    const nextTraceLayout = nextLayersCall?.traceLayout;
    const selectedThreadLayout = getLayoutThreadForSpanRef(
      nextTraceLayout,
      traceGraph,
      selectedSpanRef
    );
    const unrelatedThreadLayout = getLayoutThreadForSpanRef(
      nextTraceLayout,
      traceGraph,
      unrelatedSpanRef
    );

    expect(handled).toBe(true);
    expect(nextLayersCall?.selectedSpanRefs).toEqual([selectedSpanRef]);
    expect(selectedThreadLayout?.visible).toBe(true);
    expect(unrelatedThreadLayout?.visible ?? false).toBe(false);
    expect(nextTraceLayout).toBeDefined();
    if (!nextTraceLayout) {
      throw new Error('Expected trace layout for combined-thread focus test');
    }
    expect(
      getTraceLayoutSpanGeometryBySpanRef({
        traceLayout: nextTraceLayout,
        spanRef: unrelatedSpanRef
      })
    ).toBeUndefined();
  });

  it('preserves combined-thread lane ordering for a focused head-process parent chain', async () => {
    const {traceGraph, childBlock, childSpanRef, parentSpanRef, spacerSpanRef, dependencyId} =
      createCombinedThreadDependencySelectionTraceGraph();
    const {rerender} = await renderDeckTraceGraphElement(traceGraph, {
      settings: {...defaultTraceVisSettings, trackAggregationMode: 'combine-threads'}
    });
    const initialLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {traceLayout?: TraceLayout}
      | undefined;
    const parentLaneIndex = getTraceLayoutSpanLaneIndex(
      initialLayersCall?.traceLayout!,
      parentSpanRef
    );
    const childLaneIndex = getTraceLayoutSpanLaneIndex(
      initialLayersCall?.traceLayout!,
      childSpanRef
    );

    expect(parentLaneIndex).toBe(0);
    expect(childLaneIndex).toBeGreaterThan(1);

    await rerender({
      selectedSpanRefs: [childSpanRef],
      focusSelectedSpanRefs: true,
      selectionPolicy: {type: 'dependency-chain', keywords: ['PARENT']},
      extendedSelectionMode: 'fade',
      settings: {...defaultTraceVisSettings, trackAggregationMode: 'combine-threads'}
    });

    const nextLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {traceLayout?: TraceLayout}
      | undefined;
    const nextTraceLayout = nextLayersCall?.traceLayout;
    const focusedCombinedThreadLayout = nextTraceLayout?.processLayouts[0]?.threadLayouts[0];
    const dependencyRef = traceGraph
      .getSameProcessDependencyRefs(getRequiredProcessRef(traceGraph, 'head-rank'))
      .find(candidateRef => traceGraph.getDependencyId(candidateRef) === dependencyId);
    const dependencyGeometry =
      dependencyRef == null
        ? undefined
        : nextTraceLayout == null
          ? undefined
          : getTraceLayoutVisibleDependencyGeometry({
              traceLayout: nextTraceLayout,
              dependencyRef
            });

    expect(focusedCombinedThreadLayout?.lanes?.visibleLaneIndices).toEqual([
      parentLaneIndex,
      childLaneIndex
    ]);
    expect(getTraceLayoutSpanLaneIndex(nextTraceLayout!, parentSpanRef)).toBe(parentLaneIndex);
    expect(getTraceLayoutSpanLaneIndex(nextTraceLayout!, childSpanRef)).toBe(childLaneIndex);
    expect(dependencyGeometry).toBeDefined();
    expect(dependencyGeometry?.[1]).toBeLessThan(
      dependencyGeometry?.[3] ?? Number.NEGATIVE_INFINITY
    );
    expect(nextTraceLayout).toBeDefined();
    if (!nextTraceLayout) {
      throw new Error('Expected trace layout for combined-thread dependency focus test');
    }
    expect(
      getTraceLayoutSpanGeometryBySpanRef({
        traceLayout: nextTraceLayout,
        spanRef: spacerSpanRef
      })
    ).toBeUndefined();
    expect(childBlock.spanId).toBe('head-thread-b-child');
  });

  it('emits an anchor transition when shift-click moves the clicked span position', async () => {
    const {traceGraph, childSpanRef} = createSelectionTraceGraph();
    const childBlock = getRequiredVisibleDisplaySourceBySpanId(
      traceGraph,
      'focus-child' as TraceSpanId
    );
    const getMainViewStateMock = mockManagedViewsController.getMainViewState as unknown as {
      mockReturnValue: (value: unknown) => void;
    };
    getMainViewStateMock.mockReturnValue({
      target: [12, 34, 0],
      zoom: [-5, 5]
    });

    await renderDeckTraceGraphElement(traceGraph);
    const initialLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {
          onSpanClick?: (
            info: {object?: unknown},
            event?: {srcEvent?: {shiftKey?: boolean}}
          ) => boolean;
          traceLayout?: TraceLayout;
        }
      | undefined;
    const onSpanClick = initialLayersCall?.onSpanClick;

    expect(childBlock).toBeTruthy();
    expect(typeof onSpanClick).toBe('function');

    flushSync(() => {
      onSpanClick?.({object: wrapTestPickedTraceObject(childBlock)}, {srcEvent: {shiftKey: true}});
    });
    await waitForDeferredTraceLayoutUpdate();

    const nextLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {traceLayout?: TraceLayout}
      | undefined;
    const nextGeometry =
      nextLayersCall?.traceLayout == null
        ? undefined
        : getTraceLayoutSpanGeometryBySpanRef({
            traceLayout: nextLayersCall.traceLayout,
            spanRef: childSpanRef
          });

    expect(nextGeometry).toBeDefined();

    const viewAnchorTransition = renderedDeckProps.current?.viewAnchorTransition as
      | {deltaY: number; key: string}
      | null
      | undefined;
    expect(viewAnchorTransition).toEqual(
      expect.objectContaining({
        deltaY: expect.any(Number),
        key: expect.stringContaining(String(childSpanRef))
      })
    );
    expect(Math.abs(viewAnchorTransition?.deltaY ?? 0)).toBeGreaterThan(1e-3);
    expect(mockManagedViewsController.panTo).not.toHaveBeenCalled();
  });

  it('shows the hover card while a selected span card is active', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createSelectionTraceGraph();
    await renderDeckTraceGraphElement(traceGraph, {
      selectedSpanRefs: [selectedSpanRef],
      showDefaultWidgets: true
    });
    const deckOnHover = renderedDeckProps.current?.onHover as
      | ((
          info: {object?: unknown},
          event?: {srcEvent?: {clientX?: number; clientY?: number}}
        ) => void)
      | undefined;

    expect(typeof deckOnHover).toBe('function');

    flushSync(() => {
      deckOnHover?.(createHoverPickInfo(selectedBlock, 10, 20), {
        srcEvent: {clientX: 10, clientY: 20}
      });
    });
    await waitForHoverPopupRender();

    expect(document.body.textContent).toMatch(/(?:Ctrl\+C|⌘C)/);
    expect(document.body.textContent).toContain('to copy');
  });

  it('keeps span hover cards as unnamed tooltips', async () => {
    const {traceGraph, selectedBlock} = createSelectionTraceGraph();
    await renderDeckTraceGraphElement(traceGraph, {
      showDefaultWidgets: true
    });
    const deckOnHover = renderedDeckProps.current?.onHover as
      | ((
          info: {object?: unknown},
          event?: {srcEvent?: {clientX?: number; clientY?: number}}
        ) => void)
      | undefined;

    expect(typeof deckOnHover).toBe('function');

    flushSync(() => {
      deckOnHover?.(createHoverPickInfo(selectedBlock, 10, 220), {
        srcEvent: {clientX: 10, clientY: 220}
      });
    });
    await waitForHoverPopupRender();

    expect(getTraceTooltipMock().textContent).toContain('focus-selected');
    expect(document.querySelector('[data-testid="span-inspector-popup"]')).toBeNull();
    expect(document.querySelector('[data-testid="span-inspector-resize-handle"]')).toBeNull();
  });

  it('resolves compared-graph hover cards against the picked graph', async () => {
    const primaryTraceGraph = createRankAppendTraceGraph(['rank-a'], 'primary-trace');
    const secondaryTraceGraph = createRankAppendTraceGraph(['rank-a'], 'secondary-trace');
    const secondarySpan = getRequiredVisibleDisplaySourceBySpanId(
      secondaryTraceGraph,
      'rank-a-span' as TraceSpanId
    );
    await renderDeckTraceGraphElement(primaryTraceGraph, {
      secondaryTraceGraph,
      showDefaultWidgets: true
    });
    const deckOnHover = renderedDeckProps.current?.onHover as
      | ((
          info: {layer?: {id?: string}; object?: unknown},
          event?: {srcEvent?: {clientX?: number; clientY?: number}}
        ) => void)
      | undefined;

    expect(typeof deckOnHover).toBe('function');

    flushSync(() => {
      deckOnHover?.(
        {
          ...createHoverPickInfo(secondarySpan, 10, 220),
          layer: {id: 'trace-graph-1-block-rectangles'}
        },
        {
          srcEvent: {clientX: 10, clientY: 220}
        }
      );
    });
    await waitForHoverPopupRender();

    expect(getTraceTooltipMock().dataset.traceGraphName).toBe('secondary-trace');
  });

  it('renders a transient minimap indicator for hovered spans', async () => {
    const {traceGraph, selectedBlock} = createSelectionTraceGraph();
    await renderDeckTraceGraphElement(traceGraph, {
      settings: {...defaultTraceVisSettings, showOverview: true}
    });
    const deckOnHover = renderedDeckProps.current?.onHover as
      | ((
          info: {object?: unknown},
          event?: {srcEvent?: {clientX?: number; clientY?: number}}
        ) => void)
      | undefined;

    flushSync(() => {
      deckOnHover?.(createHoverPickInfo(selectedBlock, 10, 220), {
        srcEvent: {clientX: 10, clientY: 220}
      });
    });
    await Promise.resolve();

    const latestCall = buildDeckLayersForMinimapSpanIndicatorsSpy.mock.calls.at(-1)?.[0] as
      | {indicators?: Array<{kind: string}>}
      | undefined;
    expect(latestCall?.indicators?.map(({kind}) => kind)).toEqual(['hovered']);
  });

  it('keeps selected and hovered minimap indicators separate and dedupes matching refs', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createSelectionTraceGraph();
    const childBlock = getRequiredVisibleDisplaySourceBySpanId(
      traceGraph,
      'focus-child' as TraceSpanId
    );
    await renderDeckTraceGraphElement(traceGraph, {
      selectedSpanRefs: [selectedSpanRef],
      settings: {...defaultTraceVisSettings, showOverview: true}
    });
    const deckOnHover = renderedDeckProps.current?.onHover as
      | ((
          info: {object?: unknown},
          event?: {srcEvent?: {clientX?: number; clientY?: number}}
        ) => void)
      | undefined;

    flushSync(() => {
      deckOnHover?.(createHoverPickInfo(childBlock, 10, 220), {
        srcEvent: {clientX: 10, clientY: 220}
      });
    });
    await Promise.resolve();

    let latestCall = buildDeckLayersForMinimapSpanIndicatorsSpy.mock.calls.at(-1)?.[0] as
      | {indicators?: Array<{kind: string}>}
      | undefined;
    expect(latestCall?.indicators?.map(({kind}) => kind)).toEqual(['selected', 'hovered']);

    flushSync(() => {
      deckOnHover?.(createHoverPickInfo(selectedBlock, 10, 220), {
        srcEvent: {clientX: 10, clientY: 220}
      });
    });
    await Promise.resolve();

    latestCall = buildDeckLayersForMinimapSpanIndicatorsSpy.mock.calls.at(-1)?.[0] as
      | {indicators?: Array<{kind: string}>}
      | undefined;
    expect(latestCall?.indicators?.map(({kind}) => kind)).toEqual(['selected']);
  });

  it('does not wrap non-span tooltip content in the Span Inspector shell', async () => {
    const {traceGraph} = createSelectionTraceGraph();
    await renderDeckTraceGraphElement(traceGraph, {
      showDefaultWidgets: true
    });
    const deckOnHover = renderedDeckProps.current?.onHover as
      | ((
          info: {object?: unknown},
          event?: {srcEvent?: {clientX?: number; clientY?: number}}
        ) => void)
      | undefined;

    expect(typeof deckOnHover).toBe('function');

    flushSync(() => {
      deckOnHover?.(
        createHoverPickInfo(
          {object: {id: 'marker', timeMs: 0, tooltip: 'Marker tooltip'}},
          10,
          220
        ),
        {srcEvent: {clientX: 10, clientY: 220}}
      );
    });
    await waitForHoverPopupRender();

    expect(document.body.textContent).toContain('Marker tooltip');
    expect(document.querySelector('[data-testid="span-inspector-popup"]')).toBeNull();
    expect(document.querySelector('[data-testid="span-inspector-resize-handle"]')).toBeNull();
  });

  it('starts with empty engine selection when the host has no durable selected refs', async () => {
    const traceGraph = createSelectionTraceGraph().traceGraph;
    const {engine, onSelectionChange} = await renderDeckTraceGraphElement(traceGraph);

    expect(engine.getSelectedSpanRefs()).toEqual([]);
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('keeps dependency-chain parent refs out of selected span overlays', async () => {
    const {traceGraph, childSpanRef, childBlockFromGraph} = createParentSelectionTraceGraph();
    await renderDeckTraceGraphElement(traceGraph, {
      selectedSpanRefs: [childSpanRef],
      focusSelectedSpanRefs: true,
      selectionPolicy: {type: 'dependency-chain', keywords: ['PARENT']}
    });
    const deckOnClick = renderedDeckProps.current?.onClick as
      | ((info: {object?: unknown}, event?: unknown) => void)
      | undefined;

    expect(typeof deckOnClick).toBe('function');
    flushSync(() => {
      deckOnClick?.({object: wrapTestPickedTraceObject(childBlockFromGraph)});
    });
    await Promise.resolve();

    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(latestLayersCall?.selectedSpanRefs).toEqual([childSpanRef]);

    const highlightedSpanRefs = latestLayersCall?.highlightedSpanRefs as Set<SpanRef> | undefined;
    expect(highlightedSpanRefs).toBeUndefined();
  });

  it('expands the owning process on first render when a durable selected span ref is provided', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createSelectionTraceGraph();

    const {engine} = await renderDeckTraceGraphElement(traceGraph, {
      defaultExpandProcess: false,
      selectedSpanRefs: [selectedSpanRef]
    });

    expect(engine.getSerializedExpandedProcessIds()).toEqual([selectedBlock.processName]);
    expect(engine.getSelectedSpans()).toEqual([
      {
        spanRef: selectedSpanRef,
        span: expect.objectContaining({
          spanId: selectedBlock.spanId,
          name: selectedBlock.name
        })
      }
    ]);
  });

  it('clears mounted selected span refs when clicking empty deck space', async () => {
    const {traceGraph, selectedSpanRef} = createSelectionTraceGraph();
    const {engine, onSelectionChange} = await renderDeckTraceGraphElement(traceGraph, {
      selectedSpanRefs: [selectedSpanRef]
    });
    const deckOnClick = renderedDeckProps.current?.onClick as
      | ((info: {object?: unknown}, event?: unknown) => void)
      | undefined;

    expect(typeof deckOnClick).toBe('function');
    expect(engine.getSelectedSpanRefs()).toEqual([selectedSpanRef]);

    flushSync(() => {
      deckOnClick?.({object: null});
    });
    await Promise.resolve();

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedSpanRefs: [],
        selectedSpans: [],
        selectedSameProcessDependencyRefs: [],
        selectedCrossProcessDependencyRefs: [],
        isExtendedSelection: false
      })
    );
  });

  it('keeps selected dependency-chain spans in the highlighted set when fade mode is active', async () => {
    const {traceGraph, parentSpanRef, childBlockFromGraph, unrelatedBlockId} =
      createParentSelectionTraceGraphWithUnrelated();
    await renderDeckTraceGraphElement(traceGraph, {
      selectedSpanRefs: [childBlockFromGraph.spanRef!],
      focusSelectedSpanRefs: true,
      selectionPolicy: {type: 'dependency-chain', keywords: ['PARENT']},
      extendedSelectionMode: 'fade',
      highlightedSpanRefs: new Set([getRequiredSpanRefBySpanId(traceGraph, unrelatedBlockId)])
    });

    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    const highlightedSpanRefs = latestLayersCall?.highlightedSpanRefs as Set<SpanRef> | undefined;
    expect(highlightedSpanRefs).toBeInstanceOf(Set);
    expect(highlightedSpanRefs).toEqual(
      new Set([
        getRequiredSpanRefBySpanId(traceGraph, unrelatedBlockId),
        childBlockFromGraph.spanRef!,
        parentSpanRef
      ])
    );
  });

  it('focuses only lanes referenced by focused dependency-chain refs', async () => {
    const {traceGraph, parentSpanRef, childBlockFromGraph, unrelatedBlockId} =
      createParentSelectionTraceGraphWithUnrelated();
    await renderDeckTraceGraphElement(traceGraph, {
      selectedSpanRefs: [childBlockFromGraph.spanRef!],
      focusSelectedSpanRefs: true,
      selectionPolicy: {type: 'dependency-chain', keywords: ['PARENT']},
      extendedSelectionMode: 'fade'
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {processRows?: readonly TracePreparedProcessRow[]; traceLayout?: TraceLayout}
      | undefined;
    const streamLayout = getLayoutThreadForSpanRef(
      latestLayersCall?.traceLayout,
      traceGraph,
      childBlockFromGraph.spanRef
    );
    const childLaneIndex = getTraceLayoutSpanLaneIndex(
      latestLayersCall?.traceLayout!,
      childBlockFromGraph.spanRef
    );
    const parentLaneIndex = getTraceLayoutSpanLaneIndex(
      latestLayersCall?.traceLayout!,
      parentSpanRef
    );
    const unrelatedSpanRef = getRequiredSpanRefBySpanId(traceGraph, unrelatedBlockId);
    const unrelatedLaneIndex = getTraceLayoutSpanLaneIndex(
      latestLayersCall?.traceLayout!,
      unrelatedSpanRef
    );

    expect(typeof parentLaneIndex).toBe('number');
    expect(typeof childLaneIndex).toBe('number');
    expect(typeof unrelatedLaneIndex).toBe('number');
    expect(streamLayout?.lanes?.visibleLaneIndices).toEqual(
      expect.arrayContaining([parentLaneIndex!, childLaneIndex!])
    );
    expect(streamLayout?.lanes?.visibleLaneIndices).not.toContain(unrelatedLaneIndex);
    expect(latestLayersCall?.traceLayout?.renderRows).toEqual([
      expect.objectContaining({
        processId: traceGraph.processes[0]?.processId
      })
    ]);
    const childSpanRef = childBlockFromGraph.spanRef!;
    const expectedRowSpanRefs = [parentSpanRef, childSpanRef, unrelatedSpanRef];
    expect(latestLayersCall?.processRows?.[0]).not.toHaveProperty('spans');
    expect(getPreparedSpanRefs(latestLayersCall?.processRows?.[0]?.binaryBlockData?.spans)).toEqual(
      expectedRowSpanRefs
    );
    expect(latestLayersCall?.processRows?.[0]?.binaryBlockData?.data.length).toBe(
      expectedRowSpanRefs.length
    );
    const binarySizes = latestLayersCall?.processRows?.[0]?.binaryBlockData?.data.attributes.getSize
      ?.value as Float32Array | undefined;
    expect(binarySizes?.[expectedRowSpanRefs.indexOf(parentSpanRef) * 2]).toBeGreaterThan(0);
    expect(binarySizes?.[expectedRowSpanRefs.indexOf(childSpanRef) * 2]).toBeGreaterThan(0);
    expect(binarySizes?.[expectedRowSpanRefs.indexOf(unrelatedSpanRef) * 2]).toBe(0);
    expect(binarySizes?.[expectedRowSpanRefs.indexOf(unrelatedSpanRef) * 2 + 1]).toBe(0);
  });

  it('keeps selected cross-process dependency endpoints in focused extended-selection layouts', async () => {
    const parentProcess = createProcess('parent-rank', 0, 'parent');
    const parentBlock = parentProcess.spans[0]!;
    const childBlock: TraceSpan = {
      ...parentBlock,
      spanId: 'child' as TraceSpanId,
      name: 'child',
      timings: {
        primary: {
          status: 'finished',
          startTimeMs: 2,
          endTimeMs: 8,
          durationMs: 6,
          durationMsAsString: '6ms'
        }
      }
    };
    parentProcess.spans = [parentBlock, childBlock];
    parentProcess.spanMap = {
      [parentBlock.spanId]: parentBlock,
      [childBlock.spanId]: childBlock
    };
    const remoteProcess = createProcess('remote-rank', 1, 'remote-child');
    const remoteBlock = remoteProcess.spans[0]!;
    const crossProcessDependencyId = 'dep-child-remote' as TraceDependencyId;
    const traceGraph = createTestTraceGraph(
      buildJSONTrace(
        [parentProcess, remoteProcess],
        [
          createCrossProcessDependency(
            crossProcessDependencyId,
            childBlock.spanId,
            remoteBlock.spanId,
            0,
            1
          )
        ],
        {name: 'deck-trace-graph-focused-cross-endpoint-test'}
      )
    );
    const parentSpanRef = getRequiredSpanRefBySpanId(traceGraph, parentBlock.spanId);
    const remoteSpanRef = getRequiredSpanRefBySpanId(traceGraph, remoteBlock.spanId);
    const crossProcessDependencyRef = getRequiredCrossProcessDependencyRefById(
      traceGraph,
      crossProcessDependencyId
    );
    if (crossProcessDependencyRef == null) {
      throw new Error('Expected visible cross-process dependency ref for focused endpoint test');
    }

    await renderDeckTraceGraphElement(traceGraph, {
      selectedSpanRefs: [parentSpanRef],
      focusSelectedSpanRefs: true,
      extendedSelectionMode: 'fade',
      selectedCrossProcessDependencyRefs: new Set([crossProcessDependencyRef])
    });

    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {traceLayout?: TraceLayout}
      | undefined;
    const focusedLayout = latestLayersCall?.traceLayout;
    expect(focusedLayout).toBeDefined();
    if (!focusedLayout) {
      throw new Error('Expected focused trace layout');
    }
    expect(
      getTraceLayoutSpanGeometryBySpanRef({
        traceLayout: focusedLayout,
        spanRef: remoteSpanRef
      })
    ).toBeDefined();
    expect(
      getTraceLayoutVisibleDependencyGeometry({
        traceLayout: focusedLayout,
        dependencyRef: crossProcessDependencyRef
      })
    ).toBeDefined();
  });

  it('passes controlled extended dependency refs into local selected overlay sources', async () => {
    const {traceGraph, childSpanRef} = createParentSelectionTraceGraph();
    const selectionState = getTraceSpanDependencySelection({
      traceGraph,
      spanRef: childSpanRef,
      keywords: new Set(['PARENT'])
    });

    await renderDeckTraceGraphElement(traceGraph, {
      selectedSpanRefs: [childSpanRef],
      selectedSameProcessDependencyRefs: new Set(selectionState.visibleSameProcessDependencyRefs),
      selectedSameProcessDependencyDirectionByRef: new Map([
        [selectionState.visibleSameProcessDependencyRefs[0]!, 'outgoing']
      ])
    });

    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {
          selectedSameProcessDependencySourcesByProcessId?: Record<
            string,
            Array<{dependencyRef: number; selectedDirection: string}>
          >;
        }
      | undefined;

    expect(latestLayersCall?.selectedSameProcessDependencySourcesByProcessId).toEqual({
      [String(getRequiredProcessRef(traceGraph, 'parent-rank'))]: [
        expect.objectContaining({
          dependencyRef: selectionState.visibleSameProcessDependencyRefs[0],
          selectedDirection: 'outgoing'
        })
      ]
    });
  });

  it('renders the minimap from collapsed process activity while the main timeline stays expanded', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a', 'rank-b']);

    await renderDeckTraceGraphElement(traceGraph, {
      defaultExpandProcess: true,
      settings: {
        ...defaultTraceVisSettings,
        showOverview: true
      }
    });

    const overviewLayersCall = buildDeckLayerForTraceProcessActivitySummarySpy.mock.calls.find(
      ([args]) => args.layerIdPrefix === 'minimap-trace'
    )?.[0] as
      | {
          data?: {
            data?: {length?: number};
            processRows?: TraceLayoutRow[];
            processRowIndices?: Uint32Array;
          };
          modelMatrix?: unknown;
        }
      | undefined;
    const mainLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {
          scene?: {
            rows?: Array<{row?: {isCollapsed?: boolean}}>;
            layout?: TraceLayout;
          };
        }
      | undefined;

    expect(overviewLayersCall?.data?.data?.length).toBeGreaterThan(0);
    expect(overviewLayersCall?.data?.processRows?.length).toBe(traceGraph.processes.length);
    expect(overviewLayersCall?.data?.processRowIndices?.length).toBe(
      overviewLayersCall?.data?.data?.length
    );
    expect(overviewLayersCall?.modelMatrix).toBeTruthy();
    expect(mainLayersCall?.scene?.rows?.every(row => row.row?.isCollapsed)).toBe(false);
    const overviewBounds = renderedDeckProps.current?.overviewBounds as
      | [[number, number], [number, number]]
      | undefined;
    expect(overviewBounds?.[0][0]).toBe(0);
    expect(overviewBounds?.[1][1]).toBeGreaterThan(overviewBounds?.[0][1] ?? 0);
  });

  it('expands a collapsed process when its minimap activity overview is clicked', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);
    const onExpandedProcessIdsChange = vi.fn();

    await renderDeckTraceGraphElement(traceGraph, {
      defaultExpandProcess: false,
      onExpandedProcessIdsChange,
      settings: {
        ...defaultTraceVisSettings,
        showOverview: true
      }
    });

    /** Returns the latest minimap process activity layer build request. */
    const getLatestOverviewLayersCall = () =>
      buildDeckLayerForTraceProcessActivitySummarySpy.mock.calls
        .filter(([args]) => args.layerIdPrefix === 'minimap-trace')
        .at(-1)?.[0] as
        | {
            data?: {processRows?: TraceLayoutRow[]};
            onProcessClick?: (row: TraceLayoutRow) => void;
          }
        | undefined;
    const firstOverviewLayersCall = getLatestOverviewLayersCall();
    const processRow = firstOverviewLayersCall?.data?.processRows?.[0];
    expect(processRow?.processId).toBe('rank-a');
    onExpandedProcessIdsChange.mockClear();

    flushSync(() => {
      if (processRow) {
        firstOverviewLayersCall?.onProcessClick?.(processRow);
      }
    });
    expect(document.querySelector('[data-testid="trace-layout-busy-overlay"]')).not.toBeNull();
    await waitForDeferredTraceLayoutUpdate();

    expect(onExpandedProcessIdsChange).toHaveBeenLastCalledWith(['rank-a']);
    onExpandedProcessIdsChange.mockClear();

    const expandedOverviewLayersCall = getLatestOverviewLayersCall();
    flushSync(() => {
      if (processRow) {
        expandedOverviewLayersCall?.onProcessClick?.(processRow);
      }
    });
    await Promise.resolve();

    expect(onExpandedProcessIdsChange).not.toHaveBeenCalled();
  });

  it('expands only the minimap bounds from overview time range and forwards loaded bounds', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);

    await renderDeckTraceGraphElement(traceGraph, {
      settings: {
        ...defaultTraceVisSettings,
        showOverview: true
      },
      overviewTimeRange: {
        startTimeMs: -50,
        endTimeMs: 200
      },
      overviewLoadedTimeRange: {
        startTimeMs: 10,
        endTimeMs: 40
      }
    });

    expect(renderedDeckProps.current?.bounds).toEqual([
      [0, 0],
      [100, 100]
    ]);
    const overviewBounds = renderedDeckProps.current?.overviewBounds as
      | [[number, number], [number, number]]
      | undefined;
    expect(overviewBounds?.[0][0]).toBe(-50 - traceGraph.minTimeMs);
    expect(overviewBounds?.[1][0]).toBe(200 - traceGraph.minTimeMs);

    const overviewLayerArgs = buildOverviewLayersSpy.mock.calls.at(-1)?.[0] as
      | {
          bounds: [[number, number], [number, number]];
          loadedContentBounds: {minX: number; maxX: number};
          formatTick: (tick: {type: 'major' | 'minor'; value: number}) => string | undefined;
        }
      | undefined;
    if (!overviewLayerArgs) {
      throw new Error('Expected overview layer args');
    }
    expect(overviewLayerArgs.loadedContentBounds).toEqual({
      minX: 10 - traceGraph.minTimeMs,
      maxX: 40 - traceGraph.minTimeMs
    });
    expect(overviewLayerArgs.bounds).toBe(overviewBounds);
    expect(typeof overviewLayerArgs.formatTick({type: 'major', value: 10})).toBe('string');
    expect(overviewLayerArgs.formatTick({type: 'minor', value: 10})).toBe('');
  });

  it('reuses overview bounds objects across unrelated rerenders', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);
    const overviewEventMarkers: [] = [];
    const {rerender} = await renderDeckTraceGraphElement(traceGraph, {
      className: 'initial-class',
      overviewEventMarkers,
      settings: {
        ...defaultTraceVisSettings,
        showOverview: true
      },
      overviewTimeRange: {
        startTimeMs: -50,
        endTimeMs: 200
      },
      overviewLoadedTimeRange: {
        startTimeMs: 10,
        endTimeMs: 40
      }
    });

    const firstOverviewBounds = renderedDeckProps.current?.overviewBounds as
      | [[number, number], [number, number]]
      | undefined;
    const firstOverviewLayerArgs = buildOverviewLayersSpy.mock.calls.at(-1)?.[0] as
      | {
          bounds: [[number, number], [number, number]];
          loadedContentBounds: {minX: number; maxX: number};
        }
      | undefined;
    const firstLoadedContentBounds = firstOverviewLayerArgs?.loadedContentBounds;
    const initialOverviewLayerCallCount = buildOverviewLayersSpy.mock.calls.length;

    await rerender({className: 'rerendered-class'});

    const secondOverviewBounds = renderedDeckProps.current?.overviewBounds as
      | [[number, number], [number, number]]
      | undefined;
    const secondOverviewLayerArgs = buildOverviewLayersSpy.mock.calls.at(-1)?.[0] as
      | {
          bounds: [[number, number], [number, number]];
          loadedContentBounds: {minX: number; maxX: number};
        }
      | undefined;

    expect(secondOverviewBounds).toBe(firstOverviewBounds);
    expect(secondOverviewLayerArgs?.loadedContentBounds).toBe(firstLoadedContentBounds);
    expect(buildOverviewLayersSpy.mock.calls.length).toBe(initialOverviewLayerCallCount);
  });

  it('builds matching time-anchor layers for the main timeline and minimap', async () => {
    const traceGraph = createRankAppendTraceGraph(['rank-a']);
    const timeAnchorMarker = {
      id: 'anchor',
      timeMs: 42,
      tooltip: 'Center time around which spans are loaded.'
    };

    await renderDeckTraceGraphElement(traceGraph, {
      timeAnchorMarker,
      settings: {
        ...defaultTraceVisSettings,
        showOverview: true
      }
    });

    expect(buildDeckLayersForTimeAnchorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        marker: timeAnchorMarker,
        originTimeMs: traceGraph.minTimeMs
      })
    );
  });
});
