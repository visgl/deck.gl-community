// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type CompositeLayerProps, type Accessor} from '@deck.gl/core';
import {PathLayer} from '@deck.gl/layers';

import type {EdgeInterface} from '../../graph/graph';
import type {EdgeLayoutAccessor} from '../edge-layer';

type ColorAccessor = Accessor<EdgeInterface, readonly number[]>;

/** Props for the {@link PathEdgeLayer} composite layer. */
export type PathEdgeLayerProps = CompositeLayerProps & {
  /** Graph edges to render as multi-segment paths. */
  data: readonly EdgeInterface[];
  /** Accessor returning layout metadata for each edge. */
  getLayoutInfo: EdgeLayoutAccessor;
  /** Accessor resolving stroke color for each edge. */
  getColor: ColorAccessor;
  /** Accessor resolving path width for each edge. */
  getWidth: Accessor<EdgeInterface, number>;
  /** Value used to invalidate cached positions when edge layout changes. */
  positionUpdateTrigger?: unknown;
  /** Value used to invalidate cached stroke colors. */
  colorUpdateTrigger?: unknown;
  /** Value used to invalidate cached stroke widths. */
  widthUpdateTrigger?: unknown;
};

export class PathEdgeLayer extends CompositeLayer<PathEdgeLayerProps> {
  static layerName = 'PathEdgeLayer';

  renderLayers() {
    const {
      data,
      getLayoutInfo,
      positionUpdateTrigger = 0,
      colorUpdateTrigger = 0,
      widthUpdateTrigger = 0,
      ...otherProps
    } = this.props;
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
