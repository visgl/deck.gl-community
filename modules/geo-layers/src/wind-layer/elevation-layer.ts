// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type Color, type DefaultProps} from '@deck.gl/core';
import {TerrainLayer} from '@deck.gl/geo-layers';
import {TerrainLoader} from '@loaders.gl/terrain';

/** Configuration for the work-in-progress, height-map-based {@link ElevationLayer}. */
export type ElevationLayerProps = {
  /** Grayscale image encoding real terrain elevations in its red channel. */
  elevationData: string;
  /** Geographic extent of the elevation image: west, south, east, north. */
  bounds: [number, number, number, number];
  /** Encoded minimum and maximum elevation in meters; defaults to `[-100, 4126]`. */
  elevationRange?: [number, number];
  /** Vertical exaggeration of the decoded terrain; defaults to `1`. */
  elevationScale?: number;
  /** Mesh simplification error tolerance; defaults to `80`. */
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
 *
 * @remarks
 * This API is a work in progress. Smooth the source height map before applying strong
 * exaggeration; use a smaller `meshMaxError` to preserve mountain detail. WebGPU support
 * depends on the upstream `TerrainLayer` and active loaders.gl rendering path.
 *
 * @example
 * ```ts
 * new ElevationLayer({
 *   id: 'wind-terrain',
 *   elevationData: '/wind/elevation.png',
 *   bounds: [-125, 24.4, -66.7, 49.6],
 *   elevationRange: [-100, 4126],
 *   elevationScale: 24,
 *   meshMaxError: 12
 * });
 * ```
 */
export class ElevationLayer extends CompositeLayer<ElevationLayerProps> {
  static layerName = 'ElevationLayer';
  static defaultProps: DefaultProps<ElevationLayerProps> = defaultProps;

  /** Builds the shaded, vertically exaggerated height-map terrain sub-layer. */
  renderLayers(): TerrainLayer | null {
    const {elevationData, bounds, elevationRange, elevationScale, meshMaxError, color, texture} =
      this.props;
    if (!elevationData || this.context?.device?.type === 'webgpu') {
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
      material: {ambient: 0.58, diffuse: 0.68, shininess: 48, specularColor: [18, 23, 28]},
      loaders: [TerrainLoader],
      loadOptions: {worker: false},
      pickable: false
    });
  }
}
