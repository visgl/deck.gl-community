import {createRef, useEffect, useMemo, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  getTraceLayoutSpanGeometryBySpanRef,
  getTraceLayoutVisibleDependencyGeometry
} from '../../../layers/layers/trace-layout-geometry';
import {
  buildInitialTraceLayoutCollapseState,
  buildJSONTrace,
  buildTraceGraphDataFromJSONTrace,
  DEFAULT_TRACE_STYLE,
  expandSelectedSpanProcessRefs,
  getExpandedProcessIdsFromCollapseState,
  pruneTraceLayoutThreadCollapseStateForLaneRefs,
  selectTraceLayoutCollapseStateUpdate,
  setAllTraceProcessesExpanded,
  toggleTraceProcessCollapse,
  toggleTraceThreadCollapse,
  TraceGraph
} from '../../../trace/index';
import {createStaticTraceGraphRuntimeSource} from '../../../trace/trace-chunk-store';
import {
  getRequiredSpanRefBySpanId,
  getRequiredVisibleDisplaySourceBySpanId,
  getTraceGraphSpanDependencies,
  mergeTraceLayoutSpanGeometryChunksForTest
} from '../../../trace/trace-graph/trace-graph-test-utils';
import {DeckTraceGraph} from './deck-trace-graph';

import type {
  ProcessRef,
  SpanRef,
  TraceCrossProcessDependency,
  TraceDependencyId,
  TraceLayout,
  TraceLayoutCollapseState,
  TraceLayoutRow,
  TraceLocalDependency,
  TracePreparedProcessRow,
  TraceProcess,
  TraceRenderSpan,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../../../trace/index';
import type {TraceSpanDisplaySource} from '../../../trace/trace-graph-accessors';
import type {
  DeckTraceGraphExternalOmniBoxSearchProvider,
  DeckTraceGraphHandle,
  DeckTraceGraphPickedObject,
  DeckTraceGraphPickedObjectResolver
} from './deck-trace-graph';
import type {Widget} from '@deck.gl/core';
import type {ComponentPropsWithoutRef, Ref} from 'react';
import type {Root} from 'react-dom/client';

function createTestTraceGraph(
  traceGraphData: Parameters<typeof createStaticTraceGraphRuntimeSource>[0]['traceGraphData'],
  options?: ConstructorParameters<typeof TraceGraph>[1]
): TraceGraph {
  return new TraceGraph(
    createStaticTraceGraphRuntimeSource({
      identityKey: `${traceGraphData.name}:test`,
      traceGraphData
    }),
    options
  );
}

function getRequiredProcessRef(traceGraph: TraceGraph, processId: string) {
  const processIndex = traceGraph.processes.findIndex(process => process.processId === processId);
  const processRef = processIndex >= 0 ? (traceGraph.getProcessRefs()[processIndex] ?? null) : null;
  if (processRef == null) {
    throw new Error(`Expected process ref for ${processId}`);
  }
  return processRef;
}

const renderedDeckProps = vi.hoisted(() => ({current: null as Record<string, unknown> | null}));
const buildDeckLayersForTraceSpy = vi.hoisted(() => vi.fn());
const buildDeckLayerForTraceProcessActivitySummarySpy = vi.hoisted(() => vi.fn());
const buildDeckLayersForMinimapSpanIndicatorsSpy = vi.hoisted(() => vi.fn());
const buildDeckLayersForInstantsAndCounterSpy = vi.hoisted(() => vi.fn());
const buildDeckLayersForTimeMeasureSpy = vi.hoisted(() => vi.fn());
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

vi.mock('./deck-with-managed-views', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    DeckWithManagedViews: React.forwardRef((props: Record<string, unknown>, ref) => {
      const hoverPopupHostRef = React.useRef<HTMLDivElement | null>(null);

      React.useImperativeHandle(ref, () => mockManagedViewsController);
      renderedDeckProps.current = props;
      React.useLayoutEffect(() => {
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
  };
});

vi.mock('@deck.gl-community/panels', async () => {
  const actual = await vi.importActual<typeof import('@deck.gl-community/panels')>(
    '@deck.gl-community/panels'
  );

  return {
    ...actual,
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
    TabbedPanel: class {
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
    }
  };
});

vi.mock('@deck.gl-community/widgets', async () => {
  const actual = await vi.importActual<typeof import('@deck.gl-community/widgets')>(
    '@deck.gl-community/widgets'
  );

  class MockWidget {
    props: Record<string, unknown>;
    constructor(props: Record<string, unknown>) {
      this.props = props;
    }
  }
  class MockTimeMeasureWidget extends MockWidget {
    static performAction() {}
  }

  return {
    ...actual,
    CommandToggleWidget: MockWidget,
    createStudioSettingsWidget: (props: Record<string, unknown>) => new MockWidget(props),
    ModalPanelWidget: MockWidget,
    OmniBoxWidget: MockWidget,
    TimeMeasureWidget: MockTimeMeasureWidget,
    ToastWidget: MockWidget
  };
});

vi.mock('../../../layers/index', () => ({
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
  ModalWidget: class {
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
  buildDeckLayersForLegend: () => [],
  buildDeckLayersForMinimapSpanIndicators: (...args: any[]) => {
    buildDeckLayersForMinimapSpanIndicatorsSpy(...args);
    return [];
  },
  buildDeckLayersForTimeMeasure: (...args: any[]) => {
    buildDeckLayersForTimeMeasureSpy(...args);
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
            traceGraph: params.scene.graph,
            traceLayout: params.scene.layout
          }
        : params,
      ...args.slice(1)
    );
    return [];
  },
  buildOverviewLayers: (arg: unknown) => buildOverviewLayersSpy(arg)
}));

vi.mock('./trace-tooltip', () => ({
  TraceTooltip: ({object}: {object: TraceSpan | TraceRenderSpan | null}) => (
    <div data-testid="trace-tooltip">{object?.name ?? 'empty'}</div>
  )
}));

const defaultTraceVisSettings: TraceVisSettings = {
  showDependencies: true,
  localDependencyMode: 'all',
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
  traceRunSummaryAggregationKey: 'latest'
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
    localDependencyIds: [],
    localDependencies: [],
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
    localDependencies: [],
    remoteDependencies: []
  };
}

/** Builds a visible cross-process parent dependency for deck selection regressions. */
function createCrossDependency(
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
    buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([correctProcess, wrongProcess], [], {
        name: 'deck-trace-graph-duplicate-span-id-test'
      })
    )
  );
  const selectedBlock = traceGraph
    .getVisibleProcessRenderSpans(getRequiredProcessRef(traceGraph, 'rank-correct'))
    .find(span => {
      return span.name === 'selected-correct';
    });
  if (!selectedBlock) {
    throw new Error('Expected selected span for duplicate-id regression test');
  }
  const selectedSpanRef = selectedBlock.spanRef;
  if (selectedSpanRef == null) {
    throw new Error('Expected span ref for duplicate-id regression test');
  }

  const wrongBlock = traceGraph
    .getVisibleProcessRenderSpans(getRequiredProcessRef(traceGraph, 'rank-wrong'))
    .find(span => {
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
  const dependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId,
    startSpanId: parentBlock.spanId,
    endSpanId: childBlock.spanId,
    keywords: new Set(['PARENT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 0
  };
  parentBlock.localDependencyIds = [dependencyId];
  process.localDependencies = [dependency];

  const traceGraph = createTestTraceGraph(
    buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([process], [], {
        name: 'deck-trace-graph-extended-parent-selection-test'
      })
    )
  );
  const parentBlockFromGraph = traceGraph
    .getVisibleProcessRenderSpans(getRequiredProcessRef(traceGraph, 'parent-rank'))
    .find(span => span.name === 'parent');
  const childBlockFromGraph = traceGraph
    .getVisibleProcessRenderSpans(getRequiredProcessRef(traceGraph, 'parent-rank'))
    .find(span => span.name === 'child');
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
  const dependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId: parentDependencyId,
    startSpanId: parentBlock.spanId,
    endSpanId: childBlock.spanId,
    keywords: new Set(['PARENT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 0
  };
  parentBlock.localDependencyIds = [parentDependencyId];
  process.localDependencies = [dependency];

  const traceGraph = createTestTraceGraph(
    buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([process], [], {
        name: 'deck-trace-graph-extended-parent-selection-visible-test'
      })
    )
  );
  const childBlockFromGraph = traceGraph
    .getVisibleProcessRenderSpans(getRequiredProcessRef(traceGraph, 'parent-rank'))
    .find(span => span.name === 'child');
  const parentBlockFromGraph = traceGraph
    .getVisibleProcessRenderSpans(getRequiredProcessRef(traceGraph, 'parent-rank'))
    .find(span => span.name === 'parent');
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
  selectedBlock: TraceSpanDisplaySource;
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
  const dependencies: TraceLocalDependency[] = [
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-focus-parent' as TraceDependencyId,
      startSpanId: spans[0]!.spanId,
      endSpanId: spans[1]!.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    },
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-focus-child' as TraceDependencyId,
      startSpanId: spans[1]!.spanId,
      endSpanId: spans[2]!.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    }
  ];
  spans[0]!.localDependencyIds = ['dep-focus-parent' as TraceDependencyId];
  spans[1]!.localDependencyIds = ['dep-focus-child' as TraceDependencyId];
  process.spans = spans;
  process.spanMap = Object.fromEntries(spans.map(span => [span.spanId, span])) as Record<
    string,
    TraceSpan
  >;
  process.localDependencies = dependencies;

  const traceGraph = createTestTraceGraph(
    buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([process], [], {
        name: 'deck-trace-graph-selection-test'
      })
    )
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
  selectedBlock: TraceSpanDisplaySource;
  selectedSpanRef: SpanRef;
  unrelatedSpanRef: SpanRef;
  unrelatedStreamId: TraceThreadId;
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
    buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([process], [], {
        name: 'deck-trace-graph-combined-thread-selection-test'
      })
    )
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
    unrelatedSpanRef,
    unrelatedStreamId: secondaryThread.threadId
  };
}

/** Builds a combined-thread head-process parent chain with an interior spacer lane. */
function createCombinedThreadDependencySelectionTraceGraph(): {
  traceGraph: TraceGraph;
  childBlock: TraceSpanDisplaySource;
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
  const dependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId,
    startSpanId: parentBlock.spanId,
    endSpanId: childBlock.spanId,
    keywords: new Set(['PARENT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 0
  };
  childBlock.localDependencyIds = [dependencyId];
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
  process.localDependencies = [dependency];

  const traceGraph = createTestTraceGraph(
    buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([process], [], {
        name: 'deck-trace-graph-combined-thread-dependency-selection-test'
      })
    )
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
  selectedBlock: TraceSpanDisplaySource;
  selectedSpanRef: SpanRef;
} {
  const headProcess = createProcess('head-rank', 0, 'head-parent');
  const logicalProcess = createProcess('logical-rank', 1, 'logical-child');
  const headBlock = headProcess.spans[0]!;
  const logicalBlock = logicalProcess.spans[0]!;

  const traceGraph = createTestTraceGraph(
    buildTraceGraphDataFromJSONTrace(
      buildJSONTrace(
        [headProcess, logicalProcess],
        [
          createCrossDependency(
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

async function waitForAssertion(assertion: () => void): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
    }

    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  throw lastError;
}

/** Creates a trace graph whose rank list can be expanded across rerenders. */
function createRankAppendTraceGraph(
  processIds: readonly string[],
  name = 'deck-trace-graph-rank-append-test'
): TraceGraph {
  const processes = processIds.map((processId, rankNum) =>
    createProcess(processId, rankNum, `${processId}-span`)
  );
  return createTestTraceGraph(
    buildTraceGraphDataFromJSONTrace(buildJSONTrace(processes, [], {name}))
  );
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

  return createTestTraceGraph(
    buildTraceGraphDataFromJSONTrace(buildJSONTrace([process], [], {name: 'sync-search-test'}))
  );
}

function createStitchedCrossDependencySelectionTraceGraph(): {
  traceGraph: TraceGraph;
  stitchedDependencyId: TraceDependencyId;
  filteredLogicalSpanRef: SpanRef;
  visibleLogicalChild: TraceSpanDisplaySource;
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

  const localDependencyId = 'rank-b:parent-stitched' as TraceDependencyId;
  const localDependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId: localDependencyId,
    startSpanId: filteredLogical.spanId,
    endSpanId: logicalChild.spanId,
    keywords: new Set(['PARENT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 0
  };
  filteredLogical.localDependencyIds = [localDependencyId];
  rankB.localDependencies = [localDependency];

  const traceGraph = createTestTraceGraph(
    buildTraceGraphDataFromJSONTrace(
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
      )
    ),
    {spanFilters: ['filtered-logical']}
  );

  const visibleLogicalChild = getRequiredVisibleDisplaySourceBySpanId(
    traceGraph,
    logicalChild.spanId
  );
  const filteredLogicalSpanRef = getRequiredSpanRefBySpanId(traceGraph, filteredLogical.spanId);
  const stitchedDependencyId = getTraceGraphSpanDependencies(traceGraph, visibleLogicalChild)
    .crossRankDependencies[0]?.dependencyId;
  if (!stitchedDependencyId) {
    throw new Error('Expected stitched visible cross dependency id');
  }

  return {traceGraph, stitchedDependencyId, filteredLogicalSpanRef, visibleLogicalChild};
}

/** Creates one topology-filtered search hit for Omnibox result-presentation coverage. */
function createTopologyFilteredSearchTraceGraph(): TraceGraph {
  const process = createProcess('rank-a', 0, 'topology-parent');
  const parent = process.spans[0]!;
  const topologyFilteredChild: TraceSpan = {
    ...parent,
    spanId: 'topology-filtered-child' as TraceSpanId,
    name: 'topology-filtered-child',
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: 5,
        endTimeMs: 5,
        durationMs: 0,
        durationMsAsString: '0ms'
      }
    }
  };
  process.spans = [parent, topologyFilteredChild];
  process.spanMap = {
    [parent.spanId]: parent,
    [topologyFilteredChild.spanId]: topologyFilteredChild
  };
  const dependencyId = 'dep-topology-filtered-child' as TraceDependencyId;
  const dependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId,
    startSpanId: parent.spanId,
    endSpanId: topologyFilteredChild.spanId,
    keywords: new Set(['PARENT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 0
  };
  parent.localDependencyIds = [dependencyId];
  process.localDependencies = [dependency];

  return createTestTraceGraph(
    buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([process], [], {name: 'topology-filtered-search-test'})
    ),
    {overlappingParentSpanFilter: {maxChildDurationMs: 1}}
  );
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

type RenderDeckTraceGraphProps = Partial<ComponentPropsWithoutRef<typeof DeckTraceGraph>> & {
  defaultExpandProcess?: boolean;
  defaultSelectedSpanRefs?: readonly SpanRef[];
  defaultExpandedProcessIds?: readonly string[];
  defaultCollapsedProcessIds?: readonly string[];
  onExpandedProcessIdsChange?: (processIds: string[]) => void;
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
  onSelectionChange: (selection: unknown) => void;
}) {
  const {
    defaultExpandProcess = true,
    defaultSelectedSpanRefs = EMPTY_TEST_SPAN_REFS,
    defaultExpandedProcessIds,
    defaultCollapsedProcessIds,
    onExpandedProcessIdsChange,
    resolvePickedTraceObject = resolveTestPickedTraceObject,
    ...componentProps
  } = additionalProps ?? {};
  const settings = componentProps.settings ?? defaultTraceVisSettings;
  const secondaryTraceGraph = componentProps.secondaryTraceGraph;
  const traceGraphs = useMemo(
    () =>
      secondaryTraceGraph &&
      (settings.processLayoutMode === 'sequential' || settings.processLayoutMode === 'interleaved')
        ? [traceGraph, secondaryTraceGraph]
        : [traceGraph],
    [secondaryTraceGraph, settings.processLayoutMode, traceGraph]
  );
  const selectedSpanRefs = componentProps.selectedSpanRefs ?? defaultSelectedSpanRefs;
  const selectedDefaultExpandedProcessRefs = useMemo(() => {
    const refsByGraph = new Map<number, Set<ProcessRef>>();
    for (const spanRef of selectedSpanRefs) {
      const processRef = traceGraph.getProcessRefBySpanRef(spanRef);
      if (processRef != null) {
        const refs = refsByGraph.get(0) ?? new Set<ProcessRef>();
        refs.add(processRef);
        refsByGraph.set(0, refs);
      }
    }
    return refsByGraph;
  }, [selectedSpanRefs, traceGraph]);
  const processExpansionOverridesRef = useRef<Map<TraceGraph, Map<ProcessRef, boolean>>>(new Map());
  const initialCollapseState = useMemo(
    () =>
      buildInitialTraceLayoutCollapseState({
        traceGraphs,
        defaultExpandProcess,
        defaultExpandedProcessIds,
        defaultCollapsedProcessIds,
        selectedDefaultExpandedProcessRefs,
        processExpansionOverrides: processExpansionOverridesRef.current
      }),
    [
      defaultCollapsedProcessIds,
      defaultExpandedProcessIds,
      defaultExpandProcess,
      selectedDefaultExpandedProcessRefs,
      traceGraphs
    ]
  );
  const [collapseState, setCollapseState] = useState<TraceLayoutCollapseState>(
    () => initialCollapseState
  );
  useEffect(() => {
    setCollapseState(initialCollapseState);
  }, [initialCollapseState]);
  const selectedExpansionSpanRefsKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const spanRefs = [...selectedSpanRefs, ...(componentProps.extendedSelectionSpanRefs ?? [])];
    const spanRefsKey = spanRefs.join(',');
    if (spanRefs.length === 0) {
      selectedExpansionSpanRefsKeyRef.current = null;
      return;
    }
    if (selectedExpansionSpanRefsKeyRef.current === spanRefsKey) {
      return;
    }
    selectedExpansionSpanRefsKeyRef.current = spanRefsKey;
    setCollapseState(previous =>
      selectTraceLayoutCollapseStateUpdate(
        previous,
        expandSelectedSpanProcessRefs({
          collapseState: previous,
          traceGraph,
          spanRefs,
          processExpansionOverrides: processExpansionOverridesRef.current
        })
      )
    );
  }, [componentProps.extendedSelectionSpanRefs, selectedSpanRefs, traceGraph]);
  useEffect(() => {
    onExpandedProcessIdsChange?.(
      getExpandedProcessIdsFromCollapseState({
        traceGraphs,
        collapseState
      })
    );
  }, [collapseState, onExpandedProcessIdsChange, traceGraphs]);

  return (
    <DeckTraceGraph
      ref={deckTraceGraphRef}
      traceGraph={traceGraph}
      traceStyle={DEFAULT_TRACE_STYLE}
      paths={[]}
      settings={settings}
      onTimeRangeSelectionChange={vi.fn()}
      onSelectionChange={onSelectionChange}
      resolvePickedTraceObject={resolvePickedTraceObject}
      {...componentProps}
      selectedSpanRefs={selectedSpanRefs}
      collapseState={collapseState}
      onAllProcessesExpansionChange={expand =>
        setCollapseState(previous =>
          selectTraceLayoutCollapseStateUpdate(
            previous,
            setAllTraceProcessesExpanded({
              collapseState: previous,
              traceGraphs,
              expand,
              processExpansionOverrides: processExpansionOverridesRef.current
            })
          )
        )
      }
      onProcessCollapseToggle={({graphIndex, processRef}) => {
        const graph = traceGraphs[graphIndex] ?? traceGraphs[0]!;
        setCollapseState(previous =>
          selectTraceLayoutCollapseStateUpdate(
            previous,
            toggleTraceProcessCollapse({
              collapseState: previous,
              graphIndex,
              graph,
              processRef,
              processExpansionOverrides: processExpansionOverridesRef.current
            })
          )
        );
      }}
      onThreadCollapseToggle={({graphIndex, threadRef}) =>
        setCollapseState(previous =>
          selectTraceLayoutCollapseStateUpdate(
            previous,
            toggleTraceThreadCollapse({
              collapseState: previous,
              graphIndex,
              threadRef
            })
          )
        )
      }
      onThreadCollapsePrune={({validThreadRefsByGraph}) =>
        setCollapseState(previous =>
          selectTraceLayoutCollapseStateUpdate(
            previous,
            pruneTraceLayoutThreadCollapseStateForLaneRefs({
              collapseState: previous,
              validThreadRefsByGraph
            })
          )
        )
      }
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

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
  renderedDeckProps.current = null;
  buildDeckLayersForTraceSpy.mockReset();
  buildDeckLayerForTraceProcessActivitySummarySpy.mockReset();
  buildDeckLayersForMinimapSpanIndicatorsSpy.mockReset();
  buildDeckLayersForInstantsAndCounterSpy.mockReset();
  buildDeckLayersForTimeMeasureSpy.mockReset();
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

  it('positions run event markers 15 pixels above the run-events view center', async () => {
    const traceGraph = createSyncSearchTraceGraph();
    await renderDeckTraceGraphElement(traceGraph, {
      settings: {...defaultTraceVisSettings, showGlobalEvents: true}
    });

    expect(buildDeckLayersForInstantsAndCounterSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      globalEventYPosition: -15
    });
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
      | {props?: {panels?: Array<{constructor: {name: string}}>}}
      | undefined;

    expect(widgets?.[0]?.props?.id).toBe('tracevis-help');
    expect(panel?.props?.panels?.map(helpPanel => helpPanel.constructor.name)).toEqual([
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
    expect(widgets).toHaveLength(5);
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
      defaultSelectedSpanRefs: [selectedSpanRef],
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
    expect(searchBlockRecordsSpy).not.toHaveBeenCalled();
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
    const {traceGraph, filteredLogicalSpanRef} = createStitchedCrossDependencySelectionTraceGraph();
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

  it('marks topology-filtered omnibox results and keeps their badge outline colored', async () => {
    const {deckProps} = await renderDeckTraceGraphElement(
      createTopologyFilteredSearchTraceGraph(),
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
      | ((query: string) => Array<{description?: string}>)
      | undefined;
    const renderOption = omniBoxWidget?.props?.renderOption as
      | ((params: {option: unknown}) => {
          props?: {
            children?: Array<{
              props?: {
                style?: Record<string, string>;
                title?: string;
              };
            }>;
          };
        })
      | undefined;
    const [topologyFilteredOption] = getOptions?.('topology-filtered-child') ?? [];
    const renderedOption = renderOption?.({option: topologyFilteredOption});
    const badgeTitle = renderedOption?.props?.children?.[0]?.props?.title;
    const badgeStyle = renderedOption?.props?.children?.[0]?.props?.style;

    expect(topologyFilteredOption?.description).toContain('Hidden by: topological filter');
    expect(badgeTitle).toContain('Hidden by: topological filter');
    expect(badgeStyle).toEqual(
      expect.objectContaining({
        backgroundColor: 'hsl(var(--background))',
        borderStyle: 'solid',
        borderWidth: '1px'
      })
    );
    expect(badgeStyle?.borderColor).toMatch(/^rgb\(/);
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
    const parentDependency: TraceLocalDependency = {
      type: 'trace-local-dependency',
      dependencyId,
      startSpanId: root.spanId,
      endSpanId: filteredLeaf.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    };
    root.localDependencyIds = [dependencyId];
    process.localDependencies = [parentDependency];
    const traceGraph = createTestTraceGraph(
      buildTraceGraphDataFromJSONTrace(
        buildJSONTrace([process], [], {name: 'filtered-leaf-search'})
      ),
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
    expect(selectionPayload).toEqual({
      selectedSpanRefs: [selectedSpanRef],
      selectedSpans: [
        {
          spanRef: selectedSpanRef,
          span: expect.objectContaining({spanId: 'shared-span', name: 'selected-correct'})
        }
      ],
      selectedLocalDependencyRefs: [],
      selectedCrossDependencyRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      isExtendedSelection: false
    });
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
    expect(selectionPayload).toEqual({
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
      selectedLocalDependencyRefs: [],
      selectedCrossDependencyRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      isExtendedSelection: false
    });
    expect(selectionPayload).not.toHaveProperty('selectedBlocks');
    const selectedLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {
          selectedSpanRefs?: readonly SpanRef[];
          selectedLocalDependencySourcesByProcessId?: Record<
            string,
            Array<{dependencyRef: number; selectedDirection: string}>
          >;
        }
      | undefined;
    expect(selectedLayersCall?.selectedSpanRefs).toEqual([selectedSpanRef]);
    expect(
      Object.values(selectedLayersCall?.selectedLocalDependencySourcesByProcessId ?? {}).flat()
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
        selectedLocalDependencyRefs: [],
        selectedCrossDependencyRefs: [],
        selectedDependencies: []
      })
    );
    const selectedLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {
          selectedLocalDependencySourcesByProcessId?: Record<
            string,
            Array<{dependencyRef: number; selectedDirection: string}>
          >;
        }
      | undefined;
    expect(
      Object.values(selectedLayersCall?.selectedLocalDependencySourcesByProcessId ?? {}).flat()
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
    expect(selectionPayload).toEqual({
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
      selectedLocalDependencyRefs: [],
      selectedCrossDependencyRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      isExtendedSelection: false
    });
  });

  it('leaves outgoing cross dependency refs externally owned for normal span selection', async () => {
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
    expect(selectionPayload).toEqual({
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
      selectedLocalDependencyRefs: [],
      selectedCrossDependencyRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      isExtendedSelection: false
    });
    const selectedLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {
          selectedCrossDependencySources?: Array<{
            dependencyRef: number;
            selectedDirection: string;
          }>;
        }
      | undefined;
    expect(selectedLayersCall?.selectedCrossDependencySources).toEqual([]);
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
          processId: 'rank-a'
        }
      });
    });
    await Promise.resolve();

    expect(onExpandedProcessIdsChange).toHaveBeenLastCalledWith(['rank-a']);
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
          processId: 'rank-a'
        }
      });
    });
    await Promise.resolve();

    expect(onExpandedProcessIdsChange).toHaveBeenLastCalledWith(['rank-b']);

    await rerender({defaultExpandProcess: false});
    await waitForAssertion(() => {
      const collapsedAfterDefaultCollapse = (
        buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
          | {traceLayout: {processLayouts: Array<{isCollapsed: boolean}>}}
          | undefined
      )?.traceLayout.processLayouts.map(processLayout => processLayout.isCollapsed);
      expect(collapsedAfterDefaultCollapse).toEqual([true, true]);
    });

    await rerender({defaultExpandProcess: true});
    await waitForAssertion(() => {
      const collapsedAfterDefaultExpand = (
        buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
          | {traceLayout: {processLayouts: Array<{isCollapsed: boolean}>}}
          | undefined
      )?.traceLayout.processLayouts.map(processLayout => processLayout.isCollapsed);
      expect(collapsedAfterDefaultExpand).toEqual([true, false]);
    });
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
          processId: 'rank-a'
        }
      });
    });
    await Promise.resolve();

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
    await Promise.resolve();

    expect(handled).toBe(true);
    const nextLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {
          selectedSpanRefs?: SpanRef[];
          selectedDependencies?: Array<{dependencyId: TraceDependencyId}>;
          traceLayout?: TraceLayout;
        }
      | undefined;
    const threadLayout = nextLayersCall?.traceLayout?.threadLayoutMap[selectedBlock.threadId];
    const selectedLaneIndex = threadLayout?.spanLaneMap?.get(selectedSpanRef) ?? 0;
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
        selectedLocalDependencyRefs: [],
        selectedCrossDependencyRefs: [],
        selectedDependencies: [],
        selectedCrossDependencies: [],
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
    const threadLayout = latestLayersCall?.traceLayout?.threadLayoutMap[selectedBlock.threadId];

    expect(typeof onSpanClick).toBe('function');
    expect(threadLayout?.lanes?.laneYPositions.length).toBeGreaterThan(1);

    const actualLaneIndex = threadLayout?.spanLaneMap?.get(selectedSpanRef) ?? 0;
    const wrongLaneIndex = actualLaneIndex === 0 ? 1 : 0;
    expect(threadLayout?.lanes?.laneYPositions[wrongLaneIndex]).toBeDefined();
    if (threadLayout?.spanLaneMap) {
      const preferredLaneIndex = actualLaneIndex;
      const geometryLaneIndex = wrongLaneIndex;
      const laneYPositions = threadLayout.lanes?.laneYPositions ?? [];
      const selectedGeometry =
        latestLayersCall?.traceLayout == null
          ? undefined
          : getTraceLayoutSpanGeometryBySpanRef({
              traceLayout: latestLayersCall.traceLayout,
              spanRef: selectedSpanRef
            });
      expect(selectedGeometry).toBeDefined();
      const geometryHeight = (selectedGeometry?.[3] ?? 0) - (selectedGeometry?.[1] ?? 0);
      const geometryCenterX = ((selectedGeometry?.[0] ?? 0) + (selectedGeometry?.[2] ?? 0)) / 2;
      const geometryTargetY = laneYPositions[geometryLaneIndex] ?? selectedGeometry?.[1] ?? 0;
      const shiftedGeometry: [number, number, number, number] = [
        (selectedGeometry?.[0] ?? 0) as number,
        geometryTargetY - geometryHeight / 2,
        (selectedGeometry?.[2] ?? geometryCenterX) as number,
        geometryTargetY + geometryHeight / 2
      ];
      (threadLayout.spanLaneMap as Map<SpanRef, number>).set(selectedSpanRef, preferredLaneIndex);
      if (latestLayersCall?.traceLayout) {
        (
          latestLayersCall.traceLayout as typeof latestLayersCall.traceLayout & {
            spanGeometryChunks?: typeof latestLayersCall.traceLayout.spanGeometryChunks;
          }
        ).spanGeometryChunks = mergeTraceLayoutSpanGeometryChunksForTest(
          latestLayersCall.traceLayout.spanGeometryChunks,
          [[selectedSpanRef, shiftedGeometry]]
        );
      }
    }

    flushSync(() => {
      onSpanClick?.(
        {object: wrapTestPickedTraceObject(selectedBlock)},
        {srcEvent: {shiftKey: true}}
      );
    });
    await Promise.resolve();

    const nextLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {traceLayout?: TraceLayout; selectedSpanRefs?: SpanRef[]}
      | undefined;
    const nextThreadLayout = nextLayersCall?.traceLayout?.threadLayoutMap[selectedBlock.threadId];

    expect(nextLayersCall?.selectedSpanRefs).toEqual([selectedSpanRef]);
    expect(nextThreadLayout?.lanes?.visibleLaneIndices).toEqual(
      expect.arrayContaining([actualLaneIndex])
    );
  });

  it('expands the owning process when an extended span ref is provided', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createDuplicateBlockIdTraceGraph();
    const onExpandedProcessIdsChange = vi.fn();

    await renderDeckTraceGraphElement(traceGraph, {
      defaultExpandProcess: false,
      extendedSelectionSpanRefs: [selectedSpanRef],
      onExpandedProcessIdsChange
    });

    expect(selectedBlock.processName).toBe('rank-correct');
    await waitForAssertion(() => {
      expect(onExpandedProcessIdsChange).toHaveBeenCalledWith(['rank-correct']);
    });
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
    await Promise.resolve();

    const nextLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {selectedSpanRefs?: SpanRef[]; traceLayout?: TraceLayout}
      | undefined;
    const threadLayout = nextLayersCall?.traceLayout?.threadLayoutMap[selectedBlock.threadId];
    const laneIndex = threadLayout?.spanLaneMap?.get(selectedSpanRef) ?? 0;
    expect(handled).toBe(true);
    expect(nextLayersCall?.selectedSpanRefs).toEqual([selectedSpanRef]);
    expect(threadLayout?.visible).toBe(true);
    expect(threadLayout?.lanes?.visibleLaneIndices).toEqual(expect.arrayContaining([laneIndex]));
    expect(threadLayout?.lanes?.laneYPositions.length).toBeGreaterThan(0);
  });

  it('hides unrelated combined-thread streams when shift-clicking a head-process span', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef, unrelatedSpanRef, unrelatedStreamId} =
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
    await Promise.resolve();

    const nextLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {selectedSpanRefs?: SpanRef[]; traceLayout?: TraceLayout}
      | undefined;
    const nextTraceLayout = nextLayersCall?.traceLayout;
    const selectedThreadLayout = nextTraceLayout?.threadLayoutMap[selectedBlock.threadId];
    const unrelatedThreadLayout = nextTraceLayout?.threadLayoutMap[unrelatedStreamId];

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
    const initialCombinedThreadLayout =
      initialLayersCall?.traceLayout?.processLayouts[0]?.threadLayouts[0];
    const parentLaneIndex = initialCombinedThreadLayout?.spanLaneMap?.get(parentSpanRef);
    const childLaneIndex = initialCombinedThreadLayout?.spanLaneMap?.get(childSpanRef);

    expect(parentLaneIndex).toBe(0);
    expect(childLaneIndex).toBeGreaterThan(1);

    await rerender({
      selectedSpanRefs: [childSpanRef],
      extendedSelectionSpanRefs: [parentSpanRef],
      extendedSelectionMode: 'fade',
      settings: {...defaultTraceVisSettings, trackAggregationMode: 'combine-threads'}
    });

    const nextLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {traceLayout?: TraceLayout}
      | undefined;
    const nextTraceLayout = nextLayersCall?.traceLayout;
    const focusedCombinedThreadLayout = nextTraceLayout?.processLayouts[0]?.threadLayouts[0];
    const dependencyRef = traceGraph
      .getLocalDependencyRefs(getRequiredProcessRef(traceGraph, 'head-rank'))
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
    expect(focusedCombinedThreadLayout?.spanLaneMap?.get(parentSpanRef)).toBe(parentLaneIndex);
    expect(focusedCombinedThreadLayout?.spanLaneMap?.get(childSpanRef)).toBe(childLaneIndex);
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
    await Promise.resolve();
    await Promise.resolve();

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

  it('renders a transient minimap indicator for hovered spans', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createSelectionTraceGraph();
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
      | {indicators?: Array<{kind: string; spanRef: SpanRef}>}
      | undefined;
    expect(latestCall?.indicators?.map(({kind, spanRef}) => ({kind, spanRef}))).toEqual([
      {kind: 'hovered', spanRef: selectedSpanRef}
    ]);
  });

  it('keeps selected and hovered minimap indicators separate and dedupes matching refs', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef, childSpanRef} = createSelectionTraceGraph();
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
      | {indicators?: Array<{kind: string; spanRef: SpanRef}>}
      | undefined;
    expect(latestCall?.indicators?.map(({kind, spanRef}) => ({kind, spanRef}))).toEqual([
      {kind: 'selected', spanRef: selectedSpanRef},
      {kind: 'hovered', spanRef: childSpanRef}
    ]);

    flushSync(() => {
      deckOnHover?.(createHoverPickInfo(selectedBlock, 10, 220), {
        srcEvent: {clientX: 10, clientY: 220}
      });
    });
    await Promise.resolve();

    latestCall = buildDeckLayersForMinimapSpanIndicatorsSpy.mock.calls.at(-1)?.[0] as
      | {indicators?: Array<{kind: string; spanRef: SpanRef}>}
      | undefined;
    expect(latestCall?.indicators?.map(({kind, spanRef}) => ({kind, spanRef}))).toEqual([
      {kind: 'selected', spanRef: selectedSpanRef}
    ]);
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

  it('publishes an initial empty selection so parent state can clear stale refs', async () => {
    const traceGraph = createSelectionTraceGraph().traceGraph;
    const {onSelectionChange} = await renderDeckTraceGraphElement(traceGraph);

    expect(onSelectionChange).toHaveBeenCalledWith({
      selectedSpanRefs: [],
      selectedSpans: [],
      selectedLocalDependencyRefs: [],
      selectedCrossDependencyRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      isExtendedSelection: false
    });
  });

  it('keeps extended parent span refs out of selected span overlays', async () => {
    const {traceGraph, parentSpanRef, childSpanRef, childBlockFromGraph} =
      createParentSelectionTraceGraph();
    await renderDeckTraceGraphElement(traceGraph, {
      extendedSelectionSpanRefs: [parentSpanRef]
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

  it('expands the owning process on first render when a default selected span ref is provided', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createSelectionTraceGraph();
    const onExpandedProcessIdsChange = vi.fn();

    const {onSelectionChange} = await renderDeckTraceGraphElement(traceGraph, {
      defaultExpandProcess: false,
      defaultSelectedSpanRefs: [selectedSpanRef],
      onExpandedProcessIdsChange
    });

    expect(onExpandedProcessIdsChange).toHaveBeenCalledWith([selectedBlock.processName]);
    expect(onSelectionChange).toHaveBeenCalledWith({
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
      selectedLocalDependencyRefs: [],
      selectedCrossDependencyRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      isExtendedSelection: false
    });
  });

  it('clears a default selected span when clicking empty deck space', async () => {
    const {traceGraph, selectedBlock, selectedSpanRef} = createSelectionTraceGraph();
    const {onSelectionChange} = await renderDeckTraceGraphElement(traceGraph, {
      defaultSelectedSpanRefs: [selectedSpanRef]
    });
    const deckOnClick = renderedDeckProps.current?.onClick as
      | ((info: {object?: unknown}, event?: unknown) => void)
      | undefined;

    expect(typeof deckOnClick).toBe('function');
    expect(onSelectionChange).toHaveBeenCalledWith({
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
      selectedLocalDependencyRefs: [],
      selectedCrossDependencyRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      isExtendedSelection: false
    });

    flushSync(() => {
      deckOnClick?.({object: null});
    });
    await Promise.resolve();

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      selectedSpanRefs: [],
      selectedSpans: [],
      selectedLocalDependencyRefs: [],
      selectedCrossDependencyRefs: [],
      selectedDependencies: [],
      selectedCrossDependencies: [],
      isExtendedSelection: false
    });
  });

  it('renders stitched visible cross-parent overlays from visible dependency refs', async () => {
    const {traceGraph, stitchedDependencyId} = createStitchedCrossDependencySelectionTraceGraph();
    const stitchedDependencyRef = traceGraph.getVisibleCrossDependencyRefById(stitchedDependencyId);
    expect(stitchedDependencyRef).toBeTruthy();

    await renderDeckTraceGraphElement(traceGraph, {
      selectedCrossDependencyRefs: new Set([stitchedDependencyRef!]),
      selectedCrossDependencyDirectionByRef: new Map([[stitchedDependencyRef!, 'outgoing']])
    });

    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    const selectedCrossDependencySources = latestLayersCall?.selectedCrossDependencySources as
      | ReadonlyArray<{dependencyRef: number; selectedDirection: string}>
      | undefined;

    expect(selectedCrossDependencySources).toHaveLength(1);
    expect(selectedCrossDependencySources?.[0]?.dependencyRef).toBe(stitchedDependencyRef);
    expect(selectedCrossDependencySources?.[0]?.selectedDirection).toBe('outgoing');
  });

  it('leaves stitched cross-parent refs externally owned on shift-click before parent refs round-trip', async () => {
    const {traceGraph, visibleLogicalChild} = createStitchedCrossDependencySelectionTraceGraph();
    const {onSelectionChange} = await renderDeckTraceGraphElement(traceGraph);

    const deckOnClick = renderedDeckProps.current?.onClick as
      | ((info: {object?: unknown}, event?: {srcEvent?: {shiftKey?: boolean}}) => void)
      | undefined;
    expect(typeof deckOnClick).toBe('function');

    flushSync(() => {
      deckOnClick?.(
        {object: wrapTestPickedTraceObject(visibleLogicalChild)},
        {srcEvent: {shiftKey: true}}
      );
    });
    await Promise.resolve();

    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    const selectedCrossDependencies = latestLayersCall?.selectedCrossDependencies as
      | ReadonlyArray<{dependencyId: TraceDependencyId}>
      | undefined;
    const selectedCrossDependencySources = latestLayersCall?.selectedCrossDependencySources as
      | ReadonlyArray<{dependencyRef: number}>
      | undefined;

    expect(onSelectionChange.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        selectedSpanRefs: [visibleLogicalChild.spanRef],
        selectedCrossDependencyRefs: [],
        selectedCrossDependencies: [],
        isExtendedSelection: true
      })
    );
    expect(selectedCrossDependencies).toEqual([]);
    expect(selectedCrossDependencySources).toEqual([]);
  });

  it('keeps the selected and extended spans in the highlighted set when fade mode is active', async () => {
    const {traceGraph, parentSpanRef, childBlockFromGraph, unrelatedBlockId} =
      createParentSelectionTraceGraphWithUnrelated();
    await renderDeckTraceGraphElement(traceGraph, {
      extendedSelectionSpanRefs: [parentSpanRef],
      extendedSelectionMode: 'fade',
      highlightedSpanRefs: new Set([getRequiredSpanRefBySpanId(traceGraph, unrelatedBlockId)])
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

  it('focuses only lanes referenced by shift-click extended span refs', async () => {
    const {traceGraph, parentSpanRef, childBlockFromGraph, unrelatedBlockId} =
      createParentSelectionTraceGraphWithUnrelated();
    await renderDeckTraceGraphElement(traceGraph, {
      selectedSpanRefs: [childBlockFromGraph.spanRef!],
      extendedSelectionSpanRefs: [parentSpanRef],
      extendedSelectionMode: 'fade'
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {processRows?: readonly TracePreparedProcessRow[]; traceLayout?: TraceLayout}
      | undefined;
    const streamLayout =
      latestLayersCall?.traceLayout?.threadLayoutMap[childBlockFromGraph.threadId];
    const childLaneIndex = streamLayout?.spanLaneMap?.get(childBlockFromGraph.spanRef);
    const parentLaneIndex = streamLayout?.spanLaneMap?.get(parentSpanRef);
    const unrelatedSpanRef = getRequiredSpanRefBySpanId(traceGraph, unrelatedBlockId);
    const unrelatedLaneIndex = streamLayout?.spanLaneMap?.get(unrelatedSpanRef);

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
    expect(latestLayersCall?.processRows?.[0]?.spans).toEqual(expectedRowSpanRefs);
    expect(latestLayersCall?.processRows?.[0]?.binaryBlockData?.spans).toEqual(expectedRowSpanRefs);
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

  it('keeps selected cross dependency endpoints in focused extended-selection layouts', async () => {
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
    const crossDependencyId = 'dep-child-remote' as TraceDependencyId;
    const traceGraph = createTestTraceGraph(
      buildTraceGraphDataFromJSONTrace(
        buildJSONTrace(
          [parentProcess, remoteProcess],
          [createCrossDependency(crossDependencyId, childBlock.spanId, remoteBlock.spanId, 0, 1)],
          {name: 'deck-trace-graph-focused-cross-endpoint-test'}
        )
      )
    );
    const parentSpanRef = getRequiredSpanRefBySpanId(traceGraph, parentBlock.spanId);
    const childSpanRef = getRequiredSpanRefBySpanId(traceGraph, childBlock.spanId);
    const remoteSpanRef = getRequiredSpanRefBySpanId(traceGraph, remoteBlock.spanId);
    const crossDependencyRef = traceGraph.getVisibleCrossDependencyRefById(crossDependencyId);
    if (crossDependencyRef == null) {
      throw new Error('Expected visible cross dependency ref for focused endpoint test');
    }

    await renderDeckTraceGraphElement(traceGraph, {
      selectedSpanRefs: [parentSpanRef],
      extendedSelectionSpanRefs: [childSpanRef],
      extendedSelectionMode: 'fade',
      selectedCrossDependencyRefs: new Set([crossDependencyRef])
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
        dependencyRef: crossDependencyRef
      })
    ).toBeDefined();
  });

  it('passes controlled extended dependency refs into local selected overlay sources', async () => {
    const {traceGraph, childSpanRef} = createParentSelectionTraceGraph();
    const selectionState = traceGraph.getTraceSpanDependencySelection(childSpanRef, {
      keywords: new Set(['PARENT'])
    });

    await renderDeckTraceGraphElement(traceGraph, {
      selectedSpanRefs: [childSpanRef],
      extendedSelectionSpanRefs: selectionState.parentSpanRefs,
      selectedLocalDependencyRefs: new Set(selectionState.visibleLocalDependencyRefs),
      selectedLocalDependencyDirectionByRef: new Map([
        [selectionState.visibleLocalDependencyRefs[0]!, 'outgoing']
      ])
    });

    const latestLayersCall = buildDeckLayersForTraceSpy.mock.calls.at(-1)?.[0] as
      | {
          selectedLocalDependencySourcesByProcessId?: Record<
            string,
            Array<{dependencyRef: number; selectedDirection: string}>
          >;
        }
      | undefined;

    expect(latestLayersCall?.selectedLocalDependencySourcesByProcessId).toEqual({
      [String(getRequiredProcessRef(traceGraph, 'parent-rank'))]: [
        expect.objectContaining({
          dependencyRef: selectionState.visibleLocalDependencyRefs[0],
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
            intervals?: unknown[];
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
    expect(overviewLayersCall?.data?.intervals?.length).toBe(
      overviewLayersCall?.data?.data?.length
    );
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
    await Promise.resolve();

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
});
