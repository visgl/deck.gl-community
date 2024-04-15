import {CompositeLayer} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';

export class CircleLayer extends CompositeLayer {
  static layerName = 'CircleLayer';

  renderLayers() {
    const {data, getPosition, stylesheet, positionUpdateTrigger = 0} = this.props as any;

    return [
      new ScatterplotLayer(
        this.getSubLayerProps({
          id: '__scatterplot-layer',
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
