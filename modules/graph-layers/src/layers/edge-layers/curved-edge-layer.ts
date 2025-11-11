// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type CompositeLayerProps, type Accessor} from '@deck.gl/core';
import {ScatterplotLayer, LineLayer} from '@deck.gl/layers';
import {SplineLayer} from '../common-layers/spline-layer/spline-layer';

import type {EdgeInterface} from '../../graph/graph';
import type {EdgeLayoutAccessor} from '../edge-layer';

type ColorAccessor = Accessor<EdgeInterface, readonly number[]>;

/** Props for the {@link CurvedEdgeLayer} composite layer. */
export type CurvedEdgeLayerProps = CompositeLayerProps & {
  /** Graph edges to render as spline curves. */
  data: readonly EdgeInterface[];
  /** Accessor returning layout metadata for each edge. */
  getLayoutInfo: EdgeLayoutAccessor;
  /** Accessor resolving stroke color for each edge. */
  getColor: ColorAccessor;
  /** Accessor resolving curve width for each edge. */
  getWidth: Accessor<EdgeInterface, number>;
  /** Value used to invalidate cached positions when edge layout changes. */
  positionUpdateTrigger?: unknown;
  /** Value used to invalidate cached stroke colors. */
  colorUpdateTrigger?: unknown;
  /** Value used to invalidate cached stroke widths. */
  widthUpdateTrigger?: unknown;
};

const DEBUG = false;

export class CurvedEdgeLayer extends CompositeLayer<CurvedEdgeLayerProps> {
  static layerName = 'CurvedEdgeLayer';

  // @ts-expect-error TODO
  renderLayers() {
    const {
      data,
      getLayoutInfo,
      positionUpdateTrigger = 0,
      colorUpdateTrigger = 0,
      widthUpdateTrigger = 0,
      ...otherProps
    } = this.props;
    return [
      DEBUG &&
        new ScatterplotLayer(
          this.getSubLayerProps({
            id: '__control-points',
            data,
            getPosition: (e) => getLayoutInfo(e).controlPoints[0],
            getColor: (d) => [190, 190, 190, 150],
            getRadius: (d) => 5,
            updateTriggers: {
              getPosition: positionUpdateTrigger
            },
            ...otherProps
          })
        ),
      DEBUG &&
        new LineLayer(
          this.getSubLayerProps({
            id: '__first_segment',
            data,
            getSourcePosition: (e) => getLayoutInfo(e).sourcePosition,
            getTargetPosition: (e) => getLayoutInfo(e).controlPoints[0],
            getColor: (e) => [210, 210, 210, 150],
            updateTriggers: {
              getSourcePosition: positionUpdateTrigger,
              getTargetPosition: positionUpdateTrigger
            },
            ...otherProps
          })
        ),
      DEBUG &&
        new LineLayer(
          this.getSubLayerProps({
            id: '__last_segment',
            data,
            getSourcePosition: (e) => getLayoutInfo(e).controlPoints[0],
            getTargetPosition: (e) => getLayoutInfo(e).targetPosition,
            getColor: (e) => [210, 210, 210, 150],
            updateTriggers: {
              getSourcePosition: positionUpdateTrigger,
              getTargetPosition: positionUpdateTrigger
            },
            ...otherProps
          })
        ),
      new SplineLayer(
        this.getSubLayerProps({
          id: '__spline_layer',
          data,
          getSourcePosition: (e) => getLayoutInfo(e).sourcePosition,
          getTargetPosition: (e) => getLayoutInfo(e).targetPosition,
          getControlPoints: (e) => getLayoutInfo(e).controlPoints,
          updateTriggers: {
            getSourcePosition: positionUpdateTrigger,
            getTargetPosition: positionUpdateTrigger,
            getControlPoints: positionUpdateTrigger,
            getColor: colorUpdateTrigger,
            getWidth: widthUpdateTrigger
          },
          ...otherProps
        })
      )
    ];
  }
}
