// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type Color, type DefaultProps} from '@deck.gl/core';
import {TerrainLayer} from '@deck.gl/geo-layers';
import {TerrainLoader} from '@loaders.gl/terrain';

/** Properties for a height-map-based geographic wind-showcase terrain surface. */
export type ElevationLayerProps = {
  /** Grayscale image encoding real terrain elevations in its red channel. */
  elevationData: string;
  /** Geographic extent of the elevation image: west, south, east, north. */
  bounds: [number, number, number, number];
  /** Minimum and maximum elevations encoded by the image, in meters. */
  elevationRange?: [number, number];
  /** Vertical exaggeration applied to the decoded terrain geometry. */
  elevationScale?: number;
  /** Error tolerance used to simplify the generated terrain mesh. */
  meshMaxError?: number;
  /** Color applied to the shaded three-dimensional terrain surface. */
  color?: Color;
  /** Optional image draped over the generated terrain mesh. */
  texture?: string;
};

const defaultProps: DefaultProps<ElevationLayerProps> = {
  elevationData: '',
  bounds: {type: 'array', value: [-125, 24.4, -66.7, 49.6]},
  elevationRange: {type: 'array', value: [-100, 4126]},
  elevationScale: 1,
  meshMaxError: 80,
  color: [42, 58, 72, 255],
  texture: ''
};

/**
 * Renders the original wind showcase's elevation image as an actual 3D terrain mesh.
 *
 * The image is decoded with the in-process loaders.gl terrain parser so the standalone
 * showcase does not rely on an externally hosted terrain-worker bundle.
 */
export class ElevationLayer extends CompositeLayer<ElevationLayerProps> {
  static layerName = 'ElevationLayer';
  static defaultProps: DefaultProps<ElevationLayerProps> = defaultProps;

  /** Builds the shaded, vertically exaggerated height-map terrain sub-layer. */
  renderLayers(): TerrainLayer | null {
    const {elevationData, bounds, elevationRange, elevationScale, meshMaxError, color, texture} =
      this.props;
    if (!elevationData) {
      return null;
    }

    return new TerrainLayer(this.getSubLayerProps({id: 'terrain-mesh'}), {
      elevationData,
      bounds,
      elevationDecoder: {
        rScaler: ((elevationRange[1] - elevationRange[0]) / 255) * elevationScale,
        gScaler: 0,
        bScaler: 0,
        offset: elevationRange[0] * elevationScale
      },
      meshMaxError,
      color,
      texture: texture || elevationData,
      material: {ambient: 0.42, diffuse: 0.82, shininess: 28, specularColor: [76, 91, 105]},
      loaders: [TerrainLoader],
      loadOptions: {worker: false},
      pickable: false
    });
  }
}
