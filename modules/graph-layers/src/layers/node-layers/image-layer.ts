// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type CompositeLayerProps, type AccessorFunction} from '@deck.gl/core';
import {IconLayer} from '@deck.gl/layers';

import type {NodeInterface} from '../../graph/graph';
import type {GraphStylesheetEngine} from '../../style/graph-style-engine';

/** Props for the {@link ImageLayer} composite layer. */
export type ImageLayerProps = CompositeLayerProps & {
  /** Graph nodes to render as bitmap icons. */
  data: readonly NodeInterface[];
  /** Accessor returning the world position for each node. */
  getPosition: AccessorFunction<NodeInterface, readonly [number, number]>;
  /** Stylesheet engine that exposes Deck.gl accessors for icon rendering. */
  stylesheet: GraphStylesheetEngine;
  /** Value used to invalidate cached positions when node layout changes. */
  positionUpdateTrigger?: unknown;
};

export class ImageLayer extends CompositeLayer<ImageLayerProps> {
  static layerName = 'ImageLayer';

  renderLayers() {
    const {data, getPosition, stylesheet, positionUpdateTrigger = 0} = this.props;

    return [
      new IconLayer(
        this.getSubLayerProps({
          id: '__icon-layer',
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
