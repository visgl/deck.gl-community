import {CompositeLayer} from '@deck.gl/core';
import {TextLayer} from '@deck.gl/layers';

export default class ZoomableTextLayer extends CompositeLayer {
  static layerName = 'ZoomableTextLayer';

  initializeState() {
    this.state = {characterSet: []};
  }

  shouldUpdateState({props, changeFlags}) {
    const {scaleWithZoom} = this.props;
    if (!scaleWithZoom) {
      return changeFlags.dataChanged || changeFlags.propsChanged;
    }
    return changeFlags.dataChanged || changeFlags.propsChanged || changeFlags.viewportChanged;
  }

  updateState({props, oldProps, changeFlags}) {
    super.updateState({props, oldProps, changeFlags});
    if (changeFlags.propsOrDataChanged) {
      const {getText} = props;
      let textLabels = [];
      if (typeof getText === 'function') {
        textLabels = props.data.map(getText);
      } else {
        textLabels = [getText];
      }
      const characterSet = new Set(textLabels.join(''));
      const uniqueCharacters = Array.from(characterSet);
      this.setState({characterSet: uniqueCharacters});
    }
  }

  renderLayers() {
    const {
      data,
      getPosition,
      getColor,
      getText,
      getSize,
      getTextAnchor,
      getAlignmentBaseline,
      getAngle,
      scaleWithZoom,
      updateTriggers
    } = this.props;

    const sizeUpdateTrigger = scaleWithZoom ? [getSize, this.context.viewport.zoom] : false;
    // getText only expects function not plain value (string)
    const newGetText = typeof getText === 'function' ? getText : () => getText;

    return [
      new TextLayer(
        this.getSubLayerProps({
          id: '__text-layer',
          data,
          sizeScale: scaleWithZoom ? Math.max(0, this.context.viewport.zoom) : 1,
          characterSet: this.state.characterSet,
          getPosition,
          getColor,
          getSize,
          getTextAnchor,
          getAlignmentBaseline,
          getAngle,
          getText: newGetText,
          updateTriggers: {
            getSize: sizeUpdateTrigger,
            getAngle: [sizeUpdateTrigger, updateTriggers.getPosition],
            ...updateTriggers
          }
        })
      )
    ];
  }
}
