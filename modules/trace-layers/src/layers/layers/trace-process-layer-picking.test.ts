import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  encodeLocalSpanRef,
  encodeProcessRef,
  encodeSameProcessDependencyRef,
  encodeSpanRef
} from '../../trace';
import {buildTraceDenseSameProcessDependencyRefSource} from '../../trace/trace-view-state/trace-ref-source';
import {TraceProcessLayer} from './trace-process-layer';

import type {
  SpanRef,
  TraceDeckBinaryBlockData,
  TraceDeckBinaryDependencyLineData,
  TraceLayout,
  TraceSameProcessDependency,
  TraceSameProcessDependencyRefSource,
  TraceSameProcessDependencyRenderSource,
  TraceSpanId,
  TraceVisSettings
} from '../../trace';

const TEST_SETTINGS = {
  lineRoutingMode: 'straight'
} as TraceVisSettings;
const EMPTY_BINARY_BLOCK_DATA = {
  data: {length: 0, attributes: {}},
  spans: []
} satisfies TraceDeckBinaryBlockData;
const EMPTY_BINARY_DEPENDENCY_DATA = {
  data: {length: 0, attributes: {}},
  dependencies: []
} satisfies TraceDeckBinaryDependencyLineData;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TraceProcessLayer picking diagnostics', () => {
  it('warns when a picked binary dependency row cannot resolve source data', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dependencyRef = encodeSameProcessDependencyRef(encodeLocalSpanRef(0, 321));
    const startSpanRef = encodeSpanRef(1, 2);
    const endSpanRef = encodeSpanRef(1, 3);
    const layer = createProcessLayer({
      id: 'picking-missing-dependency',
      traceLayout: createTraceLayout({
        getDependencyWaitMode: () => null,
        getDependencyId: () => 'missing-dependency' as TraceSameProcessDependency['dependencyId'],
        getDependencyStartSpan: () => startSpanRef,
        getDependencyEndSpan: () => endSpanRef,
        getDependencyStartBlockId: () => 'start-span' as TraceSpanId,
        getDependencyEndBlockId: () => 'end-span' as TraceSpanId
      }),
      binaryDependencyLineData: {
        data: {length: 1, attributes: {}},
        dependencies: [dependencyRef]
      } as TraceDeckBinaryDependencyLineData
    });

    const pickingInfo = layer.getPickingInfo({
      info: {object: null, index: 0},
      mode: 'hover',
      sourceLayer: {id: 'picking-missing-dependency-dependency-lines'}
    } as never);

    expect(pickingInfo.object).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[tracevis] Hover picked rendered trace data with no matching source data',
      expect.objectContaining({
        reason: 'missing-dependency-source',
        dependencyRef,
        dependencyId: 'missing-dependency',
        startSpanRef,
        endSpanRef,
        processId: 'process-1'
      })
    );
  });

  it('warns when a picked binary span row cannot resolve display source data', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const spanRef = encodeSpanRef(2, 4) as SpanRef;
    const layer = createProcessLayer({
      id: 'picking-missing-span',
      traceLayout: createTraceLayout({
        getSpanDetailSource: () => null,
        getSpanId: () => 'missing-span' as TraceSpanId,
        getSpanName: () => 'missing span'
      }),
      binaryBlockData: {
        data: {length: 1, attributes: {}},
        spans: [spanRef]
      } as TraceDeckBinaryBlockData
    });

    const pickingInfo = layer.getPickingInfo({
      info: {object: null, index: 0},
      mode: 'hover',
      sourceLayer: {id: 'picking-missing-span-block-rectangles'}
    } as never);

    expect(pickingInfo.object).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[tracevis] Hover picked rendered trace data with no matching source data',
      expect.objectContaining({
        reason: 'missing-span-source',
        spanRef,
        spanId: 'missing-span',
        spanName: 'missing span',
        processId: 'process-1'
      })
    );
  });

  it('returns lightweight dependency pick payloads without descriptive dependency materialization', () => {
    const dependencyRef = encodeSameProcessDependencyRef(encodeLocalSpanRef(0, 321));
    const dependency = {
      type: 'trace-same-process-dependency',
      dependencyRef,
      processRef: encodeProcessRef(1),
      startSpanRef: encodeSpanRef(1, 2),
      endSpanRef: encodeSpanRef(1, 3),
      waitMode: 'end-to-start',
      bidirectional: false,
      waitTimeMs: 4,
      isParent: false
    } satisfies TraceSameProcessDependencyRenderSource;
    const getDependencySource = vi.fn(() => {
      throw new Error('Descriptive dependency materialization should stay out of picking');
    });
    const layer = createProcessLayer({
      id: 'picking-lightweight-dependency',
      traceLayout: createTraceLayout({
        getDependencyWaitMode: () => dependency.waitMode,
        getDependencyStartSpan: () => dependency.startSpanRef,
        getDependencyEndSpan: () => dependency.endSpanRef,
        getDependencyBidirectional: () => dependency.bidirectional,
        getDependencyWaitTimeMs: () => dependency.waitTimeMs,
        getDependencyIsParent: () => dependency.isParent,
        getSameProcessDependencyProcessRefByRef: () => dependency.processRef,
        getDependencySource
      }),
      binaryDependencyLineData: {
        data: {length: 1, attributes: {}},
        dependencies: [dependencyRef]
      } as TraceDeckBinaryDependencyLineData
    });

    const pickingInfo = layer.getPickingInfo({
      info: {object: null, index: 0},
      mode: 'hover',
      sourceLayer: {id: 'picking-lightweight-dependency-dependency-lines'}
    } as never);

    expect(pickingInfo.object).toEqual(dependency);
    expect(getDependencySource).not.toHaveBeenCalled();
  });

  it('uses one dense dependency source for binary picking and curve iteration', () => {
    const denseDependencies = buildTraceDenseSameProcessDependencyRefSource(0, 2);
    const pickedSourceRef = denseDependencies.at(1);
    if (pickedSourceRef == null) {
      throw new Error('Expected the second dense dependency ref.');
    }
    const pickedDependencyRef = pickedSourceRef;
    const pickedDependency = {
      type: 'trace-same-process-dependency',
      dependencyRef: pickedDependencyRef,
      processRef: encodeProcessRef(1),
      startSpanRef: encodeSpanRef(1, 2),
      endSpanRef: encodeSpanRef(1, 3),
      waitMode: 'end-to-start',
      bidirectional: false,
      waitTimeMs: 4,
      isParent: false
    } satisfies TraceSameProcessDependencyRenderSource;
    const binaryLayer = createProcessLayer({
      id: 'picking-dense-dependency-source',
      traceLayout: createTraceLayout({
        getDependencyWaitMode: () => pickedDependency.waitMode,
        getDependencyStartSpan: () => pickedDependency.startSpanRef,
        getDependencyEndSpan: () => pickedDependency.endSpanRef,
        getDependencyBidirectional: () => pickedDependency.bidirectional,
        getDependencyWaitTimeMs: () => pickedDependency.waitTimeMs,
        getDependencyIsParent: () => pickedDependency.isParent,
        getSameProcessDependencyProcessRefByRef: () => pickedDependency.processRef
      }),
      binaryDependencyLineData: {
        data: {length: denseDependencies.length, attributes: {}},
        dependencies: denseDependencies
      } as TraceDeckBinaryDependencyLineData
    });

    const pickingInfo = binaryLayer.getPickingInfo({
      info: {object: null, index: 1},
      mode: 'hover',
      sourceLayer: {id: 'picking-dense-dependency-source-dependency-lines'}
    } as never);

    expect(pickingInfo.object).toEqual(pickedDependency);

    const iteratorSpy = vi.fn(denseDependencies[Symbol.iterator].bind(denseDependencies));
    const curveDependencies = {
      ...denseDependencies,
      [Symbol.iterator]: iteratorSpy
    } satisfies TraceSameProcessDependencyRefSource;
    const curveLayer = createProcessLayer({
      id: 'curve-dense-dependency-source',
      traceLayout: createTraceLayout({}),
      binaryDependencyLineData: {
        data: {length: curveDependencies.length, attributes: {}},
        dependencies: curveDependencies
      },
      settings: {
        ...TEST_SETTINGS,
        lineRoutingMode: 'curve'
      }
    });
    curveLayer.renderLayers();

    expect(iteratorSpy).toHaveBeenCalledTimes(1);
  });
});

/** Builds one minimal TraceProcessLayer for direct picking adapter tests. */
function createProcessLayer(params: {
  /** Layer id used in diagnostics. */
  readonly id: string;
  /** Layout facade carrying the trace graph methods used during picking. */
  readonly traceLayout: TraceLayout;
  /** Optional binary block data used by the span picking branch. */
  readonly binaryBlockData?: TraceDeckBinaryBlockData;
  /** Optional binary dependency data used by the dependency picking branch. */
  readonly binaryDependencyLineData?: TraceDeckBinaryDependencyLineData;
  /** Optional settings override used to exercise curve dependency routing. */
  readonly settings?: TraceVisSettings;
}): TraceProcessLayer {
  return new TraceProcessLayer({
    id: params.id,
    threads: [],
    selectedSpanRefs: [],
    selectedDependencies: [],
    binaryBlockData: params.binaryBlockData ?? EMPTY_BINARY_BLOCK_DATA,
    binaryDependencyLineData: params.binaryDependencyLineData ?? EMPTY_BINARY_DEPENDENCY_DATA,
    rankIndex: 0,
    processId: 'process-1',
    processName: 'Process 1',
    rankNum: 1,
    stepNum: 0,
    onSpanClick: () => undefined,
    traceLayout: params.traceLayout,
    settings: params.settings ?? TEST_SETTINGS
  });
}

/** Builds a narrow TraceLayout facade with the TraceGraph methods used by picking diagnostics. */
function createTraceLayout(
  traceGraphOverrides: Partial<TraceProcessPickingTraceGraph>
): TraceLayout {
  const traceGraph: TraceProcessPickingTraceGraph = {
    getSpanDetailSource: () => null,
    getSpanId: () => null,
    getSpanName: () => null,
    getDependencySource: () => null,
    getDependencyId: () => null,
    getDependencyStartSpan: () => null,
    getDependencyEndSpan: () => null,
    getDependencyStartBlockId: () => null,
    getDependencyEndBlockId: () => null,
    getDependencyWaitMode: () => null,
    getDependencyBidirectional: () => false,
    getDependencyWaitTimeMs: () => null,
    getDependencyIsParent: () => false,
    isDependencyVisible: () => true,
    getSameProcessDependencyProcessRefByRef: () => null,
    getRankNumBySpanRef: () => null,
    ...traceGraphOverrides
  };
  return {
    traceGraph,
    processLayouts: [{}],
    renderRows: []
  } as unknown as TraceLayout;
}

type TraceProcessPickingTraceGraph = {
  /** Resolves a visible span source for render and selection paths. */
  readonly getSpanDetailSource: TraceLayout['traceGraph']['getSpanDetailSource'];
  /** Resolves a span source id for diagnostics. */
  readonly getSpanId: TraceLayout['traceGraph']['getSpanId'];
  /** Resolves a span name for diagnostics. */
  readonly getSpanName: TraceLayout['traceGraph']['getSpanName'];
  /** Resolves a visible dependency source for tooltip rendering. */
  readonly getDependencySource: TraceLayout['traceGraph']['getDependencySource'];
  /** Resolves a dependency id for diagnostics. */
  readonly getDependencyId: TraceLayout['traceGraph']['getDependencyId'];
  /** Resolves a dependency source span ref for diagnostics. */
  readonly getDependencyStartSpan: TraceLayout['traceGraph']['getDependencyStartSpan'];
  /** Resolves a dependency destination span ref for diagnostics. */
  readonly getDependencyEndSpan: TraceLayout['traceGraph']['getDependencyEndSpan'];
  /** Resolves a dependency source span id for diagnostics. */
  readonly getDependencyStartBlockId: TraceLayout['traceGraph']['getDependencyStartBlockId'];
  /** Resolves a dependency destination span id for diagnostics. */
  readonly getDependencyEndBlockId: TraceLayout['traceGraph']['getDependencyEndBlockId'];
  /** Resolves the wait mode used by lightweight dependency rendering. */
  readonly getDependencyWaitMode: TraceLayout['traceGraph']['getDependencyWaitMode'];
  /** Resolves whether a dependency is bidirectional. */
  readonly getDependencyBidirectional: TraceLayout['traceGraph']['getDependencyBidirectional'];
  /** Resolves dependency wait time. */
  readonly getDependencyWaitTimeMs: TraceLayout['traceGraph']['getDependencyWaitTimeMs'];
  /** Resolves whether a dependency is a parent edge. */
  readonly getDependencyIsParent: TraceLayout['traceGraph']['getDependencyIsParent'];
  /** Returns whether a canonical dependency participates in the active view. */
  readonly isDependencyVisible: TraceLayout['traceGraph']['isDependencyVisible'];
  /** Resolves the owning process for one visible same-process dependency. */
  readonly getSameProcessDependencyProcessRefByRef: TraceLayout['traceGraph']['getSameProcessDependencyProcessRefByRef'];
  /** Resolves the owning rank for one span ref. */
  readonly getRankNumBySpanRef: TraceLayout['traceGraph']['getRankNumBySpanRef'];
};
