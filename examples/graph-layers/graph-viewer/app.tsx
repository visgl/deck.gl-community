// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable max-statements, complexity */

import React, {useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef} from 'react';
import {createRoot} from 'react-dom/client';

import DeckGL from '@deck.gl/react';

import {OrthographicView} from '@deck.gl/core';
import {PanWidget, ZoomRangeWidget} from '@deck.gl-community/widgets';
// import '@deck.gl/widgets/stylesheet.css';
import {
  GraphLayer,
  GraphEngine,
  GraphLayout,
  type Graph,
  type GraphLayoutEventDetail,
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
import type {LayoutType, ExampleDefinition, GraphExampleType} from './layout-options';
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


type LoadingState = {loaded: boolean; rendered: boolean; isLoading: boolean};

const INITIAL_LOADING_STATE: LoadingState = {loaded: false, rendered: false, isLoading: true};

type DagChainSummary = {chainIds: string[]; collapsedIds: string[]};

type AppState = {
  selectedExample: ExampleDefinition | undefined;
  selectedLayout: LayoutType;
  layoutOverrides: Partial<Record<LayoutType, Record<string, unknown>>>;
  collapseEnabled: boolean;
  dagChainSummary: DagChainSummary | null;
  stylesheetValue: string;
  loading: LoadingState;
};

const createStylesheetValue = (style: ExampleDefinition['style'] | undefined): string => {
  if (!style) {
    return DEFAULT_STYLESHEET_MESSAGE;
  }

  return JSON.stringify(
    style,
    (_key, value) => (typeof value === 'function' ? value.toString() : value),
    2
  );
};

const createInitialState = (
  example: ExampleDefinition | undefined,
  layoutType: LayoutType
): AppState => ({
  selectedExample: example,
  selectedLayout: layoutType,
  layoutOverrides: {},
  collapseEnabled: true,
  dagChainSummary: null,
  stylesheetValue: createStylesheetValue(example?.style),
  loading: INITIAL_LOADING_STATE
});

const areArraysEqual = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const areDagSummariesEqual = (a: DagChainSummary | null, b: DagChainSummary | null) => {
  if (a === b) {
    return true;
  }

  if (!a || !b) {
    return !a && !b;
  }

  return areArraysEqual(a.chainIds, b.chainIds) && areArraysEqual(a.collapsedIds, b.collapsedIds);
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

  const [appState, setAppState] = useState<AppState>(() =>
    createInitialState(defaultExample, defaultLayout)
  );

  const {
    selectedExample,
    selectedLayout,
    layoutOverrides,
    collapseEnabled,
    dagChainSummary,
    stylesheetValue,
    loading
  } = appState;

  useEffect(() => {
    setAppState((current) => {
      const nextState = createInitialState(defaultExample, defaultLayout);
      if (
        current.selectedExample === nextState.selectedExample &&
        current.selectedLayout === nextState.selectedLayout
      ) {
        return current;
      }
      return nextState;
    });
  }, [defaultExample, defaultLayout]);

  const graphData = useMemo(() => selectedExample?.data(), [selectedExample]);
  const layoutOptions = useMemo(() => {
    if (!selectedExample || !selectedLayout) {
      return undefined;
    }

    const baseOptions = graphData
      ? selectedExample.getLayoutOptions?.(selectedLayout, graphData)
      : undefined;
    const overrides = layoutOverrides[selectedLayout];

    if (baseOptions && overrides) {
      return {...baseOptions, ...overrides};
    }

    return overrides ?? baseOptions;
  }, [selectedExample, selectedLayout, graphData, layoutOverrides]);
  const graph = useMemo<Graph | null>(
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
  const engine = useMemo<GraphEngine | null>(
    () => (graph && layout ? new GraphEngine({graph, layout}) : null),
    [graph, layout]
  );
  const dagLayout = layout instanceof D3DagLayout ? (layout as D3DagLayout) : null;
  const selectedStyles = selectedExample?.style;

  useLayoutEffect(() => {
    if (!engine) {
      return () => undefined;
    }

    engine.run();

    return () => {
      engine.stop();
      engine.clear();
    };
  }, [engine]);

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

  const stylesheetDraftRef = useRef<string>(stylesheetValue);

  useEffect(() => {
    stylesheetDraftRef.current = stylesheetValue;
  }, [stylesheetValue]);

  useEffect(() => {
    const nextValue = serializedStylesheet || DEFAULT_STYLESHEET_MESSAGE;
    stylesheetDraftRef.current = nextValue;
    setAppState((current) =>
      current.stylesheetValue === nextValue ? current : {...current, stylesheetValue: nextValue}
    );
  }, [serializedStylesheet]);

  const handleStylesheetChange = useCallback((nextValue: string) => {
    stylesheetDraftRef.current = nextValue;
    setAppState((current) => ({...current, stylesheetValue: nextValue}));
  }, []);

  const handleStylesheetSubmit = useCallback((nextValue: string) => {
    stylesheetDraftRef.current = nextValue;
    setAppState((current) => ({...current, stylesheetValue: nextValue}));
  }, []);

  // eslint-disable-next-line no-console
  const initialViewState = INITIAL_VIEW_STATE;
  const minZoom = -20;
  const maxZoom = 20;
  // const enableDragging = false;
  const resumeLayoutAfterDragging = false;

  const {viewState, onResize, onViewStateChange, layoutCallbacks} = useGraphViewport(engine, {
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

  const {isLoading} = loading;

  const isDagLayout = selectedLayout === 'd3-dag-layout';

  const updateChainSummary = useCallback(() => {
    if (!engine || !dagLayout) {
      const nextSummary = isDagLayout ? {chainIds: [], collapsedIds: []} : null;
      setAppState((current) =>
        areDagSummariesEqual(current.dagChainSummary, nextSummary)
          ? current
          : {...current, dagChainSummary: nextSummary}
      );
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

    setAppState((current) => {
      const nextSummary = {chainIds, collapsedIds};
      return areDagSummariesEqual(current.dagChainSummary, nextSummary)
        ? current
        : {...current, dagChainSummary: nextSummary};
    });
  }, [engine, dagLayout, isDagLayout]);

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
      setAppState((current) =>
        current.collapseEnabled ? current : {...current, collapseEnabled: true}
      );
    }
  }, [isDagLayout]);

  useEffect(() => {
    if (!dagLayout) {
      return;
    }
    dagLayout.setProps({collapseLinearChains: collapseEnabled});
    if (!collapseEnabled) {
      dagLayout.setCollapsedChains([]);
    }
  }, [dagLayout, collapseEnabled]);

  useEffect(() => {
    updateChainSummary();
  }, [updateChainSummary]);

  const handleLayoutStart = useCallback(
    (detail?: GraphLayoutEventDetail) => {
      layoutCallbacks.onLayoutStart(detail);
      updateChainSummary();
    },
    [layoutCallbacks, updateChainSummary]
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
      layoutCallbacks.onLayoutDone(detail);
      updateChainSummary();
    },
    [layoutCallbacks, updateChainSummary]
  );

  const handleToggleCollapseEnabled = useCallback(() => {
    setAppState((current) => ({...current, collapseEnabled: !current.collapseEnabled}));
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
    setAppState((current) => ({
      ...current,
      selectedExample: example,
      selectedLayout: layoutType
    }));
  }, []);

  const handleApplyLayoutOptions = useCallback(
    (layoutType: LayoutType, options: Record<string, unknown>) => {
      setAppState((current) => ({
        ...current,
        layoutOverrides: {...current.layoutOverrides, [layoutType]: options}
      }));
    },
    []
  );

  useLayoutEffect(() => {
    if (!layout) {
      return () => undefined;
    }

    const handleLayoutStart = () => {
      setAppState((current) => ({...current, loading: INITIAL_LOADING_STATE}));
    };
    const handleLayoutDone = () => {
      setAppState((current) => {
        if (current.loading.loaded) {
          return current;
        }
        return {...current, loading: {...current.loading, loaded: true}};
      });
    };

    layout.addEventListener('onLayoutStart', handleLayoutStart);
    layout.addEventListener('onLayoutDone', handleLayoutDone);

    return () => {
      layout.removeEventListener('onLayoutStart', handleLayoutStart);
      layout.removeEventListener('onLayoutDone', handleLayoutDone);
    };
  }, [layout]);

  const handleAfterRender = useCallback(() => {
    setAppState((current) => {
      const {loaded, rendered} = current.loading;
      if (!loaded || rendered) {
        return current;
      }

      return {...current, loading: {...current.loading, rendered: true, isLoading: false}};
    });
  }, []);

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
          onError={(error) => console.error(error)}
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
          layers={
            graph && layout && engine
              ? [
                new GraphLayer({
                  data: engine,
                  engine,
                  layout,
                  stylesheet: selectedStyles,
                  onLayoutStart: handleLayoutStart,
                  onLayoutChange: handleLayoutChange,
                  onLayoutDone: handleLayoutDone,
                  resumeLayoutAfterDragging,
                  rankGrid
                })
              ]
              : []
          }
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
