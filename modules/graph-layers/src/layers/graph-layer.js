import {COORDINATE_SYSTEM, CompositeLayer} from '@deck.gl/core';

import Stylesheet from './style/style-sheet';
import {NODE_TYPE, EDGE_DECORATOR_TYPE, mixedGetPosition} from '../index';
import InteractionManager from '../core/interaction-manager';

import {log} from '../utils/log';

const defaultProps = {
  // an array of styles for layers
  nodeStyle: [],
  nodeEvents: {
    onMouseLeave: () => {},
    onHover: () => {},
    onMouseEnter: () => {},
    onClick: () => {},
    onDrag: () => {}
  },
  edgeStyle: {
    color: 'black',
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

// node layers
import CircleLayer from './node-layers/circle-layer';
import ImageLayer from './node-layers/image-layer';
import NodeLabelLayer from './node-layers/label-layer';
import RectangleLayer from './node-layers/rectangle-layer';
import RoundedRectangleLayer from './node-layers/rounded-rectangle-layer.js';
import ZoomableMarkerLayer from './node-layers/zoomable-marker-layer';

const NODE_LAYER_MAP = {
  [NODE_TYPE.RECTANGLE]: RectangleLayer,
  [NODE_TYPE.ROUNDED_RECTANGLE]: RoundedRectangleLayer,
  [NODE_TYPE.ICON]: ImageLayer,
  [NODE_TYPE.CIRCLE]: CircleLayer,
  [NODE_TYPE.LABEL]: NodeLabelLayer,
  [NODE_TYPE.MARKER]: ZoomableMarkerLayer
};

// edge layers
import CompositeEdgeLayer from './composite-edge-layer';
import EdgeLabelLayer from './edge-layers/edge-label-layer';
import FlowLayer from './edge-layers/flow-layer';

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

export default class GraphLayer extends CompositeLayer {
  static defaultProps = {
    pickable: true
  };

  constructor(props) {
    super(props);
    props.engine.registerCallbacks({
      onLayoutChange: () => this.forceUpdate()
    });
  }

  initializeState() {
    const interactionManager = new InteractionManager(this.props, () => this.forceUpdate());
    this.state = {interactionManager};
  }

  shouldUpdateState({changeFlags}) {
    return changeFlags.dataChanged || changeFlags.propsChanged;
  }

  updateState({props}) {
    this.state.interactionManager.updateProps(props);
  }

  finalize() {
    this.props.engine.unregisterCallbacks();
  }

  forceUpdate() {
    if (this.context && this.context.layerManager) {
      this.setNeedsUpdate();
      this.setChangeFlags({dataChanged: true});
    }
  }

  createNodeLayers() {
    const {engine, nodeStyle} = this.props;
    if (!nodeStyle || !Array.isArray(nodeStyle) || nodeStyle.length === 0) {
      return [];
    }
    return nodeStyle.filter(Boolean).map((style, idx) => {
      const {pickable = true, ...restStyle} = style;
      const LayerType = NODE_LAYER_MAP[style.type];
      if (!LayerType) {
        log.error(`Invalid node type: ${style.type}`)();
        throw new Error(`Invalid node type: ${style.type}`);
      }
      const stylesheet = new Stylesheet(restStyle, {
        stateUpdateTrigger: this.state.interactionManager.getLastInteraction()
      });
      const getOffset = stylesheet.getDeckGLAccessor('getOffset');
      return new LayerType({
        ...SHARED_LAYER_PROPS,
        id: `node-rule-${idx}`,
        data: engine.getGraph().getNodes(),
        getPosition: mixedGetPosition(engine.getNodePosition, getOffset),
        pickable,
        positionUpdateTrigger: [
          engine.getLayoutLastUpdate(),
          engine.getLayoutState(),
          stylesheet.getDeckGLAccessorUpdateTrigger('getOffset')
        ].join(),
        stylesheet
      });
    });
  }

  createEdgeLayers() {
    const {edgeStyle, engine} = this.props;
    const {decorators, ...restEdgeStyle} = edgeStyle;
    const stylesheet = new Stylesheet(
      {
        type: 'Edge',
        ...restEdgeStyle
      },
      {
        stateUpdateTrigger: this.state.interactionManager.getLastInteraction()
      }
    );
    const edgeLayer = new CompositeEdgeLayer({
      ...SHARED_LAYER_PROPS,
      id: 'edge-layer',
      data: engine.getGraph().getEdges(),
      getLayoutInfo: engine.getEdgePosition,
      pickable: true,
      positionUpdateTrigger: [engine.getLayoutLastUpdate(), engine.getLayoutState()].join(),
      stylesheet
    });
    if (!decorators || !Array.isArray(decorators) || decorators.length === 0) {
      return edgeLayer;
    }

    const decoratorLayers = decorators.filter(Boolean).map((style, idx) => {
      const DecoratorLayer = EDGE_DECORATOR_LAYER_MAP[style.type];
      // invalid decorator layer type
      if (!DecoratorLayer) {
        log.error(`Invalid edge decorator type: ${style.type}`)();
        throw new Error(`Invalid edge decorator type: ${style.type}`);
      }
      const decoratorStylesheet = new Stylesheet(style, {
        stateUpdateTrigger: this.state.interactionManager.getLastInteraction()
      });
      return new DecoratorLayer({
        ...SHARED_LAYER_PROPS,
        id: `edge-decorator-${idx}`,
        data: engine.getGraph().getEdges(),
        getLayoutInfo: engine.getEdgePosition,
        pickable: true,
        positionUpdateTrigger: [engine.getLayoutLastUpdate(), engine.getLayoutState()].join(),
        stylesheet: decoratorStylesheet
      });
    });
    return [edgeLayer, decoratorLayers];
  }

  onClick(info) {
    this.state.interactionManager.onClick(info);
  }

  onHover(info) {
    this.state.interactionManager.onHover(info);
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
    if (!this.props.engine.getGraph()) {
      return [];
    }
    return [this.createEdgeLayers(), this.createNodeLayers()];
  }
}

GraphLayer.layerName = 'GraphLayer';
GraphLayer.defaultProps = defaultProps;
