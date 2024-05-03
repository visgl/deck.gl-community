// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {PathLayer} from '@deck.gl/layers';

export class PathEdgeLayer extends CompositeLayer {
  static layerName = 'PathEdgeLayer';

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
      new PathLayer(
        this.getSubLayerProps({
          id: '__line-layer',
          data,
          getPath: (e) => {
            const {sourcePosition, targetPosition, controlPoints} = getLayoutInfo(e);
            return [sourcePosition, ...controlPoints, targetPosition];
          },
          updateTriggers: {
            getColor: colorUpdateTrigger,
            getPath: positionUpdateTrigger,
            getWidth: widthUpdateTrigger
          },
          ...otherProps
        })
      )
    ];
  }
}
