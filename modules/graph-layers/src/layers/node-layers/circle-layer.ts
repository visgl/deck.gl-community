// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';

export class CircleLayer extends CompositeLayer {
  static layerName = 'CircleLayer';

  renderLayers() {
    const {data, getPosition, stylesheet, positionUpdateTrigger = 0, transitions} =
      this.props as any;

    return [
      new ScatterplotLayer(
        this.getSubLayerProps({
          id: '__scatterplot-layer',
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
