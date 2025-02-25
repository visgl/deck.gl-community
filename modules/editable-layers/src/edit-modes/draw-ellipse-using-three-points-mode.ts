// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import distance from '@turf/distance';
import ellipse from '@turf/ellipse';
import bearing from '@turf/bearing';
import {point} from '@turf/helpers';
import {Position, Polygon, FeatureOf} from '../utils/geojson-types';
import {getIntermediatePosition} from './geojson-edit-mode';
import {ThreeClickPolygonMode} from './three-click-polygon-mode';

export class DrawEllipseUsingThreePointsMode extends ThreeClickPolygonMode {
  getThreeClickPolygon(
    coord1: Position,
    coord2: Position,
    coord3: Position,
    modeConfig: any
  ): FeatureOf<Polygon> | null | undefined {
    const centerCoordinates = getIntermediatePosition(coord1, coord2);
    const xSemiAxis = Math.max(distance(centerCoordinates, point(coord3)), 0.001);
    const ySemiAxis = Math.max(distance(coord1, coord2), 0.001) / 2;
    const options = {angle: bearing(coord1, coord2)};
    // @ts-expect-error fix return types
    const geometry = ellipse(centerCoordinates, xSemiAxis, ySemiAxis, options);

    geometry.properties = geometry.properties || {};
    geometry.properties.editProperties = geometry.properties.editProperties || {};
    geometry.properties.editProperties.shape = 'Ellipse';
    geometry.properties.editProperties.xSemiAxis = {value: xSemiAxis, unit: 'kilometers'};
    geometry.properties.editProperties.ySemiAxis = {value: ySemiAxis, unit: 'kilometers'};
    geometry.properties.editProperties.angle = options.angle;
    geometry.properties.editProperties.center = centerCoordinates;
    // @ts-expect-error fix return types
    return geometry;
  }
}
