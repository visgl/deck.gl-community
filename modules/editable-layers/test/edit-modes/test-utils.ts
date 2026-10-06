// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {vi} from 'vitest';
import {Position, FeatureCollection} from '../../src/utils/geojson-types';
import {
  ModeProps,
  ClickEvent,
  PointerMoveEvent,
  StartDraggingEvent,
  StopDraggingEvent,
  Pick
} from '../../src/edit-modes/types';

export const FeatureType = {
  POINT: 'Point',
  LINE_STRING: 'LineString',
  POLYGON: 'Polygon',
  MULTI_POINT: 'MultiPoint',
  MULTI_LINE_STRING: 'MultiLineString',
  MULTI_POLYGON: 'MultiPolygon'
};

const mockFeatures = {
  Point: {
    geoJson: {
      type: 'Feature',
      properties: {},
      geometry: {type: 'Point', coordinates: [1, 2]}
    },
    clickCoords: [1, 2]
  },
  LineString: {
    geoJson: {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [1, 2],
          [2, 3],
          [3, 4]
        ]
      }
    },
    clickCoords: [1, 2]
  },
  Polygon: {
    geoJson: {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          // exterior ring
          [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
            [-1, -1]
          ],
          // hole
          [
            [-0.5, -0.5],
            [-0.5, 0.5],
            [0.5, 0.5],
            [0.5, -0.5],
            [-0.5, -0.5]
          ]
        ]
      }
    },
    clickCoords: [-0.5, -0.5]
  },
  MultiPoint: {
    geoJson: {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPoint',
        coordinates: [
          [1, 2],
          [3, 4]
        ]
      }
    },
    clickCoords: [3, 4]
  },
  MultiLineString: {
    geoJson: {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [1, 2],
            [2, 3],
            [3, 4]
          ],
          [
            [5, 6],
            [6, 7],
            [7, 8]
          ]
        ]
      }
    },
    clickCoords: [6, 7]
  },
  MultiPolygon: {
    geoJson: {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            // exterior ring polygon 1
            [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, 1],
              [-1, -1]
            ],
            // hole  polygon 1
            [
              [-0.5, -0.5],
              [-0.5, 0.5],
              [0.5, 0.5],
              [0.5, -0.5],
              [-0.5, -0.5]
            ]
          ],
          [
            // exterior ring polygon 2
            [
              [2, -1],
              [4, -1],
              [4, 1],
              [2, 1],
              [2, -1]
            ]
          ]
        ]
      }
    },
    clickCoords: [1, 1]
  }
};

export const mockedGeoJsonProperties = {testString: 'hi', testNumber: 10};

function createFeature(featureType: string, options?: {[K: string]: any}) {
  const feature = mockFeatures[featureType].geoJson;
  const {mockGeoJsonProperties} = options || {};
  if (mockGeoJsonProperties) {
    feature.properties = mockedGeoJsonProperties;
  }
  return feature;
}

export function createPointFeature(options?: {[K: string]: any}) {
  return createFeature(FeatureType.POINT, options);
}

export function createLineStringFeature(options?: {[K: string]: any}) {
  return createFeature(FeatureType.LINE_STRING, options);
}

export function createPolygonFeature(options?: {[K: string]: any}) {
  return createFeature(FeatureType.POLYGON, options);
}

export function createMultiPointFeature(options?: {[K: string]: any}) {
  return createFeature(FeatureType.MULTI_POINT, options);
}

export function createMultiLineStringFeature(options?: {[K: string]: any}) {
  return createFeature(FeatureType.MULTI_LINE_STRING, options);
}

export function createMultiPolygonFeature(options?: {[K: string]: any}) {
  return createFeature(FeatureType.MULTI_POLYGON, options);
}

export function getFeatureCollectionFeatures(options?: {[K: string]: any}) {
  return [
    createPointFeature(options),
    createLineStringFeature(options),
    createPolygonFeature(options),
    createMultiPointFeature(options),
    createMultiLineStringFeature(options),
    createMultiPolygonFeature(options)
  ];
}

export function createFeatureCollection(options?: {[K: string]: any}) {
  return {
    type: 'FeatureCollection',
    features: getFeatureCollectionFeatures(options)
  };
}

export function getMockFeatureDetails(featureType: string) {
  const featureCollectionIndex = getFeatureCollectionFeatures().findIndex(
    feature => feature.geometry.type === featureType
  );
  const featureDetails = mockFeatures[featureType];
  featureDetails.index = featureCollectionIndex;
  return featureDetails;
}

let lastCoords: Position = null;

export function createClickEvent(mapCoords: Position, picks: Pick[] = []): ClickEvent {
  lastCoords = mapCoords;

  return {
    screenCoords: [-1, -1],
    mapCoords,
    picks,
    sourceEvent: null
  };
}

export function createKeyboardEvent(key: string): KeyboardEvent {
  return {type: 'keyup', key, stopPropagation: vi.fn()} as unknown as KeyboardEvent;
}

export function createStartDraggingEvent(
  mapCoords: Position,
  pointerDownMapCoords: Position,
  picks: Pick[] = [],
  screenCoords?: [number, number]
): StartDraggingEvent {
  lastCoords = mapCoords;

  return {
    screenCoords: screenCoords || [-1, -1],
    mapCoords,
    picks,
    pointerDownPicks: null,
    pointerDownScreenCoords: [-1, -1],
    pointerDownMapCoords,
    cancelPan: vi.fn(),
    sourceEvent: null
  };
}

export function createStopDraggingEvent(
  mapCoords: Position,
  pointerDownMapCoords: Position,
  picks: Pick[] = [],
  pointerDownPicks: Pick[] | null = null,
  screenCoords?: [number, number]
): StopDraggingEvent {
  lastCoords = mapCoords;

  return {
    screenCoords: screenCoords || [-1, -1],
    mapCoords,
    picks,
    pointerDownPicks,
    pointerDownScreenCoords: [-1, -1],
    pointerDownMapCoords,
    sourceEvent: null
  };
}

export function createPointerMoveEvent(
  mapCoords?: Position,
  picks?: Pick[],
  screenCoords?: [number, number]
): PointerMoveEvent {
  if (!mapCoords) {
    mapCoords = lastCoords;
  } else {
    lastCoords = mapCoords;
  }

  return {
    screenCoords: screenCoords || [-1, -1],
    mapCoords,
    picks: picks || [],
    pointerDownPicks: null,
    pointerDownScreenCoords: null,
    pointerDownMapCoords: null,
    cancelPan: vi.fn(),
    sourceEvent: null
  };
}

export function createFeatureCollectionProps(
  overrides: Partial<ModeProps<FeatureCollection>> = {}
): ModeProps<FeatureCollection> {
  return {
    // @ts-expect-error TODO
    data: createFeatureCollection(),
    selectedIndexes: [],
    // @ts-expect-error TODO
    lastPointerMoveEvent: createPointerMoveEvent(),
    modeConfig: null,
    onEdit: vi.fn(),
    onUpdateCursor: vi.fn(),
    ...overrides
  };
}
