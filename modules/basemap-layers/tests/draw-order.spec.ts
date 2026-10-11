/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {
  SharedTileRequests,
  getBasemapLayers,
  getStyleLayerRuns,
  sortTileSubLayers
} from '../src/globe-layers';

const SOURCES = {
  tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']},
  relief: {type: 'raster', tiles: ['https://relief.example.com/{z}/{x}/{y}.png'], tileSize: 256}
};

/** A style shaped like OpenFreeMap Liberty: a background, a low-zoom raster, then vector layers. */
const RASTER_FIRST_LAYERS = [
  {id: 'background', type: 'background', paint: {'background-color': '#fff'}},
  {id: 'relief', type: 'raster', source: 'relief', maxzoom: 7},
  {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
  {id: 'roads', type: 'line', source: 'tiles', 'source-layer': 'road'},
  {id: 'places', type: 'symbol', source: 'tiles', 'source-layer': 'place', layout: {}}
];

/** A raster between the vector fills and the labels. */
const RASTER_BETWEEN_LAYERS = [
  {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
  {id: 'relief', type: 'raster', source: 'relief'},
  {id: 'roads', type: 'line', source: 'tiles', 'source-layer': 'road'},
  {id: 'places', type: 'symbol', source: 'tiles', 'source-layer': 'place', layout: {}}
];

function getLayerIds(layers: unknown[], zoom: number, config?: Record<string, boolean>): string[] {
  return getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    globe: config ? {config} : undefined,
    styleDefinition: {version: 8, sources: SOURCES, layers} as any
  }).map((layer: any) => layer.id);
}

function getRuns(layers: unknown[], config?: any) {
  return getStyleLayerRuns(
    layers as any,
    {version: 8, sources: SOURCES, layers} as any,
    config
  ).map(run => ({type: run.type, id: run.id, layers: run.styleLayers.map(layer => layer.id)}));
}

describe('draw order across sources', () => {
  test('a raster layer before the vector layers draws below them', () => {
    expect(getLayerIds(RASTER_FIRST_LAYERS, 4)).toEqual([
      'test-background',
      'test-relief',
      'test-tiles'
    ]);
    // Out of its zoom range, the raster draws nothing.
    expect(getLayerIds(RASTER_FIRST_LAYERS, 8)).toEqual(['test-background', 'test-tiles']);
  });

  test('a raster layer between vector layers splits their source into two tile layers', () => {
    expect(getRuns(RASTER_BETWEEN_LAYERS)).toEqual([
      {type: 'vector', id: 'tiles', layers: ['water']},
      {type: 'raster', id: 'relief', layers: ['relief']},
      {type: 'vector', id: 'tiles-roads', layers: ['roads', 'places']}
    ]);
    expect(getLayerIds(RASTER_BETWEEN_LAYERS, 4)).toEqual([
      'test-tiles',
      'test-relief',
      'test-tiles-roads'
    ]);
  });

  test('runs do not depend on zoom, so tile layer ids are stable', () => {
    const layers = [
      {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
      {id: 'relief', type: 'raster', source: 'relief', maxzoom: 7},
      {id: 'roads', type: 'line', source: 'tiles', 'source-layer': 'road'}
    ];
    expect(getLayerIds(layers, 4)).toEqual(['test-tiles', 'test-relief', 'test-tiles-roads']);
    // The hidden raster still separates the runs: the second tile layer keeps its id and tiles.
    expect(getLayerIds(layers, 8)).toEqual(['test-tiles', 'test-tiles-roads']);
  });

  test('layers that draw nothing do not split a run', () => {
    const layers = [
      {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
      {id: 'labels', type: 'symbol', source: 'tiles', 'source-layer': 'place', layout: {}},
      {id: 'hillshade', type: 'hillshade', source: 'relief'},
      {id: 'missing', type: 'raster', source: 'unknown'},
      {id: 'roads', type: 'line', source: 'tiles', 'source-layer': 'road'}
    ];
    // Unsupported types are filtered before runs are made, as in getBasemapLayers.
    const supported = layers.filter(layer => layer.type !== 'hillshade');
    expect(getRuns(supported, {atmosphere: false, basemap: true, labels: false})).toEqual([
      {type: 'vector', id: 'tiles', layers: ['water', 'roads']}
    ]);
    expect(getLayerIds(layers, 4, {labels: false})).toEqual(['test-tiles']);
  });

  test('a source drawn in several runs shares its tile requests', () => {
    const [first, , second] = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 4,
      styleDefinition: {version: 8, sources: SOURCES, layers: RASTER_BETWEEN_LAYERS} as any
    }) as any[];
    expect(first.props.tileRequests).toBeInstanceOf(SharedTileRequests);
    expect(second.props.tileRequests).toBe(first.props.tileRequests);
    expect(first.props.tileRequests.consumers).toBe(2);

    // A source drawn in one run fetches its own tiles, with abort signals.
    const [, , single] = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 4,
      styleDefinition: {version: 8, sources: SOURCES, layers: RASTER_FIRST_LAYERS} as any
    }) as any[];
    expect(single.props.tileRequests).toBeNull();
  });
});

describe('SharedTileRequests', () => {
  test('loads a tile once for all consumers, then forgets it', async () => {
    const requests = new SharedTileRequests();
    requests.consumers = 2;
    let loads = 0;
    const load = () => Promise.resolve(++loads);

    const a = requests.request('t/1', load);
    const b = requests.request('t/1', load);
    expect(b).toBe(a);
    expect(await a).toBe(1);
    // Both consumers took it, so a later request (a tile evicted and reloaded) loads again.
    expect(await requests.request('t/1', load)).toBe(2);
  });

  test('a failed request does not drop a newer request for the tile', async () => {
    const requests = new SharedTileRequests();
    let fail!: (error: Error) => void;
    // The only consumer takes the request at once, so it is no longer kept.
    const failing = requests.request('t/1', () => new Promise((_, reject) => (fail = reject)));
    requests.consumers = 2;
    const newer = requests.request('t/1', () => new Promise(() => {}));
    fail(new Error('offline'));
    await expect(failing).rejects.toThrow('offline');
    // The newer request survives the failure, and its second consumer reuses it.
    expect(requests.request('t/1', () => Promise.resolve('other'))).toBe(newer);
  });

  test('a failed request is not reused', async () => {
    const requests = new SharedTileRequests();
    requests.consumers = 3;
    let loads = 0;
    const failing = requests.request('t/1', () => {
      loads++;
      return Promise.reject(new Error('offline'));
    });
    await expect(failing).rejects.toThrow('offline');
    await requests.request('t/1', () => Promise.resolve(++loads));
    expect(loads).toBe(2);
  });
});

describe('draw order across tiles', () => {
  const layer = (id: string, styleLayerIndex?: number) => ({id, props: {styleLayerIndex}});

  test('draws each style layer across all tiles before the next', () => {
    const tileA = [layer('a-fill', 0), layer('a-road', 1), layer('a-label', 2)];
    const tileB = [layer('b-fill', 0), layer('b-label', 2)];
    const tileC = [layer('c-road', 1), layer('c-road-gap', 1), layer('c-label', 2)];
    expect(sortTileSubLayers([tileA, null, tileB, undefined, tileC]).map(l => l.id)).toEqual([
      'a-fill',
      'b-fill',
      'a-road',
      'c-road',
      'c-road-gap',
      'a-label',
      'b-label',
      'c-label'
    ]);
  });

  test("each tile's sublayers record their style layer", () => {
    const tileLayer: any = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 8,
      styleDefinition: {
        version: 8,
        sources: SOURCES,
        layers: [
          {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
          // A gap draws two sublayers for one style layer.
          {
            id: 'roads',
            type: 'line',
            source: 'tiles',
            'source-layer': 'road',
            paint: {'line-gap-width': 2}
          },
          {id: 'places', type: 'symbol', source: 'tiles', 'source-layer': 'place', layout: {}}
        ]
      } as any
    }).find((l: any) => l.id === 'test-tiles');

    const feature = (layerName: string, geometry: unknown) => ({
      type: 'Feature',
      geometry,
      properties: {layerName, name: 'n'}
    });
    const subLayers = tileLayer.props.renderSubLayers({
      id: 'tile',
      data: [
        feature('road', {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1]
          ]
        }),
        feature('place', {type: 'Point', coordinates: [0, 0]})
      ],
      tile: {index: {x: 0, y: 0, z: 8}}
    });
    // No water features, so no water sublayer; the road and its gap both record index 1.
    expect(subLayers.map((l: any) => [l.id, l.props.styleLayerIndex])).toEqual([
      ['tile-roads', 1],
      ['tile-roads-gap', 1],
      ['tile-places', 2]
    ]);
  });
});

describe('vector tile layer', () => {
  test('draws all tiles of a style layer before the next style layer', () => {
    const tileLayer: any = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 8,
      styleDefinition: {
        version: 8,
        sources: SOURCES,
        layers: [
          {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
          {id: 'places', type: 'symbol', source: 'tiles', 'source-layer': 'place', layout: {}}
        ]
      } as any
    }).find((l: any) => l.id === 'test-tiles');

    const content = [
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
        properties: {layerName: 'water'}
      },
      {
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [0, 0]},
        properties: {layerName: 'place', name: 'n'}
      }
    ];
    const tile = (id: string, x: number) => ({
      id,
      index: {x, y: 0, z: 8},
      bbox: {west: 0, south: 0, east: 1, north: 1},
      isLoaded: true,
      content,
      layers: null
    });
    // Just enough layer state for `TileLayer.renderLayers` to render two loaded tiles.
    tileLayer.context = {viewport: {zoom: 8, resolution: 0}};
    tileLayer.internalState = {};
    tileLayer.state = {
      data: SOURCES.tiles.tiles,
      binary: false,
      tileset: {tiles: [tile('a', 0), tile('b', 1)]}
    };

    expect(tileLayer.renderLayers().map((l: any) => l.id)).toEqual([
      'test-tiles-a-water',
      'test-tiles-b-water',
      'test-tiles-a-places',
      'test-tiles-b-places'
    ]);
  });
});

describe('globe draw order', () => {
  test('flat layers draw in style order without depth on a globe', () => {
    const [water, roads] = getBasemapLayers({
      idPrefix: 'test',
      mode: 'globe',
      zoom: 4,
      styleDefinition: {version: 8, sources: SOURCES, layers: RASTER_BETWEEN_LAYERS} as any
    })
      .filter((layer: any) => layer.id.startsWith('test-tiles'))
      .map((layer: any) => layer.props.parameters);
    // Layers tessellate the sphere differently, so a depth test would let an earlier layer hide a
    // later one; back-face culling hides the far side.
    for (const parameters of [water, roads]) {
      expect(parameters).toMatchObject({
        depthTest: false,
        depthWriteEnabled: false,
        cullMode: 'back'
      });
    }
    const background: any = getBasemapLayers({
      idPrefix: 'test',
      mode: 'globe',
      zoom: 4,
      styleDefinition: {version: 8, sources: SOURCES, layers: RASTER_FIRST_LAYERS} as any
    }).find((layer: any) => layer.id === 'test-background');
    // The globe background still writes depth, so the globe hides what is drawn behind it.
    expect(background.props.parameters).toMatchObject({depthTest: true, depthWriteEnabled: true});
  });
});
