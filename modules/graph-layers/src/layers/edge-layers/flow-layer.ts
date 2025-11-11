// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type CompositeLayerProps} from '@deck.gl/core';

import type {EdgeInterface} from '../../graph/graph';
import type {GraphStylesheetEngine} from '../../style/graph-style-engine';
import type {EdgeLayoutAccessor} from '../edge-layer';
import {FlowPathLayer} from '../common-layers/flow-path-layer/flow-path-layer';

/** Props for the {@link FlowLayer} composite layer. */
export type FlowLayerProps = CompositeLayerProps & {
  /** Graph edges to render with animated flow markers. */
  data: readonly EdgeInterface[];
  /** Accessor returning layout metadata for each edge. */
  getLayoutInfo: EdgeLayoutAccessor;
  /** Stylesheet engine that exposes Deck.gl accessors for flow rendering. */
  stylesheet: GraphStylesheetEngine;
  /** Value used to invalidate cached positions when edge layout changes. */
  positionUpdateTrigger?: unknown;
};

export class FlowLayer extends CompositeLayer<FlowLayerProps> {
  static layerName = 'FlowLayer';

  renderLayers() {
    const {data, getLayoutInfo, positionUpdateTrigger = 0, stylesheet} = this.props;
    return [
      new FlowPathLayer(
        this.getSubLayerProps({
          id: '__flow-layer',
          data,
          ...stylesheet.getDeckGLAccessors(),
          getSourcePosition: (e) => getLayoutInfo(e).sourcePosition,
          getTargetPosition: (e) => getLayoutInfo(e).targetPosition,
          parameters: {
            depthTest: false
          },
          updateTriggers: {
            ...stylesheet.getDeckGLUpdateTriggers(),
            getSourcePosition: positionUpdateTrigger,
            getTargetPosition: positionUpdateTrigger
          }
        })
      )
    ];
  }
}
