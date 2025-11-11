// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  COORDINATE_SYSTEM,
  CompositeLayer,
  type CompositeLayerProps,
  type UpdateParameters
} from '@deck.gl/core';

import type {EdgeInterface} from '../graph/graph';
import type {GraphStylesheetEngine} from '../style/graph-style-engine';
import {StraightLineEdgeLayer, type StraightLineEdgeLayerProps} from '../layers/edge-layers/straight-line-edge-layer';
import {PathEdgeLayer, type PathEdgeLayerProps} from './edge-layers/path-edge-layer';
import {CurvedEdgeLayer, type CurvedEdgeLayerProps} from './edge-layers/curved-edge-layer';

const EDGE_LAYER_MAP = {
  'line': StraightLineEdgeLayer,
  'path': PathEdgeLayer,
  'spline-curve': CurvedEdgeLayer
};

type EdgeLayerType = keyof typeof EDGE_LAYER_MAP;

/** Layout information returned by {@link EdgeLayerProps.getLayoutInfo}. */
export type EdgeLayoutInfo = {
  /** Edge geometry variant to render. */
  type: EdgeLayerType;
  /** Source node position in world coordinates. */
  sourcePosition: readonly number[];
  /** Target node position in world coordinates. */
  targetPosition: readonly number[];
  /** Optional spline control points for curved edges. */
  controlPoints?: readonly number[][];
};

/** Accessor that resolves layout metadata for a graph edge. */
export type EdgeLayoutAccessor = (edge: EdgeInterface) => EdgeLayoutInfo;

/** Props for the {@link EdgeLayer} composite layer. */
export type EdgeLayerProps = CompositeLayerProps & {
  /** Graph edges to render. */
  data: readonly EdgeInterface[];
  /** Accessor returning layout metadata for each edge. */
  getLayoutInfo: EdgeLayoutAccessor;
  /** Stylesheet engine that exposes Deck.gl accessors for edge rendering. */
  stylesheet: GraphStylesheetEngine;
  /** Value used to invalidate cached positions when edge layout changes. */
  positionUpdateTrigger?: unknown;
};

type EdgeLayerState = {
  typedEdgeData: Record<EdgeLayerType, EdgeInterface[]>;
};

export class EdgeLayer extends CompositeLayer<EdgeLayerProps> {
  static layerName = 'EdgeLayer';

  static defaultProps = {
    data: [],
    pickable: true,
    getLayoutInfo: (d) => ({
      type: d.type,
      sourcePosition: d.sourcePosition,
      targetPosition: d.targetPosition,
      controlPoints: []
    }),
    positionUpdateTrigger: 0
  };

  initializeState(context: unknown) {
    super.initializeState(context as any);
    this.state = {
      typedEdgeData: {
        'line': [],
        'path': [],
        'spline-curve': []
      }
    };
  }

  declare state: EdgeLayerState;

  updateState({props, oldProps, changeFlags}: UpdateParameters<EdgeLayerProps>) {
    super.updateState({props, oldProps, changeFlags});
    if (changeFlags.dataChanged) {
      this.updateStateData();
    }
  }

  updateStateData() {
    const {data, getLayoutInfo} = this.props;
    // bucket edges by types
    const typedEdgeData = data.reduce(
      (res, d) => {
        const {type} = getLayoutInfo(d);
        res[type].push(d);
        return res;
      },
      {
        'line': [],
        'path': [],
        'spline-curve': []
      }
    );
    this.setState({typedEdgeData});
  }

  renderLayers() {
    const {getLayoutInfo, pickable, positionUpdateTrigger, stylesheet, id} = this.props;

    const {typedEdgeData} = this.state;

    // render lines by types (straight line, path, curves)
    return (Object.entries(typedEdgeData) as Array<[EdgeLayerType, EdgeInterface[]]>).map((entry, idx) => {
      const [type, edgeData] = entry;
      const Layer = EDGE_LAYER_MAP[type];
      // invalid edge layer type
      if (!Layer) {
        return null;
      }
      const layerProps = {
        id: `${id}-${idx}`,
        data: edgeData,
        getLayoutInfo,
        getColor: stylesheet.getDeckGLAccessor('getColor'),
        getWidth: stylesheet.getDeckGLAccessor('getWidth'),
        colorUpdateTrigger: stylesheet.getDeckGLAccessorUpdateTrigger('getColor'),
        widthUpdateTrigger: stylesheet.getDeckGLAccessorUpdateTrigger('getWidth'),
        positionUpdateTrigger,
        pickable,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        parameters: {
          depthCompare: 'always'
        }
      };
      if (Layer === StraightLineEdgeLayer) {
        return new Layer(layerProps as StraightLineEdgeLayerProps);
      }
      if (Layer === PathEdgeLayer) {
        return new Layer(layerProps as PathEdgeLayerProps);
      }
      return new Layer(layerProps as CurvedEdgeLayerProps);
    });
  }
}
