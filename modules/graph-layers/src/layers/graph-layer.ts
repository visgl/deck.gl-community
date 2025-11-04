// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {CompositeLayerProps} from '@deck.gl/core';
import {COORDINATE_SYSTEM, CompositeLayer} from '@deck.gl/core';

import {Graph} from '../graph/graph';
import {GraphLayout} from '../core/graph-layout';
import {GraphEngine} from '../core/graph-engine';

import {Stylesheet} from '../style/style-sheet';
import {mixedGetPosition} from '../utils/layer-utils';
import {InteractionManager} from '../core/interaction-manager';

import {log} from '../utils/log';

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

export type GraphLayerProps = CompositeLayerProps & _GraphLayerProps;

export type _GraphLayerProps = {
  graph?: Graph;
  layout?: GraphLayout;
  graphLoader?: (opts: {json: any}) => Graph;
  engine?: GraphEngine;
  /** Minimum time (in milliseconds) between layout updates emitted by the internal engine. */
  layoutUpdateInterval?: number;
  /** Whether to enable deck.gl transitions when layout updates are throttled. */
  layoutTransitions?: boolean;
  /** Delay before emitting layout updates when the layer is (re)initialized. */
  layoutUpdateDelay?: number;

  // an array of styles for layers
  nodeStyle?: any[];
  edgeStyle?: {
    stroke?: string;
    strokeWidth?: number;
    /** an array of styles for layers */
    decorators?: any[];
  };
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

export class GraphLayer extends CompositeLayer<GraphLayerProps> {
  static layerName = 'GraphLayer';

  static defaultProps: Required<_GraphLayerProps> = {
    // Composite layer props
    // @ts-expect-error composite layer props
    pickable: true,

    // Graph props
    graphLoader: JSONLoader,
    layoutUpdateInterval: 300,
    layoutTransitions: false,
    layoutUpdateDelay: 1000,

    nodeStyle: [],
    nodeEvents: {
      onMouseLeave: () => {},
      onHover: () => {},
      onMouseEnter: () => {},
      onClick: () => {},
      onDrag: () => {}
    },
    edgeStyle: {
      stroke: 'black',
      strokeWidth: 1,
      // an array of styles for layers
      decorators: []
    },
    edgeEvents: {
      onClick: () => {},
      onHover: () => {}
    },
    enableDragging: false
  };

  // @ts-expect-error Some typescript confusion due to override of base class state
  state!: CompositeLayer<GraphLayerProps>['state'] & {
    interactionManager: InteractionManager;
    graphEngine?: GraphEngine | null;
  };

  private _layoutDelayActive = false;
  private _shouldApplyLayoutDelay = false;

  private _handleLayoutChange = () => {
    if (this._layoutDelayActive) {
      this._shouldApplyLayoutDelay = true;
      this._layoutDelayActive = false;
    }
    this.forceUpdate();
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
      const graph = props.graphLoader({json: props.data});
      const layout = props.layout;
      const graphEngine = this._createGraphEngine(graph, layout, props);
      this._setGraphEngine(graphEngine);
      this.state.interactionManager.updateProps(props);
      this.forceUpdate();
    } else if (changeFlags.propsChanged && props.graph !== oldProps.graph) {
      const graphEngine = this._createGraphEngine(props.graph, props.layout, props);
      this._setGraphEngine(graphEngine);
      this.state.interactionManager.updateProps(props);
      this.forceUpdate();
    } else if (changeFlags.propsChanged && props.engine !== oldProps.engine) {
      this._setGraphEngine(props.engine);
      this.state.interactionManager.updateProps(props);
      this.forceUpdate();
    }

    if (changeFlags.propsChanged && props.layoutUpdateDelay !== oldProps.layoutUpdateDelay) {
      this._layoutDelayActive = (props.layoutUpdateDelay ?? 0) > 0;
      this._shouldApplyLayoutDelay = false;
    }
  }

  finalize() {
    this._removeGraphEngine();
  }

  _setGraphEngine(graphEngine: GraphEngine | null) {
    if (graphEngine === this.state.graphEngine) {
      return;
    }

    this._removeGraphEngine();
    if (graphEngine) {
      this.state.graphEngine = graphEngine;
      this._layoutDelayActive = (this.props.layoutUpdateDelay ?? 0) > 0;
      this._shouldApplyLayoutDelay = false;
      this.state.graphEngine.addEventListener('onLayoutChange', this._handleLayoutChange);
      this.state.graphEngine.run();
      // added or removed a node, or in general something layout related changed
    }
  }

  _removeGraphEngine() {
    if (this.state.graphEngine) {
      this.state.graphEngine.removeEventListener('onLayoutChange', this._handleLayoutChange);
      this.state.graphEngine.clear();
      this.state.graphEngine = null;
    }
    this._layoutDelayActive = false;
    this._shouldApplyLayoutDelay = false;
  }

  private _createGraphEngine(
    graph?: Graph,
    layout?: GraphLayout,
    props: GraphLayerProps = this.props
  ): GraphEngine | null {
    if (!graph || !layout) {
      return null;
    }
    return new GraphEngine({
      graph,
      layout,
      layoutUpdateThrottleMs: props.layoutUpdateInterval
    });
  }

  private _getLayoutTransitionSettings(): any {
    const {layoutUpdateInterval, layoutTransitions, layoutUpdateDelay} = this.props;
    if (!layoutTransitions || !layoutUpdateInterval || layoutUpdateInterval <= 0) {
      this._shouldApplyLayoutDelay = false;
      return undefined;
    }
    const transition: any = {duration: layoutUpdateInterval};
    if (this._shouldApplyLayoutDelay && layoutUpdateDelay && layoutUpdateDelay > 0) {
      transition.delay = layoutUpdateDelay;
    }
    this._shouldApplyLayoutDelay = false;
    return transition;
  }

  private _getNodeTransitions(layoutTransition?: any): any {
    const transition = layoutTransition;
    if (!transition) {
      return undefined;
    }
    return {
      getPosition: transition
    };
  }

  private _getEdgeTransitions(layoutTransition?: any): any {
    const transition = layoutTransition;
    if (!transition) {
      return undefined;
    }
    return {
      getSourcePosition: transition,
      getTargetPosition: transition,
      getControlPoints: transition,
      getPath: transition,
      getPosition: transition,
      getOrientation: transition
    };
  }

  createNodeLayers(layoutTransition?: any) {
    const engine = this.state.graphEngine;
    const {nodeStyle} = this.props;
    if (!engine || !nodeStyle || !Array.isArray(nodeStyle) || nodeStyle.length === 0) {
      return [];
    }

    const nodeTransitions = this._getNodeTransitions(layoutTransition);

    return nodeStyle.filter(Boolean).map((style, idx) => {
      const {pickable = true, visible = true, data = (nodes) => nodes, ...restStyle} = style;
      const LayerType = NODE_LAYER_MAP[style.type];
      if (!LayerType) {
        log.error(`Invalid node type: ${style.type}`)();
        throw new Error(`Invalid node type: ${style.type}`);
      }
      const stylesheet = new Stylesheet(restStyle, {
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
        transitions: nodeTransitions,
        stylesheet,
        visible
      } as any);
    });
  }

  createEdgeLayers(layoutTransition?: any) {
    const engine = this.state.graphEngine;
    const {edgeStyle} = this.props;

    if (!engine || !edgeStyle) {
      return [];
    }

    const edgeTransitions = this._getEdgeTransitions(layoutTransition);

    return (Array.isArray(edgeStyle) ? edgeStyle : [edgeStyle])
      .filter(Boolean)
      .flatMap((style, idx) => {
        const {decorators, data = (edges) => edges, visible = true, ...restEdgeStyle} = style;
        const stylesheet = new Stylesheet(
          {
            type: 'Edge',
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
          transitions: edgeTransitions,
          stylesheet,
          visible
        } as any);

        if (!decorators || !Array.isArray(decorators) || decorators.length === 0) {
          return edgeLayer;
        }

        const decoratorLayers = decorators
          .filter(Boolean)
          .flatMap((decoratorStyle, idx2) => {
            const DecoratorLayer = EDGE_DECORATOR_LAYER_MAP[decoratorStyle.type];
            if (!DecoratorLayer) {
              log.error(`Invalid edge decorator type: ${decoratorStyle.type}`)();
              throw new Error(`Invalid edge decorator type: ${decoratorStyle.type}`);
            }
            const decoratorStylesheet = new Stylesheet(decoratorStyle, {
              stateUpdateTrigger: (this.state.interactionManager as any).getLastInteraction()
            });
            return new DecoratorLayer({
              ...SHARED_LAYER_PROPS,
              id: `edge-decorator-${idx2}`,
              data: data(engine.getEdges()),
              getLayoutInfo: engine.getEdgePosition,
              pickable: true,
              positionUpdateTrigger: [engine.getLayoutLastUpdate(), engine.getLayoutState()].join(),
              transitions: edgeTransitions,
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
    const layoutTransition = this._getLayoutTransitionSettings();
    return [this.createEdgeLayers(layoutTransition), this.createNodeLayers(layoutTransition)];
  }
}
