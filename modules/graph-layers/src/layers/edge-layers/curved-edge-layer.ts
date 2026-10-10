// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {ScatterplotLayer, LineLayer} from '@deck.gl/layers';
import {SplineLayer} from '../common-layers/spline-layer/spline-layer';

const DEBUG = false;

export class CurvedEdgeLayer extends CompositeLayer {
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
    } = this.props as any;
    return [
      DEBUG &&
        new ScatterplotLayer(
          this.getSubLayerProps({
            transitions: this.props.transitions,
            id: '__control-points',
            data,
            getPosition: e => getLayoutInfo(e).controlPoints[0],
            getColor: _d => [190, 190, 190, 150],
            getRadius: _d => 5,
            updateTriggers: {
              all: this.props.transitions,
              getPosition: positionUpdateTrigger
            },
            ...otherProps
          })
        ),
      DEBUG &&
        new LineLayer(
          this.getSubLayerProps({
            transitions: this.props.transitions,
            id: '__first_segment',
            data,
            getSourcePosition: e => getLayoutInfo(e).sourcePosition,
            getTargetPosition: e => getLayoutInfo(e).controlPoints[0],
            getColor: _e => [210, 210, 210, 150],
            updateTriggers: {
              all: this.props.transitions,
              getSourcePosition: positionUpdateTrigger,
              getTargetPosition: positionUpdateTrigger
            },
            ...otherProps
          })
        ),
      DEBUG &&
        new LineLayer(
          this.getSubLayerProps({
            transitions: this.props.transitions,
            id: '__last_segment',
            data,
            getSourcePosition: e => getLayoutInfo(e).controlPoints[0],
            getTargetPosition: e => getLayoutInfo(e).targetPosition,
            getColor: _e => [210, 210, 210, 150],
            updateTriggers: {
              all: this.props.transitions,
              getSourcePosition: positionUpdateTrigger,
              getTargetPosition: positionUpdateTrigger
            },
            ...otherProps
          })
        ),
      new SplineLayer(
        this.getSubLayerProps({
          transitions: this.props.transitions,
          id: '__spline_layer',
          data,
          getSourcePosition: e => getLayoutInfo(e).sourcePosition,
          getTargetPosition: e => getLayoutInfo(e).targetPosition,
          getControlPoints: e => getLayoutInfo(e).controlPoints,
          updateTriggers: {
            all: this.props.transitions,
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
