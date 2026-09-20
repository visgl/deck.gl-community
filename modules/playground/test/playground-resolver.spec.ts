// deck.gl-community
// SPDX-License-Identifier: MIT

import {Layer, MapView, OrthographicView} from '@deck.gl/core';
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
          'Unsupported playground expression'
        ],
        [
          {layers: [unavailable], views: {'@@type': 'MapView', width: '@@=Math.random()'}},
          'Unsupported playground expression'
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

  test('supports own-property paths, array indices and numeric arithmetic', () => {
    const row = {position: [4, 9], properties: {size: 12}};
    const resolved = resolveLayer({
      getPosition: '@@=position',
      getRadius: '@@=properties.size / 3',
      getLineWidth: '@@=position[0] * -2'
    });
    expect((resolved.props as any).getPosition(row)).toBe(row.position);
    expect((resolved.props as any).getRadius(row)).toBe(4);
    expect((resolved.props as any).getLineWidth(row)).toBe(-8);
    expect((resolveLayer({getRadius: '@@=0'}).props as any).getRadius([17])).toBe(17);
    const getRadius = (resolveLayer({getRadius: '@@=size + 1'}).props as any).getRadius;
    expect(getRadius(Object.create({size: 5}))).toBeUndefined();
    expect(getRadius({size: '5'})).toBeUndefined();
    expect((resolveLayer({getRadius: '@@=size + 1'}).props as any).getRadius).toBe(getRadius);
  });

  test('rejects unsupported expressions and prototype traversal before rendering', () => {
    for (const expression of [
      'Math.random()',
      'a = 2',
      'a; sideEffect()',
      'a + b',
      'a + 1 + 2',
      'a ? b : c',
      'a["name"]',
      '__proto__.value',
      'a.constructor',
      'a.prototype.value',
      'size * 1e999'
    ]) {
      expect(() => resolveLayer({getRadius: `@@=${expression}`})).toThrow();
    }
  });

  test('resolves registered constants and factories using only own properties', () => {
    const getRadius = () => 7;
    const factory = vi.fn(
      ({scale}) =>
        (row: {value: number}) =>
          row.value * Number(scale)
    );
    const configured = createPlaygroundResolver({
      ...registry,
      constants: {palette: {fill: [1, 2, 3]}, getRadius, scale: 3},
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

  test('rejects duplicate layer IDs and unsupported nested resource constructors', () => {
    expect(() => resolver.resolve({layers: [layer, layer]}, {})).toThrow('Duplicate');
    expect(() =>
      resolver.resolve({layers: [layer], effects: [{'@@type': 'UnknownEffect'}]}, {})
    ).toThrow('Nested @@type resources are unsupported');
  });

  test('rejects unsupported basemap styling and empty view lists', () => {
    expect(() => resolver.resolve({mapStyle: 'style.json'}, {})).toThrow();
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
