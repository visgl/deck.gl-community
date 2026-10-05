// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  getPickedEditHandle,
  getEditHandlesForGeometry,
  ImmutableFeatureCollection
} from '@deck.gl-community/editable-layers';
import type {
  Color,
  Viewport,
  Pick,
  SimpleFeature,
  SimpleFeatureCollection,
  SimpleGeometry,
  SimpleGeometryCoordinates,
  PolygonGeometry
} from '@deck.gl-community/editable-layers';
import type {
  Position,
  Point,
  LineString,
  Polygon,
  MultiPoint,
  MultiLineString,
  MultiPolygon,
  Feature,
  FeatureCollection
} from 'geojson';

// Standard GeoJSON imports retain geometry and application-property generics.
const position: Position = [0, 0];
const point: Point = {type: 'Point', coordinates: position};
const feature: Feature<Point, {name: string}> = {
  type: 'Feature',
  geometry: point,
  properties: {name: 'editable point'}
};
const geoJsonData: FeatureCollection<Point, {name: string}> = {
  type: 'FeatureCollection',
  features: [feature]
};
const data: SimpleFeatureCollection = geoJsonData;
const simpleFeature: SimpleFeature = feature;
const geometry: SimpleGeometry = point;
const coordinates: SimpleGeometryCoordinates = position;
const polygon: PolygonGeometry = {type: 'Polygon', coordinates: [[position]]};
const otherGeometries: (LineString | Polygon | MultiPoint | MultiLineString | MultiPolygon)[] = [
  polygon
];
const color: Color = [255, 0, 0, 255];
const viewport: Viewport = {width: 1, height: 1, longitude: 0, latitude: 0, zoom: 1};
const immutableData = new ImmutableFeatureCollection(data).getObject();
const handles = getEditHandlesForGeometry(geometry, 0);
const picks: Pick[] = [];
const pickedHandle = getPickedEditHandle(picks);
void [
  simpleFeature,
  coordinates,
  otherGeometries,
  color,
  viewport,
  immutableData,
  handles,
  pickedHandle
];

// The public entry point must not reintroduce upstream aliases or implementation helpers.
// @ts-expect-error Import Position from 'geojson'.
import type {Position as RemovedPosition} from '@deck.gl-community/editable-layers';
// @ts-expect-error Import Point from 'geojson'.
import type {Point as RemovedPoint} from '@deck.gl-community/editable-layers';
// @ts-expect-error Import LineString from 'geojson'.
import type {LineString as RemovedLineString} from '@deck.gl-community/editable-layers';
// @ts-expect-error Import Polygon from 'geojson'.
import type {Polygon as RemovedPolygon} from '@deck.gl-community/editable-layers';
// @ts-expect-error Import MultiPoint from 'geojson'.
import type {MultiPoint as RemovedMultiPoint} from '@deck.gl-community/editable-layers';
// @ts-expect-error Import MultiLineString from 'geojson'.
import type {MultiLineString as RemovedMultiLineString} from '@deck.gl-community/editable-layers';
// @ts-expect-error Import MultiPolygon from 'geojson'.
import type {MultiPolygon as RemovedMultiPolygon} from '@deck.gl-community/editable-layers';
// @ts-expect-error Import Feature from 'geojson'.
import type {Feature as RemovedFeature} from '@deck.gl-community/editable-layers';
// @ts-expect-error Import FeatureCollection from 'geojson'.
import type {FeatureCollection as RemovedFeatureCollection} from '@deck.gl-community/editable-layers';
// @ts-expect-error AnyGeoJson is not an editable data contract.
import type {AnyGeoJson as RemovedAnyGeoJson} from '@deck.gl-community/editable-layers';
// @ts-expect-error Style is an obsolete type with no editing API.
import type {Style as RemovedStyle} from '@deck.gl-community/editable-layers';
// @ts-expect-error Generic color conversion is an application concern.
import {toDeckColor as removedToDeckColor} from '@deck.gl-community/editable-layers';
// @ts-expect-error The legacy utils namespace is internal.
import {utils as removedUtils} from '@deck.gl-community/editable-layers';
// @ts-expect-error Memoization is an implementation detail.
import {_memoize as removedMemoize} from '@deck.gl-community/editable-layers';

type RemovedTypes = [
  RemovedPosition,
  RemovedPoint,
  RemovedLineString,
  RemovedPolygon,
  RemovedMultiPoint,
  RemovedMultiLineString,
  RemovedMultiPolygon,
  RemovedFeature,
  RemovedFeatureCollection,
  RemovedAnyGeoJson,
  RemovedStyle
];
void (null as unknown as RemovedTypes);
void [removedToDeckColor, removedUtils, removedMemoize];
