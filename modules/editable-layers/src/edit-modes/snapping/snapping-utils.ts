// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  ClickEvent,
  EditHandleFeature,
  ModeProps,
  MovementEvent,
  Pick,
  BasePointerEvent,
  PointerMoveEvent
} from '../types';
import {
  Feature,
  SimpleFeatureCollection,
  SimpleFeature,
  SimpleGeometry
} from '../../utils/geojson-types';
import {
  getPickedEditHandle,
  getPickedEditHandles,
  getEditHandlesForGeometry,
  distance2d,
  findNearestPointOnGeometry,
  nearestPointOnProjectedLine,
  NearestPointType
} from '../utils';
import WebMercatorViewport from '@math.gl/web-mercator';
import {lineString, point} from '@turf/helpers';
import {cartesianCoordinateSystem} from '../coordinate-system';
import {DEFAULT_SNAPPER} from './default-snapper';
import type {Snapper} from './snapper';

type EdgeSnapCandidate = NearestPointType & {
  index: number;
  screenDistance: number;
};

/**
 * Returns the feature index of the edit handle currently being dragged, or
 * undefined when no handle is being dragged.
 */
export function getDraggedEditHandleFeatureIndex(
  props: ModeProps<SimpleFeatureCollection>
): number | undefined {
  const handle = getPickedEditHandle(props.lastPointerMoveEvent?.pointerDownPicks);
  return handle?.properties.featureIndex;
}

/**
 * Returns snap-source edit handles for all currently selected features.
 */
export function getSelectedFeatureSnapSourceGuides(
  props: ModeProps<SimpleFeatureCollection>
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

/** Snaps a click to the current target and removes target picks before forwarding. */
export function snapClickEventToPickedTarget(
  event: ClickEvent,
  props?: ModeProps<SimpleFeatureCollection>,
  excludedFeatureIndexes: number[] = []
): ClickEvent {
  const snapTarget = getCurrentSnapTarget(event, props, excludedFeatureIndexes);
  const pickedTarget = getPickedSnapTargetEditHandle(event.picks);
  if (!snapTarget && !pickedTarget) return event;
  return {
    ...event,
    mapCoords: snapTarget?.geometry.coordinates ?? event.mapCoords,
    picks: event.picks.filter(p => p.object?.properties?.editHandleType !== 'snap-target')
  };
}

/** Snaps movement without modifying the raw event shared by other modes. */
export function snapMovementEventToPickedTarget<T extends MovementEvent>(
  event: T,
  props?: ModeProps<SimpleFeatureCollection>,
  excludedFeatureIndexes: number[] = []
): T {
  const snapTarget = getCurrentSnapTarget(event, props, excludedFeatureIndexes);
  return snapTarget ? {...event, mapCoords: snapTarget.geometry.coordinates} : event;
}

function getCurrentSnapTarget(
  event: BasePointerEvent,
  props: ModeProps<SimpleFeatureCollection> | undefined,
  excludedFeatureIndexes: number[]
): EditHandleFeature | undefined {
  if (!props?.modeConfig?.viewport && !props?.modeConfig?.snapper)
    return getPickedSnapTargetEditHandle(event.picks) ?? undefined;
  // Query the raw current position even before a guide has been rendered or picked.
  return getClosestSnapTargetHandle(
    {...props, lastPointerMoveEvent: {...props.lastPointerMoveEvent, ...event} as PointerMoveEvent},
    excludedFeatureIndexes
  );
}

/**
 * Finds the nearest point on the edge of a single feature to the pointer,
 * returning it as an EdgeSnapCandidate when within picking radius.
 */
export function findEdgeSnapCandidateForFeature(
  feature: Feature,
  featureIndex: number,
  props: ModeProps<SimpleFeatureCollection>,
  wmViewport: WebMercatorViewport
): EdgeSnapCandidate | undefined {
  const edgeSnap = findNearestPointOnGeometry(
    feature as SimpleFeature,
    props.lastPointerMoveEvent.mapCoords,
    props.modeConfig.viewport,
    props.coordinateSystem,
    line => {
      const projected = lineString(
        line.geometry.coordinates.map(([x, y, z = 0]) => wmViewport.project([x, y, z]))
      );
      const nearest = nearestPointOnProjectedLine(
        projected,
        point(props.lastPointerMoveEvent.screenCoords),
        wmViewport,
        cartesianCoordinateSystem
      );
      const coordinates = wmViewport.unproject(nearest.geometry.coordinates);
      nearest.geometry.coordinates = line.geometry.coordinates.some(coords => coords.length > 2)
        ? coordinates
        : coordinates.slice(0, 2);
      return nearest;
    }
  );
  if (!edgeSnap.nearestPoint) {
    return undefined;
  }
  const [cx, cy] = props.lastPointerMoveEvent.screenCoords;
  const [px, py] = wmViewport.project(edgeSnap.nearestPoint.geometry.coordinates);
  const dist = distance2d(cx, cy, px, py);
  return dist <= props.pickingRadius
    ? {...edgeSnap.nearestPoint, index: featureIndex, screenDistance: dist}
    : undefined;
}

export function getFeatures(props: ModeProps<SimpleFeatureCollection>): Feature[] {
  const additionalSnapTargets = props.modeConfig?.additionalSnapTargets || [];
  return [...props.data.features, ...additionalSnapTargets];
}

/**
 * Builds the full list of snap-target edit handles for all non-excluded features,
 * including edge-snap candidates when edgeSnapping is enabled.
 */
export function getSnapTargetHandles(
  props: ModeProps<SimpleFeatureCollection>,
  excludedFeatureIndexes: Set<number> | number[]
): EditHandleFeature[] {
  const excluded = new Set(excludedFeatureIndexes);
  const handles: EditHandleFeature[] = [];
  const customSnapper: Snapper | undefined = props.modeConfig?.snapper;
  // Custom policies own their targets, including source-handle translation.
  if (!customSnapper) {
    const features = getFeatures(props);
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      if (excluded.has(i) || !feature.geometry || feature.geometry.type === 'GeometryCollection')
        continue;
      handles.push(
        ...getEditHandlesForGeometry(
          feature.geometry as SimpleGeometry,
          i < props.data.features.length ? i : -1,
          'snap-target'
        )
      );
    }
  }
  if ((props.modeConfig?.edgeSnapping || customSnapper) && props.lastPointerMoveEvent) {
    const target = getClosestSnapTargetHandle(props, excluded);
    if (target) handles.push(target);
  }
  return handles;
}

/** Returns the policy's nearest target, preserving the identity of external features. */
export function getClosestSnapTargetHandle(
  props: ModeProps<SimpleFeatureCollection>,
  excludedFeatureIndexes: Set<number> | number[]
): EditHandleFeature | undefined {
  if (!props.lastPointerMoveEvent) return undefined;
  const snapper: Snapper = props.modeConfig?.snapper ?? DEFAULT_SNAPPER;
  const result = snapper.snap(props.lastPointerMoveEvent, props, new Set(excludedFeatureIndexes));
  if (!result) return undefined;
  return {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: result.mapCoords},
    properties: {
      guideType: 'editHandle',
      editHandleType: 'snap-target',
      featureIndex: result.featureIndex ?? -1
    }
  };
}
