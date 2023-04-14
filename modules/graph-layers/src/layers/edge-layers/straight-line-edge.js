import {CompositeLayer} from '@deck.gl/core';
import {LineLayer} from '@deck.gl/layers';

export default class StraightLineEdge extends CompositeLayer {
  static layerName = 'StraightLineEdge';

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
