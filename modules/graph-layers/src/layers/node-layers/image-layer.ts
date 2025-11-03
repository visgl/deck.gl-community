// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {IconLayer} from '@deck.gl/layers';

export class ImageLayer extends CompositeLayer {
  static layerName = 'ImageLayer';

  renderLayers() {
    const {data, getPosition, stylesheet, positionUpdateTrigger = 0, transitions} =
      this.props as any;

    return [
      new IconLayer(
        this.getSubLayerProps({
          id: '__icon-layer',
          data,
          getPosition,
          ...stylesheet.getDeckGLAccessors(),
          transitions,
          updateTriggers: {
            getPosition: positionUpdateTrigger,
            ...stylesheet.getDeckGLUpdateTriggers()
          }
        })
      )
    ];
  }
}
