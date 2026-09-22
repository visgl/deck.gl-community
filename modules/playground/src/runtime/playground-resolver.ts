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
import {JSONConverter} from '@deck.gl/json';
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
let nextConverterId = 0;

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
  /** Releases this resolver's registrations from JSONConverter's shared catalogs. */
  finalize: () => void;
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
 * Expressions and deferred values use deck.gl's JSONConverter. Row payloads and constructor
 * identifiers remain opaque. Registered factories and constructors are trusted host code.
 * Nested class resources must be supplied through constants rather than `@@type`.
 * The runtime schema excludes basemap styling and requires a nonempty view list when supplied.
 */
export function createPlaygroundResolver(registry: PlaygroundRegistry): PlaygroundResolver {
  const layers = {...registry.layers};
  const views = {...CORE_VIEWS, ...registry.views};
  const namespace = `playground-${nextConverterId++}`;
  const constants = new Map([
    ...Object.entries(registry.enumerations ?? {}).flatMap(([group, values]) =>
      Object.entries(values).map(([name, value]) => [`${group}.${name}`, value] as const)
    ),
    ...Object.entries(registry.constants ?? {})
  ]);
  const constantIds = new Map([...constants.keys()].map((name, index) => [name, String(index)]));
  const functionIds = new Map(
    Object.keys(registry.functions ?? {}).map((name, index) => [name, `${namespace}.${index}`])
  );
  // JSONConverter 9.4 shares catalog storage; namespace entries to isolate playgrounds.
  // Enum slots also preserve falsy constants, which its direct constant lookup skips.
  const converter = new JSONConverter({
    configuration: {
      enumerations: {
        [namespace]: Object.fromEntries(
          [...constants.values()].map((value, index) => [index, value])
        )
      },
      functions: Object.fromEntries(
        [...functionIds].map(([name, id]) => [id, registry.functions![name]])
      )
    }
  });
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

  function prepareValue(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.startsWith('@@#')
        ? `@@#${namespace}.${getReference(constantIds, value.slice(3), 'constant')}`
        : value;
    }
    if (Array.isArray(value)) return value.map(prepareValue);
    if (!isRecord(value)) return value;
    if (Object.hasOwn(value, '@@type')) {
      throw new Error('Nested @@type resources are unsupported; register a constant instead');
    }
    if (Object.hasOwn(value, '@@data')) {
      throw new Error('External bindings are only supported in a layer data property');
    }
    if (Object.hasOwn(value, '@@function')) {
      return {
        ...prepareProperties(value, ['@@function']),
        '@@function': getReference(functionIds, value['@@function'], 'function')
      };
    }
    return prepareProperties(value);
  }

  function prepareProperties(value: Record<string, unknown>, omit: string[] = []) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !omit.includes(key))
        .map(([key, child]) => [key, prepareValue(child)])
    );
  }

  return {
    jsonSchema,
    finalize() {
      delete converter.configuration.config.enumerations[namespace];
      for (const id of functionIds.values()) delete converter.configuration.config.functions[id];
      converter.finalize();
    },
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
        const props = prepareProperties(definition, ['@@type', 'data', 'id']);
        const literalProps: Record<string, unknown> = {id};
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
              literalProps.data = binding.data;
              resolvedBindings[bindingName] = binding;
            }
            layerBindings.set(id, bindingName);
          } else {
            // Payloads are opaque: a row's expression-like text is ordinary data.
            literalProps.data = data;
          }
        }
        return {type, props, literalProps};
      });
      const viewDefinitions = document.views
        ? Array.isArray(document.views)
          ? document.views
          : [document.views]
        : [];
      const preparedViews = viewDefinitions.map((definition: Record<string, unknown>) => {
        const props = prepareProperties(definition, ['@@type', 'id']);
        const literalProps = Object.hasOwn(definition, 'id') ? {id: definition.id} : {};
        const {type} = getRegistration(views, String(definition['@@type']), 'view');
        return {type, props, literalProps};
      });
      // A fresh envelope bypasses JSONConverter's input-identity cache on source updates/retries.
      const converted = converter.convert({
        props: prepareProperties(document, ['layers', 'views']),
        layers: preparedLayers.map(({props}) => props),
        views: preparedViews.map(({props}) => props)
      }) as {
        props: Record<string, unknown>;
        layers: Record<string, unknown>[];
        views: Record<string, unknown>[];
      };
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
      const {props} = converted;
      props.layers = preparedLayers.map(
        ({type, literalProps}, index) => new type({...converted.layers[index], ...literalProps})
      );
      if (Object.hasOwn(document, 'views')) {
        props.views = preparedViews.map(
          ({type, literalProps}, index) => new type({...converted.views[index], ...literalProps})
        );
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

function getReference(ids: Map<string, string>, name: unknown, kind: string): string {
  if (typeof name !== 'string' || !ids.has(name)) {
    throw new Error(`Unknown playground ${kind}: ${String(name)}`);
  }
  return ids.get(name)!;
}
