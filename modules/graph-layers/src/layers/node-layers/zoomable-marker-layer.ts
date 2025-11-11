// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  CompositeLayer,
  type CompositeLayerProps,
  type AccessorFunction,
  type UpdateParameters
} from '@deck.gl/core';
import {MarkerLayer} from '../common-layers/marker-layer/marker-layer';

import type {NodeInterface} from '../../graph/graph';
import type {GraphStylesheetEngine} from '../../style/graph-style-engine';

/** Props for the {@link ZoomableMarkerLayer} composite layer. */
export type ZoomableMarkerLayerProps = CompositeLayerProps & {
  /** Graph nodes to render as zoom-aware markers. */
  data: readonly NodeInterface[];
  /** Accessor returning the world position for each node. */
  getPosition: AccessorFunction<NodeInterface, readonly [number, number]>;
  /** Stylesheet engine that exposes Deck.gl accessors for marker rendering. */
  stylesheet: GraphStylesheetEngine;
  /** Value used to invalidate cached positions when node layout changes. */
  positionUpdateTrigger?: unknown;
};

export class ZoomableMarkerLayer extends CompositeLayer<ZoomableMarkerLayerProps> {
  static layerName = 'ZoomableMarkerLayer';

  shouldUpdateState({props, changeFlags}: UpdateParameters<ZoomableMarkerLayerProps>) {
    const {stylesheet} = this.props;
    const scaleWithZoomAccessor = stylesheet.getDeckGLAccessor('scaleWithZoom');
    const exampleNode = props.data?.[0] ?? null;
    const scaleWithZoom =
      typeof scaleWithZoomAccessor === 'function'
        ? scaleWithZoomAccessor(exampleNode)
        : scaleWithZoomAccessor;

    if (!scaleWithZoom) {
      return changeFlags.somethingChanged;
    }

    return changeFlags.somethingChanged || changeFlags.viewportChanged;
  }

  renderLayers() {
    const {data, getPosition, stylesheet, positionUpdateTrigger = 0} = this.props;

    const getSize = stylesheet.getDeckGLAccessor('getSize');
    const scaleWithZoomAccessor = stylesheet.getDeckGLAccessor('scaleWithZoom');
    const scaleWithZoomValue =
      typeof scaleWithZoomAccessor === 'function'
        ? scaleWithZoomAccessor(data[0] ?? null)
        : scaleWithZoomAccessor;
    const sizeUpdateTrigger = scaleWithZoomValue ? [getSize, this.context.viewport.zoom] : false;
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
          sizeScale: scaleWithZoomValue ? Math.max(0, this.context.viewport.zoom) : 1,
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
