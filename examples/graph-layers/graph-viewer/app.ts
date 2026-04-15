// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable max-lines, max-statements, complexity */

import {Deck, OrthographicView, type DeckProps, type PickingInfo} from '@deck.gl/core';
import {ThemeWidget, DarkTheme, LightTheme} from '@deck.gl/widgets';
import {
  AccordeonPanel,
  BoxWidget,
  SidebarWidget,
  CustomPanel,
  MarkdownPanel,
  PanWidget,
  SettingsPanel,
  TextEditorPanel,
  ZoomRangeWidget,
  type SettingsWidgetSchema,
  type SettingsWidgetSettingDescriptor,
  type SettingsWidgetState,
  type WidgetPanelRecord
} from '@deck.gl-community/widgets';
import {
  CollapsableD3DagLayout,
  D3DagLayout,
  D3ForceLayout,
  ForceMultiGraphLayout,
  GPUForceLayout,
  GraphEngine,
  GraphLayer,
  GraphLayout,
  HivePlotLayout,
  RadialLayout,
  SimpleLayout,
  type Graph,
  type GraphLayoutEventDetail,
  type RankGridConfig
} from '@deck.gl-community/graph-layers';

import {
  DAG_LAYOUT_PROP_DESCRIPTIONS,
  D3_FORCE_DEFAULT_OPTIONS,
  FORCE_LAYOUT_PROP_DESCRIPTIONS,
  FORCE_MULTI_GRAPH_PROP_DESCRIPTIONS,
  GPU_FORCE_DEFAULT_OPTIONS,
  HIVE_PLOT_PROP_DESCRIPTIONS,
  LAYOUT_LABELS,
  RADIAL_LAYOUT_PROP_DESCRIPTIONS,
  createDagFormState,
  createForceLayoutFormState,
  createForceMultiGraphFormState,
  createHivePlotLayoutFormState,
  createRadialLayoutFormState,
  mapDagFormStateToOptions,
  mapForceLayoutFormStateToOptions,
  mapForceMultiGraphFormStateToOptions,
  mapHivePlotLayoutFormStateToOptions,
  mapRadialLayoutFormStateToOptions,
  type ExampleDefinition,
  type ExampleGraphData,
  type ExampleMetadata,
  type GraphExampleType,
  type LayoutType
} from './layout-options';
import {EXAMPLES, filterExamplesByType} from './examples';
import {createArrowGraphFromJson, type JsonGraph} from './sanitize-graph';
import type {PropDescription} from './props-form';

import '@deck.gl/widgets/stylesheet.css';

export type GraphViewerExampleOptions = {
  graphType?: GraphExampleType;
};

type GraphTooltipObject = {
  isNode?: boolean;
  _data?: Record<string, unknown> | null;
};

type LayoutFactory = (options?: Record<string, unknown>) => GraphLayout;

type LoadingState = {
  loaded: boolean;
  rendered: boolean;
  isLoading: boolean;
};

type DagChainSummary = {
  chainIds: string[];
  collapsedIds: string[];
};

type ViewState = {
  target: [number, number];
  zoom: number;
  width?: number;
  height?: number;
};

type GraphViewerState = {
  graphType?: GraphExampleType;
  examples: ExampleDefinition[];
  selectedExampleName: string;
  selectedLayout: LayoutType;
  layoutOverrides: Partial<Record<LayoutType, Record<string, unknown>>>;
  collapseEnabled: boolean;
  dagChainSummary: DagChainSummary | null;
  metadataByExample: Record<string, ExampleMetadata>;
  stylesheetValue: string;
  loading: LoadingState;
  resolvedEngine: GraphEngine | null;
  viewState: ViewState;
  isSidebarOpen: boolean;
  themeMode: 'light' | 'dark';
};

type GraphViewerRuntime = {
  selectedExample: ExampleDefinition;
  graphData: ExampleGraphData | null;
  activeMetadata?: ExampleMetadata;
  layoutOptions?: Record<string, unknown>;
  layout: GraphLayout | null;
  dagLayout: CollapsableD3DagLayout | null;
  isDagLayout: boolean;
  manualEngine: GraphEngine | null;
  graphLayer: GraphLayer | null;
  metadataLoading: boolean;
  layoutDescription?: string;
};

type ViewportSource = GraphEngine | GraphLayout | null;

const INITIAL_VIEW_STATE = {
  target: [0, 0] as [number, number],
  zoom: 1
} as const;

const ROOT_STYLE = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: '100%',
  overflow: 'hidden',
  borderRadius: '16px',
  background: '#ffffff',
  fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif'
} as const;

const THEME_WIDGET_ICON_OVERRIDES = `
  .graph-viewer-example .deck-widget.deck-widget-theme .deck-widget-button {
    width: var(--button-size, 28px);
    height: var(--button-size, 28px);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--button-stroke, rgba(255, 255, 255, 0.3));
    border-radius: var(--button-corner-radius, 8px);
    box-shadow: var(--button-shadow, 0px 0px 8px 0px rgba(0, 0, 0, 0.25));
  }

  .graph-viewer-example .deck-widget.deck-widget-theme .deck-widget-button > button {
    width: calc(var(--button-size, 28px) - 2px);
    height: calc(var(--button-size, 28px) - 2px);
    display: block;
    padding: 0;
    border: var(--button-inner-stroke, unset);
    border-radius: calc(var(--button-corner-radius, 8px) - 1px);
    background: var(--button-background, #fff);
    backdrop-filter: var(--button-backdrop-filter, unset);
    cursor: pointer;
  }

  .graph-viewer-example .deck-widget.deck-widget-theme .deck-widget-icon {
    display: block;
    width: 100%;
    height: 100%;
    background-color: var(--button-icon-idle, #616166);
    background-position: center;
    background-repeat: no-repeat;
    mask-position: center;
    -webkit-mask-position: center;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
    mask-size: 70%;
    -webkit-mask-size: 70%;
  }

  .graph-viewer-example .deck-widget.deck-widget-theme .deck-widget-button > button:hover .deck-widget-icon {
    background-color: var(--button-icon-hover, rgb(24, 24, 26));
  }

  .graph-viewer-example .deck-widget.deck-widget-theme button.deck-widget-sun .deck-widget-icon {
    mask-image: var(
      --icon-sun,
      url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="black" stroke="black"><g><circle cx="12" cy="12" r="6" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></g></svg>')
    );
    -webkit-mask-image: var(
      --icon-sun,
      url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="black" stroke="black"><g><circle cx="12" cy="12" r="6" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></g></svg>')
    );
    mask-size: contain;
    -webkit-mask-size: contain;
  }

  .graph-viewer-example .deck-widget.deck-widget-theme button.deck-widget-moon .deck-widget-icon {
    mask-image: var(
      --icon-moon,
      url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="black" mask="url(%23moon-mask)" /><mask id="moon-mask" viewBox="0 0 24 24"><rect x="0" y="0" width="24" height="24" fill="white" /><circle cx="24" cy="10" r="12" fill="black"/></mask></svg>')
    );
    -webkit-mask-image: var(
      --icon-moon,
      url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="black" mask="url(%23moon-mask)" /><mask id="moon-mask" viewBox="0 0 24 24"><rect x="0" y="0" width="24" height="24" fill="white" /><circle cx="24" cy="10" r="12" fill="black"/></mask></svg>')
    );
  }
`;

const LOADING_STYLE = {
  position: 'absolute',
  inset: '0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '14px',
  color: '#475569',
  zIndex: '1',
  pointerEvents: 'none'
} as const;

const DEFAULT_CURSOR = 'default';
const DEFAULT_STYLESHEET_MESSAGE = '// No style defined for this example';
const MIN_ZOOM = -20;
const MAX_ZOOM = 20;
const VIEWPORT_PADDING = 8;
const BOUNDS_PADDING_RATIO = 0.02;
const EPSILON = 1e-6;
const GRAPH_LAYER_ID = 'graph-viewer-layer';
const INITIAL_LOADING_STATE: LoadingState = {loaded: false, rendered: false, isLoading: true};
const RESUME_LAYOUT_AFTER_DRAGGING = false;
const GRAPH_DOCS_PATH = '/deck.gl-community/docs/modules/graph-layers';
const GRAPH_TYPE_TITLES: Record<GraphExampleType, string> = {
  graph: 'Simple Graphs',
  radial: 'Radial Layouts',
  'multi-graph': 'Multi Graphs',
  hive: 'Hive Plots',
  dag: 'DAGs'
};
const TOOLTIP_THEME = {
  background: '#0f172a',
  border: '#1e293b',
  header: '#38bdf8',
  key: '#facc15',
  value: '#f8fafc'
} as const;

const VIEW = new OrthographicView({
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
  controller: {
    scrollZoom: true,
    touchZoom: true,
    doubleClickZoom: true,
    dragPan: true
  }
});

const LAYOUT_FACTORIES: Record<LayoutType, LayoutFactory> = {
  'd3-force-layout': () => new D3ForceLayout(),
  'gpu-force-layout': () => new GPUForceLayout(),
  'simple-layout': () => new SimpleLayout(),
  'radial-layout': (options) => new RadialLayout(options),
  'hive-plot-layout': (options) => new HivePlotLayout(options),
  'force-multi-graph-layout': (options) => new ForceMultiGraphLayout(options),
  'd3-dag-layout': (options) => new CollapsableD3DagLayout(options)
};

export function mountGraphViewerExample(
  container: HTMLElement,
  options: GraphViewerExampleOptions = {}
): () => void {
  const examples = getExamplesForType(options.graphType);
  const defaultExample = examples[0] ?? EXAMPLES[0];
  const defaultLayout = defaultExample?.layouts[0] ?? 'd3-force-layout';

  const rootElement = container.ownerDocument.createElement('div');
  rootElement.className = 'graph-viewer-example';
  const loadingElement = container.ownerDocument.createElement('div');
  applyElementStyle(rootElement, ROOT_STYLE);
  applyElementStyle(loadingElement, LOADING_STYLE);
  loadingElement.textContent = 'Computing layout...';
  const styleElement = container.ownerDocument.createElement('style');
  styleElement.textContent = THEME_WIDGET_ICON_OVERRIDES;
  rootElement.append(styleElement);
  rootElement.append(loadingElement);
  container.replaceChildren(rootElement);

  const state: GraphViewerState = {
    graphType: options.graphType,
    examples,
    selectedExampleName: defaultExample.name,
    selectedLayout: defaultLayout,
    layoutOverrides: {},
    collapseEnabled: defaultLayout === 'd3-dag-layout',
    dagChainSummary: null,
    metadataByExample: {},
    stylesheetValue: serializeStylesheet(defaultExample.style),
    loading: {...INITIAL_LOADING_STATE},
    resolvedEngine: null,
    viewState: {...INITIAL_VIEW_STATE},
    isSidebarOpen: true,
    themeMode: 'light'
  };

  let deck: Deck | null = null;
  let currentRuntime: GraphViewerRuntime | null = null;
  let isApplyingViewState = false;

  const panWidget = new PanWidget({
    id: 'pan-widget',
    placement: 'bottom-left'
  });
  const zoomWidget = new ZoomRangeWidget({
    id: 'zoom-range-widget',
    placement: 'bottom-left',
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM
  });
  const themeWidget = new ThemeWidget({
    id: 'graph-viewer-theme',
    placement: 'top-left',
    initialThemeMode: 'light',
    lightModeTheme: {
      ...LightTheme
    },
    darkModeTheme: {
      ...DarkTheme
    }
  }) as ThemeWidget & {
    _applyTheme: (themeMode: 'light' | 'dark') => void;
    themeMode: 'light' | 'dark';
  };
  const originalApplyTheme = themeWidget._applyTheme.bind(themeWidget);
  themeWidget._applyTheme = (themeMode: 'light' | 'dark') => {
    originalApplyTheme(themeMode);
    if (state.themeMode !== themeMode) {
      state.themeMode = themeMode;
      syncWidgets();
    }
  };
  const sidebarWidget = new SidebarWidget({
    id: 'graph-viewer-sidebar',
    placement: 'top-right',
    side: 'right',
    widthPx: 360,
    title: 'Graph controls',
    triggerLabel: 'Toggle graph controls',
    hideTrigger: false,
    button: true,
    open: state.isSidebarOpen,
    onOpenChange(nextOpen) {
      if (state.isSidebarOpen === nextOpen) {
        return;
      }
      state.isSidebarOpen = nextOpen;
      syncWidgets();
    }
  });
  const boxWidget = new BoxWidget({
    id: 'graph-viewer-box',
    placement: 'top-left',
    widthPx: 360,
    title: getGraphViewerBoxTitle(options.graphType),
    panel: buildInfoBoxPanel(buildRuntime(state), state.selectedLayout)
  });

  const viewportController = createViewportController({
    getSource: () => state.resolvedEngine ?? currentRuntime?.layout ?? null,
    getViewState: () => state.viewState,
    updateViewState(nextViewState, syncToDeck) {
      state.viewState = nextViewState;
      if (syncToDeck && deck) {
        applyDeckViewState();
      }
    }
  });

  const handlers = {
    onSelectionSettingsChange(nextSettings: SettingsWidgetState) {
      const selectedExample = findExampleByName(state.examples, String(nextSettings.example ?? ''));
      if (selectedExample && selectedExample.name !== state.selectedExampleName) {
        state.selectedExampleName = selectedExample.name;
        state.selectedLayout = selectedExample.layouts[0] ?? state.selectedLayout;
        state.stylesheetValue = serializeStylesheet(selectedExample.style);
        state.resolvedEngine = null;
        state.dagChainSummary = null;
        state.collapseEnabled = state.selectedLayout === 'd3-dag-layout';
        state.loading = {...INITIAL_LOADING_STATE};
        applyState();
        return;
      }

      const nextLayout = String(nextSettings.layout ?? '') as LayoutType;
      if (
        nextLayout &&
        nextLayout !== state.selectedLayout &&
        getSelectedExample(state).layouts.includes(nextLayout)
      ) {
        state.selectedLayout = nextLayout;
        state.resolvedEngine = null;
        state.dagChainSummary = null;
        state.collapseEnabled = nextLayout === 'd3-dag-layout';
        state.loading = {...INITIAL_LOADING_STATE};
        applyState();
      }
    },
    onLayoutOptionsChange(nextSettings: SettingsWidgetState) {
      const nextOptions = mapLayoutSettingsToOptions(state.selectedLayout, nextSettings);
      state.layoutOverrides = {...state.layoutOverrides, [state.selectedLayout]: nextOptions};
      state.resolvedEngine = null;
      state.dagChainSummary = null;
      state.loading = {...INITIAL_LOADING_STATE};
      applyState();
    },
    onToggleCollapseEnabled() {
      state.collapseEnabled = !state.collapseEnabled;
      const dagLayout = currentRuntime?.dagLayout;
      if (dagLayout) {
        dagLayout.setProps({collapseLinearChains: state.collapseEnabled});
        if (!state.collapseEnabled) {
          dagLayout.setCollapsedChains([]);
        }
      }
      updateChainSummary();
      syncWidgets();
    },
    onCollapseAll() {
      if (!state.collapseEnabled || !currentRuntime?.dagLayout || !state.dagChainSummary) {
        return;
      }
      currentRuntime.dagLayout.setCollapsedChains(state.dagChainSummary.chainIds);
      updateChainSummary();
      syncWidgets();
    },
    onExpandAll() {
      if (!state.collapseEnabled || !currentRuntime?.dagLayout) {
        return;
      }
      currentRuntime.dagLayout.setCollapsedChains([]);
      updateChainSummary();
      syncWidgets();
    },
    onStylesheetChange(nextValue: string) {
      state.stylesheetValue = nextValue;
    }
  };

  deck = new Deck({
    parent: rootElement,
    views: VIEW,
    controller: true,
    getCursor: () => DEFAULT_CURSOR,
    getTooltip: ({object}: PickingInfo) => getToolTip(object),
    onAfterRender: handleAfterRender,
    onResize: ({width, height}) => {
      viewportController.onResize(width, height);
    },
    onViewStateChange: ({viewState}) => {
      viewportController.onViewStateChange(viewState as {target: [number, number]; zoom: number});
    },
    viewState: toDeckViewState(state.viewState),
    layers: [],
    widgets: [panWidget, zoomWidget, boxWidget, themeWidget, sidebarWidget]
  });

  applyState();

  return () => {
    deck?.finalize();
    styleElement.remove();
    loadingElement.remove();
    rootElement.remove();
    container.replaceChildren();
  };

  function applyState() {
    const runtime = buildRuntime(state);
    currentRuntime = runtime;

    if (runtime.manualEngine) {
      state.resolvedEngine = runtime.manualEngine;
    } else if (isRemoteExample(runtime.selectedExample)) {
      state.resolvedEngine = null;
    }

    updateInlineMetadata(runtime);
    updateResolvedEngineMetadata(runtime);
    updateChainSummary(runtime);
    syncWidgets(runtime);
    syncDeck(runtime);
    syncLoadingOverlay();
    viewportController.fitBounds();
  }

  function syncDeck(runtime: GraphViewerRuntime) {
    if (!deck) {
      return;
    }

    deck.setProps({
      viewState: toDeckViewState(state.viewState),
      layers: runtime.graphLayer ? [runtime.graphLayer] : []
    });
  }

  function syncWidgets(runtime: GraphViewerRuntime = currentRuntime ?? buildRuntime(state)) {
    sidebarWidget.setProps({
      title: 'Graph controls',
      open: state.isSidebarOpen,
      panel: buildSidebarPanel(runtime, state, handlers)
    });
    boxWidget.setProps({
      title: getGraphViewerBoxTitle(options.graphType),
      panel: buildInfoBoxPanel(runtime, state.selectedLayout, state.themeMode)
    });
    zoomWidget.setProps({minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM});
  }

  function syncLoadingOverlay() {
    loadingElement.hidden = !state.loading.isLoading;
  }

  function handleAfterRender() {
    if (state.loading.loaded && !state.loading.rendered) {
      state.loading = {
        loaded: true,
        rendered: true,
        isLoading: false
      };
      syncLoadingOverlay();
    }
    updateResolvedEngineFromLayer();
  }

  function updateResolvedEngineFromLayer() {
    if (!deck || currentRuntime?.manualEngine) {
      return;
    }

    const layerManager = (deck as unknown as {layerManager?: {getLayers?: () => unknown[]; layers?: unknown[]}})
      .layerManager;
    const layers = layerManager?.getLayers?.() ?? layerManager?.layers;
    if (!layers) {
      return;
    }

    const graphLayerInstance = layers.find(
      (layer) => (layer as {id?: string} | null)?.id === GRAPH_LAYER_ID
    ) as {state?: {graphEngine?: GraphEngine}} | undefined;
    const nextEngine = graphLayerInstance?.state?.graphEngine ?? null;
    if (!nextEngine || nextEngine === state.resolvedEngine) {
      return;
    }

    state.resolvedEngine = nextEngine;
    updateResolvedEngineMetadata(currentRuntime ?? buildRuntime(state));
    updateChainSummary();
    syncWidgets();
    viewportController.fitBounds();
  }

  function updateInlineMetadata(runtime: GraphViewerRuntime) {
    if (!runtime.graphData) {
      return;
    }

    updateExampleMetadata(runtime.selectedExample, {
      nodeCount: Array.isArray(runtime.graphData.nodes) ? runtime.graphData.nodes.length : undefined,
      edgeCount: Array.isArray(runtime.graphData.edges) ? runtime.graphData.edges.length : undefined,
      sourceType: 'inline'
    });
  }

  function updateResolvedEngineMetadata(runtime: GraphViewerRuntime) {
    const engine = state.resolvedEngine;
    if (!engine) {
      return;
    }

    updateExampleMetadata(runtime.selectedExample, {
      nodeCount: engine.getNodes().length,
      edgeCount: engine.getEdges().length,
      ...(isRemoteExample(runtime.selectedExample) ? {sourceType: 'remote' as const} : {})
    });
  }

  function updateExampleMetadata(
    example: ExampleDefinition | undefined,
    incoming: ExampleMetadata | null | undefined
  ) {
    if (!example || !incoming) {
      return;
    }

    const previous = state.metadataByExample[example.name];
    const merged = mergeMetadata(previous, incoming);
    if (merged === previous) {
      return;
    }

    state.metadataByExample = {
      ...state.metadataByExample,
      [example.name]: merged
    };
  }

  function updateChainSummary(runtime: GraphViewerRuntime = currentRuntime ?? buildRuntime(state)) {
    if (!runtime.isDagLayout) {
      state.dagChainSummary = null;
      return;
    }

    const engine = state.resolvedEngine;
    if (!runtime.dagLayout || !engine) {
      state.dagChainSummary = {chainIds: [], collapsedIds: []};
      return;
    }

    const chainIds: string[] = [];
    const collapsedIds: string[] = [];

    for (const node of engine.getNodes()) {
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

    state.dagChainSummary = {chainIds, collapsedIds};
  }

  function applyDeckViewState() {
    if (!deck) {
      return;
    }

    isApplyingViewState = true;
    deck.setProps({viewState: toDeckViewState(state.viewState)});
    isApplyingViewState = false;
  }

  function createViewportController({
    getSource,
    getViewState,
    updateViewState
  }: {
    getSource: () => ViewportSource;
    getViewState: () => ViewState;
    updateViewState: (nextViewState: ViewState, syncToDeck: boolean) => void;
  }) {
    let latestBounds: [[number, number], [number, number]] | null = null;

    const fitBounds = (incomingBounds?: [[number, number], [number, number]] | null) => {
      const source = getSource();
      if (!source) {
        return;
      }

      const bounds = incomingBounds ?? getEventSourceBounds(source);
      if (!bounds) {
        return;
      }

      const [[minX, minY], [maxX, maxY]] = bounds;
      if (
        !Number.isFinite(minX) ||
        !Number.isFinite(minY) ||
        !Number.isFinite(maxX) ||
        !Number.isFinite(maxY)
      ) {
        return;
      }

      latestBounds = bounds;
      const currentViewState = getViewState();
      if (!currentViewState.width || !currentViewState.height) {
        return;
      }

      const target: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];
      const spanX = Math.max(maxX - minX, EPSILON);
      const spanY = Math.max(maxY - minY, EPSILON);
      const paddedSpanX = spanX * (1 + BOUNDS_PADDING_RATIO);
      const paddedSpanY = spanY * (1 + BOUNDS_PADDING_RATIO);
      const innerWidth = Math.max(1, currentViewState.width - VIEWPORT_PADDING * 2);
      const innerHeight = Math.max(1, currentViewState.height - VIEWPORT_PADDING * 2);
      const scale = Math.min(innerWidth / paddedSpanX, innerHeight / paddedSpanY);
      const zoom = Math.min(Math.max(MIN_ZOOM, Math.log2(Math.max(scale, EPSILON))), MAX_ZOOM);

      if (!Number.isFinite(zoom)) {
        return;
      }

      const targetUnchanged =
        Math.abs(currentViewState.target[0] - target[0]) < EPSILON &&
        Math.abs(currentViewState.target[1] - target[1]) < EPSILON;
      const zoomUnchanged = Math.abs(currentViewState.zoom - zoom) < EPSILON;
      if (targetUnchanged && zoomUnchanged) {
        return;
      }

      updateViewState(
        {
          ...currentViewState,
          target,
          zoom
        },
        true
      );
    };

    return {
      fitBounds,
      onResize(width: number, height: number) {
        const nextViewState: ViewState = {...getViewState(), width, height};
        updateViewState(nextViewState, false);
        if (latestBounds) {
          fitBounds(latestBounds);
          return;
        }

        const source = getSource();
        if (source) {
          const bounds = getEventSourceBounds(source);
          if (bounds) {
            fitBounds(bounds);
          }
        }
      },
      onViewStateChange(nextViewState: {target: [number, number]; zoom: number}) {
        const currentViewState = getViewState();
        const mergedViewState: ViewState = {
          ...currentViewState,
          target: nextViewState.target,
          zoom: nextViewState.zoom
        };
        updateViewState(mergedViewState, false);
        if (!isApplyingViewState) {
          applyDeckViewState();
        }
      },
      handleLayoutEvent(detail?: GraphLayoutEventDetail) {
        fitBounds((detail?.bounds as [[number, number], [number, number]] | undefined) ?? null);
      }
    };
  }

  function buildRuntime(currentState: GraphViewerState): GraphViewerRuntime {
    const selectedExample = getSelectedExample(currentState);
    const graphData = isInlineExample(selectedExample)
      ? selectedExample.data()
      : null;
    const activeMetadata = currentState.metadataByExample[selectedExample.name];
    const selectedLayout = currentState.selectedLayout;
    const baseOptions = selectedExample.getLayoutOptions?.(selectedLayout, {
      data: graphData ?? undefined,
      metadata: activeMetadata
    });
    const overrides = currentState.layoutOverrides[selectedLayout];
    const layoutOptions = baseOptions && overrides ? {...baseOptions, ...overrides} : overrides ?? baseOptions;
    const layoutFactory = LAYOUT_FACTORIES[selectedLayout];
    const layout = layoutFactory ? layoutFactory(layoutOptions) : null;
    const dagLayout = layout instanceof CollapsableD3DagLayout ? layout : null;
    if (dagLayout) {
      dagLayout.setProps({collapseLinearChains: currentState.collapseEnabled});
      if (!currentState.collapseEnabled) {
        dagLayout.setCollapsedChains([]);
      }
    }

    const manualEngine =
      graphData && layout ? new GraphEngine({graph: createArrowGraphFromJson(graphData as JsonGraph), layout}) : null;

    const graphLayer = buildGraphLayer({
      selectedExample,
      layout,
      manualEngine,
      rankGrid: buildRankGrid(selectedLayout, layoutOptions, dagLayout),
      onLayoutStart: (detail) => {
        state.loading = {...INITIAL_LOADING_STATE};
        syncLoadingOverlay();
        viewportController.handleLayoutEvent(detail);
      },
      onLayoutChange: (detail) => {
        viewportController.handleLayoutEvent(detail);
        updateChainSummary();
      },
      onLayoutDone: (detail) => {
        state.loading = {
          loaded: true,
          rendered: state.loading.rendered,
          isLoading: !state.loading.rendered
        };
        syncLoadingOverlay();
        viewportController.handleLayoutEvent(detail);
        updateChainSummary();
      },
      onDataLoad: (data) => {
        handleDataLoad(selectedExample, data);
      }
    });

    return {
      selectedExample,
      graphData,
      activeMetadata,
      layoutOptions,
      layout,
      dagLayout,
      isDagLayout: selectedLayout === 'd3-dag-layout',
      manualEngine,
      graphLayer,
      metadataLoading: Boolean(isRemoteExample(selectedExample) && !activeMetadata),
      layoutDescription: selectedExample.layoutDescriptions[selectedLayout]
    };
  }

  function handleDataLoad(example: ExampleDefinition, data: unknown) {
    const metadata = deriveMetadataFromData(data);
    if (!metadata) {
      return;
    }

    updateExampleMetadata(example, {
      ...metadata,
      ...(isRemoteExample(example) ? {sourceType: 'remote' as const} : {})
    });
    syncWidgets();
  }
}

function buildGraphLayer({
  selectedExample,
  layout,
  manualEngine,
  rankGrid,
  onLayoutStart,
  onLayoutChange,
  onLayoutDone,
  onDataLoad
}: {
  selectedExample: ExampleDefinition;
  layout: GraphLayout | null;
  manualEngine: GraphEngine | null;
  rankGrid: RankGridConfig | false;
  onLayoutStart: (detail?: GraphLayoutEventDetail) => void;
  onLayoutChange: (detail?: GraphLayoutEventDetail) => void;
  onLayoutDone: (detail?: GraphLayoutEventDetail) => void;
  onDataLoad: (data: unknown) => void;
}): GraphLayer | null {
  if (!layout) {
    return null;
  }

  const baseProps = {
    id: GRAPH_LAYER_ID,
    layout,
    stylesheet: selectedExample.style,
    onLayoutStart,
    onLayoutChange,
    onLayoutDone,
    resumeLayoutAfterDragging: RESUME_LAYOUT_AFTER_DRAGGING,
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

  if (isRemoteExample(selectedExample)) {
    return new GraphLayer({
      ...baseProps,
      data: selectedExample.dataUrl,
      ...(selectedExample.loaders ? {loaders: selectedExample.loaders} : {}),
      ...(selectedExample.loadOptions ? {loadOptions: selectedExample.loadOptions} : {}),
      onDataLoad
    });
  }

  return null;
}

function buildSidebarPanel(
  runtime: GraphViewerRuntime,
  state: GraphViewerState,
  handlers: {
    onSelectionSettingsChange: (nextSettings: SettingsWidgetState) => void;
    onLayoutOptionsChange: (nextSettings: SettingsWidgetState) => void;
    onToggleCollapseEnabled: () => void;
    onCollapseAll: () => void;
    onExpandAll: () => void;
    onStylesheetChange: (nextValue: string) => void;
  }
) {
  const panels: WidgetPanelRecord = {
    controls: new SettingsPanel({
      id: 'graph-selection',
      schema: buildSelectionSchema(runtime.selectedExample, state.examples, state.selectedLayout),
      settings: {
        example: runtime.selectedExample.name,
        layout: state.selectedLayout
      },
      onSettingsChange: handlers.onSelectionSettingsChange
    }),
    layoutOptions: new SettingsPanel({
      id: 'graph-layout-options',
      schema: buildLayoutOptionsSchema(state.selectedLayout, runtime.layoutDescription, runtime.layoutOptions),
      settings: buildLayoutOptionSettingsState(state.selectedLayout, runtime.layoutOptions),
      onSettingsChange: handlers.onLayoutOptionsChange
    })
  };

  if (runtime.isDagLayout) {
    panels.collapse = new CustomPanel({
      id: 'dag-collapse',
      title: 'Collapsed chains',
      onRenderHTML: (rootElement) => {
        renderCollapseControlsPanel(rootElement, state, handlers);
      }
    });
  }

  panels.metadata = new CustomPanel({
    id: 'dataset-metadata',
    title: 'Dataset stats',
    onRenderHTML: (rootElement) => {
      renderMetadataPanel(rootElement, runtime.activeMetadata, runtime.metadataLoading);
    }
  });

  panels.stylesheet = new TextEditorPanel({
    id: 'stylesheet-json',
    title: 'Stylesheet JSON',
    language: 'json',
    value: state.stylesheetValue,
    onValueChange: handlers.onStylesheetChange,
    readOnly: false,
    placeholder: DEFAULT_STYLESHEET_MESSAGE,
    theme: 'invert'
  });

  return new AccordeonPanel({
    id: 'graph-viewer-sidebar-panels',
    title: '',
    panels,
    defaultExpandedPanelIds: Object.values(panels).map((panel) => panel.id)
  });
}

function buildInfoBoxPanel(
  runtime: GraphViewerRuntime,
  selectedLayout: LayoutType,
  themeMode: 'light' | 'dark'
): MarkdownPanel {
  const selectedLayoutLabel = LAYOUT_LABELS[selectedLayout] ?? selectedLayout;
  const markdown = [
    runtime.selectedExample.description,
    `Current dataset: **${runtime.selectedExample.name}**`,
    `Current layout: **${selectedLayoutLabel}**`,
    `[Graph Layers docs](${GRAPH_DOCS_PATH})`
  ].join('\n\n');

  return new MarkdownPanel({
    id: 'graph-viewer-info',
    title: '',
    markdown,
    theme: themeMode
  });
}

function buildSelectionSchema(
  selectedExample: ExampleDefinition,
  examples: ExampleDefinition[],
  selectedLayout: LayoutType
): SettingsWidgetSchema {
  return {
    title: 'Graph controls',
    sections: [
      {
        id: 'dataset',
        name: 'Dataset',
        description: selectedExample.description,
        initiallyCollapsed: false,
        settings: [
          {
            name: 'example',
            label: 'Dataset',
            type: 'select',
            options: examples.map((example) => ({label: example.name, value: example.name}))
          }
        ]
      },
      {
        id: 'layout',
        name: 'Layout',
        description: selectedExample.layoutDescriptions[selectedLayout],
        initiallyCollapsed: false,
        settings: [
          {
            name: 'layout',
            label: 'Layout',
            type: 'select',
            options: selectedExample.layouts.map((layout) => ({
              label: LAYOUT_LABELS[layout] ?? layout,
              value: layout
            }))
          }
        ]
      }
    ]
  };
}

function buildLayoutOptionsSchema(
  layout: LayoutType,
  layoutDescription: string | undefined,
  appliedOptions?: Record<string, unknown>
): SettingsWidgetSchema {
  const settings = getLayoutSettingsDescriptors(layout, appliedOptions);
  return {
    title: 'Layout options',
    sections: [
      {
        id: 'layout-options',
        name: LAYOUT_LABELS[layout] ?? layout,
        description: getLayoutOptionsDescription(layout, layoutDescription),
        initiallyCollapsed: false,
        settings
      }
    ]
  };
}

function getLayoutOptionsDescription(layout: LayoutType, layoutDescription?: string) {
  if (layout === 'simple-layout') {
    return 'Simple layout reads node positions directly from the dataset.';
  }
  if (layoutDescription) {
    return layoutDescription;
  }
  return 'Adjust layout parameters. Changes apply immediately.';
}

function getGraphViewerBoxTitle(graphType?: GraphExampleType): string {
  if (!graphType) {
    return 'Graph Viewer';
  }
  return GRAPH_TYPE_TITLES[graphType];
}

function getLayoutSettingsDescriptors(
  layout: LayoutType,
  appliedOptions?: Record<string, unknown>
): SettingsWidgetSettingDescriptor[] {
  if (layout === 'd3-force-layout') {
    const values = createForceLayoutFormState(appliedOptions, D3_FORCE_DEFAULT_OPTIONS);
    return mapPropDescriptionsToSettings(values, FORCE_LAYOUT_PROP_DESCRIPTIONS);
  }
  if (layout === 'gpu-force-layout') {
    const values = createForceLayoutFormState(appliedOptions, GPU_FORCE_DEFAULT_OPTIONS);
    return mapPropDescriptionsToSettings(values, FORCE_LAYOUT_PROP_DESCRIPTIONS);
  }
  if (layout === 'force-multi-graph-layout') {
    const values = createForceMultiGraphFormState(appliedOptions);
    return mapPropDescriptionsToSettings(values, FORCE_MULTI_GRAPH_PROP_DESCRIPTIONS);
  }
  if (layout === 'radial-layout') {
    const values = createRadialLayoutFormState(appliedOptions);
    return mapPropDescriptionsToSettings(values, RADIAL_LAYOUT_PROP_DESCRIPTIONS);
  }
  if (layout === 'hive-plot-layout') {
    const values = createHivePlotLayoutFormState(appliedOptions);
    return mapPropDescriptionsToSettings(values, HIVE_PLOT_PROP_DESCRIPTIONS);
  }
  if (layout === 'd3-dag-layout') {
    const values = createDagFormState(appliedOptions);
    return mapPropDescriptionsToSettings(values, DAG_LAYOUT_PROP_DESCRIPTIONS);
  }
  return [];
}

function buildLayoutOptionSettingsState(
  layout: LayoutType,
  appliedOptions?: Record<string, unknown>
): SettingsWidgetState {
  if (layout === 'd3-force-layout') {
    return createForceLayoutFormState(appliedOptions, D3_FORCE_DEFAULT_OPTIONS);
  }
  if (layout === 'gpu-force-layout') {
    return createForceLayoutFormState(appliedOptions, GPU_FORCE_DEFAULT_OPTIONS);
  }
  if (layout === 'force-multi-graph-layout') {
    return createForceMultiGraphFormState(appliedOptions);
  }
  if (layout === 'radial-layout') {
    return createRadialLayoutFormState(appliedOptions);
  }
  if (layout === 'hive-plot-layout') {
    return createHivePlotLayoutFormState(appliedOptions);
  }
  if (layout === 'd3-dag-layout') {
    return createDagFormState(appliedOptions);
  }
  return {};
}

function mapLayoutSettingsToOptions(
  layout: LayoutType,
  nextSettings: SettingsWidgetState
): Record<string, unknown> {
  if (layout === 'd3-force-layout' || layout === 'gpu-force-layout') {
    return mapForceLayoutFormStateToOptions(nextSettings as ReturnType<typeof createForceLayoutFormState>);
  }
  if (layout === 'force-multi-graph-layout') {
    return mapForceMultiGraphFormStateToOptions(
      nextSettings as ReturnType<typeof createForceMultiGraphFormState>
    );
  }
  if (layout === 'radial-layout') {
    return mapRadialLayoutFormStateToOptions(nextSettings as ReturnType<typeof createRadialLayoutFormState>);
  }
  if (layout === 'hive-plot-layout') {
    return mapHivePlotLayoutFormStateToOptions(
      nextSettings as ReturnType<typeof createHivePlotLayoutFormState>
    );
  }
  if (layout === 'd3-dag-layout') {
    return mapDagFormStateToOptions(nextSettings as ReturnType<typeof createDagFormState>);
  }
  return {};
}

function mapPropDescriptionsToSettings<TValues extends Record<string, unknown>>(
  values: TValues,
  descriptions: Record<string, PropDescription<TValues>>
): SettingsWidgetSettingDescriptor[] {
  return Object.entries(descriptions).map(([name, description]) => {
    if (description.type === 'number') {
      return {
        name,
        label: description.title,
        description: description.description,
        type: 'number',
        step: description.step,
        min: typeof description.min === 'function' ? description.min(values) : description.min,
        max: typeof description.max === 'function' ? description.max(values) : description.max,
        defaultValue: Number(values[name] ?? 0)
      };
    }

    if (description.type === 'select') {
      return {
        name,
        label: description.title,
        description: description.description,
        type: 'select',
        options: description.options.map((option) => ({
          label: option.label,
          value: option.value
        })),
        defaultValue: String(values[name] ?? '')
      };
    }

    return {
      name,
      label: description.title,
      description: description.description,
      type: 'boolean',
      defaultValue: Boolean(values[name])
    };
  });
}

function renderCollapseControlsPanel(
  rootElement: HTMLElement,
  state: GraphViewerState,
  handlers: {
    onToggleCollapseEnabled: () => void;
    onCollapseAll: () => void;
    onExpandAll: () => void;
  }
) {
  const summary = state.dagChainSummary;
  const totalChainCount = summary?.chainIds.length ?? 0;
  const collapsedChainCount = summary?.collapsedIds.length ?? 0;
  const collapseAllDisabled = !state.collapseEnabled || totalChainCount === 0;
  const expandAllDisabled = !state.collapseEnabled || collapsedChainCount === 0;

  const section = rootElement.ownerDocument.createElement('section');
  applyElementStyle(section, {display: 'grid', gap: '8px', fontSize: '13px', color: '#334155'});

  const details = rootElement.ownerDocument.createElement('details');
  applyElementStyle(details, {fontSize: '12px', color: '#475569'});
  const summaryElement = rootElement.ownerDocument.createElement('summary');
  summaryElement.textContent = 'How collapsed chains work';
  applyElementStyle(summaryElement, {cursor: 'pointer', fontWeight: '600', color: '#0f172a'});
  const description = rootElement.ownerDocument.createElement('p');
  description.textContent =
    'Linear chains collapse to a single node marked with plus and minus icons. Individual chains remain interactive on the canvas.';
  applyElementStyle(description, {margin: '8px 0 0', lineHeight: '1.5'});
  details.append(summaryElement, description);

  const statusRow = rootElement.ownerDocument.createElement('div');
  applyElementStyle(statusRow, {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: '#475569'
  });
  const statusLabel = rootElement.ownerDocument.createElement('span');
  statusLabel.textContent = 'Status';
  const statusValue = rootElement.ownerDocument.createElement('span');
  statusValue.textContent = `${collapsedChainCount} / ${totalChainCount} collapsed`;
  statusRow.append(statusLabel, statusValue);

  const controls = rootElement.ownerDocument.createElement('div');
  applyElementStyle(controls, {display: 'flex', gap: '8px', flexWrap: 'wrap'});
  controls.append(
    createActionButton(
      rootElement.ownerDocument,
      state.collapseEnabled ? 'Disable' : 'Enable',
      handlers.onToggleCollapseEnabled,
      {
        background: state.collapseEnabled ? '#4c6ef5' : '#1f2937'
      }
    ),
    createActionButton(
      rootElement.ownerDocument,
      'Collapse all',
      handlers.onCollapseAll,
      {background: '#2563eb'},
      collapseAllDisabled
    ),
    createActionButton(
      rootElement.ownerDocument,
      'Expand all',
      handlers.onExpandAll,
      {background: '#16a34a'},
      expandAllDisabled
    )
  );

  section.append(details, statusRow, controls);
  rootElement.replaceChildren(section);
}

function renderMetadataPanel(
  rootElement: HTMLElement,
  metadata?: ExampleMetadata,
  dataLoading?: boolean
) {
  const section = rootElement.ownerDocument.createElement('section');
  applyElementStyle(section, {
    display: 'grid',
    gap: '8px',
    fontSize: '13px',
    color: '#334155'
  });

  if (dataLoading) {
    const loading = rootElement.ownerDocument.createElement('p');
    loading.textContent = 'Loading dataset details...';
    applyElementStyle(loading, {margin: '0', fontSize: '12px', color: '#475569'});
    section.append(loading);
    rootElement.replaceChildren(section);
    return;
  }

  if (!metadata) {
    const empty = rootElement.ownerDocument.createElement('p');
    empty.textContent = 'No metadata available for this dataset yet.';
    applyElementStyle(empty, {margin: '0', fontSize: '12px', color: '#475569'});
    section.append(empty);
    rootElement.replaceChildren(section);
    return;
  }

  const grid = rootElement.ownerDocument.createElement('dl');
  applyElementStyle(grid, {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    columnGap: '12px',
    rowGap: '6px',
    margin: '0'
  });

  appendMetadataRow(grid, rootElement.ownerDocument, 'Source', metadata.sourceType === 'remote' ? 'Remote (URL)' : metadata.sourceType === 'inline' ? 'Inline sample' : undefined);
  appendMetadataRow(grid, rootElement.ownerDocument, 'Nodes', typeof metadata.nodeCount === 'number' ? metadata.nodeCount.toLocaleString() : undefined);
  appendMetadataRow(grid, rootElement.ownerDocument, 'Edges', typeof metadata.edgeCount === 'number' ? metadata.edgeCount.toLocaleString() : undefined);
  appendMetadataRow(grid, rootElement.ownerDocument, 'Graph ID', metadata.graphId);
  appendMetadataRow(
    grid,
    rootElement.ownerDocument,
    'Directed',
    metadata.directed !== undefined ? (metadata.directed ? 'Yes' : 'No') : undefined
  );
  appendMetadataRow(
    grid,
    rootElement.ownerDocument,
    'Strict',
    metadata.strict !== undefined ? (metadata.strict ? 'Yes' : 'No') : undefined
  );
  section.append(grid);

  const attributeEntries = metadata.attributes
    ? Object.entries(metadata.attributes).filter(([key]) => key.length)
    : [];
  if (attributeEntries.length) {
    const details = rootElement.ownerDocument.createElement('details');
    const summary = rootElement.ownerDocument.createElement('summary');
    summary.textContent = 'Additional attributes';
    applyElementStyle(summary, {cursor: 'pointer', fontWeight: '600', color: '#0f172a'});
    const list = rootElement.ownerDocument.createElement('ul');
    applyElementStyle(list, {
      margin: '8px 0 0',
      paddingLeft: '20px',
      display: 'grid',
      rowGap: '4px'
    });
    for (const [key, value] of attributeEntries) {
      const item = rootElement.ownerDocument.createElement('li');
      item.innerHTML = `<strong>${escapeHtml(key)}:</strong> ${escapeHtml(formatMetadataValue(value))}`;
      applyElementStyle(item, {color: '#475569'});
      list.append(item);
    }
    details.append(summary, list);
    section.append(details);
  }

  rootElement.replaceChildren(section);
}

function appendMetadataRow(grid: HTMLElement, document: Document, label: string, value?: string) {
  if (!value) {
    return;
  }

  const term = document.createElement('dt');
  term.textContent = label;
  applyElementStyle(term, {fontWeight: '600', color: '#0f172a', margin: '0'});
  const description = document.createElement('dd');
  description.textContent = value;
  applyElementStyle(description, {margin: '0', color: '#1f2937'});
  grid.append(term, description);
}

function createActionButton(
  document: Document,
  label: string,
  onClick: () => void,
  style: Record<string, string>,
  disabled = false
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.disabled = disabled;
  applyElementStyle(button, {
    border: 'none',
    borderRadius: '6px',
    padding: '6px 12px',
    fontFamily: 'inherit',
    fontSize: '12px',
    color: '#ffffff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? '0.5' : '1',
    ...style
  });
  button.addEventListener('click', onClick);
  return button;
}

function buildRankGrid(
  selectedLayout: LayoutType,
  layoutOptions: Record<string, unknown> | undefined,
  dagLayout: D3DagLayout | null
): RankGridConfig | false {
  if (!dagLayout || selectedLayout !== 'd3-dag-layout') {
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
}

function getSelectedExample(state: GraphViewerState): ExampleDefinition {
  return findExampleByName(state.examples, state.selectedExampleName) ?? state.examples[0] ?? EXAMPLES[0];
}

function getExamplesForType(graphType?: GraphExampleType): ExampleDefinition[] {
  const filteredExamples = filterExamplesByType(EXAMPLES, graphType);
  return filteredExamples.length ? filteredExamples : EXAMPLES;
}

function findExampleByName(examples: ExampleDefinition[], exampleName: string) {
  return examples.find((example) => example.name === exampleName);
}

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

function deriveMetadataFromData(data: unknown): ExampleMetadata | null {
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
}

function serializeStylesheet(stylesheet: unknown): string {
  if (!stylesheet) {
    return DEFAULT_STYLESHEET_MESSAGE;
  }

  return JSON.stringify(
    stylesheet,
    (_key, value) => (typeof value === 'function' ? value.toString() : value),
    2
  );
}

function getEventSourceBounds(source: ViewportSource): [[number, number], [number, number]] | null {
  if (!source) {
    return null;
  }

  if ('getLayoutBounds' in source && typeof source.getLayoutBounds === 'function') {
    return source.getLayoutBounds() as [[number, number], [number, number]] | null;
  }

  if ('getBounds' in source && typeof source.getBounds === 'function') {
    return source.getBounds() as [[number, number], [number, number]] | null;
  }

  return null;
}

function toDeckViewState(viewState: ViewState): DeckProps['viewState'] {
  return {
    target: viewState.target,
    zoom: viewState.zoom
  };
}

function applyElementStyle(element: HTMLElement, style: Record<string, string>) {
  for (const [key, value] of Object.entries(style)) {
    element.style.setProperty(camelCaseToKebabCase(key), value);
  }
}

function camelCaseToKebabCase(value: string) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function formatMetadataValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formatMetadataValue(entry)).join(', ');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return String(value);
    }
  }
  return String(value);
}

function isGraphTooltipObject(value: unknown): value is GraphTooltipObject {
  return typeof value === 'object' && value !== null;
}

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
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `.trim()
  };
}
