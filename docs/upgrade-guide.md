# Upgrade Guide

Modules in `@deck.gl-community` are independently maintained, so this page will only list occasional major changes.

Please refer the documentation of each module for detailed upgrade guides.


## v9.2

### `@deck.gl-community/graph-layers`

- Deprecation: Graph style constants are now defined using literals instead of objects
  - Replace deprecated `NODE_TYPE.CIRCLE` with `'circle'`, `EDGE_TYPE.LINE` with `'line'` etc.
- Deprecation: `GraphLayer` now groups styling under a `stylesheet` prop
  - Replace `nodeStyle` / `edgeStyle` with `stylesheet.nodes` and `stylesheet.edges`
- Deprecation: `graph` prop on `GraphLayer` is being phased out. Provide graphs via the `data` prop instead (supports `GraphEngine`,
  `Graph`, or raw `{nodes, edges}`/edge arrays) and supply a `layout` when the layer must build the engine for you.
- Breaking change: `JSONLoader` only normalizes raw JSON payloads. Pass `Graph` instances directly to `GraphLayer.data` rather than
  routing them through the loader.

