// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  ClickEvent,
  EditHandleFeature,
  GuideFeatureCollection,
  ModeProps,
  MovementEvent
} from '../types';
import {SimpleFeatureCollection, SimpleFeature} from '../../utils/geojson-types';
import {
  getPickedSnapSourceEditHandle,
  snapMovementEventToPickedTarget,
  getSelectedFeatureSnapSourceGuides,
  getSnapTargetHandles
} from './snapping-utils';
import {SnappingStrategy} from './snapping-strategy';

/**
 * The user initiates a snap by dragging from a snap-source handle on a selected feature.
 * The picked snap-source handle snaps onto a target if nearby.
 * Click events are never snapped — only drag movement applies snapping.
 */
export class SourceSnappingStrategy implements SnappingStrategy {
  snapClickEvent(_props: ModeProps<SimpleFeatureCollection>, event: ClickEvent): ClickEvent {
    return event;
  }

  snapMovementEvent<T extends MovementEvent>(
    props: ModeProps<SimpleFeatureCollection>,
    event: T
  ): T {
    const snapSource = getPickedSnapSourceEditHandle(props.lastPointerMoveEvent?.pointerDownPicks);

    if (!snapSource) {
      return event;
    }

    return {
      ...snapMovementEventToPickedTarget(event, props, props.selectedIndexes),
      pointerDownMapCoords: snapSource.geometry.coordinates
    };
  }

  getSnapGuides(props: ModeProps<SimpleFeatureCollection>): GuideFeatureCollection {
    const snapSourceHandle = getPickedSnapSourceEditHandle(
      props.lastPointerMoveEvent?.pointerDownPicks
    );
    if (snapSourceHandle) {
      return {
        type: 'FeatureCollection',
        features: [
          ...getSnapTargetHandles(props, props.selectedIndexes),
          this._getUpdatedSnapSourceHandle(snapSourceHandle, props.data)
        ]
      };
    }
    return {type: 'FeatureCollection', features: getSelectedFeatureSnapSourceGuides(props)};
  }

  /**
   * Updates the snap-source handle coordinates to reflect the current position of the
   * vertex in the data (the feature may have moved since the handle was generated).
   */
  _getUpdatedSnapSourceHandle(
    snapSourceHandle: EditHandleFeature,
    data: SimpleFeatureCollection
  ): EditHandleFeature {
    const {featureIndex, positionIndexes} = snapSourceHandle.properties;
    if (!Array.isArray(positionIndexes)) {
      return snapSourceHandle;
    }
    const snapSourceFeature = data.features[featureIndex] as SimpleFeature;
    if (!snapSourceFeature) {
      return snapSourceHandle;
    }
    const snapSourceCoordinates = positionIndexes.reduce(
      (coords: any[], index: number) => coords[index],
      snapSourceFeature.geometry.coordinates
    );
    return {
      ...snapSourceHandle,
      geometry: {type: 'Point', coordinates: snapSourceCoordinates}
    };
  }
}
