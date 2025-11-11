// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable max-statements, complexity */

import React, {useCallback, useEffect, useMemo, useState, useRef} from 'react';
import {createRoot} from 'react-dom/client';

import DeckGL, {type DeckGLRef} from '@deck.gl/react';

import {OrthographicView} from '@deck.gl/core';
import {PanWidget, ZoomRangeWidget} from '@deck.gl-community/widgets';
// ts-expect-error CSS import
// import '@deck.gl/widgets/dist/stylesheet.css';

import {
  GraphLayer,
  GraphEngine,
  GraphLayout,
  type Graph,
  type GraphLayoutEventDetail,
  ClassicGraph,
  SimpleLayout,
  D3ForceLayout,
  GPUForceLayout,
  JSONTabularGraphLoader,
  RadialLayout,
  HivePlotLayout,
  ForceMultiGraphLayout,
  D3DagLayout,
  CollapsableD3DagLayout,
  type RankGridConfig
} from '@deck.gl-community/graph-layers';

import {ControlPanel} from './control-panel';
import type {
  LayoutType,
  ExampleDefinition,
  GraphExampleType,
  ExampleMetadata
} from './layout-options';
import {CollapseControls} from './collapse-controls';
import {StylesheetEditor} from './stylesheet-editor';
import {EXAMPLES, filterExamplesByType} from './examples';
import {useGraphViewport} from './use-graph-viewport';

const INITIAL_VIEW_STATE = {
  /** the target origin of the view */
  target: [0, 0] as [number, number],
  /** zoom level */
  zoom: 1
} as const;

// the default cursor in the view
const DEFAULT_CURSOR = 'default';
const DEFAULT_STYLESHEET_MESSAGE = '// No style defined for this example';

const GRAPH_LAYER_ID = 'graph-viewer-layer';

function isInlineExample(
  example: ExampleDefinition | undefined
): example is ExampleDefinition & {data: () => {nodes: unknown[]; edges: unknown[]}} {
  return Boolean(example && typeof example.data === 'function');
}

function isRemoteExample(
  example: ExampleDefinition | undefined
): example is ExampleDefinition & {dataUrl: string} {
  return Boolean(example && typeof (example as {dataUrl?: unknown}).dataUrl === 'string');
}

function shallowEqualRecords(
  a?: Record<string, unknown>,
  b?: Record<string, unknown>
): boolean {
  if (a === b) {
    return true;
  }

  if (!a || !b) {
    return !a && !b;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false;
    }

    if (!Object.is(a[key], b[key])) {
      return false;
    }
  }

  return true;
}

function metadataEquals(a?: ExampleMetadata, b?: ExampleMetadata): boolean {
  if (a === b) {
    return true;
  }

  if (!a || !b) {
    return !a && !b;
  }

  return (
    a.nodeCount === b.nodeCount &&
    a.edgeCount === b.edgeCount &&
    a.graphId === b.graphId &&
    a.directed === b.directed &&
    a.strict === b.strict &&
    a.sourceType === b.sourceType &&
    shallowEqualRecords(a.attributes, b.attributes)
  );
}

function mergeMetadata(
  previous: ExampleMetadata | undefined,
  incoming: ExampleMetadata
): ExampleMetadata {
  const merged: ExampleMetadata = {
    ...(previous ?? {}),
    ...incoming,
    ...(incoming.attributes === undefined && previous?.attributes !== undefined
      ? {attributes: previous.attributes}
      : {})
  };

  return metadataEquals(previous, merged) ? previous ?? merged : merged;
}

type LayoutFactory = (options?: Record<string, unknown>) => GraphLayout;

const LAYOUT_FACTORIES: Record<LayoutType, LayoutFactory> = {
  'd3-force-layout': () => new D3ForceLayout(),
  'gpu-force-layout': () => new GPUForceLayout(),
  'simple-layout': () => new SimpleLayout(),
  'radial-layout': (options) => new RadialLayout(options),
  'hive-plot-layout': (options) => new HivePlotLayout(options),
  'force-multi-graph-layout': (options) => new ForceMultiGraphLayout(options),
  'd3-dag-layout': (options) => new CollapsableD3DagLayout(options),
};


const INITIAL_LOADING_STATE = {loaded: false, rendered: false, isLoading: true};

const loadingReducer = (state, action) => {
  switch (action.type) {
    case 'startLayout':
      return {loaded: false, rendered: false, isLoading: true};
    case 'layoutDone':
      return state.loaded ? state : {...state, loaded: true};
    case 'afterRender':
      if (!state.loaded) {
        return state;
      }

      // not interested after the first render, the state won't change
      return state.rendered ? state : {...state, rendered: true, isLoading: false};
    default:
      throw new Error(`Unhandled action type: ${action.type}`);
  }
};

export const useLoading = () => {
  const [state, setState] = useState(INITIAL_LOADING_STATE);
  const loadingDispatch = useCallback((action) => {
    setState((current) => loadingReducer(current, action));
  }, []);

  const layoutCallbacks = {
    onLayoutStart: () => loadingDispatch({type: 'startLayout'}),
    onLayoutDone: () => loadingDispatch({type: 'layoutDone'})
  } as const;

  return [state, loadingDispatch, layoutCallbacks] as const;
};

type AppProps = {
  graphType?: GraphExampleType;
};

export function App({graphType}: AppProps) {
  const exampleType = graphType;
  const examplesForType = useMemo(
    () => filterExamplesByType(EXAMPLES, exampleType),
    [exampleType]
  );
  const defaultExample = useMemo(
    () => (examplesForType.length ? examplesForType[0] : EXAMPLES[0]),
    [examplesForType]
  );
  const defaultLayout = defaultExample?.layouts[0] ?? 'd3-force-layout';

  const [selectedExample, setSelectedExample] = useState<ExampleDefinition | undefined>(
    () => defaultExample
  );
  const [selectedLayout, setSelectedLayout] = useState<LayoutType>(() => defaultLayout);
  const [collapseEnabled, setCollapseEnabled] = useState(true);
  const [layoutOverrides, setLayoutOverrides] = useState<
    Partial<Record<LayoutType, Record<string, unknown>>>
  >({});
  const [dagChainSummary, setDagChainSummary] = useState<
    {chainIds: string[]; collapsedIds: string[]}
    | null>(null);
  const [metadataByExample, setMetadataByExample] = useState<Record<string, ExampleMetadata>>({});
  const deckRef = useRef<DeckGLRef | null>(null);

  useEffect(() => {
    setSelectedExample(defaultExample);
    setSelectedLayout(defaultLayout);
    setLayoutOverrides({});
  }, [defaultExample, defaultLayout]);

  const graphData = useMemo(() => {
    if (!isInlineExample(selectedExample)) {
      return null;
    }

    return selectedExample.data();
  }, [selectedExample]);

  const activeMetadata = useMemo(() => {
    if (!selectedExample) {
      return undefined;
    }

    return metadataByExample[selectedExample.name];
  }, [metadataByExample, selectedExample]);

  const layoutOptions = useMemo(() => {
    if (!selectedExample || !selectedLayout) {
      return undefined;
    }

    const baseOptions = selectedExample.getLayoutOptions?.(selectedLayout, {
      data: graphData ?? undefined,
      metadata: activeMetadata
    });
    const overrides = layoutOverrides[selectedLayout];

    if (baseOptions && overrides) {
      return {...baseOptions, ...overrides};
    }

    return overrides ?? baseOptions;
  }, [selectedExample, selectedLayout, graphData, activeMetadata, layoutOverrides]);
  const graph = useMemo(
    () => (graphData ? JSONTabularGraphLoader({json: graphData}) : null),
    [graphData]
  );
  const layout = useMemo(() => {
    if (!selectedLayout) {
      return null;
    }

    const factory = LAYOUT_FACTORIES[selectedLayout];
    return factory ? factory(layoutOptions) : null;
  }, [selectedLayout, layoutOptions]);
  const manualEngine = useMemo(() => {
    if (!graph || !layout) {
      return null;
    }

    if (layout instanceof GraphLayout) {
      if (graph instanceof ClassicGraph) {
        return new GraphEngine({graph, layout});
      }

      const toLegacy = graph as Graph & {toClassicGraph?: () => ClassicGraph | null};
      if (typeof toLegacy.toClassicGraph === 'function') {
        const legacyGraph = toLegacy.toClassicGraph();
        if (legacyGraph) {
          return new GraphEngine({graph: legacyGraph, layout});
        }
      }

      return null;
    }

    return new GraphEngine({graph, layout});
  }, [graph, layout]);
  const [resolvedEngine, setResolvedEngine] = useState<GraphEngine | null>(manualEngine ?? null);
  useEffect(() => {
    setResolvedEngine(manualEngine ?? null);
  }, [manualEngine, selectedExample]);
  const dagLayout = layout instanceof D3DagLayout ? (layout as D3DagLayout) : null;
  const selectedStyles = selectedExample?.style;
  const metadataLoading = Boolean(isRemoteExample(selectedExample) && !activeMetadata);

  const updateExampleMetadata = useCallback(
    (example: ExampleDefinition | undefined, incoming: ExampleMetadata | null | undefined) => {
      if (!example || !incoming) {
        return;
      }

      setMetadataByExample((current) => {
        const previous = current[example.name];
        const merged = mergeMetadata(previous, incoming);
        if (merged === previous) {
          return current;
        }

        return {...current, [example.name]: merged};
      });
    },
    []
  );

  const deriveMetadataFromData = useCallback((data: unknown): ExampleMetadata | null => {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const record = data as Record<string, unknown>;

    if (Array.isArray(record.nodes) && Array.isArray(record.edges)) {
      return {
        nodeCount: record.nodes.length,
        edgeCount: record.edges.length
      };
    }

    const graphCandidate = record.graph;
    if (graphCandidate && typeof (graphCandidate as Graph).getNodes === 'function') {
      const parsedGraph = graphCandidate as Graph;
      const nodes = Array.from(parsedGraph.getNodes?.() ?? []);
      const edges = Array.from(parsedGraph.getEdges?.() ?? []);
      const metadata: ExampleMetadata = {
        nodeCount: nodes.length,
        edgeCount: edges.length
      };

      const dotMetadata = record.metadata as
        | {
            id?: string;
            directed?: boolean;
            strict?: boolean;
            attributes?: Record<string, unknown>;
          }
        | undefined;

      if (dotMetadata) {
        if (typeof dotMetadata.id === 'string') {
          metadata.graphId = dotMetadata.id;
        }
        if (typeof dotMetadata.directed === 'boolean') {
          metadata.directed = dotMetadata.directed;
        }
        if (typeof dotMetadata.strict === 'boolean') {
          metadata.strict = dotMetadata.strict;
        }
        if (dotMetadata.attributes && typeof dotMetadata.attributes === 'object') {
          metadata.attributes = {...dotMetadata.attributes};
        }
      }

      return metadata;
    }

    return null;
  }, []);

  const handleDataLoad = useCallback(
    (data: unknown) => {
      if (!selectedExample) {
        return;
      }

      const metadata = deriveMetadataFromData(data);
      if (!metadata) {
        return;
      }

      const sourceType = isRemoteExample(selectedExample) ? 'remote' : metadata.sourceType;
      updateExampleMetadata(selectedExample, {
        ...metadata,
        ...(sourceType ? {sourceType} : {})
      });
    },
    [deriveMetadataFromData, selectedExample, updateExampleMetadata]
  );

  useEffect(() => {
    if (!selectedExample || !graphData) {
      return;
    }

    const metadata: ExampleMetadata = {sourceType: 'inline'};
    if (Array.isArray(graphData.nodes)) {
      metadata.nodeCount = graphData.nodes.length;
    }
    if (Array.isArray(graphData.edges)) {
      metadata.edgeCount = graphData.edges.length;
    }

    updateExampleMetadata(selectedExample, metadata);
  }, [graphData, selectedExample, updateExampleMetadata]);

  useEffect(() => {
    if (!selectedExample || !resolvedEngine) {
      return;
    }

    const metadata: ExampleMetadata = {
      nodeCount: resolvedEngine.getNodes().length,
      edgeCount: resolvedEngine.getEdges().length,
      ...(isRemoteExample(selectedExample) ? {sourceType: 'remote'} : {})
    };

    updateExampleMetadata(selectedExample, metadata);
  }, [resolvedEngine, selectedExample, updateExampleMetadata]);

  const updateResolvedEngineFromLayer = useCallback(() => {
    if (manualEngine) {
      return;
    }

    const deck = deckRef.current?.deck as {layerManager?: {getLayers?: () => any[]; layers?: any[]}} | undefined;
    const layerManager = deck?.layerManager;
    const layers = layerManager?.getLayers?.() ?? layerManager?.layers;
    if (!layers) {
      return;
    }

    const graphLayerInstance = layers.find((layer) => layer?.id === GRAPH_LAYER_ID);
    const layerEngine = graphLayerInstance?.state?.graphEngine ?? null;
    if (layerEngine && layerEngine !== resolvedEngine) {
      setResolvedEngine(layerEngine);
    }
  }, [manualEngine, resolvedEngine]);

  const handleAfterRender = useCallback(() => {
    if (!loadingState.rendered) {
      loadingDispatch({type: 'afterRender'});
    }
    updateResolvedEngineFromLayer();
  }, [loadingDispatch, loadingState.rendered, updateResolvedEngineFromLayer]);

  const graphLayerInstance = useMemo(() => {
    if (!selectedExample || !layout) {
      return null;
    }

    const baseProps = {
      id: GRAPH_LAYER_ID,
      layout,
      stylesheet: selectedStyles,
      onLayoutStart: handleLayoutStart,
      onLayoutChange: handleLayoutChange,
      onLayoutDone: handleLayoutDone,
      resumeLayoutAfterDragging,
      rankGrid,
      ...(selectedExample.graphLoader ? {graphLoader: selectedExample.graphLoader} : {})
    } as const;

    if (manualEngine) {
      return new GraphLayer({
        ...baseProps,
        data: manualEngine,
        engine: manualEngine
      });
    }

    if (isRemoteExample(selectedExample) && selectedExample.dataUrl) {
      return new GraphLayer({
        ...baseProps,
        data: selectedExample.dataUrl,
        ...(selectedExample.loaders ? {loaders: selectedExample.loaders} : {}),
        ...(selectedExample.loadOptions ? {loadOptions: selectedExample.loadOptions} : {}),
        onDataLoad: handleDataLoad
      });
    }

    return null;
  }, [
    selectedExample,
    layout,
    selectedStyles,
    handleLayoutStart,
    handleLayoutChange,
    handleLayoutDone,
    resumeLayoutAfterDragging,
    rankGrid,
    manualEngine,
    handleDataLoad
  ]);

  const serializedStylesheet = useMemo(() => {
    if (!selectedStyles) {
      return '';
    }

    return JSON.stringify(
      selectedStyles,
      (_key, value) => (typeof value === 'function' ? value.toString() : value),
      2
    );
  }, [selectedStyles]);

  const [stylesheetValue, setStylesheetValue] = useState(
    serializedStylesheet || DEFAULT_STYLESHEET_MESSAGE
  );
  const stylesheetDraftRef = useRef<string>(stylesheetValue);

  useEffect(() => {
    const nextValue = serializedStylesheet || DEFAULT_STYLESHEET_MESSAGE;
    setStylesheetValue(nextValue);
    stylesheetDraftRef.current = nextValue;
  }, [serializedStylesheet]);

  const handleStylesheetChange = useCallback((nextValue: string) => {
    stylesheetDraftRef.current = nextValue;
    setStylesheetValue(nextValue);
  }, []);

  const handleStylesheetSubmit = useCallback((nextValue: string) => {
    stylesheetDraftRef.current = nextValue;
    setStylesheetValue(nextValue);
  }, []);

  // eslint-disable-next-line no-console
  const initialViewState = INITIAL_VIEW_STATE;
  const minZoom = -20;
  const maxZoom = 20;
  // const enableDragging = false;
  const resumeLayoutAfterDragging = false;

  const viewportSource = resolvedEngine ?? (layout instanceof GraphLayout ? layout : null);
  const {viewState, onResize, onViewStateChange, layoutCallbacks} = useGraphViewport(viewportSource, {
    minZoom,
    maxZoom,
    viewportPadding: 8,
    boundsPaddingRatio: 0.02,
    initialViewState
  });
  // const [viewState, setViewState] = useState({
  //   ...INITIAL_VIEW_STATE,
  //   ...initialViewState
  // });

  const widgets = useMemo(
    () => [
      new PanWidget({
        id: 'pan-widget',
        style: {margin: '20px 0 0 20px'}
      }),
      new ZoomRangeWidget({
        id: 'zoom-range-widget',
        style: {margin: '90px 0 0 20px'}
      })
    ],
    []
  );

  const [loadingState, loadingDispatch, loadingCallbacks] = useLoading();
  const {isLoading} = loadingState;

  const isDagLayout = selectedLayout === 'd3-dag-layout';

  const rankGrid = useMemo<RankGridConfig | false>(() => {
    if (!dagLayout) {
      return false;
    }

    const orientation =
      (layoutOptions?.orientation as string | undefined) ?? D3DagLayout.defaultProps.orientation;
    const direction: RankGridConfig['direction'] =
      orientation === 'LR' || orientation === 'RL' ? 'vertical' : 'horizontal';
    const usesExplicitRank = (layoutOptions?.nodeRank as string | undefined) === 'rank';

    return {
      enabled: true,
      direction,
      maxLines: 10,
      ...(usesExplicitRank ? {rankAccessor: 'rank'} : {}),
      gridProps: {
        color: [148, 163, 184, 220],
        labelOffset: direction === 'vertical' ? [0, 8] : [8, 0]
      }
    };
  }, [dagLayout, layoutOptions]);

  useEffect(() => {
    if (isDagLayout) {
      setCollapseEnabled(true);
    }
  }, [isDagLayout, selectedExample]);

  useEffect(() => {
    if (!dagLayout) {
      return;
    }
    dagLayout.setProps({collapseLinearChains: collapseEnabled});
    if (!collapseEnabled) {
      dagLayout.setCollapsedChains([]);
    }
  }, [dagLayout, collapseEnabled]);

  const updateChainSummary = useCallback(() => {
    if (!dagLayout || !resolvedEngine || !isDagLayout) {
      setDagChainSummary(isDagLayout ? {chainIds: [], collapsedIds: []} : null);
      return;
    }

    const chainIds: string[] = [];
    const collapsedIds: string[] = [];

    for (const node of resolvedEngine.getNodes()) {
      const chainId = node.getPropertyValue('collapsedChainId');
      const nodeIds = node.getPropertyValue('collapsedNodeIds');
      const representativeId = node.getPropertyValue('collapsedChainRepresentativeId');
      const isCollapsed = Boolean(node.getPropertyValue('isCollapsedChain'));

      if (
        chainId !== null &&
        chainId !== undefined &&
        Array.isArray(nodeIds) &&
        nodeIds.length > 1 &&
        representativeId === node.getId()
      ) {
        const chainKey = String(chainId);
        chainIds.push(chainKey);
        if (isCollapsed) {
          collapsedIds.push(chainKey);
        }
      }
    }

    setDagChainSummary({chainIds, collapsedIds});
  }, [dagLayout, resolvedEngine, isDagLayout]);

  useEffect(() => {
    updateChainSummary();
  }, [updateChainSummary]);

  const handleLayoutStart = useCallback(
    (detail?: GraphLayoutEventDetail) => {
      loadingCallbacks.onLayoutStart();
      layoutCallbacks.onLayoutStart(detail);
    },
    [loadingCallbacks, layoutCallbacks]
  );

  const handleLayoutChange = useCallback(
    (detail?: GraphLayoutEventDetail) => {
      layoutCallbacks.onLayoutChange(detail);
      updateChainSummary();
    },
    [layoutCallbacks, updateChainSummary]
  );

  const handleLayoutDone = useCallback(
    (detail?: GraphLayoutEventDetail) => {
      loadingCallbacks.onLayoutDone();
      layoutCallbacks.onLayoutDone(detail);
      updateChainSummary();
    },
    [loadingCallbacks, layoutCallbacks, updateChainSummary]
  );

  const handleToggleCollapseEnabled = useCallback(() => {
    setCollapseEnabled((value) => !value);
  }, []);

  const handleCollapseAll = useCallback(() => {
    if (!collapseEnabled || !dagLayout || !dagChainSummary) {
      return;
    }
    dagLayout.setCollapsedChains(dagChainSummary.chainIds);
  }, [collapseEnabled, dagLayout, dagChainSummary]);

  const handleExpandAll = useCallback(() => {
    if (!collapseEnabled || !dagLayout) {
      return;
    }
    dagLayout.setCollapsedChains([]);
  }, [collapseEnabled, dagLayout]);

  // Relatively pan the graph by a specified position vector.
  // const panBy = useCallback(
  //   (dx, dy) =>
  //     setViewState({
  //       ...viewState,
  //       target: [viewState.target[0] + dx, viewState.target[1] + dy]
  //     }),
  //   [viewState, setViewState]
  // );

  // // Relatively zoom the graph by a delta zoom level
  // const zoomBy = useCallback(
  //   (deltaZoom) => {
  //     const newZoom = viewState.zoom + deltaZoom;
  //     setViewState({
  //       ...viewState,
  //       zoom: Math.min(Math.max(newZoom, minZoom), maxZoom)
  //     });
  //   },
  //   [maxZoom, minZoom, viewState, setViewState]
  // );

  // useEffect(() => {
  //   if (!layout) {
  //     return () => undefined;
  //   }

  //   if (zoomToFitOnLoad && isLoading) {
  //     layout.addEventListener('onLayoutDone', fitBounds, {once: true});
  //   }
  //   return () => {
  //     layout.removeEventListener('onLayoutDone', fitBounds);
  //   };
  // }, [layout, isLoading, fitBounds, zoomToFitOnLoad]);

  useEffect(() => {
    const zoomWidget = widgets.find((widget) => widget instanceof ZoomRangeWidget);
    zoomWidget?.setProps({minZoom, maxZoom});
  }, [widgets, minZoom, maxZoom]);
  const handleExampleChange = useCallback((example: ExampleDefinition, layoutType: LayoutType) => {
    setSelectedExample(example);
    setSelectedLayout(layoutType);
  }, []);

  const handleApplyLayoutOptions = useCallback(
    (layoutType: LayoutType, options: Record<string, unknown>) => {
      setLayoutOverrides((current) => ({...current, [layoutType]: options}));
    },
    []
  );

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        minHeight: '100vh',
        width: '100%',
        boxSizing: 'border-box',
        fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif'
      }}
    >
      <div
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          position: 'relative'
        }}
      >
        {isLoading ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.875rem',
              color: '#475569',
              zIndex: 1,
              pointerEvents: 'none'
            }}
          >
            Computing layout…
          </div>
        ) : null}
        <DeckGL
          ref={deckRef}
          onAfterRender={handleAfterRender}
          width="100%"
          height="100%"
          getCursor={() => DEFAULT_CURSOR}
          viewState={viewState as any}
          onResize={onResize}
          onViewStateChange={onViewStateChange}
          views={[
            new OrthographicView({
              minZoom,
              maxZoom,
              controller: {
                scrollZoom: true,
                touchZoom: true,
                doubleClickZoom: true,
                dragPan: true,
                wheelSensitivity: 0.5
              }
            })
          ]}
          layers={graphLayerInstance ? [graphLayerInstance] : []}
          widgets={widgets}
          getTooltip={(info) => getToolTip(info.object)}
        />
      </div>
      <aside
        style={{
          width: '320px',
          minWidth: '260px',
          maxWidth: '360px',
          padding: '1.5rem 1rem',
          boxSizing: 'border-box',
          borderLeft: '1px solid #e2e8f0',
          background: '#f1f5f9',
          maxHeight: '100vh',
          overflowY: 'auto',
          fontFamily: 'inherit'
        }}
      >
        <ControlPanel
          examples={EXAMPLES}
          defaultExample={selectedExample ?? defaultExample}
          graphType={exampleType}
          onExampleChange={handleExampleChange}
          layoutOptions={layoutOptions}
          onLayoutOptionsApply={handleApplyLayoutOptions}
          metadata={activeMetadata}
          dataLoading={metadataLoading}
        >
          <>
            {isDagLayout ? (
              <CollapseControls
                enabled={collapseEnabled}
                summary={dagChainSummary}
                onToggle={handleToggleCollapseEnabled}
                onCollapseAll={handleCollapseAll}
                onExpandAll={handleExpandAll}
              />
            ) : null}
            <section
              style={{
                display: 'flex',
                flexDirection: 'column',
                fontSize: '0.75rem',
                gap: '0.25rem'
              }}
            >
              <h3 style={{margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
                Stylesheet JSON
              </h3>
              <div style={{borderRadius: '0.5rem', overflow: 'hidden', border: '1px solid #1f2937'}}>
                <StylesheetEditor
                  value={stylesheetValue}
                  onChange={handleStylesheetChange}
                  onSubmit={handleStylesheetSubmit}
                />
              </div>
            </section>
          </>
        </ControlPanel>
      </aside>
    </div>
  );
}

type GraphTooltipObject = {
  isNode?: boolean;
  _data?: Record<string, unknown> | null;
};

function isGraphTooltipObject(value: unknown): value is GraphTooltipObject {
  return typeof value === 'object' && value !== null;
}

const TOOLTIP_THEME = {
  background: '#0f172a',
  border: '#1e293b',
  header: '#38bdf8',
  key: '#facc15',
  value: '#f8fafc'
} as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case '\'':
        return '&#39;';
      default:
        return character;
    }
  });
}

function formatTooltipValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatTooltipValue(item)).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function getToolTip(object: unknown): {html: string} | null {
  if (!isGraphTooltipObject(object)) {
    return null;
  }

  const data = object._data ?? {};
  const entries = Object.entries(data).filter(([, value]) => value !== undefined);

  if (!entries.length) {
    return null;
  }

  const typeLabel = object.isNode ? 'Node' : 'Edge';
  const rowsHtml = entries
    .map(([key, value]) => {
      const formattedValue = formatTooltipValue(value);
      return `
        <tr>
          <th style="padding: 0.25rem 0.5rem; text-align: left; color: ${TOOLTIP_THEME.key}; font-weight: 600; white-space: nowrap;">${escapeHtml(
            key
          )}</th>
          <td style="padding: 0.25rem 0.5rem; color: ${TOOLTIP_THEME.value}; font-weight: 500;">${escapeHtml(
            formattedValue
          )}</td>
        </tr>`;
    })
    .join('');

  return {
    html: `
      <div style="background: ${TOOLTIP_THEME.background}; border: 1px solid ${TOOLTIP_THEME.border}; border-radius: 0.75rem; padding: 0.75rem; box-shadow: 0 8px 20px rgba(15, 23, 42, 0.45); font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; font-size: 0.75rem; min-width: 14rem; max-width: 22rem;">
        <div style="text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.65rem; font-weight: 700; color: ${TOOLTIP_THEME.header}; margin-bottom: 0.5rem;">${typeLabel}</div>
        <table style="border-collapse: collapse; width: 100%;">
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `
      .trim()
  };
}

export function renderToDOM() {
  if (document.body) {
    document.body.style.margin = '0';
    document.body.style.fontFamily = 'Inter, "Helvetica Neue", Arial, sans-serif';
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(<App />);
  }
}
