// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  CompositeLayer,
  type CompositeLayerProps,
  type Accessor,
  type AccessorFunction
} from '@deck.gl/core';
import {IconLayer} from '@deck.gl/layers';

import type {NodeInterface} from '../../../graph/graph';
import {MarkerMapping} from './marker-mapping';
import {AtlasDataURL} from './atlas-data-url';

/** Props for the {@link MarkerLayer} composite layer. */
export type MarkerLayerProps = CompositeLayerProps & {
  /** Graph nodes to render as icon markers. */
  data: readonly NodeInterface[];
  /** Accessor returning the world position for each marker. */
  getPosition: AccessorFunction<NodeInterface, readonly [number, number]>;
  /** Accessor resolving the icon identifier for each marker. */
  getMarker: Accessor<NodeInterface, string>;
  /** Accessor resolving the RGBA color for each marker. */
  getColor: Accessor<NodeInterface, readonly number[]>;
  /** Accessor resolving the icon size for each marker. */
  getSize: Accessor<NodeInterface, number>;
};

export class MarkerLayer extends CompositeLayer<MarkerLayerProps> {
  static layerName = 'MarkerLayer';

  static defaultProps = {
    id: 'MarkerLayer',
    data: [],
    getMarker: (d) => d.marker,
    getColor: (d) => [0, 0, 0],
    getSize: (d) => 10
  };

  renderLayers() {
    const {getMarker, ...otherProps} = this.props;
    return [
      new IconLayer(
        this.getSubLayerProps({
          id: 'marker-layer',
          iconAtlas: AtlasDataURL.dataURL,
          iconMapping: MarkerMapping,
          getIcon: getMarker,
          ...otherProps
        })
      )
    ];
  }
}
