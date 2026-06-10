import {describe, expect, it, vi} from 'vitest';

import {
  buildJSONTrace,
  buildTraceGraphDataFromJSONTrace,
  buildTraceLayouts,
  DEFAULT_TRACE_COLOR_SCHEME,
  TraceGraph
} from '../../../trace/index';
import {createStaticTraceGraphRuntimeSource} from '../../../trace/trace-chunk-store';
import {
  buildTracePreparedMinimapSpanIndicators,
  buildTracePreparedOverviewGraphScenes,
  buildTracePreparedOverviewViewModel,
  buildTracePreparedProcessRows,
  buildTracePreparedScene,
  buildTraceSelectionPreparedScene,
  createTraceComparisonModelMatrix
} from './trace-deck-layout-inputs';

import type {
  SpanRef,
  TraceColorScheme,
  TraceDependencyId,
  TraceLayout,
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../../../trace/index';

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

const defaultTraceVisSettings: TraceVisSettings = {
  showDependencies: true,
  localDependencyMode: 'all',
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
  timingAggregationKey: 'latest'
};

describe('trace deck layout inputs', () => {
  it('builds comparison transforms in millisecond layout units', () => {
    const matrix = createTraceComparisonModelMatrix(2, 3);

    expect(matrix.transformAsPoint([10, 0, 0])).toEqual([32, 0, 0]);
  });

  it('normalizes invalid comparison transforms to the identity matrix', () => {
    const matrix = createTraceComparisonModelMatrix(Number.NaN, 0);

    expect(matrix.transformAsPoint([10, 0, 0])).toEqual([10, 0, 0]);
  });

  it('projects TraceLayout rows into layer-ready spans and dependencies', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);

    const prepared = buildTracePreparedScene({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: {...defaultTraceVisSettings, localDependencyMode: 'submit'},
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    expect(prepared.foreground).toHaveLength(1);
    expect(prepared.foreground[0]?.graph).toBe(traceLayouts[0]?.traceGraph);
    expect(prepared.foreground[0]?.rows).toHaveLength(1);
    expect(prepared.foreground[0]?.rows[0]?.spans).toHaveLength(2);
    expect(prepared.foreground[0]?.rows[0]?.dependencies).toHaveLength(1);
    expect(prepared.foreground[0]?.rows[0]?.binaryBlockData).toMatchObject({
      data: {
        length: 2,
        attributes: {
          getPosition: {size: 3},
          getSize: {size: 2},
          getFillColor: {size: 4},
          getLineColor: {size: 4}
        }
      }
    });
    expect(
      prepared.foreground[0]?.rows[0]?.binaryBlockData?.data.attributes.getPosition?.value
    ).toBeInstanceOf(Float32Array);
    expect(
      prepared.foreground[0]?.rows[0]?.binaryBlockData?.data.attributes.getFillColor?.value
    ).toBeInstanceOf(Uint8Array);
    expect(prepared.foreground[0]?.rows[0]?.binaryDependencyLineData).toMatchObject({
      data: {
        length: 1,
        attributes: {
          getSourcePosition: {size: 3},
          getTargetPosition: {size: 3},
          getColor: {size: 4}
        }
      }
    });
    expect(
      prepared.foreground[0]?.rows[0]?.binaryDependencyLineData?.data.attributes.getSourcePosition
        ?.value
    ).toBeInstanceOf(Float32Array);
    expect(
      prepared.foreground[0]?.rows[0]?.binaryDependencyLineData?.data.attributes.getColor?.value
    ).toBeInstanceOf(Uint8Array);
  });

  it('applies local dependency mode before rows reach deck layer construction', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);

    const prepared = buildTracePreparedScene({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: {...defaultTraceVisSettings, localDependencyMode: 'warnings'},
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    expect(prepared.foreground[0]?.rows[0]?.dependencies).toHaveLength(0);
  });

  it('rebuilds binary row payloads without retaining a global row cache', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);
    const settings: TraceVisSettings = {
      ...defaultTraceVisSettings,
      localDependencyMode: 'submit'
    };
    const params = {
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    };

    const firstPrepared = buildTracePreparedScene(params);
    const secondPrepared = buildTracePreparedScene(params);

    expect(secondPrepared.foreground[0]?.rows[0]?.binaryBlockData).toBeDefined();
    expect(secondPrepared.foreground[0]?.rows[0]?.binaryDependencyLineData).toBeDefined();
    expect(secondPrepared.foreground[0]?.rows[0]?.binaryBlockData).not.toBe(
      firstPrepared.foreground[0]?.rows[0]?.binaryBlockData
    );
    expect(secondPrepared.foreground[0]?.rows[0]?.binaryDependencyLineData).not.toBe(
      firstPrepared.foreground[0]?.rows[0]?.binaryDependencyLineData
    );
  });

  it('reuses previous process-row payloads when a rank append preserves row inputs', () => {
    const firstProcess = createProcessWithLocalDependency('rank-a', 0);
    const appendedProcess = createProcessWithLocalDependency('rank-b', 1);
    const firstTraceGraph = createTraceGraphFromProcesses([firstProcess]);
    const firstTraceLayouts = buildTestLayouts(firstTraceGraph);
    const settings: TraceVisSettings = {
      ...defaultTraceVisSettings,
      localDependencyMode: 'submit'
    };
    const firstPrepared = buildTracePreparedScene({
      primaryTraceGraph: firstTraceGraph,
      sourceTraceGraphs: [firstTraceGraph],
      traceGraphs: [firstTraceGraph],
      traceLayouts: firstTraceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });
    const appendedTraceGraph = createAppendedTraceGraphReusingFirstProcessTables(firstTraceGraph, [
      firstProcess,
      appendedProcess
    ]);
    const appendedTraceLayouts = buildTestLayouts(appendedTraceGraph, 'primary', firstTraceLayouts);
    const appendedPrepared = buildTracePreparedScene({
      primaryTraceGraph: appendedTraceGraph,
      sourceTraceGraphs: [appendedTraceGraph],
      traceGraphs: [appendedTraceGraph],
      traceLayouts: appendedTraceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      previousPreparedScene: firstPrepared,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    const firstRow = firstPrepared.foreground[0]?.rows[0];
    const reusedRow = appendedPrepared.foreground[0]?.rows.find(
      row => row.row.processId === 'rank-a'
    );
    const newRow = appendedPrepared.foreground[0]?.rows.find(row => row.row.processId === 'rank-b');

    expect(reusedRow?.spans).toBe(firstRow?.spans);
    expect(reusedRow?.dependencies).toBe(firstRow?.dependencies);
    expect(reusedRow?.binaryBlockData).toBe(firstRow?.binaryBlockData);
    expect(reusedRow?.binaryDependencyLineData).toBe(firstRow?.binaryDependencyLineData);
    expect(newRow?.binaryBlockData).toBeDefined();
    expect(newRow?.binaryBlockData).not.toBe(firstRow?.binaryBlockData);
  });

  it('reuses previous process-row payloads when an appended lower rank sorts before existing rows', () => {
    const rankFourProcess = createProcessWithLocalDependency('rank-4', 4);
    const rankFiveProcess = createProcessWithLocalDependency('rank-5', 5);
    const rankThreeProcess = createProcessWithLocalDependency('rank-3', 3);
    const firstTraceGraph = createTraceGraphFromProcesses([rankFourProcess, rankFiveProcess]);
    const firstTraceLayouts = buildTestLayouts(firstTraceGraph);
    const settings: TraceVisSettings = {
      ...defaultTraceVisSettings,
      localDependencyMode: 'submit'
    };
    const firstPrepared = buildTracePreparedScene({
      primaryTraceGraph: firstTraceGraph,
      sourceTraceGraphs: [firstTraceGraph],
      traceGraphs: [firstTraceGraph],
      traceLayouts: firstTraceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });
    const appendedTraceGraph = createAppendedTraceGraphReusingPreviousProcessTables(
      firstTraceGraph,
      [rankFourProcess, rankFiveProcess, rankThreeProcess]
    );
    const appendedTraceLayouts = buildTestLayouts(appendedTraceGraph, 'primary', firstTraceLayouts);
    const appendedPrepared = buildTracePreparedScene({
      primaryTraceGraph: appendedTraceGraph,
      sourceTraceGraphs: [appendedTraceGraph],
      traceGraphs: [appendedTraceGraph],
      traceLayouts: appendedTraceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      previousPreparedScene: firstPrepared,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    const firstRankFourRow = firstPrepared.foreground[0]?.rows.find(
      row => row.row.processId === 'rank-4'
    );
    const firstRankFiveRow = firstPrepared.foreground[0]?.rows.find(
      row => row.row.processId === 'rank-5'
    );
    const reusedRankFourRow = appendedPrepared.foreground[0]?.rows.find(
      row => row.row.processId === 'rank-4'
    );
    const reusedRankFiveRow = appendedPrepared.foreground[0]?.rows.find(
      row => row.row.processId === 'rank-5'
    );

    expect(appendedPrepared.foreground[0]?.rows.map(row => row.row.processId)).toEqual([
      'rank-3',
      'rank-4',
      'rank-5'
    ]);
    expect(reusedRankFourRow?.spans).toBe(firstRankFourRow?.spans);
    expect(reusedRankFourRow?.dependencies).toBe(firstRankFourRow?.dependencies);
    expect(reusedRankFourRow?.binaryBlockData).toBe(firstRankFourRow?.binaryBlockData);
    expect(reusedRankFourRow?.binaryDependencyLineData).toBe(
      firstRankFourRow?.binaryDependencyLineData
    );
    expect(reusedRankFiveRow?.spans).toBe(firstRankFiveRow?.spans);
    expect(reusedRankFiveRow?.dependencies).toBe(firstRankFiveRow?.dependencies);
    expect(reusedRankFiveRow?.binaryBlockData).toBe(firstRankFiveRow?.binaryBlockData);
    expect(reusedRankFiveRow?.binaryDependencyLineData).toBe(
      firstRankFiveRow?.binaryDependencyLineData
    );
  });

  it('reuses previous binary row payloads when only row X/Y positions change', () => {
    const traceGraph = createDependencyTraceGraph();
    const firstTraceLayouts = buildTestLayouts(traceGraph);
    const settings: TraceVisSettings = {
      ...defaultTraceVisSettings,
      localDependencyMode: 'submit'
    };
    const firstPrepared = buildTracePreparedScene({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceGraphs: [traceGraph],
      traceLayouts: firstTraceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });
    const firstRow = firstPrepared.foreground[0]?.rows[0];
    const shiftedTraceLayouts = buildTestLayouts(traceGraph, 'primary', firstTraceLayouts, 10);
    const shiftedLayout = shiftedTraceLayouts[0];
    const shiftedGeometryEntry =
      shiftedLayout?.geometryCache?.processesById[firstRow?.row.processId ?? ''];
    const shiftedTraceLayoutsWithStableGeometryKey =
      shiftedLayout && shiftedGeometryEntry && firstRow?.reuseInfo
        ? [
            {
              ...shiftedLayout,
              geometryCache: {
                ...shiftedLayout.geometryCache,
                processesById: {
                  ...shiftedLayout.geometryCache?.processesById,
                  [firstRow.row.processId]: {
                    ...shiftedGeometryEntry,
                    fastReuseKey: firstRow.reuseInfo.geometryReuseKey,
                    reuseKey: firstRow.reuseInfo.geometryReuseKey,
                    geometryXOffset: (firstRow.reuseInfo.geometryXOffset ?? 0) - 20,
                    geometryYOffset: (firstRow.reuseInfo.geometryYOffset ?? 0) + 10
                  }
                }
              }
            } satisfies TraceLayout
          ]
        : shiftedTraceLayouts;
    const shiftedPrepared = buildTracePreparedScene({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceGraphs: [traceGraph],
      traceLayouts: shiftedTraceLayoutsWithStableGeometryKey,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      previousPreparedScene: firstPrepared,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    const shiftedRow = shiftedPrepared.foreground[0]?.rows[0];
    const firstBlockPositions = getRequiredFloat32Attribute(
      firstRow?.binaryBlockData?.data.attributes.getPosition?.value
    );
    const shiftedBlockPositions = getRequiredFloat32Attribute(
      shiftedRow?.binaryBlockData?.data.attributes.getPosition?.value
    );
    const firstDependencySources = getRequiredFloat32Attribute(
      firstRow?.binaryDependencyLineData?.data.attributes.getSourcePosition?.value
    );
    const shiftedDependencySources = getRequiredFloat32Attribute(
      shiftedRow?.binaryDependencyLineData?.data.attributes.getSourcePosition?.value
    );

    expect(shiftedRow?.spans).toBe(firstRow?.spans);
    expect(shiftedRow?.dependencies).toBe(firstRow?.dependencies);
    expect(shiftedRow?.binaryBlockData).toBe(firstRow?.binaryBlockData);
    expect(shiftedRow?.binaryDependencyLineData).toBe(firstRow?.binaryDependencyLineData);
    expect(shiftedBlockPositions[0]).toBeCloseTo(firstBlockPositions[0] ?? 0);
    expect(shiftedBlockPositions[1]).toBeCloseTo(firstBlockPositions[1] ?? 0);
    expect(shiftedDependencySources[0]).toBeCloseTo(firstDependencySources[0] ?? 0);
    expect(shiftedDependencySources[1]).toBeCloseTo(firstDependencySources[1] ?? 0);
    expect(shiftedRow?.reuseInfo?.geometryXOffset).toBeCloseTo(
      (firstRow?.reuseInfo?.geometryXOffset ?? 0) - 20
    );
    expect(shiftedRow?.reuseInfo?.geometryYOffset).toBeCloseTo(
      (firstRow?.reuseInfo?.geometryYOffset ?? 0) + 10
    );
  });

  it('rebuilds dependency rows when local dependency mode changes but keeps span binary data', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);
    const submitSettings: TraceVisSettings = {
      ...defaultTraceVisSettings,
      localDependencyMode: 'submit'
    };
    const firstPrepared = buildTracePreparedScene({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: submitSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });
    const warningsPrepared = buildTracePreparedScene({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: {...submitSettings, localDependencyMode: 'warnings'},
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      previousPreparedScene: firstPrepared,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    const firstRow = firstPrepared.foreground[0]?.rows[0];
    const warningsRow = warningsPrepared.foreground[0]?.rows[0];
    expect(warningsRow?.spans).toBe(firstRow?.spans);
    expect(warningsRow?.binaryBlockData).toBe(firstRow?.binaryBlockData);
    expect(warningsRow?.dependencies).toHaveLength(0);
    expect(warningsRow?.dependencies).not.toBe(firstRow?.dependencies);
    expect(warningsRow?.binaryDependencyLineData).not.toBe(firstRow?.binaryDependencyLineData);
  });

  it('refreshes only geometry buffers when combine-thread rows expand to separate threads', () => {
    expectAggregationToggleGeometryRefresh('combine-threads', 'separate-threads');
  });

  it('refreshes only geometry buffers when separate-thread rows collapse into combined threads', () => {
    expectAggregationToggleGeometryRefresh('separate-threads', 'combine-threads');
  });

  it('rebuilds span binary colors when the color scheme changes while reusing dependency data', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);
    const settings: TraceVisSettings = {
      ...defaultTraceVisSettings,
      localDependencyMode: 'submit'
    };
    const firstPrepared = buildTracePreparedScene({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });
    const nextColorScheme: TraceColorScheme = {
      ...DEFAULT_TRACE_COLOR_SCHEME,
      getSpanFillColor: () => [11, 22, 33, 255]
    };
    const recoloredPrepared = buildTracePreparedScene({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings,
      colorScheme: nextColorScheme,
      previousPreparedScene: firstPrepared,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    const firstRow = firstPrepared.foreground[0]?.rows[0];
    const recoloredRow = recoloredPrepared.foreground[0]?.rows[0];
    expect(recoloredRow?.spans).toBe(firstRow?.spans);
    expect(recoloredRow?.dependencies).toBe(firstRow?.dependencies);
    expect(recoloredRow?.binaryBlockData).not.toBe(firstRow?.binaryBlockData);
    expect(recoloredRow?.binaryDependencyLineData).toBe(firstRow?.binaryDependencyLineData);
  });

  it('does not reuse unfiltered row refs for active span-filter outputs', () => {
    const sourceTrace = buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([createProcessWithLocalDependency('rank-a', 0)], [], {
        name: 'trace-deck-layout-inputs-filtered-test'
      })
    );
    const unfilteredGraph = createTestTraceGraph(sourceTrace);
    const filteredGraph = createTestTraceGraph(sourceTrace, {spanFilters: ['parent']});
    const unfilteredLayouts = buildTestLayouts(unfilteredGraph);
    const filteredLayouts = buildTestLayouts(filteredGraph);
    const settings: TraceVisSettings = {
      ...defaultTraceVisSettings,
      localDependencyMode: 'submit'
    };
    const unfilteredPrepared = buildTracePreparedScene({
      primaryTraceGraph: unfilteredGraph,
      sourceTraceGraphs: [unfilteredGraph],
      traceGraphs: [unfilteredGraph],
      traceLayouts: unfilteredLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });
    const filteredPrepared = buildTracePreparedScene({
      primaryTraceGraph: filteredGraph,
      sourceTraceGraphs: [filteredGraph],
      traceGraphs: [filteredGraph],
      traceLayouts: filteredLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      previousPreparedScene: unfilteredPrepared,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    expect(filteredPrepared.foreground[0]?.rows[0]?.spans).not.toBe(
      unfilteredPrepared.foreground[0]?.rows[0]?.spans
    );
    expect(filteredPrepared.foreground[0]?.rows[0]?.binaryBlockData).not.toBe(
      unfilteredPrepared.foreground[0]?.rows[0]?.binaryBlockData
    );
  });

  it('filters foreground row dependencies through refs before materializing sources', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);
    const localDependenciesSpy = vi.spyOn(traceGraph, 'getVisibleLocalDependencySources');

    const prepared = buildTracePreparedScene({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: {...defaultTraceVisSettings, localDependencyMode: 'submit'},
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    expect(prepared.foreground[0]?.rows[0]?.dependencies).toHaveLength(1);
    expect(localDependenciesSpy).not.toHaveBeenCalled();
  });

  it('passes the selected collapsed activity aggregation into prepared rows', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);

    const density = buildTracePreparedScene({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: true,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });
    const icicle = buildTracePreparedScene({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: true,
      collapsedActivityAggregation: 'icicle',
      isOverviewEnabled: true,
      getTraceModelMatrixForGraph: () => undefined
    });

    expect(
      density.foreground[0]?.rows[0]?.collapsedActivityIntervals.some(
        interval => interval.height != null
      )
    ).toBe(false);
    expect(
      icicle.foreground[0]?.rows[0]?.collapsedActivityIntervals.some(
        interval => interval.height != null
      )
    ).toBe(true);
    expect(
      icicle.overview[0]?.rows[0]?.collapsedActivityIntervals.some(
        interval => interval.height != null
      )
    ).toBe(true);
  });

  it('does not precompute row-local selected span refs when visible row spans are omitted', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph)[0];
    if (!traceLayout) {
      throw new Error('Expected prepared trace layout');
    }

    const preparedRows = buildTracePreparedProcessRows({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      includeSpans: false,
      includeDependencies: false,
      includeOverflowLabels: false
    });

    expect(preparedRows[0]?.spans).toEqual([]);
    expect(preparedRows[0]).not.toHaveProperty('selectedSpanRefs');
  });

  it('reuses memoized row enrichments for stable layouts and collapsed activity inputs', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph)[0];
    if (!traceLayout) {
      throw new Error('Expected prepared trace layout');
    }
    const collapsedActivityByProcessId = {
      'rank-a': [{startX: 3, endX: 4, activity: 1, color: [1, 2, 3] as [number, number, number]}]
    };

    const first = buildTracePreparedProcessRows({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      collapsedActivityByProcessId
    });
    const second = buildTracePreparedProcessRows({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      collapsedActivityByProcessId
    });

    expect(second[0]?.collapsedActivityIntervals).toBe(first[0]?.collapsedActivityIntervals);
  });

  it('keeps empty row enrichment arrays stable without overflow labels', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph)[0];
    if (!traceLayout) {
      throw new Error('Expected prepared trace layout');
    }

    const first = buildTracePreparedProcessRows({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      includeSpans: false,
      includeDependencies: false,
      includeOverflowLabels: false
    });
    const second = buildTracePreparedProcessRows({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      includeSpans: false,
      includeDependencies: false,
      includeOverflowLabels: false
    });

    expect(second[0]?.collapsedActivityIntervals).toBe(first[0]?.collapsedActivityIntervals);
    expect(second[0]?.overflowLabels).toBe(first[0]?.overflowLabels);
  });

  it('prepares overview rows without scanning render spans or local dependencies', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);
    const renderSpansSpy = vi.spyOn(traceGraph, 'getVisibleProcessRenderSpans');
    const localDependenciesSpy = vi.spyOn(traceGraph, 'getVisibleLocalDependencySources');

    const prepared = buildTracePreparedOverviewGraphScenes({
      isOverviewEnabled: true,
      sourceTraceGraphs: [traceGraph],
      traceGraphs: [traceGraph],
      traceLayouts,
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      getTraceModelMatrixForGraph: () => undefined
    });

    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.graph).toBe(traceLayouts[0]?.minimapLayout?.traceLayout.traceGraph);
    expect(prepared[0]?.rows[0]?.spans).toEqual([]);
    expect(prepared[0]?.rows[0]?.dependencies).toEqual([]);
    expect(renderSpansSpy).not.toHaveBeenCalled();
    expect(localDependenciesSpy).not.toHaveBeenCalled();
  });

  it('projects selected and hovered span indicators into minimap process rows', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph)[0]?.minimapLayout?.traceLayout;
    const selectedSpanRef = getRequiredTestSpanRef(traceGraph, 'parent' as TraceSpanId);
    const hoveredSpanRef = getRequiredTestSpanRef(traceGraph, 'child' as TraceSpanId);
    if (!traceLayout) {
      throw new Error('Expected minimap trace layout');
    }

    const indicators = buildTracePreparedMinimapSpanIndicators({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      selectedSpanRefs: [selectedSpanRef],
      hoveredSpanRef
    });

    expect(indicators).toEqual([
      expect.objectContaining({
        id: `selected-${selectedSpanRef}`,
        kind: 'selected',
        spanRef: selectedSpanRef,
        x: 4,
        startX: -1,
        endX: 9,
        y: traceLayout.processLayouts[0]?.collapsedActivityY
      }),
      expect.objectContaining({
        id: `hovered-${hoveredSpanRef}`,
        kind: 'hovered',
        spanRef: hoveredSpanRef,
        x: 4,
        startX: 0,
        endX: 8,
        y: traceLayout.processLayouts[0]?.collapsedActivityY
      })
    ]);
  });

  it('decorates prepared minimap scenes with transient selection inputs', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);
    const selectedSpanRef = getRequiredTestSpanRef(traceGraph, 'parent' as TraceSpanId);
    const hoveredSpanRef = getRequiredTestSpanRef(traceGraph, 'child' as TraceSpanId);
    const prepared = buildTracePreparedScene({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: true,
      getTraceModelMatrixForGraph: () => undefined
    });

    const selectionPrepared = buildTraceSelectionPreparedScene({
      preparedScene: prepared,
      sourceTraceGraphs: [traceGraph],
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      selectedSpanRefs: [selectedSpanRef],
      hoveredSpanRef
    });

    expect(prepared.overview[0]?.minimapSpanIndicators).toEqual([]);
    expect(selectionPrepared.overview[0]?.rows).toBe(prepared.overview[0]?.rows);
    expect(selectionPrepared.overview[0]?.minimapSpanIndicators).toEqual([
      expect.objectContaining({kind: 'selected', spanRef: selectedSpanRef}),
      expect.objectContaining({kind: 'hovered', spanRef: hoveredSpanRef})
    ]);
  });

  it('projects minimap span indicators to the rendered span geometry center', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph, 'latest')[0]?.minimapLayout?.traceLayout;
    const selectedSpanRef = getRequiredTestSpanRef(traceGraph, 'parent' as TraceSpanId);
    if (!traceLayout) {
      throw new Error('Expected minimap trace layout');
    }

    const indicators = buildTracePreparedMinimapSpanIndicators({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      selectedSpanRefs: [selectedSpanRef]
    });

    expect(indicators[0]).toMatchObject({
      kind: 'selected',
      spanRef: selectedSpanRef,
      x: 24,
      startX: 19,
      endX: 29
    });
  });

  it('dedupes hovered span indicators when the hovered span is already selected', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph)[0]?.minimapLayout?.traceLayout;
    const selectedSpanRef = getRequiredTestSpanRef(traceGraph, 'parent' as TraceSpanId);
    if (!traceLayout) {
      throw new Error('Expected minimap trace layout');
    }

    const indicators = buildTracePreparedMinimapSpanIndicators({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      selectedSpanRefs: [selectedSpanRef],
      hoveredSpanRef: selectedSpanRef
    });

    expect(indicators).toHaveLength(1);
    expect(indicators[0]).toMatchObject({kind: 'selected', spanRef: selectedSpanRef});
  });

  it('omits minimap span indicators when the span or process row is missing', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph)[0]?.minimapLayout?.traceLayout;
    if (!traceLayout) {
      throw new Error('Expected minimap trace layout');
    }

    expect(
      buildTracePreparedMinimapSpanIndicators({
        graph: traceGraph,
        layout: {...traceLayout, renderRows: []},
        settings: defaultTraceVisSettings,
        colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
        selectedSpanRefs: [getRequiredTestSpanRef(traceGraph, 'parent' as TraceSpanId)],
        hoveredSpanRef: 999_999 as SpanRef
      })
    ).toEqual([]);
  });

  it('colors minimap span indicators from the resolved span fill color', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph)[0]?.minimapLayout?.traceLayout;
    const selectedSpanRef = getRequiredTestSpanRef(traceGraph, 'parent' as TraceSpanId);
    const hoveredSpanRef = getRequiredTestSpanRef(traceGraph, 'child' as TraceSpanId);
    const colorScheme: TraceColorScheme = {
      ...DEFAULT_TRACE_COLOR_SCHEME,
      getSpanFillColor: () => [12, 34, 56, 255]
    };
    if (!traceLayout) {
      throw new Error('Expected minimap trace layout');
    }

    const indicators = buildTracePreparedMinimapSpanIndicators({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      colorScheme,
      selectedSpanRefs: [selectedSpanRef],
      hoveredSpanRef
    });

    expect(indicators[0]).toMatchObject({
      kind: 'selected',
      fillColor: [12, 34, 56, 245],
      lineColor: [12, 34, 56, 190]
    });
    expect(indicators[1]).toMatchObject({
      kind: 'hovered',
      fillColor: [12, 34, 56, 205],
      lineColor: [12, 34, 56, 130]
    });
  });

  it('builds minimap view bounds from minimap layouts and overview time ranges', () => {
    const overviewViewModel = buildTracePreparedOverviewViewModel({
      isOverviewEnabled: true,
      mainBounds: [
        [0, 0],
        [100, 100]
      ],
      minimapBounds: [
        [5, -10],
        [120, 80]
      ],
      originTimeMs: 50,
      overviewTimeRange: {
        startTimeMs: 10,
        endTimeMs: 200
      },
      overviewLoadedTimeRange: {
        startTimeMs: 60,
        endTimeMs: 90
      }
    });

    expect(overviewViewModel.bounds).toEqual([
      [-40, -10],
      [150, 80]
    ]);
    expect(overviewViewModel.loadedContentBounds).toEqual({
      minX: 10,
      maxX: 40
    });
  });
});

function createDependencyTraceGraph(): TraceGraph {
  return createTraceGraphFromProcesses([createProcessWithLocalDependency('rank-a', 0)]);
}

/** Builds one two-thread process so aggregation toggles necessarily move span/dependency geometry. */
function createCrossThreadDependencyTraceGraph(): TraceGraph {
  return createTraceGraphFromProcesses([createProcessWithCrossThreadLocalDependency('rank-a', 0)]);
}

function createTraceGraphFromProcesses(processes: readonly TraceProcess[]): TraceGraph {
  return createTestTraceGraph(
    buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([...processes], [], {
        name: 'trace-deck-layout-inputs-test'
      })
    )
  );
}

function createAppendedTraceGraphReusingFirstProcessTables(
  firstTraceGraph: TraceGraph,
  processes: readonly TraceProcess[]
): TraceGraph {
  return createAppendedTraceGraphReusingPreviousProcessTables(firstTraceGraph, processes);
}

/** Builds an appended graph fixture that preserves existing process table and chunk identities. */
function createAppendedTraceGraphReusingPreviousProcessTables(
  previousTraceGraph: TraceGraph,
  processes: readonly TraceProcess[]
): TraceGraph {
  const appendedTraceGraphData = buildTraceGraphDataFromJSONTrace(
    buildJSONTrace([...processes], [], {
      name: 'trace-deck-layout-inputs-append-test'
    })
  );
  if (processes.length === 0) {
    throw new Error('Expected at least one process');
  }
  const previousProcessIds = new Set(previousTraceGraph.processIdsByIndex);
  return createTestTraceGraph({
    ...appendedTraceGraphData,
    chunks: appendedTraceGraphData.chunks.map(
      chunk =>
        previousTraceGraph.chunks.find(
          previousChunk => previousChunk.chunkKey === chunk.chunkKey
        ) ?? chunk
    ),
    processSpanTableMap: {
      ...appendedTraceGraphData.processSpanTableMap,
      ...Object.fromEntries(
        [...previousProcessIds].flatMap(processId => {
          const table = previousTraceGraph.processSpanTableMap[processId];
          return table ? [[processId, table] as const] : [];
        })
      )
    },
    localDependencyTableMap: {
      ...appendedTraceGraphData.localDependencyTableMap,
      ...Object.fromEntries(
        [...previousProcessIds].flatMap(processId => {
          const table = previousTraceGraph.localDependencyTableMap[processId];
          return table ? [[processId, table] as const] : [];
        })
      )
    }
  });
}

function buildTestLayouts(
  traceGraph: TraceGraph,
  timingKey: string | null = 'primary',
  previousLayouts?: readonly TraceLayout[],
  topPadding = 0
) {
  return buildTraceLayouts({
    prebuiltTraceGraphs: [traceGraph],
    traceGraphs: [traceGraph],
    previousLayouts,
    topPadding,
    settings: defaultTraceVisSettings,
    threadLaneLayoutOverrides: {},
    timingKey,
    minTimeMs: traceGraph.minTimeMs,
    buildMinimapLayouts: true
  });
}

/** Builds layouts for one explicit track aggregation mode while preserving prior layout reuse input. */
function buildAggregationTestLayouts(
  traceGraph: TraceGraph,
  trackAggregationMode: TraceVisSettings['trackAggregationMode'],
  previousLayouts?: readonly TraceLayout[]
) {
  return buildTraceLayouts({
    prebuiltTraceGraphs: [traceGraph],
    traceGraphs: [traceGraph],
    previousLayouts,
    settings: {
      ...defaultTraceVisSettings,
      trackAggregationMode
    },
    threadLaneLayoutOverrides: {},
    timingKey: 'primary',
    minTimeMs: traceGraph.minTimeMs,
    buildMinimapLayouts: true
  });
}

function getRequiredFloat32Attribute(value: unknown): Float32Array {
  if (!(value instanceof Float32Array)) {
    throw new Error('Expected Float32Array attribute');
  }
  return value;
}

function getRequiredTestSpanRef(traceGraph: TraceGraph, spanId: TraceSpanId): SpanRef {
  const spanRef = traceGraph.getSpanRefByExternalBlockId(spanId);
  if (spanRef == null) {
    throw new Error(`Expected span ref for ${spanId}`);
  }
  return spanRef;
}

/** Returns zeroed mutable prepared-row counters for geometry-refresh assertions. */
function createPreparedRowsStats() {
  return {
    spanBuildCount: 0,
    dependencyBuildCount: 0,
    preparedRowReuseCount: 0,
    preparedRowBuildCount: 0,
    spanReuseCount: 0,
    dependencyReuseCount: 0,
    binaryBlockReuseCount: 0,
    binaryBlockBuildCount: 0,
    binaryBlockTranslateCount: 0,
    binaryBlockGeometryRefreshCount: 0,
    binaryDependencyReuseCount: 0,
    binaryDependencyBuildCount: 0,
    binaryDependencyTranslateCount: 0,
    binaryDependencyGeometryRefreshCount: 0,
    reusedSpanCount: 0,
    builtSpanCount: 0,
    reusedDependencyRefCount: 0,
    builtDependencyRefCount: 0,
    binaryBlockSpanCount: 0,
    binaryDependencyRefCount: 0,
    spanRefBuildDurationMs: 0,
    dependencyRefBuildDurationMs: 0,
    binaryBlockBuildDurationMs: 0,
    binaryDependencyBuildDurationMs: 0,
    binaryBlockTranslateDurationMs: 0,
    binaryBlockGeometryRefreshDurationMs: 0,
    binaryDependencyTranslateDurationMs: 0,
    binaryDependencyGeometryRefreshDurationMs: 0
  };
}

/** Verifies aggregation toggles keep static row payloads while refreshing geometry-only buffers. */
function expectAggregationToggleGeometryRefresh(
  initialAggregationMode: TraceVisSettings['trackAggregationMode'],
  nextAggregationMode: TraceVisSettings['trackAggregationMode']
): void {
  const traceGraph = createCrossThreadDependencyTraceGraph();
  const firstLayouts = buildAggregationTestLayouts(traceGraph, initialAggregationMode);
  const settings = {
    ...defaultTraceVisSettings,
    localDependencyMode: 'submit',
    trackAggregationMode: initialAggregationMode
  } satisfies TraceVisSettings;
  const firstRows = buildTracePreparedProcessRows({
    graph: traceGraph,
    layout: firstLayouts[0]!,
    settings,
    colorScheme: DEFAULT_TRACE_COLOR_SCHEME
  });
  const nextLayouts = buildAggregationTestLayouts(traceGraph, nextAggregationMode, firstLayouts);
  const stats = createPreparedRowsStats();
  const nextRows = buildTracePreparedProcessRows({
    graph: traceGraph,
    layout: nextLayouts[0]!,
    settings: {
      ...settings,
      trackAggregationMode: nextAggregationMode
    },
    colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
    previousRows: firstRows,
    stats
  });

  const firstRow = firstRows[0];
  const nextRow = nextRows[0];
  expect(firstRows).toHaveLength(1);
  expect(nextRows).toHaveLength(1);
  expect(nextRow?.spans).toBe(firstRow?.spans);
  expect(nextRow?.dependencies).toBe(firstRow?.dependencies);
  expect(nextRow?.binaryBlockData).not.toBe(firstRow?.binaryBlockData);
  expect(nextRow?.binaryDependencyLineData).not.toBe(firstRow?.binaryDependencyLineData);
  expect(nextRow?.binaryBlockData?.data.attributes.getPosition?.value).not.toBe(
    firstRow?.binaryBlockData?.data.attributes.getPosition?.value
  );
  expect(nextRow?.binaryBlockData?.data.attributes.getSize?.value).not.toBe(
    firstRow?.binaryBlockData?.data.attributes.getSize?.value
  );
  expect(nextRow?.binaryDependencyLineData?.data.attributes.getSourcePosition?.value).not.toBe(
    firstRow?.binaryDependencyLineData?.data.attributes.getSourcePosition?.value
  );
  expect(nextRow?.binaryDependencyLineData?.data.attributes.getTargetPosition?.value).not.toBe(
    firstRow?.binaryDependencyLineData?.data.attributes.getTargetPosition?.value
  );
  expect(nextRow?.binaryBlockData?.data.attributes.getFillColor?.value).toBe(
    firstRow?.binaryBlockData?.data.attributes.getFillColor?.value
  );
  expect(nextRow?.binaryBlockData?.data.attributes.getLineColor?.value).toBe(
    firstRow?.binaryBlockData?.data.attributes.getLineColor?.value
  );
  expect(nextRow?.binaryDependencyLineData?.data.attributes.getColor?.value).toBe(
    firstRow?.binaryDependencyLineData?.data.attributes.getColor?.value
  );
  expect(stats.binaryBlockGeometryRefreshCount).toBe(1);
  expect(stats.binaryDependencyGeometryRefreshCount).toBe(1);
  expect(stats.binaryBlockBuildCount).toBe(0);
  expect(stats.binaryDependencyBuildCount).toBe(0);
}

function createProcessWithLocalDependency(processId: string, rankNum: number): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: `${processId}-thread`,
    threadId: `${processId}-thread` as TraceThreadId,
    processId
  };
  const parentBlock = createBlock('parent', thread);
  const childBlock = createBlock('child', thread);
  const dependencyId = 'dep-parent-child' as TraceDependencyId;
  const dependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId,
    startSpanId: parentBlock.spanId,
    endSpanId: childBlock.spanId,
    keywords: new Set(['SUBMIT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 1_000
  };
  parentBlock.localDependencyIds = [dependencyId];
  parentBlock.localDependencies = [dependency];

  return {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [parentBlock, childBlock],
    spanMap: {
      [parentBlock.spanId]: parentBlock,
      [childBlock.spanId]: childBlock
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

/** Builds one process whose local dependency spans two distinct source threads. */
function createProcessWithCrossThreadLocalDependency(
  processId: string,
  rankNum: number
): TraceProcess {
  const startThread: TraceThread = {
    type: 'trace-thread',
    name: `${processId}-thread-a`,
    threadId: `${processId}-thread-a` as TraceThreadId,
    processId
  };
  const endThread: TraceThread = {
    type: 'trace-thread',
    name: `${processId}-thread-b`,
    threadId: `${processId}-thread-b` as TraceThreadId,
    processId
  };
  const parentBlock = createBlock('parent', startThread);
  const childBlock = createBlock('child', endThread);
  const dependencyId = 'dep-parent-child' as TraceDependencyId;
  const dependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId,
    startSpanId: parentBlock.spanId,
    endSpanId: childBlock.spanId,
    keywords: new Set(['SUBMIT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 1_000
  };
  parentBlock.localDependencyIds = [dependencyId];
  parentBlock.localDependencies = [dependency];

  return {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum,
    stepNum: 0,
    threads: [startThread, endThread],
    threadMap: {
      [startThread.threadId]: startThread,
      [endThread.threadId]: endThread
    },
    spans: [parentBlock, childBlock],
    spanMap: {
      [parentBlock.spanId]: parentBlock,
      [childBlock.spanId]: childBlock
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

function createBlock(name: string, thread: TraceThread): TraceSpan {
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
        startTimeMs: name === 'parent' ? 0 : 1,
        endTimeMs: name === 'parent' ? 10 : 9,
        durationMs: name === 'parent' ? 10 : 8,
        durationMsAsString: name === 'parent' ? '10ms' : '8ms'
      },
      latest: {
        status: 'finished',
        startTimeMs: name === 'parent' ? 20 : 41,
        endTimeMs: name === 'parent' ? 30 : 49,
        durationMs: name === 'parent' ? 10 : 8,
        durationMsAsString: name === 'parent' ? '10ms' : '8ms'
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}
