// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type CompositeLayerProps, type Accessor} from '@deck.gl/core';
import {LineLayer} from '@deck.gl/layers';

import type {EdgeInterface} from '../../graph/graph';
import type {EdgeLayoutAccessor} from '../edge-layer';

type ColorAccessor = Accessor<EdgeInterface, readonly number[]>;

/** Props for the {@link StraightLineEdgeLayer} composite layer. */
export type StraightLineEdgeLayerProps = CompositeLayerProps & {
  /** Graph edges to render as straight line segments. */
  data: readonly EdgeInterface[];
  /** Accessor returning layout metadata for each edge. */
  getLayoutInfo: EdgeLayoutAccessor;
  /** Accessor resolving stroke color for each edge. */
  getColor: ColorAccessor;
  /** Accessor resolving line width for each edge. */
  getWidth: Accessor<EdgeInterface, number>;
  /** Value used to invalidate cached positions when edge layout changes. */
  positionUpdateTrigger?: unknown;
  /** Value used to invalidate cached stroke colors. */
  colorUpdateTrigger?: unknown;
  /** Value used to invalidate cached stroke widths. */
  widthUpdateTrigger?: unknown;
};

export class StraightLineEdgeLayer extends CompositeLayer<StraightLineEdgeLayerProps> {
  static layerName = 'StraightLineEdgeLayer';

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
      new LineLayer(
        this.getSubLayerProps({
          id: '__line-layer',
          data,
          getSourcePosition: (e) => getLayoutInfo(e).sourcePosition,
          getTargetPosition: (e) => getLayoutInfo(e).targetPosition,
          updateTriggers: {
            getColor: colorUpdateTrigger,
            getSourcePosition: positionUpdateTrigger,
            getTargetPosition: positionUpdateTrigger,
            getWidth: widthUpdateTrigger
          },
          ...otherProps
        })
      )
    ];
  }
}
