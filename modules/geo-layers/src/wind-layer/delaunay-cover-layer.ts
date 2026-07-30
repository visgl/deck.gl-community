// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type Color, type DefaultProps} from '@deck.gl/core';
import type {WindField, WindStation, WindTriangle} from './wind-data';
import {WindTriangleLayer} from './wind-triangle-layer';

/** Configuration for the work-in-progress, station-triangulated {@link DelaunayCoverLayer}. */
export type DelaunayCoverLayerProps = {
  /** Wind field supplying the geographic station triangulation. */
  windField: WindField;
  /** Station-height multiplier; defaults to `1`. */
  elevationScale?: number;
  /** RGBA fill for the lowest station elevation. */
  lowColor?: Color;
  /** RGBA fill for the highest station elevation. */
  highColor?: Color;
};

type TerrainTriangle = {
  polygon: [number, number, number][];
  color: Color;
};

const defaultProps: DefaultProps<DelaunayCoverLayerProps> = {
  windField: {type: 'object', value: undefined!},
  elevationScale: 1,
  lowColor: [17, 34, 49, 220],
  highColor: [102, 151, 127, 235]
};

function createTerrainTriangle(
  triangle: WindTriangle,
  stations: readonly WindStation[],
  elevationScale: number,
  lowColor: Color,
  highColor: Color,
  minimumElevation: number,
  elevationSpan: number
): TerrainTriangle {
  const vertices = triangle.map(index => stations[index]);
  const averageElevation = vertices.reduce((sum, station) => sum + station.elv, 0) / 3;
  const intensity = Math.max(0, Math.min(1, (averageElevation - minimumElevation) / elevationSpan));
  return {
    polygon: vertices.map(station => [-station.long, station.lat, station.elv * elevationScale]),
    color: [
      Math.round(lowColor[0] + (highColor[0] - lowColor[0]) * intensity),
      Math.round(lowColor[1] + (highColor[1] - lowColor[1]) * intensity),
      Math.round(lowColor[2] + (highColor[2] - lowColor[2]) * intensity),
      Math.round((lowColor[3] ?? 255) + ((highColor[3] ?? 255) - (lowColor[3] ?? 255)) * intensity)
    ]
  };
}

/**
 * Renders elevation-colored terrain from the actual station Delaunay triangulation.
 *
 * @remarks
 * This API is a work in progress. It visualizes station triangles; use
 * {@link ElevationLayer} when a smooth image-derived mountain mesh is required.
 * The underlying `SolidPolygonLayer` currently limits full WebGPU support.
 *
 * @example
 * ```ts
 * new DelaunayCoverLayer({
 *   id: 'wind-station-mesh',
 *   windField,
 *   elevationScale: 24
 * });
 * ```
 */
export class DelaunayCoverLayer extends CompositeLayer<DelaunayCoverLayerProps> {
  static layerName = 'DelaunayCoverLayer';
  static defaultProps: DefaultProps<DelaunayCoverLayerProps> = defaultProps;

  /** Renders one elevation-colored polygon for each station triangle. */
  renderLayers() {
    const {windField, elevationScale, lowColor, highColor} = this.props;
    if (!windField) {
      return null;
    }
    const elevations = windField.stations.map(station => station.elv);
    const minimumElevation = Math.min(...elevations);
    const elevationSpan = Math.max(Math.max(...elevations) - minimumElevation, 1);
    const data = windField.triangles.map(triangle =>
      createTerrainTriangle(
        triangle,
        windField.stations,
        elevationScale,
        lowColor,
        highColor,
        minimumElevation,
        elevationSpan
      )
    );

    return new WindTriangleLayer<TerrainTriangle>(this.getSubLayerProps({id: 'terrain'}), {
      data,
      getFirstPosition: triangle => triangle.polygon[0],
      getSecondPosition: triangle => triangle.polygon[1],
      getThirdPosition: triangle => triangle.polygon[2],
      getColor: triangle => triangle.color,
      pickable: false
    });
  }
}
