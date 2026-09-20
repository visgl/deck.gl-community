// deck.gl-community
// SPDX-License-Identifier: MIT
import {
  _GlobeView,
  type DeckProps,
  FirstPersonView,
  MapView,
  OrbitView,
  OrthographicView,
  type View
} from '@deck.gl/core';
import {z} from 'zod';
import {createDeckGLDocumentSchema} from '../schemas/deckgl';
import {
  FirstPersonViewSchema,
  GlobeViewSchema,
  MapViewSchema,
  OrbitViewSchema,
  OrthographicViewSchema
} from '../schemas/views';
import type {PlaygroundBindings, PlaygroundRegistry} from './playground-registry';
import type {PlaygroundBindingProvider} from './playground-source-bindings';

const CORE_VIEWS: NonNullable<PlaygroundRegistry['views']> = {
  MapView: {type: MapView, schema: MapViewSchema},
  _GlobeView: {type: _GlobeView, schema: GlobeViewSchema},
  OrbitView: {type: OrbitView, schema: OrbitViewSchema},
  OrthographicView: {type: OrthographicView, schema: OrthographicViewSchema},
  FirstPersonView: {type: FirstPersonView, schema: FirstPersonViewSchema}
};
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const PATH_PATTERN = '(?:[A-Za-z_$][\\w$]*|\\d+)(?:\\.(?:[A-Za-z_$][\\w$]*|\\d+)|\\[\\d+\\])*';
const EXPRESSION_PATTERN = new RegExp(
  `^(${PATH_PATTERN})(?:\\s*([+\\-*/])\\s*(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+\\-]?\\d+)?))?$`
);

/** A validated configuration ready to apply to a persistent Deck instance. */
export type ResolvedPlaygroundConfiguration = {
  /** Constructed layers/views and resolved renderer options. */
  props: Omit<Partial<DeckProps>, 'views'> & {views?: View[]};
  /** Layer IDs associated with external bindings, used to report picked row identity. */
  layerBindings: Map<string, string>;
  /** Accepted row descriptors for referenced sources, including per-instance overrides. */
  bindings: PlaygroundBindings;
};

/** An unavailable external source, distinct from an invalid visualization document. */
export class PlaygroundDataSourceError extends Error {
  constructor(
    /** The source whose availability prevented rendering. */
    readonly sourceId: string,
    /** Whether the source is missing, still loading, or failed to load. */
    readonly status: 'missing' | 'loading' | 'error',
    /** All source names referenced by the validated document, for automatic recovery. */
    readonly sourceIds: readonly string[],
    cause?: Error
  ) {
    super(
      status === 'missing'
        ? `Missing playground data binding: ${sourceId}`
        : status === 'loading'
          ? `Loading playground data source: ${sourceId}`
          : `Failed playground data source: ${sourceId}: ${cause?.message}`,
      {cause}
    );
    this.name = 'PlaygroundDataSourceError';
  }
}

/** Runtime validation and editor diagnostics derived from one constructor registry. */
export type PlaygroundResolver = {
  /** JSON Schema containing only registered layers and supported views. */
  jsonSchema: Record<string, unknown>;
  /** Validates before constructing layers/views; preserves inline and external row references. */
  resolve: (
    value: unknown,
    bindings: PlaygroundBindings,
    dataSources?: PlaygroundBindingProvider
  ) => ResolvedPlaygroundConfiguration;
};

/**
 * Creates a schema-backed resolver for the built-in renderer.
 *
 * Accessors support own-property paths and one numeric arithmetic operation. This resolver
 * never evaluates JavaScript source. Registered factories and constructors are trusted host
 * code. Nested class resources must be supplied through constants rather than `@@type`.
 * The runtime schema excludes basemap styling and requires a nonempty view list when supplied.
 */
export function createPlaygroundResolver(registry: PlaygroundRegistry): PlaygroundResolver {
  const layers = {...registry.layers};
  const views = {...CORE_VIEWS, ...registry.views};
  const accessors = new Map<string, (row: unknown) => unknown>();
  const viewSchema = createSchemaUnion(Object.values(views).map(entry => entry.schema));
  const schema = createDeckGLDocumentSchema(
    createSchemaUnion(Object.values(layers).map(entry => entry.schema)),
    viewSchema
  )
    .omit({mapStyle: true})
    .extend({views: z.union([viewSchema, z.array(viewSchema).min(1)]).optional()});
  const jsonSchema = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    reused: 'ref',
    override: ({jsonSchema: output, zodSchema}) => {
      delete output.id;
      if (zodSchema instanceof z.ZodTuple && !zodSchema.def.rest) {
        output.minItems = zodSchema.def.items.length;
        output.maxItems = zodSchema.def.items.length;
        output.items = false;
      }
    }
  });

  function resolveValue(value: unknown): unknown {
    if (typeof value === 'string') {
      if (value.startsWith('@@=')) {
        const expression = value.slice(3).trim();
        let accessor = accessors.get(expression);
        if (!accessor) {
          accessor = createAccessor(expression);
          accessors.set(expression, accessor);
        }
        return accessor;
      }
      if (value.startsWith('@@#')) {
        return resolveReference(registry.constants ?? {}, value.slice(3), 'constant');
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(resolveValue);
    if (!isRecord(value)) return value;
    if (Object.hasOwn(value, '@@type')) {
      throw new Error('Nested @@type resources are unsupported; register a constant instead');
    }
    if (Object.hasOwn(value, '@@data')) {
      throw new Error('External bindings are only supported in a layer data property');
    }
    if (Object.hasOwn(value, '@@function')) {
      const name = value['@@function'];
      if (typeof name !== 'string') throw new Error('A function reference requires a name');
      const factory = resolveReference(registry.functions ?? {}, name, 'function');
      if (typeof factory !== 'function') throw new Error(`Invalid registered function: ${name}`);
      return factory(resolveProperties(value, ['@@function']));
    }
    return resolveProperties(value);
  }

  function resolveProperties(value: Record<string, unknown>, omit: string[] = []) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !omit.includes(key))
        .map(([key, child]) => [key, resolveValue(child)])
    );
  }

  return {
    jsonSchema,
    resolve(value, bindings, dataSources) {
      const document = schema.parse(value) as Record<string, unknown>;
      const sourceLayers = (value as {layers?: Record<string, unknown>[]}).layers ?? [];
      const layerBindings = new Map<string, string>();
      const resolvedBindings: PlaygroundBindings = Object.create(null);
      const ids = new Set<string>();
      const layerDefinitions = (document.layers ?? []) as Record<string, unknown>[];
      const preparedLayers = layerDefinitions.map((definition, index) => {
        const name = String(definition['@@type']);
        const {type} = getRegistration(layers, name, 'layer');
        const id = definition.id;
        if (typeof id !== 'string' || !id) {
          throw new Error(`Playground layer requires a nonempty id: ${name}`);
        }
        if (ids.has(id)) throw new Error(`Duplicate playground layer id: ${id}`);
        ids.add(id);
        const props = resolveProperties(definition, ['@@type', 'data', 'id']);
        props.id = id;
        if (Object.hasOwn(definition, 'data')) {
          // Keep the original rows: schema parsing may apply defaults, but also clones JSON.
          const source = sourceLayers[index];
          const data = source && Object.hasOwn(source, 'data') ? source.data : definition.data;
          if (isRecord(data) && Object.hasOwn(data, '@@data')) {
            const bindingName = String(data['@@data']);
            const hasOverride = Object.hasOwn(bindings, bindingName);
            const binding = hasOverride ? bindings[bindingName] : dataSources?.get(bindingName);
            if (hasOverride || binding !== undefined) {
              if (!binding || !Array.isArray(binding.data)) {
                throw new Error(`Playground data binding must contain a row array: ${bindingName}`);
              }
              props.data = binding.data;
              resolvedBindings[bindingName] = binding;
            }
            layerBindings.set(id, bindingName);
          } else {
            // Payloads are opaque: a row's expression-like text is ordinary data.
            props.data = data;
          }
        }
        return {type, props};
      });
      const viewDefinitions = document.views
        ? Array.isArray(document.views)
          ? document.views
          : [document.views]
        : [];
      const preparedViews = viewDefinitions.map((definition: Record<string, unknown>) => {
        const props = resolveProperties(definition, ['@@type', 'id']);
        if (Object.hasOwn(definition, 'id')) props.id = definition.id;
        const {type} = getRegistration(views, String(definition['@@type']), 'view');
        return {type, props};
      });
      const props = resolveProperties(document, ['layers', 'views']);
      const sourceIds = [...new Set(layerBindings.values())];
      const unavailable = sourceIds.filter(name => !Object.hasOwn(resolvedBindings, name));
      if (unavailable.length) {
        const sourceId =
          unavailable.find(name => dataSources?.getState(name)?.status !== 'loading') ??
          unavailable[0];
        const state = dataSources?.getState(sourceId);
        throw new PlaygroundDataSourceError(
          sourceId,
          state?.status === 'ready' ? 'missing' : (state?.status ?? 'missing'),
          sourceIds,
          state?.status === 'error' ? state.error : undefined
        );
      }
      props.layers = preparedLayers.map(({type, props}) => new type(props));
      if (Object.hasOwn(document, 'views')) {
        props.views = preparedViews.map(({type, props}) => new type(props));
      }
      return {
        props: props as ResolvedPlaygroundConfiguration['props'],
        layerBindings,
        bindings: resolvedBindings
      };
    }
  };
}

function createSchemaUnion(schemas: z.ZodType[]): z.ZodType {
  if (schemas.length === 0) return z.never();
  if (schemas.length === 1) return schemas[0];
  return z.union([schemas[0], schemas[1], ...schemas.slice(2)]);
}

function getRegistration<T>(registry: Record<string, T>, name: string, kind: string): T {
  if (!Object.hasOwn(registry, name)) throw new Error(`Unknown playground ${kind}: ${name}`);
  return registry[name];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function splitPath(path: string): string[] {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  if (keys.some(key => FORBIDDEN_KEYS.has(key))) {
    throw new Error(`Forbidden playground property path: ${path}`);
  }
  return keys;
}

function readPath(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function resolveReference(registry: Record<string, unknown>, name: string, kind: string): unknown {
  const keys = splitPath(name);
  if (Object.hasOwn(registry, name)) return registry[name];
  const result = readPath(registry, keys);
  if (result === undefined) throw new Error(`Unknown playground ${kind}: ${name}`);
  return result;
}

function createAccessor(expression: string): (row: unknown) => unknown {
  const match = EXPRESSION_PATTERN.exec(expression);
  if (!match) throw new Error(`Unsupported playground expression: ${expression}`);
  const [, path, operator, operandText] = match;
  const keys = splitPath(path);
  if (!operator) return row => readPath(row, keys);
  const operand = Number(operandText);
  if (!Number.isFinite(operand)) {
    throw new Error(`Unsupported playground numeric operand: ${operandText}`);
  }
  return row => {
    const value = readPath(row, keys);
    if (typeof value !== 'number') return undefined;
    if (operator === '+') return value + operand;
    if (operator === '-') return value - operand;
    if (operator === '*') return value * operand;
    return value / operand;
  };
}
