/* eslint-disable import/no-extraneous-dependencies, import/named */
import {describe, expect, test} from 'vitest';
import {BasemapLayer, getBasemapLayers} from '../src/index.ts';
import {
  BasemapStyleSchema,
  filterFeatures,
  MapStyleLoader,
  resolveBasemapStyle
} from '../src/map-style.ts';

const GEOMETRY_TYPE_CASES = [
  {
    label: 'Point geometry matches Point filter',
    featureType: 'Point',
    filterType: 'Point',
    expected: true
  },
  {
    label: 'LineString geometry does not match Point filter',
    featureType: 'LineString',
    filterType: 'Point',
    expected: false
  },
  {
    label: 'LineString geometry matches LineString filter',
    featureType: 'LineString',
    filterType: 'LineString',
    expected: true
  },
  {
    label: 'Point geometry does not match LineString filter',
    featureType: 'Point',
    filterType: 'LineString',
    expected: false
  },
  {
    label: 'Polygon geometry matches Polygon filter',
    featureType: 'Polygon',
    filterType: 'Polygon',
    expected: true
  },
  {
    label: 'Point geometry does not match Polygon filter',
    featureType: 'Point',
    filterType: 'Polygon',
    expected: false
  }
];

const NUMERIC_TYPE_CASES = [
  {
    label: 'numeric Point matches Point filter',
    featureType: 1,
    filterType: 'Point',
    expected: true
  },
  {
    label: 'numeric LineString does not match Point filter',
    featureType: 2,
    filterType: 'Point',
    expected: false
  },
  {
    label: 'numeric LineString matches LineString filter',
    featureType: 2,
    filterType: 'LineString',
    expected: true
  },
  {
    label: 'numeric Point does not match LineString filter',
    featureType: 1,
    filterType: 'LineString',
    expected: false
  },
  {
    label: 'numeric Polygon matches Polygon filter',
    featureType: 3,
    filterType: 'Polygon',
    expected: true
  },
  {
    label: 'numeric Point does not match Polygon filter',
    featureType: 1,
    filterType: 'Polygon',
    expected: false
  }
];

describe('package exports', () => {
  test('exports BasemapLayer and basemap helpers from the package root', () => {
    expect(BasemapLayer.layerName).toBe('BasemapLayer');
    expect(typeof getBasemapLayers).toBe('function');
  });

  test('exports map-style helpers and loader from the submodule', () => {
    expect(typeof resolveBasemapStyle).toBe('function');
    expect(MapStyleLoader.id).toBe('map-style');
    expect(typeof BasemapStyleSchema.parse).toBe('function');
  });
});

describe('filterFeatures', () => {
  test.each(GEOMETRY_TYPE_CASES)('$label', ({featureType, filterType, expected}) => {
    const features = [
      {
        type: 'Feature',
        geometry: {
          type: featureType,
          coordinates: []
        },
        properties: {
          class: 'minor'
        }
      }
    ];

    const result = filterFeatures({features, filter: ['==', '$type', filterType]});
    expect(result).toStrictEqual(expected ? features : []);
  });

  test.each(NUMERIC_TYPE_CASES)('$label', ({featureType, filterType, expected}) => {
    const features = [
      {
        type: featureType,
        properties: {
          class: 'minor'
        }
      }
    ];

    const result = filterFeatures({features, filter: ['==', '$type', filterType]});
    expect(result).toStrictEqual(expected ? features : []);
  });
});

describe('resolveBasemapStyle', () => {
  test('resolves inline vector source tiles without fetching', async () => {
    const style = {
      version: 8,
      sources: {
        carto: {
          type: 'vector',
          tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']
        }
      },
      layers: []
    };

    const resolved = await resolveBasemapStyle(style);

    expect(resolved.sources.carto.tiles).toEqual(['https://tiles.example.com/{z}/{x}/{y}.mvt']);
  });

  test('resolves TileJSON-backed sources', async () => {
    const style = {
      version: 8,
      sources: {
        carto: {
          type: 'vector',
          url: 'https://example.com/tiles.json'
        }
      },
      layers: []
    };

    const resolved = await resolveBasemapStyle(style, {
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          tiles: ['/vector/{z}/{x}/{y}.mvt'],
          minzoom: 1,
          maxzoom: 5
        })
      })
    });

    expect(resolved.sources.carto.tiles).toEqual(['https://example.com/vector/{z}/{x}/{y}.mvt']);
    expect(resolved.sources.carto.minzoom).toBe(1);
  });

  test('MapStyleLoader parses and resolves a style document', async () => {
    const style = {
      version: 8,
      sources: {
        carto: {
          type: 'vector',
          url: './tiles.json'
        }
      },
      layers: []
    };

    const result = await MapStyleLoader.parse(
      new TextEncoder().encode(JSON.stringify(style)).buffer,
      {
        mapStyle: {
          fetch: async () => ({
            ok: true,
            status: 200,
            json: async () => ({
              tiles: ['/vector/{z}/{x}/{y}.mvt']
            })
          })
        }
      },
      {
        url: 'https://example.com/styles/base.json',
        baseUrl: 'https://example.com/styles/',
        fetch,
        _parse: async () => null
      }
    );

    expect(result.sources.carto.tiles).toEqual(['https://example.com/vector/{z}/{x}/{y}.mvt']);
  });
});

describe('getBasemapLayers', () => {
  test('builds globe background and shared vector source sublayers from a style', () => {
    const layers = getBasemapLayers({
      idPrefix: 'test',
      mode: 'globe',
      globe: {config: {atmosphere: false, basemap: true, labels: false}},
      styleDefinition: {
        version: 8,
        sources: {
          carto: {
            type: 'vector',
            tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']
          }
        },
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: {'background-color': '#001122'}
          },
          {
            id: 'water',
            type: 'fill',
            source: 'carto',
            'source-layer': 'water',
            paint: {'fill-color': '#224466'}
          }
        ]
      }
    });

    expect(layers.map((layer) => layer.id)).toContain('test-background');
    expect(layers.map((layer) => layer.id)).toContain('test-carto');
    expect(layers.map((layer) => layer.id)).toContain('test-background-north-pole');
  });

  test('converts style alpha values into deck color alpha values', () => {
    const [backgroundLayer] = getBasemapLayers({
      idPrefix: 'alpha',
      mode: 'map',
      styleDefinition: {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: {
              'background-color': 'rgba(10, 20, 30, 0.5)'
            }
          }
        ]
      }
    });

    expect(backgroundLayer.props.getFillColor).toEqual([10, 20, 30, 128]);
  });
});
