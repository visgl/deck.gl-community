// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {SimpleFeatureCollection, Position} from '../../utils/geojson-types';
import {BasePointerEvent, ModeProps} from '../types';

/** A chosen position; external targets omit the editable-layer feature index. */
export interface SnapResult {
  /** Snapped coordinates in the editable data's local frame, before its model matrix. */
  mapCoords: Position;
  /** Index in props.data.features, or omitted for external/custom targets. */
  featureIndex?: number;
}

/**
 * Represents the calculation to determine the appropriate snapping point for a given coordinate.
 * Can be overridden to allow custom snapping for different use cases which might have specific requirements around for example optimisation.
 */
export interface Snapper {
  /**
   * Uses the raw current event to choose a target; return null when no target qualifies.
   * excludedFeatureIndexes identifies editable-layer features that must not be targets.
   * Implementations must preserve the input event, props and exclusion set.
   */
  snap(
    event: BasePointerEvent,
    props: ModeProps<SimpleFeatureCollection>,
    excludedFeatureIndexes: Set<number>
  ): SnapResult | null;
}
