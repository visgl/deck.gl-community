// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {
  Point,
  LineString,
  Polygon,
  MultiPoint,
  MultiLineString,
  MultiPolygon,
  Position,
  Feature,
  FeatureCollection,
} from 'geojson';

export { Point, LineString, Polygon, MultiPoint, MultiLineString, MultiPolygon, Position, Feature, FeatureCollection };

/** Simple geometries (excludes GeometryCollection) */
export type SimpleGeometry = Point | LineString | Polygon | MultiPoint | MultiLineString | MultiPolygon;

/** Feature with any geometry except GeometryCollection */
export type SimpleFeature = Feature<SimpleGeometry>

/** FeatureCollection with any geometries except GeometryCollection */
export type SimpleFeatureCollection = FeatureCollection<SimpleGeometry>

/** Coordinates of any geometry except GeometryCollection */
export type SimpleGeometryCoordinates = SimpleGeometry['coordinates']

/** Polygon and MultiPolygon geometries */
export type PolygonGeometry = Polygon | MultiPolygon;

/** A Feature or FeatureCollection */
export type AnyGeoJson = Feature | FeatureCollection;
