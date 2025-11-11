// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  CompositeLayer,
  type CompositeLayerProps,
  type Accessor,
  type AccessorFunction,
  type UpdateParameters
} from '@deck.gl/core';
import {TextLayer} from '@deck.gl/layers';

type NumericTuple = readonly [number, number] | readonly [number, number, number];

/** Props for the {@link ZoomableTextLayer} composite layer. */
export type ZoomableTextLayerProps<DatumT = unknown> = CompositeLayerProps & {
  /** Items to render as zoom-aware text labels. */
  data: readonly DatumT[];
  /** Accessor returning the world position for each label. */
  getPosition: AccessorFunction<DatumT, NumericTuple>;
  /** Accessor resolving the RGBA color for each label. */
  getColor?: Accessor<DatumT, readonly number[]>;
  /** Accessor resolving the text content for each label. */
  getText?: Accessor<DatumT, string>;
  /** Accessor resolving the font size for each label. */
  getSize?: Accessor<DatumT, number>;
  /** Accessor resolving the horizontal text anchor. */
  getTextAnchor?: Accessor<DatumT, string>;
  /** Accessor resolving the vertical alignment baseline. */
  getAlignmentBaseline?: Accessor<DatumT, string>;
  /** Accessor resolving the rotation angle in degrees. */
  getAngle?: Accessor<DatumT, number>;
  /** Whether label sizes should respond to zoom level. */
  scaleWithZoom?: boolean;
  /** Update triggers forwarded to the Deck.gl {@link TextLayer}. */
  updateTriggers: Record<string, unknown>;
  /** Font family used when rendering text. */
  fontFamily?: string;
  /** Unit system used to interpret {@link TextLayerProps.wordBreak}. */
  textWordUnits?: string;
  /** Strategy used to break long words. */
  textWordBreak?: string;
  /** Maximum text width in layout units. */
  textMaxWidth?: number;
  /** Minimum on-screen font size in pixels. */
  textSizeMinPixels?: number;
};

type ZoomableTextLayerState = {
  characterSet: string[];
};

export class ZoomableTextLayer<DatumT = unknown> extends CompositeLayer<ZoomableTextLayerProps<DatumT>> {
  static layerName = 'ZoomableTextLayer';

  declare state: ZoomableTextLayerState;

  initializeState() {
    this.state = {characterSet: []};
  }

  shouldUpdateState({props, changeFlags}: UpdateParameters<ZoomableTextLayerProps<DatumT>>) {
    const {scaleWithZoom} = this.props;
    if (!scaleWithZoom) {
      return changeFlags.dataChanged || changeFlags.propsChanged;
    }
    return changeFlags.dataChanged || changeFlags.propsChanged || changeFlags.viewportChanged;
  }

  updateState({props, oldProps, changeFlags}: UpdateParameters<ZoomableTextLayerProps<DatumT>>) {
    super.updateState({props, oldProps, changeFlags});
    if (changeFlags.propsOrDataChanged) {
      const {getText} = props;
      let textLabels: string[] = [];
      if (typeof getText === 'function') {
        const textAccessor = getText as (datum: DatumT) => string;
        textLabels = props.data.map((item) => textAccessor(item));
      } else if (typeof getText === 'string') {
        textLabels = [getText];
      } else {
        textLabels = [];
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
    } = this.props;

    const sizeUpdateTrigger = scaleWithZoom ? [getSize, this.context.viewport.zoom] : false;
    // getText only expects function not plain value (string)
    const newGetText = typeof getText === 'function' ? getText : () => getText;

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
