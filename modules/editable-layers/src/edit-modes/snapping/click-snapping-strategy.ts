// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {ClickEvent, GuideFeatureCollection, ModeProps, MovementEvent} from '../types';
import {SimpleFeatureCollection} from '../../utils/geojson-types';
import {
  snapClickEventToPickedTarget,
  snapMovementEventToPickedTarget,
  getClosestSnapTargetHandle
} from './snapping-utils';
import {SnappingStrategy} from './snapping-strategy';

/**
 * Snapping strategy for draw modes (DrawPolygonMode, DrawLineStringMode, etc.).
 * Snapping is always active: the pointer freely snaps to the nearest target vertex as it moves, and clicks are snapped to picked targets.
 */
export class ClickSnappingStrategy implements SnappingStrategy {
  snapClickEvent(props: ModeProps<SimpleFeatureCollection>, event: ClickEvent): ClickEvent {
    return snapClickEventToPickedTarget(event, props, []);
  }

  snapMovementEvent<T extends MovementEvent>(
    props: ModeProps<SimpleFeatureCollection>,
    event: T
  ): T {
    return snapMovementEventToPickedTarget(event, props, []);
  }

  getSnapGuides(props: ModeProps<SimpleFeatureCollection>): GuideFeatureCollection {
    const snapTarget = getClosestSnapTargetHandle(props, new Set());
    return {
      type: 'FeatureCollection',
      features: snapTarget ? [snapTarget] : []
    };
  }
}
