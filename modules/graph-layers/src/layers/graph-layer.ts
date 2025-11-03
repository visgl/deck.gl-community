// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {CompositeLayerProps} from '@deck.gl/core';
import {COORDINATE_SYSTEM, CompositeLayer} from '@deck.gl/core';

import {Graph} from '../graph/graph';
import {GraphLayout} from '../core/graph-layout';
import {GraphEngine} from '../core/graph-engine';

import {GraphStyleEngine} from '../style/graph-style-engine';
import type {GraphStylesheet} from '../style/graph-style-engine';
import {mixedGetPosition} from '../utils/layer-utils';
import {InteractionManager} from '../core/interaction-manager';

import {log} from '../utils/log';

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
      log.warn(NODE_STYLE_DEPRECATION_MESSAGE);
      NODE_STYLE_DEPRECATION_WARNED = true;
    }

    const usingEdgeStyle = typeof edgeStyle !== 'undefined';
    if (usingEdgeStyle && !EDGE_STYLE_DEPRECATION_WARNED) {
      log.warn(EDGE_STYLE_DEPRECATION_MESSAGE);
      EDGE_STYLE_DEPRECATION_WARNED = true;
    }

    return normalizeGraphLayerStylesheet({
      stylesheet,
      nodeStyle: usingNodeStyle ? nodeStyle : undefined,
      edgeStyle: usingEdgeStyle ? edgeStyle : undefined
    });
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

    const layers = nodeStyles.filter(Boolean).map((style, idx) => {
      const {pickable = true, visible = true, data = (nodes) => nodes, ...restStyle} = style;
      const LayerType = NODE_LAYER_MAP[style.type];
      if (!LayerType) {
        log.error(`Invalid node type: ${style.type}`);
        throw new Error(`Invalid node type: ${style.type}`);
      }
      const stylesheet = new GraphStyleEngine(restStyle, {
        stateUpdateTrigger: (this.state.interactionManager as any).getLastInteraction()
      });
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
    });

    const chainRepresentativeNodes = engine.getNodes().filter((node) => {
      const chainId = node.getPropertyValue('collapsedChainId');
      const nodeIds = node.getPropertyValue('collapsedNodeIds');
      const representativeId = node.getPropertyValue('collapsedChainRepresentativeId');
      return (
        chainId &&
        Array.isArray(nodeIds) &&
        nodeIds.length > 1 &&
        representativeId === node.getId()
      );
    });

    if (chainRepresentativeNodes.length > 0) {
      const collapsedNodes = chainRepresentativeNodes.filter((node) =>
        Boolean(node.getPropertyValue('isCollapsedChain'))
      );
      if (collapsedNodes.length > 0) {
        const collapsedOutlineStyle: GraphStylesheet<'marker'> = {
          type: 'marker',
          fill: [64, 96, 192, 160],
          size: 44,
          marker: 'rectangle',
          offset: [24, -24],
          scaleWithZoom: false
        };
        const collapsedOutlineStylesheet = new GraphStyleEngine(collapsedOutlineStyle, {
          stateUpdateTrigger: (this.state.interactionManager as any).getLastInteraction()
        });
        const collapsedOutlineOffset = collapsedOutlineStylesheet.getDeckGLAccessor('getOffset');
        layers.push(
          new ZoomableMarkerLayer({
            ...SHARED_LAYER_PROPS,
            id: 'collapsed-chain-outlines',
            data: collapsedNodes,
            getPosition: mixedGetPosition(engine.getNodePosition, collapsedOutlineOffset),
            pickable: true,
            positionUpdateTrigger: [
              engine.getLayoutLastUpdate(),
              engine.getLayoutState(),
              collapsedOutlineStylesheet.getDeckGLAccessorUpdateTrigger('getOffset')
            ].join(),
            stylesheet: collapsedOutlineStylesheet,
            visible: true
          } as any)
        );

        const collapsedMarkerStyle: GraphStylesheet<'marker'> = {
          type: 'marker',
          fill: [64, 96, 192, 255],
          size: 32,
          marker: 'circle-plus-filled',
          offset: [24, -24],
          scaleWithZoom: false
        };
        const collapsedStylesheet = new GraphStyleEngine(collapsedMarkerStyle, {
          stateUpdateTrigger: (this.state.interactionManager as any).getLastInteraction()
        });
        const getOffset = collapsedStylesheet.getDeckGLAccessor('getOffset');
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
              collapsedStylesheet.getDeckGLAccessorUpdateTrigger('getOffset')
            ].join(),
            stylesheet: collapsedStylesheet,
            visible: true
          } as any)
        );
      }

      const expandedNodes = chainRepresentativeNodes.filter(
        (node) => !node.getPropertyValue('isCollapsedChain')
      );
      if (expandedNodes.length > 0) {
        const expandedOutlineStyle: GraphStylesheet<'marker'> = {
          type: 'marker',
          fill: [64, 96, 192, 160],
          size: 44,
          marker: 'rectangle',
          offset: [24, -24],
          scaleWithZoom: false
        };
        const expandedOutlineStylesheet = new GraphStyleEngine(expandedOutlineStyle, {
          stateUpdateTrigger: (this.state.interactionManager as any).getLastInteraction()
        });
        const expandedOutlineOffset = expandedOutlineStylesheet.getDeckGLAccessor('getOffset');
        layers.push(
          new ZoomableMarkerLayer({
            ...SHARED_LAYER_PROPS,
            id: 'expanded-chain-outlines',
            data: expandedNodes,
            getPosition: mixedGetPosition(engine.getNodePosition, expandedOutlineOffset),
            pickable: true,
            positionUpdateTrigger: [
              engine.getLayoutLastUpdate(),
              engine.getLayoutState(),
              expandedOutlineStylesheet.getDeckGLAccessorUpdateTrigger('getOffset')
            ].join(),
            stylesheet: expandedOutlineStylesheet,
            visible: true
          } as any)
        );

        const expandedMarkerStyle: GraphStylesheet<'marker'> = {
          type: 'marker',
          fill: [64, 96, 192, 255],
          size: 32,
          marker: 'circle-minus-filled',
          offset: [24, -24],
          scaleWithZoom: false
        };
        const expandedStylesheet = new GraphStyleEngine(expandedMarkerStyle, {
          stateUpdateTrigger: (this.state.interactionManager as any).getLastInteraction()
        });
        const getOffset = expandedStylesheet.getDeckGLAccessor('getOffset');
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
              expandedStylesheet.getDeckGLAccessorUpdateTrigger('getOffset')
            ].join(),
            stylesheet: expandedStylesheet,
            visible: true
          } as any)
        );
      }
    }

    return layers;
  }

  createEdgeLayers() {
    const engine = this.state.graphEngine;
    const {edges: edgeStyles} = this._getResolvedStylesheet();

    if (!engine || !edgeStyles || edgeStyles.length === 0) {
      return [];
    }

    return edgeStyles
      .filter(Boolean)
      .flatMap((style, idx) => {
        const {decorators, data = (edges) => edges, visible = true, ...restEdgeStyle} = style;
        const stylesheet = new GraphStyleEngine(
          {
            type: 'edge',
            ...restEdgeStyle
          },
          {
            stateUpdateTrigger: (this.state.interactionManager as any).getLastInteraction()
          }
        );

        const edgeLayer = new EdgeLayer({
          ...SHARED_LAYER_PROPS,
          id: `edge-layer-${idx}`,
          data: data(engine.getEdges()),
          getLayoutInfo: engine.getEdgePosition,
          pickable: true,
          positionUpdateTrigger: [engine.getLayoutLastUpdate(), engine.getLayoutState()].join(),
          stylesheet,
          visible
        } as any);

        if (!decorators || !Array.isArray(decorators) || decorators.length === 0) {
          return edgeLayer;
        }
        const decoratorLayers = decorators.filter(Boolean).flatMap((decoratorStyle, idx2) => {
          const DecoratorLayer = EDGE_DECORATOR_LAYER_MAP[decoratorStyle.type];
          if (!DecoratorLayer) {
            log.error(`Invalid edge decorator type: ${decoratorStyle.type}`);
            throw new Error(`Invalid edge decorator type: ${decoratorStyle.type}`);
          }
          const decoratorStylesheet = new GraphStyleEngine(decoratorStyle, {
            stateUpdateTrigger: (this.state.interactionManager as any).getLastInteraction()
          });
          return new DecoratorLayer({
            ...SHARED_LAYER_PROPS,
            id: `edge-decorator-${idx2}`,
            data: data(engine.getEdges()),
            getLayoutInfo: engine.getEdgePosition,
            pickable: true,
            positionUpdateTrigger: [engine.getLayoutLastUpdate(), engine.getLayoutState()].join(),
            stylesheet: decoratorStylesheet
          } as any);
        });
        return [edgeLayer, decoratorLayers];
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
}
