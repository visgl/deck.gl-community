import {CompositeLayer} from '@deck.gl/core';
import {MarkerLayer} from '../common-layers/marker-layer/marker-layer';

export class ZoomableMarkerLayer extends CompositeLayer {
  static layerName = 'ZoomableMarkerLayer';

  shouldUpdateState({props, changeFlags}) {
    const {stylesheet} = this.props as any;
    const scaleWithZoom = stylesheet.getDeckGLAccessor('scaleWithZoom');
    if (!scaleWithZoom) {
      return changeFlags.somethingChanged;
    }
    return changeFlags.somethingChanged || changeFlags.viewportChanged;
  }

  renderLayers() {
    const {data, getPosition, stylesheet, positionUpdateTrigger = 0} = this.props as any;

    const getSize = stylesheet.getDeckGLAccessor('getSize');
    const scaleWithZoom = stylesheet.getDeckGLAccessor('scaleWithZoom');
    const sizeUpdateTrigger = scaleWithZoom ? [getSize, this.context.viewport.zoom] : false;
    const oiginalGetMarker = stylesheet.getDeckGLAccessor('getMarker');
    // getMarker only expects function not plain value (string)
    const getMarker =
      typeof oiginalGetMarker === 'function' ? oiginalGetMarker : () => oiginalGetMarker;

    return [
      new MarkerLayer(
        this.getSubLayerProps({
          id: 'zoomable-marker-layer',
          data,
          getPosition,
          sizeScale: scaleWithZoom ? Math.max(0, this.context.viewport.zoom) : 1,
          ...stylesheet.getDeckGLAccessors(),
          getMarker,
          updateTriggers: {
            ...stylesheet.getDeckGLUpdateTriggers(),
            getPosition: positionUpdateTrigger,
            getSize: sizeUpdateTrigger
          }
        })
      )
    ];
  }
}
