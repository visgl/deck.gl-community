// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {coordEach} from '@turf/meta';
import {SimpleFeatureCollection, Position} from '../../utils/geojson-types';
import {BasePointerEvent, ModeProps} from '../types';
import {Snapper, SnapResult} from './snapper';
import {getFeatures, findEdgeSnapCandidateForFeature} from './snapping-utils';
import {toWebMercatorViewport} from '../utils';

/** Finds the nearest vertex or bounded edge point in current viewport pixels. */
export class DefaultSnapper implements Snapper {
  /** Returns null when no supported target is within the layer's picking radius. */
  snap(
    event: BasePointerEvent,
    props: ModeProps<SimpleFeatureCollection>,
    excludedFeatureIndexes: Set<number>
  ): SnapResult | null {
    const radius = props.pickingRadius;
    const viewport = props.modeConfig?.viewport;
    if (!viewport || radius === undefined || radius < 0 || !Number.isFinite(radius)) return null;
    const wmViewport = toWebMercatorViewport(viewport);
    const features = getFeatures(props);
    const radiusSquared = radius ** 2;
    let closest: SnapResult | null = null;
    let closestDistanceSquared = Infinity;
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      if (
        excludedFeatureIndexes.has(i) ||
        !feature.geometry ||
        feature.geometry.type === 'GeometryCollection'
      )
        continue;
      const consider = (coordinates: Position) => {
        const projected = wmViewport.project(coordinates);
        const dx = projected[0] - event.screenCoords[0];
        const dy = projected[1] - event.screenCoords[1];
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared <= radiusSquared && distanceSquared < closestDistanceSquared) {
          closest = {
            mapCoords: coordinates,
            featureIndex: i < props.data.features.length ? i : undefined
          };
          closestDistanceSquared = distanceSquared;
        }
      };
      // MultiPoint has vertices but no connecting edges. Vertices remain eligible with edge snapping.
      coordEach(feature, consider, true);
      if (props.modeConfig?.edgeSnapping) {
        const candidate = findEdgeSnapCandidateForFeature(
          feature,
          i,
          {...props, lastPointerMoveEvent: {...props.lastPointerMoveEvent, ...event}},
          wmViewport
        );
        if (candidate) consider(candidate.geometry.coordinates);
      }
    }
    return closest;
  }
}

/** Shared stateless policy used when modeConfig.snapper is omitted. */
export const DEFAULT_SNAPPER = new DefaultSnapper();
