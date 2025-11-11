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

import type {NodeInterface} from '../../graph/graph';
import type {GraphStylesheetEngine} from '../../style/graph-style-engine';

type RectangleDimensions = {
  getWidth: Accessor<NodeInterface, number>;
  getHeight: Accessor<NodeInterface, number>;
  getPosition: AccessorFunction<NodeInterface, readonly [number, number]>;
};

const generateRectangle = (
  node: NodeInterface,
  {getWidth, getHeight, getPosition}: RectangleDimensions
) => {
  const pos = getPosition(node);
  const width =
    typeof getWidth === 'function'
      ? (getWidth as (value: unknown) => number)(
          ((node as unknown as { _data?: { label?: { length: number } } })._data?.label?.length ??
            0) * 12
        )
      : getWidth;
  const height = typeof getWidth === 'function' ? getHeight(node) : getHeight;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return [
    [pos[0] - halfWidth, pos[1] - halfHeight],
    [pos[0] - halfWidth, pos[1] + halfHeight],
    [pos[0] + halfWidth, pos[1] + halfHeight],
    [pos[0] + halfWidth, pos[1] - halfHeight]
  ];
};

/** Props for the {@link RectangleLayer} composite layer. */
export type RectangleLayerProps = CompositeLayerProps & {
  /** Graph nodes to render as axis-aligned rectangles. */
  data: readonly NodeInterface[];
  /** Accessor returning the world position for each node. */
  getPosition: AccessorFunction<NodeInterface, readonly [number, number]>;
  /** Stylesheet engine that exposes Deck.gl accessors for rectangle rendering. */
  stylesheet: GraphStylesheetEngine;
  /** Value used to invalidate cached positions when node layout changes. */
  positionUpdateTrigger?: unknown;
};

export class RectangleLayer extends CompositeLayer<RectangleLayerProps> {
  static layerName = 'RectangleLayer';

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
            generateRectangle(node, {
              getPosition,
              getWidth: stylesheet.getDeckGLAccessor('getWidth'),
              getHeight: stylesheet.getDeckGLAccessor('getHeight')
            }),
          filled: Boolean(getFillColor),
          jointRounded: true,
          stroked: Boolean(getLineWidth),
          ...stylesheet.getDeckGLAccessors(),
          updateTriggers: {
            getPolygon: [
              positionUpdateTrigger,
              stylesheet.getDeckGLAccessorUpdateTrigger('getWidth'),
              stylesheet.getDeckGLAccessorUpdateTrigger('getHeight')
            ],
            ...stylesheet.getDeckGLUpdateTriggers()
          }
        })
      )
    ];
  }
}
