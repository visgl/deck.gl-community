// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {coordEach} from '@turf/meta';
import {FeatureCollection, Position, SimpleFeature} from '../../utils/geojson-types';
import {BasePointerEvent, ModeProps} from '../types';
import {Snapper, SnapResult} from './snapper';
import {getFeatures} from './snapping-utils';
import {findNearestPointOnGeometry, toWebMercatorViewport} from '../utils';

export class DefaultSnapper implements Snapper {
  snap(
    event: BasePointerEvent,
    props: ModeProps<FeatureCollection>,
    excludedFeatureIndexes: Set<number>
  ): SnapResult | null {
    if (props.pickingRadius === undefined || props.modeConfig.viewport === undefined) {
      return null;
    }

    const wmViewport = toWebMercatorViewport(props.modeConfig.viewport);

    const features = getFeatures(props);
    const snappingRadiusSquared = props.pickingRadius ** 2;

    let closestSnapPoint: Position | null = null;
    let closestDistanceSquared = Infinity;
    let featureIndex: number | undefined = undefined;

    const eventScreenCoords = event.screenCoords;
    // Note we can't trust the event.mapCoords because they might have been mutated by previous snap event.
    const eventMapCoordsFromScreen = wmViewport.unproject(eventScreenCoords);

    for (let i = 0; i < features.length; i++) {
      if (excludedFeatureIndexes.has(i)) {
        continue;
      }

      const feature = features[i] as SimpleFeature | undefined;
      if (!feature?.geometry) {
        continue;
      }

      const candidateCoords: Position[] = [];

      if (feature.geometry.type === 'Point') {
        candidateCoords.push(feature.geometry.coordinates);
      } else if (props.modeConfig?.edgeSnapping) {
        const nearestPointCoords = findNearestPointOnGeometry(
          feature,
          eventMapCoordsFromScreen,
          wmViewport,
          props.coordinateSystem
        ).nearestPoint?.geometry.coordinates;

        if (nearestPointCoords) {
          candidateCoords.push(nearestPointCoords);
        }
      } else {
        coordEach(
          feature,
          currentCoord => {
            candidateCoords.push(currentCoord);
          },
          true
        );
      }

      for (const candidateCoord of candidateCoords) {
        const candidateScreenCoords = wmViewport.project(candidateCoord);
        const dx = candidateScreenCoords[0] - eventScreenCoords[0];
        const dy = candidateScreenCoords[1] - eventScreenCoords[1];
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared <= snappingRadiusSquared && distanceSquared < closestDistanceSquared) {
          closestSnapPoint = candidateCoord;
          closestDistanceSquared = distanceSquared;
          featureIndex = i;
        }
      }
    }

    if (closestSnapPoint) {
      return {
        mapCoords: closestSnapPoint,
        featureIndex: featureIndex < props.data.features.length ? featureIndex : undefined
      };
    }

    return null;
  }
}

export const DEFAULT_SNAPPER = new DefaultSnapper();
