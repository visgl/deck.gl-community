// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type CompositeLayerProps, type AccessorFunction} from '@deck.gl/core';
import {ZoomableTextLayer} from '../common-layers/zoomable-text-layer/zoomable-text-layer';

import type {NodeInterface} from '../../graph/graph';
import type {GraphStylesheetEngine} from '../../style/graph-style-engine';

/** Props for the {@link LabelLayer} composite layer. */
export type LabelLayerProps = CompositeLayerProps & {
  /** Graph nodes to render as zoom-aware text labels. */
  data: readonly NodeInterface[];
  /** Accessor returning the world position for each node. */
  getPosition: AccessorFunction<NodeInterface, readonly [number, number]>;
  /** Stylesheet engine that exposes Deck.gl accessors for label rendering. */
  stylesheet: GraphStylesheetEngine;
  /** Value used to invalidate cached positions when node layout changes. */
  positionUpdateTrigger?: unknown;
};

export class LabelLayer extends CompositeLayer<LabelLayerProps> {
  static layerName = 'LabelLayer';

  renderLayers() {
    const {data, getPosition, stylesheet, positionUpdateTrigger = 0} = this.props;

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
