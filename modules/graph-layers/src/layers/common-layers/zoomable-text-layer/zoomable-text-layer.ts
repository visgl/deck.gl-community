// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {TextLayer} from '@deck.gl/layers';

// deck.gl's MultiIconLayer stores character offsets in a 16-bit buffer, so clamp the
// computed max width to avoid overflowing the attribute when stylesheet values are invalid.
const TEXT_LAYER_MAX_SAFE_WIDTH = 32767;

const clampMaxWidth = (value: unknown) => {
  const width = Number(value);
  if (!Number.isFinite(width) || width <= 0) {
    return TEXT_LAYER_MAX_SAFE_WIDTH;
  }
  return Math.min(width, TEXT_LAYER_MAX_SAFE_WIDTH);
};

const normalizeMaxWidth = (value: unknown) => {
  if (typeof value === 'function') {
    return (d: unknown) => clampMaxWidth((value as (arg0: unknown) => unknown)(d));
  }
  return clampMaxWidth(value);
};

export class ZoomableTextLayer extends CompositeLayer {
  static layerName = 'ZoomableTextLayer';

  initializeState() {
    this.state = {characterSet: []};
  }

  shouldUpdateState({props, changeFlags}) {
    const {scaleWithZoom} = this.props as any;
    if (!scaleWithZoom) {
      return changeFlags.dataChanged || changeFlags.propsChanged;
    }
    return changeFlags.dataChanged || changeFlags.propsChanged || changeFlags.viewportChanged;
  }

  updateState({props, oldProps, changeFlags}) {
    super.updateState({props, oldProps, changeFlags} as any);
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
      updateTriggers,
      fontFamily,
      textWordUnits,
      textWordBreak,
      textMaxWidth,
      textSizeMinPixels
    } = this.props as any;

    const sizeUpdateTrigger = scaleWithZoom ? [getSize, this.context.viewport.zoom] : false;
    // getText only expects function not plain value (string)
    const newGetText = typeof getText === 'function' ? getText : () => getText;

    const resolvedMaxWidth = normalizeMaxWidth(textMaxWidth);

    return [
      new TextLayer(
        this.getSubLayerProps({
          id: '__text-layer',
          data,
          sizeScale: scaleWithZoom ? Math.pow(2, this.context.viewport.zoom - 1) : 1,
          characterSet: this.state.characterSet,
          getPosition,
          getColor,
          getSize,
          getTextAnchor,
          getAlignmentBaseline,
          getAngle,
          getText: newGetText,
          maxWidth: resolvedMaxWidth,
          wordBreak: textWordBreak ?? 'break-all',
          fontFamily: fontFamily ?? 'Red Hat Text',
          wordUnits: textWordUnits ?? 'pixels',
          sizeMinPixels: textSizeMinPixels ?? 9,
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
