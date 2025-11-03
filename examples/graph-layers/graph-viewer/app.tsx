// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useLayoutEffect, useMemo, useState, useReducer, useRef} from 'react';
import {createRoot} from 'react-dom/client';

import DeckGL from '@deck.gl/react';

import {OrthographicView} from '@deck.gl/core';
import {
  GraphEngine,
  GraphLayer,
  GraphLayout,
  SimpleLayout,
  D3ForceLayout,
  GPUForceLayout,
  JSONLoader,
  RadialLayout,
  HivePlotLayout,
  ForceMultiGraphLayout,
  D3DagLayout
} from '@deck.gl-community/graph-layers';

// import {ViewControlWidget} from '@deck.gl-community/graph-layers';
// import '@deck.gl/widgets/stylesheet.css';

import {extent} from 'd3-array';

import {ControlPanel, ExampleDefinition, LayoutType} from './control-panel';
import {DEFAULT_EXAMPLE, EXAMPLES} from './examples';

const INITIAL_VIEW_STATE = {
  /** the target origin of the view */
  target: [0, 0],
  /** zoom level */
  zoom: 1
};

// the default cursor in the view
const DEFAULT_CURSOR = 'default';
const DEFAULT_LAYOUT = DEFAULT_EXAMPLE?.layouts[0] ?? 'd3-force-layout';

type LayoutFactory = (options?: Record<string, unknown>) => GraphLayout;

const LAYOUT_FACTORIES: Record<LayoutType, LayoutFactory> = {
  'd3-force-layout': () => new D3ForceLayout(),
  'gpu-force-layout': () => new GPUForceLayout(),
  'simple-layout': () => new SimpleLayout(),
  'radial-layout': (options) => new RadialLayout(options),
  'hive-plot-layout': (options) => new HivePlotLayout(options),
  'force-multi-graph-layout': (options) => new ForceMultiGraphLayout(options),
  'd3-dag-layout': (options) => new D3DagLayout(options),
};


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

export const useLoading = (engine) => {
  const [{isLoading}, loadingDispatch] = useReducer(loadingReducer, {isLoading: true});

  useLayoutEffect(() => {
    if (!engine) {
      return () => undefined;
    }

    const layoutStarted = () => loadingDispatch({type: 'startLayout'});
    const layoutEnded = () => loadingDispatch({type: 'layoutDone'});

    engine.addEventListener('onLayoutStart', layoutStarted);
    engine.addEventListener('onLayoutDone', layoutEnded);

    return () => {
      engine.removeEventListener('onLayoutStart', layoutStarted);
      engine.removeEventListener('onLayoutDone', layoutEnded);
    };
  }, [engine]);

  return [{isLoading}, loadingDispatch];
};

export function App(props) {
  const [selectedExample, setSelectedExample] = useState<ExampleDefinition | undefined>(DEFAULT_EXAMPLE);
  const [selectedLayout, setSelectedLayout] = useState<LayoutType>(DEFAULT_LAYOUT);
  const [collapseEnabled, setCollapseEnabled] = useState(true);
  const [dagChainSummary, setDagChainSummary] = useState<
    {chainIds: string[]; collapsedIds: string[]}
  | null>(null);

  const graphData = useMemo(() => selectedExample?.data(), [selectedExample]);
  const layoutOptions = useMemo(
    () =>
      selectedExample && selectedLayout && graphData
        ? selectedExample.getLayoutOptions?.(selectedLayout, graphData)
        : undefined,
    [selectedExample, selectedLayout, graphData]
  );
  const graph = useMemo(() => (graphData ? JSONLoader({json: graphData}) : null), [graphData]);
  const layout = useMemo(() => {
    if (!selectedLayout) {
      return null;
    }

    const factory = LAYOUT_FACTORIES[selectedLayout];
    return factory ? factory(layoutOptions) : null;
  }, [selectedLayout, layoutOptions]);
  const engine = useMemo(() => (graph && layout ? new GraphEngine({graph, layout}) : null), [graph, layout]);
  const isFirstMount = useRef(true);
  const dagLayout = layout instanceof D3DagLayout ? (layout as D3DagLayout) : null;

  useLayoutEffect(() => {
    if (!engine) {
      return () => undefined;
    }

    if (isFirstMount.current) {
      isFirstMount.current = false;
    }

    engine.run();

    return () => {
      engine.stop();
      engine.clear();
    };
  }, [engine]);

  // eslint-disable-next-line no-console
  const initialViewState = INITIAL_VIEW_STATE;
  const minZoom = -20;
  const maxZoom = 20;
  const viewportPadding = 50;
  // const enableDragging = false;
  const resumeLayoutAfterDragging = false;
  const zoomToFitOnLoad = false;

  const [viewState, setViewState] = useState({
    ...INITIAL_VIEW_STATE,
    ...initialViewState
  });

  const [{isLoading}, loadingDispatch] = useLoading(engine) as any;

  const selectedStyles = selectedExample?.style;
  const isDagLayout = selectedLayout === 'd3-dag-layout';
  const totalChainCount = dagChainSummary?.chainIds.length ?? 0;
  const collapsedChainCount = dagChainSummary?.collapsedIds.length ?? 0;
  const collapseAllDisabled =
    !collapseEnabled || !dagChainSummary || dagChainSummary.chainIds.length === 0;
  const expandAllDisabled =
    !collapseEnabled || !dagChainSummary || dagChainSummary.collapsedIds.length === 0;

  useEffect(() => {
    if (isDagLayout) {
      setCollapseEnabled(true);
    }
  }, [isDagLayout, selectedExample]);

  useEffect(() => {
    if (!dagLayout) {
      return;
    }
    dagLayout.setPipelineOptions({collapseLinearChains: collapseEnabled});
    if (!collapseEnabled) {
      dagLayout.setCollapsedChains([]);
    }
  }, [dagLayout, collapseEnabled]);

  useEffect(() => {
    if (!engine || !dagLayout) {
      setDagChainSummary(isDagLayout ? {chainIds: [], collapsedIds: []} : null);
      return;
    }

    const updateChainSummary = () => {
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

      setDagChainSummary({chainIds, collapsedIds});
    };

    updateChainSummary();

    const handleLayoutChange = () => updateChainSummary();
    const handleLayoutDone = () => updateChainSummary();

    engine.addEventListener('onLayoutChange', handleLayoutChange);
    engine.addEventListener('onLayoutDone', handleLayoutDone);

    return () => {
      engine.removeEventListener('onLayoutChange', handleLayoutChange);
      engine.removeEventListener('onLayoutDone', handleLayoutDone);
    };
  }, [engine, dagLayout, isDagLayout]);

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

  const fitBounds = useCallback(() => {
    if (!engine) {
      return;
    }

    const data = engine.getNodes();
    if (!data.length) {
      return;
    }

    const {width, height} = viewState as any;

    // get the projected position of all nodes
    const positions = data.map((d) => engine.getNodePosition(d));
    // get the value range of x and y
    const xExtent = extent(positions, (d) => d[0]);
    const yExtent = extent(positions, (d) => d[1]);
    const newTarget = [(xExtent[0] + xExtent[1]) / 2, (yExtent[0] + yExtent[1]) / 2];
    const zoom = Math.min(
      width / (xExtent[1] - xExtent[0] + viewportPadding * 2),
      height / (yExtent[1] - yExtent[0] + viewportPadding * 2)
    );
    // zoom value is at log scale
    const newZoom = Math.min(Math.max(minZoom, Math.log(zoom)), maxZoom);
    setViewState({
      ...viewState,
      target: newTarget,
      zoom: newZoom
    });
  }, [engine, viewState, setViewState, viewportPadding, minZoom, maxZoom]);

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

  useEffect(() => {
    if (!engine) {
      return () => undefined;
    }

    if (zoomToFitOnLoad && isLoading) {
      engine.addEventListener('onLayoutDone', fitBounds, {once: true});
    }
    return () => {
      engine.removeEventListener('onLayoutDone', fitBounds);
    };
  }, [engine, isLoading, fitBounds, zoomToFitOnLoad]);
  const handleExampleChange = useCallback((example: ExampleDefinition, layoutType: LayoutType) => {
    setSelectedExample(example);
    setSelectedLayout(layoutType);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
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
          onAfterRender={() => loadingDispatch({type: 'afterRender'})}
          width="100%"
          height="100%"
          getCursor={() => DEFAULT_CURSOR}
          viewState={viewState as any}
          onResize={({width, height}) => setViewState((prev) => ({...prev, width, height}))}
          onViewStateChange={({viewState}) => setViewState(viewState as any)}
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
            engine
              ? [
                  new GraphLayer({
                    engine,
                    stylesheet: selectedStyles,
                    resumeLayoutAfterDragging
                  })
                ]
              : []
          }
          widgets={[
            // // new ViewControlWidget({}) TODO - fix and enable
          ]
            // onHover={(info) => console.log('Hover', info)}
          }
          getTooltip={(info) => getToolTip(info.object)}
        />
        {/* View control component TODO - doesn't work in website, replace with widget *
          <PositionedViewControl
            fitBounds={fitBounds}
            panBy={panBy}
            zoomBy={zoomBy}
            zoomLevel={viewState.zoom}
            maxZoom={maxZoom}
            minZoom={minZoom}
          />
        */}
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
          overflowY: 'auto',
          fontFamily: 'inherit'
        }}
      >
        {isDagLayout ? (
          <section style={{marginBottom: '1.5rem', fontSize: '0.875rem', lineHeight: 1.5}}>
            <h3 style={{margin: '0 0 0.5rem', fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
              Collapsed chains
            </h3>
            <p style={{margin: '0 0 0.75rem', color: '#334155'}}>
              Linear chains collapse to a single node marked with plus and minus icons. Use these controls to
              expand or collapse all chains. Individual chains remain interactive on the canvas.
            </p>
            <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: '#475569'}}>
                <span>Status</span>
                <span>
                  {collapsedChainCount} / {totalChainCount} collapsed
                </span>
              </div>
              <div style={{display: 'flex', gap: '0.5rem', flexWrap: 'wrap'}}>
                <button
                  type="button"
                  onClick={handleToggleCollapseEnabled}
                  style={{
                    background: collapseEnabled ? '#4c6ef5' : '#1f2937',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '0.375rem',
                    padding: '0.375rem 0.75rem',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8125rem'
                  }}
                >
                  {collapseEnabled ? 'Disable collapse' : 'Enable collapse'}
                </button>
                <button
                  type="button"
                  onClick={handleCollapseAll}
                  disabled={collapseAllDisabled}
                  style={{
                    background: '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '0.375rem',
                    padding: '0.375rem 0.75rem',
                    cursor: collapseAllDisabled ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8125rem',
                    opacity: collapseAllDisabled ? 0.5 : 1
                  }}
                >
                  Collapse all
                </button>
                <button
                  type="button"
                  onClick={handleExpandAll}
                  disabled={expandAllDisabled}
                  style={{
                    background: '#16a34a',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '0.375rem',
                    padding: '0.375rem 0.75rem',
                    cursor: expandAllDisabled ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    fontSize: '0.8125rem',
                    opacity: expandAllDisabled ? 0.5 : 1
                  }}
                >
                  Expand all
                </button>
              </div>
            </div>
          </section>
        ) : null}
        <ControlPanel examples={EXAMPLES} onExampleChange={handleExampleChange} />
      </aside>
    </div>
  );
}

function getToolTip(object) {
  if (!object) {
    return null;
  }
  const type = object.isNode ? 'Node' : 'Edge';
  return `${type}: ${JSON.stringify(object?._data)}`;
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
