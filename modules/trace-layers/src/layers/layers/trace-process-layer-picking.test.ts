import {afterEach, describe, expect, it, vi} from 'vitest';

import {encodeProcessRef, encodeSpanRef, encodeVisibleLocalDependencyRef} from '../../trace/index';
import {TraceProcessLayer} from './trace-process-layer';

import type {
  SpanRef,
  TraceDeckBinaryBlockData,
  TraceDeckBinaryDependencyLineData,
  TraceLayout,
  TraceLocalDependency,
  TraceLocalDependencyRenderSource,
  TraceSpanId,
  TraceVisSettings,
  VisibleLocalDependencyRef
} from '../../trace/index';

const TEST_SETTINGS = {
  lineRoutingMode: 'straight'
} as TraceVisSettings;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TraceProcessLayer picking diagnostics', () => {
  it('warns when a picked binary dependency row cannot resolve source data', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dependencyRef = encodeVisibleLocalDependencyRef(321) as VisibleLocalDependencyRef;
    const startSpanRef = encodeSpanRef(1, 2);
    const endSpanRef = encodeSpanRef(1, 3);
    const layer = createProcessLayer({
      id: 'picking-missing-dependency',
      traceLayout: createTraceLayout({
        getVisibleDependencyRenderSourceByRef: () => null,
        getVisibleDependencyIdByRef: () =>
          'missing-dependency' as TraceLocalDependency['dependencyId'],
        getVisibleDependencyStartSpan: () => startSpanRef,
        getVisibleDependencyEndSpan: () => endSpanRef,
        getVisibleDependencyStartBlockId: () => 'start-span' as TraceSpanId,
        getVisibleDependencyEndBlockId: () => 'end-span' as TraceSpanId
      }),
      binaryDependencyLineData: {
        data: {length: 1, attributes: {}},
        dependencyRefs: [dependencyRef]
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
        getSpanRenderSource: () => null,
        getSpanBlockId: () => 'missing-span' as TraceSpanId,
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
    const dependencyRef = encodeVisibleLocalDependencyRef(321) as VisibleLocalDependencyRef;
    const dependency = {
      type: 'trace-local-dependency',
      dependencyRef,
      processRef: encodeProcessRef(1),
      startSpanRef: encodeSpanRef(1, 2),
      endSpanRef: encodeSpanRef(1, 3),
      waitMode: 'end-to-start',
      bidirectional: false,
      waitTimeMs: 4,
      isParent: false
    } satisfies TraceLocalDependencyRenderSource;
    const getVisibleDependencySourceByRef = vi.fn(() => {
      throw new Error('Descriptive dependency materialization should stay out of picking');
    });
    const layer = createProcessLayer({
      id: 'picking-lightweight-dependency',
      traceLayout: createTraceLayout({
        getVisibleDependencyRenderSourceByRef: () => dependency,
        getVisibleDependencySourceByRef
      }),
      binaryDependencyLineData: {
        data: {length: 1, attributes: {}},
        dependencyRefs: [dependencyRef]
      } as TraceDeckBinaryDependencyLineData
    });

    const pickingInfo = layer.getPickingInfo({
      info: {object: null, index: 0},
      mode: 'hover',
      sourceLayer: {id: 'picking-lightweight-dependency-dependency-lines'}
    } as never);

    expect(pickingInfo.object).toEqual(dependency);
    expect(getVisibleDependencySourceByRef).not.toHaveBeenCalled();
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
}): TraceProcessLayer {
  return new TraceProcessLayer({
    id: params.id,
    threads: [],
    spans: [],
    dependencies: [],
    selectedSpanRefs: [],
    selectedDependencies: [],
    binaryBlockData: params.binaryBlockData,
    binaryDependencyLineData: params.binaryDependencyLineData,
    rankIndex: 0,
    processId: 'process-1',
    processName: 'Process 1',
    rankNum: 1,
    stepNum: 0,
    onSpanClick: () => undefined,
    traceLayout: params.traceLayout,
    settings: TEST_SETTINGS
  });
}

/** Builds a narrow TraceLayout facade with the TraceGraph methods used by picking diagnostics. */
function createTraceLayout(
  traceGraphOverrides: Partial<TraceProcessPickingTraceGraph>
): TraceLayout {
  const traceGraph: TraceProcessPickingTraceGraph = {
    getSpanDisplaySource: () => null,
    getSpanRenderSource: () => null,
    getSpanBlockId: () => null,
    getSpanName: () => null,
    getVisibleDependencySourceByRef: () => null,
    getVisibleDependencyRenderSourceByRef: () => null,
    getVisibleDependencyIdByRef: () => null,
    getVisibleDependencyStartSpan: () => null,
    getVisibleDependencyEndSpan: () => null,
    getVisibleDependencyStartBlockId: () => null,
    getVisibleDependencyEndBlockId: () => null,
    ...traceGraphOverrides
  };
  return {
    traceGraph,
    processLayouts: [{}],
    renderRows: []
  } as unknown as TraceLayout;
}

type TraceProcessPickingTraceGraph = {
  /** Resolves a visible span source for tooltip rendering. */
  readonly getSpanDisplaySource: TraceLayout['traceGraph']['getSpanDisplaySource'];
  /** Resolves a visible span source for render and selection paths. */
  readonly getSpanRenderSource: TraceLayout['traceGraph']['getSpanRenderSource'];
  /** Resolves a span source id for diagnostics. */
  readonly getSpanBlockId: TraceLayout['traceGraph']['getSpanBlockId'];
  /** Resolves a span name for diagnostics. */
  readonly getSpanName: TraceLayout['traceGraph']['getSpanName'];
  /** Resolves a visible dependency source for tooltip rendering. */
  readonly getVisibleDependencySourceByRef: TraceLayout['traceGraph']['getVisibleDependencySourceByRef'];
  /** Resolves a visible dependency source for render and selection paths. */
  readonly getVisibleDependencyRenderSourceByRef: TraceLayout['traceGraph']['getVisibleDependencyRenderSourceByRef'];
  /** Resolves a dependency id for diagnostics. */
  readonly getVisibleDependencyIdByRef: TraceLayout['traceGraph']['getVisibleDependencyIdByRef'];
  /** Resolves a dependency source span ref for diagnostics. */
  readonly getVisibleDependencyStartSpan: TraceLayout['traceGraph']['getVisibleDependencyStartSpan'];
  /** Resolves a dependency destination span ref for diagnostics. */
  readonly getVisibleDependencyEndSpan: TraceLayout['traceGraph']['getVisibleDependencyEndSpan'];
  /** Resolves a dependency source span id for diagnostics. */
  readonly getVisibleDependencyStartBlockId: TraceLayout['traceGraph']['getVisibleDependencyStartBlockId'];
  /** Resolves a dependency destination span id for diagnostics. */
  readonly getVisibleDependencyEndBlockId: TraceLayout['traceGraph']['getVisibleDependencyEndBlockId'];
};
