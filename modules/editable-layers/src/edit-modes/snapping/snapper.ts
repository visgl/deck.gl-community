// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {FeatureCollection, Position} from '../../utils/geojson-types';
import {BasePointerEvent, ModeProps} from '../types';

export interface SnapResult {
  mapCoords: Position;
  featureIndex?: number;
}

/**
 * Represents the calculation to determine the appropriate snapping point for a given coordinate.
 * Can be overridden to allow custom snapping for different use cases which might have specific requirements around for example optimisation.
 */
export interface Snapper {
  /**
   * Snaps the given event to the nearest snapping point based on the provided candidate features.
   */
  snap(
    event: BasePointerEvent,
    props: ModeProps<FeatureCollection>,
    excludedFeatureIndexes: Set<number>
  ): SnapResult | null;
}
