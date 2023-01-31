import {CompositeLayer} from '@deck.gl/core';
import ZoomableTextLayer from '../../deckgl-layers/zoomable-text-layer';

export default class LabelLayer extends CompositeLayer {
  static layerName = 'LabelLayer';

  renderLayers() {
    const {
      data,
      getPosition,
      stylesheet,
      positionUpdateTrigger = 0,
    } = this.props;

    return [
      new ZoomableTextLayer(
        this.getSubLayerProps({
          id: '__text-layer',
          data,
          getPosition,
          ...stylesheet.getDeckGLAccessors(),
          updateTriggers: {
            ...stylesheet.getDeckGLUpdateTriggers(),
            getPosition: positionUpdateTrigger,
          },
        })
      ),
    ];
  }
}
