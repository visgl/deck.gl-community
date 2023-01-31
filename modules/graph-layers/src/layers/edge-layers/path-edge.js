import {CompositeLayer} from '@deck.gl/core';
import {PathLayer} from '@deck.gl/layers';

export default class PathEdge extends CompositeLayer {
  static layerName = 'PathEdge';

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
          getPath: e => {
            const {
              sourcePosition,
              targetPosition,
              controlPoints,
            } = getLayoutInfo(e);
            return [sourcePosition, ...controlPoints, targetPosition];
          },
          updateTriggers: {
            getColor: colorUpdateTrigger,
            getPath: positionUpdateTrigger,
            getWidth: widthUpdateTrigger,
          },
          ...otherProps,
        })
      ),
    ];
  }
}
