# GraphLayer

`GraphLayer` is a composite layer that renders nodes and edges using a configurable set
of sublayers. It consumes a `GraphEngine` instance and renders the nodes and edges that
the engine exposes.

## Properties

### `data` (async, optional)

The layer accepts raw graph data through the standard `data` prop. The prop is marked as
async by deck.gl, so it supports the same input formats as any async prop:

- An array of edge objects.
- An object containing `{nodes, edges}` arrays.
- A URL or a `Promise` that resolves to either of the above formats.

When `data` is supplied, the layer will build a `Graph` instance using the configured
`graphLoader` (defaults to the `JSONLoader`) and internally
instantiate a `GraphEngine` with the supplied `layout`.

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
  data: 'https://example.com/graph.json' // resolves to {nodes, edges} or an edge array
});
```

> **Note**: A `layout` instance must be provided when using the `data` prop so that the
> layer can create a `GraphEngine` internally.

### `graph`

Alternatively a `Graph` instance can be supplied via the `graph` prop. A
`GraphEngine` is created automatically in the same way as with the `data` prop.

### `graphLoader`

Custom function that converts the resolved `data` into a `Graph` instance. Defaults to
`JSONLoader` which understands the input formats described above.
