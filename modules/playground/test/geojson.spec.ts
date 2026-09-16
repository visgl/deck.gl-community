import {describe, expect, it} from 'vitest';

import {
  BBoxSchema,
  FeatureCollectionSchema,
  FeatureSchema,
  GeometryCollectionSchema,
  GeometrySchema,
  LineStringSchema,
  MultiLineStringSchema,
  MultiPointSchema,
  MultiPolygonSchema,
  PointSchema,
  PolygonSchema,
  PositionSchema
} from '../src/geojson';

describe('GeoJSON schemas', () => {
  it('validates positions and bounding boxes', () => {
    expect(PositionSchema.safeParse([-73.98, 40.75]).success).toBe(true);
    expect(PositionSchema.safeParse([-73.98, 40.75, 10]).success).toBe(true);
    expect(PositionSchema.safeParse([-73.98, 40.75, 10, 5]).success).toBe(true);
    expect(PositionSchema.safeParse([1]).success).toBe(false);
    expect(BBoxSchema.safeParse([0, 0, 1, 1]).success).toBe(true);
    expect(BBoxSchema.safeParse([0, 0, 0, 1, 1, 1]).success).toBe(true);
    expect(BBoxSchema.safeParse([0, 0, 0, 0, 1, 1, 1, 1]).success).toBe(true);
    expect(BBoxSchema.safeParse([0, 0, 1]).success).toBe(false);
  });

  it('validates every geometry shape', () => {
    const ring = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0]
    ];
    expect(PointSchema.safeParse({type: 'Point', coordinates: [0, 0]}).success).toBe(true);
    expect(
      LineStringSchema.safeParse({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1]
        ]
      }).success
    ).toBe(true);
    expect(PolygonSchema.safeParse({type: 'Polygon', coordinates: [ring]}).success).toBe(true);
    expect(MultiPointSchema.safeParse({type: 'MultiPoint', coordinates: []}).success).toBe(true);
    expect(
      MultiLineStringSchema.safeParse({
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [1, 1]
          ]
        ]
      }).success
    ).toBe(true);
    expect(
      MultiPolygonSchema.safeParse({type: 'MultiPolygon', coordinates: [[ring]]}).success
    ).toBe(true);
    expect(
      GeometryCollectionSchema.safeParse({
        type: 'GeometryCollection',
        geometries: [
          {type: 'Point', coordinates: [0, 0]},
          {type: 'GeometryCollection', geometries: []}
        ]
      }).success
    ).toBe(true);
    expect(GeometrySchema.safeParse({type: 'Unknown', coordinates: []}).success).toBe(false);
  });

  it('enforces line and polygon constraints', () => {
    expect(LineStringSchema.safeParse({type: 'LineString', coordinates: [[0, 0]]}).success).toBe(
      false
    );
    expect(
      PolygonSchema.safeParse({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1]
          ]
        ]
      }).success
    ).toBe(false);
    expect(
      MultiLineStringSchema.safeParse({type: 'MultiLineString', coordinates: [[[0, 0]]]}).success
    ).toBe(false);
  });

  it('validates features and feature collections', () => {
    expect(
      FeatureSchema.safeParse({
        type: 'Feature',
        geometry: null,
        properties: null,
        id: 'empty'
      }).success
    ).toBe(true);
    expect(
      FeatureCollectionSchema.safeParse({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {type: 'Point', coordinates: [0, 0]},
            properties: {name: 'origin'}
          }
        ]
      }).success
    ).toBe(true);
    expect(
      FeatureCollectionSchema.safeParse({
        type: 'FeatureCollection',
        features: [{type: 'Feature', geometry: {type: 'Point'}, properties: null}]
      }).success
    ).toBe(false);
  });

  it('preserves GeoJSON foreign members', () => {
    const result = FeatureCollectionSchema.parse({
      type: 'FeatureCollection',
      timestamp: '2026-09-16T00:00:00Z',
      features: []
    });
    expect(result).toMatchObject({timestamp: '2026-09-16T00:00:00Z'});
  });
});
