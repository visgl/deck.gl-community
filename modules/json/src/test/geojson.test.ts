// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';
import {
  BBoxSchema,
  PositionSchema,
  PointSchema,
  LineStringSchema,
  PolygonSchema,
  MultiPointSchema,
  MultiLineStringSchema,
  MultiPolygonSchema,
  GeometryCollectionSchema,
  GeometrySchema,
  FeatureSchema,
  FeatureCollectionSchema
} from '../geojson/index';

// ── BBox ─────────────────────────────────────────────────────────────────────

describe('BBoxSchema', () => {
  it('accepts 4-element bbox', () => {
    expect(BBoxSchema.safeParse([-180, -90, 180, 90]).success).toBe(true);
  });
  it('accepts 6-element bbox', () => {
    expect(BBoxSchema.safeParse([-180, -90, -1000, 180, 90, 5000]).success).toBe(true);
  });
  it('rejects 3-element array', () => {
    expect(BBoxSchema.safeParse([-180, -90, 180]).success).toBe(false);
  });
  it('rejects 5-element array', () => {
    expect(BBoxSchema.safeParse([0, 0, 0, 0, 0]).success).toBe(false);
  });
});

// ── Position ─────────────────────────────────────────────────────────────────

describe('PositionSchema', () => {
  it('accepts 2D position', () => {
    expect(PositionSchema.safeParse([-73.985, 40.748]).success).toBe(true);
  });
  it('accepts 3D position', () => {
    expect(PositionSchema.safeParse([-73.985, 40.748, 10.0]).success).toBe(true);
  });
  it('rejects 1-element array', () => {
    expect(PositionSchema.safeParse([-73.985]).success).toBe(false);
  });
  it('rejects 4-element array', () => {
    expect(PositionSchema.safeParse([0, 1, 2, 3]).success).toBe(false);
  });
  it('rejects non-number elements', () => {
    expect(PositionSchema.safeParse(['lng', 'lat']).success).toBe(false);
  });
});

// ── Point ─────────────────────────────────────────────────────────────────────

describe('PointSchema', () => {
  it('accepts a valid 2D Point', () => {
    expect(PointSchema.safeParse({type: 'Point', coordinates: [-73.985, 40.748]}).success).toBe(
      true
    );
  });
  it('accepts a valid 3D Point', () => {
    expect(
      PointSchema.safeParse({type: 'Point', coordinates: [-73.985, 40.748, 100]}).success
    ).toBe(true);
  });
  it('accepts Point with bbox', () => {
    expect(
      PointSchema.safeParse({
        type: 'Point',
        coordinates: [0, 0],
        bbox: [-1, -1, 1, 1]
      }).success
    ).toBe(true);
  });
  it('rejects wrong type literal', () => {
    expect(PointSchema.safeParse({type: 'LineString', coordinates: [0, 0]}).success).toBe(false);
  });
  it('rejects missing coordinates', () => {
    expect(PointSchema.safeParse({type: 'Point'}).success).toBe(false);
  });
});

// ── LineString ────────────────────────────────────────────────────────────────

describe('LineStringSchema', () => {
  const valid = {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [1, 1]
    ]
  };
  it('accepts valid LineString', () => {
    expect(LineStringSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects fewer than 2 positions', () => {
    expect(LineStringSchema.safeParse({type: 'LineString', coordinates: [[0, 0]]}).success).toBe(
      false
    );
  });
  it('rejects empty coordinates', () => {
    expect(LineStringSchema.safeParse({type: 'LineString', coordinates: []}).success).toBe(false);
  });
});

// ── Polygon ───────────────────────────────────────────────────────────────────

describe('PolygonSchema', () => {
  const validRing = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0] // closed
  ];
  it('accepts a valid closed Polygon', () => {
    expect(PolygonSchema.safeParse({type: 'Polygon', coordinates: [validRing]}).success).toBe(true);
  });
  it('rejects an unclosed ring', () => {
    const unclosed = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1] // first !== last
    ];
    expect(PolygonSchema.safeParse({type: 'Polygon', coordinates: [unclosed]}).success).toBe(false);
  });
  it('rejects a ring with fewer than 4 positions', () => {
    const short = [
      [0, 0],
      [1, 0],
      [0, 0]
    ];
    expect(PolygonSchema.safeParse({type: 'Polygon', coordinates: [short]}).success).toBe(false);
  });
  it('accepts Polygon with hole', () => {
    const hole = [
      [0.1, 0.1],
      [0.9, 0.1],
      [0.9, 0.9],
      [0.1, 0.1]
    ];
    expect(PolygonSchema.safeParse({type: 'Polygon', coordinates: [validRing, hole]}).success).toBe(
      true
    );
  });
});

// ── MultiPoint ────────────────────────────────────────────────────────────────

describe('MultiPointSchema', () => {
  it('accepts valid MultiPoint', () => {
    expect(
      MultiPointSchema.safeParse({
        type: 'MultiPoint',
        coordinates: [
          [0, 0],
          [1, 1]
        ]
      }).success
    ).toBe(true);
  });
  it('accepts empty coordinates array (spec allows it)', () => {
    expect(MultiPointSchema.safeParse({type: 'MultiPoint', coordinates: []}).success).toBe(true);
  });
  it('rejects invalid position in coordinates', () => {
    expect(MultiPointSchema.safeParse({type: 'MultiPoint', coordinates: [[0]]}).success).toBe(
      false
    );
  });
});

// ── MultiLineString ───────────────────────────────────────────────────────────

describe('MultiLineStringSchema', () => {
  it('accepts valid MultiLineString', () => {
    expect(
      MultiLineStringSchema.safeParse({
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [1, 1]
          ],
          [
            [2, 2],
            [3, 3]
          ]
        ]
      }).success
    ).toBe(true);
  });
  it('rejects line with fewer than 2 positions', () => {
    expect(
      MultiLineStringSchema.safeParse({
        type: 'MultiLineString',
        coordinates: [[[0, 0]]]
      }).success
    ).toBe(false);
  });
});

// ── MultiPolygon ──────────────────────────────────────────────────────────────

describe('MultiPolygonSchema', () => {
  const ring = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0]
  ];
  it('accepts valid MultiPolygon', () => {
    expect(
      MultiPolygonSchema.safeParse({
        type: 'MultiPolygon',
        coordinates: [[ring]]
      }).success
    ).toBe(true);
  });
  it('rejects unclosed ring within MultiPolygon', () => {
    const unclosed = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ];
    expect(
      MultiPolygonSchema.safeParse({
        type: 'MultiPolygon',
        coordinates: [[unclosed]]
      }).success
    ).toBe(false);
  });
});

// ── GeometryCollection ────────────────────────────────────────────────────────

describe('GeometryCollectionSchema', () => {
  it('accepts a GeometryCollection with mixed geometries', () => {
    expect(
      GeometryCollectionSchema.safeParse({
        type: 'GeometryCollection',
        geometries: [
          {type: 'Point', coordinates: [0, 0]},
          {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [1, 1]
            ]
          }
        ]
      }).success
    ).toBe(true);
  });
  it('accepts a nested GeometryCollection (recursive)', () => {
    expect(
      GeometryCollectionSchema.safeParse({
        type: 'GeometryCollection',
        geometries: [
          {
            type: 'GeometryCollection',
            geometries: [{type: 'Point', coordinates: [0, 0]}]
          }
        ]
      }).success
    ).toBe(true);
  });
  it('rejects invalid child geometry', () => {
    expect(
      GeometryCollectionSchema.safeParse({
        type: 'GeometryCollection',
        geometries: [{type: 'Triangle', coordinates: []}]
      }).success
    ).toBe(false);
  });
});

// ── Geometry (union) ──────────────────────────────────────────────────────────

describe('GeometrySchema', () => {
  it('accepts each geometry type', () => {
    const cases = [
      {type: 'Point', coordinates: [0, 0]},
      {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1]
        ]
      },
      {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0]
          ]
        ]
      },
      {type: 'MultiPoint', coordinates: []},
      {type: 'MultiLineString', coordinates: []},
      {type: 'MultiPolygon', coordinates: []},
      {type: 'GeometryCollection', geometries: []}
    ];
    for (const c of cases) {
      expect(GeometrySchema.safeParse(c).success).toBe(true);
    }
  });
  it('rejects unknown geometry type', () => {
    expect(GeometrySchema.safeParse({type: 'Cube', coordinates: []}).success).toBe(false);
  });
});

// ── Feature ───────────────────────────────────────────────────────────────────

describe('FeatureSchema', () => {
  it('accepts a simple Feature', () => {
    expect(
      FeatureSchema.safeParse({
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [0, 0]},
        properties: {name: 'test'}
      }).success
    ).toBe(true);
  });
  it('accepts a Feature with null geometry', () => {
    expect(
      FeatureSchema.safeParse({
        type: 'Feature',
        geometry: null,
        properties: null
      }).success
    ).toBe(true);
  });
  it('accepts a Feature with string id', () => {
    expect(
      FeatureSchema.safeParse({
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [0, 0]},
        properties: null,
        id: 'feature-1'
      }).success
    ).toBe(true);
  });
  it('accepts a Feature with numeric id', () => {
    expect(
      FeatureSchema.safeParse({
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [0, 0]},
        properties: null,
        id: 42
      }).success
    ).toBe(true);
  });
  it('rejects wrong type literal', () => {
    expect(
      FeatureSchema.safeParse({
        type: 'Foo',
        geometry: null,
        properties: null
      }).success
    ).toBe(false);
  });
});

// ── FeatureCollection ─────────────────────────────────────────────────────────

describe('FeatureCollectionSchema', () => {
  it('accepts a FeatureCollection with mixed geometry types', () => {
    expect(
      FeatureCollectionSchema.safeParse({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {type: 'Point', coordinates: [-73.985, 40.748]},
            properties: {name: 'NY'}
          },
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [-73.985, 40.748],
                [-122.4194, 37.7749]
              ]
            },
            properties: null
          },
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 0]
                ]
              ]
            },
            properties: {area: 100}
          }
        ]
      }).success
    ).toBe(true);
  });
  it('accepts an empty FeatureCollection', () => {
    expect(
      FeatureCollectionSchema.safeParse({type: 'FeatureCollection', features: []}).success
    ).toBe(true);
  });
  it('rejects when features is not an array', () => {
    expect(
      FeatureCollectionSchema.safeParse({type: 'FeatureCollection', features: null}).success
    ).toBe(false);
  });
  it('rejects when a feature has invalid geometry', () => {
    expect(
      FeatureCollectionSchema.safeParse({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {type: 'Point'}, // missing coordinates
            properties: null
          }
        ]
      }).success
    ).toBe(false);
  });
});
