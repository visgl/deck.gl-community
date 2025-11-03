# GraphGL

<p align="center">
  <img src="/gatsby/images/graph.png" height="200" />
</p>

### Usage

```js
import GraphGL, {JSONLoader, D3ForceLayout} from '@deck.gl-community/graph-layers';

const App = ({data}) => {
  const graph = JSONLoader({
    json: data,
    nodeParser: (node) => ({id: node.id}),
    edgeParser: (edge) => ({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      directed: true
    })
  });
  return (
    <GraphGL
      graph={graph}
      layout={new D3ForceLayout()}
      stylesheet={{
        nodes: [
          {
            type: 'circle',
            radius: 10,
            fill: 'blue',
            opacity: 1
          },
          {
            type: 'label',
            text: '@id',
            color: '#ffffff',
            offset: [0, 18]
          }
        ],
        edges: {
          stroke: 'black',
          strokeWidth: 2
        }
      }}
      enableDragging
    />
  );
};
```

### `graph` (Graph, required)

The graph data will need to be processed through JSONLoader and converted into `Graph` object. The expected data should be an object includes two arrays: `nodes` and `edges`. Each node require an unique `id`. Each edge should have `id` as edge ID, `sourceId` as the ID of the source node, and `targetId` as the ID of the target node. For example:

```js
const data = {
  nodes: [{id: '1'}, {id: '2'}, {id: '3'}],
  edges: [
    {id: 'e1', sourceId: '1', targetId: '2'},
    {id: 'e2', sourceId: '1', targetId: '3'},
    {id: 'e3', sourceId: '2', targetId: '3'}
  ]
};
```

Then, you can convert the data into `Graph` by `JSONLoader`:

```js
import {JSONLoader} from '@deck.gl-community/graph-layers';
const graph = JSONLoader({json: data});
```

### `layout` (Layout, required)

Use one of the layouts provided by @deck.gl-community/graph-layers or create a new custom layout class by following the instruction. For more detail, please see the Layout docs/api-reference/layout section.

### `initialViewState` (Object, optional)

For more detail, please see /docs/api-reference/viewport.

### `stylesheet` (Object, required)

Declarative style description for nodes and edges. Supply `nodes` as an array of
style layers and `edges` as either a single object or an array when stacking edge
passes. Use attribute bindings such as `text: '@label'` to read directly from
graph metadata. See the [styling reference](../../../../api-reference/styling/graph-stylesheet.md)
for supported properties.

### `nodeEvents` (Object, optional)

For more detail, please see the interactions reference /docs/api-reference/interactions.

### `edgeEvents` (Object, optional)

For more detail, please see api-reference interactions docs/api-reference/interactions.
