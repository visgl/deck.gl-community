// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useLayoutEffect, useMemo, useState, useReducer} from 'react';
import {createRoot} from 'react-dom/client';

import DeckGL from '@deck.gl/react';

import {OrthographicView} from '@deck.gl/core';
import type {GraphLayoutState} from '@deck.gl-community/graph-layers';
import {
  GraphEngine,
  GraphLayer,
  Graph,
  GraphLayout,
  SimpleLayout,
  D3ForceLayout,
  GPUForceLayout,
  JSONLoader,
  NODE_TYPE
} from '@deck.gl-community/graph-layers';

// import {ViewControlWidget} from '@deck.gl-community/graph-layers';
import '@deck.gl/widgets/stylesheet.css';

import {extent} from 'd3-array';

// eslint-disable-next-line import/no-unresolved
import {SAMPLE_GRAPH_DATASETS} from '../../../modules/graph-layers/test/data/graphs/sample-datasets';

const INITIAL_VIEW_STATE = {
  /** the target origin of the view */
  target: [0, 0],
  /** zoom level */
  zoom: 1
};

const LAYOUTS = ['D3ForceLayout', 'GPUForceLayout', 'SimpleLayout'] as const;
type LayoutOption = (typeof LAYOUTS)[number];
const DEFAULT_LAYOUT: LayoutOption = LAYOUTS[0];

const LAYOUT_FACTORIES: Record<LayoutOption, () => GraphLayout> = {
  D3ForceLayout: () => new D3ForceLayout(),
  GPUForceLayout: () => new GPUForceLayout(),
  SimpleLayout: () => new SimpleLayout()
};

// the default cursor in the view
const DEFAULT_CURSOR = 'default';
const DEFAULT_NODE_SIZE = 5;
const DEFAULT_DATASET = 'Random (20, 40)';

// const nodeEvents = {
//   onMouseEnter: null,
//   onHover: null,
//   onMouseLeave: null,
//   onClick: null,
//   onDrag: null
// },
//   edgeEvents = {
//   onClick: null,
//   onHover: null
// },


type LoadingState = {
  loaded: boolean;
  rendered: boolean;
  isLoading: boolean;
};

type LoadingAction =
  | {type: 'reset'; layoutState?: GraphLayoutState}
  | {type: 'startLayout'}
  | {type: 'layoutDone'}
  | {type: 'afterRender'};

const deriveLoadingState = (layoutState?: GraphLayoutState): LoadingState => {
  const loaded = layoutState === 'DONE';
  return {
    loaded,
    rendered: false,
    isLoading: !loaded
  };
};

const loadingReducer = (state: LoadingState, action: LoadingAction): LoadingState => {
  switch (action.type) {
    case 'reset':
      return deriveLoadingState(action.layoutState);
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

export const useLoading = (engine: GraphEngine) => {
  const [{isLoading}, loadingDispatch] = useReducer(
    loadingReducer,
    engine?.getLayoutState(),
    deriveLoadingState
  );

  useLayoutEffect(() => {
    loadingDispatch({type: 'reset', layoutState: engine?.getLayoutState()});

    if (!engine) {
      return undefined;
    }

    const layoutStarted = () => loadingDispatch({type: 'startLayout'});
    const layoutEnded = () => loadingDispatch({type: 'layoutDone'});

    engine.addEventListener('onLayoutStart', layoutStarted);
    engine.addEventListener('onLayoutDone', layoutEnded);

    if (engine.getLayoutState() === 'DONE') {
      loadingDispatch({type: 'layoutDone'});
    }

    return () => {
      engine.removeEventListener('onLayoutStart', layoutStarted);
      engine.removeEventListener('onLayoutDone', layoutEnded);
    };
  }, [engine]);

  return [{isLoading}, loadingDispatch] as const;
};

export function App() {
  const [selectedDataset, setSelectedDataset] = useState(DEFAULT_DATASET);
  const [selectedLayout, setSelectedLayout] = useState<LayoutOption>(DEFAULT_LAYOUT);

  const graphData = useMemo(() => {
    const datasetLoader =
      SAMPLE_GRAPH_DATASETS[selectedDataset] ?? SAMPLE_GRAPH_DATASETS[DEFAULT_DATASET];
    return datasetLoader();
  }, [selectedDataset]);

  const graph = useMemo(() => JSONLoader({json: graphData}) as Graph, [graphData]);

  const layout = useMemo<GraphLayout>(() => {
    const createLayout = LAYOUT_FACTORIES[selectedLayout] ?? LAYOUT_FACTORIES[DEFAULT_LAYOUT];
    return createLayout();
  }, [selectedLayout]);

  const engine = useMemo(() => new GraphEngine({graph, layout}), [graph, layout]);

  const initialViewState = INITIAL_VIEW_STATE,
    minZoom = -20,
    maxZoom = 20,
    viewportPadding = 50,
    enableDragging = false,
    resumeLayoutAfterDragging = false,
    zoomToFitOnLoad = false;

  const [viewState, setViewState] = useState({
    ...INITIAL_VIEW_STATE,
    ...initialViewState
  });

  const [{isLoading}, loadingDispatch] = useLoading(engine);

  const fitBounds = useCallback(() => {
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

  useEffect(() => {
    if (zoomToFitOnLoad && isLoading) {
      engine.addEventListener('onLayoutDone', fitBounds, {once: true});
    }
    return () => {
      engine.removeEventListener('onLayoutDone', fitBounds);
    };
  }, [engine, isLoading, fitBounds, zoomToFitOnLoad]);


  const handleChangeGraph = useCallback(
    ({target: {value}}) => setSelectedDataset(value),
    []
  );
  const handleChangeLayout = useCallback(
    ({target: {value}}) => setSelectedLayout(value as LayoutOption),
    []
  );

  const views = useMemo(
    () => [
      new OrthographicView({
        controller: {
          minZoom,
          maxZoom,
          scrollZoom: true,
          touchZoom: true,
          doubleClickZoom: true,
          dragPan: true,
          wheelSensitivity: 0.5
        } as any
      })
    ],
    [minZoom, maxZoom]
  );

  const layers = useMemo(
    () => [
      new GraphLayer({
        id: 'graph-layer',
        engine,
        nodeStyle: [
          {
            type: NODE_TYPE.CIRCLE,
            radius: DEFAULT_NODE_SIZE,
            fill: 'red'
          }
        ],
        edgeStyle: {
          decorators: [],
          stroke: 'black',
          strokeWidth: 1
        },
        enableDragging,
        resumeLayoutAfterDragging
      })
    ],
    [engine, enableDragging, resumeLayoutAfterDragging]
  );

  const handleAfterRender = useCallback(() => loadingDispatch({type: 'afterRender'}), [loadingDispatch]);
  const handleResize = useCallback(
    ({width, height}) => setViewState((prev) => ({...prev, width, height})),
    []
  );
  const handleViewStateChange = useCallback(
    ({viewState: nextViewState}) => setViewState(nextViewState as any),
    []
  );
  const getCursor = useCallback(() => DEFAULT_CURSOR, []);

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
      <div style={{width: '100%', zIndex: 999}}>
        <div>
          Dataset:
          <select value={selectedDataset} onChange={handleChangeGraph}>
            {Object.keys(SAMPLE_GRAPH_DATASETS).map((data) => (
              <option key={data} value={data}>
                {data}
              </option>
            ))}
          </select>
        </div>
        <div>
          Layout:
          <select value={selectedLayout} onChange={handleChangeLayout}>
            {LAYOUTS.map((data) => (
              <option key={data} value={data}>
                {data}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{position: 'relative', width: '100%', flex: 1}}>
        {isLoading ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none'
            }}
          >
            Loading...
          </div>
        ) : null}
        <DeckGL
          onError={(error) => console.error(error)}
          onAfterRender={handleAfterRender}
          width="100%"
          height="100%"
          getCursor={getCursor}
          viewState={viewState as any}
          onResize={handleResize}
          onViewStateChange={handleViewStateChange}
          views={views}
          layers={layers}
          widgets={[
            // // new ViewControlWidget({}) TODO - fix and enable
          ]
            // onHover={(info) => console.log('Hover', info)}
          }
          getTooltip={(info) => getToolTip(info.object)}
        />
      </div>
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
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(<App />);
  }
}
