// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {LineLayer} from '@deck.gl/layers';

export class StraightLineEdgeLayer extends CompositeLayer {
  static layerName = 'StraightLineEdgeLayer';

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
      new LineLayer(
        this.getSubLayerProps({
          id: '__line-layer',
          data,
          getSourcePosition: (e) => getLayoutInfo(e).sourcePosition,
          getTargetPosition: (e) => getLayoutInfo(e).targetPosition,
          updateTriggers: {
            getColor: colorUpdateTrigger,
            getSourcePosition: positionUpdateTrigger,
            getTargetPosition: positionUpdateTrigger,
            getWidth: widthUpdateTrigger
          },
          ...otherProps
        })
      )
    ];
  }
}
