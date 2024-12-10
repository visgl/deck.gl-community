// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {Component, useCallback, useEffect, useLayoutEffect, useMemo, useState, useReducer, useRef} from 'react';
import {createRoot} from 'react-dom/client';

import {D3ForceLayout, JSONLoader, NODE_TYPE} from '@deck.gl-community/graph-layers';

// eslint-disable-next-line import/no-unresolved
import {SAMPLE_GRAPH_DATASETS} from '../../../modules/graph-layers/test/data/graphs/sample-datasets';

import PropTypes from 'prop-types';
import DeckGL from '@deck.gl/react';
import {OrthographicView} from '@deck.gl/core';
import {GraphEngine, BaseLayout, Graph, GraphLayer, log, SimpleLayout} from '@deck.gl-community/graph-layers';
import {PositionedViewControl} from '@deck.gl-community/react';
import {ViewControlWidget} from '@deck.gl-community/graph-layers';
import '@deck.gl/widgets/stylesheet.css';

import {extent} from 'd3-array';


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

const INITIAL_VIEW_STATE = {
  // the target origin of th view
  target: [0, 0],
  // zoom level
  zoom: 1
};

// the default cursor in the view
const DEFAULT_CURSOR = 'default';

// GraphGL.propTypes = {
//   /** Input graph data */
//   graph: PropTypes.object.isRequired,
//   /** Layout algorithm */
//   layout: PropTypes.object.isRequired,
//   /** Node event callbacks */
//   nodeEvents: PropTypes.shape({
//     onClick: PropTypes.func,
//     onMouseLeave: PropTypes.func,
//     onHover: PropTypes.func,
//     onMouseEnter: PropTypes.func
//   }).isRequired,
//   /** Declarative node style */
//   nodeStyle: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.object, PropTypes.bool])),
//   /** Declarative edge style */
//   edgeStyle: PropTypes.oneOfType([
//     PropTypes.object,
//     PropTypes.arrayOf(
//       PropTypes.shape({
//         stroke: PropTypes.oneOfType([PropTypes.string, PropTypes.func]),
//         strokeWidth: PropTypes.oneOfType([PropTypes.number, PropTypes.func]),
//         decorators: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.object, PropTypes.bool]))
//       })
//     )
//   ]).isRequired,
//   /** Edge event callbacks */
//   edgeEvents: PropTypes.shape({
//     onClick: PropTypes.func,
//     onHover: PropTypes.func
//   }),
//   /** Error callback */
//   onError: PropTypes.func,
//   /** The initial view state of the viewport */
//   initialViewState: PropTypes.shape({
//     target: PropTypes.arrayOf(PropTypes.number),
//     zoom: PropTypes.number
//   }),
//   /** A component to control view state. */
//   ViewControlComponent: PropTypes.func,
//   /** A minimum scale factor for zoom level of the graph. */
//   minZoom: PropTypes.number,
//   /** A maximum scale factor for zoom level of the graph. */
//   maxZoom: PropTypes.number,
//   /** Padding for fitting entire graph in the screen. (pixel) */
//   viewportPadding: PropTypes.number,
//   /** Changes the scroll wheel sensitivity when zooming. This is a multiplicative modifier.
//    So, a value between 0 and 1 reduces the sensitivity (zooms slower),
//    and a value greater than 1 increases the sensitivity (zooms faster) */
//   wheelSensitivity: PropTypes.number,
//   /** Whether zooming the graph is enabled */
//   enableZooming: PropTypes.bool,
//   /** double-clicking causes zoom */
//   doubleClickZoom: PropTypes.bool,
//   /** Whether panning the graph is enabled */
//   enablePanning: PropTypes.bool,
//   /** Whether dragging the node is enabled */
//   enableDragging: PropTypes.bool,
//   /** Resume layout calculation after dragging a node */
//   resumeLayoutAfterDragging: PropTypes.bool,
//   /** The component to show while the graph is loading. */
//   loader: PropTypes.element,
//   /** The tooltip to show when hovering over a node or an edge. */
//   getTooltip: PropTypes.func
// };

const DEFAULT_NODE_SIZE = 5;

const DEFAULT_DATASET = 'Random (20, 40)';

const LAYOUTS = ['D3ForceLayout', 'GPUForceLayout', 'SimpleLayout'];

const graphData = SAMPLE_GRAPH_DATASETS[DEFAULT_DATASET]();
const graph = JSONLoader({json: graphData});
const layout = new D3ForceLayout(); // SimpleLayout();

export function App(props) {

  const [state, setState] = useState({
    selectedDataset: DEFAULT_DATASET,
    selectedLayout: DEFAULT_DATASET
  });

  const {selectedDataset} = state;

  const [engine, setEngine] = useState(new GraphEngine(graph, layout));
  const isFirstMount = useRef(true);

  useLayoutEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    debugger
    setEngine(new GraphEngine(graph, layout));
  }, [graph, layout]);

  useLayoutEffect(() => {
    engine.run();

    return () => {
      engine.clear();
    };
  }, [engine]);

  const nodeStyle = [],
    nodeEvents = {
      onMouseEnter: null,
      onHover: null,
      onMouseLeave: null,
      onClick: null,
      onDrag: null
    },
    edgeStyle = [
      {
        decorators: [],
        stroke: 'black',
        strokeWidth: 1
      }
    ],
    edgeEvents = {
      onClick: null,
      onHover: null
    },
    // eslint-disable-next-line no-console
    onError = (error) => console.error(error),
    initialViewState = INITIAL_VIEW_STATE,
    ViewControlComponent = PositionedViewControl,
    minZoom = -20,
    maxZoom = 20,
    viewportPadding = 50,
    wheelSensitivity = 0.5,
    enableZooming = true,
    doubleClickZoom = true,
    enablePanning = true,
    enableDragging = false,
    resumeLayoutAfterDragging = false,
    zoomToFitOnLoad = false;

  let loader = null,
    getTooltip,
    onHover;

  const [viewState, setViewState] = useState({
    ...INITIAL_VIEW_STATE,
    ...initialViewState
  });

  const [{isLoading}, loadingDispatch] = useLoading(engine) as any;

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

  // const handleChangeGraph = ({target: {value}}) => setState(state => ({...state, selectedDataset: value}));
  // const handleChangeLayout = ({target: {value}}) => setState(state => ({...state, selectedLayout: value}));

  // return (
  //    <div style={{width: '100%', zIndex: 999}}>
  //       <div>
  //         Dataset:
  //         <select value={state.selectedDataset} onChange={this.handleChangeGraph}>
  //           {Object.keys(SAMPLE_GRAPH_DATASETS).map((data) => (
  //             <option key={data} value={data}>
  //               {data}
  //             </option>
  //           ))}
  //         </select>
  //       </div>
  //       <div>
  //         Layout:
  //         <select value={state.selectedLayout} onChange={this.handleChangeLayout}>
  //           {LAYOUTS.map((data) => (
  //             <option key={data} value={data}>
  //               {data}
  //             </option>
  //           ))}
  //         </select>
  //       </div>
  //     </div>

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
      <div style={{width: '100%', flex: 1}}>
        <>
          {isLoading && loader}
          <div style={{visibility: isLoading ? 'hidden' : 'visible'}}>
            <DeckGL
              onError={onError}
              onAfterRender={useCallback(
                () => loadingDispatch({type: 'afterRender'}),
                [loadingDispatch]
              )}
              width="100%"
              height="100%"
              getCursor={useCallback(() => DEFAULT_CURSOR, [])}
              viewState={viewState as any}
              onResize={useCallback(
                ({width, height}) => setViewState((prev) => ({...prev, width, height})),
                []
              )}
              onViewStateChange={useCallback(
                ({viewState: nextViewState}) => setViewState(nextViewState as any),
                []
              )}
              views={[
                new OrthographicView({
                  controller: {
                    minZoom,
                    maxZoom,
                    scrollZoom: enableZooming,
                    touchZoom: enableZooming,
                    doubleClickZoom: enableZooming && doubleClickZoom,
                    dragPan: enablePanning
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
                    stroke: '#000',
                    strokeWidth: 1
                  },
                  nodeEvents,
                  edgeEvents,
                  enableDragging,
                  resumeLayoutAfterDragging
                })
              ]}
              widgets={[
                // TODO - replace 
                // new ViewControlWidget({})
              ]}
              getTooltip={getTooltip}
              onHover={onHover}
            />
            {/* View control component */
              <ViewControlComponent
                fitBounds={fitBounds}
                panBy={panBy}
                zoomBy={zoomBy}
                zoomLevel={viewState.zoom}
                maxZoom={maxZoom}
                minZoom={minZoom}
              />
            }
          </div>
        </>
      </div>
    </div>
  );
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
