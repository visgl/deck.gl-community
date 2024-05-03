// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {ZoomableTextLayer} from '../common-layers/zoomable-text-layer/zoomable-text-layer';

export class LabelLayer extends CompositeLayer {
  static layerName = 'LabelLayer';

  renderLayers() {
    const {data, getPosition, stylesheet, positionUpdateTrigger = 0} = this.props as any;

    return [
      new ZoomableTextLayer(
        this.getSubLayerProps({
          id: '__text-layer',
          data,
          getPosition,
          ...stylesheet.getDeckGLAccessors(),
          updateTriggers: {
            ...stylesheet.getDeckGLUpdateTriggers(),
            getPosition: positionUpdateTrigger
          }
        })
      )
    ];
  }
}
