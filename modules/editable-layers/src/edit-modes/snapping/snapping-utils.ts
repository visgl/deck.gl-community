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
  SimpleGeometry,
  Position
} from '../../utils/geojson-types';
import {
  getPickedEditHandle,
  getPickedEditHandles,
  getEditHandlesForGeometry,
  toWebMercatorViewport,
  distance2d,
  findNearestPointOnGeometry,
  nearestPointOnProjectedLine,
  NearestPointType
} from '../utils';
import WebMercatorViewport from '@math.gl/web-mercator';
import {lineString, point} from '@turf/helpers';
import {cartesianCoordinateSystem} from '../coordinate-system';

type EdgeSnapCandidate = NearestPointType & {
  index: number;
  screenDistance: number;
};

/**
 * Returns the feature index of the edit handle currently being dragged, or
 * undefined when no handle is being dragged.
 */
export function getDraggedEditHandleFeatureIndex(
  props: ModeProps<SimpleFeatureCollection>,
  event?: MovementEvent
): number | undefined {
  const handle = getPickedEditHandle(getPointerDownPicksForEvent(props, event));
  return handle?.properties.featureIndex;
}

/** Uses current lifecycle picks when present; explicit null clears stale cached picks. */
export function getPointerDownPicksForEvent(
  props: ModeProps<SimpleFeatureCollection>,
  event?: MovementEvent
): Pick[] | null | undefined {
  return event?.pointerDownPicks !== undefined
    ? event.pointerDownPicks
    : props.lastPointerMoveEvent?.pointerDownPicks;
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
  if (!props?.modeConfig?.viewport) return getPickedSnapTargetEditHandle(event.picks) ?? undefined;
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
  const project = props.projection?.project ?? (position => wmViewport.project(position));
  const unproject = props.projection?.unproject ?? (position => wmViewport.unproject(position));
  const edgeSnap = findNearestPointOnGeometry(
    feature as SimpleFeature,
    props.lastPointerMoveEvent.mapCoords,
    props.modeConfig.viewport,
    props.coordinateSystem,
    line => {
      const projected = lineString(
        line.geometry.coordinates.map(([x, y, z = 0]) => project([x, y, z]))
      );
      const nearest = nearestPointOnProjectedLine(
        projected,
        point(props.lastPointerMoveEvent.screenCoords),
        wmViewport,
        cartesianCoordinateSystem
      );
      const coordinates = unproject(nearest.geometry.coordinates);
      if (!coordinates || !coordinates.every(Number.isFinite)) {
        nearest.properties.dist = Infinity;
        return nearest;
      }
      nearest.geometry.coordinates = line.geometry.coordinates.some(coords => coords.length > 2)
        ? coordinates
        : coordinates.slice(0, 2);
      return nearest;
    }
  );
  if (!edgeSnap.nearestPoint || !Number.isFinite(edgeSnap.nearestPoint.properties.dist)) {
    return undefined;
  }
  const [cx, cy] = props.lastPointerMoveEvent.screenCoords;
  const [px, py] = project(edgeSnap.nearestPoint.geometry.coordinates);
  const dist = distance2d(cx, cy, px, py);
  return dist <= props.pickingRadius
    ? {...edgeSnap.nearestPoint, index: featureIndex, screenDistance: dist}
    : undefined;
}

function getFeatures(props: ModeProps<SimpleFeatureCollection>): Feature[] {
  const additionalSnapTargets = props.modeConfig?.additionalSnapTargets || [];
  return [...props.data.features, ...additionalSnapTargets];
}

/**
 * Builds the full list of snap-target edit handles for all non-excluded features,
 * including edge-snap candidates when edgeSnapping is enabled.
 */
export function getSnapTargetHandles(
  props: ModeProps<SimpleFeatureCollection>,
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
      if (!feature.geometry || feature.geometry.type === 'GeometryCollection') continue;
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
 * Target coordinates, including additional features, must use the editable data's local frame.
 * Returns the single snap-target handle closest to the pointer within picking radius,
 * or undefined when none qualifies.
 */
export function getClosestSnapTargetHandle(
  props: ModeProps<SimpleFeatureCollection>,
  excludedFeatureIndexes: number[]
): EditHandleFeature | undefined {
  const screenCoords = props.lastPointerMoveEvent?.screenCoords;
  const {pickingRadius} = props;
  const viewport = props.modeConfig?.viewport;
  if (!screenCoords || !viewport || pickingRadius === undefined) {
    return undefined;
  }
  const wmViewport = toWebMercatorViewport(viewport);
  const [cx, cy] = screenCoords;
  if (!Number.isFinite(pickingRadius) || pickingRadius < 0) return undefined;
  let closestCoordinates: Position | undefined;
  let closestFeatureIndex = -1;
  let closestPositionIndexes: number[] = [];
  let minDist = Infinity;
  const excluded = new Set(excludedFeatureIndexes);
  const additional = props.modeConfig?.additionalSnapTargets || [];
  const dataCount = props.data.features.length;

  for (let i = 0; i < dataCount + additional.length; i++) {
    if (excluded.has(i)) continue;
    const feature = i < dataCount ? props.data.features[i] : additional[i - dataCount];
    if (!feature?.geometry || feature.geometry.type === 'GeometryCollection') continue;
    const geometry = feature.geometry as SimpleGeometry;
    const path: number[] = [];
    const visit = (coordinates: any[]) => {
      if (typeof coordinates[0] === 'number') {
        const [px, py] = props.projection?.project(coordinates) ?? wmViewport.project(coordinates);
        const dist = distance2d(cx, cy, px, py);
        if (dist <= pickingRadius && dist < minDist) {
          closestCoordinates = coordinates;
          closestFeatureIndex = i;
          closestPositionIndexes = [...path];
          minDist = dist;
        }
        return;
      }
      const ring =
        (geometry.type === 'Polygon' && path.length === 1) ||
        (geometry.type === 'MultiPolygon' && path.length === 2);
      const length = coordinates.length - (ring ? 1 : 0);
      for (let j = 0; j < length; j++) {
        path.push(j);
        visit(coordinates[j]);
        path.pop();
      }
    };
    visit(geometry.coordinates);
    if (props.modeConfig?.edgeSnapping) {
      const edge = findEdgeSnapCandidateForFeature(feature, i, props, wmViewport);
      if (edge && edge.screenDistance < minDist) {
        closestCoordinates = edge.geometry.coordinates;
        closestFeatureIndex = i;
        closestPositionIndexes = [];
        minDist = edge.screenDistance;
      }
    }
  }
  // Allocate a guide only for the winning candidate, rather than for every vertex.
  return closestCoordinates
    ? {
        type: 'Feature',
        geometry: {type: 'Point', coordinates: closestCoordinates},
        properties: {
          guideType: 'editHandle',
          editHandleType: 'snap-target',
          featureIndex: closestFeatureIndex,
          positionIndexes: closestPositionIndexes
        }
      }
    : undefined;
}
