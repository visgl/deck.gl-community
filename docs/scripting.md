# Script Tags and pydeck

Some deck.gl-community packages publish a standalone UMD bundle at `dist/dist.min.js`. Use it
when you can't use a bundler: a plain HTML page, an online code editor, or pydeck's
`custom_libraries`.

## Available bundles

| Package                               | Global                        | Bundle URL                                                          |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| `@deck.gl-community/layers`           | `deckCommunityLayers`         | `https://unpkg.com/@deck.gl-community/layers@9.4/dist/dist.min.js`          |
| `@deck.gl-community/infovis-layers`   | `deckCommunityInfovisLayers`  | `https://unpkg.com/@deck.gl-community/infovis-layers@9.4/dist/dist.min.js`  |
| `@deck.gl-community/timeline-layers`  | `deckCommunityTimelineLayers` | `https://unpkg.com/@deck.gl-community/timeline-layers@9.4/dist/dist.min.js` |
| `@deck.gl-community/editable-layers`  | `deckCommunityEditableLayers` | `https://unpkg.com/@deck.gl-community/editable-layers@9.4/dist/dist.min.js` |
| `@deck.gl-community/leaflet`          | `deckCommunity`               | `https://unpkg.com/@deck.gl-community/leaflet@9.4/dist/dist.min.js`         |

Pin a version that includes the bundle. Bundles are published starting with the first release
after v9.4.0-alpha.3. The `leaflet` bundle is older and has always been published.

## Global names

Each bundle assigns exactly one global. The name is `deckCommunity` followed by the package name
in PascalCase, so `@deck.gl-community/editable-layers` becomes `deckCommunityEditableLayers`.
Because every package has its own name, you can load several community bundles on one page
without one overwriting another.

The `leaflet` bundle keeps its original `deckCommunity` global for backward compatibility.

## Usage in HTML

Load deck.gl's standalone bundle first. Community bundles do not include deck.gl, luma.gl or
loaders.gl. They use the `deck`, `luma` and `loaders` globals that deck.gl's bundle defines.

```html
<script src="https://unpkg.com/deck.gl@9.4/dist.min.js"></script>
<script src="https://unpkg.com/@deck.gl-community/layers@9.4/dist/dist.min.js"></script>
<script>
  const {PathOutlineLayer} = deckCommunityLayers;

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

## Usage in pydeck

Set `libraryName` to the bundle's global. pydeck waits for that global to be assigned, then
registers the bundle's layer and extension classes so you can refer to them by name.

```python
import pydeck as pdk

pdk.settings.custom_libraries = [
    {
        "libraryName": "deckCommunityLayers",
        "resourceUri": "https://unpkg.com/@deck.gl-community/layers@9.4/dist/dist.min.js",
    }
]

layer = pdk.Layer(
    "PathOutlineLayer",
    data=[{"path": [[-122.45, 37.75], [-122.35, 37.85]]}],
    get_path="path",
    get_color=[0, 128, 255],
    get_width=4,
    width_units="pixels",
)
```

## Limitations

- **`SkyboxLayer`** isn't usable from the `layers` bundle. It needs luma.gl APIs (`ShaderInputs`
  and `DynamicTexture`) that deck.gl's standalone bundle doesn't expose. Install the package from
  npm to use it.
- **`EditableH3ClusterLayer`** needs `h3-js`. Load `https://unpkg.com/h3-js@^4` before the
  `editable-layers` bundle.
- **AMD loaders.** If a page defines an AMD `define` function, for example with RequireJS in
  classic Jupyter Notebook, a UMD bundle registers itself as an AMD module instead of assigning its
  global. deck.gl's own `dist.min.js` behaves the same way.
- **Other packages** don't publish a bundle yet. They might have heavy third-party dependencies,
  set extra globals, or need luma.gl APIs that deck.gl's bundle doesn't expose. For example,
  `graph-layers` bundles a dependency that assigns `window.solver`.

## Building bundles

Packages opt in with a `build-bundle` script, which `prepublishOnly` runs during release. To build
every bundle locally:

```bash
yarn build
yarn build-bundles
```

Bundles are configured in `.ocularrc.js`:

- The `bundle.globals` map lists which packages are provided by deck.gl's standalone bundle.
- Every other dependency, including peer dependencies such as `@luma.gl/constants`, is included
  in the community bundle.
