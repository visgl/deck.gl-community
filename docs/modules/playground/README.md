# `@deck.gl-community/playground`

`@deck.gl-community/playground` is currently a private workspace package providing a standalone JSON editor and live preview surface for
deck.gl applications. It is built on [`@deck.gl-community/panels`](/docs/modules/panels), so it can
be used in applications that do not use React or deck.gl's widget manager.

## Installation

The package is not published yet; use it from this repository as a workspace.

## Usage

Pass named JSON templates, layer constructors with matching schemas, and optional host-owned rows
to `DeckPlayground`:

```ts
import {ScatterplotLayer} from '@deck.gl/layers';
import {DeckPlayground, ScatterplotLayerSchema} from '@deck.gl-community/playground';

const playground = new DeckPlayground({
  parentElement: document.getElementById('playground')!,
  registry: {
    layers: {ScatterplotLayer: {type: ScatterplotLayer, schema: ScatterplotLayerSchema}}
  },
  bindings: {
    points: {data: [{id: 'pier', position: [-122.4, 37.8]}]}
  },
  templates: {
    Points: {
      initialViewState: {longitude: -122.4, latitude: 37.8, zoom: 10},
      controller: true,
      layers: [{
        '@@type': 'ScatterplotLayer',
        id: 'points',
        data: {'@@data': 'points'},
        getPosition: '@@=position',
        getRadius: 100,
        getFillColor: [40, 120, 220]
      }]
    }
  },
  onError(error) {
    console.error(error.message);
  }
});

// Supply fresh rows while preserving the editor and camera.
playground.setBindings({points: {data: [{id: 'harbor', position: [-122.41, 37.81]}]}});

// Later, when the host is removed:
playground.finalize();
```

The editor's diagnostics use the registered schemas. Accepted edits update the same Deck instance
and canvas, while invalid JSON or configurations retain the last accepted preview. The host can
observe picking and camera events, replace bindings, and explicitly reset the camera.

Use `Playground` when the application supplies its own preview renderer. Existing `render` callbacks
remain supported; a persistent `renderer` can keep application resources across edits.

The package also exports GeoJSON and deck.gl schemas for standalone validation and editor tooling.
The generated [`geojson-schema.json`](./api-reference/geojson-schema.md) artifact is available to
Monaco and other JSON editors. See the [Playground API reference](./api-reference/playground.md)
for lifecycle, registry, binding, and callback details, and the
[host bindings example](https://github.com/visgl/deck.gl-community/blob/master/examples/playground/host-bindings.ts)
for an imperative mount function with row replacement, picking, and camera reset.
