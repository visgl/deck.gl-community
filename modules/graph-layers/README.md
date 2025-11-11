# graph-layers

TBD

<p align="center">
  <img src="https://i.imgur.com/BF9aOEu.png" height="400" />
</p>

## GraphML loader

`@deck.gl-community/graph-layers` ships a utility for loading GraphML documents into the
`TabularGraph` runtime via `loadGraphML`. The loader is designed for GraphML 1.0 documents and
supports the following constructs:

- `<graph>` elements with `edgedefault` set to either `directed` or `undirected`.
- `<node>` and `<edge>` elements with required identifiers and edge endpoints.
- `<key>` declarations scoped to `node`, `edge`, or `all` domains, including `<default>` values.
- `<data>` entries attached to nodes or edges that reference GraphML keys. Values are converted to
  numbers or booleans when a key declares `attr.type` of `int`, `long`, `float`, `double`, or
  `boolean`. Unrecognized types fall back to strings.

The loader intentionally ignores unsupported GraphML features such as hyperedges, ports, or nested
graphs. Data blocks that contain nested XML are preserved as serialized JSON strings inside the
resulting attribute map so applications can continue to access vendor-specific payloads.
