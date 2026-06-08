import {CompositeLayer, DefaultProps, LayerProps} from '@deck.gl/core';
import {LineLayer, TextLayer} from '@deck.gl/layers';

// import {PathStyleExtension} from '@deck.gl/extensions';

import {formatTimeMs} from '../utils/format-utils';

import type {Layer} from '@deck.gl/core';
import type {TextLayerProps} from '@deck.gl/layers';

export type TimeDeltaLayerProps = LayerProps & _TimeDeltaLayerProps;

type _TimeDeltaLayerProps = Pick<TextLayerProps, 'fontFamily' | 'fontSettings' | 'fontWeight'> & {
  unit: 'timestamp' | 'milliseconds';
  minTimeMs: number;
  maxTimeMs: number;
  /** Start time in milliseconds since epoch */
  startTimeMs: number;
  /** End time in milliseconds since epoch */
  endTimeMs: number;
  /** Optional: Y-coordinate for the axis line (default: 0) */
  y?: number;
  header: boolean;

  /** Header label text size */
  fontSize?: number;

  /** Optional: RGBA color for axis and ticks (default: [0, 0, 0, 255]) */
  color?: [number, number, number, number];
  /** Minimum Y-coordinate for grid lines. @todo (ib) Remve and calculate from viewport? */
  yMin?: number;
  /** Maximum Y-coordinate for grid lines. @todo (ib) Remve and calculate from viewport? */
  yMax?: number;
};

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
