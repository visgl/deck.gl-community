# Layouts

The `@deck.gl-community/graph-layers` package ships a handful of layouts, but every application eventually needs custom geometry or physics. This guide walks through the lifecycle of a layout and shows how to build, test, and ship your own implementation.

## When to build a custom layout

Use a bespoke layout when any of the following are true:

- You have domain-specific rules (hierarchies, timelines, geographic projections) that the stock layouts cannot express.
- You need to integrate an existing solver or physics engine and expose its parameters through `GraphLayer` props.
- You want to preprocess server-side coordinates (e.g. a recommendation engine) and simply stream them into the client.

Before writing code, review the [`GraphLayout` API reference](../../graph-layers/api-reference/layouts/graph-layout.md) to understand the contract between the layout and `GraphLayer`.

## Tutorial: build a layout from scratch

The snippets below sketch a `SpiralLayout` that spreads nodes along a spiral arm. Each section focuses on one part of the [`GraphLayout`](../../graph-layers/api-reference/layouts/graph-layout.md) lifecycle.

### 1. Extend `GraphLayout`

Create a class that extends `GraphLayout` (optionally passing a props interface) and seed internal state you will reuse across lifecycle calls.

```js
import {GraphLayout, GraphLayoutProps} from '@deck.gl-community/graph-layers';

export type SpiralLayoutProps = GraphLayoutProps & {
  radiusStep?: number;
  angleStep?: number;
};

export class SpiralLayout extends GraphLayout<SpiralLayoutProps> {
  get [Symbol.toStringTag]() {
    return 'SpiralLayout';
  }

  static defaultProps: Required<SpiralLayoutProps> = {
    ...GraphLayout.defaultProps,
    radiusStep: 20,
    angleStep: Math.PI / 6
  };

  constructor(props: SpiralLayoutProps = {}) {
    super(props, SpiralLayout.defaultProps);
    this._nodePositions = new Map();
  }
}
```

### 2. Respond to graph lifecycle hooks

`GraphLayer` feeds data into your layout via `initializeGraph` (first load) and `updateGraph` (incremental updates). Cache any graph references you need and make sure `updateGraph` works even when the topology changes.

```js
initializeGraph(graph) {
  this._graph = graph;
  this._nodePositions.clear();
}

updateGraph(graph) {
  this._graph = graph;
  for (const node of graph.getNodes()) {
    if (!this._nodePositions.has(node.getId())) {
      this._nodePositions.set(node.getId(), null);
    }
  }
}
```

The `GraphLayout` base class exposes `_updateBounds()` and `_calculateBounds()` helpers. Override `_updateBounds` when your layout derives bounds that differ from the raw node positions (for example, when padding edges or projecting coordinates).

### 3. Emit lifecycle events

Call `_onLayoutStart`, `_onLayoutChange`, and `_onLayoutDone` during your computations. These hooks notify React components, power loading indicators, and keep [`GraphLayoutEventDetail`](../../graph-layers/api-reference/layouts/graph-layout.md#the-layout-lifecycle) data in sync.

```js
start() {
  if (!this._graph) {
    return;
  }
  this.state = 'start';
  this._onLayoutStart();

  const positions = [];
  let index = 0;
  for (const node of this._graph.getNodes()) {
    const radius = this.props.radiusStep * (index + 1);
    const angle = this.props.angleStep * index++;
    const nextPosition = [Math.cos(angle) * radius, Math.sin(angle) * radius];
    this._nodePositions.set(node.getId(), nextPosition);
    positions.push(nextPosition);
  }

  this._bounds = this._calculateBounds(positions);
  this.state = 'done';
  this._onLayoutChange();
  this._onLayoutDone();
}

update() {
  // For this deterministic layout, recomputing is identical to start().
  this.start();
}

stop() {
  this.state = 'done';
}
```

For long-running solvers (such as force-directed layouts), call `_onLayoutChange` inside your simulation loop so the view can animate.

### 4. Publish node and edge geometry

`GraphLayer` queries positions every render. Implement `getNodePosition` and `getEdgePosition` so they return finite coordinates when available.

```js
getNodePosition(node) {
  return this._nodePositions.get(node.getId()) ?? null;
}

getEdgePosition(edge) {
  const source = this.getNodePosition(edge.getSourceNode());
  const target = this.getNodePosition(edge.getTargetNode());
  if (!source || !target) {
    return null;
  }
  return {
    type: 'line',
    sourcePosition: source,
    targetPosition: target,
    controlPoints: []
  };
}
```

When returning `null`, the layer hides unfinished primitives, allowing incremental solvers to display partial results without jitter.

### 5. Handle user interactions

If your UI supports drag-and-drop, override the interaction hooks:

```js
lockNodePosition(node, x, y) {
  this._nodePositions.set(node.getId(), [x, y]);
}

unlockNodePosition(node) {
  this._nodePositions.delete(node.getId());
}

resume() {
  // Restart your solver here (e.g. re-enable a physics simulation).
  this.start();
}
```

### 6. Wire the layout into `GraphLayer`

Finally, instantiate your layout and pass it to `GraphLayer`. You can hot-swap layouts by comparing instances with `layout.equals`.

```jsx
import {GraphLayer} from '@deck.gl-community/graph-layers';
import {SpiralLayout} from './spiral-layout';

const layout = new SpiralLayout({radiusStep: 30});

<GraphLayer
  id="spiral-graph"
  graph={graph}
  layout={layout}
  enableDragging
/>;
```

## Recommended testing

Robust layouts lean on automated tests so regressions do not slip in as the ecosystem evolves.

1. **Unit-test deterministic positioning.** Instantiate your layout with a fixture `ClassicGraph` and assert that `getNodePosition` returns finite coordinates and that `_bounds` reflects the expected extent.
   ```ts
   import {ClassicGraph} from '@deck.gl-community/graph-layers';
   import {describe, expect, it} from 'vitest';
   import {SpiralLayout} from '../spiral-layout';

   describe('SpiralLayout', () => {
     it('computes stable positions', () => {
       const graph = new ClassicGraph({
         nodes: [{id: 'a'}, {id: 'b'}],
         edges: []
       });
       const layout = new SpiralLayout();
       layout.initializeGraph(graph);
       layout.start();
       expect(layout.getNodePosition(graph.getNode('a'))).toBeTruthy();
       expect(layout.getBounds()).not.toBeNull();
     });
   });
   ```
2. **Simulate lifecycle events.** Stub `onLayoutStart` / `onLayoutDone` props and confirm they fire in the right order when `start` or `update` runs.
3. **Exercise drag helpers.** When you expose dragging, verify `lockNodePosition`, `unlockNodePosition`, and `resume` interact correctly with your solver.
4. **Run the repo test suite** (`yarn test-node`) before publishing so the shared CI harness validates your changes.

## Further reading

- [`GraphLayout` API reference](../../graph-layers/api-reference/layouts/graph-layout.md)
- [`SimpleLayout` API reference](../../graph-layers/api-reference/layouts/simple-layout.md) and [source code](https://github.com/visgl/deck.gl-community/blob/main/modules/graph-layers/src/layouts/simple-layout.ts)
- [`D3ForceLayout` API reference](../../graph-layers/api-reference/layouts/d3-force-layout.md) and [source code](https://github.com/visgl/deck.gl-community/blob/main/modules/graph-layers/src/layouts/d3-force/d3-force-layout.ts)
- [`GraphLayer` API reference](../../graph-layers/api-reference/layers/graph-layer.md) for integration details
