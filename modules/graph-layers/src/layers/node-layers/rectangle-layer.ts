import {CompositeLayer} from '@deck.gl/core';
import {PolygonLayer} from '@deck.gl/layers';

const generateRectangle = (node, {getWidth, getHeight, getPosition}) => {
  const pos = getPosition(node);
  const width = typeof getWidth === 'function' ? getWidth(node._data.label.length * 12) : getWidth;
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

export class RectangleLayer extends CompositeLayer {
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
