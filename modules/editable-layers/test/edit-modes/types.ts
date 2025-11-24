// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable no-unused-vars, prefer-const */

import {
  Point,
  LineString,
  Polygon,
  MultiPolygon,
  Feature
} from '../../src/utils/geojson-types';

let point: Point = {
  type: 'Point',
  coordinates: [1, 2]
};

let lineString: LineString = {
  type: 'LineString',
  coordinates: [
    [1, 2],
    [3, 4]
  ]
};

let polygonSolid: Polygon = {
  type: 'Polygon',
  coordinates: [lineString.coordinates]
};

let polygonWithHole: Polygon = {
  type: 'Polygon',
  coordinates: [lineString.coordinates, lineString.coordinates]
};

let multiPolygon: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [polygonSolid.coordinates, polygonWithHole.coordinates]
};

let pointFeature: Feature<Point> = {
  type: 'Feature',
  geometry: point,
  properties: {}
};

let lineStringFeature: Feature<LineString> = {
  type: 'Feature',
  geometry: lineString,
  properties: {}
};

let anyFeature: Feature = {
  type: 'Feature',
  geometry: multiPolygon,
  properties: {}
};

if (Math.random() > 0.5) {
  anyFeature = pointFeature;
} else {
  anyFeature = lineStringFeature;
}

const anyGeometry = anyFeature.geometry;
if (anyGeometry.type === 'LineString') {
  lineStringFeature.geometry = anyGeometry;
}

if (anyGeometry.type === 'Point') {
  // @ts-expect-error TODO
  lineStringFeature.geometry = anyGeometry;
}
