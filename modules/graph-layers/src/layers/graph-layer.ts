// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {CompositeLayerProps} from '@deck.gl/core';
import {COORDINATE_SYSTEM, CompositeLayer} from '@deck.gl/core';

import type {ValueOf} from '../core/constants';
import {NODE_TYPE, EDGE_DECORATOR_TYPE} from '../core/constants';
import {Graph} from '../graph/graph';
import {GraphLayout} from '../core/graph-layout';
import {GraphEngine} from '../core/graph-engine';
import type {Node} from '../graph/node';

import {Stylesheet} from '../style/style-sheet';
import {mixedGetPosition} from '../utils/layer-utils';
import {InteractionManager} from '../core/interaction-manager';

import {log} from '../utils/log';
import {getNodeBoundaryIntersection, type NodeGeometry} from '../utils/node-boundary';

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

type NumericAccessor = ((node: Node) => number) | number | null | undefined;
type OffsetAccessor =
  | ((node: Node) => [number, number])
  | [number, number]
  | null
  | undefined;

type NodeStyleAccessors = {
  type: ValueOf<typeof NODE_TYPE>;
  getOffset?: OffsetAccessor;
  getRadius?: NumericAccessor;
  getWidth?: NumericAccessor;
  getHeight?: NumericAccessor;
  getCornerRadius?: NumericAccessor;
  getSize?: NumericAccessor;
};

const GEOMETRY_NODE_TYPES = new Set<ValueOf<typeof NODE_TYPE>>([
  NODE_TYPE.CIRCLE,
  NODE_TYPE.RECTANGLE,
  NODE_TYPE.ROUNDED_RECTANGLE,
  NODE_TYPE.PATH_ROUNDED_RECTANGLE,
  NODE_TYPE.MARKER
]);

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
  [EDGE_DECORATOR_TYPE.FLOW]: FlowLayer,
  [EDGE_DECORATOR_TYPE.ARROW]: EdgeArrowLayer
};

function evaluateNumericAccessor(accessor: NumericAccessor, node: Node): number | undefined {
  if (typeof accessor === 'function') {
    const value = accessor(node);
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }
  if (typeof accessor === 'number' && Number.isFinite(accessor)) {
    return accessor;
  }
  return undefined;
}

function evaluateOffsetAccessor(accessor: OffsetAccessor, node: Node): [number, number] {
  if (!accessor) {
    return [0, 0];
  }

  let value = accessor as [number, number];
  if (typeof accessor === 'function') {
    value = accessor(node);
  }

  if (Array.isArray(value) && value.length >= 2) {
    const offsetX = Number(value[0]);
    const offsetY = Number(value[1]);
    if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
      return [offsetX, offsetY];
    }
  }

  return [0, 0];
}

function normalizePosition(value: any): [number, number] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {length?: number; [index: number]: number};
  if (typeof candidate.length === 'number' && candidate.length >= 2) {
    const x = Number(candidate[0]);
    const y = Number(candidate[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  }

  return null;
}

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

  private _buildNodeStyleAccessorMap(engine: GraphEngine) {
    const nodeAccessorMap = new Map<string | number, NodeStyleAccessors>();
    const {nodeStyle} = this.props;

    if (!nodeStyle) {
      return nodeAccessorMap;
    }

    const styles = Array.isArray(nodeStyle) ? nodeStyle : [nodeStyle];

    styles
      .filter(Boolean)
      .forEach((style) => {
        const {data = (nodes) => nodes, ...restStyle} = style as any;
        const type = restStyle.type as ValueOf<typeof NODE_TYPE> | undefined;

        if (!type || !GEOMETRY_NODE_TYPES.has(type)) {
          return;
        }

        const stylesheet = new Stylesheet(restStyle, {
          stateUpdateTrigger: (this.state.interactionManager as any).getLastInteraction()
        });

        const nodes = data(engine.getNodes());
        if (!Array.isArray(nodes)) {
          return;
        }

        const accessors: NodeStyleAccessors = {
          type,
          getOffset: stylesheet.getDeckGLAccessor('getOffset')
        };

        switch (type) {
          case NODE_TYPE.CIRCLE:
            accessors.getRadius = stylesheet.getDeckGLAccessor('getRadius');
            break;
          case NODE_TYPE.MARKER:
            accessors.getSize = stylesheet.getDeckGLAccessor('getSize');
            break;
          case NODE_TYPE.RECTANGLE:
            accessors.getWidth = stylesheet.getDeckGLAccessor('getWidth');
            accessors.getHeight = stylesheet.getDeckGLAccessor('getHeight');
            break;
          case NODE_TYPE.ROUNDED_RECTANGLE:
            accessors.getWidth = stylesheet.getDeckGLAccessor('getWidth');
            accessors.getHeight = stylesheet.getDeckGLAccessor('getHeight');
            accessors.getCornerRadius = stylesheet.getDeckGLAccessor('getCornerRadius');
            accessors.getRadius = stylesheet.getDeckGLAccessor('getRadius');
            break;
          case NODE_TYPE.PATH_ROUNDED_RECTANGLE:
            accessors.getWidth = stylesheet.getDeckGLAccessor('getWidth');
            accessors.getHeight = stylesheet.getDeckGLAccessor('getHeight');
            accessors.getCornerRadius = stylesheet.getDeckGLAccessor('getCornerRadius');
            break;
          default:
            break;
        }

        nodes.forEach((node: Node) => {
          const id = node.getId();
          if (!nodeAccessorMap.has(id)) {
            nodeAccessorMap.set(id, accessors);
          }
        });
      });

    return nodeAccessorMap;
  }

  private _computeNodeGeometry(
    engine: GraphEngine,
    node: Node,
    accessors?: NodeStyleAccessors
  ): NodeGeometry | null {
    const basePosition = engine.getNodePosition(node);
    if (!basePosition) {
      return null;
    }

    const offset = evaluateOffsetAccessor(accessors?.getOffset, node);
    const center: [number, number] = [basePosition[0] + offset[0], basePosition[1] + offset[1]];

    const geometry: NodeGeometry = {
      type: accessors?.type,
      center
    };

    if (!accessors) {
      return geometry;
    }

    switch (accessors.type) {
      case NODE_TYPE.CIRCLE: {
        const radius = evaluateNumericAccessor(accessors.getRadius, node);
        if (typeof radius === 'number') {
          geometry.radius = Math.max(radius, 0);
        }
        break;
      }
      case NODE_TYPE.MARKER: {
        const size = evaluateNumericAccessor(accessors.getSize, node);
        if (typeof size === 'number') {
          geometry.radius = Math.max(size / 2, 0);
        }
        break;
      }
      case NODE_TYPE.RECTANGLE: {
        const width = evaluateNumericAccessor(accessors.getWidth, node);
        const height = evaluateNumericAccessor(accessors.getHeight, node);
        if (typeof width === 'number') {
          geometry.width = Math.max(width, 0);
        }
        if (typeof height === 'number') {
          geometry.height = Math.max(height, 0);
        }
        break;
      }
      case NODE_TYPE.ROUNDED_RECTANGLE: {
        const width = evaluateNumericAccessor(accessors.getWidth, node);
        const height = evaluateNumericAccessor(accessors.getHeight, node);
        if (typeof width === 'number') {
          geometry.width = Math.max(width, 0);
        }
        if (typeof height === 'number') {
          geometry.height = Math.max(height, 0);
        }
        const cornerRadius = evaluateNumericAccessor(accessors.getCornerRadius, node);
        if (typeof cornerRadius === 'number') {
          geometry.cornerRadius = Math.max(cornerRadius, 0);
        }
        const radius = evaluateNumericAccessor(accessors.getRadius, node);
        if (typeof radius === 'number') {
          geometry.radius = Math.max(radius, 0);
        }
        break;
      }
      case NODE_TYPE.PATH_ROUNDED_RECTANGLE: {
        const width = evaluateNumericAccessor(accessors.getWidth, node);
        const height = evaluateNumericAccessor(accessors.getHeight, node);
        if (typeof width === 'number') {
          geometry.width = Math.max(width, 0);
        }
        if (typeof height === 'number') {
          geometry.height = Math.max(height, 0);
        }
        const cornerRadius = evaluateNumericAccessor(accessors.getCornerRadius, node);
        if (typeof cornerRadius === 'number') {
          geometry.cornerRadius = Math.max(cornerRadius, 0);
        }
        break;
      }
      default: {
        const radius = evaluateNumericAccessor(accessors.getRadius, node);
        if (typeof radius === 'number') {
          geometry.radius = Math.max(radius, 0);
        }
        const width = evaluateNumericAccessor(accessors.getWidth, node);
        const height = evaluateNumericAccessor(accessors.getHeight, node);
        if (typeof width === 'number') {
          geometry.width = Math.max(width, 0);
        }
        if (typeof height === 'number') {
          geometry.height = Math.max(height, 0);
        }
        break;
      }
    }

    return geometry;
  }

  createNodeLayers() {
    const engine = this.state.graphEngine;
    const {nodeStyle} = this.props;
    if (!engine || !nodeStyle || !Array.isArray(nodeStyle) || nodeStyle.length === 0) {
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
    const engine = this.state.graphEngine;
    const {edgeStyle} = this.props;

    if (!engine || !edgeStyle) {
      return [];
    }

    const nodeAccessorMap = this._buildNodeStyleAccessorMap(engine);
    const nodeMap = engine
      .getNodes()
      .reduce(
        (acc, node) => acc.set(node.getId(), node),
        new Map<string | number, Node>()
      );

    const getLayoutInfo = (edge) => {
      const layoutInfo = engine.getEdgePosition(edge);
      if (!layoutInfo) {
        return layoutInfo;
      }

      const sourceNode = nodeMap.get(edge.getSourceNodeId());
      const targetNode = nodeMap.get(edge.getTargetNodeId());

      if (!sourceNode || !targetNode) {
        return layoutInfo;
      }

      const sourceGeometry = this._computeNodeGeometry(
        engine,
        sourceNode,
        nodeAccessorMap.get(sourceNode.getId())
      );
      const targetGeometry = this._computeNodeGeometry(
        engine,
        targetNode,
        nodeAccessorMap.get(targetNode.getId())
      );

      if (!sourceGeometry && !targetGeometry) {
        return layoutInfo;
      }

      const adjustedLayout = {...layoutInfo};

      const targetReference = targetGeometry?.center ?? normalizePosition(layoutInfo.targetPosition);
      const sourceReference = sourceGeometry?.center ?? normalizePosition(layoutInfo.sourcePosition);

      if (sourceGeometry) {
        adjustedLayout.sourcePosition = targetReference
          ? getNodeBoundaryIntersection(sourceGeometry, targetReference)
          : [...sourceGeometry.center];
      }

      if (targetGeometry) {
        adjustedLayout.targetPosition = sourceReference
          ? getNodeBoundaryIntersection(targetGeometry, sourceReference)
          : [...targetGeometry.center];
      }

      return adjustedLayout;
    };

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
}
