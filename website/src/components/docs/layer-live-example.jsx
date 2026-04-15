import React, {useEffect, useRef} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import '@deck.gl/widgets/stylesheet.css';

const WRAPPER_STYLE = {
  position: 'relative',
  width: '100%',
  height: 420,
  minHeight: 420,
  borderRadius: 8,
  overflow: 'hidden',
  border: '1px solid var(--ifm-color-emphasis-300)',
  marginBottom: '2rem'
};

const SIZE_TO_HEIGHT = {
  narrow: 420,
  tall: 560
};

const GRAPH_LAYER_HIGHLIGHTS = new Set([
  'circle-layer',
  'curved-edge-layer',
  'edge-arrow-layer',
  'edge-label-layer',
  'edge-layer',
  'flow-layer',
  'flow-path-layer',
  'graph-layer',
  'grid-layer',
  'image-layer',
  'label-layer',
  'marker-layer',
  'path-edge-layer',
  'path-rounded-rectangle-layer',
  'rectangle-layer',
  'rounded-rectangle-layer',
  'spline-layer',
  'straight-line-edge-layer',
  'zoomable-marker-layer',
  'zoomable-text-layer'
]);

const INFO_COPY = {
  'arrow-layers': {
    title: 'GeoArrow layers',
    markdown:
      'The Arrow layer APIs render Arrow-backed columnar data through deck.gl layer adapters. This embedded canvas keeps the docs page live while the aggregate Arrow reference remains a compact index.'
  },
  'data-driven-tile-3d-layer': {
    title: 'DataDrivenTile3DLayer',
    markdown:
      'DataDrivenTile3DLayer extends Tile3DLayer with attribute-driven color and filter hooks. A local 3D Tiles fixture is not bundled with the docs, so this live surface focuses on the layer contract without fetching external tiles.'
  }
};

function LayerLiveExampleHost({highlight, height}) {
  const hostRef = useRef(null);

  useEffect(() => {
    const hostElement = hostRef.current;
    if (!hostElement) {
      return undefined;
    }

    let cleanup;
    let isDisposed = false;
    const animationFrame = window.requestAnimationFrame(() => {
      mountLayerDocsExample(hostElement, highlight)
        .then((nextCleanup) => {
          if (isDisposed) {
            nextCleanup?.();
            return;
          }
          cleanup = nextCleanup;
        })
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.error(`Failed to mount ${highlight} docs example`, error);
        });
    });

    return () => {
      isDisposed = true;
      window.cancelAnimationFrame(animationFrame);
      cleanup?.();
    };
  }, [highlight]);

  return <div ref={hostRef} style={{...WRAPPER_STYLE, height}} />;
}

export default function LayerLiveExample({highlight, size = 'narrow', height}) {
  const resolvedHeight = height ?? SIZE_TO_HEIGHT[size] ?? SIZE_TO_HEIGHT.narrow;

  return (
    <BrowserOnly fallback={<div style={{...WRAPPER_STYLE, height: resolvedHeight}} />}>
      {() => <LayerLiveExampleHost highlight={highlight} height={resolvedHeight} />}
    </BrowserOnly>
  );
}

async function mountLayerDocsExample(container, highlight) {
  switch (highlight) {
    case 'skybox-layer': {
      const {mountSkyboxMapViewExample} = await import(
        '../../../../examples/layers/skybox-map-view/app'
      );
      return mountSkyboxMapViewExample(container, {showInfoOverlay: false});
    }
    case 'path-marker-layer':
    case 'path-outline-layer': {
      const {mountPathOutlineAndMarkersExample} = await import(
        '../../../../examples/layers/path-marker-outline/app'
      );
      return mountPathOutlineAndMarkersExample(container, {showInfoWidget: false});
    }
    case 'shared-tile-2d-layer':
    case 'tile-grid-layer': {
      const {mountSharedTile2DLayerExample} = await import(
        '../../../../examples/geo-layers/shared-tile-2d-layer/app'
      );
      return mountSharedTile2DLayerExample(container, {mode: 'compact', showInfoWidget: false});
    }
    case 'global-grid-layer':
      return mountGlobalGridLayerExample(container);
    case 'tile-source-layer':
      return mountTileSourceLayerExample(container);
    case 'editable-geojson-layer':
    case 'selection-layer': {
      const {mountGettingStartedExample} = await import(
        '../../../../examples/editable-layers/getting-started/app'
      );
      return mountGettingStartedExample(container, {showControlsWidget: false});
    }
    case 'tree-layer': {
      const {mountWildForestExample} = await import('../../../../examples/three/wild-forest/app');
      return mountWildForestExample(container, {showControlsWidget: false});
    }
    case 'horizon-graph-layer': {
      const {mountHorizonGraphLayerExample} = await import(
        '../../../../dev/timeline-layers/examples/horizon-graph-layer/app'
      );
      return mountHorizonGraphLayerExample(container, {showInfoWidget: false});
    }
    case 'multi-horizon-graph-layer': {
      const {mountMultiHorizonGraphLayerExample} = await import(
        '../../../../dev/timeline-layers/examples/horizon-graph-layer/app'
      );
      return mountMultiHorizonGraphLayerExample(container, {showInfoWidget: false});
    }
    case 'time-axis-layer':
      return mountTimeAxisLayerExample(container);
    case 'vertical-grid-layer':
      return mountVerticalGridLayerExample(container);
    default:
      if (GRAPH_LAYER_HIGHLIGHTS.has(highlight)) {
        return mountGraphLayerDocsExample(container, highlight);
      }
      return mountInfoDeck(container, INFO_COPY[highlight] ?? INFO_COPY['arrow-layers']);
  }
}

async function mountGlobalGridLayerExample(container) {
  const {Deck} = await import('@deck.gl/core');
  const {GlobalGridLayer, GeohashGrid} = await import('@deck.gl-community/geo-layers');
  const rootElement = createRoot(container);

  const data = [
    {cellId: '9q8yy', value: 5},
    {cellId: '9q8yz', value: 8},
    {cellId: '9q8yw', value: 3},
    {cellId: '9q8yt', value: 6}
  ];

  const deck = new Deck({
    parent: rootElement,
    initialViewState: {
      longitude: -122.42,
      latitude: 37.77,
      zoom: 10.5,
      pitch: 35,
      bearing: -20
    },
    controller: true,
    parameters: {clearColor: [0.94, 0.97, 1, 1]},
    layers: [
      new GlobalGridLayer({
        id: 'global-grid-layer-docs',
        data,
        globalGrid: GeohashGrid,
        getCellId: (datum) => datum.cellId,
        stroked: true,
        filled: true,
        extruded: true,
        elevationScale: 250,
        getElevation: (datum) => datum.value,
        getFillColor: (datum) => [20, 184, 166, 80 + datum.value * 18],
        getLineColor: [15, 23, 42, 220],
        lineWidthMinPixels: 2,
        pickable: true
      })
    ],
    getTooltip: ({object}) => object && `${object.cellId}: ${object.value}`
  });

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };
}

async function mountTileSourceLayerExample(container) {
  const {Deck} = await import('@deck.gl/core');
  const {TileSourceLayer} = await import('@deck.gl-community/geo-layers');
  const rootElement = createRoot(container);
  const tileSource = createCanvasTileSource(rootElement.ownerDocument);

  const deck = new Deck({
    parent: rootElement,
    initialViewState: {
      longitude: -122.42,
      latitude: 37.77,
      zoom: 9.5
    },
    controller: true,
    parameters: {clearColor: [0.94, 0.97, 1, 1]},
    layers: [
      new TileSourceLayer({
        id: 'tile-source-layer-docs',
        tileSource,
        showTileBorders: true
      })
    ]
  });

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };
}

async function mountGraphLayerDocsExample(container, highlight) {
  const {Deck, OrthographicView, COORDINATE_SYSTEM} = await import('@deck.gl/core');
  const {LineLayer, TextLayer} = await import('@deck.gl/layers');
  const rootElement = createRoot(container);
  rootElement.style.background =
    'radial-gradient(circle at 20% 10%, #e0f2fe 0%, transparent 32%), linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)';

  const layer = await createGraphDocsLayer({
    highlight,
    COORDINATE_SYSTEM,
    LineLayer,
    TextLayer
  });

  const deck = new Deck({
    parent: rootElement,
    views: new OrthographicView({id: 'graph-docs'}),
    initialViewState: {target: [0, 0, 0], zoom: 0.25},
    controller: true,
    parameters: {clearColor: [0.96, 0.98, 1, 1]},
    layers: Array.isArray(layer) ? layer : [layer],
    getTooltip: ({object}) => object?.label || object?._data?.label || object?.id || null
  });

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };
}

async function createGraphDocsLayer({highlight, COORDINATE_SYSTEM, LineLayer, TextLayer}) {
  switch (highlight) {
    case 'graph-layer': {
      const {GraphLayer, SimpleLayout} = await import('@deck.gl-community/graph-layers');
      return new GraphLayer({
        id: 'graph-layer-docs',
        data: {
          nodes: GRAPH_LAYER_DOCS_NODES,
          edges: GRAPH_LAYER_DOCS_EDGES
        },
        layout: new SimpleLayout(),
        stylesheet: {
          nodes: [
            {type: 'circle', radius: 26, fill: [37, 99, 235, 210], strokeWidth: 2},
            {
              type: 'label',
              text: '@id',
              color: [255, 255, 255, 255],
              fontSize: 18,
              offset: [0, 2]
            }
          ],
          edges: {type: 'edge', stroke: [30, 41, 59, 210], strokeWidth: 4}
        },
        enableDragging: false
      });
    }
    case 'circle-layer': {
      const {CircleLayer} = await import(
        '../../../../modules/graph-layers/src/layers/node-layers/circle-layer'
      );
      return new CircleLayer({
        id: 'circle-layer-docs',
        data: GRAPH_DOCS_NODES,
        getPosition: getGraphNodePosition,
        stylesheet: createGraphDocsStylesheet({
          getFillColor: (node) => node.color,
          getLineColor: [15, 23, 42, 220],
          getLineWidth: 2,
          getRadius: (node) => node.radius
        }),
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
      });
    }
    case 'rectangle-layer':
    case 'rounded-rectangle-layer':
    case 'path-rounded-rectangle-layer':
      return createGraphDocsRectangleLayer({highlight, COORDINATE_SYSTEM});
    case 'label-layer': {
      const {LabelLayer} = await import(
        '../../../../modules/graph-layers/src/layers/node-layers/label-layer'
      );
      return new LabelLayer({
        id: 'label-layer-docs',
        data: GRAPH_DOCS_NODES,
        getPosition: getGraphNodePosition,
        stylesheet: createGraphDocsStylesheet({
          getColor: [15, 23, 42, 255],
          getText: (node) => node.label,
          getSize: 24,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          getAngle: 0,
          scaleWithZoom: false
        }),
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
      });
    }
    case 'zoomable-text-layer': {
      const {ZoomableTextLayer} = await import(
        '../../../../modules/graph-layers/src/layers/common-layers/zoomable-text-layer/zoomable-text-layer'
      );
      return new ZoomableTextLayer({
        id: 'zoomable-text-layer-docs',
        data: GRAPH_DOCS_NODES,
        getPosition: getGraphNodePosition,
        getText: (node) => node.label,
        getSize: 22,
        getColor: [14, 116, 144, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        getAngle: 0,
        scaleWithZoom: true,
        updateTriggers: {},
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
      });
    }
    case 'marker-layer':
    case 'zoomable-marker-layer':
    case 'image-layer':
      return createGraphDocsMarkerLayer({highlight, COORDINATE_SYSTEM});
    case 'grid-layer': {
      const {GridLayer} = await import(
        '../../../../modules/graph-layers/src/layers/common-layers/grid-layer/grid-layer'
      );
      return [
        new GridLayer({
          id: 'grid-layer-docs-horizontal',
          data: GRAPH_DOCS_GRID_LINES,
          direction: 'horizontal',
          xMin: -260,
          xMax: 260,
          color: [59, 130, 246, 110],
          showLabels: true
        }),
        new GridLayer({
          id: 'grid-layer-docs-vertical',
          data: GRAPH_DOCS_GRID_LINES,
          direction: 'vertical',
          yMin: -150,
          yMax: 150,
          color: [14, 165, 233, 110],
          showLabels: false
        })
      ];
    }
    case 'edge-layer':
    case 'straight-line-edge-layer':
    case 'path-edge-layer':
    case 'curved-edge-layer':
    case 'spline-layer':
    case 'edge-label-layer':
    case 'edge-arrow-layer':
      return createGraphDocsEdgeLayer({highlight, COORDINATE_SYSTEM});
    case 'flow-layer':
    case 'flow-path-layer':
      return createStaticFlowDocsLayers({highlight, LineLayer, TextLayer, COORDINATE_SYSTEM});
    default:
      return createStaticFlowDocsLayers({highlight, LineLayer, TextLayer, COORDINATE_SYSTEM});
  }
}

async function createGraphDocsRectangleLayer({highlight, COORDINATE_SYSTEM}) {
  const module =
    highlight === 'rounded-rectangle-layer'
      ? await import(
          '../../../../modules/graph-layers/src/layers/node-layers/rounded-rectangle-layer'
        )
      : highlight === 'path-rounded-rectangle-layer'
        ? await import(
            '../../../../modules/graph-layers/src/layers/node-layers/path-rounded-rectangle-layer'
          )
        : await import('../../../../modules/graph-layers/src/layers/node-layers/rectangle-layer');
  const Layer =
    module.RoundedRectangleLayer || module.PathBasedRoundedRectangleLayer || module.RectangleLayer;

  return new Layer({
    id: `${highlight}-docs`,
    data: GRAPH_DOCS_NODES,
    getPosition: getGraphNodePosition,
    cornerRadius: 0.45,
    stylesheet: createGraphDocsStylesheet({
      getWidth: 128,
      getHeight: 56,
      getFillColor: [219, 234, 254, 235],
      getLineColor: [37, 99, 235, 255],
      getLineWidth: 2,
      getCornerRadius: 12
    }),
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
  });
}

async function createGraphDocsMarkerLayer({highlight, COORDINATE_SYSTEM}) {
  const {AtlasDataURL} = await import(
    '../../../../modules/graph-layers/src/layers/common-layers/marker-layer/atlas-data-url'
  );
  const {MarkerMapping} = await import(
    '../../../../modules/graph-layers/src/layers/common-layers/marker-layer/marker-mapping'
  );

  if (highlight === 'marker-layer') {
    const {MarkerLayer} = await import(
      '../../../../modules/graph-layers/src/layers/common-layers/marker-layer/marker-layer'
    );
    return new MarkerLayer({
      id: 'marker-layer-docs',
      data: GRAPH_DOCS_NODES,
      getPosition: getGraphNodePosition,
      getMarker: (node) => node.marker,
      getColor: (node) => node.color,
      getSize: 42,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    });
  }

  if (highlight === 'image-layer') {
    const {ImageLayer} = await import(
      '../../../../modules/graph-layers/src/layers/node-layers/image-layer'
    );
    return new ImageLayer({
      id: 'image-layer-docs',
      data: GRAPH_DOCS_NODES,
      getPosition: getGraphNodePosition,
      stylesheet: createGraphDocsStylesheet(
        {
          getIcon: (node) => node.marker,
          getColor: (node) => node.color,
          getSize: 48
        },
        {
          iconAtlas: AtlasDataURL.dataURL,
          iconMapping: MarkerMapping
        }
      ),
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    });
  }

  const {ZoomableMarkerLayer} = await import(
    '../../../../modules/graph-layers/src/layers/node-layers/zoomable-marker-layer'
  );
  return new ZoomableMarkerLayer({
    id: 'zoomable-marker-layer-docs',
    data: GRAPH_DOCS_NODES,
    getPosition: getGraphNodePosition,
    stylesheet: createGraphDocsStylesheet({
      getMarker: (node) => node.marker,
      getColor: (node) => node.color,
      getSize: 38,
      scaleWithZoom: true
    }),
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
  });
}

async function createGraphDocsEdgeLayer({highlight, COORDINATE_SYSTEM}) {
  if (highlight === 'edge-layer') {
    const {EdgeLayer} = await import('../../../../modules/graph-layers/src/layers/edge-layer');
    return new EdgeLayer({
      id: 'edge-layer-docs',
      data: GRAPH_DOCS_EDGES,
      getLayoutInfo: getGraphEdgeLayoutInfo,
      stylesheet: createGraphDocsStylesheet({
        getColor: [30, 41, 59, 210],
        getWidth: 4
      }),
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    });
  }

  if (highlight === 'straight-line-edge-layer') {
    const {StraightLineEdgeLayer} = await import(
      '../../../../modules/graph-layers/src/layers/edge-layers/straight-line-edge-layer'
    );
    return new StraightLineEdgeLayer({
      id: 'straight-line-edge-layer-docs',
      data: GRAPH_DOCS_EDGES.slice(0, 2),
      getLayoutInfo: getGraphEdgeLayoutInfo,
      getColor: [37, 99, 235, 230],
      getWidth: 5,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    });
  }

  if (highlight === 'path-edge-layer') {
    const {PathEdgeLayer} = await import(
      '../../../../modules/graph-layers/src/layers/edge-layers/path-edge-layer'
    );
    return new PathEdgeLayer({
      id: 'path-edge-layer-docs',
      data: GRAPH_DOCS_EDGES.filter((edge) => edge.type === 'path'),
      getLayoutInfo: getGraphEdgeLayoutInfo,
      getColor: [14, 116, 144, 230],
      getWidth: 6,
      widthUnits: 'pixels',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    });
  }

  if (highlight === 'curved-edge-layer') {
    const {CurvedEdgeLayer} = await import(
      '../../../../modules/graph-layers/src/layers/edge-layers/curved-edge-layer'
    );
    return new CurvedEdgeLayer({
      id: 'curved-edge-layer-docs',
      data: GRAPH_DOCS_EDGES.filter((edge) => edge.type === 'spline-curve'),
      getLayoutInfo: getGraphEdgeLayoutInfo,
      getColor: [124, 58, 237, 235],
      getWidth: 6,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    });
  }

  if (highlight === 'spline-layer') {
    const {SplineLayer} = await import(
      '../../../../modules/graph-layers/src/layers/common-layers/spline-layer/spline-layer'
    );
    return new SplineLayer({
      id: 'spline-layer-docs',
      data: GRAPH_DOCS_EDGES.filter((edge) => edge.type === 'spline-curve'),
      getSourcePosition: (edge) => edge.sourcePosition,
      getTargetPosition: (edge) => edge.targetPosition,
      getControlPoints: (edge) => edge.controlPoints,
      getColor: [124, 58, 237, 235],
      getWidth: 6,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    });
  }

  if (highlight === 'edge-label-layer') {
    const {EdgeLabelLayer} = await import(
      '../../../../modules/graph-layers/src/layers/edge-layers/edge-label-layer'
    );
    return new EdgeLabelLayer({
      id: 'edge-label-layer-docs',
      data: GRAPH_DOCS_EDGES,
      getLayoutInfo: getGraphEdgeLayoutInfo,
      stylesheet: createGraphDocsStylesheet({
        getColor: [15, 23, 42, 255],
        getText: (edge) => edge.label,
        getSize: 20,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        scaleWithZoom: false
      }),
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    });
  }

  const {EdgeArrowLayer} = await import(
    '../../../../modules/graph-layers/src/layers/edge-layers/edge-arrow-layer'
  );
  return new EdgeArrowLayer({
    id: 'edge-arrow-layer-docs',
    data: GRAPH_DOCS_EDGES,
    getLayoutInfo: getGraphEdgeLayoutInfo,
    stylesheet: createGraphDocsStylesheet({
      getColor: [220, 38, 38, 240],
      getSize: 28,
      getOffset: [6, 0]
    }),
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
  });
}

function createStaticFlowDocsLayers({highlight, LineLayer, TextLayer, COORDINATE_SYSTEM}) {
  return [
    new LineLayer({
      id: `${highlight}-docs-flow-bands`,
      data: GRAPH_DOCS_FLOW_SEGMENTS,
      getSourcePosition: (segment) => segment.sourcePosition,
      getTargetPosition: (segment) => segment.targetPosition,
      getColor: (segment) => segment.color,
      getWidth: (segment) => segment.width,
      widthUnits: 'pixels',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    }),
    new TextLayer({
      id: `${highlight}-docs-flow-label`,
      data: [
        {position: [0, -118], label: highlight === 'flow-layer' ? 'FlowLayer' : 'FlowPathLayer'}
      ],
      getPosition: (datum) => datum.position,
      getText: (datum) => datum.label,
      getSize: 18,
      getColor: [15, 23, 42, 230],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    })
  ];
}

async function mountTimeAxisLayerExample(container) {
  const {Deck, OrthographicView} = await import('@deck.gl/core');
  const {LineLayer, TextLayer} = await import('@deck.gl/layers');
  const {TimeAxisLayer} = await import('@deck.gl-community/timeline-layers');
  const rootElement = createRoot(container);
  const {startTimeMs, endTimeMs, checkpoints} = createTimelineDocsData();

  rootElement.style.background = 'linear-gradient(180deg, #f8fafc 0%, #eef5ff 100%)';

  const deck = new Deck({
    parent: rootElement,
    views: new OrthographicView({id: 'timeline-docs'}),
    initialViewState: {
      target: [500, 0, 0],
      zoom: 0
    },
    controller: true,
    parameters: {clearColor: [0.97, 0.98, 1, 1]},
    layers: [
      new LineLayer({
        id: 'time-axis-docs-baseline',
        data: [{sourcePosition: [startTimeMs, 44], targetPosition: [endTimeMs, 44]}],
        getSourcePosition: (datum) => datum.sourcePosition,
        getTargetPosition: (datum) => datum.targetPosition,
        getColor: [99, 102, 241, 180],
        getWidth: 3
      }),
      new TextLayer({
        id: 'time-axis-docs-labels',
        data: checkpoints,
        getPosition: (datum) => [datum.timeMs, 70],
        getText: (datum) => datum.label,
        getSize: 13,
        getColor: [30, 41, 59, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center'
      }),
      new TimeAxisLayer({
        id: 'time-axis-docs-axis',
        unit: 'milliseconds',
        startTimeMs,
        endTimeMs,
        tickCount: 6,
        y: 0,
        color: [15, 23, 42, 255]
      })
    ]
  });

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };
}

async function mountVerticalGridLayerExample(container) {
  const {Deck, OrthographicView} = await import('@deck.gl/core');
  const {LineLayer, TextLayer} = await import('@deck.gl/layers');
  const {VerticalGridLayer} = await import('@deck.gl-community/timeline-layers');
  const rootElement = createRoot(container);
  const {startTimeMs, endTimeMs, checkpoints} = createTimelineDocsData();

  rootElement.style.background = 'linear-gradient(180deg, #fff7ed 0%, #f8fafc 100%)';

  const deck = new Deck({
    parent: rootElement,
    views: new OrthographicView({id: 'timeline-docs'}),
    initialViewState: {
      target: [500, 0, 0],
      zoom: 0
    },
    controller: true,
    parameters: {clearColor: [1, 0.97, 0.93, 1]},
    layers: [
      new VerticalGridLayer({
        id: 'vertical-grid-docs',
        xMin: startTimeMs,
        xMax: endTimeMs,
        tickCount: 8,
        yMin: -110,
        yMax: 90,
        color: [234, 88, 12, 170],
        width: 1
      }),
      new LineLayer({
        id: 'vertical-grid-docs-range',
        data: [
          {sourcePosition: [startTimeMs, -70], targetPosition: [endTimeMs, -70]},
          {sourcePosition: [startTimeMs, 50], targetPosition: [endTimeMs, 50]}
        ],
        getSourcePosition: (datum) => datum.sourcePosition,
        getTargetPosition: (datum) => datum.targetPosition,
        getColor: [15, 23, 42, 180],
        getWidth: 2
      }),
      new TextLayer({
        id: 'vertical-grid-docs-labels',
        data: checkpoints,
        getPosition: (datum) => [datum.timeMs, 76],
        getText: (datum) => datum.label,
        getSize: 13,
        getColor: [124, 45, 18, 255],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center'
      })
    ]
  });

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };
}

async function mountInfoDeck(container, {title, markdown}) {
  const {Deck} = await import('@deck.gl/core');
  const {BoxWidget, MarkdownPanel} = await import('@deck.gl-community/widgets');
  const rootElement = createRoot(container);
  rootElement.style.background = 'linear-gradient(135deg, #f8fafc 0%, #dbeafe 50%, #ecfeff 100%)';

  const deck = new Deck({
    parent: rootElement,
    initialViewState: {longitude: 0, latitude: 0, zoom: 1},
    controller: false,
    parameters: {clearColor: [0.96, 0.98, 1, 1]},
    layers: [],
    widgets: [
      new BoxWidget({
        id: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-docs-info`,
        placement: 'top-left',
        widthPx: 380,
        title,
        collapsible: false,
        panel: new MarkdownPanel({
          id: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-docs-markdown`,
          title: '',
          markdown
        })
      })
    ]
  });

  return () => {
    deck.finalize();
    rootElement.remove();
    container.replaceChildren();
  };
}

function createTimelineDocsData() {
  const startTimeMs = 0;
  const endTimeMs = 1000;

  return {
    startTimeMs,
    endTimeMs,
    checkpoints: [
      {timeMs: 0, label: 'start'},
      {timeMs: 320, label: 'load'},
      {timeMs: 680, label: 'render'},
      {timeMs: 1000, label: 'done'}
    ]
  };
}

const GRAPH_DOCS_NODES = [
  {
    id: 'alpha',
    label: 'Alpha',
    position: [-190, 70, 0],
    radius: 30,
    marker: 'circle-check-filled',
    color: [37, 99, 235, 230],
    _data: {label: 'Alpha'}
  },
  {
    id: 'beta',
    label: 'Beta',
    position: [0, -85, 0],
    radius: 26,
    marker: 'diamond-filled',
    color: [14, 165, 233, 230],
    _data: {label: 'Beta'}
  },
  {
    id: 'gamma',
    label: 'Gamma',
    position: [190, 70, 0],
    radius: 34,
    marker: 'triangle-up-filled',
    color: [124, 58, 237, 230],
    _data: {label: 'Gamma'}
  }
];

const GRAPH_DOCS_EDGES = [
  {
    id: 'alpha-beta',
    label: 'line',
    type: 'line',
    sourcePosition: GRAPH_DOCS_NODES[0].position,
    targetPosition: GRAPH_DOCS_NODES[1].position,
    controlPoints: [],
    directed: true,
    isDirected: () => true
  },
  {
    id: 'beta-gamma',
    label: 'path',
    type: 'path',
    sourcePosition: GRAPH_DOCS_NODES[1].position,
    targetPosition: GRAPH_DOCS_NODES[2].position,
    controlPoints: [[95, -20, 0]],
    directed: true,
    isDirected: () => true
  },
  {
    id: 'gamma-alpha',
    label: 'spline',
    type: 'spline-curve',
    sourcePosition: GRAPH_DOCS_NODES[2].position,
    targetPosition: GRAPH_DOCS_NODES[0].position,
    controlPoints: [[0, 165, 0]],
    directed: true,
    isDirected: () => true
  }
];

const GRAPH_DOCS_GRID_LINES = [
  {label: '-120', yPosition: -120, xPosition: -240},
  {label: '-60', yPosition: -60, xPosition: -120},
  {label: '0', yPosition: 0, xPosition: 0},
  {label: '60', yPosition: 60, xPosition: 120},
  {label: '120', yPosition: 120, xPosition: 240}
];

const GRAPH_DOCS_FLOW_SEGMENTS = [
  {
    sourcePosition: [-220, 70, 0],
    targetPosition: [220, 70, 0],
    color: [14, 165, 233, 70],
    width: 24
  },
  {
    sourcePosition: [-160, 30, 0],
    targetPosition: [160, 30, 0],
    color: [14, 165, 233, 140],
    width: 18
  },
  {
    sourcePosition: [-90, -10, 0],
    targetPosition: [90, -10, 0],
    color: [14, 165, 233, 240],
    width: 12
  }
];

const GRAPH_LAYER_DOCS_NODES = GRAPH_DOCS_NODES.map((node) => ({
  id: node.label,
  x: node.position[0],
  y: node.position[1]
}));

const GRAPH_LAYER_DOCS_EDGES = [
  {source: 'Alpha', target: 'Beta'},
  {source: 'Beta', target: 'Gamma'},
  {source: 'Gamma', target: 'Alpha'}
];

function getGraphNodePosition(node) {
  return node.position;
}

function getGraphEdgeLayoutInfo(edge) {
  return {
    type: edge.type,
    sourcePosition: edge.sourcePosition,
    targetPosition: edge.targetPosition,
    controlPoints: edge.controlPoints || []
  };
}

function createGraphDocsStylesheet(accessors, props = {}) {
  return {
    getDeckGLAccessors() {
      return {
        ...props,
        ...Object.fromEntries(
          Object.entries(accessors).map(([key, value]) => [key, asGraphDocsAccessor(value)])
        )
      };
    },
    getDeckGLUpdateTriggers() {
      return Object.fromEntries(Object.keys(accessors).map((key) => [key, false]));
    },
    getDeckGLAccessor(key) {
      return asGraphDocsAccessor(accessors[key]);
    },
    getDeckGLAccessorUpdateTrigger() {
      return false;
    }
  };
}

function asGraphDocsAccessor(value) {
  return typeof value === 'function' ? value : () => value;
}

function createRoot(container) {
  const rootElement = container.ownerDocument.createElement('div');
  rootElement.style.position = 'relative';
  rootElement.style.width = '100%';
  rootElement.style.height = '100%';
  rootElement.style.overflow = 'hidden';
  container.replaceChildren(rootElement);
  return rootElement;
}

function createCanvasTileSource(document) {
  return {
    url: 'deck-gl-community-docs://canvas-tile-source',
    mimeType: 'image/png',
    async getTileData({x = 0, y = 0, z = 0} = {}) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext('2d');
      const hue = (x * 37 + y * 53 + z * 19) % 360;
      context.fillStyle = `hsl(${hue} 76% 88%)`;
      context.fillRect(0, 0, 256, 256);
      context.fillStyle = `hsl(${hue} 72% 42%)`;
      context.fillRect(0, 0, 256, 8);
      context.fillRect(0, 248, 256, 8);
      context.fillRect(0, 0, 8, 256);
      context.fillRect(248, 0, 8, 256);
      context.fillStyle = '#0f172a';
      context.font = '700 22px ui-sans-serif, system-ui, sans-serif';
      context.fillText(`z${z} / x${x} / y${y}`, 28, 132);
      return canvas;
    }
  };
}
