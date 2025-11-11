// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  CompositeLayer,
  type CompositeLayerProps,
  type Accessor,
  type AccessorFunction
} from '@deck.gl/core';
import {PolygonLayer} from '@deck.gl/layers';
import {generateRoundedCorners} from '../../utils/polygon-calculations';

import type {NodeInterface} from '../../graph/graph';
import type {GraphStylesheetEngine} from '../../style/graph-style-engine';

type RoundedRectangleDimensions = {
  getWidth: Accessor<NodeInterface, number>;
  getHeight: Accessor<NodeInterface, number>;
  getCornerRadius: Accessor<NodeInterface, number>;
  getPosition: AccessorFunction<NodeInterface, readonly [number, number]>;
};

const generateRoundedRectangle = (
  node: NodeInterface,
  {getWidth, getHeight, getPosition, getCornerRadius}: RoundedRectangleDimensions
) => {
  const pos = getPosition(node);
  const width = typeof getWidth === 'function' ? getWidth(node) : getWidth;
  const height = typeof getHeight === 'function' ? getHeight(node) : getHeight;
  const cornerRadius =
    typeof getCornerRadius === 'function' ? getCornerRadius(node) : getCornerRadius;
  const factor = 20;
  return generateRoundedCorners(pos, width, height, cornerRadius, factor);
};

/** Props for the {@link PathBasedRoundedRectangleLayer} composite layer. */
export type PathBasedRoundedRectangleLayerProps = CompositeLayerProps & {
  /** Graph nodes to render as rounded rectangles via polygon paths. */
  data: readonly NodeInterface[];
  /** Accessor returning the world position for each node. */
  getPosition: AccessorFunction<NodeInterface, readonly [number, number]>;
  /** Stylesheet engine that exposes Deck.gl accessors for rounded rectangle rendering. */
  stylesheet: GraphStylesheetEngine;
  /** Value used to invalidate cached positions when node layout changes. */
  positionUpdateTrigger?: unknown;
};

export class PathBasedRoundedRectangleLayer extends CompositeLayer<PathBasedRoundedRectangleLayerProps> {
  static layerName = 'PathBasedRoundedRectangleLayer';

  renderLayers() {
    const {data, getPosition, stylesheet, positionUpdateTrigger = 0} = this.props;

    const getFillColor = stylesheet.getDeckGLAccessor('getFillColor');
    const getLineWidth = stylesheet.getDeckGLAccessor('getLineWidth');

    return [
      new PolygonLayer(
        this.getSubLayerProps({
          id: '__polygon-layer',
          data,
          getPolygon: (node) =>
            generateRoundedRectangle(node, {
              getPosition,
              getWidth: stylesheet.getDeckGLAccessor('getWidth'),
              getHeight: stylesheet.getDeckGLAccessor('getHeight'),
              getCornerRadius: stylesheet.getDeckGLAccessor('getCornerRadius')
            }),
          filled: Boolean(getFillColor),
          stroked: Boolean(getLineWidth),
          ...stylesheet.getDeckGLAccessors(),
          updateTriggers: {
            getPolygon: [
              positionUpdateTrigger,
              stylesheet.getDeckGLAccessorUpdateTrigger('getWidth'),
              stylesheet.getDeckGLAccessorUpdateTrigger('getHeight'),
              stylesheet.getDeckGLAccessorUpdateTrigger('getCornerRadius')
            ],
            ...stylesheet.getDeckGLUpdateTriggers()
          }
        })
      )
    ];
  }
}
