// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';
import {ImmutableFeatureCollection} from '../src/edit-modes/immutable-feature-collection';
import type {SimpleFeatureCollection} from '../src/utils/geojson-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCollection(features: SimpleFeatureCollection['features']): ImmutableFeatureCollection {
  return new ImmutableFeatureCollection({type: 'FeatureCollection', features});
}

const POINT_FEATURE = {
  type: 'Feature' as const,
  geometry: {type: 'Point' as const, coordinates: [1, 2]},
  properties: {}
};

const LINE_FEATURE = {
  type: 'Feature' as const,
  geometry: {
    type: 'LineString' as const,
    coordinates: [
      [0, 0],
      [1, 1],
      [2, 2]
    ]
  },
  properties: {}
};

const POLYGON_FEATURE = {
  type: 'Feature' as const,
  geometry: {
    type: 'Polygon' as const,
    // outer ring (closed)
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0]
      ]
    ]
  },
  properties: {}
};

// ---------------------------------------------------------------------------
// addFeature / addFeatures
// ---------------------------------------------------------------------------

describe('addFeature', () => {
  it('appends a feature and returns a new collection', () => {
    const fc = makeCollection([POINT_FEATURE]);
    const updated = fc.addFeature(LINE_FEATURE);

    expect(updated.featureCollection.features).toHaveLength(2);
    // original is unchanged
    expect(fc.featureCollection.features).toHaveLength(1);
  });

  it('addFeatures appends multiple features', () => {
    const fc = makeCollection([]);
    const updated = fc.addFeatures([POINT_FEATURE, LINE_FEATURE]);

    expect(updated.featureCollection.features).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// deleteFeature / deleteFeatures
// ---------------------------------------------------------------------------

describe('deleteFeature', () => {
  it('removes a feature by index', () => {
    const fc = makeCollection([POINT_FEATURE, LINE_FEATURE, POLYGON_FEATURE]);
    const updated = fc.deleteFeature(1);

    expect(updated.featureCollection.features).toHaveLength(2);
    expect(updated.featureCollection.features[0].geometry.type).toBe('Point');
    expect(updated.featureCollection.features[1].geometry.type).toBe('Polygon');
  });

  it('deleteFeatures removes multiple features in correct order', () => {
    const fc = makeCollection([POINT_FEATURE, LINE_FEATURE, POLYGON_FEATURE]);
    const updated = fc.deleteFeatures([0, 2]);

    expect(updated.featureCollection.features).toHaveLength(1);
    expect(updated.featureCollection.features[0].geometry.type).toBe('LineString');
  });

  it('ignores out-of-range indexes', () => {
    const fc = makeCollection([POINT_FEATURE]);
    const updated = fc.deleteFeature(99);

    expect(updated.featureCollection.features).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// replaceGeometry
// ---------------------------------------------------------------------------

describe('replaceGeometry', () => {
  it('replaces the geometry of a feature', () => {
    const fc = makeCollection([POINT_FEATURE, LINE_FEATURE]);
    const newGeom = {type: 'Point' as const, coordinates: [99, 99]};
    const updated = fc.replaceGeometry(0, newGeom);

    expect((updated.featureCollection.features[0].geometry as any).coordinates).toEqual([99, 99]);
    // feature 1 is unchanged
    expect(updated.featureCollection.features[1].geometry.type).toBe('LineString');
    // original is unchanged
    expect((fc.featureCollection.features[0].geometry as any).coordinates).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// replacePosition — LineString
// ---------------------------------------------------------------------------

describe('replacePosition (LineString)', () => {
  it('replaces a coordinate at a given index', () => {
    const fc = makeCollection([LINE_FEATURE]);
    const updated = fc.replacePosition(0, [1], [9, 9]);

    const coords = (updated.featureCollection.features[0].geometry as any).coordinates;
    expect(coords[1]).toEqual([9, 9]);
    // other positions unchanged
    expect(coords[0]).toEqual([0, 0]);
    expect(coords[2]).toEqual([2, 2]);
  });

  it('preserves elevation when updating 2D position over a 3D point', () => {
    const feature3D = {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [0, 0, 10],
          [1, 1, 20]
        ]
      },
      properties: {}
    };
    const fc = makeCollection([feature3D]);
    const updated = fc.replacePosition(0, [0], [5, 5]); // no elevation given

    const coords = (updated.featureCollection.features[0].geometry as any).coordinates;
    expect(coords[0]).toEqual([5, 5, 10]); // elevation copied from original
  });

  it('is immutable — original collection unchanged', () => {
    const fc = makeCollection([LINE_FEATURE]);
    fc.replacePosition(0, [0], [99, 99]);

    const coords = (fc.featureCollection.features[0].geometry as any).coordinates;
    expect(coords[0]).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------------------
// replacePosition — Polygon (wraps first/last)
// ---------------------------------------------------------------------------

describe('replacePosition (Polygon)', () => {
  it('updates both first and last coordinate when replacing index 0', () => {
    const fc = makeCollection([POLYGON_FEATURE]);
    const updated = fc.replacePosition(0, [0, 0], [5, 5]);

    const ring = (updated.featureCollection.features[0].geometry as any).coordinates[0];
    expect(ring[0]).toEqual([5, 5]);
    expect(ring[ring.length - 1]).toEqual([5, 5]);
  });
});

// ---------------------------------------------------------------------------
// addPosition
// ---------------------------------------------------------------------------

describe('addPosition (LineString)', () => {
  it('inserts a position at the given index', () => {
    const fc = makeCollection([LINE_FEATURE]);
    const updated = fc.addPosition(0, [1], [0.5, 0.5]);

    const coords = (updated.featureCollection.features[0].geometry as any).coordinates;
    expect(coords).toHaveLength(4);
    expect(coords[1]).toEqual([0.5, 0.5]);
    expect(coords[2]).toEqual([1, 1]);
  });

  it('throws when adding a position to a Point', () => {
    const fc = makeCollection([POINT_FEATURE]);
    expect(() => fc.addPosition(0, [0], [1, 1])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// removePosition
// ---------------------------------------------------------------------------

describe('removePosition (LineString)', () => {
  it('removes a position from a LineString', () => {
    const fc = makeCollection([LINE_FEATURE]);
    const updated = fc.removePosition(0, [1]);

    const coords = (updated.featureCollection.features[0].geometry as any).coordinates;
    expect(coords).toHaveLength(2);
    expect(coords[0]).toEqual([0, 0]);
    expect(coords[1]).toEqual([2, 2]);
  });

  it('throws when removing from a Point', () => {
    const fc = makeCollection([POINT_FEATURE]);
    expect(() => fc.removePosition(0, [0])).toThrow();
  });

  it('throws when LineString would have fewer than 2 positions', () => {
    const twoPointLine = {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [0, 0],
          [1, 1]
        ]
      },
      properties: {}
    };
    const fc = makeCollection([twoPointLine]);
    expect(() => fc.removePosition(0, [0])).toThrow();
  });

  it('throws when Polygon outer ring would have fewer than 4 positions', () => {
    const triangle = {
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [0.5, 1],
            [0, 0]
          ]
        ]
      },
      properties: {}
    };
    const fc = makeCollection([triangle]);
    expect(() => fc.removePosition(0, [0, 0])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// getObject
// ---------------------------------------------------------------------------

describe('getObject', () => {
  it('returns the underlying feature collection', () => {
    const raw = {type: 'FeatureCollection' as const, features: [POINT_FEATURE]};
    const fc = new ImmutableFeatureCollection(raw);

    expect(fc.getObject()).toBe(raw);
  });
});
