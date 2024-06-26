// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import bboxPolygon from '@turf/bbox-polygon';
import {Position, Polygon, FeatureOf} from '../utils/geojson-types';
import {TwoClickPolygonMode} from './two-click-polygon-mode';

export class DrawRectangleMode extends TwoClickPolygonMode {
  getTwoClickPolygon(coord1: Position, coord2: Position, modeConfig: any): FeatureOf<Polygon> {
    const rectangle = bboxPolygon([coord1[0], coord1[1], coord2[0], coord2[1]]);
    rectangle.properties = rectangle.properties || {};
    rectangle.properties.shape = 'Rectangle';

    // @ts-expect-error turf typing too wide
    return rectangle;
  }
}
