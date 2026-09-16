# @deck.gl-community/playground

An installable JSON playground surface for deck.gl applications. It provides a
Monaco-backed editor and template selector using `@deck.gl-community/panels`,
and leaves preview rendering to the host application.

```ts
import {Playground} from '@deck.gl-community/playground';

const playground = new Playground({
  parentElement: document.querySelector('#app')!,
  templates: {scatterplot: {layers: []}},
  render: (element, value) => {
    // Create or update a Deck instance in element using value.
  }
});
```

The package does not require React. Install `@deck.gl/core` alongside it when
the preview is rendered with deck.gl.
