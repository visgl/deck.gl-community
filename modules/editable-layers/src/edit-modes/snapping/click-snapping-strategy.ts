// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {ClickEvent, GuideFeatureCollection, ModeProps, MovementEvent} from '../types';
import {FeatureCollection} from '../../utils/geojson-types';
import {
  getDraggedEditHandleFeatureIndex,
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
  snapClickEvent(_props: ModeProps<FeatureCollection>, event: ClickEvent): ClickEvent {
    return snapClickEventToPickedTarget(event);
  }

  snapMovementEvent<T extends MovementEvent>(_props: ModeProps<FeatureCollection>, event: T): T {
    return snapMovementEventToPickedTarget(event);
  }

  getSnapGuides(props: ModeProps<FeatureCollection>): GuideFeatureCollection {
    const draggedIndex = getDraggedEditHandleFeatureIndex(props);
    const excludedFeatureIndexes = draggedIndex !== undefined ? [draggedIndex] : [];
    const snapTarget = getClosestSnapTargetHandle(props, excludedFeatureIndexes);
    return {
      type: 'FeatureCollection',
      features: snapTarget ? [snapTarget] : []
    };
  }
}
