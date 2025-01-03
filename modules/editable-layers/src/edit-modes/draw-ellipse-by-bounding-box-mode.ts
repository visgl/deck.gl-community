// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import bboxPolygon from '@turf/bbox-polygon';
import distance from '@turf/distance';
import ellipse from '@turf/ellipse';
import {point} from '@turf/helpers';
import {Position, Polygon, FeatureOf} from '../utils/geojson-types';
import {getIntermediatePosition} from './geojson-edit-mode';
import {TwoClickPolygonMode} from './two-click-polygon-mode';

export class DrawEllipseByBoundingBoxMode extends TwoClickPolygonMode {
  getTwoClickPolygon(coord1: Position, coord2: Position, modeConfig: any): FeatureOf<Polygon> {
    const minX = Math.min(coord1[0], coord2[0]);
    const minY = Math.min(coord1[1], coord2[1]);
    const maxX = Math.max(coord1[0], coord2[0]);
    const maxY = Math.max(coord1[1], coord2[1]);

    const polygonPoints = bboxPolygon([minX, minY, maxX, maxY]).geometry.coordinates[0];
    const centerCoordinates = getIntermediatePosition(coord1, coord2);

    const xSemiAxis = Math.max(distance(point(polygonPoints[0]), point(polygonPoints[1])), 0.001);
    const ySemiAxis = Math.max(distance(point(polygonPoints[0]), point(polygonPoints[3])), 0.001);

    const geometry = ellipse(centerCoordinates, xSemiAxis, ySemiAxis);

    geometry.properties = geometry.properties || {};
    geometry.properties.editProperties = geometry.properties.editProperties || {};
    geometry.properties.editProperties.shape = 'Ellipse';
    geometry.properties.editProperties.xSemiAxis = {value: xSemiAxis, unit: 'kilometers'};
    geometry.properties.editProperties.ySemiAxis = {value: ySemiAxis, unit: 'kilometers'};
    geometry.properties.editProperties.angle = 0;
    geometry.properties.editProperties.center = centerCoordinates;
    // @ts-expect-error fix return types
    return geometry;
  }
}
