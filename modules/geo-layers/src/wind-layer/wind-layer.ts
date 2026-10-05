// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type Color, type DefaultProps} from '@deck.gl/core';
import {LineLayer} from '@deck.gl/layers';

import {sampleWindField, type WindField} from './wind-data';
import {WindTriangleLayer} from './wind-triangle-layer';

/**
 * Configuration for the work-in-progress, station-interpolated {@link WindLayer}.
 *
 * @remarks
 * Filled arrows use a native dual-backend triangle primitive, and outlines use portable
 * `LineLayer` segments. Image-based terrain remains dependent on upstream WebGPU support.
 */
export type WindLayerProps = {
  /** Indexed, time-varying weather station data. */
  windField: WindField;
  /** Fractional, automatically wrapping forecast-frame index; defaults to `0`. */
  time?: number;
  /** Longitudinal arrow-sample count; defaults to `64`. */
  gridWidth?: number;
  /** Latitudinal arrow-sample count; defaults to `32`. */
  gridHeight?: number;
  /** Geographic arrow-length multiplier; defaults to `0.65`. */
  speedScale?: number;
  /** Minimum on-screen arrow width in pixels; defaults to `1.25`. */
  widthMinPixels?: number;
  /** RGBA color for the minimum observed wind speed. */
  lowColor?: Color;
  /** RGBA color for the maximum observed wind speed. */
  highColor?: Color;
  /** Multiplier for station elevation in meters; defaults to `1`. */
  elevationScale?: number;
  /** Separation above the station-interpolated terrain in meters; defaults to `200`. */
  surfaceOffset?: number;
};

type WindArrow = {
  shaft: [number, number, number][];
  head: [number, number, number][];
  polygon: [number, number, number][];
  color: Color;
};

type WindArrowTriangle = {
  positions: [
    WindArrow['polygon'][number],
    WindArrow['polygon'][number],
    WindArrow['polygon'][number]
  ];
  color: Color;
};

type WindArrowheadSegment = {
  source: WindArrow['head'][number];
  target: WindArrow['head'][number];
  color: Color;
};

const ARROW_TRIANGLE_INDICES: readonly [number, number, number][] = [
  [0, 1, 6],
  [1, 5, 6],
  [1, 2, 5],
  [2, 3, 5],
  [3, 4, 5]
];

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

/**
 * Renders the historical wind showcase as sampled, speed-colored directional arrows.
 *
 * @remarks
 * This API is a work in progress. Create one shared `WindField` and preserve the layer's
 * `id` while advancing fractional forecast time. Filled arrows, shafts, and arrowheads
 * render on both WebGL2 and WebGPU.
 *
 * @example
 * ```ts
 * new WindLayer({
 *   id: 'wind-arrows',
 *   windField,
 *   time: 12.5,
 *   gridWidth: 40,
 *   gridHeight: 22
 * });
 * ```
 */
export class WindLayer extends CompositeLayer<WindLayerProps> {
  static layerName = 'WindLayer';
  static defaultProps: DefaultProps<WindLayerProps> = defaultProps;

  /** Samples valid station coverage and builds filled, shaft, and arrowhead sublayers. */
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

    const triangles: WindArrowTriangle[] = arrows.flatMap(arrow =>
      ARROW_TRIANGLE_INDICES.map(([first, second, third]) => ({
        positions: [arrow.polygon[first], arrow.polygon[second], arrow.polygon[third]],
        color: arrow.color
      }))
    );
    const arrowheads: WindArrowheadSegment[] = arrows.flatMap(arrow => [
      {source: arrow.head[0], target: arrow.head[1], color: arrow.color},
      {source: arrow.head[1], target: arrow.head[2], color: arrow.color}
    ]);

    return [
      new WindTriangleLayer<WindArrowTriangle>(this.getSubLayerProps({id: 'glyphs'}), {
        data: triangles,
        getFirstPosition: triangle => triangle.positions[0],
        getSecondPosition: triangle => triangle.positions[1],
        getThirdPosition: triangle => triangle.positions[2],
        getColor: triangle => triangle.color,
        parameters: {depthWriteEnabled: false},
        pickable: false
      }),
      new LineLayer<WindArrow>(this.getSubLayerProps({id: 'shafts'}), {
        data: arrows,
        getSourcePosition: arrow => arrow.shaft[0],
        getTargetPosition: arrow => arrow.shaft[1],
        getColor: arrow => arrow.color,
        getWidth: widthMinPixels,
        widthUnits: 'pixels',
        widthMinPixels,
        pickable: false
      }),
      new LineLayer<WindArrowheadSegment>(this.getSubLayerProps({id: 'arrowheads'}), {
        data: arrowheads,
        getSourcePosition: segment => segment.source,
        getTargetPosition: segment => segment.target,
        getColor: segment => segment.color,
        getWidth: widthMinPixels,
        widthUnits: 'pixels',
        widthMinPixels,
        pickable: false
      })
    ];
  }
}
