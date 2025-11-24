// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Geometry types

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

export { Point, LineString, Polygon, MultiPoint, MultiLineString, MultiPolygon, Position };

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

export { Feature, FeatureCollection } from 'geojson';

export type BoundingBoxArray = [number, number, number, number];
export type FeatureOf<T extends SimpleGeometry> = Feature<T>;

export type FeatureWithProps<T extends SimpleGeometry, P> = Feature<T, P>

export type AnyGeoJson = Feature | FeatureCollection;
