# Playground

`Playground` mounts a template selector, a JSON editor, and an application-owned preview area.

```ts
import {Playground} from '@deck.gl-community/playground';

const playground = new Playground({
  parentElement,
  templates: {Default: {layers: []}},
  onChange(value, text) {
    console.log(value, text);
  },
  render(previewElement, value) {
    // Render value into previewElement and optionally return cleanup.
    return () => {};
  }
});
```

## `PlaygroundProps`

- `parentElement`: host element for the editor and preview.
- `templates`: named JSON objects or text documents.
- `initialTemplate`: optional initial template name.
- `parse`: optional parser replacing `JSON.parse`.
- `onChange`: called for valid edited documents.
- `render`: called for valid documents; may return a cleanup function.

Call `finalize()` when the host is no longer needed.
