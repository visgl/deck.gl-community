# `@deck.gl-community/playground`

`@deck.gl-community/playground` is currently a private workspace package providing a standalone JSON editor and live preview surface for
deck.gl applications. It is built on [`@deck.gl-community/panels`](/docs/modules/panels), so it can
be used in applications that do not use React or deck.gl's widget manager.

## Installation

The package is not published yet; use it from this repository as a workspace.

## Usage

Pass named JSON templates to `Playground` and use `render` to turn valid documents into an
application-specific preview:

```ts
import {Playground} from '@deck.gl-community/playground';
import geojsonSchema from '@deck.gl-community/playground/geojson-schema.json';

const playground = new Playground({
  parentElement: document.getElementById('playground')!,
  templates: {
    Points: {points: [{position: [-122.4, 37.8]}]}
  },
  jsonSchema: geojsonSchema,
  render(previewElement, value) {
    // Create or update the preview from value.
  }
});

// Later, when the host is removed:
playground.finalize();
```

The generated [`geojson-schema.json`](./api-reference/geojson-schema.md) artifact can be loaded by
Monaco, editors, and other JSON tooling. See the [Playground API reference](./api-reference/playground.md)
for the complete lifecycle and callback options.
