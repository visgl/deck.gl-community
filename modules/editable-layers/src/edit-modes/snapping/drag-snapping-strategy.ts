// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {ClickEvent, GuideFeatureCollection, ModeProps, MovementEvent} from '../types';
import {FeatureCollection} from '../../utils/geojson-types';
import {getPickedEditHandle} from '../utils';
import {
  getDraggedEditHandleFeatureIndex,
  snapClickEventToPickedTarget,
  snapMovementEventToPickedTarget,
  getClosestSnapTargetHandle
} from './snapping-utils';
import {SnappingStrategy} from './snapping-strategy';

/**
 * Snapping only activates while an edit handle is being dragged.
 * Snap target guides are hidden when no snap-source has been picked.
 */
export class DragSnappingStrategy implements SnappingStrategy {
  snapClickEvent(_props: ModeProps<FeatureCollection>, event: ClickEvent): ClickEvent {
    return snapClickEventToPickedTarget(event);
  }

  snapMovementEvent<T extends MovementEvent>(_props: ModeProps<FeatureCollection>, event: T): T {
    return snapMovementEventToPickedTarget(event);
  }

  getSnapGuides(props: ModeProps<FeatureCollection>): GuideFeatureCollection {
    if (!getPickedEditHandle(props.lastPointerMoveEvent?.pointerDownPicks)) {
      return {type: 'FeatureCollection', features: []};
    }
    const draggedIndex = getDraggedEditHandleFeatureIndex(props);
    const excludedFeatureIndexes = draggedIndex !== undefined ? [draggedIndex] : [];
    const snapTarget = getClosestSnapTargetHandle(props, new Set(excludedFeatureIndexes));
    return {
      type: 'FeatureCollection',
      features: snapTarget ? [snapTarget] : []
    };
  }
}
