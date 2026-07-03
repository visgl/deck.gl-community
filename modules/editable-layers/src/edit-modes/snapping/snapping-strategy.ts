// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {FeatureCollection} from '../../utils/geojson-types';
import {ClickEvent, GuideFeatureCollection, ModeProps, MovementEvent} from '../types';

/**
 * Encapsulates the snapping policy for a single edit mode.
 *
 * Each method is called by SnappableMode at the appropriate point in its
 * event pipeline.
 */
export interface SnappingStrategy {
  /**
   * Return the click event with snapped coordinates applied, or the original
   * event unchanged if snapping does not apply.
   */
  snapClickEvent(props: ModeProps<FeatureCollection>, event: ClickEvent): ClickEvent;

  /**
   * Return the movement event with snapped coordinates applied, or the original
   * event unchanged if snapping does not apply.
   */
  snapMovementEvent<T extends MovementEvent>(props: ModeProps<FeatureCollection>, event: T): T;

  /**
   * Returns the snapping guides for this snapping strategy.
   */
  getSnapGuides(props: ModeProps<FeatureCollection>): GuideFeatureCollection;
}
