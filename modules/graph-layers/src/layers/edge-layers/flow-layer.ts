// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';

import {FlowPathLayer} from '../common-layers/flow-path-layer/flow-path-layer';

export class FlowLayer extends CompositeLayer {
  static layerName = 'FlowLayer';

  renderLayers() {
    const {data, getLayoutInfo, positionUpdateTrigger = 0, stylesheet} = this.props as any;
    return [
      new FlowPathLayer(
        this.getSubLayerProps({
          transitions: this.props.transitions,
          id: '__flow-layer',
          data,
          ...stylesheet.getDeckGLAccessors(),
          getSourcePosition: e => getLayoutInfo(e).sourcePosition,
          getTargetPosition: e => getLayoutInfo(e).targetPosition,
          parameters: {
            depthTest: false
          },
          updateTriggers: {
            all: this.props.transitions,
            ...stylesheet.getDeckGLUpdateTriggers(),
            getSourcePosition: positionUpdateTrigger,
            getTargetPosition: positionUpdateTrigger
          }
        })
      )
    ];
  }
}
