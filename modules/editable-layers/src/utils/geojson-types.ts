// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Geometry types

import {
  Point as PointGeo,
  LineString as LineStringGeo,
  Polygon as PolygonGeo,
  MultiPoint as MultiPointGeo,
  MultiLineString as MultiLineStringGeo,
  MultiPolygon as MultiPolygonGeo,
  Position as PositionGeo,
} from 'geojson';

export type Position = PositionGeo;
export type PointCoordinates = Position;
export type LineStringCoordinates = Position[];
export type PolygonCoordinates = Position[][];
export type MultiPointCoordinates = Position[];
export type MultiLineStringCoordinates = Position[][];
export type MultiPolygonCoordinates = Position[][][];

export type AnyCoordinates =
  | PointCoordinates
  | LineStringCoordinates
  | PolygonCoordinates
  | MultiPointCoordinates
  | MultiLineStringCoordinates
  | MultiPolygonCoordinates;

export type Point = PointGeo;

export type LineString = LineStringGeo;

export type Polygon = PolygonGeo;

export type MultiPoint = MultiPointGeo;

export type MultiLineString = MultiLineStringGeo;

export type MultiPolygon = MultiPolygonGeo;

export type Geometry = Point | LineString | Polygon | MultiPoint | MultiLineString | MultiPolygon;

export type Polygonal = Polygon | MultiPolygon;

// Feature types

export type BoundingBoxArray = [number, number, number, number];

export type FeatureOf<T extends Geometry> = {
  type: 'Feature';
  geometry: T;
  properties?: {
    [key: string]: any;
  };
  id?: string | number;
  bbox?: BoundingBoxArray;
};

export type FeatureWithProps<T extends Geometry, P> = {
  type: 'Feature';
  geometry: T;
  properties: P;
};

export type Feature =
  | FeatureOf<Point>
  | FeatureOf<LineString>
  | FeatureOf<Polygon>
  | FeatureOf<MultiPoint>
  | FeatureOf<MultiLineString>
  | FeatureOf<MultiPolygon>;

export type FeatureCollection = {
  type: 'FeatureCollection';
  features: Feature[];
  properties?: {};
  id?: string | number;
  bbox?: BoundingBoxArray;
};

export type AnyGeoJson = Feature | FeatureCollection;
