import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  buildArrowTraceSameProcessDependencyTableFromColumns,
  buildArrowTraceSpanSidecarTableFromColumns,
  buildArrowTraceSpanTableFromColumns,
  buildTraceProcessSpanRefTables,
  replaceArrowTraceSpanRefColumns
} from '../ingestion/arrow-trace';
import {
  buildSyntheticArrowTraceFixture,
  SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME
} from '../test-stubs/synthetic-arrow-trace';
import {buildTraceDatasetFromReadyTraceChunks} from '../trace-chunk-graph-assembler';
import {buildTraceDatasetRefSources} from '../trace-dataset-ref-sources';
import {TraceGraph} from '../trace-graph/trace-graph';
import {
  encodeChunkRef,
  encodeLocalSpanRef,
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSameProcessDependencyRef,
  encodeSpanRef
} from '../trace-graph/trace-id-encoder';
import {buildTraceLayoutGeometryDerivationContext} from '../trace-layout/trace-derived-geometry';
import {buildTraceLayout, buildTraceLayouts} from '../trace-layout/trace-geometry-layout';
import {PROCESS_TRACE_COLOR_SCHEME} from '../trace-style/trace-color-scheme';
import {buildTraceViewSnapshot} from '../trace-view-snapshot';
import * as traceArrowEndpointPages from './trace-arrow-endpoint-pages';
import {buildTraceArrowPrimaryEndpointPages} from './trace-arrow-endpoint-pages';
import {
  buildTraceDeckBinaryBlockData,
  buildTraceDeckBinaryDependencyLineData
} from './trace-deck-binary-data';
import {buildTracePreparedProcessRows} from './trace-prepared-scene';
import {estimatePreparedLayoutInputsSize} from './trace-prepared-scene-size';
import {
  buildTraceDenseSameProcessDependencyRefSource,
  buildTraceDenseSpanRefSource
} from './trace-ref-source';

import type {TraceDataset} from '../trace-dataset';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {TraceProcessId} from '../trace-graph/trace-types';
import type {TraceColorScheme, TraceDeckColor} from '../trace-style/trace-color-scheme';
import type {TracePreparedGraphScene} from './trace-prepared-scene';
import type {TraceSameProcessDependencyRefSource} from './trace-ref-source';

const TRACE_PREPARED_SCENE_TEST_SETTINGS: TraceVisSettings = {
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

afterEach(() => {
  vi.restoreAllMocks();
});

/** Wraps deliberately mutated datasets with explicit refs to avoid trusted dense shortcuts. */
function createRawTestTraceGraph(traceDataset: TraceDataset): TraceGraph {
  const refSources = buildTraceDatasetRefSources({
    processIdsByIndex: traceDataset.ownerRefSnapshot.processIdsByIndex,
    processSpanTableMap: traceDataset.processSpanTableMap,
    sameProcessDependencyTableMap: traceDataset.sameProcessDependencyTableMap
  });
  return new TraceGraph({
    traceDataset: {
      ...traceDataset,
      ...refSources,
      spanRefs:
        traceDataset.spanRefs ??
        traceDataset.chunks.flatMap(chunk =>
          Array.from({length: chunk.spanTable.numRows}, (_, rowIndex) =>
            encodeSpanRef(chunk.chunkIndex, rowIndex)
          )
        )
    }
  });
}

describe('buildTraceDeckBinaryDependencyLineData', () => {
  it('keeps visible canonical refs on the Arrow-native dependency path', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-arrow-dependency-parity',
      processCount: 1,
      rowCount: 8,
      threadsPerProcess: 1
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-arrow-dependency-parity',
      ...fixture.materializationInputs
    });
    const layout = buildTraceLayout({
      traceGraph: new TraceGraph({traceDataset, traceStore: fixture.traceStore}),
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const graph = layout.traceGraph;
    const processRef = graph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected one synthetic process ref.');
    }
    const sourceDependencyRefs = graph.getSameProcessDependencyRefs(processRef);
    const visibleDependencyRefs = Array.from(
      graph.iterateVisibleSameProcessDependencyRefsByProcess(processRef)
    );
    const waitModeSpy = vi.spyOn(graph, 'getDependencyWaitMode');
    const geometryContext = buildTraceLayoutGeometryDerivationContext(layout);
    const threadLayoutGetSpy = vi.spyOn(geometryContext.layoutLookup.threadLayoutsByRef, 'get');
    const endpointPages = buildTraceArrowPrimaryEndpointPages(layout);
    if (!endpointPages) {
      throw new Error('Expected generated-primary endpoint pages.');
    }
    const dependencyTable = graph.sameProcessDependencyTableMap[graph.processIdsByIndex[0]!];
    const endpointPage = endpointPages.pagesByChunkIndex.get(0);
    const startSpanRefColumn = dependencyTable?.getChild('startSpanRef');
    const endSpanRefColumn = dependencyTable?.getChild('endSpanRef');
    const waitModeCodeColumn = dependencyTable?.getChild('waitModeCode');
    const waitTimeMsColumn = dependencyTable?.getChild('waitTimeMs');
    const keywordFlagsColumn = dependencyTable?.getChild('keywordFlags');
    if (
      !endpointPage ||
      !startSpanRefColumn ||
      !endSpanRefColumn ||
      !waitModeCodeColumn ||
      !waitTimeMsColumn ||
      !keywordFlagsColumn
    ) {
      throw new Error('Expected trusted dependency and endpoint columns.');
    }
    const startSpanRefGetSpy = vi.spyOn(startSpanRefColumn, 'get');
    const endSpanRefGetSpy = vi.spyOn(endSpanRefColumn, 'get');
    const waitModeCodeGetSpy = vi.spyOn(waitModeCodeColumn, 'get');
    const waitTimeMsGetSpy = vi.spyOn(waitTimeMsColumn, 'get');
    const keywordFlagsGetSpy = vi.spyOn(keywordFlagsColumn, 'get');
    const processRefGetSpy = vi.spyOn(endpointPage.processRefColumn, 'get');
    const threadRefGetSpy = vi.spyOn(endpointPage.threadRefColumn, 'get');
    const statusCodeGetSpy = vi.spyOn(endpointPage.statusCodeColumn, 'get');
    const startTimeMsGetSpy = vi.spyOn(endpointPage.startTimeMsColumn, 'get');
    const endTimeMsGetSpy = vi.spyOn(endpointPage.endTimeMsColumn, 'get');
    const trustedEndpointBindSpy = vi.spyOn(
      traceArrowEndpointPages,
      'bindTraceArrowTrustedPrimaryEndpointCursorRow'
    );

    const denseDependencyRefs = buildTraceDenseSameProcessDependencyRefSource(
      0,
      sourceDependencyRefs.length
    );
    const denseAtSpy = vi.fn(denseDependencyRefs.at.bind(denseDependencyRefs));
    const denseArrowData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: {...denseDependencyRefs, at: denseAtSpy},
      traceLayout: layout,
      geometryContext,
      endpointPages,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    expect(Array.from(denseDependencyRefs)).toEqual(sourceDependencyRefs);
    expect(denseAtSpy).not.toHaveBeenCalled();
    expect(startSpanRefGetSpy).not.toHaveBeenCalled();
    expect(endSpanRefGetSpy).not.toHaveBeenCalled();
    expect(waitModeCodeGetSpy).not.toHaveBeenCalled();
    expect(waitTimeMsGetSpy).not.toHaveBeenCalled();
    expect(keywordFlagsGetSpy).not.toHaveBeenCalled();
    expect(processRefGetSpy).not.toHaveBeenCalled();
    expect(threadRefGetSpy).not.toHaveBeenCalled();
    expect(statusCodeGetSpy).not.toHaveBeenCalled();
    expect(startTimeMsGetSpy).not.toHaveBeenCalled();
    expect(endTimeMsGetSpy).not.toHaveBeenCalled();
    expect(threadLayoutGetSpy).not.toHaveBeenCalled();
    expect(trustedEndpointBindSpy).toHaveBeenCalledTimes(2);
    startSpanRefGetSpy.mockRestore();
    endSpanRefGetSpy.mockRestore();
    waitModeCodeGetSpy.mockRestore();
    waitTimeMsGetSpy.mockRestore();
    keywordFlagsGetSpy.mockRestore();
    processRefGetSpy.mockRestore();
    threadRefGetSpy.mockRestore();
    statusCodeGetSpy.mockRestore();
    startTimeMsGetSpy.mockRestore();
    endTimeMsGetSpy.mockRestore();
    threadLayoutGetSpy.mockRestore();
    trustedEndpointBindSpy.mockRestore();

    const arrowNativeData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: sourceDependencyRefs,
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    expect(waitModeSpy).not.toHaveBeenCalled();
    expect(getBinaryAttributeValues(denseArrowData!, 'getSourcePosition')).toEqual(
      getBinaryAttributeValues(arrowNativeData, 'getSourcePosition')
    );
    expect(getBinaryAttributeValues(denseArrowData!, 'getTargetPosition')).toEqual(
      getBinaryAttributeValues(arrowNativeData, 'getTargetPosition')
    );
    expect(getBinaryAttributeValues(denseArrowData!, 'getColor')).toEqual(
      getBinaryAttributeValues(arrowNativeData, 'getColor')
    );

    const genericData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: visibleDependencyRefs,
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    expect(waitModeSpy).not.toHaveBeenCalled();
    expect(getBinaryAttributeValues(arrowNativeData, 'getSourcePosition')).toEqual(
      getBinaryAttributeValues(genericData, 'getSourcePosition')
    );
    expect(getBinaryAttributeValues(arrowNativeData, 'getTargetPosition')).toEqual(
      getBinaryAttributeValues(genericData, 'getTargetPosition')
    );
    expect(getBinaryAttributeValues(arrowNativeData, 'getColor')).toEqual(
      getBinaryAttributeValues(genericData, 'getColor')
    );
    waitModeSpy.mockRestore();
  });

  it('keeps dense prepared dependency rows source-backed without ref arrays', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-dense-dependency-source',
      processCount: 1,
      rowCount: 8,
      threadsPerProcess: 1
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-dense-dependency-source',
      ...fixture.materializationInputs
    });
    const layout = buildTraceLayout({
      traceGraph: new TraceGraph({traceDataset, traceStore: fixture.traceStore}),
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const graph = layout.traceGraph;
    const processRef = graph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected one synthetic process ref.');
    }
    const expectedDependencyRefs = graph.getSameProcessDependencyRefs(processRef);
    const dependencyRefsSpy = vi.spyOn(graph, 'getSameProcessDependencyRefs');

    const rows = buildTracePreparedProcessRows({
      graph,
      layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      includeSpans: false,
      includeOverflowLabels: false
    });
    const binaryDependencyLineData = rows[0]?.binaryDependencyLineData;
    const source = binaryDependencyLineData?.dependencies;
    if (!source || !binaryDependencyLineData) {
      throw new Error('Expected one dense prepared dependency row.');
    }

    expect(Array.isArray(source)).toBe(false);
    expect(source.denseProcessIndex).toBe(0);
    expect(Array.from(source)).toEqual(expectedDependencyRefs);
    expect(binaryDependencyLineData.data.length).toBe(expectedDependencyRefs.length);
    expect(rows[0]).not.toHaveProperty('dependencies');
    expect(dependencyRefsSpy).not.toHaveBeenCalled();
    dependencyRefsSpy.mockRestore();
  });

  it('streams text-filtered non-parent dependencies without visible ref arrays', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-dense-dependency-text-mask',
      processCount: 1,
      rowCount: 8,
      threadsPerProcess: 1,
      textFilterMatchEvery: 3
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-dense-dependency-text-mask',
      ...fixture.materializationInputs
    });
    const traceViewSnapshot = buildTraceViewSnapshot(traceDataset, {
      spanFilters: [SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME]
    });
    const graph = new TraceGraph({traceDataset, traceStore: fixture.traceStore}, traceViewSnapshot);
    const layout = buildTraceLayout({
      traceGraph: graph,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const processRef = graph.getProcessRefs()[0];
    const processId = traceDataset.processes[0]?.processId as TraceProcessId | undefined;
    if (processRef == null || processId == null) {
      throw new Error('Expected one synthetic process ref and id.');
    }
    const visibleDependencyRefsSpy = vi.spyOn(
      graph,
      'iterateVisibleSameProcessDependencyRefsByProcess'
    );

    const rows = buildTracePreparedProcessRows({
      graph,
      layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      includeSpans: false,
      includeOverflowLabels: false
    });
    const source = rows[0]?.binaryDependencyLineData?.dependencies;
    if (!source) {
      throw new Error('Expected one masked dense dependency row.');
    }
    const expectedDependencyRefs = [1, 4].map(rowIndex =>
      encodeSameProcessDependencyRef(encodeLocalSpanRef(0, rowIndex))
    );

    expect(Array.isArray(source)).toBe(false);
    expect(source.denseProcessIndex).toBe(0);
    expect(source.denseVisibility?.dependencyTable).toBe(
      traceDataset.sameProcessDependencyTableMap[processId]
    );
    expect(source.denseVisibility?.traceViewSnapshot).toBe(traceViewSnapshot);
    expect(Array.from(source)).toEqual(expectedDependencyRefs);
    expect(visibleDependencyRefsSpy).not.toHaveBeenCalled();

    const denseAtSpy = vi.fn(source.at.bind(source));
    const denseData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: {...source, at: denseAtSpy},
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    expect(denseAtSpy).not.toHaveBeenCalled();
    visibleDependencyRefsSpy.mockRestore();

    const genericData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: Array.from(
        graph.iterateVisibleSameProcessDependencyRefsByProcess(processRef)
      ),
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    expect(getBinaryAttributeValues(denseData, 'getSourcePosition')).toEqual(
      getBinaryAttributeValues(genericData, 'getSourcePosition')
    );
    expect(getBinaryAttributeValues(denseData, 'getTargetPosition')).toEqual(
      getBinaryAttributeValues(genericData, 'getTargetPosition')
    );
    expect(getBinaryAttributeValues(denseData, 'getColor')).toEqual(
      getBinaryAttributeValues(genericData, 'getColor')
    );
  });

  it('keeps trusted palette colors identical for regular, submit, and warning rows', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-trusted-dependency-colors',
      processCount: 1,
      rowCount: 4,
      threadsPerProcess: 1
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-trusted-dependency-colors',
      ...fixture.materializationInputs
    });
    const processId = traceDataset.processes[0]?.processId;
    if (!processId) {
      throw new Error('Expected one synthetic process id.');
    }
    const dependencyTable = buildArrowTraceSameProcessDependencyTableFromColumns({
      startSpanRef: [encodeSpanRef(0, 0), encodeSpanRef(0, 1), encodeSpanRef(0, 2)],
      endSpanRef: [encodeSpanRef(0, 1), encodeSpanRef(0, 2), encodeSpanRef(0, 3)],
      waitMode: ['end-to-start', 'end-to-start', 'end-to-start'],
      bidirectional: [false, false, false],
      waitTimeMs: [0, 20, 0],
      keywords: [[], ['SUBMIT'], ['SUBMIT']],
      hasParentKeyword: [false, false, false]
    });
    const traceGraph = new TraceGraph({
      traceDataset: {
        ...traceDataset,
        sameProcessDependencyTableMap: {
          ...traceDataset.sameProcessDependencyTableMap,
          [processId]: dependencyTable
        }
      },
      traceStore: fixture.traceStore
    });
    const layout = buildTraceLayout({
      traceGraph,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const processRef = traceGraph.getProcessRefs()[0];
    const endpointPages = buildTraceArrowPrimaryEndpointPages(layout);
    if (processRef == null || !endpointPages) {
      throw new Error('Expected one trusted dependency layout.');
    }
    const denseDependencyRefs = buildTraceDenseSameProcessDependencyRefSource(
      0,
      dependencyTable.numRows
    );
    const denseData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: denseDependencyRefs,
      traceLayout: layout,
      endpointPages,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const genericData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: Array.from(
        traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(processRef)
      ),
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });

    expect(getBinaryAttributeValues(denseData, 'getColor')).toEqual(
      getBinaryAttributeValues(genericData, 'getColor')
    );
  });

  it('keeps flattened trusted wait modes, parent routing, and implicit z rows identical', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-trusted-dependency-wait-modes',
      processCount: 1,
      rowCount: 5,
      threadsPerProcess: 1
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-trusted-dependency-wait-modes',
      ...fixture.materializationInputs
    });
    const processId = traceDataset.processes[0]?.processId;
    if (!processId) {
      throw new Error('Expected one synthetic process id.');
    }
    const dependencyTable = buildArrowTraceSameProcessDependencyTableFromColumns({
      startSpanRef: [
        encodeSpanRef(0, 0),
        encodeSpanRef(0, 0),
        encodeSpanRef(0, 1),
        encodeSpanRef(0, 2)
      ],
      endSpanRef: [
        encodeSpanRef(0, 1),
        encodeSpanRef(0, 2),
        encodeSpanRef(0, 3),
        encodeSpanRef(0, 4)
      ],
      waitMode: ['end-to-start', 'end-to-end', 'start-to-start', 'end-to-end'],
      bidirectional: [false, false, false, false],
      waitTimeMs: [0, 0, 0, 0],
      keywords: [[], [], [], ['PARENT']],
      hasParentKeyword: [false, false, false, true]
    });
    const traceGraph = new TraceGraph({
      traceDataset: {
        ...traceDataset,
        sameProcessDependencyTableMap: {
          ...traceDataset.sameProcessDependencyTableMap,
          [processId]: dependencyTable
        }
      },
      traceStore: fixture.traceStore
    });
    const layout = buildTraceLayout({
      traceGraph,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const processRef = traceGraph.getProcessRefs()[0];
    const endpointPages = buildTraceArrowPrimaryEndpointPages(layout);
    if (processRef == null || !endpointPages) {
      throw new Error('Expected one trusted dependency layout.');
    }
    const denseData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: buildTraceDenseSameProcessDependencyRefSource(0, dependencyTable.numRows),
      traceLayout: layout,
      endpointPages,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const genericData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: Array.from(
        traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(processRef)
      ),
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const denseSourcePositions = getBinaryAttributeValues(denseData, 'getSourcePosition');
    const denseTargetPositions = getBinaryAttributeValues(denseData, 'getTargetPosition');

    expect(denseSourcePositions).toEqual(
      getBinaryAttributeValues(genericData, 'getSourcePosition')
    );
    expect(denseTargetPositions).toEqual(
      getBinaryAttributeValues(genericData, 'getTargetPosition')
    );
    expect(denseSourcePositions.filter((_, index) => index % 3 === 2)).toEqual([0, 0, 0, 0]);
    expect(denseTargetPositions.filter((_, index) => index % 3 === 2)).toEqual([0, 0, 0, 0]);
  });

  it('streams trusted dense dependency buffers across Arrow record batches', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-arrow-dense-dependency-fixed-width-batches',
      processCount: 1,
      rowCount: 8,
      threadsPerProcess: 1
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-arrow-dense-dependency-fixed-width-batches',
      ...fixture.materializationInputs
    });
    const processId = traceDataset.ownerRefSnapshot.processIdsByIndex[0];
    if (processId == null) {
      throw new Error('Expected one synthetic process id.');
    }
    const dependencyCount = fixture.summary.sameProcessDependencyCount;
    const splitRowIndex = Math.floor(dependencyCount / 2);
    const firstDependencyTable = buildDenseDependencyTableForRows(
      Array.from({length: splitRowIndex}, (_, rowIndex) => rowIndex)
    );
    const secondDependencyTable = buildDenseDependencyTableForRows(
      Array.from(
        {length: dependencyCount - splitRowIndex},
        (_, rowOffset) => splitRowIndex + rowOffset
      )
    );
    const dependencyTable = firstDependencyTable.concat(
      secondDependencyTable
    ) as typeof firstDependencyTable;
    const chunk = traceDataset.chunks[0];
    if (!chunk) {
      throw new Error('Expected one synthetic endpoint chunk.');
    }
    const endpointSplitRowIndex = Math.floor(chunk.spanTable.numRows / 2);
    const splitSpanTable = buildSplitFinishedSyntheticSpanTable(
      chunk.spanTable.numRows,
      endpointSplitRowIndex
    ) as typeof chunk.spanTable;
    const traceGraph = new TraceGraph({
      traceDataset: {
        ...traceDataset,
        chunks: traceDataset.chunks.map(candidate =>
          candidate === chunk ? {...candidate, spanTable: splitSpanTable} : candidate
        ),
        sameProcessDependencyTableMap: {
          ...traceDataset.sameProcessDependencyTableMap,
          [processId]: dependencyTable
        }
      },
      traceStore: fixture.traceStore
    });
    const layout = buildTraceLayout({
      traceGraph,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const graph = layout.traceGraph;
    expect(graph.traceDataset).toBeDefined();
    const processRef = graph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected one synthetic process ref.');
    }
    const endpointPages = buildTraceArrowPrimaryEndpointPages(layout);
    if (!endpointPages) {
      throw new Error('Expected generated-primary endpoint pages.');
    }
    const endpointPage = endpointPages.pagesByChunkIndex.get(chunk.chunkIndex);
    if (!endpointPage) {
      throw new Error('Expected one split endpoint page.');
    }
    const startSpanRefColumn = dependencyTable.getChild('startSpanRef');
    const endSpanRefColumn = dependencyTable.getChild('endSpanRef');
    const waitModeCodeColumn = dependencyTable.getChild('waitModeCode');
    const waitTimeMsColumn = dependencyTable.getChild('waitTimeMs');
    const keywordFlagsColumn = dependencyTable.getChild('keywordFlags');
    const waitModeColumn = dependencyTable.getChild('waitMode');
    const keywordsColumn = dependencyTable.getChild('keywords');
    const hasParentKeywordColumn = dependencyTable.getChild('hasParentKeyword');
    if (
      !startSpanRefColumn ||
      !endSpanRefColumn ||
      !waitModeCodeColumn ||
      !waitTimeMsColumn ||
      !keywordFlagsColumn ||
      !keywordsColumn
    ) {
      throw new Error('Expected dense numeric dependency columns.');
    }
    const expectedDependencyRefs = graph.getSameProcessDependencyRefs(processRef);
    const startSpanRefGetSpy = vi.spyOn(startSpanRefColumn, 'get');
    const endSpanRefGetSpy = vi.spyOn(endSpanRefColumn, 'get');
    const waitModeCodeGetSpy = vi.spyOn(waitModeCodeColumn, 'get');
    const waitTimeMsGetSpy = vi.spyOn(waitTimeMsColumn, 'get');
    const keywordFlagsGetSpy = vi.spyOn(keywordFlagsColumn, 'get');
    const keywordsGetSpy = vi.spyOn(keywordsColumn, 'get');
    const processRefGetSpy = vi.spyOn(endpointPage.processRefColumn, 'get');
    const threadRefGetSpy = vi.spyOn(endpointPage.threadRefColumn, 'get');
    const statusCodeGetSpy = vi.spyOn(endpointPage.statusCodeColumn, 'get');
    const startTimeMsGetSpy = vi.spyOn(endpointPage.startTimeMsColumn, 'get');
    const endTimeMsGetSpy = vi.spyOn(endpointPage.endTimeMsColumn, 'get');
    const trustedEndpointBindSpy = vi.spyOn(
      traceArrowEndpointPages,
      'bindTraceArrowTrustedPrimaryEndpointCursorRow'
    );

    const denseDependencyRefs = buildTraceDenseSameProcessDependencyRefSource(
      0,
      expectedDependencyRefs.length
    );
    const denseArrowData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: denseDependencyRefs,
      traceLayout: layout,
      endpointPages,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });

    expect(startSpanRefColumn.data).toHaveLength(2);
    expect(endSpanRefColumn.data).toHaveLength(2);
    expect(waitModeCodeColumn.data).toHaveLength(2);
    expect(waitTimeMsColumn.data).toHaveLength(2);
    expect(keywordFlagsColumn.data).toHaveLength(2);
    expect(endpointPage.fixedWidthBatches).toHaveLength(2);
    expect(waitModeColumn).toBeNull();
    expect(hasParentKeywordColumn).toBeNull();
    expect(Array.from(denseDependencyRefs)).toEqual(expectedDependencyRefs);
    expect(denseArrowData.data.length).toBe(expectedDependencyRefs.length);
    expect(startSpanRefGetSpy).not.toHaveBeenCalled();
    expect(endSpanRefGetSpy).not.toHaveBeenCalled();
    expect(waitModeCodeGetSpy).not.toHaveBeenCalled();
    expect(waitTimeMsGetSpy).not.toHaveBeenCalled();
    expect(keywordFlagsGetSpy).not.toHaveBeenCalled();
    expect(keywordsGetSpy).not.toHaveBeenCalled();
    expect(processRefGetSpy).not.toHaveBeenCalled();
    expect(threadRefGetSpy).not.toHaveBeenCalled();
    expect(statusCodeGetSpy).not.toHaveBeenCalled();
    expect(startTimeMsGetSpy).not.toHaveBeenCalled();
    expect(endTimeMsGetSpy).not.toHaveBeenCalled();
    expect(trustedEndpointBindSpy).toHaveBeenCalledTimes(4);

    const genericData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: Array.from(
        graph.iterateVisibleSameProcessDependencyRefsByProcess(processRef)
      ),
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    expect(getBinaryAttributeValues(denseArrowData, 'getSourcePosition')).toEqual(
      getBinaryAttributeValues(genericData, 'getSourcePosition')
    );
    expect(getBinaryAttributeValues(denseArrowData, 'getTargetPosition')).toEqual(
      getBinaryAttributeValues(genericData, 'getTargetPosition')
    );
    expect(getBinaryAttributeValues(denseArrowData, 'getColor')).toEqual(
      getBinaryAttributeValues(genericData, 'getColor')
    );
    startSpanRefGetSpy.mockRestore();
    endSpanRefGetSpy.mockRestore();
    waitModeCodeGetSpy.mockRestore();
    waitTimeMsGetSpy.mockRestore();
    keywordFlagsGetSpy.mockRestore();
    keywordsGetSpy.mockRestore();
    processRefGetSpy.mockRestore();
    threadRefGetSpy.mockRestore();
    statusCodeGetSpy.mockRestore();
    startTimeMsGetSpy.mockRestore();
    endTimeMsGetSpy.mockRestore();
    trustedEndpointBindSpy.mockRestore();
  });

  it('keeps the scalar dense fallback when numeric Arrow batches are unsupported', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-arrow-dense-dependency-fixed-width-fallback',
      processCount: 1,
      rowCount: 8,
      threadsPerProcess: 1
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-arrow-dense-dependency-fixed-width-fallback',
      ...fixture.materializationInputs
    });
    const layout = buildTraceLayout({
      traceGraph: new TraceGraph({traceDataset, traceStore: fixture.traceStore}),
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const processId = layout.traceGraph.processIdsByIndex[0];
    const dependencyTable = processId
      ? layout.traceGraph.sameProcessDependencyTableMap[processId]
      : null;
    if (!dependencyTable) {
      throw new Error('Expected one synthetic dependency table.');
    }
    const endpointPages = buildTraceArrowPrimaryEndpointPages(layout);
    if (!endpointPages) {
      throw new Error('Expected generated-primary endpoint pages.');
    }
    const denseDependencyRefs = buildTraceDenseSameProcessDependencyRefSource(
      0,
      dependencyTable.numRows
    );
    const nativeData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: denseDependencyRefs,
      traceLayout: layout,
      endpointPages,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const originalGetChild = dependencyTable.getChild.bind(dependencyTable);
    const originalStartSpanRefColumn = originalGetChild('startSpanRef');
    if (!originalStartSpanRefColumn) {
      throw new Error('Expected one source span-ref column.');
    }
    const scalarStartSpanRefGet = vi.fn((rowIndex: number) =>
      originalStartSpanRefColumn.get(rowIndex)
    );
    const getChildSpy = vi.spyOn(dependencyTable, 'getChild').mockImplementation(name => {
      const column = originalGetChild(name);
      return name === 'startSpanRef' && column
        ? ({get: scalarStartSpanRefGet, data: []} as never)
        : column;
    });

    const fallbackData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: denseDependencyRefs,
      traceLayout: layout,
      endpointPages,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });

    expect(scalarStartSpanRefGet).toHaveBeenCalledWith(0);
    expect(scalarStartSpanRefGet).toHaveBeenCalledWith(dependencyTable.numRows - 1);
    expect(getBinaryAttributeValues(fallbackData!, 'getSourcePosition')).toEqual(
      getBinaryAttributeValues(nativeData!, 'getSourcePosition')
    );
    expect(getBinaryAttributeValues(fallbackData!, 'getTargetPosition')).toEqual(
      getBinaryAttributeValues(nativeData!, 'getTargetPosition')
    );
    expect(getBinaryAttributeValues(fallbackData!, 'getColor')).toEqual(
      getBinaryAttributeValues(nativeData!, 'getColor')
    );
    getChildSpy.mockRestore();
  });

  it('streams collapsed primary endpoints without broad span geometry accessors', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-arrow-collapsed-dependency-parity',
      processCount: 1,
      rowCount: 8,
      threadsPerProcess: 1
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-arrow-collapsed-dependency-parity',
      ...fixture.materializationInputs
    });
    const graph = new TraceGraph({traceDataset, traceStore: fixture.traceStore});
    const processRef = graph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected one synthetic process ref.');
    }
    const layout = buildTraceLayout({
      traceGraph: graph,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      collapseState: {
        graphs: [
          {
            collapsedProcessRefs: new Set([processRef]),
            collapsedThreadRefs: new Set(),
            expandedThreadRefs: new Set()
          }
        ]
      }
    });
    const sourceDependencyRefs = graph.getSameProcessDependencyRefs(processRef);
    const visibleDependencyRefs = Array.from(
      graph.iterateVisibleSameProcessDependencyRefsByProcess(processRef)
    );
    const geometrySourceSpy = vi.spyOn(graph, 'getSpanGeometrySource');

    const arrowNativeData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: sourceDependencyRefs,
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    expect(geometrySourceSpy).not.toHaveBeenCalled();

    const genericData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: visibleDependencyRefs,
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    expect(geometrySourceSpy).not.toHaveBeenCalled();
    expect(getBinaryAttributeValues(arrowNativeData, 'getSourcePosition')).toEqual(
      getBinaryAttributeValues(genericData, 'getSourcePosition')
    );
    expect(getBinaryAttributeValues(arrowNativeData, 'getTargetPosition')).toEqual(
      getBinaryAttributeValues(genericData, 'getTargetPosition')
    );
    expect(getBinaryAttributeValues(arrowNativeData, 'getColor')).toEqual(
      getBinaryAttributeValues(genericData, 'getColor')
    );
    geometrySourceSpy.mockRestore();
  });

  it('derives dense dependency refs from sparse process slots', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-arrow-sparse-dependency-slots',
      processCount: 2,
      rowCount: 8,
      threadsPerProcess: 1
    });
    const selection = fixture.traceStore.select({
      window: {startTimeMs: 6, endTimeMs: 9},
      spanBudget: null
    });
    const selectedInputs: (typeof fixture.materializationInputs)[] = [];
    fixture.traceStore.withReadyChunks(selection, ({ownerRefRegistry, readyChunks}) => {
      selectedInputs.push({ownerRefRegistry, readyChunks});
      return null;
    });
    const materializationInputs = selectedInputs[0];
    if (!materializationInputs) {
      throw new Error('Expected selected synthetic trace inputs.');
    }
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-arrow-sparse-dependency-slots',
      ...materializationInputs
    });
    const traceGraph = new TraceGraph({traceDataset, traceStore: fixture.traceStore});
    const layout = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    })[0];
    if (!layout) {
      throw new Error('Expected one sparse synthetic trace layout.');
    }
    const graph = layout.traceGraph;
    const sparseProcessRef = encodeProcessRef(1);
    expect(graph.getVisibleProcessRefs()).toEqual([sparseProcessRef]);
    expect(graph.processIdsByIndex[0]).toBe('synthetic-process-0');
    expect(graph.processIdsByIndex[1]).toBe('synthetic-process-1');
    const endpointPages = buildTraceArrowPrimaryEndpointPages(layout);
    if (!endpointPages) {
      throw new Error('Expected generated-primary endpoint pages.');
    }

    const expectedDependencyRefs = graph.getSameProcessDependencyRefs(sparseProcessRef);
    const denseDependencyRefs = buildTraceDenseSameProcessDependencyRefSource(
      1,
      expectedDependencyRefs.length
    );
    const denseArrowData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: denseDependencyRefs,
      traceLayout: layout,
      endpointPages,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });

    expect(Array.from(denseDependencyRefs)).toEqual(expectedDependencyRefs);
    expect(denseArrowData.data.length).toBe(expectedDependencyRefs.length);
  });

  it('falls back per malformed sliced dense row without abandoning prior Arrow rows', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-arrow-dense-dependency-late-fallback',
      processCount: 1,
      rowCount: 8,
      threadsPerProcess: 1
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-arrow-dense-dependency-late-fallback',
      ...fixture.materializationInputs
    });
    const processId = traceDataset.ownerRefSnapshot.processIdsByIndex[0];
    if (processId == null) {
      throw new Error('Expected one synthetic process id.');
    }
    const dependencyCount = fixture.summary.sameProcessDependencyCount;
    const sourceDependencyTable = buildDenseDependencyTableForRows(
      [0, ...Array.from({length: dependencyCount}, (_, rowIndex) => rowIndex)],
      dependencyCount - 1
    );
    const dependencyTable = sourceDependencyTable.slice(
      1,
      dependencyCount + 1
    ) as typeof sourceDependencyTable;
    const startSpanRefColumn = dependencyTable.getChild('startSpanRef');
    if (!startSpanRefColumn) {
      throw new Error('Expected one sliced source span-ref column.');
    }
    const layout = buildTraceLayout({
      traceGraph: createRawTestTraceGraph({
        ...traceDataset,
        sameProcessDependencyTableMap: {
          ...traceDataset.sameProcessDependencyTableMap,
          [processId]: dependencyTable
        }
      }),
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const graph = layout.traceGraph;
    const processRef = graph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected one synthetic process ref.');
    }
    const endpointPages = buildTraceArrowPrimaryEndpointPages(layout);
    if (!endpointPages) {
      throw new Error('Expected generated-primary endpoint pages.');
    }
    const sourceDependencyRefs = graph.getSameProcessDependencyRefs(processRef);

    const denseDependencyRefs = buildTraceDenseSameProcessDependencyRefSource(
      0,
      sourceDependencyRefs.length
    );
    const denseArrowData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: denseDependencyRefs,
      traceLayout: layout,
      endpointPages,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    expect(startSpanRefColumn.data[0]?.offset).toBe(1);
    const arrowNativeData = buildTraceDeckBinaryDependencyLineData({
      dependencyRefs: sourceDependencyRefs,
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });

    expect(Array.from(denseDependencyRefs)).toEqual(sourceDependencyRefs);
    expect(getBinaryAttributeValues(denseArrowData!, 'getSourcePosition')).toEqual(
      getBinaryAttributeValues(arrowNativeData, 'getSourcePosition')
    );
    expect(getBinaryAttributeValues(denseArrowData!, 'getTargetPosition')).toEqual(
      getBinaryAttributeValues(arrowNativeData, 'getTargetPosition')
    );
    expect(getBinaryAttributeValues(denseArrowData!, 'getColor')).toEqual(
      getBinaryAttributeValues(arrowNativeData, 'getColor')
    );
  });

  it('does not build endpoint pages for empty dense dependency tables', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-arrow-empty-dependency-table',
      processCount: 1,
      rowCount: 1,
      threadsPerProcess: 1
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-arrow-empty-dependency-table',
      ...fixture.materializationInputs
    });
    const layout = buildTraceLayout({
      traceGraph: new TraceGraph({traceDataset, traceStore: fixture.traceStore}),
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const graph = layout.traceGraph;
    const spanTable = graph.chunks[0]?.spanTable;
    if (!spanTable) {
      throw new Error('Expected one synthetic span table.');
    }
    const getChildSpy = vi.spyOn(spanTable, 'getChild');

    const rows = buildTracePreparedProcessRows({
      graph,
      layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      includeSpans: false,
      includeOverflowLabels: false
    });

    expect(rows[0]?.binaryDependencyLineData?.dependencies).toEqual([]);
    expect(rows[0]).not.toHaveProperty('dependencies');
    expect(getChildSpy).not.toHaveBeenCalled();
    getChildSpy.mockRestore();
  });
});

describe('buildTraceDeckBinaryBlockData', () => {
  it('streams trusted dense block rows without packed refs or scalar endpoint reads', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-trusted-dense-block-rows',
      processCount: 1,
      rowCount: 8,
      threadsPerProcess: 2
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-trusted-dense-block-rows',
      ...fixture.materializationInputs
    });
    const graph = new TraceGraph({traceDataset, traceStore: fixture.traceStore});
    const layout = buildTraceLayout({
      traceGraph: graph,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const processRef = graph.getProcessRefs()[0];
    const geometryContext = buildTraceLayoutGeometryDerivationContext(layout);
    const threadLayoutGetSpy = vi.spyOn(geometryContext.layoutLookup.threadLayoutsByRef, 'get');
    const endpointPages = buildTraceArrowPrimaryEndpointPages(layout);
    const endpointPage = endpointPages?.pagesByChunkIndex.get(0);
    if (processRef == null || !endpointPages || !endpointPage) {
      throw new Error('Expected one trusted dense block layout.');
    }

    const denseSpanSource = buildTraceDenseSpanRefSource([
      {chunkIndex: 0, rowStart: 0, rowCount: fixture.summary.spanCount}
    ]);
    const denseAtSpy = vi.fn(denseSpanSource.at.bind(denseSpanSource));
    const endpointPageGetSpy = vi.spyOn(endpointPages.pagesByChunkIndex, 'get');
    const processRefGetSpy = vi.spyOn(endpointPage.processRefColumn, 'get');
    const threadRefGetSpy = vi.spyOn(endpointPage.threadRefColumn, 'get');
    const statusCodeGetSpy = vi.spyOn(endpointPage.statusCodeColumn, 'get');
    const startTimeMsGetSpy = vi.spyOn(endpointPage.startTimeMsColumn, 'get');
    const endTimeMsGetSpy = vi.spyOn(endpointPage.endTimeMsColumn, 'get');
    const trustedData = buildTraceDeckBinaryBlockData({
      spans: {...denseSpanSource, at: denseAtSpy},
      processName: graph.processes[0]?.name ?? '',
      traceLayout: layout,
      geometryContext,
      endpointPages,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      colorScheme: PROCESS_TRACE_COLOR_SCHEME
    });

    expect(denseAtSpy).not.toHaveBeenCalled();
    expect(processRefGetSpy).not.toHaveBeenCalled();
    expect(threadRefGetSpy).not.toHaveBeenCalled();
    expect(statusCodeGetSpy).not.toHaveBeenCalled();
    expect(startTimeMsGetSpy).not.toHaveBeenCalled();
    expect(endTimeMsGetSpy).not.toHaveBeenCalled();
    expect(threadLayoutGetSpy).not.toHaveBeenCalled();
    expect(endpointPageGetSpy).not.toHaveBeenCalled();
    threadLayoutGetSpy.mockRestore();

    const checkedArrowData = buildTraceDeckBinaryBlockData({
      spans: Array.from(denseSpanSource),
      processName: graph.processes[0]?.name ?? '',
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      colorScheme: PROCESS_TRACE_COLOR_SCHEME
    });
    const positions = getBinaryAttributeValues(trustedData, 'getPosition');

    expect(positions).toEqual(getBinaryAttributeValues(checkedArrowData, 'getPosition'));
    expect(getBinaryAttributeValues(trustedData, 'getSize')).toEqual(
      getBinaryAttributeValues(checkedArrowData, 'getSize')
    );
    expect(getBinaryAttributeValues(trustedData, 'getFillColor')).toEqual(
      getBinaryAttributeValues(checkedArrowData, 'getFillColor')
    );
    expect(getBinaryAttributeValues(trustedData, 'getLineColor')).toEqual(
      getBinaryAttributeValues(checkedArrowData, 'getLineColor')
    );
    expect(positions.filter((_, index) => index % 3 === 2)).toEqual(
      Array(fixture.summary.spanCount).fill(0)
    );

    const shortSpanSettings = {
      ...TRACE_PREPARED_SCENE_TEST_SETTINGS,
      minSpanTimeMs: 100
    };
    const trustedShortSpanData = buildTraceDeckBinaryBlockData({
      spans: denseSpanSource,
      processName: graph.processes[0]?.name ?? '',
      traceLayout: layout,
      endpointPages,
      settings: shortSpanSettings,
      colorScheme: PROCESS_TRACE_COLOR_SCHEME
    });
    const checkedShortSpanData = buildTraceDeckBinaryBlockData({
      spans: Array.from(denseSpanSource),
      processName: graph.processes[0]?.name ?? '',
      traceLayout: layout,
      settings: shortSpanSettings,
      colorScheme: PROCESS_TRACE_COLOR_SCHEME
    });
    expect(getBinaryAttributeValues(trustedShortSpanData, 'getFillColor')).toEqual(
      getBinaryAttributeValues(checkedShortSpanData, 'getFillColor')
    );
    expect(getBinaryAttributeValues(trustedShortSpanData, 'getLineColor')).toEqual(
      getBinaryAttributeValues(checkedShortSpanData, 'getLineColor')
    );

    processRefGetSpy.mockRestore();
    endpointPageGetSpy.mockRestore();
    threadRefGetSpy.mockRestore();
    statusCodeGetSpy.mockRestore();
    startTimeMsGetSpy.mockRestore();
    endTimeMsGetSpy.mockRestore();
  });

  it('keeps dense prepared span rows range-backed without visible-ref arrays', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-dense-span-ranges',
      processCount: 1,
      rowCount: 8,
      threadsPerProcess: 2
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-dense-span-ranges',
      ...fixture.materializationInputs
    });
    const layout = buildTraceLayout({
      traceGraph: new TraceGraph({traceDataset, traceStore: fixture.traceStore}),
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const graph = layout.traceGraph;
    const visibleSpanRefsSpy = vi.spyOn(graph, 'iterateVisibleSpanRefsByProcess');

    const rows = buildTracePreparedProcessRows({
      graph,
      layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      includeDependencies: false,
      includeOverflowLabels: false,
      colorScheme: PROCESS_TRACE_COLOR_SCHEME
    });
    const binaryBlockData = rows[0]?.binaryBlockData;
    const source = binaryBlockData?.spans;
    if (!source || !binaryBlockData) {
      throw new Error('Expected one prepared dense span row.');
    }
    const expectedSpanRefs = Array.from({length: fixture.summary.spanCount}, (_, rowIndex) =>
      encodeSpanRef(0, rowIndex)
    );

    expect(source.denseRanges).toEqual([
      {
        chunkIndex: 0,
        rowStart: 0,
        rowCount: fixture.summary.spanCount,
        outputStart: 0
      }
    ]);
    expect(source.length).toBe(expectedSpanRefs.length);
    expect(source.at(0)).toBe(expectedSpanRefs[0]);
    expect(source.at(expectedSpanRefs.length - 1)).toBe(expectedSpanRefs.at(-1));
    expect(Array.from(source)).toEqual(Array.from(expectedSpanRefs));
    expect(rows[0]).not.toHaveProperty('spans');
    expect(visibleSpanRefsSpy).not.toHaveBeenCalled();
    const arrayData = buildTraceDeckBinaryBlockData({
      spans: expectedSpanRefs,
      processName: graph.processes[0]?.name ?? '',
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      colorScheme: PROCESS_TRACE_COLOR_SCHEME
    });
    expect(getBinaryAttributeValues(binaryBlockData, 'getPosition')).toEqual(
      getBinaryAttributeValues(arrayData, 'getPosition')
    );
    expect(getBinaryAttributeValues(binaryBlockData, 'getSize')).toEqual(
      getBinaryAttributeValues(arrayData, 'getSize')
    );
    expect(getBinaryAttributeValues(binaryBlockData, 'getFillColor')).toEqual(
      getBinaryAttributeValues(arrayData, 'getFillColor')
    );
    expect(getBinaryAttributeValues(binaryBlockData, 'getLineColor')).toEqual(
      getBinaryAttributeValues(arrayData, 'getLineColor')
    );

    visibleSpanRefsSpy.mockRestore();
  });

  it('borrows text-filter snapshot masks for dense prepared span rows', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-dense-text-filter-mask',
      processCount: 1,
      rowCount: 8,
      threadsPerProcess: 2,
      textFilterMatchEvery: 2
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-dense-text-filter-mask',
      ...fixture.materializationInputs
    });
    const snapshot = buildTraceViewSnapshot(traceDataset, {
      spanFilters: [SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME]
    });
    const graph = new TraceGraph({traceDataset, traceStore: fixture.traceStore}, snapshot);
    const layout = buildTraceLayout({
      traceGraph: graph,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const visibleSpanRefsSpy = vi.spyOn(graph, 'iterateVisibleSpanRefsByProcess');
    const geometryContext = buildTraceLayoutGeometryDerivationContext(layout);
    const threadLayoutGetSpy = vi.spyOn(geometryContext.layoutLookup.threadLayoutsByRef, 'get');
    const endpointPages = buildTraceArrowPrimaryEndpointPages(layout, {
      allowRowLocalSnapshotFilters: true
    });
    const endpointPage = endpointPages?.pagesByChunkIndex.get(0);
    if (!endpointPages || !endpointPage) {
      throw new Error('Expected one masked dense endpoint page.');
    }
    const endpointPageGetSpy = vi.spyOn(endpointPages.pagesByChunkIndex, 'get');
    const processRefGetSpy = vi.spyOn(endpointPage.processRefColumn, 'get');
    const threadRefGetSpy = vi.spyOn(endpointPage.threadRefColumn, 'get');
    const statusCodeGetSpy = vi.spyOn(endpointPage.statusCodeColumn, 'get');
    const startTimeMsGetSpy = vi.spyOn(endpointPage.startTimeMsColumn, 'get');
    const endTimeMsGetSpy = vi.spyOn(endpointPage.endTimeMsColumn, 'get');

    const rows = buildTracePreparedProcessRows({
      graph,
      layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      includeDependencies: false,
      includeOverflowLabels: false,
      colorScheme: PROCESS_TRACE_COLOR_SCHEME
    });
    const source = rows[0]?.binaryBlockData?.spans;
    const filterMaskByRow = snapshot.chunks[0]?.filterMaskByRow;
    if (!source || !filterMaskByRow) {
      throw new Error('Expected one masked dense prepared span row.');
    }

    const expectedSpanRefs = [1, 3, 5, 7].map(rowIndex => encodeSpanRef(0, rowIndex));
    expect(Array.isArray(source)).toBe(false);
    expect(source.denseRanges).toEqual([
      {
        chunkIndex: 0,
        rowStart: 0,
        rowCount: fixture.summary.spanCount,
        outputStart: 0,
        visibleRowCount: expectedSpanRefs.length,
        filterMaskByRow
      }
    ]);
    expect(source.denseRanges?.[0]?.filterMaskByRow).toBe(filterMaskByRow);
    expect(source.length).toBe(expectedSpanRefs.length);
    expect(source.at(0)).toBe(expectedSpanRefs[0]);
    expect(source.at(expectedSpanRefs.length - 1)).toBe(expectedSpanRefs.at(-1));
    expect(Array.from(source)).toEqual(Array.from(expectedSpanRefs));
    expect(visibleSpanRefsSpy).not.toHaveBeenCalled();

    const denseAtSpy = vi.fn(source.at.bind(source));
    const maskedDenseData = buildTraceDeckBinaryBlockData({
      spans: {...source, at: denseAtSpy},
      processName: graph.processes[0]?.name ?? '',
      traceLayout: layout,
      geometryContext,
      endpointPages,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      colorScheme: PROCESS_TRACE_COLOR_SCHEME
    });
    expect(denseAtSpy).not.toHaveBeenCalled();
    expect(processRefGetSpy).not.toHaveBeenCalled();
    expect(threadRefGetSpy).not.toHaveBeenCalled();
    expect(statusCodeGetSpy).not.toHaveBeenCalled();
    expect(startTimeMsGetSpy).not.toHaveBeenCalled();
    expect(endTimeMsGetSpy).not.toHaveBeenCalled();
    expect(threadLayoutGetSpy).not.toHaveBeenCalled();
    expect(endpointPageGetSpy).not.toHaveBeenCalled();

    const arrayData = buildTraceDeckBinaryBlockData({
      spans: expectedSpanRefs,
      processName: graph.processes[0]?.name ?? '',
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      colorScheme: PROCESS_TRACE_COLOR_SCHEME
    });

    expect(getBinaryAttributeValues(maskedDenseData, 'getPosition')).toEqual(
      getBinaryAttributeValues(arrayData, 'getPosition')
    );
    expect(getBinaryAttributeValues(maskedDenseData, 'getSize')).toEqual(
      getBinaryAttributeValues(arrayData, 'getSize')
    );
    expect(getBinaryAttributeValues(maskedDenseData, 'getFillColor')).toEqual(
      getBinaryAttributeValues(arrayData, 'getFillColor')
    );
    expect(getBinaryAttributeValues(maskedDenseData, 'getLineColor')).toEqual(
      getBinaryAttributeValues(arrayData, 'getLineColor')
    );
    threadLayoutGetSpy.mockRestore();
    endpointPageGetSpy.mockRestore();
    processRefGetSpy.mockRestore();
    threadRefGetSpy.mockRestore();
    statusCodeGetSpy.mockRestore();
    startTimeMsGetSpy.mockRestore();
    endTimeMsGetSpy.mockRestore();
    visibleSpanRefsSpy.mockRestore();
  });

  it('keeps multi-chunk dense rows in canonical span-ref order', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-dense-span-multi-chunk-order',
      processCount: 1,
      rowCount: 8,
      threadsPerProcess: 2
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-dense-span-multi-chunk-order',
      ...fixture.materializationInputs
    });
    const sourceChunk = traceDataset.chunks[0];
    const processId = traceDataset.ownerRefSnapshot.processIdsByIndex[0];
    if (!sourceChunk || processId == null) {
      throw new Error('Expected one synthetic process chunk.');
    }
    const emptyDependencyTable = sourceChunk.resolvedSameProcessDependencyTable.slice(
      0,
      0
    ) as typeof sourceChunk.resolvedSameProcessDependencyTable;
    const firstChunk = {
      ...sourceChunk,
      chunkIndex: 0,
      chunkRef: encodeChunkRef(0),
      chunkKey: sourceChunk.chunkKey + ':first',
      spanTable: sourceChunk.spanTable.slice(3, 8) as typeof sourceChunk.spanTable,
      resolvedSameProcessDependencyTable: emptyDependencyTable
    };
    const secondChunk = {
      ...sourceChunk,
      chunkIndex: 1,
      chunkRef: encodeChunkRef(1),
      chunkKey: sourceChunk.chunkKey + ':second',
      spanTable: sourceChunk.spanTable.slice(0, 3) as typeof sourceChunk.spanTable,
      resolvedSameProcessDependencyTable: emptyDependencyTable
    };
    const chunks = [firstChunk, secondChunk];
    const graph = createRawTestTraceGraph({
      ...traceDataset,
      chunks,
      processSpanTableMap: buildTraceProcessSpanRefTables(chunks, traceDataset.processes, {
        processIdsByIndex: traceDataset.ownerRefSnapshot.processIdsByIndex
      }),
      sameProcessDependencyTableMap: {
        ...traceDataset.sameProcessDependencyTableMap,
        [processId]: emptyDependencyTable
      }
    });
    const layout = buildTraceLayout({
      traceGraph: graph,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const processRef = graph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected one synthetic process ref.');
    }
    const expectedSpanRefs = Array.from(graph.iterateVisibleSpanRefsByProcess(processRef));

    const rows = buildTracePreparedProcessRows({
      graph,
      layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      includeDependencies: false,
      includeOverflowLabels: false,
      colorScheme: PROCESS_TRACE_COLOR_SCHEME
    });
    const source = rows[0]?.binaryBlockData?.spans;
    if (!source) {
      throw new Error('Expected one prepared dense span row.');
    }

    expect(source.denseRanges).toEqual([
      {chunkIndex: 0, rowStart: 0, rowCount: 5, outputStart: 0},
      {chunkIndex: 1, rowStart: 0, rowCount: 3, outputStart: 5}
    ]);
    expect(Array.from(source)).toEqual(Array.from(expectedSpanRefs));
    expect(Array.from(source)).toEqual([
      ...Array.from({length: 5}, (_, rowIndex) => encodeSpanRef(0, rowIndex)),
      ...Array.from({length: 3}, (_, rowIndex) => encodeSpanRef(1, rowIndex))
    ]);
  });

  it('falls back when a process-local span table is a sparse subset of its chunk rows', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-dense-span-sparse-fallback',
      processCount: 1,
      rowCount: 8,
      threadsPerProcess: 2
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-dense-span-sparse-fallback',
      ...fixture.materializationInputs
    });
    const processId = traceDataset.ownerRefSnapshot.processIdsByIndex[0];
    const processSpanTable = processId ? traceDataset.processSpanTableMap[processId] : undefined;
    if (processId == null || !processSpanTable) {
      throw new Error('Expected one synthetic process span table.');
    }
    const graph = createRawTestTraceGraph({
      ...traceDataset,
      processSpanTableMap: {
        ...traceDataset.processSpanTableMap,
        [processId]: processSpanTable.slice(0, processSpanTable.numRows - 1)
      }
    });
    const layout = buildTraceLayout({
      traceGraph: graph,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const processRef = graph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected one synthetic process ref.');
    }
    const visibleSpanRefsSpy = vi.spyOn(graph, 'iterateVisibleSpanRefsByProcess');

    const rows = buildTracePreparedProcessRows({
      graph,
      layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      includeDependencies: false,
      includeOverflowLabels: false,
      colorScheme: PROCESS_TRACE_COLOR_SCHEME
    });
    const source = rows[0]?.binaryBlockData?.spans;
    if (!source) {
      throw new Error('Expected one prepared sparse-fallback span row.');
    }

    expect(source.denseRanges).toBeUndefined();
    expect(Array.from(source)).toEqual(
      Array.from(graph.iterateVisibleSpanRefsByProcess(processRef))
    );
    expect(visibleSpanRefsSpy).toHaveBeenCalled();
    visibleSpanRefsSpy.mockRestore();
  });

  it('keeps primary Arrow block streaming enabled when secondary timing sidecars exist', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-arrow-block-secondary-sidecars',
      processCount: 1,
      rowCount: 6,
      threadsPerProcess: 2
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-arrow-block-secondary-sidecars',
      ...fixture.materializationInputs
    });
    const processId = traceDataset.processes[0]?.processId;
    if (processId == null) {
      throw new Error('Expected one synthetic process id.');
    }
    const sidecarTable = buildArrowTraceSpanSidecarTableFromColumns({
      rowCount: fixture.summary.spanCount,
      timings: {
        secondary: {
          statusCode: Array(fixture.summary.spanCount).fill(2),
          startTimeMs: Array.from({length: fixture.summary.spanCount}, (_, index) => index + 10),
          endTimeMs: Array.from({length: fixture.summary.spanCount}, (_, index) => index + 11),
          durationMs: Array(fixture.summary.spanCount).fill(1)
        }
      }
    });
    const traceDatasetWithSidecars = {
      ...traceDataset,
      spanSidecarTableMap: {
        ...(traceDataset.spanSidecarTableMap ?? {}),
        [processId]: sidecarTable
      },
      chunks: traceDataset.chunks.map(chunk =>
        chunk.processId === processId ? {...chunk, spanSidecarTable: sidecarTable} : chunk
      )
    };
    const layout = buildTraceLayout({
      traceGraph: createRawTestTraceGraph(traceDatasetWithSidecars),
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const graph = layout.traceGraph;
    const processRef = graph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected one synthetic process ref.');
    }
    const geometrySourceSpy = vi.spyOn(graph, 'getSpanGeometrySource');

    buildTraceDeckBinaryBlockData({
      spans: Array.from(graph.iterateVisibleSpanRefsByProcess(processRef)),
      processName: graph.processes[0]?.name ?? '',
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });

    expect(sidecarTable.getChild('timings')).not.toBeNull();
    expect(geometrySourceSpy).not.toHaveBeenCalled();
    geometrySourceSpy.mockRestore();
  });

  it('streams unfiltered primary Arrow rows without broad geometry sources', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-arrow-block-parity',
      processCount: 2,
      rowCount: 12,
      threadsPerProcess: 2
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-arrow-block-parity',
      ...fixture.materializationInputs
    });
    const layout = buildTraceLayout({
      traceGraph: new TraceGraph({traceDataset, traceStore: fixture.traceStore}),
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const graph = layout.traceGraph;
    const processRef = graph.getProcessRefs()[1];
    if (processRef == null) {
      throw new Error('Expected a second synthetic process ref.');
    }
    const spanRefs = Array.from(graph.iterateVisibleSpanRefsByProcess(processRef));
    const spanTable = graph.chunks.find(
      chunk => chunk.processId === graph.processIdsByIndex[1]
    )?.spanTable;
    const processRefColumn = spanTable?.getChild('process_ref');
    const threadRefColumn = spanTable?.getChild('thread_ref');
    const statusCodeColumn = spanTable?.getChild('status_code');
    const startTimeMsColumn = spanTable?.getChild('start_time_ms');
    const endTimeMsColumn = spanTable?.getChild('end_time_ms');
    if (
      !processRefColumn ||
      !threadRefColumn ||
      !statusCodeColumn ||
      !startTimeMsColumn ||
      !endTimeMsColumn
    ) {
      throw new Error('Expected canonical fixed-width span columns.');
    }
    const processRefGetSpy = vi.spyOn(processRefColumn, 'get');
    const threadRefGetSpy = vi.spyOn(threadRefColumn, 'get');
    const statusCodeGetSpy = vi.spyOn(statusCodeColumn, 'get');
    const startTimeMsGetSpy = vi.spyOn(startTimeMsColumn, 'get');
    const endTimeMsGetSpy = vi.spyOn(endTimeMsColumn, 'get');
    const geometrySourceSpy = vi.spyOn(graph, 'getSpanGeometrySource');
    const startTimeSpy = vi.spyOn(graph, 'getSpanStartTimeMs');
    const endTimeSpy = vi.spyOn(graph, 'getSpanEndTimeMs');

    const arrowNativeData = buildTraceDeckBinaryBlockData({
      spans: spanRefs,
      processName: graph.processes[1]?.name ?? '',
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    expect(geometrySourceSpy).not.toHaveBeenCalled();
    expect(startTimeSpy).not.toHaveBeenCalled();
    expect(endTimeSpy).not.toHaveBeenCalled();
    expect(processRefGetSpy).not.toHaveBeenCalled();
    expect(threadRefGetSpy).not.toHaveBeenCalled();
    expect(statusCodeGetSpy).not.toHaveBeenCalled();
    expect(startTimeMsGetSpy).not.toHaveBeenCalled();
    expect(endTimeMsGetSpy).not.toHaveBeenCalled();

    const activeFilterSpy = vi.spyOn(graph, 'hasActiveSpanFilter').mockReturnValue(true);
    const genericData = buildTraceDeckBinaryBlockData({
      spans: spanRefs,
      processName: graph.processes[1]?.name ?? '',
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    expect(geometrySourceSpy).toHaveBeenCalled();
    expect(startTimeSpy).toHaveBeenCalled();
    expect(endTimeSpy).toHaveBeenCalled();
    expect(getBinaryAttributeValues(arrowNativeData, 'getPosition')).toEqual(
      getBinaryAttributeValues(genericData, 'getPosition')
    );
    expect(getBinaryAttributeValues(arrowNativeData, 'getSize')).toEqual(
      getBinaryAttributeValues(genericData, 'getSize')
    );
    expect(getBinaryAttributeValues(arrowNativeData, 'getFillColor')).toEqual(
      getBinaryAttributeValues(genericData, 'getFillColor')
    );
    expect(getBinaryAttributeValues(arrowNativeData, 'getLineColor')).toEqual(
      getBinaryAttributeValues(genericData, 'getLineColor')
    );
    activeFilterSpy.mockRestore();
    processRefGetSpy.mockRestore();
    threadRefGetSpy.mockRestore();
    statusCodeGetSpy.mockRestore();
    startTimeMsGetSpy.mockRestore();
    endTimeMsGetSpy.mockRestore();
    geometrySourceSpy.mockRestore();
    startTimeSpy.mockRestore();
    endTimeSpy.mockRestore();
  });

  it('hoists only exact built-in process colors across layout label overrides', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-process-color-hoist',
      processCount: 1,
      rowCount: 6,
      threadsPerProcess: 2
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-process-color-hoist',
      ...fixture.materializationInputs
    });
    const layout = buildTraceLayout({
      traceGraph: new TraceGraph({traceDataset, traceStore: fixture.traceStore}),
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const graph = layout.traceGraph;
    const processRef = graph.getProcessRefs()[0];
    const processName = graph.processes[0]?.name;
    if (processRef == null || processName == null) {
      throw new Error('Expected one synthetic process row.');
    }
    const spanRefs = Array.from(graph.iterateVisibleSpanRefsByProcess(processRef));
    const labeledLayout = {
      ...layout,
      renderRows: layout.renderRows.map(row => ({...row, name: 'Overridden Row Label'}))
    };
    const rankNameSpy = vi.spyOn(graph, 'getSpanRankName');

    const preparedRows = buildTracePreparedProcessRows({
      graph,
      layout: labeledLayout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      includeDependencies: false,
      includeOverflowLabels: false,
      colorScheme: PROCESS_TRACE_COLOR_SCHEME
    });
    const builtInData = preparedRows[0]?.binaryBlockData;
    if (!builtInData) {
      throw new Error('Expected built-in process binary block data.');
    }
    expect(labeledLayout.renderRows[0]?.name).toBe('Overridden Row Label');
    expect(labeledLayout.renderRows[0]?.name).not.toBe(processName);
    expect(rankNameSpy).not.toHaveBeenCalled();

    rankNameSpy.mockClear();
    const customProcessScheme = {
      ...PROCESS_TRACE_COLOR_SCHEME,
      id: 'custom-process-name'
    } satisfies TraceColorScheme;
    const customData = buildTraceDeckBinaryBlockData({
      spans: spanRefs,
      processName,
      traceLayout: labeledLayout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      colorScheme: customProcessScheme
    });

    expect(rankNameSpy).toHaveBeenCalledTimes(spanRefs.length);
    expect(getBinaryAttributeValues(builtInData, 'getFillColor')).toEqual(
      getBinaryAttributeValues(customData, 'getFillColor')
    );
    expect(getBinaryAttributeValues(builtInData, 'getLineColor')).toEqual(
      getBinaryAttributeValues(customData, 'getLineColor')
    );

    const fadedSettings = {
      ...TRACE_PREPARED_SCENE_TEST_SETTINGS,
      showPathsOnly: true,
      minSpanTimeMs: 2
    } satisfies TraceVisSettings;
    const highlightedSpanRefs = new Set([spanRefs.at(0)!]);
    const fadedBuiltInData = buildTraceDeckBinaryBlockData({
      spans: spanRefs,
      processName,
      traceLayout: labeledLayout,
      settings: fadedSettings,
      colorScheme: PROCESS_TRACE_COLOR_SCHEME,
      highlightedSpanRefs
    });
    const fadedCustomData = buildTraceDeckBinaryBlockData({
      spans: spanRefs,
      processName,
      traceLayout: labeledLayout,
      settings: fadedSettings,
      colorScheme: customProcessScheme,
      highlightedSpanRefs
    });

    expect(getBinaryAttributeValues(fadedBuiltInData, 'getFillColor')).toEqual(
      getBinaryAttributeValues(fadedCustomData, 'getFillColor')
    );
    expect(getBinaryAttributeValues(fadedBuiltInData, 'getLineColor')).toEqual(
      getBinaryAttributeValues(fadedCustomData, 'getLineColor')
    );
    rankNameSpy.mockRestore();
  });

  it('borrows primary block numeric buffers across Arrow record batches', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-arrow-block-fixed-width-batches',
      processCount: 1,
      rowCount: 8,
      threadsPerProcess: 2
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-arrow-block-fixed-width-batches',
      ...fixture.materializationInputs
    });
    const processId = traceDataset.ownerRefSnapshot.processIdsByIndex[0];
    const chunk = traceDataset.chunks[0];
    if (!processId || !chunk) {
      throw new Error('Expected one synthetic process chunk.');
    }
    const splitRowIndex = Math.floor(chunk.spanTable.numRows / 2);
    const splitSpanTable = chunk.spanTable
      .slice(0, splitRowIndex)
      .concat(chunk.spanTable.slice(splitRowIndex)) as typeof chunk.spanTable;
    const layout = buildTraceLayout({
      traceGraph: createRawTestTraceGraph({
        ...traceDataset,
        chunks: traceDataset.chunks.map(candidate =>
          candidate === chunk ? {...candidate, spanTable: splitSpanTable} : candidate
        ),
        processSpanTableMap: {
          ...traceDataset.processSpanTableMap,
          [processId]: splitSpanTable
        }
      }),
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const graph = layout.traceGraph;
    const processRef = graph.getProcessRefs()[0];
    const processRefColumn = splitSpanTable.getChild('process_ref');
    const threadRefColumn = splitSpanTable.getChild('thread_ref');
    const statusCodeColumn = splitSpanTable.getChild('status_code');
    const startTimeMsColumn = splitSpanTable.getChild('start_time_ms');
    const endTimeMsColumn = splitSpanTable.getChild('end_time_ms');
    if (
      processRef == null ||
      !processRefColumn ||
      !threadRefColumn ||
      !statusCodeColumn ||
      !startTimeMsColumn ||
      !endTimeMsColumn
    ) {
      throw new Error('Expected canonical fixed-width span columns.');
    }
    const processRefGetSpy = vi.spyOn(processRefColumn, 'get');
    const threadRefGetSpy = vi.spyOn(threadRefColumn, 'get');
    const statusCodeGetSpy = vi.spyOn(statusCodeColumn, 'get');
    const startTimeMsGetSpy = vi.spyOn(startTimeMsColumn, 'get');
    const endTimeMsGetSpy = vi.spyOn(endTimeMsColumn, 'get');

    buildTraceDeckBinaryBlockData({
      spans: Array.from(graph.iterateVisibleSpanRefsByProcess(processRef)),
      processName: graph.processes[0]?.name ?? '',
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });

    expect(processRefColumn.data).toHaveLength(2);
    expect(threadRefColumn.data).toHaveLength(2);
    expect(statusCodeColumn.data).toHaveLength(2);
    expect(startTimeMsColumn.data).toHaveLength(2);
    expect(endTimeMsColumn.data).toHaveLength(2);
    expect(processRefGetSpy).not.toHaveBeenCalled();
    expect(threadRefGetSpy).not.toHaveBeenCalled();
    expect(statusCodeGetSpy).not.toHaveBeenCalled();
    expect(startTimeMsGetSpy).not.toHaveBeenCalled();
    expect(endTimeMsGetSpy).not.toHaveBeenCalled();
    processRefGetSpy.mockRestore();
    threadRefGetSpy.mockRestore();
    statusCodeGetSpy.mockRestore();
    startTimeMsGetSpy.mockRestore();
    endTimeMsGetSpy.mockRestore();
  });

  it('does not invoke custom block color hooks twice after a malformed late Arrow row', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-arrow-block-late-fallback',
      processCount: 1,
      rowCount: 4,
      threadsPerProcess: 1
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-arrow-block-late-fallback',
      ...fixture.materializationInputs
    });
    const chunk = traceDataset.chunks[0];
    if (!chunk) {
      throw new Error('Expected one synthetic chunk.');
    }
    replaceArrowTraceSpanRefColumns({
      sourceTable: chunk.spanTable,
      processRef: Array(chunk.spanTable.numRows).fill(encodeProcessRef(0)),
      threadRef: Array.from({length: chunk.spanTable.numRows}, (_, rowIndex) =>
        rowIndex === chunk.spanTable.numRows - 1 ? null : encodeProcessThreadRef(0, 0)
      )
    });
    const layout = buildTraceLayout({
      traceGraph: new TraceGraph({traceDataset, traceStore: fixture.traceStore}),
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const graph = layout.traceGraph;
    const processRef = graph.getProcessRefs()[0];
    if (processRef == null) {
      throw new Error('Expected one synthetic process ref.');
    }
    const spanRefs = Array.from(graph.iterateVisibleSpanRefsByProcess(processRef));
    const getSpanStyleForRef = vi.fn(() => ({
      spanFillColor: [12, 34, 56, 255] as TraceDeckColor,
      spanBorderColor: [78, 90, 12, 255] as TraceDeckColor
    }));
    const colorScheme = {
      id: 'late-row-fallback-count',
      name: 'Late Row Fallback Count',
      getSpanStyleForRef
    } satisfies TraceColorScheme;

    buildTraceDeckBinaryBlockData({
      spans: spanRefs,
      processName: graph.processes[0]?.name ?? '',
      traceLayout: layout,
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS,
      colorScheme
    });

    expect(getSpanStyleForRef).toHaveBeenCalledTimes(spanRefs.length);
  });

  it('keeps block colors when Arrow-bound geometry hides a generated thread row', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'prepared-scene-arrow-hidden-block-colors',
      processCount: 1,
      rowCount: 4,
      threadsPerProcess: 1
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'prepared-scene-arrow-hidden-block-colors',
      ...fixture.materializationInputs
    });
    const layout = buildTraceLayout({
      traceGraph: new TraceGraph({traceDataset, traceStore: fixture.traceStore}),
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });
    const graph = layout.traceGraph;
    const processRef = graph.getProcessRefs()[0];
    const threadRef = graph.getThreadRefs()[0];
    const threadLayout = threadRef == null ? null : layout.threadLayoutMapByRef.get(threadRef);
    if (processRef == null || threadRef == null || threadLayout == null) {
      throw new Error('Expected one synthetic process and thread layout.');
    }
    const hiddenThreadLayoutMapByRef = new Map(layout.threadLayoutMapByRef);
    hiddenThreadLayoutMapByRef.set(threadRef, {...threadLayout, visible: false});

    const data = buildTraceDeckBinaryBlockData({
      spans: Array.from(graph.iterateVisibleSpanRefsByProcess(processRef)),
      processName: graph.processes[0]?.name ?? '',
      traceLayout: {
        ...layout,
        threadLayoutMapByRef: hiddenThreadLayoutMapByRef
      },
      settings: TRACE_PREPARED_SCENE_TEST_SETTINGS
    });

    expect(getBinaryAttributeValues(data, 'getPosition')).toEqual(
      Array(data.data.length * 3).fill(0)
    );
    expect(getBinaryAttributeValues(data, 'getSize')).toEqual(Array(data.data.length * 2).fill(0));
    expect(getBinaryAttributeValues(data, 'getFillColor')).not.toEqual(
      Array(data.data.length * 4).fill(0)
    );
    expect(getBinaryAttributeValues(data, 'getLineColor')).not.toEqual(
      Array(data.data.length * 4).fill(0)
    );
  });
});

describe('estimatePreparedLayoutInputsSize', () => {
  it('charges dense dependency sources by descriptor instead of canonical row count', () => {
    const denseDependencyRefs = buildTraceDenseSameProcessDependencyRefSource(0, 10_000);
    const arrayDependencyRefs = Array.from(denseDependencyRefs);
    const estimate = (dependencies: TraceSameProcessDependencyRefSource) =>
      estimatePreparedLayoutInputsSize(
        [
          {
            layout: {} as TracePreparedGraphScene['layout'],
            rows: [
              {
                row: {} as never,
                binaryDependencyLineData: {
                  data: {length: dependencies.length, attributes: {}},
                  dependencies
                },
                collapsedActivityIntervals: [],
                overflowLabels: []
              }
            ],
            crossProcessDependencyRefs: [],
            minimapSpanIndicators: []
          }
        ],
        {
          seenBuffers: new WeakSet<ArrayBufferLike>(),
          seenObjects: new WeakSet<object>()
        }
      );

    expect(estimate(arrayDependencyRefs) - estimate(denseDependencyRefs)).toBeGreaterThan(79_000);
  });
});

/**
 * Builds canonical dense dependency rows whose endpoint refs target synthetic chunk zero.
 *
 * The optional malformed source row keeps nullable ref tests columnar without mutating an Arrow
 * table after construction.
 */
function buildDenseDependencyTableForRows(
  rowIndexes: readonly number[],
  malformedStartRowIndex?: number
) {
  return buildArrowTraceSameProcessDependencyTableFromColumns({
    startSpanRef: rowIndexes.map(rowIndex =>
      rowIndex === malformedStartRowIndex ? null : encodeSpanRef(0, rowIndex)
    ),
    endSpanRef: rowIndexes.map(rowIndex => encodeSpanRef(0, rowIndex + 1)),
    waitMode: rowIndexes.map(() => 'end-to-start' as const),
    bidirectional: rowIndexes.map(() => false),
    waitTimeMs: rowIndexes.map(() => 0),
    keywords: rowIndexes.map(() => []),
    hasParentKeyword: rowIndexes.map(() => false)
  });
}

/**
 * Builds one synthetic finished span table with independent offset-zero Arrow batches.
 *
 * Concatenating separately built tables exercises trusted endpoint batch transitions without
 * sliced-vector offsets forcing the intended null-free fast path back to checked reads.
 */
function buildSplitFinishedSyntheticSpanTable(
  rowCount: number,
  splitRowIndex: number
): ReturnType<typeof buildArrowTraceSpanTableFromColumns> {
  const firstBatch = buildFinishedSyntheticSpanTableBatch(0, splitRowIndex);
  const secondBatch = buildFinishedSyntheticSpanTableBatch(splitRowIndex, rowCount - splitRowIndex);
  return firstBatch.concat(secondBatch) as ReturnType<typeof buildArrowTraceSpanTableFromColumns>;
}

/** Builds one offset-zero synthetic finished span batch for dependency endpoint parity tests. */
function buildFinishedSyntheticSpanTableBatch(
  rowStart: number,
  rowCount: number
): ReturnType<typeof buildArrowTraceSpanTableFromColumns> {
  const rowIndexes = Array.from({length: rowCount}, (_, rowOffset) => rowStart + rowOffset);
  return buildArrowTraceSpanTableFromColumns({
    process_ref: Array(rowCount).fill(encodeProcessRef(0)),
    thread_ref: Array(rowCount).fill(encodeProcessThreadRef(0, 0)),
    span_id: rowIndexes.map(rowIndex => 'synthetic-span-' + rowIndex),
    external_span_id: rowIndexes.map(rowIndex => 'synthetic-span-' + rowIndex),
    thread_id: Array(rowCount).fill('synthetic-process-0:thread:0'),
    name: Array(rowCount).fill('synthetic-work'),
    primary_timing_key: Array(rowCount).fill('primary'),
    status: Array(rowCount).fill('finished'),
    start_time_ms: rowIndexes.map(rowIndex => rowIndex + 1),
    end_time_ms: rowIndexes.map(rowIndex => rowIndex + 2),
    duration_ms: Array(rowCount).fill(1)
  });
}

/** Returns one binary dependency attribute as plain numbers for parity assertions. */
function getBinaryAttributeValues(
  data:
    | ReturnType<typeof buildTraceDeckBinaryBlockData>
    | ReturnType<typeof buildTraceDeckBinaryDependencyLineData>,
  attributeName: string
): number[] {
  const attribute = data.data.attributes[attributeName];
  if (!attribute) {
    throw new Error('Expected binary dependency attribute ' + attributeName + '.');
  }
  return Array.from(attribute.value);
}
