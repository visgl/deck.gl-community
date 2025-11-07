// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable no-continue */

import type {CompositeLayerProps} from '@deck.gl/core';
import {COORDINATE_SYSTEM, CompositeLayer} from '@deck.gl/core';
import {PolygonLayer} from '@deck.gl/layers';

import {Graph} from '../graph/graph';
import type {Node} from '../graph/node';
import {GraphLayout} from '../core/graph-layout';
import {GraphEngine} from '../core/graph-engine';

import {GraphStyleEngine, type GraphStylesheet} from '../style/graph-style-engine';
import {mixedGetPosition} from '../utils/layer-utils';
import {InteractionManager} from '../core/interaction-manager';
import {buildCollapsedChainLayers} from '../utils/collapsed-chains';

import {warn} from '../utils/log';

import {
  DEFAULT_GRAPH_LAYER_STYLESHEET,
  normalizeGraphLayerStylesheet,
  type GraphLayerEdgeStyle,
  type GraphLayerNodeStyle,
  type GraphLayerStylesheet,
  type NormalizedGraphLayerStylesheet
} from '../style/graph-layer-stylesheet';

// node layers
import {CircleLayer} from './node-layers/circle-layer';
import {ImageLayer} from './node-layers/image-layer';
import {LabelLayer} from './node-layers/label-layer';
import {RectangleLayer} from './node-layers/rectangle-layer';
import {RoundedRectangleLayer} from './node-layers/rounded-rectangle-layer';
import {PathBasedRoundedRectangleLayer} from './node-layers/path-rounded-rectangle-layer';
import {ZoomableMarkerLayer} from './node-layers/zoomable-marker-layer';

// edge layers
import {EdgeLayer} from './edge-layer';
import {EdgeLabelLayer} from './edge-layers/edge-label-layer';
import {FlowLayer} from './edge-layers/flow-layer';
import {EdgeArrowLayer} from './edge-layers/edge-arrow-layer';
import {EdgeAttachmentHelper} from './edge-attachment-helper';

import {JSONLoader} from '../loaders/json-loader';

const NODE_LAYER_MAP = {
  'rectangle': RectangleLayer,
  'rounded-rectangle': RoundedRectangleLayer,
  'path-rounded-rectangle': PathBasedRoundedRectangleLayer,
  'icon': ImageLayer,
  'circle': CircleLayer,
  'label': LabelLayer,
  'marker': ZoomableMarkerLayer
};

const EDGE_DECORATOR_LAYER_MAP = {
  'edge-label': EdgeLabelLayer,
  'flow': FlowLayer,
  'arrow': EdgeArrowLayer
};

const SHARED_LAYER_PROPS = {
  coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
  parameters: {
    depthTest: false
  }
};

const NODE_STYLE_DEPRECATION_MESSAGE =
  'GraphLayer: `nodeStyle` has been replaced by `stylesheet.nodes` and will be removed in a future release.';
const EDGE_STYLE_DEPRECATION_MESSAGE =
  'GraphLayer: `edgeStyle` has been replaced by `stylesheet.edges` and will be removed in a future release.';

let NODE_STYLE_DEPRECATION_WARNED = false;
let EDGE_STYLE_DEPRECATION_WARNED = false;

export type GraphLayerProps = CompositeLayerProps & _GraphLayerProps;

export type _GraphLayerProps = {
  graph?: Graph;
  layout?: GraphLayout;
  graphLoader?: (opts: {json: any}) => Graph;
  engine?: GraphEngine;

  stylesheet?: GraphLayerStylesheet;
  /** @deprecated Use `stylesheet.nodes`. */
  nodeStyle?: GraphLayerNodeStyle[];
  /** @deprecated Use `stylesheet.edges`. */
  edgeStyle?: GraphLayerEdgeStyle | GraphLayerEdgeStyle[];
  nodeEvents?: {
    onMouseLeave?: () => void;
    onHover?: () => void;
    onMouseEnter?: () => void;
    onClick?: () => void;
    onDrag?: () => void;
  };
  edgeEvents?: {
    onClick: () => void;
    onHover: () => void;
  };
  enableDragging?: boolean;
};

/** Composite layer that renders graph nodes, edges, and decorators. */
export class GraphLayer extends CompositeLayer<GraphLayerProps> {
  static layerName = 'GraphLayer';

  static defaultProps: Required<_GraphLayerProps> = {
    // Composite layer props
    // @ts-expect-error composite layer props
    pickable: true,

    // Graph props
    graphLoader: JSONLoader,

    stylesheet: DEFAULT_GRAPH_LAYER_STYLESHEET,
    nodeStyle: undefined as unknown as GraphLayerNodeStyle[],
    nodeEvents: {
      onMouseLeave: () => {},
      onHover: () => {},
      onMouseEnter: () => {},
      onClick: () => {},
      onDrag: () => {}
    },
    edgeStyle: undefined as unknown as GraphLayerEdgeStyle | GraphLayerEdgeStyle[],
    edgeEvents: {
      onClick: () => {},
      onHover: () => {}
    },
    enableDragging: false
  };

  // @ts-expect-error Some typescript confusion due to override of base class state
  state!: CompositeLayer<GraphLayerProps>['state'] & {
    interactionManager: InteractionManager;
    graphEngine?: GraphEngine;
  };

  private readonly _edgeAttachmentHelper = new EdgeAttachmentHelper();

  forceUpdate = () => {
    if (this.context && this.context.layerManager) {
      this.setNeedsUpdate();
      this.setChangeFlags({dataChanged: true} as any); // TODO
    }
  };

  constructor(props: GraphLayerProps & CompositeLayerProps) {
    super(props);
  }

  initializeState() {
    this.state = {
      interactionManager: new InteractionManager(this.props as any, () => this.forceUpdate())
    };
    const engine = this.props.engine;
    this._setGraphEngine(engine);
  }

  shouldUpdateState({changeFlags}) {
    return changeFlags.dataChanged || changeFlags.propsChanged;
  }

  updateState({props, oldProps, changeFlags}) {
    if (
      changeFlags.dataChanged &&
      props.data &&
      !(Array.isArray(props.data) && props.data.length === 0)
    ) {
      // console.log(props.data);
      const graph = this.props.graphLoader({json: props.data});
      const layout = this.props.layout;
      const graphEngine = new GraphEngine({graph, layout});
      this._setGraphEngine(graphEngine);
      this.state.interactionManager.updateProps(props);
      this.forceUpdate();
    } else if (changeFlags.propsChanged && props.graph !== oldProps.graph) {
      const graphEngine = new GraphEngine({graph: props.graph, layout: props.layout});
      this._setGraphEngine(graphEngine);
      this.state.interactionManager.updateProps(props);
      this.forceUpdate();
    } else if (changeFlags.propsChanged && props.engine !== oldProps.engine) {
      this._setGraphEngine(props.engine);
      this.state.interactionManager.updateProps(props);
      this.forceUpdate();
    }
  }

  finalize() {
    this._removeGraphEngine();
  }

  private _getResolvedStylesheet(): NormalizedGraphLayerStylesheet {
    const {stylesheet, nodeStyle, edgeStyle} = this.props;

    const usingNodeStyle = typeof nodeStyle !== 'undefined';
    if (usingNodeStyle && !NODE_STYLE_DEPRECATION_WARNED) {
      warn(NODE_STYLE_DEPRECATION_MESSAGE);
      NODE_STYLE_DEPRECATION_WARNED = true;
    }

    const usingEdgeStyle = typeof edgeStyle !== 'undefined';
    if (usingEdgeStyle && !EDGE_STYLE_DEPRECATION_WARNED) {
      warn(EDGE_STYLE_DEPRECATION_MESSAGE);
      EDGE_STYLE_DEPRECATION_WARNED = true;
    }

    return normalizeGraphLayerStylesheet({
      stylesheet,
      nodeStyle: usingNodeStyle ? nodeStyle : undefined,
      edgeStyle: usingEdgeStyle ? edgeStyle : undefined
    });
  }

  private _createStyleEngine(style: GraphStylesheet, context: string): GraphStyleEngine | null {
    try {
      return new GraphStyleEngine(style, {
        stateUpdateTrigger: (this.state.interactionManager as any).getLastInteraction()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`GraphLayer: Failed to apply ${context}: ${message}`);
      return null;
    }
  }

  _setGraphEngine(graphEngine: GraphEngine) {
    if (graphEngine === this.state.graphEngine) {
      return;
    }

    this._removeGraphEngine();
    if (graphEngine) {
      this.state.graphEngine = graphEngine;
      this.state.graphEngine.run();
      // added or removed a node, or in general something layout related changed
      this.state.graphEngine.addEventListener('onLayoutChange', this.forceUpdate);
    }
  }

  _removeGraphEngine() {
    if (this.state.graphEngine) {
      this.state.graphEngine.removeEventListener('onLayoutChange', this.forceUpdate);
      this.state.graphEngine.clear();
      this.state.graphEngine = null;
    }
  }

  createNodeLayers() {
    const engine = this.state.graphEngine;
    const {nodes: nodeStyles} = this._getResolvedStylesheet();

    if (!engine || !Array.isArray(nodeStyles) || nodeStyles.length === 0) {
      return [];
    }

    const baseLayers = nodeStyles
      .filter(Boolean)
      .map((style, idx) => {
        const {pickable = true, visible = true, data = (nodes) => nodes, ...restStyle} = style;
        const LayerType = NODE_LAYER_MAP[style.type];
        if (!LayerType) {
          warn(`GraphLayer: Invalid node type "${style.type}".`);
          return null;
        }
        const stylesheet = this._createStyleEngine(
          restStyle as unknown as GraphStylesheet,
          `node stylesheet "${style.type}"`
        );
        if (!stylesheet) {
          return null;
        }
        const getOffset = stylesheet.getDeckGLAccessor('getOffset');
        return new LayerType({
          ...SHARED_LAYER_PROPS,
          id: `node-rule-${idx}`,
          data: data(engine.getNodes()),
          getPosition: mixedGetPosition(engine.getNodePosition, getOffset),
          pickable,
          positionUpdateTrigger: [
            engine.getLayoutLastUpdate(),
            engine.getLayoutState(),
            stylesheet.getDeckGLAccessorUpdateTrigger('getOffset')
          ].join(),
          stylesheet,
          visible
        } as any);
      })
      .filter(Boolean) as any[];

    const chainLayers = this._createChainOverlayLayers(engine);

    return [...baseLayers, ...chainLayers];
  }

  createEdgeLayers() {
    const engine = this.state.graphEngine;
    const {edges: edgeStyles, nodes: nodeStyles} = this._getResolvedStylesheet();

    if (!engine || !edgeStyles) {
      return [];
    }

    const edgeStyleArray = Array.isArray(edgeStyles) ? edgeStyles : [edgeStyles];

    if (edgeStyleArray.length === 0) {
      return [];
    }

    const getLayoutInfo = this._edgeAttachmentHelper.getLayoutAccessor({
      engine,
      interactionManager: this.state.interactionManager,
      nodeStyle: nodeStyles
    });

    return edgeStyleArray
      .filter(Boolean)
      .flatMap((style, idx) => {
        const {decorators, data = (edges) => edges, visible = true, ...restEdgeStyle} = style;
        const stylesheet = this._createStyleEngine(
          {
            type: 'edge',
            ...restEdgeStyle
          } as GraphStylesheet,
          'edge stylesheet'
        );
        if (!stylesheet) {
          return [];
        }

        const edgeLayer = new EdgeLayer({
          ...SHARED_LAYER_PROPS,
          id: `edge-layer-${idx}`,
          data: data(engine.getEdges()),
          getLayoutInfo,
          pickable: true,
          positionUpdateTrigger: [engine.getLayoutLastUpdate(), engine.getLayoutState()].join(),
          stylesheet,
          visible
        } as any);

        if (!decorators || !Array.isArray(decorators) || decorators.length === 0) {
          return [edgeLayer];
        }

        const decoratorLayers = decorators
          .filter(Boolean)
          .map((decoratorStyle, idx2) => {
            const DecoratorLayer = EDGE_DECORATOR_LAYER_MAP[decoratorStyle.type];
            if (!DecoratorLayer) {
              warn(`GraphLayer: Invalid edge decorator type "${decoratorStyle.type}".`);
              return null;
            }
            const decoratorStylesheet = this._createStyleEngine(
              decoratorStyle as unknown as GraphStylesheet,
              `edge decorator stylesheet "${decoratorStyle.type}"`
            );
            if (!decoratorStylesheet) {
              return null;
            }
            return new DecoratorLayer({
              ...SHARED_LAYER_PROPS,
              id: `edge-decorator-${idx2}`,
              data: data(engine.getEdges()),
              getLayoutInfo,
              pickable: true,
              positionUpdateTrigger: [engine.getLayoutLastUpdate(), engine.getLayoutState()].join(),
              stylesheet: decoratorStylesheet
            } as any);
          })
          .filter(Boolean);

        return [edgeLayer, ...decoratorLayers];
      });
  }

  onClick(info, event): boolean {
    return (this.state.interactionManager.onClick(info, event) as unknown as boolean) || false;
  }

  onHover(info, event): boolean {
    return (this.state.interactionManager.onHover(info, event) as unknown as boolean) || false;
  }

  onDragStart(info, event) {
    this.state.interactionManager.onDragStart(info, event);
  }

  onDrag(info, event) {
    this.state.interactionManager.onDrag(info, event);
  }

  onDragEnd(info, event) {
    this.state.interactionManager.onDragEnd(info, event);
  }

  renderLayers() {
    return [this.createEdgeLayers(), this.createNodeLayers()];
  }

  private _createChainOverlayLayers(engine: GraphEngine) {
    const chainData = buildCollapsedChainLayers(engine);
    if (!chainData) {
      return [];
    }

    const {
      collapsedNodes,
      collapsedOutlineNodes,
      expandedNodes,
      expandedOutlineNodes,
      getChainOutlinePolygon,
      outlineUpdateTrigger
    } = chainData;

    const layers: any[] = [];

    if (collapsedOutlineNodes.length > 0) {
      layers.push(
        new PolygonLayer({
          ...SHARED_LAYER_PROPS,
          id: 'collapsed-chain-outlines',
          data: collapsedOutlineNodes,
          getPolygon: (node: Node) => getChainOutlinePolygon(node),
          stroked: true,
          filled: false,
          getLineColor: [220, 64, 64, 220],
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          lineWidthMinPixels: 2,
          pickable: true,
          updateTriggers: {
            getPolygon: [outlineUpdateTrigger]
          }
        })
      );
    }

    const collapsedMarkerStylesheet = this._createStyleEngine(
      {
        type: 'marker',
        fill: [64, 96, 192, 255],
        size: 32,
        marker: 'circle-plus-filled',
        offset: [24, -24],
        scaleWithZoom: false
      } as GraphStylesheet<'marker'>,
      'collapsed chain marker stylesheet'
    );

    if (collapsedMarkerStylesheet && collapsedNodes.length > 0) {
      const getOffset = collapsedMarkerStylesheet.getDeckGLAccessor('getOffset');
      layers.push(
        new ZoomableMarkerLayer({
          ...SHARED_LAYER_PROPS,
          id: 'collapsed-chain-markers',
          data: collapsedNodes,
          getPosition: mixedGetPosition(engine.getNodePosition, getOffset),
          pickable: true,
          positionUpdateTrigger: [
            engine.getLayoutLastUpdate(),
            engine.getLayoutState(),
            collapsedMarkerStylesheet.getDeckGLAccessorUpdateTrigger('getOffset')
          ].join(),
          stylesheet: collapsedMarkerStylesheet,
          visible: true
        } as any)
      );
    }

    if (expandedOutlineNodes.length > 0) {
      layers.push(
        new PolygonLayer({
          ...SHARED_LAYER_PROPS,
          id: 'expanded-chain-outlines',
          data: expandedOutlineNodes,
          getPolygon: (node: Node) => getChainOutlinePolygon(node),
          stroked: true,
          filled: false,
          getLineColor: [64, 96, 192, 200],
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          lineWidthMinPixels: 2,
          pickable: true,
          updateTriggers: {
            getPolygon: [outlineUpdateTrigger]
          }
        })
      );
    }

    const expandedMarkerStylesheet = this._createStyleEngine(
      {
        type: 'marker',
        fill: [64, 96, 192, 255],
        size: 32,
        marker: 'circle-minus-filled',
        offset: [24, -24],
        scaleWithZoom: false
      } as GraphStylesheet<'marker'>,
      'expanded chain marker stylesheet'
    );

    if (expandedMarkerStylesheet && expandedNodes.length > 0) {
      const getOffset = expandedMarkerStylesheet.getDeckGLAccessor('getOffset');
      layers.push(
        new ZoomableMarkerLayer({
          ...SHARED_LAYER_PROPS,
          id: 'expanded-chain-markers',
          data: expandedNodes,
          getPosition: mixedGetPosition(engine.getNodePosition, getOffset),
          pickable: true,
          positionUpdateTrigger: [
            engine.getLayoutLastUpdate(),
            engine.getLayoutState(),
            expandedMarkerStylesheet.getDeckGLAccessorUpdateTrigger('getOffset')
          ].join(),
          stylesheet: expandedMarkerStylesheet,
          visible: true
        } as any)
      );
    }

    return layers;
  }
}
