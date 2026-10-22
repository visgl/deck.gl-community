/* eslint-disable import/no-extraneous-dependencies */
import {Layer} from '@deck.gl/core';
import {describe, expect, test, vi} from 'vitest';
import {getBasemapLayers, getStyleLayerRuns, sortTileSubLayers} from '../src/globe-layers';

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
  test('a generated run ID cannot alias a quoted source ID', () => {
    const layers: any[] = [
      {id: 'first', type: 'fill', source: 'a'},
      {id: 'other', type: 'fill', source: 'a-\"b\"'},
      {id: 'b', type: 'line', source: 'a'}
    ];
    const source = {type: 'vector', tiles: ['/{z}/{x}/{y}.pbf']};
    const runs = getStyleLayerRuns(layers, {sources: {a: source, 'a-\"b\"': source}} as any);
    expect(new Set(runs.map(run => run.id)).size).toBe(3);
  });
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
      {type: 'vector', id: 'tiles-"roads"', layers: ['roads', 'places']}
    ]);
    expect(getLayerIds(RASTER_BETWEEN_LAYERS, 4)).toEqual([
      'test-tiles',
      'test-relief',
      'test-tiles-"roads"'
    ]);
  });

  test('runs do not depend on zoom, so tile layer ids are stable', () => {
    const layers = [
      {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
      {id: 'relief', type: 'raster', source: 'relief', maxzoom: 7},
      {id: 'roads', type: 'line', source: 'tiles', 'source-layer': 'road'}
    ];
    expect(getLayerIds(layers, 4)).toEqual(['test-tiles', 'test-relief', 'test-tiles-"roads"']);
    // The hidden raster still separates the runs: the second tile layer keeps its id and tiles.
    expect(getLayerIds(layers, 8)).toEqual(['test-tiles', 'test-tiles-"roads"']);
  });

  test("a later run's id cannot equal another source's id", () => {
    const sources = {
      a: SOURCES.tiles,
      'a-b': {type: 'vector', tiles: ['https://other.example.com/{z}/{x}/{y}.mvt']}
    };
    const layers = [
      {id: 'x', type: 'fill', source: 'a', 'source-layer': 'water'},
      {id: 'y', type: 'fill', source: 'a-b', 'source-layer': 'water'},
      {id: 'b', type: 'line', source: 'a', 'source-layer': 'road'}
    ];
    const ids = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 4,
      styleDefinition: {version: 8, sources, layers} as any
    }).map((layer: any) => layer.id);
    expect(ids).toEqual(['test-a', 'test-a-b', 'test-a-"b"']);
  });

  // deck.gl matches layers by id, so a background or raster layer and a tile layer must not share
  // one: the first run of a source falls back to the quoted id of its first style layer.
  test("a source's first run cannot take a background layer's id", () => {
    const sources = {land: SOURCES.tiles};
    const getIds = (layers: unknown[]) =>
      getBasemapLayers({
        idPrefix: 'test',
        mode: 'map',
        zoom: 4,
        styleDefinition: {version: 8, sources, layers} as any
      }).map((layer: any) => layer.id);
    expect(
      getIds([
        {id: 'land', type: 'background', paint: {'background-color': '#fff'}},
        {id: 'fill', type: 'fill', source: 'land', 'source-layer': 'land'}
      ])
    ).toEqual(['test-land', 'test-land-"fill"']);
    // A vector layer named like its source does not collide: the run keeps the source id.
    expect(getIds([{id: 'land', type: 'fill', source: 'land', 'source-layer': 'land'}])).toEqual([
      'test-land'
    ]);
  });

  test("a source's first run cannot take a later raster layer's id", () => {
    const layers = [
      {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
      {id: 'tiles', type: 'raster', source: 'relief'}
    ];
    expect(getRuns(layers)).toEqual([
      {type: 'vector', id: 'tiles-"water"', layers: ['water']},
      {type: 'raster', id: 'tiles', layers: ['tiles']}
    ]);
    expect(getLayerIds(layers, 4)).toEqual(['test-tiles-"water"', 'test-tiles']);
  });

  test('layers that draw nothing do not split a run', () => {
    const layers = [
      {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
      {id: 'labels', type: 'symbol', source: 'tiles', 'source-layer': 'place', layout: {}},
      {id: 'hillshade', type: 'hillshade', source: 'relief'},
      {id: 'missing', type: 'raster', source: 'unknown'},
      {id: 'roads', type: 'line', source: 'tiles', 'source-layer': 'road'}
    ];
    // The hillshade's source is not a `raster-dem` source, so it draws nothing.
    expect(getRuns(layers, {atmosphere: false, basemap: true, labels: false})).toEqual([
      {type: 'vector', id: 'tiles', layers: ['water', 'roads']}
    ]);
    expect(getLayerIds(layers, 4, {labels: false})).toEqual(['test-tiles']);
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
      ['tile-"roads"', 1],
      ['tile-"roads"-gap', 1],
      ['tile-"places"', 2]
    ]);
  });
});

describe('style layer index of tile sublayers', () => {
  const line = (properties: Record<string, unknown>) => ({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1]
      ]
    },
    properties: {layerName: 'road', ...properties}
  });

  test('is set when the sublayers are created, without cloning them', () => {
    const tileLayer: any = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 8,
      styleDefinition: {
        version: 8,
        sources: SOURCES,
        layers: [
          {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
          // A per-feature cap groups the features by line shape, and a gap draws each group
          // twice: one style layer makes a nested list of sublayers.
          {
            id: 'roads',
            type: 'line',
            source: 'tiles',
            'source-layer': 'road',
            layout: {'line-cap': ['get', 'cap']},
            paint: {'line-gap-width': 2}
          }
        ]
      } as any
    }).find((l: any) => l.id === 'test-tiles');

    const clone = vi.spyOn(Layer.prototype, 'clone');
    let subLayers: any[];
    try {
      subLayers = tileLayer.props
        .renderSubLayers({
          id: 'tile',
          data: [line({cap: 'round'}), line({cap: 'butt'})],
          tile: {index: {x: 0, y: 0, z: 8}}
        })
        .flat(Infinity);
      // Nothing is cloned, the gap side of a line included.
      expect(clone).not.toHaveBeenCalled();
    } finally {
      clone.mockRestore();
    }
    expect(subLayers).toHaveLength(4);
    for (const subLayer of subLayers) {
      expect(subLayer.props.styleLayerIndex).toBe(1);
    }
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
      tileLayers: new Map(),
      tileset: {tiles: [tile('a', 0), tile('b', 1)]}
    };

    expect(tileLayer.renderLayers().map((l: any) => l.id)).toEqual([
      'test-tiles-a-"water"',
      'test-tiles-b-"water"',
      // The labels of all tiles draw together, after every tile's sublayers.
      'test-tiles-labels-"places"'
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

  /** Water, buildings from z14, then a boundary line, a raster and roads from another source. */
  const EXTRUSION_LAYERS = [
    {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      source: 'tiles',
      'source-layer': 'building',
      minzoom: 14
    },
    {id: 'boundary', type: 'line', source: 'tiles', 'source-layer': 'boundary'},
    {id: 'relief', type: 'raster', source: 'relief'},
    {id: 'roads', type: 'line', source: 'tiles', 'source-layer': 'road'}
  ];

  function getExtrusionLayers(mode: 'map' | 'globe', zoom: number, extrusionMinZoom = 14) {
    const styleLayers = EXTRUSION_LAYERS.map(layer =>
      layer.type === 'fill-extrusion' ? {...layer, minzoom: extrusionMinZoom} : layer
    );
    const layers: any[] = getBasemapLayers({
      idPrefix: 'test',
      mode,
      zoom,
      styleDefinition: {version: 8, sources: SOURCES, layers: styleLayers} as any
    });
    const square = [
      [
        [0, 0],
        [0.001, 0],
        [0.001, 0.001],
        [0, 0]
      ]
    ];
    const path = [
      [0, 0],
      [0.001, 0.001]
    ];
    const feature = (layerName: string, type: string, coordinates: unknown) => ({
      type: 'Feature',
      geometry: {type, coordinates},
      properties: {layerName}
    });
    const tiles = layers
      .find(layer => layer.id === 'test-tiles')
      .props.renderSubLayers({
        id: 'tile',
        data: [
          feature('water', 'Polygon', square),
          feature('building', 'Polygon', square),
          feature('boundary', 'LineString', path)
        ],
        tile: {index: {x: 0, y: 0, z: zoom}}
      })
      .flat(Infinity);
    const sublayer = (id: string) => tiles.find((l: any) => l.id === `tile-${JSON.stringify(id)}`);
    const [roads] = layers
      .find(layer => layer.id === 'test-tiles-"roads"')
      .props.renderSubLayers({
        id: 'tile',
        data: [feature('road', 'LineString', path)],
        tile: {index: {x: 0, y: 0, z: zoom}}
      });
    return {
      water: sublayer('water').props.parameters,
      building: sublayer('building-3d')?.props.parameters,
      boundary: sublayer('boundary').props.parameters,
      relief: layers.find(layer => layer.id === 'test-relief').props.parameters,
      reliefTile: layers
        .find(layer => layer.id === 'test-relief')
        .props.renderSubLayers({
          id: 'relief-tile',
          data: null,
          tile: {bbox: {west: 0, south: 0, east: 1, north: 1}}
        }).props.parameters,
      roads: roads.props.parameters,
      roadsTrigger: layers.find(layer => layer.id === 'test-tiles-"roads"').props.updateTriggers
        .renderSubLayers
    };
  }

  test('flat layers after a drawn extrusion are depth-tested against the buildings', () => {
    const {water, building, boundary, relief, reliefTile, roads} = getExtrusionLayers('globe', 15);
    expect(building).toMatchObject({depthTest: true, depthWriteEnabled: true});
    // Before the buildings, flat layers draw without depth.
    expect(water).toMatchObject({depthTest: false, depthWriteEnabled: false});
    // After them, the buildings hide them; they still write no depth, so they cannot hide each
    // other. This holds for the extrusion's own run, a raster, and a later run.
    for (const parameters of [boundary, relief, reliefTile, roads]) {
      expect(parameters).toMatchObject({
        depthTest: true,
        depthCompare: 'less-equal',
        depthWriteEnabled: false,
        cullMode: 'back'
      });
    }
  });

  test('below the extrusion zoom, flat layers draw without depth', () => {
    const z13 = getExtrusionLayers('globe', 13);
    expect(z13.building).toBeUndefined();
    for (const parameters of [z13.water, z13.boundary, z13.relief, z13.reliefTile, z13.roads]) {
      expect(parameters).toMatchObject({depthTest: false, depthWriteEnabled: false});
    }
  });

  test('a run without the extrusion regenerates its tiles when the extrusion starts to draw', () => {
    // Both zooms are in one style zoom step, and the roads' run has no zoom limits of its own.
    const before = getExtrusionLayers('globe', 14.05, 14.1);
    const after = getExtrusionLayers('globe', 14.15, 14.1);
    expect(before.roads).toMatchObject({depthTest: false});
    expect(after.roads).toMatchObject({depthTest: true});
    expect(after.roadsTrigger).not.toEqual(before.roadsTrigger);
  });

  test('on a map, every flat layer is depth-tested', () => {
    const {water, boundary, relief, roads} = getExtrusionLayers('map', 15);
    for (const parameters of [water, boundary, relief, roads]) {
      expect(parameters).toMatchObject({depthTest: true, depthWriteEnabled: false});
    }
  });
});
