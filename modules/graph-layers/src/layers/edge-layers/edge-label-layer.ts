// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type CompositeLayerProps} from '@deck.gl/core';
import {ZoomableTextLayer} from '../common-layers/zoomable-text-layer/zoomable-text-layer';

import type {EdgeInterface} from '../../graph/graph';
import type {GraphStylesheetEngine} from '../../style/graph-style-engine';
import type {EdgeLayoutAccessor} from '../edge-layer';

/** Props for the {@link EdgeLabelLayer} composite layer. */
export type EdgeLabelLayerProps = CompositeLayerProps & {
  /** Graph edges to annotate with text labels. */
  data: readonly EdgeInterface[];
  /** Accessor returning layout metadata for each edge. */
  getLayoutInfo: EdgeLayoutAccessor;
  /** Stylesheet engine that exposes Deck.gl accessors for label rendering. */
  stylesheet: GraphStylesheetEngine;
  /** Value used to invalidate cached positions when edge layout changes. */
  positionUpdateTrigger?: unknown;
};

export class EdgeLabelLayer extends CompositeLayer<EdgeLabelLayerProps> {
  static layerName = 'EdgeLabelLayer';

  renderLayers() {
    const {data, getLayoutInfo, positionUpdateTrigger = 0, stylesheet} = this.props;
    return [
      new ZoomableTextLayer(
        this.getSubLayerProps({
          id: 'edge-label-layer',
          data,
          getPosition: (e) => {
            const {sourcePosition, targetPosition, controlPoints = []} = getLayoutInfo(e);
            // consider all the points on this edge
            const allPoints = [sourcePosition, targetPosition, ...controlPoints];
            const sumX = allPoints.reduce((res, p) => res + p[0], 0);
            const sumY = allPoints.reduce((res, p) => res + p[1], 0);
            // find the centroid of those points
            return [sumX / allPoints.length, sumY / allPoints.length];
          },
          getAngle: (e) => {
            const {sourcePosition, targetPosition} = getLayoutInfo(e);
            // sort the nodes from left to right
            const [newSourcePosition, newTargetPosition] =
              sourcePosition[0] < targetPosition[0]
                ? [sourcePosition, targetPosition]
                : [targetPosition, sourcePosition];
            // angle in degrees
            const deltaX = newTargetPosition[0] - newSourcePosition[0];
            const deltaY = newTargetPosition[1] - newSourcePosition[1];
            return (Math.atan2(deltaY, deltaX) * -180) / Math.PI;
          },
          ...stylesheet.getDeckGLAccessors(),
          updateTriggers: {
            ...stylesheet.getDeckGLUpdateTriggers(),
            getPosition: positionUpdateTrigger
          }
        })
      )
    ];
  }
}
