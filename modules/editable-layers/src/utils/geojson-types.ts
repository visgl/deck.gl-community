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

export type SingleGeometry = Point | LineString | Polygon | MultiPoint | MultiLineString | MultiPolygon;
export type GeometryFeature = Feature<SingleGeometry>
export type GeometryFeatureCollection = FeatureCollection<SingleGeometry>

export type AnyCoordinates = SingleGeometry['coordinates']

export type Polygonal = Polygon | MultiPolygon;

export { Feature, FeatureCollection } from 'geojson';

export type BoundingBoxArray = [number, number, number, number];
export type FeatureOf<T extends SingleGeometry> = Feature<T>;

export type FeatureWithProps<T extends SingleGeometry, P> = Feature<T, P>

export type AnyGeoJson = Feature | FeatureCollection;
