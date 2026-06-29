// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type DefaultProps, type Layer, type LayerProps} from '@deck.gl/core';
import {LineLayer, TextLayer, type TextLayerProps} from '@deck.gl/layers';

// import {PathStyleExtension} from '@deck.gl/extensions';

import {formatTimeMs} from '../utils/format-utils';

/** Properties supported by {@link TimeDeltaLayer}. */
export type TimeDeltaLayerProps = LayerProps & _TimeDeltaLayerProps;

type _TimeDeltaLayerProps = Pick<TextLayerProps, 'fontFamily' | 'fontSettings' | 'fontWeight'> & {
  /** Legacy time label unit retained for compatibility. @defaultValue 'timestamp' */
  unit: 'timestamp' | 'milliseconds';
  /** Minimum trace time represented by the surrounding view. @defaultValue 0 */
  minTimeMs: number;
  /** Maximum trace time represented by the surrounding view. @defaultValue 100 */
  maxTimeMs: number;
  /** Start time in milliseconds since epoch. @defaultValue 0 */
  startTimeMs: number;
  /** End time in milliseconds since epoch. @defaultValue 100 */
  endTimeMs: number;
  /** Y coordinate for the header interval guide. @defaultValue 0 */
  y?: number;
  /** Whether to render the compact header label instead of full-height guide lines. @defaultValue false */
  header: boolean;

  /** Header label text size. @defaultValue 12 */
  fontSize?: number;

  /** RGBA color for interval guides and labels. @defaultValue [0, 0, 0, 255] */
  color?: [number, number, number, number];
  /** Minimum Y coordinate for full-height guide lines. @defaultValue -1e6 */
  yMin?: number;
  /** Maximum Y coordinate for full-height guide lines. @defaultValue 1e6 */
  yMax?: number;
};

/** Renders a selected time interval as header or viewport guide lines. */
export class TimeDeltaLayer extends CompositeLayer<Required<_TimeDeltaLayerProps>> {
  static override layerName = 'TimeDeltaLayer';
  static override defaultProps: DefaultProps<_TimeDeltaLayerProps> = {
    header: false,
    minTimeMs: 0,
    maxTimeMs: 100,
    startTimeMs: 0,
    endTimeMs: 100,
    y: 0,
    color: [0, 0, 0, 255],
    unit: 'timestamp',
    yMin: -1e6, // Should cover full viewport height in most cases
    yMax: 1e6, // Should cover full viewport height in most cases
    fontSize: 12,
    fontFamily: TextLayer.defaultProps.fontFamily,
    fontSettings: TextLayer.defaultProps.fontSettings,
    fontWeight: TextLayer.defaultProps.fontWeight
  };

  override renderLayers(): Layer[] {
    const {startTimeMs, endTimeMs, color = [0, 0, 0, 255], yMin, yMax} = this.props;

    if (!this.props.header) {
      const timeLines = [
        {
          sourcePosition: [startTimeMs, yMin],
          targetPosition: [startTimeMs, yMax]
        },
        {
          sourcePosition: [endTimeMs, yMin],
          targetPosition: [endTimeMs, yMax]
        }
      ];
      return [
        // Interval end lines
        new LineLayer({
          id: 'time-delta-side-bars',
          data: timeLines,
          getSourcePosition: d => d.sourcePosition,
          getTargetPosition: d => d.targetPosition,
          getColor: color,
          getWidth: 4,
          widthUnits: 'pixels'
        })
      ];
    }

    const {y, fontSize, fontFamily, fontSettings, fontWeight} = this.props;

    const timeDeltaPosition = [(startTimeMs + endTimeMs) / 2, y - 10];
    const timeDeltaMs = Math.abs(endTimeMs - startTimeMs);
    const timeDeltaLabel = formatTimeMs(timeDeltaMs, {space: false});

    const timeLines = [
      {
        sourcePosition: [startTimeMs, y],
        targetPosition: [startTimeMs, y - 7]
      },
      {
        sourcePosition: [endTimeMs, y],
        targetPosition: [endTimeMs, y - 7]
      }
    ];

    return [
      // Interval end lines
      new LineLayer({
        id: 'header-time-delta-side-bars',
        data: timeLines,
        getSourcePosition: d => d.sourcePosition,
        getTargetPosition: d => d.targetPosition,
        getColor: color,
        getWidth: 4,
        widthUnits: 'pixels'
      }),

      // Interval center
      new LineLayer({
        id: 'header-time-delta-dotted-line',
        data: [
          {
            sourcePosition: [startTimeMs, y - 7],
            targetPosition: [endTimeMs, y - 7]
          }
        ],
        getSourcePosition: d => d.sourcePosition,
        getTargetPosition: d => d.targetPosition,
        getColor: color,
        getWidth: 1,
        widthUnits: 'pixels'
      }),

      // Label
      new TextLayer({
        id: 'header-time-delta-label',
        data: [{position: timeDeltaPosition, text: timeDeltaLabel}],
        getPosition: d => d.position,
        getText: d => d.text,
        characterSet: '-0123456789.dhmsµ',
        getSize: fontSize,
        fontFamily,
        fontSettings,
        fontWeight,
        getColor: color,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        background: true,
        getBackgroundColor: [255 - color[0], 255 - color[1], 255 - color[2], 255],
        backgroundPadding: [4, 2] // Horizontal and vertical padding
      })
    ];
  }
}
