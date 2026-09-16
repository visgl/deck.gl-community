# `@deck.gl-community/playground`

`@deck.gl-community/playground` provides a standalone JSON editor and live preview surface for
deck.gl applications. It is built on [`@deck.gl-community/panels`](/docs/modules/panels), so it can
be installed in applications that do not use React or deck.gl's widget manager.

## Installation

```bash
npm install @deck.gl-community/playground @deck.gl-community/panels
```

## Usage

Pass named JSON templates to `Playground` and use `render` to turn valid documents into an
application-specific preview:

```ts
import {Playground} from '@deck.gl-community/playground';

const playground = new Playground({
  parentElement: document.getElementById('playground')!,
  templates: {
    Points: {points: [{position: [-122.4, 37.8]}]}
  },
  render(previewElement, value) {
    // Create or update the preview from value.
  }
});

// Later, when the host is removed:
playground.finalize();
```

The [deck.gl playground example](/examples/playground) shows the package driving a live
`ScatterplotLayer` preview. See the [Playground API reference](./api-reference/playground.md) for
the complete lifecycle and callback options.
