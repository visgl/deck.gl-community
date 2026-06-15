import {beforeEach, describe, expect, it, vi} from 'vitest';

import {
  buildJSONTrace,
  buildTraceGraphDataFromJSONTrace,
  createEmptyTraceGraphCollapseState,
  createStaticTraceGraphRuntimeSource,
  TraceGraph
} from '../../trace/index';
import {TraceGraphLayer} from './trace-graph-layer';
import {TracePreparedStateLayer} from './trace-prepared-state-layer';
import {TraceStoreLayer} from './trace-store-layer';

import type {
  TraceChunkDescriptor,
  TraceChunkSelection,
  TraceChunkStore,
  TraceChunkStoreEnsureResult,
  TraceDependencyId,
  TraceGraphData,
  TraceLayoutCollapseState,
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings,
  TraceWindow
} from '../../trace/index';

const TEST_SETTINGS: TraceVisSettings = {
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
  showEmptyProcesses: false
};

type TestTraceGraphFixture = {
  traceGraphData: TraceGraphData;
  traceGraph: TraceGraph;
};

type TestTraceStore = TraceChunkStore<unknown, TraceChunkDescriptor>;

describe('TracePreparedStateLayer', () => {
  it('renders namespaced main trace sublayers from prepared state', () => {
    const traceGraph = createTestTraceGraph().traceGraph;
    const traceGraphLayer = createTraceGraphLayer([traceGraph]);
    updateLayer(traceGraphLayer);
    const preparedStateLayer = traceGraphLayer.renderLayers();
    if (!(preparedStateLayer instanceof TracePreparedStateLayer)) {
      throw new Error('Expected TracePreparedStateLayer');
    }

    const sublayerIds = preparedStateLayer.renderLayers().map(layer => layer.id);

    expect(sublayerIds).toContain('trace-graph-prepared-state-rank-background');
    expect(sublayerIds).toContain('trace-graph-prepared-state-rank-rank-a');
    expect(sublayerIds).toContain('trace-graph-prepared-state-rank-row-separators');
    expect(sublayerIds).toContain('trace-graph-prepared-state-critical-path');
  });
});

describe('TraceGraphLayer', () => {
  it('prepares graphs and delegates main rendering to TracePreparedStateLayer', () => {
    const traceGraph = createTestTraceGraph().traceGraph;
    const layer = createTraceGraphLayer([traceGraph]);

    updateLayer(layer);

    expect(layer.state.traceViewState?.preparedScene.foreground.map(scene => scene.graph)).toEqual([
      traceGraph
    ]);
    expect(layer.renderLayers()).toBeInstanceOf(TracePreparedStateLayer);
  });

  it('forwards caller-owned selected span refs into prepared selection rendering', () => {
    const traceGraph = createTestTraceGraph().traceGraph;
    const selectedSpanRef = traceGraph.getSpanRefByExternalBlockId('parent' as TraceSpanId);
    if (selectedSpanRef == null) {
      throw new Error('Expected selected span ref');
    }
    const layer = createTraceGraphLayer([traceGraph]);
    updateLayer(layer, {
      ...layer.props,
      selectedSpanRefs: [selectedSpanRef]
    });

    const preparedStateLayer = layer.renderLayers();
    if (!(preparedStateLayer instanceof TracePreparedStateLayer)) {
      throw new Error('Expected TracePreparedStateLayer');
    }

    expect(preparedStateLayer.props.selection?.selectedSpanRefs).toEqual([selectedSpanRef]);
  });

  it('renders no sublayer for an empty graph list', () => {
    const layer = createTraceGraphLayer([]);

    updateLayer(layer);

    expect(layer.state.traceViewState).toBeNull();
    expect(layer.renderLayers()).toBeNull();
  });

  it('reuses prepared base layouts until settings or collapse state change', () => {
    const traceGraph = createTestTraceGraph().traceGraph;
    const layer = createTraceGraphLayer([traceGraph]);
    updateLayer(layer);
    const firstState = layer.state.traceViewState;
    if (!firstState) {
      throw new Error('Expected prepared trace view state');
    }

    updateLayer(layer);
    expect(layer.state.traceViewState?.baseLayouts).toBe(firstState.baseLayouts);

    updateLayer(layer, {
      ...layer.props,
      settings: {...TEST_SETTINGS, layoutDensity: 'compact'}
    });
    const settingsState = layer.state.traceViewState;
    expect(settingsState?.baseLayouts).not.toBe(firstState.baseLayouts);
    if (!settingsState) {
      throw new Error('Expected settings-updated trace view state');
    }

    const processRef = traceGraph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected process ref');
    }
    const collapseState: TraceLayoutCollapseState = {
      graphs: [
        {
          ...createEmptyTraceGraphCollapseState(),
          collapsedProcessRefs: new Set([processRef])
        }
      ]
    };
    updateLayer(layer, {
      ...layer.props,
      collapseState
    });

    expect(layer.state.traceViewState?.baseLayouts).not.toBe(settingsState.baseLayouts);
  });
});

describe('TraceStoreLayer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('registers windows, materializes snapshots, redraws on chunk arrivals, and cleans up', async () => {
    const firstFixture = createTestTraceGraph('first');
    const secondFixture = createTestTraceGraph('second');
    const source = createTraceStoreSource('window-a', firstFixture.traceGraphData);
    const layer = createTraceStoreLayer([source.source]);

    updateLayer(layer);
    await flushPromises();

    expect(source.registerTraceWindows).toHaveBeenCalledWith({
      windows: [expect.objectContaining({id: 'window-a'})],
      loadChunk: source.source.loadChunk,
      onProgress: source.source.onProgress
    });
    expect(source.materializeTraceGraphDataForWindow).toHaveBeenCalledWith(
      'window-a',
      source.selection,
      source.source.materializeTraceGraphData
    );
    expect(layer.state.traceGraphs.map(traceGraph => traceGraph.name)).toEqual(['first']);
    expect(layer.renderLayers()).toBeInstanceOf(TraceGraphLayer);

    source.setTraceGraphData(secondFixture.traceGraphData);
    source.getRegisteredWindow()?.onChunksArrived?.({
      windowId: 'window-a',
      newReadyChunkKeys: [],
      matchedChunkCount: 0,
      readyChunkCount: 0,
      pendingChunkCount: 0,
      failedChunkCount: 0,
      isComplete: true
    });

    expect(layer.state.traceGraphs.map(traceGraph => traceGraph.name)).toEqual(['second']);

    layer.finalizeState({} as never);
    expect(source.removeTraceWindow).toHaveBeenCalledWith('window-a');
  });

  it('replaces source registrations and reports async registration errors', async () => {
    const firstSource = createTraceStoreSource('window-a', createTestTraceGraph().traceGraphData);
    const onError = vi.fn();
    const secondSource = createTraceStoreSource('window-b', createTestTraceGraph().traceGraphData, {
      onError,
      registerTraceWindows: vi.fn(() => Promise.reject(new Error('load failed')))
    });
    const layer = createTraceStoreLayer([firstSource.source]);
    updateLayer(layer);
    await flushPromises();

    updateLayer(layer, {
      ...layer.props,
      traceSources: [secondSource.source]
    });
    await flushPromises();

    expect(firstSource.removeTraceWindow).toHaveBeenCalledWith('window-a');
    expect(secondSource.registerTraceWindows).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({message: 'load failed'}));
  });
});

function createTraceGraphLayer(traceGraphs: readonly TraceGraph[]): TraceGraphLayer {
  return new TraceGraphLayer({
    id: 'trace-graph',
    traceGraphs,
    settings: TEST_SETTINGS
  });
}

function createTraceStoreLayer(
  traceSources: TraceStoreLayer<unknown, TraceChunkDescriptor>['props']['traceSources']
): TraceStoreLayer {
  return new TraceStoreLayer({
    id: 'trace-store',
    traceSources,
    settings: TEST_SETTINGS
  });
}

function createTraceStoreSource(
  windowId: string,
  initialTraceGraphData: TraceGraphData,
  overrides: Partial<{
    onError: (error: unknown) => void;
    registerTraceWindows: TestTraceStore['registerTraceWindows'];
  }> = {}
) {
  let traceGraphData = initialTraceGraphData;
  let registeredWindow: TraceWindow | undefined;
  const selection = createTraceSelection();
  const registerTraceWindows =
    overrides.registerTraceWindows ??
    vi.fn(({windows}: Parameters<TestTraceStore['registerTraceWindows']>[0]) => {
      registeredWindow = windows[0];
      return Promise.resolve(createEnsureResult());
    });
  const select = vi.fn(() => selection);
  const getReadyChunks = vi.fn(() => []);
  const materializeTraceGraphDataForWindow = vi.fn(() => traceGraphData);
  const removeTraceWindow = vi.fn();
  const traceChunkStore = {
    registerTraceWindows,
    select,
    getReadyChunks,
    materializeTraceGraphDataForWindow,
    removeTraceWindow,
    hasActiveSourceSpanFilter: vi.fn(() => false),
    isFiltered: vi.fn(() => false),
    getFilterReason: vi.fn(() => ({
      filterMask: 0,
      isFiltered: false,
      state: 'outside-window'
    }))
  } as unknown as TestTraceStore;
  const traceWindow: TraceWindow = {
    id: windowId,
    minTimeMs: 0,
    maxTimeMs: 10
  };
  const materializeTraceGraphData = vi.fn(() => traceGraphData);

  return {
    source: {
      traceChunkStore,
      traceWindow,
      loadChunk: vi.fn(async () => ({payload: {}})),
      materializeTraceGraphData,
      onProgress: vi.fn(),
      onError: overrides.onError
    },
    selection,
    registerTraceWindows,
    materializeTraceGraphDataForWindow,
    removeTraceWindow,
    getRegisteredWindow: () => registeredWindow,
    setTraceGraphData: (nextTraceGraphData: TraceGraphData) => {
      traceGraphData = nextTraceGraphData;
    }
  };
}

function createTraceSelection(): TraceChunkSelection<TraceChunkDescriptor> {
  return {
    matchingDescriptors: [],
    selectedDescriptors: [],
    omittedDescriptors: [],
    summary: {
      spanBudget: null,
      matchedSpanCount: 0,
      selectedSpanCount: 0,
      selectedChunkCount: 0,
      omittedChunkCount: 0,
      omittedSpanCount: 0,
      isSpanBudgetCapped: false
    }
  };
}

function createEnsureResult(): TraceChunkStoreEnsureResult<unknown, TraceChunkDescriptor> {
  return {
    readyChunks: [],
    summary: {
      requestedChunkCount: 0,
      reusedReadyChunkCount: 0,
      reusedPendingChunkCount: 0,
      fetchedChunkCount: 0
    }
  };
}

function updateLayer<TProps extends object>(
  layer: {
    props: TProps;
    clone: (props: Partial<TProps>) => {props: TProps};
    updateState: (params: never) => void;
  },
  props: TProps = layer.props
): void {
  const oldProps = layer.props;
  const nextProps = layer.clone(props).props;
  layer.props = nextProps;
  layer.updateState({
    props: nextProps,
    oldProps,
    changeFlags: {},
    context: {}
  } as never);
}

function flushPromises(): Promise<void> {
  return new Promise(resolve => queueMicrotask(resolve));
}

function createTestTraceGraph(name = 'trace-top-level-layer-test'): TestTraceGraphFixture {
  const traceGraphData = buildTraceGraphDataFromJSONTrace(
    buildJSONTrace([createProcessWithLocalDependency('rank-a', 0)], [], {name})
  );
  return {
    traceGraphData,
    traceGraph: new TraceGraph(
      createStaticTraceGraphRuntimeSource({
        identityKey: `${name}:test`,
        traceGraphData
      })
    )
  };
}

function createProcessWithLocalDependency(processId: string, rankNum: number): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: `${processId}-thread`,
    threadId: `${processId}-thread` as TraceThreadId,
    processId
  };
  const parentSpan = createSpan('parent', thread);
  const childSpan = createSpan('child', thread);
  const dependencyId = 'dep-parent-child' as TraceDependencyId;
  const dependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId,
    startSpanId: parentSpan.spanId,
    endSpanId: childSpan.spanId,
    keywords: new Set(['SUBMIT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 1_000
  };
  parentSpan.localDependencyIds = [dependencyId];
  parentSpan.localDependencies = [dependency];

  return {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [parentSpan, childSpan],
    spanMap: {
      [parentSpan.spanId]: parentSpan,
      [childSpan.spanId]: childSpan
    },
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies: [dependency],
    remoteDependencies: []
  };
}

function createSpan(name: string, thread: TraceThread): TraceSpan {
  const startTimeMs = name === 'parent' ? 0 : 1;
  const endTimeMs = name === 'parent' ? 10 : 9;
  return {
    type: 'trace-span',
    spanId: name as TraceSpanId,
    threadId: thread.threadId,
    processName: thread.processId,
    name,
    keywords: [],
    primaryTimingKey: 'primary',
    timings: {
      primary: {
        status: 'finished',
        startTimeMs,
        endTimeMs,
        durationMs: endTimeMs - startTimeMs,
        durationMsAsString: `${endTimeMs - startTimeMs}ms`
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}
