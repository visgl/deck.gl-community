// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type Color, type DefaultProps} from '@deck.gl/core';
import {SolidPolygonLayer} from '@deck.gl/layers';

import type {WindField, WindStation, WindTriangle} from './wind-data';

/** Properties for the station-triangulated terrain beneath a geographic wind field. */
export type DelaunayCoverLayerProps = {
  /** Wind field supplying the geographic station triangulation. */
  windField: WindField;
  /** Elevation multiplier applied to station heights in meters. */
  elevationScale?: number;
  /** Color for the lowest station elevation. */
  lowColor?: Color;
  /** Color for the highest station elevation. */
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

/** Recreates the wind showcase's elevation-colored Delaunay terrain as a reusable layer. */
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

    return new SolidPolygonLayer<TerrainTriangle>(this.getSubLayerProps({id: 'terrain'}), {
      data,
      getPolygon: triangle => triangle.polygon,
      getFillColor: triangle => triangle.color,
      material: true,
      pickable: false
    });
  }
}
