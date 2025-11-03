// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {PolygonLayer} from '@deck.gl/layers';
import {generateRoundedCorners} from '../../utils/polygon-calculations';

const generateRoundedRectangle = (node, {getWidth, getHeight, getPosition, getCornerRadius}) => {
  const pos = getPosition(node);
  const width = typeof getWidth === 'function' ? getWidth(node) : getWidth;
  const height = typeof getWidth === 'function' ? getHeight(node) : getHeight;
  const cornerRadius =
    typeof getCornerRadius === 'function' ? getCornerRadius(node) : getCornerRadius;
  const factor = 20;
  return generateRoundedCorners(pos, width, height, cornerRadius, factor);
};

export class PathBasedRoundedRectangleLayer extends CompositeLayer {
  static layerName = 'PathBasedRoundedRectangleLayer';

  renderLayers() {
    const {data, getPosition, stylesheet, positionUpdateTrigger = 0, transitions} =
      this.props as any;

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
          transitions,
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
