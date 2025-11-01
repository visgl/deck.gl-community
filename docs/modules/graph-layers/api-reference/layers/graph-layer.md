# GraphLayer

`GraphLayer` is a composite layer that renders nodes and edges using a configurable set
of sublayers. It can consume a `GraphEngine` instance directly or create one from raw
graph data so the layer can be driven by async loaders.

## Properties

### `data` (async, optional)

The layer accepts graph content through the standard `data` prop. The prop is marked as
async by deck.gl, so it supports the same input formats as any async prop:

- A `GraphEngine` instance. The layer will use it as-is and ignore the `layout` prop.
- A `Graph` instance. Requires the `layout` prop so the layer can create a
  `GraphEngine`.
- An array of edge objects.
- An object containing `{nodes, edges}` arrays.
- A URL or a `Promise` that resolves to any of the above formats.

When raw data is supplied, the layer will build a `Graph` instance using the configured
`graphLoader` (defaults to the `JSONLoader`) and internally instantiate a `GraphEngine`
with the supplied `layout`.

Edge objects can contain any additional metadata. The loader will derive `sourceId` and
`targetId` properties from `sourceId`/`targetId`, `source`/`target` objects, or primitive
endpoint identifiers. If the input only includes edges, nodes are generated from the
edge endpoints automatically. When the input includes a `nodes` array those entries are
used directly.

```js
import {GraphLayer} from '@deck.gl-community/graph-layers';
import {SimpleLayout} from '@deck.gl-community/graph-layers/layouts';

new GraphLayer({
  id: 'graph-layer',
  layout: new SimpleLayout(),
  data: 'https://example.com/graph.json' // resolves to {nodes, edges}, edges, Graph, or GraphEngine
});
```

> **Note**: A `layout` instance must be provided when the resolved `data` is not already
> a `GraphEngine`.

### `graph`

> **Deprecated**: Use the `data` prop instead.

Alternatively a `Graph` instance can be supplied via the `graph` prop. A
`GraphEngine` is created automatically in the same way as with the `data` prop.

### `graphLoader`

Custom function that converts the resolved `data` into a `Graph` instance. Defaults to
`JSONLoader` which understands the input formats described above.
