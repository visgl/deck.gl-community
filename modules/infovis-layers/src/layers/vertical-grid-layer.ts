// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type CompositeLayerProps, type UpdateParameters} from '@deck.gl/core';
import {LineLayer} from '@deck.gl/layers';

import {getPrettyTicks, getZoomedRange} from '../utils/tick-utils';

export type VerticalGridLayerProps = CompositeLayerProps & {
  /** Start time in milliseconds since epoch */
  xMin: number;
  /** End time in milliseconds since epoch */
  xMax: number;
  /** Optional: Number of tick marks (default: 5) */
  tickCount?: number;
  /** Minimum Y-coordinate for grid lines */
  yMin?: number;
  /** Maximum Y-coordinate for grid lines */
  yMax?: number;
  /** Optional: Width of the grid lines (default: 1) */
  width?: number;
  /** Optional: RGBA color for grid lines (default: [200, 200, 200, 255]) */
  color?: [number, number, number, number];
};

export class VerticalGridLayer extends CompositeLayer<VerticalGridLayerProps> {
  static override layerName = 'VerticalGridLayer';
  static override defaultProps = {
    yMin: -1e6,
    yMax: 1e6,
    tickCount: 5,
    width: 1,
    color: [200, 200, 200, 255]
  };

  override shouldUpdateState(params: UpdateParameters<VerticalGridLayer>): boolean {
    return params.changeFlags.viewportChanged || super.shouldUpdateState(params);
  }

  override renderLayers() {
    const {xMin, xMax, tickCount = 5, yMin, yMax, color} = this.props;

    // Access the current viewport
    const viewport = this.context.viewport;
    const bounds = viewport.getBounds(); // Returns [minX, minY, maxX, maxY]

    // Calculate the visible time range based on the viewport bounds
    const [startTimeZoomed, endTimeZoomed] = getZoomedRange(xMin, xMax, bounds);

    // Generate tick positions
    const tickPositions = getPrettyTicks(startTimeZoomed, endTimeZoomed, tickCount);

    // Create vertical grid lines at each tick position
    const gridLines = tickPositions.map((x) => ({
      sourcePosition: [x, yMin],
      targetPosition: [x, yMax]
    }));

    return new LineLayer({
      id: `${this.props.id}-lines`,
      data: gridLines,
      getSourcePosition: (d) => d.sourcePosition,
      getTargetPosition: (d) => d.targetPosition,
      getColor: color,
      getWidth: 1
    });
  }
}
