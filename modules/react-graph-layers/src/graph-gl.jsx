import React, {useCallback, useEffect, useState, useReducer} from 'react';
import PropTypes from 'prop-types';
import DeckGL from '@deck.gl/react';
import {OrthographicView} from '@deck.gl/core';
import {extent} from 'd3-array';
import ViewControl from './components/view-control.jsx';

import {Graph, log, SimpleLayout, BaseLayout, GraphEngine, GraphLayer} from 'deck-graph-layers';

const INITIAL_VIEW_STATE = {
  // the target origin of th view
  target: [0, 0],
  // zoom level
  zoom: 1
};

// the default cursor in the view
const DEFAULT_CURSOR = 'default';

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

// A wrapper for positioning the ViewControl component
const PositionedViewControl = ({fitBounds, panBy, zoomBy, zoomLevel, maxZoom, minZoom}) => (
  <div style={{position: 'relative', top: '20px', left: '20px'}}>
    <ViewControl
      fitBounds={fitBounds}
      panBy={panBy}
      zoomBy={zoomBy}
      zoomLevel={zoomLevel}
      maxZoom={maxZoom}
      minZoom={minZoom}
    />
  </div>
);

const GraphGl = ({
  graph = new Graph(),
  layout = new SimpleLayout(),
  nodeStyle = [],
  nodeEvents = {
    onMouseEnter: null,
    onHover: null,
    onMouseLeave: null,
    onClick: null,
    onDrag: null
  },
  edgeStyle = {
    decorators: [],
    stroke: 'black',
    strokeWidth: 1
  },
  edgeEvents = {
    onClick: null,
    onHover: null
  },
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
  zoomToFitOnLoad = false,
  loader = null
}) => {
  if (!(graph instanceof Graph)) {
    log.error('Invalid graph data class')();
    return null;
  }
  if (!(layout instanceof BaseLayout)) {
    log.error('Invalid layout class')();
    return null;
  }

  const [viewState, setViewState] = useState({
    ...INITIAL_VIEW_STATE,
    ...initialViewState
  });

  const [engine] = useState(new GraphEngine());
  const [{isLoading}, loadingDispatch] = useReducer(loadingReducer, {isLoading: true});

  useEffect(() => {
    const layoutStarted = () => loadingDispatch({type: 'startLayout'});
    const layoutEnded = () => loadingDispatch({type: 'layoutDone'});

    engine.addEventListener('onLayoutStart', layoutStarted);
    engine.addEventListener('onLayoutDone', layoutEnded);

    return () => {
      engine.removeEventListener('onLayoutStart', layoutStarted);
      engine.removeEventListener('onLayoutDone', layoutEnded);
    };
  }, [engine]);

  useEffect(() => {
    engine.run(graph, layout);

    return () => {
      engine.clear();
    };
  }, [graph, layout]);

  const onViewStateChange = useCallback(
    ({viewState: nextViewState}) => setViewState(nextViewState),
    [setViewState]
  );

  const onResize = useCallback(
    ({width, height}) =>
      setViewState({
        ...viewState,
        width,
        height
      }),
    [viewState, setViewState]
  );

  const fitBounds = useCallback(() => {
    const {width, height} = viewState;
    const data = engine.getGraph().getNodes();

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
  }, [viewState, setViewState, viewportPadding, minZoom, maxZoom]);

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
    if (zoomToFitOnLoad) {
      engine.addEventListener('onLayoutDone', fitBounds, {once: true});
    }

    return () => {
      engine.removeEventListener('onLayoutDone', fitBounds);
    };
  }, [fitBounds, zoomToFitOnLoad]);

  return (
    <>
      {isLoading && loader}
      <div style={{visibility: isLoading ? 'hidden' : 'visible'}}>
        <DeckGL
          onAfterRender={() => loadingDispatch({type: 'afterRender'})}
          width="100%"
          height="100%"
          getCursor={() => DEFAULT_CURSOR}
          viewState={viewState}
          onResize={onResize}
          onViewStateChange={onViewStateChange}
          views={[
            new OrthographicView({
              controller: {
                minZoom,
                maxZoom,
                scrollZoom: enableZooming,
                touchZoom: enableZooming,
                doubleClickZoom: enableZooming && doubleClickZoom,
                dragPan: enablePanning
              }
            })
          ]}
          layers={[
            new GraphLayer({
              engine,
              nodeStyle,
              nodeEvents,
              edgeStyle,
              edgeEvents,
              enableDragging,
              resumeLayoutAfterDragging
            })
          ]}
        />
        <ViewControlComponent
          fitBounds={fitBounds}
          panBy={panBy}
          zoomBy={zoomBy}
          zoomLevel={viewState.zoom}
          maxZoom={maxZoom}
          minZoom={minZoom}
        />
      </div>
    </>
  );
};

GraphGl.propTypes = {
  /** Input graph data */
  graph: PropTypes.object.isRequired,
  /** Layout algorithm */
  layout: PropTypes.object.isRequired,
  /** Node event callbacks */
  nodeEvents: PropTypes.shape({
    onClick: PropTypes.func,
    onMouseLeave: PropTypes.func,
    onHover: PropTypes.func,
    onMouseEnter: PropTypes.func
  }).isRequired,
  /** Declarative node style */
  nodeStyle: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.object, PropTypes.bool])),
  /** Declarative edge style */
  edgeStyle: PropTypes.shape({
    stroke: PropTypes.oneOfType([PropTypes.string, PropTypes.func]),
    strokeWidth: PropTypes.oneOfType([PropTypes.number, PropTypes.func]),
    decorators: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.object, PropTypes.bool]))
  }).isRequired,
  /** Edge event callbacks */
  edgeEvents: PropTypes.shape({
    onClick: PropTypes.func,
    onHover: PropTypes.func
  }),
  /** The initial view state of the viewport */
  initialViewState: PropTypes.shape({
    target: PropTypes.arrayOf(PropTypes.number),
    zoom: PropTypes.number
  }),
  /** A component to control view state. */
  ViewControlComponent: PropTypes.func,
  /** A minimum scale factor for zoom level of the graph. */
  minZoom: PropTypes.number,
  /** A maximum scale factor for zoom level of the graph. */
  maxZoom: PropTypes.number,
  /** Padding for fitting entire graph in the screen. (pixel) */
  viewportPadding: PropTypes.number,
  /** Changes the scroll wheel sensitivity when zooming. This is a multiplicative modifier.
   So, a value between 0 and 1 reduces the sensitivity (zooms slower),
   and a value greater than 1 increases the sensitivity (zooms faster) */
  wheelSensitivity: PropTypes.number,
  /** Whether zooming the graph is enabled */
  enableZooming: PropTypes.bool,
  /** double-clicking causes zoom */
  doubleClickZoom: PropTypes.bool,
  /** Whether panning the graph is enabled */
  enablePanning: PropTypes.bool,
  /** Whether dragging the node is enabled */
  enableDragging: PropTypes.bool,
  /** Resume layout calculation after dragging a node */
  resumeLayoutAfterDragging: PropTypes.bool,
  /** The component to show while the graph is loading. */
  loader: PropTypes.element
};

export default GraphGl;
