// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {TextLayer} from '@deck.gl/layers';

const TEXT_LAYER_MAX_SAFE_WIDTH = 32767;

const clampMaxWidth = (value: unknown) => {
  const width = Number(value);
  if (!Number.isFinite(width) || width <= 0) {
    return TEXT_LAYER_MAX_SAFE_WIDTH;
  }
  return Math.min(width, TEXT_LAYER_MAX_SAFE_WIDTH);
};

export const normalizeTextMaxWidth = (value: unknown) => {
  if (typeof value === 'function') {
    return (d: unknown) => clampMaxWidth((value as (arg0: unknown) => unknown)(d));
  }
  return clampMaxWidth(value);
};

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
    const resolvedMaxWidth = normalizeTextMaxWidth(textMaxWidth);

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

    // Defensive getText wrapper that guarantees a non-empty string.
    // TextLayer's internal MultiIconLayer generates NaN in instanceIconDefs
    // when a character is missing from the font atlas.
    const safeGetText = (d: any) => String(newGetText(d) ?? '') || ' ';

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
          getText: safeGetText,
          maxWidth: resolvedMaxWidth,
          wordBreak: textWordBreak ?? 'break-all',
          fontFamily: fontFamily ?? 'sans-serif',
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
