// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useLayoutEffect, useMemo, useState, useReducer} from 'react';
import {createRoot} from 'react-dom/client';

import DeckGL from '@deck.gl/react';
import {PositionedViewControl} from '@deck.gl-community/react';

import {OrthographicView} from '@deck.gl/core';
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
    const layoutStarted = () => loadingDispatch({type: 'startLayout'});
    const layoutEnded = () => loadingDispatch({type: 'layoutDone'});

    console.log('adding listeners')
    engine.addEventListener('onLayoutStart', layoutStarted);
    engine.addEventListener('onLayoutDone', layoutEnded);

    return () => {
      console.log('removing listeners')
      engine.removeEventListener('onLayoutStart', layoutStarted);
      engine.removeEventListener('onLayoutDone', layoutEnded);
    };
  }, [engine]);

  return [{isLoading}, loadingDispatch];
};

export function App(props) {
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

  const edgeStyle = [
    {
      decorators: [],
      stroke: 'black',
      strokeWidth: 1
    }
  ],
    // eslint-disable-next-line no-console
    initialViewState = INITIAL_VIEW_STATE,
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

  const [{isLoading}, loadingDispatch] = useLoading(engine) as any;

  useEffect(() => {
    loadingDispatch({type: 'startLayout'});
    engine.run();

    return () => {
      engine.clear();
    };
  }, [engine, loadingDispatch]);

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

  // Relatively pan the graph by a specified position vector.
  const panBy = useCallback(
    (dx, dy) =>
      setViewState({
        ...viewState,
        target: [viewState.target[0] + dx, viewState.target[1] + dy]
      }),
    [viewState, setViewState]
  );

  // Relatively zoom the graph by a delta zoom level
  const zoomBy = useCallback(
    (deltaZoom) => {
      const newZoom = viewState.zoom + deltaZoom;
      setViewState({
        ...viewState,
        zoom: Math.min(Math.max(newZoom, minZoom), maxZoom)
      });
    },
    [maxZoom, minZoom, viewState, setViewState]
  );

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
      <div style={{width: '100%', flex: 1}}>
        <>
          {isLoading}
          <div style={{visibility: isLoading ? 'hidden' : 'visible'}}>
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
              ]}
              layers={[
                new GraphLayer({
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
                  resumeLayoutAfterDragging
                })
              ]}
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
        </>
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
