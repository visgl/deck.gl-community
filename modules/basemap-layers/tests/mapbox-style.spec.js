import {describe, expect, test} from 'vitest';
import {
  BasemapLayer,
  generateLayers,
  getBasemapLayers,
  resolveBasemapStyle
} from '@deck.gl-community/basemap-layers';
import {filterFeatures} from '@deck.gl-community/basemap-layers/style-spec';

describe('package exports', () => {
  test('exports generateLayers from the package root', () => {
    expect(typeof generateLayers).toBe('function');
  });

  test('exports BasemapLayer and basemap helpers from the package root', () => {
    expect(BasemapLayer.layerName).toBe('BasemapLayer');
    expect(typeof getBasemapLayers).toBe('function');
    expect(typeof resolveBasemapStyle).toBe('function');
  });
});

describe('filterFeatures', () => {
  describe('filter geometry correctly', () => {
    describe('filter using geometry.type', () => {
      test('filter true Point', () => {
        const features = [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: []
            },
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Point'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual(features);
      });
      test('filter false Point', () => {
        const features = [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: []
            },
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Point'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual([]);
      });
      test('filter true LineString', () => {
        const features = [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: []
            },
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'LineString'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual(features);
      });
      test('filter false LineString', () => {
        const features = [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: []
            },
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'LineString'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual([]);
      });
      test('filter true Polygon', () => {
        const features = [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: []
            },
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Polygon'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual(features);
      });
      test('filter false Polygon', () => {
        const features = [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: []
            },
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Polygon'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual([]);
      });
    });

    describe('filter using provided numeric type', () => {
      test('filter true Point', () => {
        const features = [
          {
            type: 1,
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Point'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual(features);
      });
      test('filter false Point', () => {
        const features = [
          {
            type: 2,
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Point'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual([]);
      });
      test('filter true LineString', () => {
        const features = [
          {
            type: 2,
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'LineString'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual(features);
      });
      test('filter false LineString', () => {
        const features = [
          {
            type: 1,
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'LineString'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual([]);
      });
      test('filter true Polygon', () => {
        const features = [
          {
            type: 3,
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Polygon'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual(features);
      });
      test('filter false Polygon', () => {
        const features = [
          {
            type: 1,
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Polygon'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual([]);
      });
    });
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

    expect(layers.map(layer => layer.id)).toContain('test-background');
    expect(layers.map(layer => layer.id)).toContain('test-carto');
    expect(layers.map(layer => layer.id)).toContain('test-background-north-pole');
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
