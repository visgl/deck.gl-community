// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {TextLayer} from '@deck.gl/layers';

export class ZoomableTextLayer extends CompositeLayer {
  static layerName = 'ZoomableTextLayer';

  shouldUpdateState({props, changeFlags}) {
    const {scaleWithZoom} = this.props as any;
    if (!scaleWithZoom) {
      return changeFlags.dataChanged || changeFlags.propsChanged;
    }
    return changeFlags.dataChanged || changeFlags.propsChanged || changeFlags.viewportChanged;
  }

  // eslint-disable-next-line complexity
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

    // Filter data to items that have non-empty text to avoid deck.gl 9.3
    // MultiIconLayer attribute validation errors with undefined/empty labels
    const filteredData = data
      ? data.filter((d: any) => {
          const t = newGetText(d);
          return t !== null && t !== undefined && t !== '';
        })
      : [];

    if (filteredData.length === 0) {
      return [];
    }

    return [
      new TextLayer(
        this.getSubLayerProps({
          id: '__text-layer',
          data: filteredData,
          sizeScale: scaleWithZoom ? Math.pow(2, this.context.viewport.zoom - 1) : 1,
          characterSet: 'auto',
          getPosition,
          getColor,
          getSize,
          getTextAnchor,
          getAlignmentBaseline,
          getAngle,
          getText: newGetText,
          maxWidth: textMaxWidth ?? 12,
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
