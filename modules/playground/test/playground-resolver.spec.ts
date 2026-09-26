// deck.gl-community
// SPDX-License-Identifier: MIT

import {Layer, MapView, OrthographicView} from '@deck.gl/core';
import {JSONConfiguration} from '@deck.gl/json';
import {ScatterplotLayer} from '@deck.gl/layers';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {z} from 'zod';
import {PlaygroundDataSourceManager} from '../src/runtime/playground-data-source-manager';
import {PlaygroundSourceBindings} from '../src/runtime/playground-source-bindings';
import {
  createPlaygroundResolver,
  PlaygroundDataSourceError
} from '../src/runtime/playground-resolver';
import {ScatterplotLayerSchema} from '../src/schemas/deckgl';
import {AnimationLayerSchema, BasemapLayerSchema, GraphLayerSchema} from '../src/schemas/community';

const registry = {
  layers: {ScatterplotLayer: {type: ScatterplotLayer, schema: ScatterplotLayerSchema}}
};
const resolver = createPlaygroundResolver(registry);
const layer = {id: 'points', '@@type': 'ScatterplotLayer'};

let manager: PlaygroundDataSourceManager;
let dataSources: PlaygroundSourceBindings;
beforeEach(() => {
  manager = new PlaygroundDataSourceManager();
  dataSources = new PlaygroundSourceBindings(manager, () => {});
});
afterEach(async () => {
  dataSources.finalize();
  await manager.finalize();
});

function addSource(dataSourceId: string, dataSource: object | Promise<object> | null) {
  manager.add({dataSourceId, dataSource});
}

function resolveLayer(properties: Record<string, unknown>) {
  const result = resolver.resolve({layers: [{...layer, ...properties}]}, {});
  return (result.props.layers as Layer[])[0];
}

function sourceLayer(name: string, id = name) {
  return {...layer, id, data: {'@@data': name}};
}

function captureSourceError(resolve: () => unknown): PlaygroundDataSourceError {
  try {
    resolve();
  } catch (error) {
    expect(error).toBeInstanceOf(PlaygroundDataSourceError);
    return error as PlaygroundDataSourceError;
  }
  throw new Error('Expected an unavailable source error');
}

describe('playground runtime resolver', () => {
  test('matches selected constructors to bundled schemas without enabling other layers', () => {
    const selected = createPlaygroundResolver({layers: {ScatterplotLayer}});
    try {
      const result = selected.resolve({layers: [{...layer, getRadius: 4}]}, {});
      expect((result.props.layers as Layer[])[0]).toBeInstanceOf(ScatterplotLayer);
      expect(() => selected.resolve({layers: [{...layer, '@@type': 'ArcLayer'}]}, {})).toThrow();
      expect(() => selected.resolve({layers: [{...layer, radiusUnits: 'feet'}]}, {})).toThrow();
      expect(() => createPlaygroundResolver({layers: {CustomLayer: Layer}})).toThrow(
        'register {type, schema}'
      );
    } finally {
      selected.finalize();
    }
  });

  test('passes a registered data resource by reference without converting its contents', () => {
    const data = [{label: '@@#missing', nested: {'@@function': 'missing'}}];
    const selected = createPlaygroundResolver({layers: {ScatterplotLayer}, constants: {data}});
    try {
      const result = selected.resolve({layers: [{...layer, data: '@@#data'}]}, {});
      expect((result.props.layers as Layer[])[0].props.data).toBe(data);
      expect(result.layerBindings.size).toBe(0);
      expect(() => selected.resolve({layers: [{...layer, data: '@@#missing'}]}, {})).toThrow(
        'Unknown playground constant'
      );
    } finally {
      selected.finalize();
    }
  });

  test('keeps an embedded basemap style opaque while resolving host resource references', () => {
    const style = {
      version: 8,
      sources: {
        places: {
          type: 'geojson',
          data: {type: 'FeatureCollection', features: [], label: '@@=label'}
        }
      },
      layers: [],
      metadata: {'@@type': 'literal', nested: {'@@function': 'literal'}}
    };
    const selected = createPlaygroundResolver({
      layers: {BasemapLayer: {type: ScatterplotLayer, schema: BasemapLayerSchema}},
      constants: {style}
    });
    try {
      for (const value of [style, '@@#style']) {
        const result = selected.resolve(
          {layers: [{'@@type': 'BasemapLayer', id: 'basemap', style: value}]},
          {}
        );
        expect((result.props.layers as Layer[])[0].props.style).toBe(style);
      }
    } finally {
      selected.finalize();
    }
  });

  test('preserves nested animation rows and releases temporary data references after failures', () => {
    const rows = [
      {
        label: '@@=radius',
        constant: '@@#missing',
        nested: {'@@function': 'readData'},
        metadata: {'@@type': 'Unknown', '@@data': 'literal'}
      }
    ];
    const readData = vi.fn(() => rows);
    const fail = vi.fn(() => {
      throw new Error('Factory failed');
    });
    const selected = createPlaygroundResolver({
      layers: {AnimationLayer: {type: ScatterplotLayer, schema: AnimationLayerSchema}},
      constants: {child: new ScatterplotLayer({id: 'child'}), rows},
      functions: {readData, fail}
    });
    const catalogs = JSONConfiguration.defaultProps.enumerations;
    const registeredKeys = Object.keys(catalogs);
    const document = (data: unknown, props: object = {}) => ({
      layers: [
        {
          id: 'animation',
          '@@type': 'AnimationLayer',
          layer: '@@#child',
          frames: {
            type: 'sequence',
            frames: [{type: 'sequence', frames: [{props: {data, ...props}, duration: 100}]}]
          }
        }
      ]
    });
    try {
      for (const value of [rows, rows[0], rows, '@@#rows', '@@=literal', null]) {
        const result = selected.resolve(document(value, {getRadius: '@@=radius'}), {});
        const props = (result.props.layers as Layer[])[0].props.frames.frames[0].frames[0].props;
        expect(props.data).toBe(value === '@@#rows' ? rows : value);
        expect(props.getRadius({radius: 7})).toBe(7);
        expect(readData).not.toHaveBeenCalled();
        expect(Object.keys(catalogs)).toEqual(registeredKeys);
      }
      expect(() =>
        selected.resolve(document(rows, {getRadius: {'@@function': 'fail'}}), {})
      ).toThrow('Factory failed');
      expect(fail).toHaveBeenCalledOnce();
      expect(Object.keys(catalogs)).toEqual(registeredKeys);
      expect(() => selected.resolve(document('@@#missing'), {})).toThrow('Unknown playground');
      expect(Object.keys(catalogs)).toEqual(registeredKeys);
      expect(() => selected.resolve(document(rows), {})).not.toThrow();
      expect(Object.keys(catalogs)).toEqual(registeredKeys);
    } finally {
      selected.finalize();
    }
  });

  test('still converts graph stylesheet data factories outside layer-prop containers', () => {
    const dataAccessor = () => [];
    const createAccessor = vi.fn(() => dataAccessor);
    const selected = createPlaygroundResolver({
      layers: {GraphLayer: {type: ScatterplotLayer, schema: GraphLayerSchema}},
      functions: {createAccessor}
    });
    try {
      const result = selected.resolve(
        {
          layers: [
            {
              id: 'graph',
              '@@type': 'GraphLayer',
              stylesheet: {nodes: [{type: 'circle', data: {'@@function': 'createAccessor'}}]}
            }
          ]
        },
        {}
      );
      expect((result.props.layers as Layer[])[0].props.stylesheet.nodes[0].data).toBe(dataAccessor);
      expect(createAccessor).toHaveBeenCalledOnce();
    } finally {
      selected.finalize();
    }
  });

  test('validates every configuration before constructing layers', () => {
    const construct = vi.fn(ScatterplotLayer);
    const tracked = createPlaygroundResolver({
      layers: {ScatterplotLayer: {type: construct, schema: ScatterplotLayerSchema}}
    });
    expect(() =>
      tracked.resolve({layers: [layer, {...layer, id: 'invalid', radiusUnits: 'feet'}]}, {})
    ).toThrow();
    expect(construct).not.toHaveBeenCalled();
    expect(() => tracked.resolve({layers: [{...layer, '@@type': 'Unavailable'}]}, {})).toThrow();
    expect(() => tracked.resolve({layers: [{...layer, unknownProp: true}]}, {})).toThrow();
  });

  test('passes 100,000 external rows by reference without inspecting or copying them', () => {
    const data = Array.from({length: 100_000}, (_, id) => ({
      id,
      position: [id, id],
      label: '@@=x'
    }));
    const read = vi.fn(() => {
      throw new Error('Rows must not be inspected during binding');
    });
    Object.defineProperty(data[0], 'opaque', {enumerable: true, get: read});
    const result = resolver.resolve({layers: [sourceLayer('points')]}, {points: {data}});
    const resolved = (result.props.layers as Layer[])[0];
    expect(resolved.props.data).toBe(data);
    expect(result.layerBindings).toEqual(new Map([['points', 'points']]));
    expect(read).not.toHaveBeenCalled();
  });

  test('keeps inline row objects and expression-like values verbatim', () => {
    const data = [
      {label: '@@=untrusted()', constant: '@@#missing', nested: {'@@function': 'missing'}},
      {'@@type': 'Unknown', '@@data': 'literal'}
    ];
    const resolved = resolveLayer({data});
    expect(resolved.props.data).toBe(data);
  });

  test('rejects missing bindings, inherited bindings and non-array bindings', () => {
    const value = {layers: [sourceLayer('points')]};
    expect(() => resolver.resolve(value, {})).toThrow('Missing playground data binding: points');
    expect(() => resolver.resolve(value, Object.create({points: {data: []}}))).toThrow(
      'Missing playground data binding: points'
    );
    expect(() => resolver.resolve(value, {points: {data: new Float32Array(4) as any}})).toThrow(
      'must contain a row array'
    );
  });

  test('resolves shared sources and returns only descriptors referenced by the document', () => {
    const data = [{id: 17, position: [0, 0]}];
    const getRowId = (row: {id: number}) => row.id;
    addSource('shared', {data, getRowId});
    addSource('unusedShared', {data: []});
    const local = {data: [{id: 19}]};
    const inline = [{id: 21}];
    const result = resolver.resolve(
      {
        layers: [
          sourceLayer('shared'),
          sourceLayer('local'),
          {...layer, id: 'inline-layer', data: inline}
        ]
      },
      {local, unusedLocal: {data: []}},
      dataSources
    );
    const layers = result.props.layers as Layer[];
    expect(layers[0].props.data).toBe(data);
    expect(layers[1].props.data).toBe(local.data);
    expect(layers[2].props.data).toBe(inline);
    expect(Object.keys(result.bindings)).toEqual(['shared', 'local']);
    expect(result.bindings.shared).toBe(dataSources.get('shared'));
    expect(result.bindings.shared.getRowId).toBe(getRowId);
    expect(result.bindings.local).toBe(local);
    expect(result.layerBindings).toEqual(
      new Map([
        ['shared', 'shared'],
        ['local', 'local']
      ])
    );
  });

  test('registers document SQL sources through the host query provider', async () => {
    const queryManager = new PlaygroundDataSourceManager({
      queryProvider: {
        execute: vi.fn(async ({sql}) => ({data: [{position: [1, 2], sql}]}))
      }
    });
    const querySources = new PlaygroundSourceBindings(queryManager, () => {});
    try {
      const document = {
        sources: {cities: {'@@sql': 'SELECT longitude, latitude FROM cities'}},
        layers: [sourceLayer('cities')]
      };
      expect(() => resolver.resolve(document, {}, querySources)).toThrow('Loading');
      await vi.waitFor(() => expect(querySources.getState('cities')).toEqual({status: 'ready'}));
      const result = resolver.resolve(document, {}, querySources);
      expect((result.props.layers as Layer[])[0].props.data).toEqual([
        {position: [1, 2], sql: 'SELECT longitude, latitude FROM cities'}
      ]);
    } finally {
      querySources.finalize();
      await queryManager.finalize();
    }
  });

  test('refreshes row references when resolving the same document after a source replacement', () => {
    const document = {layers: [sourceLayer('points')]};
    const originalRows = [{id: 1}];
    const nextRows = [{id: 2}];
    addSource('points', {data: originalRows});
    const original = resolver.resolve(document, {}, dataSources);
    addSource('points', {data: nextRows});
    const refreshed = resolver.resolve(document, {}, dataSources);
    expect((original.props.layers as Layer[])[0].props.data).toBe(originalRows);
    expect((refreshed.props.layers as Layer[])[0].props.data).toBe(nextRows);
    expect(refreshed.bindings.points.data).toBe(nextRows);

    const localRows = [{id: 3}];
    const overridden = resolver.resolve(document, {points: {data: localRows}}, dataSources);
    expect((overridden.props.layers as Layer[])[0].props.data).toBe(localRows);
    expect(overridden.bindings.points.data).toBe(localRows);
  });

  test('prioritizes own local bindings over shared sources including pending sources', () => {
    const shared = [{id: 1}];
    const local = {data: [{id: 2}]};
    const document = {layers: [sourceLayer('points')]};
    addSource('points', {data: shared});
    const inherited = resolver.resolve(document, Object.create({points: local}), dataSources);
    expect((inherited.props.layers as Layer[])[0].props.data).toBe(shared);
    const override = resolver.resolve(document, {points: local}, dataSources);
    expect((override.props.layers as Layer[])[0].props.data).toBe(local.data);
    expect(override.bindings.points).toBe(local);
    addSource('points', new Promise<object>(() => {}));
    const pendingOverride = resolver.resolve(document, {points: local}, dataSources);
    expect((pendingOverride.props.layers as Layer[])[0].props.data).toBe(local.data);
    expect(pendingOverride.bindings.points).toBe(local);
    expect(() => resolver.resolve(document, {points: undefined}, dataSources)).toThrow(
      'must contain a row array'
    );
  });

  test('resolves prototype-like source names without inherited properties or prototype mutation', () => {
    const names = ['__proto__', 'constructor', 'toString'];
    for (const name of names) {
      addSource(name, {data: [{name}]});
    }
    const document = {
      layers: names.map(name => sourceLayer(name))
    };
    const result = resolver.resolve(document, {}, dataSources);
    expect(Object.getPrototypeOf(result.bindings)).toBeNull();
    expect(Object.keys(result.bindings)).toEqual(names);
    names.forEach((name, index) => {
      expect(result.bindings[name]).toBe(dataSources.get(name));
      expect((result.props.layers as Layer[])[index].props.data).toBe(dataSources.get(name)?.data);
    });
    const local = {data: [{name: 'local'}]};
    const overridden = resolver.resolve(
      document,
      Object.fromEntries([['__proto__', local]]),
      dataSources
    );
    expect(overridden.bindings.__proto__).toBe(local);
  });

  test.each([
    'missing',
    'loading',
    'error'
  ] as const)('defers all construction for a %s source and reports recovery context', async status => {
    const constructLayer = vi.fn(function (
      props: ConstructorParameters<typeof ScatterplotLayer>[0]
    ) {
      return new ScatterplotLayer(props);
    });
    const constructView = vi.fn(function (props: ConstructorParameters<typeof MapView>[0]) {
      return new MapView(props);
    });
    const tracked = createPlaygroundResolver({
      layers: {ScatterplotLayer: {type: constructLayer, schema: ScatterplotLayerSchema}},
      views: {
        TrackedView: {
          type: constructView,
          schema: z.strictObject({'@@type': z.literal('TrackedView')})
        }
      }
    });
    const cause = new Error('Remote source unavailable');
    addSource('ready', {data: []});
    if (status === 'loading') addSource('unavailable', new Promise<object>(() => {}));
    if (status === 'error') {
      addSource('unavailable', Promise.reject(cause));
      dataSources.get('unavailable');
      await vi.waitFor(() => expect(dataSources.getState('unavailable')?.status).toBe('error'));
    }
    const document = {
      layers: [
        sourceLayer('unavailable'),
        sourceLayer('ready'),
        sourceLayer('unavailable', 'repeat')
      ],
      views: {'@@type': 'TrackedView'}
    };
    const error = captureSourceError(() => tracked.resolve(document, {}, dataSources));
    expect(error).toMatchObject({
      sourceId: 'unavailable',
      status,
      sourceIds: ['unavailable', 'ready'],
      cause: status === 'error' ? cause : undefined
    });
    expect(constructLayer).not.toHaveBeenCalled();
    expect(constructView).not.toHaveBeenCalled();
    const local = {data: [{id: 1}]};
    const result = tracked.resolve(document, {unavailable: local}, dataSources);
    expect((result.props.layers as Layer[])[0].props.data).toBe(local.data);
  });

  test('prioritizes configuration errors over unavailable sources throughout the document', () => {
    addSource('pending', new Promise<object>(() => {}));
    for (const source of ['pending', 'missing']) {
      const unavailable = sourceLayer(source);
      const cases = [
        [{layers: [unavailable, {...layer, id: 'invalid', radiusUnits: 'feet'}]}, z.ZodError],
        [
          {layers: [unavailable, {...layer, getRadius: '@@=Math.random()'}]},
          'Function calls not allowed in JSON expressions'
        ],
        [
          {layers: [unavailable], views: {'@@type': 'MapView', width: '@@=Math.random()'}},
          'Function calls not allowed in JSON expressions'
        ],
        [
          {layers: [unavailable], onViewStateChange: '@@#missingCallback'},
          'Unknown playground constant'
        ],
        [{layers: [unavailable, unavailable]}, 'Duplicate playground layer id']
      ] as const;
      for (const [document, error] of cases) {
        expect(() => resolver.resolve(document, {}, dataSources)).toThrow(error);
      }
    }
  });

  test('supports standard accessor expressions, arrays, conditionals and computed properties', () => {
    const row = {lng: 4, lat: 9, properties: {size: 12}, field: 'size'};
    const resolved = resolveLayer({
      getPosition: '@@=[lng, lat]',
      getRadius: '@@=properties.size > 10 ? properties.size / 3 : 1',
      getLineWidth: '@@=properties[field] + lng + 2'
    });
    expect((resolved.props as any).getPosition(row)).toEqual([4, 9]);
    expect((resolved.props as any).getRadius(row)).toBe(4);
    expect((resolved.props as any).getRadius({...row, properties: {size: 3}})).toBe(1);
    expect((resolved.props as any).getLineWidth(row)).toBe(18);
    expect((resolveLayer({getRadius: '@@=0'}).props as any).getRadius([17])).toBe(0);
    for (const expression of ['this', '-']) {
      const getPosition = (resolveLayer({getPosition: `@@=${expression}`}).props as any)
        .getPosition;
      expect(getPosition(row)).toBe(row);
    }
  });

  test('rejects executable expressions and disallowed member access', () => {
    for (const expression of ['Math.random()', 'a = 2', 'a; sideEffect()']) {
      expect(() => resolveLayer({getRadius: `@@=${expression}`})).toThrow();
    }
    const getRadius = (resolveLayer({getRadius: '@@=properties[field]'}).props as any).getRadius;
    expect(() => getRadius({properties: {}, field: 'constructor'})).toThrow(
      'Access to member "constructor" disallowed.'
    );
  });

  test('resolves registered constants, enumerations and factories', () => {
    const getRadius = () => 7;
    const factory = vi.fn(
      ({scale}) =>
        (row: {value: number}) =>
          row.value * Number(scale)
    );
    const configured = createPlaygroundResolver({
      ...registry,
      constants: {getRadius, scale: 3},
      enumerations: {palette: {fill: [1, 2, 3]}},
      functions: {scaled: factory}
    });
    const result = configured.resolve(
      {
        layers: [
          {
            ...layer,
            getFillColor: '@@#palette.fill',
            getRadius: '@@#getRadius',
            getLineWidth: {'@@function': 'scaled', scale: '@@#scale'}
          }
        ]
      },
      {}
    );
    const props = ((result.props.layers as Layer[])[0] as any).props;
    expect(props.getFillColor).toEqual([1, 2, 3]);
    expect(props.getRadius).toBe(getRadius);
    expect(props.getLineWidth({value: 4})).toBe(12);
    expect(factory).toHaveBeenCalledWith({scale: 3});
    for (const getRadius of [
      '@@#missing',
      '@@#toString',
      '@@#palette.constructor',
      {'@@function': 'missing'},
      {'@@function': 'toString'}
    ]) {
      expect(() => configured.resolve({layers: [{...layer, getRadius}]}, {})).toThrow();
    }
  });

  test('preserves zero and false constant values', () => {
    const configured = createPlaygroundResolver({
      ...registry,
      constants: {zero: 0, disabled: false, 'palette.fill': [1, 2, 3]}
    });
    const result = configured.resolve(
      {
        controller: '@@#disabled',
        layers: [{...layer, getRadius: '@@#zero', getFillColor: '@@#palette.fill'}]
      },
      {}
    );
    const props = (result.props.layers as ScatterplotLayer[])[0].props;
    expect(result.props.controller).toBe(false);
    expect(props.getRadius).toBe(0);
    expect(props.getFillColor).toEqual([1, 2, 3]);
  });

  test('isolates resolver registrations and releases only its own catalogs on finalize', () => {
    const catalogs = JSONConfiguration.defaultProps;
    const originalEnumerations = Object.keys(catalogs.enumerations);
    const originalFunctions = Object.keys(catalogs.functions);
    const createResolver = (radius: number) =>
      createPlaygroundResolver({
        ...registry,
        constants: {radius},
        enumerations: {palette: {fill: [radius, 0, 0]}},
        functions: {'width.fixed': () => () => radius + 1}
      });
    const first = createResolver(2);
    const second = createResolver(7);
    const document = {
      layers: [
        {
          ...layer,
          getRadius: '@@#radius',
          getFillColor: '@@#palette.fill',
          getLineWidth: {'@@function': 'width.fixed'}
        }
      ]
    };
    for (const [configured, radius] of [
      [first, 2],
      [second, 7],
      [first, 2]
    ] as const) {
      const result = configured.resolve(document, {});
      const props = (result.props.layers as ScatterplotLayer[])[0].props;
      expect(props.getRadius).toBe(radius);
      expect(props.getFillColor).toEqual([radius, 0, 0]);
      expect((props.getLineWidth as () => number)()).toBe(radius + 1);
    }
    first.finalize();
    first.finalize();
    expect(Object.keys(catalogs.enumerations)).toHaveLength(originalEnumerations.length + 1);
    expect(Object.keys(catalogs.functions)).toHaveLength(originalFunctions.length + 1);
    const result = second.resolve(document, {});
    const props = (result.props.layers as ScatterplotLayer[])[0].props;
    expect(props.getRadius).toBe(7);
    expect((props.getLineWidth as () => number)()).toBe(8);
    second.finalize();
    expect(Object.keys(catalogs.enumerations)).toEqual(originalEnumerations);
    expect(Object.keys(catalogs.functions)).toEqual(originalFunctions);
  });

  test('keeps factory-returned arrays and objects opaque without cloning them', () => {
    const array = ['@@=untrusted()', {'@@type': 'Unknown'}];
    const object = {label: '@@#missing', nested: {'@@function': 'missing'}};
    const configured = createPlaygroundResolver({
      ...registry,
      functions: {makeArray: () => array, makeObject: () => object}
    });
    const result = configured.resolve(
      {
        layers: [
          {
            ...layer,
            updateTriggers: {
              getRadius: {'@@function': 'makeArray'},
              getFillColor: {'@@function': 'makeObject'}
            }
          }
        ]
      },
      {}
    );
    const triggers = (result.props.layers as Layer[])[0].props.updateTriggers;
    expect(triggers.getRadius).toBe(array);
    expect(triggers.getFillColor).toBe(object);
  });

  test('rejects duplicate layer IDs and unsupported nested resource constructors', () => {
    expect(() => resolver.resolve({layers: [layer, layer]}, {})).toThrow('Duplicate');
    expect(() =>
      resolver.resolve({layers: [layer], effects: [{'@@type': 'UnknownEffect'}]}, {})
    ).toThrow('Nested @@type resources are unsupported');
  });

  test('accepts basemap settings and rejects empty view lists', () => {
    const result = resolver.resolve(
      {mapStyle: 'style.json', mapboxApiAccessToken: 'pk.example-token'},
      {}
    );
    expect(result.props).not.toHaveProperty('mapStyle');
    expect(result.props).not.toHaveProperty('mapboxApiAccessToken');
    expect(() => resolver.resolve({views: []}, {})).toThrow();
    expect(resolver.resolve({}, {}).props.views).toBeUndefined();
  });

  test('applies schema defaults while preserving supplied row references', () => {
    const custom = createPlaygroundResolver({
      layers: {
        ScatterplotLayer: {
          type: ScatterplotLayer,
          schema: ScatterplotLayerSchema.extend({radiusScale: z.number().default(2)})
        }
      }
    });
    const data = [{position: [0, 0]}];
    const result = custom.resolve({layers: [{...layer, data}]}, {});
    const resolved = (result.props.layers as Layer[])[0];
    expect((resolved.props as any).radiusScale).toBe(2);
    expect(resolved.props.data).toBe(data);
  });

  test('preserves constructor identifiers that resemble deferred expressions', () => {
    const result = resolver.resolve(
      {
        layers: [{...layer, id: '@@=row()', data: {'@@data': 'points'}}],
        views: {'@@type': 'MapView', id: '@@#view'}
      },
      {points: {data: []}}
    );
    expect((result.props.layers as Layer[])[0].id).toBe('@@=row()');
    expect((result.props.views as MapView[])[0].id).toBe('@@#view');
    expect(result.layerBindings.get('@@=row()')).toBe('points');
  });

  test('constructs all five core views and custom registered layers', () => {
    const names = ['MapView', '_GlobeView', 'OrbitView', 'OrthographicView', 'FirstPersonView'];
    const result = resolver.resolve({views: names.map(name => ({'@@type': name}))}, {});
    expect((result.props.views as any[]).map(view => view.constructor.name)).toEqual([
      'MapView',
      'GlobeView',
      'OrbitView',
      'OrthographicView',
      'FirstPersonView'
    ]);
    expect((result.props.views as any[])[0]).toBeInstanceOf(MapView);
    const custom = createPlaygroundResolver({
      layers: {
        CustomLayer: {
          type: ScatterplotLayer,
          schema: ScatterplotLayerSchema.extend({'@@type': z.literal('CustomLayer')})
        }
      },
      views: {
        CustomView: {
          type: OrthographicView,
          schema: z.strictObject({'@@type': z.literal('CustomView'), id: z.string()})
        }
      }
    });
    const resolved = custom.resolve(
      {layers: [{...layer, '@@type': 'CustomLayer'}], views: {'@@type': 'CustomView', id: 'plot'}},
      {}
    );
    expect((resolved.props.layers as Layer[])[0]).toBeInstanceOf(ScatterplotLayer);
    expect((resolved.props.views as any[])[0]).toBeInstanceOf(OrthographicView);
  });
});
