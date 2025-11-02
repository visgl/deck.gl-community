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
  JSONLoader
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

const LAYOUT_FACTORIES: Record<LayoutType, () => GraphLayout> = {
  'd3-force-layout': () => new D3ForceLayout(),
  'gpu-force-layout': () => new GPUForceLayout(),
  'simple-layout': () => new SimpleLayout()
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
  const graph = useMemo(() => (graphData ? JSONLoader({json: graphData}) : null), [graphData]);
  const layout = useMemo(() => (selectedLayout ? LAYOUT_FACTORIES[selectedLayout]?.() : null), [selectedLayout]);
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
  const styleJson = useMemo(() => {
    if (!selectedStyles) {
      return '';
    }

    return JSON.stringify(
      selectedStyles,
      (_key, value) => (typeof value === 'function' ? value.toString() : value),
      2
    );
  }, [selectedStyles]);

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
    <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
      <div style={{width: '100%', zIndex: 999}}>
        <ControlPanel examples={EXAMPLES} onExampleChange={handleExampleChange} />
      </div>
      <div
        style={{
          width: '100%',
          padding: '0 0.5rem 0.5rem',
          boxSizing: 'border-box'
        }}
      >
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: '0.75rem',
            gap: '0.25rem',
            fontWeight: 600
          }}
        >
          Style JSON
          <pre
            style={{
              margin: 0,
              padding: '0.75rem',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '0.5rem',
              fontSize: '0.75rem',
              lineHeight: 1.4,
              maxHeight: '12rem',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
            }}
          >
            {styleJson || '// No style defined for this example'}
          </pre>
        </label>
      </div>
      <div style={{width: '100%', flex: 1, position: 'relative'}}>
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
