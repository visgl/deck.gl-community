// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useState
} from 'react';
import {createRoot} from 'react-dom/client';

import DeckGL from '@deck.gl/react';

import {OrthographicView} from '@deck.gl/core';
import {
  GraphEngine,
  GraphLayer,
  JSONLoader,
  NODE_TYPE,
  D3ForceLayout,
  GPUForceLayout,
  SimpleLayout,
  EDGE_DECORATOR_TYPE,
  _HivePlotLayout as HivePlotLayout,
  _RadialLayout as RadialLayout,
  _MultigraphLayout as ForceMultiGraphLayout
} from '@deck.gl-community/graph-layers';

import '@deck.gl/widgets/stylesheet.css';

import {extent} from 'd3-array';
import {scaleOrdinal} from 'd3-scale';
import {schemeAccent} from 'd3-scale-chromatic';
import Color from 'color';

import type {Graph, GraphLayout} from '@deck.gl-community/graph-layers';

// eslint-disable-next-line import/no-unresolved
import {SAMPLE_GRAPH_DATASETS} from '../../../modules/graph-layers/test/data/graphs/sample-datasets';
import witsDataset from '../../../modules/graph-layers/test/data/examples/wits.json';
import sampleMultiGraph from './sample-multi-graph.json';

const INITIAL_VIEW_STATE = {
  /** the target origin of the view */
  target: [0, 0],
  /** zoom level */
  zoom: 1
};

const DEFAULT_CURSOR = 'default';
const DEFAULT_NODE_SIZE = 5;
const DEFAULT_DATASET = 'Random (20, 40)';

const HIVE_NODE_SIZE = 3;
const HIVE_EDGE_COLOR = 'rgba(80, 80, 80, 0.3)';

const RADIAL_NODE_SIZE = 5;
const RADIAL_EDGE_COLOR = 'rgba(80, 80, 80, 0.3)';
const RADIAL_LABEL_COLOR = '#646464';

const MULTI_NODE_SIZE = 30;
const MULTI_NODE_PLACEHOLDER_SIZE = 40;
const MULTI_NODE_PLACEHOLDER_COLOR = 'rgb(240, 240, 240)';
const MULTI_NODE_COLOR = '#cf4569';
const MULTI_NODE_LABEL_COLOR = '#ffffff';
const MULTI_EDGE_COLOR = '#cf4569';
const MULTI_EDGE_LABEL_COLOR = '#000000';
const MULTI_EDGE_WIDTH = 2;
const MULTI_NODE_LABEL_SIZE = 14;
const MULTI_EDGE_LABEL_SIZE = 14;

const DEFAULT_VARIANT_KEY = 'force' as const;

const IDENTITY_TOOLTIP = (object) => {
  if (!object) {
    return null;
  }
  const type = object.isNode ? 'Node' : 'Edge';
  return `${type}: ${JSON.stringify(object?._data)}`;
};
type LoadingState = {
  loaded: boolean;
  rendered: boolean;
  isLoading: boolean;
};

type LoadingAction =
  | {type: 'startLayout'}
  | {type: 'layoutDone'}
  | {type: 'afterRender'};

const loadingReducer = (state: LoadingState, action: LoadingAction): LoadingState => {
  switch (action.type) {
    case 'startLayout':
      return {loaded: false, rendered: false, isLoading: true};
    case 'layoutDone':
      return state.loaded ? state : {...state, loaded: true};
    case 'afterRender':
      if (!state.loaded || state.rendered) {
        return state;
      }
      return {...state, rendered: true, isLoading: false};
    default:
      return state;
  }
};

const useLoading = (engine: GraphEngine) => {
  const [state, dispatch] = useReducer(loadingReducer, {
    loaded: false,
    rendered: false,
    isLoading: true
  });

  useLayoutEffect(() => {
    const layoutStarted = () => dispatch({type: 'startLayout'});
    const layoutEnded = () => dispatch({type: 'layoutDone'});

    engine.addEventListener('onLayoutStart', layoutStarted);
    engine.addEventListener('onLayoutDone', layoutEnded);

    return () => {
      engine.removeEventListener('onLayoutStart', layoutStarted);
      engine.removeEventListener('onLayoutDone', layoutEnded);
    };
  }, [engine]);

  return [{isLoading: state.isLoading}, dispatch] as const;
};

type TransformResult = {
  graph: Graph;
  metadata?: Record<string, unknown>;
};

type VariantContext = {
  raw: unknown;
  graph: Graph;
  metadata?: Record<string, unknown>;
};

type LayoutOption = {
  key: string;
  label: string;
  create: (context: VariantContext) => GraphLayout;
};

type GraphLayerProps = ConstructorParameters<typeof GraphLayer>[0];

type ExampleVariantConfig = {
  label: string;
  data: Record<string, () => unknown>;
  defaultDataset: string;
  layouts: LayoutOption[];
  transform?: (raw: unknown) => TransformResult;
  getLayerProps?: (context: VariantContext) => Partial<GraphLayerProps>;
  getTooltip?: typeof IDENTITY_TOOLTIP;
};

const defaultTransform = (raw: unknown): TransformResult => ({
  graph: JSONLoader({json: raw})
});

type WitsDataset = typeof witsDataset;

const transformWitsDataset = (raw: WitsDataset): TransformResult => {
  const nodes = raw.nodes.map((node) => ({
    id: node.name,
    ...node
  }));

  const nodeIndexToId = nodes.map((node) => node.id);
  const edges = raw.edges.map((edge, index) => ({
    id: `edge-${index}`,
    sourceId: nodeIndexToId[edge.source],
    targetId: nodeIndexToId[edge.target],
    directed: true,
    value: edge.value
  }));

  const uniqueGroups = Array.from(new Set(nodes.map((node) => node.group)));
  const colorScale = scaleOrdinal(schemeAccent).domain(uniqueGroups).unknown('#cccccc');
  const getNodeColor = (node) => {
    const group = node.getPropertyValue('group');
    const hex = colorScale(group ?? 'default');
    return Color(hex).rgb().array();
  };

  return {
    graph: JSONLoader({
      json: {
        nodes,
        edges
      }
    }),
    metadata: {
      colorScale,
      getNodeColor,
      tree: raw.tree
    }
  };
};

const EXAMPLE_VARIANTS = {
  [DEFAULT_VARIANT_KEY]: {
    label: 'Standard Force Layouts',
    data: SAMPLE_GRAPH_DATASETS,
    defaultDataset: DEFAULT_DATASET,
    layouts: [
      {
        key: 'd3-force',
        label: 'D3 Force Layout',
        create: () => new D3ForceLayout()
      },
      {
        key: 'gpu-force',
        label: 'GPU Force Layout',
        create: () => new GPUForceLayout()
      },
      {
        key: 'simple',
        label: 'Simple Layout',
        create: () => new SimpleLayout()
      }
    ]
  },
  hive: {
    label: 'Hive Plot Layout',
    data: {
      'World Trade (WITS)': () => witsDataset
    },
    defaultDataset: 'World Trade (WITS)',
    transform: transformWitsDataset,
    layouts: [
      {
        key: 'hive',
        label: 'Hive Plot Layout',
        create: () =>
          new HivePlotLayout({
            innerRadius: 20,
            outerRadius: 260,
            getNodeAxis: (node) => node.getPropertyValue('group')
          })
      }
    ],
    getLayerProps: ({metadata}) => {
      const getNodeColor = (metadata?.getNodeColor as ((node: any) => number[])) ?? (() => [255, 0, 0, 255]);
      return {
        nodeStyle: [
          {
            type: NODE_TYPE.CIRCLE,
            radius: HIVE_NODE_SIZE,
            fill: getNodeColor
          }
        ],
        edgeStyle: {
          decorators: [],
          stroke: HIVE_EDGE_COLOR,
          strokeWidth: 1
        }
      };
    }
  },
  radial: {
    label: 'Radial Layout',
    data: {
      'World Trade (WITS)': () => witsDataset
    },
    defaultDataset: 'World Trade (WITS)',
    transform: transformWitsDataset,
    layouts: [
      {
        key: 'radial',
        label: 'Radial Layout',
        create: ({metadata}) =>
          new RadialLayout({
            tree: metadata?.tree,
            radius: 300
          })
      }
    ],
    getLayerProps: ({metadata}) => {
      const getNodeColor = (metadata?.getNodeColor as ((node: any) => number[])) ?? (() => [255, 0, 0, 255]);
      return {
        nodeStyle: [
          {
            type: NODE_TYPE.CIRCLE,
            radius: RADIAL_NODE_SIZE,
            fill: getNodeColor
          },
          {
            type: NODE_TYPE.LABEL,
            text: (node) => node.getPropertyValue('name') as string,
            color: Color(RADIAL_LABEL_COLOR).rgb().array(),
            textAnchor: 'start',
            fontSize: 8
          }
        ],
        edgeStyle: {
          decorators: [],
          stroke: RADIAL_EDGE_COLOR,
          strokeWidth: 1
        }
      };
    }
  },
  multigraph: {
    label: 'Multi-Graph Layout',
    data: {
      'Sample Multi Graph': () => sampleMultiGraph
    },
    defaultDataset: 'Sample Multi Graph',
    layouts: [
      {
        key: 'force-multigraph',
        label: 'Force Multi-Graph Layout',
        create: () => new ForceMultiGraphLayout({nBodyStrength: -8000})
      }
    ],
    getLayerProps: () => ({
      nodeStyle: [
        {
          type: NODE_TYPE.CIRCLE,
          radius: MULTI_NODE_PLACEHOLDER_SIZE,
          fill: MULTI_NODE_PLACEHOLDER_COLOR
        },
        {
          type: NODE_TYPE.CIRCLE,
          radius: MULTI_NODE_SIZE,
          fill: MULTI_NODE_COLOR
        },
        {
          type: NODE_TYPE.CIRCLE,
          radius: (node) => (node.getPropertyValue('star') ? 6 : 0),
          fill: [255, 255, 0],
          offset: [18, -18]
        },
        {
          type: NODE_TYPE.LABEL,
          text: (node) => node.getId() as string,
          color: Color(MULTI_NODE_LABEL_COLOR).rgb().array(),
          fontSize: MULTI_NODE_LABEL_SIZE
        }
      ],
      edgeStyle: {
        stroke: MULTI_EDGE_COLOR,
        strokeWidth: MULTI_EDGE_WIDTH,
        decorators: [
          {
            type: EDGE_DECORATOR_TYPE.LABEL,
            text: (edge) => edge.getPropertyValue('type') as string,
            color: Color(MULTI_EDGE_LABEL_COLOR).rgb().array(),
            fontSize: MULTI_EDGE_LABEL_SIZE
          }
        ]
      },
      resumeLayoutAfterDragging: true
    })
  }
} as const satisfies Record<string, ExampleVariantConfig>;

type ExampleVariantKey = keyof typeof EXAMPLE_VARIANTS;

type AppProps = {
  variant?: ExampleVariantKey;
};
export function App({variant: variantProp}: AppProps = {}) {
  const [selectedVariant, setSelectedVariant] = useState<ExampleVariantKey>(
    variantProp && variantProp in EXAMPLE_VARIANTS ? variantProp : DEFAULT_VARIANT_KEY
  );

  useEffect(() => {
    if (variantProp && variantProp in EXAMPLE_VARIANTS) {
      setSelectedVariant(variantProp);
    }
  }, [variantProp]);

  const variantConfig = EXAMPLE_VARIANTS[selectedVariant];

  const datasetKeys = useMemo(() => Object.keys(variantConfig.data), [variantConfig]);
  const [selectedDataset, setSelectedDataset] = useState<string>(variantConfig.defaultDataset);

  useEffect(() => {
    setSelectedDataset(variantConfig.defaultDataset);
  }, [variantConfig]);

  const layoutKeys = useMemo(() => variantConfig.layouts.map((layout) => layout.key), [variantConfig]);
  const [selectedLayoutKey, setSelectedLayoutKey] = useState<string>(layoutKeys[0] ?? '');

  useEffect(() => {
    setSelectedLayoutKey(layoutKeys[0] ?? '');
  }, [layoutKeys]);

  const rawDataset = useMemo(() => {
    const datasetKey = variantConfig.data[selectedDataset] ? selectedDataset : variantConfig.defaultDataset;
    return variantConfig.data[datasetKey]() ?? variantConfig.data[variantConfig.defaultDataset]();
  }, [variantConfig, selectedDataset]);

  const transformResult = useMemo(() => {
    const transform = variantConfig.transform ?? defaultTransform;
    return transform(rawDataset);
  }, [variantConfig, rawDataset]);

  const layoutOption = useMemo(
    () => variantConfig.layouts.find((layout) => layout.key === selectedLayoutKey) ?? variantConfig.layouts[0],
    [variantConfig, selectedLayoutKey]
  );

  const layout = useMemo(() => {
    if (!layoutOption) {
      return new D3ForceLayout();
    }
    return layoutOption.create({
      raw: rawDataset,
      graph: transformResult.graph,
      metadata: transformResult.metadata
    });
  }, [layoutOption, rawDataset, transformResult]);

  const {graph, metadata} = transformResult;
  const [engine, setEngine] = useState(() => new GraphEngine({graph, layout}));

  useEffect(() => {
    setEngine(new GraphEngine({graph, layout}));
  }, [graph, layout]);

  useEffect(() => {
    engine.run();
    return () => {
      engine.clear();
    };
  }, [engine]);

  const [{isLoading}, loadingDispatch] = useLoading(engine);

  const variantLayerOverrides = useMemo(
    () => variantConfig.getLayerProps?.({raw: rawDataset, graph, metadata}) ?? {},
    [variantConfig, rawDataset, graph, metadata]
  );

  const {nodeStyle: variantNodeStyle, edgeStyle: variantEdgeStyle, resumeLayoutAfterDragging, ...variantLayerRest} =
    variantLayerOverrides;

  const graphLayerProps: GraphLayerProps = {
    engine,
    nodeStyle:
      variantNodeStyle ?? [
        {
          type: NODE_TYPE.CIRCLE,
          radius: DEFAULT_NODE_SIZE,
          fill: 'red'
        }
      ],
    edgeStyle:
      variantEdgeStyle ?? {
        decorators: [],
        stroke: 'black',
        strokeWidth: 1
      },
    resumeLayoutAfterDragging: resumeLayoutAfterDragging ?? false,
    ...variantLayerRest
  };

  const minZoom = -20;
  const maxZoom = 20;
  const viewportPadding = 50;
  const zoomToFitOnLoad = false;

  const [viewState, setViewState] = useState({
    ...INITIAL_VIEW_STATE
  });

  const fitBounds = useCallback(() => {
    const data = engine.getNodes();
    if (!data.length) {
      return;
    }

    const {width, height} = viewState as any;
    const positions = data.map((d) => engine.getNodePosition(d));
    const xExtent = extent(positions, (d) => d[0]);
    const yExtent = extent(positions, (d) => d[1]);
    const newTarget = [(xExtent[0] + xExtent[1]) / 2, (yExtent[0] + yExtent[1]) / 2];
    const zoom = Math.min(
      width / (xExtent[1] - xExtent[0] + viewportPadding * 2),
      height / (yExtent[1] - yExtent[0] + viewportPadding * 2)
    );
    const newZoom = Math.min(Math.max(minZoom, Math.log(zoom)), maxZoom);
    setViewState((current) => ({
      ...current,
      target: newTarget,
      zoom: newZoom
    }));
  }, [engine, viewState, viewportPadding, minZoom, maxZoom]);

  useEffect(() => {
    if (zoomToFitOnLoad && isLoading) {
      engine.addEventListener('onLayoutDone', fitBounds, {once: true});
    }
    return () => {
      engine.removeEventListener('onLayoutDone', fitBounds);
    };
  }, [engine, isLoading, fitBounds, zoomToFitOnLoad]);

  const handleChangeVariant = useCallback((event) => {
    setSelectedVariant(event.target.value as ExampleVariantKey);
  }, []);

  const handleChangeDataset = useCallback((event) => {
    setSelectedDataset(event.target.value);
  }, []);

  const handleChangeLayout = useCallback((event) => {
    setSelectedLayoutKey(event.target.value);
  }, []);

  const tooltipAccessor = variantConfig.getTooltip ?? IDENTITY_TOOLTIP;

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
      <div style={{width: '100%', zIndex: 999}}>
        <div>
          Example:
          <select value={selectedVariant} onChange={handleChangeVariant}>
            {Object.entries(EXAMPLE_VARIANTS).map(([key, config]) => (
              <option key={key} value={key}>
                {config.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          Dataset:
          <select value={selectedDataset} onChange={handleChangeDataset} disabled={datasetKeys.length <= 1}>
            {datasetKeys.map((dataKey) => (
              <option key={dataKey} value={dataKey}>
                {dataKey}
              </option>
            ))}
          </select>
        </div>
        <div>
          Layout:
          <select value={selectedLayoutKey} onChange={handleChangeLayout} disabled={layoutKeys.length <= 1}>
            {variantConfig.layouts.map((layout) => (
              <option key={layout.key} value={layout.key}>
                {layout.label}
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
              onViewStateChange={({viewState: nextViewState}) => setViewState(nextViewState as any)}
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
              layers={[new GraphLayer(graphLayerProps)]}
              getTooltip={(info) => tooltipAccessor(info.object)}
            />
            {/** View control component TODO - doesn't work in website, replace with widget */}
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
