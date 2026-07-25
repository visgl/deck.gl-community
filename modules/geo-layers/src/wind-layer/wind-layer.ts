// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type Color, type DefaultProps} from '@deck.gl/core';
import {PathLayer, SolidPolygonLayer} from '@deck.gl/layers';

import {sampleWindField, type WindField} from './wind-data';

/** Properties for rendering geographic wind vectors as directional arrow glyphs. */
export type WindLayerProps = {
  /** Indexed, time-varying weather station data. */
  windField: WindField;
  /** Fractional weather-frame time. Frame indices wrap automatically. */
  time?: number;
  /** Number of arrow samples in the longitudinal direction. */
  gridWidth?: number;
  /** Number of arrow samples in the latitudinal direction. */
  gridHeight?: number;
  /** Geographic length multiplier for wind arrows. */
  speedScale?: number;
  /** Minimum on-screen arrow width in pixels. */
  widthMinPixels?: number;
  /** Color used for slower wind vectors. */
  lowColor?: Color;
  /** Color used for faster wind vectors. */
  highColor?: Color;
  /** Elevation multiplier applied to sampled station elevations. */
  elevationScale?: number;
  /** Vertical separation above the terrain surface, in meters. */
  surfaceOffset?: number;
};

type WindArrow = {
  shaft: [number, number, number][];
  head: [number, number, number][];
  polygon: [number, number, number][];
  color: Color;
};

const defaultProps: DefaultProps<WindLayerProps> = {
  windField: {type: 'object', value: undefined!},
  time: 0,
  gridWidth: 64,
  gridHeight: 32,
  speedScale: 0.65,
  widthMinPixels: 1.25,
  lowColor: [70, 190, 168, 190],
  highColor: [247, 105, 76, 235],
  elevationScale: 1,
  surfaceOffset: 200
};

function mixColor(from: Color, to: Color, factor: number): Color {
  return [
    Math.round(from[0] + (to[0] - from[0]) * factor),
    Math.round(from[1] + (to[1] - from[1]) * factor),
    Math.round(from[2] + (to[2] - from[2]) * factor),
    Math.round((from[3] ?? 255) + ((to[3] ?? 255) - (from[3] ?? 255)) * factor)
  ];
}

/** Renders the original wind showcase's directional field as reusable deck.gl arrow glyphs. */
export class WindLayer extends CompositeLayer<WindLayerProps> {
  static layerName = 'WindLayer';
  static defaultProps: DefaultProps<WindLayerProps> = defaultProps;

  /** Samples the field and renders arrow shafts and directional arrowheads. */
  renderLayers() {
    const {
      windField,
      time,
      gridWidth,
      gridHeight,
      speedScale,
      widthMinPixels,
      lowColor,
      highColor,
      elevationScale,
      surfaceOffset
    } = this.props;
    if (!windField || gridWidth < 2 || gridHeight < 2) {
      return null;
    }

    const {bounds, speedRange} = windField;
    const longitudeStep = (bounds.maxLng - bounds.minLng) / (gridWidth - 1);
    const latitudeStep = (bounds.maxLat - bounds.minLat) / (gridHeight - 1);
    const speedSpan = Math.max(speedRange[1] - speedRange[0], Number.EPSILON);
    const arrows: WindArrow[] = [];

    for (let row = 0; row < gridHeight; row++) {
      for (let column = 0; column < gridWidth; column++) {
        const longitude = bounds.minLng + (column + (row % 2 === 0 ? 0 : 0.5)) * longitudeStep;
        const latitude = bounds.minLat + row * latitudeStep;
        const sample = sampleWindField(windField, [longitude, latitude], time);
        if (!sample || sample.speed <= 0) {
          continue;
        }

        const intensity = Math.max(0, Math.min(1, (sample.speed - speedRange[0]) / speedSpan));
        const arrowLength =
          Math.min(longitudeStep, latitudeStep) * speedScale * (0.25 + intensity * 0.75);
        const deltaX = Math.cos(sample.direction) * arrowLength;
        const deltaY = Math.sin(sample.direction) * arrowLength;
        const elevation = sample.elevation * elevationScale + surfaceOffset;
        const source: [number, number, number] = [longitude, latitude, elevation];
        const target: [number, number, number] = [longitude + deltaX, latitude + deltaY, elevation];
        const wingScale = 0.34;
        const wingSpread = 0.52;
        const perpendicularX = -Math.sin(sample.direction);
        const perpendicularY = Math.cos(sample.direction);
        const shaftHalfWidth = arrowLength * 0.1;
        const headHalfWidth = arrowLength * 0.3;
        const headStartX = longitude + deltaX * 0.59;
        const headStartY = latitude + deltaY * 0.59;
        arrows.push({
          shaft: [source, target],
          head: [
            [
              target[0] - deltaX * wingScale - deltaY * wingSpread * wingScale,
              target[1] - deltaY * wingScale + deltaX * wingSpread * wingScale,
              elevation
            ],
            target,
            [
              target[0] - deltaX * wingScale + deltaY * wingSpread * wingScale,
              target[1] - deltaY * wingScale - deltaX * wingSpread * wingScale,
              elevation
            ]
          ],
          polygon: [
            [
              longitude + perpendicularX * shaftHalfWidth,
              latitude + perpendicularY * shaftHalfWidth,
              elevation
            ],
            [
              headStartX + perpendicularX * shaftHalfWidth,
              headStartY + perpendicularY * shaftHalfWidth,
              elevation
            ],
            [
              headStartX + perpendicularX * headHalfWidth,
              headStartY + perpendicularY * headHalfWidth,
              elevation
            ],
            target,
            [
              headStartX - perpendicularX * headHalfWidth,
              headStartY - perpendicularY * headHalfWidth,
              elevation
            ],
            [
              headStartX - perpendicularX * shaftHalfWidth,
              headStartY - perpendicularY * shaftHalfWidth,
              elevation
            ],
            [
              longitude - perpendicularX * shaftHalfWidth,
              latitude - perpendicularY * shaftHalfWidth,
              elevation
            ]
          ],
          color: mixColor(lowColor, highColor, intensity)
        });
      }
    }

    return [
      new SolidPolygonLayer<WindArrow>(this.getSubLayerProps({id: 'glyphs'}), {
        data: arrows,
        getPolygon: arrow => arrow.polygon,
        getFillColor: arrow => arrow.color,
        material: {ambient: 0.75, diffuse: 0.45, shininess: 16},
        parameters: {depthWriteEnabled: false},
        pickable: false
      }),
      new PathLayer<WindArrow>(this.getSubLayerProps({id: 'shafts'}), {
        data: arrows,
        getPath: arrow => arrow.shaft,
        getColor: arrow => arrow.color,
        getWidth: 1,
        widthUnits: 'pixels',
        widthMinPixels,
        capRounded: true,
        pickable: false
      }),
      new PathLayer<WindArrow>(this.getSubLayerProps({id: 'arrowheads'}), {
        data: arrows,
        getPath: arrow => arrow.head,
        getColor: arrow => arrow.color,
        getWidth: 1,
        widthUnits: 'pixels',
        widthMinPixels,
        jointRounded: true,
        capRounded: true,
        pickable: false
      })
    ];
  }
}
