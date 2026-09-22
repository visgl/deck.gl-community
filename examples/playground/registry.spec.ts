// deck.gl-community
// SPDX-License-Identifier: MIT
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Layer} from '@deck.gl/core';
import * as layers from '@deck.gl/layers';
import * as aggregation from '@deck.gl/aggregation-layers';
import * as geo from '@deck.gl/geo-layers';
import * as mesh from '@deck.gl/mesh-layers';
import * as arrow from '@deck.gl-community/arrow-layers';
import * as basemap from '@deck.gl-community/basemap-layers';
import * as editable from '@deck.gl-community/editable-layers';
import * as experimental from '@deck.gl-community/experimental';
import * as communityGeo from '@deck.gl-community/geo-layers';
import * as graph from '@deck.gl-community/graph-layers';
import * as infovis from '@deck.gl-community/infovis-layers';
import * as communityLayers from '@deck.gl-community/layers';
import * as three from '@deck.gl-community/three';
import * as timeline from '@deck.gl-community/timeline-layers';
import {tableFromArrays} from 'apache-arrow';
import ts from 'typescript';
import {z} from 'zod';
import {afterAll, afterEach, expect, test, vi} from 'vitest';
import {createPlaygroundResolver} from '../../modules/playground/src/runtime/playground-resolver';
import {DeckGLLayerSchemas} from '../../modules/playground/src/schemas/deckgl';
import {CommunityLayerSchemas} from '../../modules/playground/src/schemas/community';
import {createPlaygroundRegistry} from './registry';
import {TEMPLATES} from './templates';

const PACKAGES = {
  '@deck.gl/layers': layers,
  '@deck.gl/aggregation-layers': aggregation,
  '@deck.gl/geo-layers': geo,
  '@deck.gl/mesh-layers': mesh,
  '@deck.gl-community/arrow-layers': arrow,
  '@deck.gl-community/basemap-layers': basemap,
  '@deck.gl-community/editable-layers': editable,
  '@deck.gl-community/experimental': experimental,
  '@deck.gl-community/geo-layers': communityGeo,
  '@deck.gl-community/graph-layers': graph,
  '@deck.gl-community/infovis-layers': infovis,
  '@deck.gl-community/layers': communityLayers,
  '@deck.gl-community/three': three,
  '@deck.gl-community/timeline-layers': timeline
};
const ABSTRACT_LAYERS = new Set(['_AggregationLayer', '_GeoCellLayer']);
const registry = createPlaygroundRegistry();
const resolver = createPlaygroundResolver(registry);
afterAll(() => resolver.finalize());
afterEach(() => vi.unstubAllGlobals());

function registeredType(name: string) {
  const entry = registry.layers[name];
  return typeof entry === 'function' ? entry : entry?.type;
}

function registryName(packageName: string, name: string) {
  return packageName === '@deck.gl-community/graph-layers' && name === 'GridLayer'
    ? 'GraphGridLayer'
    : name;
}

test('registers every concrete public layer from each package without losing name collisions', () => {
  const expected: string[] = [];
  for (const [packageName, exports] of Object.entries(PACKAGES)) {
    for (const [name, constructor] of Object.entries(exports)) {
      if (typeof constructor !== 'function' || !(constructor.prototype instanceof Layer)) continue;
      if (ABSTRACT_LAYERS.has(name)) {
        expect(registry.layers).not.toHaveProperty(name);
        continue;
      }
      const key = registryName(packageName, name);
      expect(registeredType(key), `${packageName}.${name}`).toBe(constructor);
      expected.push(key);
    }
  }
  expect(Object.keys(registry.layers).sort()).toEqual(expected.sort());
  expect(registeredType('GridLayer')).toBe(aggregation.GridLayer);
  expect(registeredType('GraphGridLayer')).toBe(graph.GridLayer);
});

test('workspace layer exports cannot be added without a website registration', () => {
  const modules = new URL('../../modules/', import.meta.url);
  for (const directory of readdirSync(modules, {withFileTypes: true})) {
    if (!directory.isDirectory()) continue;
    const entry = new URL(`${directory.name}/src/index.ts`, modules);
    if (!existsSync(entry)) continue;
    const source = ts.createSourceFile(
      fileURLToPath(entry),
      readFileSync(entry, 'utf8'),
      ts.ScriptTarget.Latest
    );
    for (const statement of source.statements) {
      if (
        !ts.isExportDeclaration(statement) ||
        statement.isTypeOnly ||
        !statement.exportClause ||
        !ts.isNamedExports(statement.exportClause)
      )
        continue;
      for (const exported of statement.exportClause.elements) {
        const name = exported.name.text;
        if (exported.isTypeOnly || !name.endsWith('Layer')) continue;
        expect(registry.layers, `${directory.name}.${name}`).toHaveProperty(
          registryName(`@deck.gl-community/${directory.name}`, name)
        );
      }
    }
  }
});

test('editor schema discriminators cover exactly the registered layer and view names', () => {
  const types = new Set<string>();
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const node = value as {properties?: Record<string, {const?: unknown}>};
    const discriminator = node.properties?.['@@type']?.const;
    if (typeof discriminator === 'string') types.add(discriminator);
    for (const child of Object.values(node)) visit(child);
  }
  visit(resolver.jsonSchema);
  expect([...types].sort()).toEqual(
    [
      ...Object.keys(registry.layers),
      'MapView',
      '_GlobeView',
      'OrbitView',
      'OrthographicView',
      'FirstPersonView'
    ].sort()
  );
});

test('every public layer default prop has a schema property', () => {
  const schemas = Object.fromEntries(
    [...Object.values(DeckGLLayerSchemas), ...Object.values(CommunityLayerSchemas)].map(schema => [
      (schema.shape['@@type'] as {value: string}).value,
      schema
    ])
  );
  const missing: string[] = [];
  for (const [name, entry] of Object.entries(registry.layers)) {
    const schema = typeof entry === 'function' ? schemas[name] : entry.schema;
    if (!(schema instanceof z.ZodObject)) throw new Error(`Expected an object schema for ${name}`);
    const {shape} = schema;
    for (
      let type: (Function & {defaultProps?: Record<string, unknown>}) | undefined =
        registeredType(name);
      type?.defaultProps;
      type = Object.getPrototypeOf(type)
    ) {
      for (const prop of Object.keys(type.defaultProps)) {
        // GeoArrow explicitly omits binary text backgrounds from its public props.
        if (name === '_GeoArrowTextLayer' && prop === 'background') continue;
        // BitmapLayer draws its image prop and intentionally omits inherited row data.
        if (name === 'BitmapLayer' && prop === 'data') continue;
        if (!(prop in shape)) missing.push(`${name}.${prop}`);
      }
    }
  }
  expect([...new Set(missing)].sort()).toEqual([]);
});

for (const [name, template] of Object.entries(TEMPLATES)) {
  test(`managed resolver accepts the ${name} gallery template without fetching resources`, () => {
    const fetch = vi.fn(() => Promise.reject(new Error('Unexpected network request')));
    vi.stubGlobal('fetch', fetch);
    const configuration: Record<string, unknown> =
      typeof template === 'string' ? JSON.parse(template) : template;
    const {metadata: _metadata, ...document} = configuration;
    const result = resolver.resolve(document, {});
    const definitions = document.layers as {id: string; '@@type': string; data?: unknown}[];
    const resolved = result.props.layers as Layer[];
    expect(resolved).toHaveLength(definitions.length);
    definitions.forEach((definition, index) => {
      expect(resolved[index]).toBeInstanceOf(registeredType(definition['@@type'])!);
      expect(resolved[index].id).toBe(definition.id);
      if (Object.hasOwn(definition, 'data'))
        expect(resolved[index].props.data).toBe(definition.data);
    });
    expect(fetch).not.toHaveBeenCalled();
  });
}

test('host Arrow resources and edit modes resolve by reference through the shared catalog', () => {
  const table = tableFromArrays({label: ['@@#ordinary-row-text']});
  const labels = table.getChild('label');
  const native = createPlaygroundResolver({
    ...registry,
    constants: {...registry.constants, table, labels}
  });
  try {
    const result = native.resolve(
      {
        layers: [
          {id: 'labels', '@@type': '_GeoArrowTextLayer', data: '@@#table', getText: '@@#labels'},
          {
            id: 'edit',
            '@@type': 'EditableGeoJsonLayer',
            data: {type: 'FeatureCollection', features: []},
            mode: '@@#ModifyMode'
          }
        ]
      },
      {}
    );
    const resolved = result.props.layers as Layer[];
    expect(resolved[0].props.data).toBe(table);
    expect((resolved[0] as arrow._GeoArrowTextLayer).props.getText).toBe(labels);
    expect((resolved[1] as editable.EditableGeoJsonLayer).props.mode).toBe(editable.ModifyMode);
  } finally {
    native.finalize();
  }
});
