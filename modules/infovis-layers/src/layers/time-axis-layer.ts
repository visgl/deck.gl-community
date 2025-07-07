// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type CompositeLayerProps, type UpdateParameters} from '@deck.gl/core';
import {LineLayer, TextLayer} from '@deck.gl/layers';

import {formatTimeMs} from '../utils/format-utils';
import {getPrettyTicks, getZoomedRange} from '../utils/tick-utils';

export type TimeAxisLayerProps = CompositeLayerProps & {
  unit: 'timestamp' | 'milliseconds';
  /** Start time in milliseconds since epoch */
  startTimeMs: number;
  /** End time in milliseconds since epoch */
  endTimeMs: number;
  /** Optional: Number of tick marks (default: 5) */
  tickCount?: number;
  /** Optional: Y-coordinate for the axis line (default: 0) */
  y?: number;
  /** Optional: RGBA color for axis and ticks (default: [0, 0, 0, 255]) */
  color?: [number, number, number, number];
  /** Optional: Bounds for the axis line (default: viewport bounds) */
  bounds?: [number, number, number, number];
};

export class TimeAxisLayer extends CompositeLayer<TimeAxisLayerProps> {
  static override layerName = 'TimeAxisLayer';
  static override defaultProps: Required<Omit<TimeAxisLayerProps, keyof CompositeLayerProps>> = {
    startTimeMs: 0,
    endTimeMs: 100,
    tickCount: 5,
    y: 0,
    color: [0, 0, 0, 255],
    unit: 'timestamp',
    bounds: undefined!
  };

  // Called whenever props/data/viewports change
  override shouldUpdateState(params: UpdateParameters<TimeAxisLayer>): boolean {
    return params.changeFlags.viewportChanged || super.shouldUpdateState(params);
  }

  override renderLayers() {
    const {startTimeMs, endTimeMs, tickCount = 10, y = 0, color = [0, 0, 0, 255]} = this.props;

    let bounds: [number, number, number, number];
    try {
      bounds = this.context.viewport.getBounds();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('Error getting bounds from viewport:', error);
      throw error;
    }
    const [startTimeZoomed, endTimeZoomed] = getZoomedRange(startTimeMs, endTimeMs, bounds);
    // Generate tick positions and labels
    const ticks = getPrettyTicks(startTimeZoomed, endTimeZoomed, tickCount);

    const tickLines = ticks.map((x) => ({
      sourcePosition: [x, y - 5],
      targetPosition: [x, y + 5]
    }));

    const tickLabels = ticks.map((x) => ({
      position: [x, y - 10],
      text:
        this.props.unit === 'timestamp' ? new Date(x).toLocaleTimeString() : formatTimeMs(x, false)
    }));

    return [
      // Axis line
      new LineLayer({
        id: 'axis-line',
        data: [{sourcePosition: [startTimeZoomed, y], targetPosition: [endTimeZoomed, y]}],
        getSourcePosition: (d) => d.sourcePosition,
        getTargetPosition: (d) => d.targetPosition,
        getColor: color,
        getWidth: 2
      }),
      // Tick marks
      new LineLayer({
        id: 'tick-marks',
        data: tickLines,
        getSourcePosition: (d) => d.sourcePosition,
        getTargetPosition: (d) => d.targetPosition,
        getColor: color,
        getWidth: 1
      }),
      // Tick labels
      new TextLayer({
        id: 'tick-labels',
        data: tickLabels,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 12,
        getColor: color,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'top'
      })
    ];
  }
}
