// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type CompositeLayerProps, type AccessorFunction} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';

import type {NodeInterface} from '../../graph/graph';
import type {GraphStylesheetEngine} from '../../style/graph-style-engine';

/** Props for the {@link CircleLayer} composite layer. */
export type CircleLayerProps = CompositeLayerProps & {
  /** Graph nodes to render as circles. */
  data: readonly NodeInterface[];
  /** Accessor returning the world position for each node. */
  getPosition: AccessorFunction<NodeInterface, readonly [number, number]>;
  /** Stylesheet engine that exposes Deck.gl accessors for circle rendering. */
  stylesheet: GraphStylesheetEngine;
  /** Value used to invalidate cached positions when node layout changes. */
  positionUpdateTrigger?: unknown;
};

export class CircleLayer extends CompositeLayer<CircleLayerProps> {
  static layerName = 'CircleLayer';

  renderLayers() {
    const {data, getPosition, stylesheet, positionUpdateTrigger = 0} = this.props;

    return [
      new ScatterplotLayer(
        this.getSubLayerProps({
          id: '__scatterplot-layer',
          data,
          getPosition,
          ...stylesheet.getDeckGLAccessors(),
          updateTriggers: {
            getPosition: positionUpdateTrigger,
            ...stylesheet.getDeckGLUpdateTriggers()
          }
        })
      )
    ];
  }
}
