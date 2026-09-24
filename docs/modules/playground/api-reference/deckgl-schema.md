# deck.gl Schema

The playground bundles Zod schemas for JSON-encoded deck.gl documents, official and community
layers, and core views, without importing layer constructors. The generated official deck.gl JSON
Schema artifact is available from:

```ts
import deckglSchema from '@deck.gl-community/playground/deckgl-schema.json';
import {Playground} from '@deck.gl-community/playground';

new Playground({
  parentElement,
  templates: {Default: {layers: []}},
  jsonSchema: deckglSchema
});
```

## Runtime validation and inferred types

The catalog covers the 35 concrete layers exported by deck.gl 9.4's `layers`,
`aggregation-layers`, `geo-layers`, and `mesh-layers` packages, all 44 public community layers, and
all five concrete core views. Abstract `View`, `Layer`, `_AggregationLayer`, and `_GeoCellLayer`
are not document variants. The package remains private.

Each layer exports a props schema and a discriminated configuration schema. Official layers also
export inferred JSON props types:

```ts
import {
  ScatterplotLayerPropsSchema,
  ScatterplotLayerSchema,
  DeckGLDocumentSchema,
  type ScatterplotLayerProps
} from '@deck.gl-community/playground';

const props: ScatterplotLayerProps = ScatterplotLayerPropsSchema.parse({
  id: 'cities',
  data: '/cities.json',
  getPosition: '@@=[longitude, latitude]',
  getRadius: 100,
  getFillColor: [40, 120, 220],
  radiusUnits: 'meters'
});

ScatterplotLayerSchema.parse({'@@type': 'ScatterplotLayer', ...props});
DeckGLDocumentSchema.parse({layers: [{'@@type': 'ScatterplotLayer', ...props}]});
```

`DeckGLLayerSchemas`, `CommunityLayerSchemas`, and `DeckGLViewSchemas` provide named lookups.
`DeckGLDocumentSchema` covers official layers; the managed renderer composes a document schema
from explicitly registered constructors. Constructor shorthand uses the bundled schema matching
`layerName`; custom layers or aliases supply `{type, schema}`. Community graph `GridLayer` uses the
`GraphGridLayerSchema` and the `GraphGridLayer` discriminator to avoid the official name collision.

Unknown prop names are rejected, including typos and props belonging to another layer. Inheritance is preserved: Trips includes Path
props, GridCell includes Column props, H3 includes Polygon props, and MVT includes Tile and GeoJSON
props. An upstream TypeScript coverage test detects missing or extra props when deck.gl changes.

These types describe JSON before conversion, not live deck.gl constructor arguments. Use deck.gl's
own types for JavaScript callbacks, GPU resources, promises, typed arrays, and layer instances.
Omitted props are left omitted; validation does not inject defaults or fetch data. `id` is required
for layers. Data may be omitted for empty layers; resource-specific inputs such as Terrain's
`elevationData`, Tile3D's URL, WMS's URL, and mesh/scenegraph resources are required.

## Accessors and resources

An accessor validates its constant value (number, color, vector, geometry, or enum) or accepts a
deferred expression/reference. For example, `getRadius: false` and `getFillColor: [300, 0, 0]` fail.

- `"@@=population / 1000"` is a per-row expression.
- `"@@#radius"` refers to a registered constant.
- `{"@@function": "calculateRadius", "base": 2}` invokes a registered function.

`@@function` contains a registered function name, not JavaScript source. Schemas validate these
representations without executing them, checking registry membership, or validating the eventual
return value. The host supplies conversion and rendering. See deck.gl's
[conversion reference](https://deck.gl/docs/api-reference/json/conversion-reference).

Textures and meshes use URLs or registered class descriptors; constants can refer to host-owned
resources. The managed renderer requires constants for live resources and does not construct nested
`@@type` descriptors. For native GeoArrow layers, register an Arrow table as a constant and use
`data: '@@#table'`; geometry vectors can also be registered constants. Browser-tool Arrow imports
materialize JSON rows and do not supply native tables. A5 IDs use strings in JSON because JSON
cannot represent bigint. GPU `parameters`, `loadOptions`, inline row contents, and composite
`_subLayerProps` remain explicitly opaque JSON escape hatches. Built-in extension prop catalogs and live binary resource validation are not included.

## Views and camera state

Constructor props and state have separate schemas. `MapViewPropsSchema` validates `repeat`,
projection settings, controller options, and layout; `MapViewStateSchema` validates longitude,
latitude, zoom, and transitions. Each other concrete view has corresponding props and state schemas.
`DeckGLViewStateSchemas` provides the state lookup by view name.

```json
{
  "views": [{"@@type": "MapView", "id": "map", "repeat": true, "viewState": "camera"}],
  "initialViewState": {"camera": {"longitude": -122, "latitude": 37, "zoom": 10}}
}
```

Inside a view, `viewState` can be a state ID or a partial state override. At document level,
`initialViewState` and `viewState` accept a state or a map of state IDs to states. State entries are
validated against the concrete state union; matching IDs to views remains the host's responsibility.
The document schema covers the playground configuration fields, not every option in `DeckProps`.

Experimental `@@type` values match upstream export names: `_GlobeView`, `_WMSLayer`,
`_MultiIconLayer`, and `_TextBackgroundLayer`. The lookup keys omit the underscore for convenience.

## Custom layers

Extend a props schema and compose an application document schema:

```ts
import {z} from 'zod';
import {
  ScatterplotLayerPropsSchema, DeckGLLayerSchema, DeckGLViewSchema,
  createDeckGLDocumentSchema
} from '@deck.gl-community/playground';

const CustomLayerSchema = ScatterplotLayerPropsSchema.extend({
  '@@type': z.literal('CustomLayer'),
  threshold: z.number()
});
const ApplicationSchema = createDeckGLDocumentSchema(
  z.union([DeckGLLayerSchema, CustomLayerSchema]),
  DeckGLViewSchema
);
```

This preserves the built-in validators and inferred types. Generate application-specific JSON
Schema from your composed schema with Zod; register the corresponding classes with your converter.

For custom views, pass a third argument describing their camera state. The factory uses it for
both `initialViewState` and `viewState`, accepting either a single state or a map of state IDs.
Omitting it preserves the built-in state union. Include that union explicitly when mixing built-in
and custom states:

```ts
import {z} from 'zod';
import {
  DeckGLLayerSchema, DeckGLViewSchema, DeckGLViewStateSchema, createDeckGLDocumentSchema
} from '@deck.gl-community/playground';

const CustomState = z.strictObject({distance: z.number()});
const CustomView = z.strictObject({'@@type': z.literal('CustomView')});
const ApplicationSchema = createDeckGLDocumentSchema(
  DeckGLLayerSchema,
  z.union([DeckGLViewSchema, CustomView]),
  z.union([DeckGLViewStateSchema, CustomState])
);
ApplicationSchema.parse({
  views: [{'@@type': 'CustomView'}],
  initialViewState: {distance: 10}
});
```

The supplied view schema remains responsible for any embedded `viewState` overrides; the third
argument governs document-level state only. Matching state IDs to views remains the host's job.

## Generated artifact

`deckgl-schema.json` uses draft 2020-12, named `$defs`, and the stable identifier
`urn:deck-gl-community:playground:deckgl-schema`. Its build step includes upstream prop descriptions
for editor completions. The generator corrects Zod 4.1's missing fixed-tuple length constraints;
tests validate accepted and rejected documents with both Zod and an independent JSON Schema validator.

JSON Schema validates structure. GeoJSON ring closure and arbitrary-dimensional bbox parity remain
Zod-only checks: standard JSON Schema cannot express those comparisons. Use runtime Zod validation
when those semantic checks are needed; schema annotations alone do not enforce them in Monaco.
