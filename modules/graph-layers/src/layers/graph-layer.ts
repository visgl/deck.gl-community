// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {CompositeLayerProps} from '@deck.gl/core';
import {COORDINATE_SYSTEM, CompositeLayer} from '@deck.gl/core';

import {NODE_TYPE, EDGE_DECORATOR_TYPE} from '../core/constants';
import {Graph} from '../graph/graph';
import {GraphLayout} from '../core/graph-layout';
import {GraphEngine} from '../core/graph-engine';

import {Stylesheet} from '../style/style-sheet';
import {mixedGetPosition} from '../utils/layer-utils';
import {InteractionManager} from '../core/interaction-manager';

import {log} from '../utils/log';

import {EdgeAttachmentHelper, type NodeStyleLayoutContext} from './edge-attachment-helper';

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

import {JSONLoader} from '../loaders/json-loader';

const NODE_LAYER_MAP = {
  [NODE_TYPE.RECTANGLE]: RectangleLayer,
  [NODE_TYPE.ROUNDED_RECTANGLE]: RoundedRectangleLayer,
  [NODE_TYPE.PATH_ROUNDED_RECTANGLE]: PathBasedRoundedRectangleLayer,
  [NODE_TYPE.ICON]: ImageLayer,
  [NODE_TYPE.CIRCLE]: CircleLayer,
  [NODE_TYPE.LABEL]: LabelLayer,
  [NODE_TYPE.MARKER]: ZoomableMarkerLayer
};

const EDGE_DECORATOR_LAYER_MAP = {
  [EDGE_DECORATOR_TYPE.LABEL]: EdgeLabelLayer,
  [EDGE_DECORATOR_TYPE.FLOW]: FlowLayer
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
    }
  }

  finalize() {
    this._removeGraphEngine();
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
    const {nodeStyle} = this.props;
    if (!engine || !nodeStyle) {
      return [];
    }

    const descriptors = this._getNodeLayerDescriptors();
    if (descriptors.length === 0) {
      return [];
    }

    return descriptors.map((descriptor) => {
      const {index, layerCtor: LayerType, pickable, visible, stylesheet, dataAccessor} = descriptor;
      const getOffset = stylesheet.getDeckGLAccessor('getOffset');
      return new LayerType({
        ...SHARED_LAYER_PROPS,
        id: `node-rule-${index}`,
        data: dataAccessor(engine.getNodes()),
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
  }

  createEdgeLayers() {
    const engine = this.state.graphEngine;
    const {edgeStyle} = this.props;

    if (!engine || !edgeStyle) {
      return [];
    }

    const descriptors = this._getNodeLayerDescriptors();
    const getLayoutInfo = this._edgeAttachmentHelper.getLayoutAccessor({
      engine,
      nodeStyles: descriptors
    });

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
          getLayoutInfo,
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
            getLayoutInfo,
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

  private _getNodeLayerDescriptors(): Array<
    NodeStyleLayoutContext & {
      index: number;
      layerCtor: any;
      pickable: boolean;
      visible: boolean;
    }
  > {
    const {nodeStyle} = this.props;
    if (!nodeStyle) {
      return [];
    }

    const styles = Array.isArray(nodeStyle) ? nodeStyle : [nodeStyle];

    return styles
      .map((style, index) => {
        if (!style) {
          return null;
        }

        const {pickable = true, visible = true, data = (nodes) => nodes, ...restStyle} = style;
        const LayerType = NODE_LAYER_MAP[style.type];
        if (!LayerType) {
          log.error(`Invalid node type: ${style.type}`)();
          throw new Error(`Invalid node type: ${style.type}`);
        }

        const stylesheet = new Stylesheet(restStyle, {
          stateUpdateTrigger: (this.state.interactionManager as any).getLastInteraction()
        });

        return {
          index,
          layerCtor: LayerType,
          pickable,
          visible,
          stylesheet,
          dataAccessor: data as NodeStyleLayoutContext['dataAccessor']
        };
      })
      .filter(Boolean) as Array<
      NodeStyleLayoutContext & {
        index: number;
        layerCtor: any;
        pickable: boolean;
        visible: boolean;
      }
    >;
  }
}
