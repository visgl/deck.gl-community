// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import { CompositeLayer, LayerProps } from '@deck.gl/core';
import { LineLayer, TextLayer } from '@deck.gl/layers';

// import {PathStyleExtension} from '@deck.gl/extensions';

import { formatTimeMs } from '../utils/format-utils';

export type TimeDeltaLayerProps = LayerProps & {
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

  /** Optional: RGBA color for axis and ticks (default: [0, 0, 0, 255]) */
  color?: [number, number, number, number];
  /** Minimum Y-coordinate for grid lines. @todo (ib) Remve and calculate from viewport? */
  yMin?: number;
  /** Maximum Y-coordinate for grid lines. @todo (ib) Remve and calculate from viewport? */
  yMax?: number;
};

export class TimeDeltaLayer extends CompositeLayer<TimeDeltaLayerProps> {
  static override layerName = 'TimeDeltaLayer';
  static override defaultProps: Required<Omit<TimeDeltaLayerProps, keyof LayerProps>> = {
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
  };

  override renderLayers() {
    const { startTimeMs, endTimeMs, color = [0, 0, 0, 255], yMin, yMax } = this.props;

    const timeDeltaPosition = [(startTimeMs + endTimeMs) / 2, 10];
    const timeDeltaMs = Math.abs(endTimeMs - startTimeMs);
    const timeDeltaLabel = formatTimeMs(timeDeltaMs, false);

    if (!this.props.header) {
      const timeLines = [
        {
          sourcePosition: [startTimeMs, yMin],
          targetPosition: [startTimeMs, yMax],
        },
        {
          sourcePosition: [endTimeMs, yMin],
          targetPosition: [endTimeMs, yMax],
        },
      ];
      return [
        // Interval end lines
        new LineLayer({
          id: 'time-delta-side-bars',
          data: timeLines,
          getSourcePosition: (d) => d.sourcePosition,
          getTargetPosition: (d) => d.targetPosition,
          getColor: color,
          getWidth: 4,
          widthUnits: 'pixels',
        }),
      ];
    }

    // // Tick marks
    // new LineLayer({
    //   id: 'time-delta-marks',
    //   data: tickLines,
    //   getSourcePosition: (d) => d.sourcePosition,
    //   getTargetPosition: (d) => d.targetPosition,
    //   getColor: color,
    //   getWidth: 1,
    // }),

    // TODO - triggers an update of monorepo root files
    //   new PathLayer({
    //     id: 'dotted-path',
    //     data: route,
    //     getPath: d => d.path,
    //     getWidth: 4,
    //     getColor: [255, 0, 0],

    //     // Enable rounded caps on each dash
    //     rounded: true,

    //     // Add the dash extension
    //     extensions: [
    //       new PathStyleExtension({
    //         dash: true,
    //         // highPrecisionDash: true, // uncomment for finer control at low zoom
    //         capRounded: true          // draw dash ends as semicircles
    //       })
    //     ],

    //     // [dashLength, gapLength] in pixels
    //     // small dash + equal or larger gap = dotted effect
    //     getDashArray: () => [2, 6]
    //   })
    // ]
    const HEADER_Y = 12;
    const timeLines = [
      {
        sourcePosition: [startTimeMs, -100],
        targetPosition: [startTimeMs, HEADER_Y],
      },
      {
        sourcePosition: [endTimeMs, -100],
        targetPosition: [endTimeMs, HEADER_Y],
      },
    ];

    return [
      // Interval end lines
      new LineLayer({
        id: 'header-time-delta-side-bars',
        data: timeLines,
        getSourcePosition: (d) => d.sourcePosition,
        getTargetPosition: (d) => d.targetPosition,
        getColor: color,
        getWidth: 4,
        widthUnits: 'pixels',
      }),

      // Interval center
      new LineLayer({
        id: 'header-time-delta-dotted-line',
        data: [
          {
            sourcePosition: [startTimeMs, HEADER_Y - 7],
            targetPosition: [endTimeMs, HEADER_Y - 7],
          },
        ],
        getSourcePosition: (d) => d.sourcePosition,
        getTargetPosition: (d) => d.targetPosition,
        getColor: color,
        getWidth: 1,
        widthUnits: 'pixels',
      }),

      // Label
      new TextLayer({
        id: 'header-time-delta-label',
        data: [{ position: timeDeltaPosition, text: timeDeltaLabel }],
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 12,
        getColor: color,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'top',
        background: true,
        getBackgroundColor: [255, 255, 255, 255], // Solid green background
        backgroundPadding: [4, 2], // Horizontal and vertical padding
      }),
    ];
  }
}
