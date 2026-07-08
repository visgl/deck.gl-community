// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {ClickEvent, EditHandleFeature, ModeProps, MovementEvent, Pick} from '../types';
import {Feature, FeatureCollection, SimpleFeature, SimpleGeometry} from '../../utils/geojson-types';
import {
  getPickedEditHandle,
  getPickedEditHandles,
  getEditHandlesForGeometry,
  toWebMercatorViewport,
  distance2d,
  findNearestPointOnGeometry,
  NearestPointType
} from '../utils';
import WebMercatorViewport from '@math.gl/web-mercator';

type EdgeSnapCandidate = NearestPointType & {
  index: number;
  screenDistance: number;
};

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

/**
 * Finds the nearest point on the edge of a single feature to the pointer,
 * returning it as an EdgeSnapCandidate when within picking radius.
 */
export function findEdgeSnapCandidateForFeature(
  feature: Feature,
  featureIndex: number,
  props: ModeProps<FeatureCollection>,
  wmViewport: WebMercatorViewport
): EdgeSnapCandidate | undefined {
  const edgeSnap = findNearestPointOnGeometry(
    feature as SimpleFeature,
    props.lastPointerMoveEvent.mapCoords,
    props.modeConfig.viewport,
    props.coordinateSystem
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

function getFeatures(props: ModeProps<FeatureCollection>): Feature[] {
  const additionalSnapTargets = props.modeConfig?.additionalSnapTargets || [];
  return [...props.data.features, ...additionalSnapTargets];
}

/**
 * Builds the full list of snap-target edit handles for all non-excluded features,
 * including edge-snap candidates when edgeSnapping is enabled.
 */
export function getSnapTargetHandles(
  props: ModeProps<FeatureCollection>,
  excludedFeatureIndexes: number[]
): EditHandleFeature[] {
  const handles: EditHandleFeature[] = [];
  const edgeSnapCandidates: EdgeSnapCandidate[] = [];
  const features = getFeatures(props);
  const wmViewport = props.modeConfig?.viewport
    ? toWebMercatorViewport(props.modeConfig.viewport)
    : undefined;

  for (let i = 0; i < features.length; i++) {
    if (!excludedFeatureIndexes.includes(i)) {
      const feature = features[i];
      handles.push(
        ...getEditHandlesForGeometry(feature.geometry as SimpleGeometry, i, 'snap-target')
      );
      if (props.modeConfig?.edgeSnapping && wmViewport) {
        const candidate = findEdgeSnapCandidateForFeature(feature, i, props, wmViewport);
        if (candidate) {
          edgeSnapCandidates.push(candidate);
        }
      }
    }
  }

  if (edgeSnapCandidates.length > 0) {
    const closestEdgeSnap = edgeSnapCandidates.reduce(
      (closest, snap) => (snap.screenDistance < closest.screenDistance ? snap : closest),
      edgeSnapCandidates[0]
    );
    handles.push(
      ...getEditHandlesForGeometry(closestEdgeSnap.geometry, closestEdgeSnap.index, 'snap-target')
    );
  }

  return handles;
}

/**
 * Returns the single snap-target handle closest to the pointer within picking radius,
 * or undefined when none qualifies.
 */
export function getClosestSnapTargetHandle(
  props: ModeProps<FeatureCollection>,
  excludedFeatureIndexes: number[]
): EditHandleFeature | undefined {
  const screenCoords = props.lastPointerMoveEvent?.screenCoords;
  const {pickingRadius, modeConfig: {viewport} = {}} = props;
  if (!screenCoords || !viewport || pickingRadius === undefined) {
    return undefined;
  }
  const wmViewport = toWebMercatorViewport(viewport);
  const [cx, cy] = screenCoords;
  let closest: EditHandleFeature | undefined;
  let minDist = Infinity;
  for (const handle of getSnapTargetHandles(props, excludedFeatureIndexes)) {
    const [px, py] = wmViewport.project(handle.geometry.coordinates);
    const dist = distance2d(cx, cy, px, py);
    if (dist <= pickingRadius && dist < minDist) {
      closest = handle;
      minDist = dist;
    }
  }
  return closest;
}
