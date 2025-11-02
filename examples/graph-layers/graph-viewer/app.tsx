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
  _RadialLayout,
  _HivePlotLayout,
  _MultigraphLayout
} from '@deck.gl-community/graph-layers';

// import {ViewControlWidget} from '@deck.gl-community/graph-layers';
// import '@deck.gl/widgets/stylesheet.css';

import {extent} from 'd3-array';

import {ControlPanel, ExampleDefinition, LayoutType} from './control-panelt';
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
  'radial-layout': (options) => new _RadialLayout(options),
  'hive-plot-layout': (options) => new _HivePlotLayout(options),
  'force-multi-graph-layout': (options) => new _MultigraphLayout(options)
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
                    nodeStyle: selectedStyles?.nodeStyle,
                    edgeStyle: selectedStyles?.edgeStyle,
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
