// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {ClickEvent, EditHandleFeature, ModeProps, MovementEvent, Pick} from '../types';
import {Feature, FeatureCollection, Point, SimpleGeometry} from '../../utils/geojson-types';
import {getPickedEditHandle, getPickedEditHandles, getEditHandlesForGeometry} from '../utils';
import {Snapper} from './snapper';
import {DEFAULT_SNAPPER} from './default-snapper';

/**
 * Returns the feature index of the edit handle currently being dragged, or
 * undefined when no handle is being dragged.
 */
export function getDraggedEditHandleFeatureIndex(
  props: ModeProps<FeatureCollection>
): number | undefined {
  const handle = getPickedEditHandle(props.lastPointerMoveEvent?.pointerDownPicks);
  return handle?.properties.featureIndex;
}

/**
 * Returns snap-source edit handles for all currently selected features.
 */
export function getSelectedFeatureSnapSourceGuides(
  props: ModeProps<FeatureCollection>
): EditHandleFeature[] {
  return props.selectedIndexes.flatMap(index => {
    const feature = props.data.features[index];
    return feature
      ? getEditHandlesForGeometry(feature.geometry as SimpleGeometry, index, 'snap-source')
      : [];
  });
}

export function getPickedSnapSourceEditHandle(
  picks: Pick[] | null | undefined
): EditHandleFeature | null | undefined {
  return getPickedEditHandles(picks).find(
    handle => handle.properties.editHandleType === 'snap-source'
  );
}

export function getPickedSnapTargetEditHandle(
  picks: Pick[] | null | undefined
): EditHandleFeature | null | undefined {
  return getPickedEditHandles(picks).find(
    handle => handle.properties.editHandleType === 'snap-target'
  );
}

/**
 * Snaps a click event to the picked snap-target handle, stripping the snap-target
 * pick(s) so the wrapped mode does not see it.
 */
export function snapClickEventToPickedTarget(event: ClickEvent): ClickEvent {
  const snapTarget = getPickedSnapTargetEditHandle(event.picks);

  if (!snapTarget) {
    return event;
  }

  return {
    ...event,
    mapCoords: snapTarget.geometry.coordinates,
    picks: event.picks.filter(p => p.object?.properties?.editHandleType !== 'snap-target')
  };
}

/**
 * Snaps a movement event to the picked snap-target handle.
 */
export function snapMovementEventToPickedTarget<T extends MovementEvent>(event: T): T {
  const snapTarget = getPickedSnapTargetEditHandle(event.picks);

  if (!snapTarget) {
    return event;
  }

  return Object.assign(event, {
    mapCoords: snapTarget.geometry.coordinates
  });
}

export function getFeatures(props: ModeProps<FeatureCollection>): Feature[] {
  const additionalSnapTargets = props.modeConfig?.additionalSnapTargets || [];
  return [...props.data.features, ...additionalSnapTargets];
}

/**
 * Builds the full list of snap-target edit handles for all non-excluded features,
 * including closest edge-snap candidate when edgeSnapping is enabled.
 */
export function getSnapTargetHandles(
  props: ModeProps<FeatureCollection>,
  excludedFeatureIndexes: Set<number>
): EditHandleFeature[] {
  const handles: EditHandleFeature[] = [];
  const features = getFeatures(props);

  for (let i = 0; i < features.length; i++) {
    if (!excludedFeatureIndexes.has(i)) {
      const feature = features[i];
      handles.push(
        ...getEditHandlesForGeometry(feature.geometry as SimpleGeometry, i, 'snap-target')
      );
    }
  }

  // Adds an extra snap-target handle for the nearest point on the edge of a feature, if within picking radius. Sometimes this might overlap with an existing snap-target handle, but that's okay.
  if (props.modeConfig?.edgeSnapping && props.lastPointerMoveEvent) {
    const snapper: Snapper = props.modeConfig?.snapper ?? DEFAULT_SNAPPER;
    const closestSnapPoint = snapper.snap(
      props.lastPointerMoveEvent,
      props,
      excludedFeatureIndexes
    );
    if (closestSnapPoint) {
      const closestSnapPointGeometry: Point = {
        type: 'Point',
        coordinates: closestSnapPoint.mapCoords
      };
      handles.push(
        ...getEditHandlesForGeometry(
          closestSnapPointGeometry,
          closestSnapPoint.featureIndex ?? -1,
          'snap-target'
        )
      );
    }
  }

  return handles;
}

/**
 * Returns the single snap-target handle closest to the pointer within picking radius,
 * or undefined when none qualifies.
 */
export function getClosestSnapTargetHandle(
  props: ModeProps<FeatureCollection>,
  excludedFeatureIndexes: Set<number>
): EditHandleFeature | undefined {
  if (!props.lastPointerMoveEvent) {
    return undefined;
  }

  const snapper: Snapper = props.modeConfig?.snapper ?? DEFAULT_SNAPPER;
  const closestSnapPoint = snapper.snap(props.lastPointerMoveEvent, props, excludedFeatureIndexes);
  if (closestSnapPoint) {
    return {
      type: 'Feature',
      properties: {
        guideType: 'editHandle',
        editHandleType: 'snap-target',
        featureIndex: closestSnapPoint.featureIndex ?? -1
      },
      geometry: {
        type: 'Point',
        coordinates: closestSnapPoint.mapCoords
      }
    };
  }
}
