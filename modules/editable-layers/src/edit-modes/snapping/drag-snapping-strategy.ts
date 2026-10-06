// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {ClickEvent, GuideFeatureCollection, ModeProps, MovementEvent} from '../types';
import {SimpleFeatureCollection} from '../../utils/geojson-types';
import {getPickedEditHandle} from '../utils';
import {
  getDraggedEditHandleFeatureIndex,
  getPointerDownPicksForEvent,
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
  snapClickEvent(props: ModeProps<SimpleFeatureCollection>, event: ClickEvent): ClickEvent {
    if (!getPickedEditHandle(props.lastPointerMoveEvent?.pointerDownPicks)) return event;
    return snapClickEventToPickedTarget(
      event,
      props,
      getDraggedEditHandleFeatureIndex(props) !== undefined
        ? [getDraggedEditHandleFeatureIndex(props)]
        : []
    );
  }

  snapMovementEvent<T extends MovementEvent>(
    props: ModeProps<SimpleFeatureCollection>,
    event: T
  ): T {
    if (!getPickedEditHandle(getPointerDownPicksForEvent(props, event))) return event;
    const draggedIndex = getDraggedEditHandleFeatureIndex(props, event);
    return snapMovementEventToPickedTarget(
      event,
      props,
      draggedIndex !== undefined ? [draggedIndex] : []
    );
  }

  getSnapGuides(props: ModeProps<SimpleFeatureCollection>): GuideFeatureCollection {
    if (!getPickedEditHandle(props.lastPointerMoveEvent?.pointerDownPicks)) {
      return {type: 'FeatureCollection', features: []};
    }
    const draggedIndex = getDraggedEditHandleFeatureIndex(props);
    const excludedFeatureIndexes = draggedIndex !== undefined ? [draggedIndex] : [];
    const snapTarget = getClosestSnapTargetHandle(props, excludedFeatureIndexes);
    return {
      type: 'FeatureCollection',
      features: snapTarget ? [snapTarget] : []
    };
  }
}
