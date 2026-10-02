# ES Module Bundles and pydeck

Some deck.gl-community packages publish a self-contained ES module at `dist/dist.esm.min.js`.
Use it to load a package with a plain `import()` on a page that already runs deck.gl's scripting
bundle, for example a pydeck notebook or HTML export, or a page that loads deck.gl's
`dist.min.js`.

The regular `dist/index.js` entry point can't be loaded this way: it imports deck.gl, luma.gl and
loaders.gl by bare specifiers, which browsers can't resolve without an import map. CDNs that
rewrite those imports (esm.sh, jsDelivr `+esm`) load a second copy of deck.gl, so the layers don't
extend the page's `Layer` class.

## Available bundles

| Package                              | Bundle URL                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `@deck.gl-community/layers`          | `https://unpkg.com/@deck.gl-community/layers@~9.4.0/dist/dist.esm.min.js`          |
| `@deck.gl-community/infovis-layers`  | `https://unpkg.com/@deck.gl-community/infovis-layers@~9.4.0/dist/dist.esm.min.js`  |
| `@deck.gl-community/timeline-layers` | `https://unpkg.com/@deck.gl-community/timeline-layers@~9.4.0/dist/dist.esm.min.js` |
| `@deck.gl-community/geo-layers`      | `https://unpkg.com/@deck.gl-community/geo-layers@~9.4.0/dist/dist.esm.min.js`      |
| `@deck.gl-community/basemap-layers`  | `https://unpkg.com/@deck.gl-community/basemap-layers@~9.4.0/dist/dist.esm.min.js`  |
| `@deck.gl-community/experimental`    | `https://unpkg.com/@deck.gl-community/experimental@~9.4.0/dist/dist.esm.min.js`    |
| `@deck.gl-community/three`           | `https://unpkg.com/@deck.gl-community/three@~9.4.0/dist/dist.esm.min.js`           |

Use the same minor version as the page's deck.gl. Bundles are published starting with the first
release after v9.4.0-alpha.3.

## What the bundle contains

- deck.gl, luma.gl and loaders.gl modules that deck.gl's scripting bundle exposes are not
  included. The bundle reads them from the page's `deck`, `luma` and `loaders` globals, so its
  layers extend the page's own deck.gl classes. These are `@deck.gl/core`, `layers`, `extensions`,
  `aggregation-layers`, `geo-layers`, `mesh-layers` and `widgets`, plus the parts of
  `@luma.gl/core`, `@luma.gl/engine` and `@loaders.gl/core` listed in deck.gl's
  `scripting/lumagl.ts` and `scripting/loadersgl.ts`.
- All other dependencies are included, for example math.gl, `@luma.gl/shadertools`, turf and h3-js.
- The bundle sets no globals of its own.

## Usage in pydeck

```python
import pydeck as pdk

pdk.settings.register_library(
    "deckCommunityLayers",
    "https://unpkg.com/@deck.gl-community/layers@~9.4.0/dist/dist.esm.min.js",
    module=True,
)

layer = pdk.Layer(
    "PathOutlineLayer",
    data=[{"path": [[-122.45, 37.75], [-122.35, 37.85]]}],
    get_path="path",
    get_color=[0, 128, 255],
    get_width=4,
    width_units="pixels",
)
```

pydeck imports the module, exposes its namespace as `window.deckCommunityLayers`, and registers
the exported layer and extension classes, so you can refer to them by name.

## Usage in HTML

```html
<script src="https://unpkg.com/deck.gl@~9.4.0/dist.min.js"></script>
<script type="module">
  const {PathOutlineLayer} = await import(
    'https://unpkg.com/@deck.gl-community/layers@~9.4.0/dist/dist.esm.min.js'
  );

  new deck.Deck({
    initialViewState: {longitude: -122.4, latitude: 37.8, zoom: 11},
    controller: true,
    layers: [
      new PathOutlineLayer({
        id: 'paths',
        data: [{path: [[-122.45, 37.75], [-122.35, 37.85]]}],
        getPath: d => d.path,
        getColor: [0, 128, 255],
        getWidth: 4,
        widthUnits: 'pixels'
      })
    ]
  });
</script>
```

## Limitations

deck.gl's scripting bundle exposes only part of luma.gl and loaders.gl, so a few classes can't be
used from the ES module bundles:

- `SkyboxLayer` (`layers`) needs luma.gl `ShaderInputs` and `DynamicTexture`.
- `ParticleLayer` and `WindLayer` (`geo-layers`) need luma.gl `Computation` for their GPU particle
  simulation.

Packages that need dependencies the page doesn't provide have no ES module bundle:
`editable-layers` (`h3-js`), `graph-layers` (`zod`), `widgets` and `panels`, `react`,
`react-fiber`, and `leaflet`.

## Building bundles

Packages opt in with a `build` script that runs `scripts/build-esm-bundle.mjs`, so `yarn build`
builds every bundle. The script fails if a package imports a deck.gl name the page doesn't
provide, imports a peer dependency that has no page global, or would include a copy of deck.gl,
luma.gl core or loaders.gl core. It warns about luma.gl and loaders.gl names that the page
doesn't expose.
