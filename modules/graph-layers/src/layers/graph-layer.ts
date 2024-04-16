import {COORDINATE_SYSTEM, CompositeLayer} from '@deck.gl/core';

import {Stylesheet} from '../style/style-sheet';
import {NODE_TYPE, EDGE_DECORATOR_TYPE} from '../core/constants';
import {mixedGetPosition} from '../utils/layer-utils';
import {InteractionManager} from '../core/interaction-manager';

import {log} from '../utils/log';

// node layers
import {CircleLayer} from './node-layers/circle-layer';
import {ImageLayer} from './node-layers/image-layer';
import {LabelLayer} from './node-layers/label-layer';
import {RectangleLayer} from './node-layers/rectangle-layer';
import {RoundedRectangleLayer} from './node-layers/rounded-rectangle-layer';
import {PathBasedRoundedRectangleLayer} from './node-layers/path-rounded-rectange-layer';
import {ZoomableMarkerLayer} from './node-layers/zoomable-marker-layer';

// edge layers
import {EdgeLayer} from './edge-layer';
import {EdgeLabelLayer} from './edge-layers/edge-label-layer';
import {FlowLayer} from './edge-layers/flow-layer';

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

export class GraphLayer extends CompositeLayer {
  static defaultProps = {
    pickable: true
  };

  forceUpdate = () => {
    if (this.context && this.context.layerManager) {
      this.setNeedsUpdate();
      this.setChangeFlags({dataChanged: true} as any); // TODO
    }
  };

  constructor(props) {
    super(props);

    // added or removed a node, or in general something layout related changed
    props.engine.addEventListener('onLayoutChange', this.forceUpdate);
  }

  initializeState() {
    const interactionManager = new InteractionManager(this.props as any, () => this.forceUpdate());
    this.state = {interactionManager};
  }

  shouldUpdateState({changeFlags}) {
    return changeFlags.dataChanged || changeFlags.propsChanged;
  }

  updateState({props}) {
    (this.state.interactionManager as any).updateProps(props);
  }

  finalize() {
    (this.props as any).engine.removeEventListener('onLayoutChange', this.forceUpdate);
  }

  createNodeLayers() {
    const {engine, nodeStyle} = this.props as any;
    if (!nodeStyle || !Array.isArray(nodeStyle) || nodeStyle.length === 0) {
      return [];
    }
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
        stylesheet,
        visible
      } as any);
    });
  }

  createEdgeLayers() {
    const {edgeStyle, engine} = this.props as any;

    if (!edgeStyle) {
      return [];
    }

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
    return (this.state.interactionManager as any).onClick(info, event) || false;
  }

  onHover(info, event): boolean {
    return (this.state.interactionManager as any).onHover(info, event) || false;
  }

  onDragStart(info, event) {
    (this.state.interactionManager as any).onDragStart(info, event);
  }

  onDrag(info, event) {
    (this.state.interactionManager as any).onDrag(info, event);
  }

  onDragEnd(info, event) {
    (this.state.interactionManager as any).onDragEnd(info, event);
  }

  renderLayers() {
    return [this.createEdgeLayers(), this.createNodeLayers()];
  }
}

GraphLayer.layerName = 'GraphLayer';
(GraphLayer as any).defaultProps = defaultProps;
