# GraphLayout

Create a subclass of the `GraphLayout` class to implement a custom layout for the `GraphLayer`.

## Usage

The recommended pattern is to implement a strongly typed subclass that defines its own default props, forwards them to `GraphLayout`, and emits layout lifecycle events when positions change.

```ts
import type {
  ClassicGraph,
  EdgeInterface,
  GraphLayoutProps,
  NodeInterface
} from '@deck.gl-community/graph-layers';
import {GraphLayout} from '@deck.gl-community/graph-layers';

type RandomLayoutProps = GraphLayoutProps & {
  viewportWidth: number;
  viewportHeight: number;
};

type EdgePosition = {
  type: 'line';
  sourcePosition: [number, number];
  targetPosition: [number, number];
  controlPoints: [];
};

export class RandomLayout extends GraphLayout<RandomLayoutProps> {
  static readonly defaultProps: RandomLayoutProps = {
    viewportWidth: 1024,
    viewportHeight: 768
  };

  protected override readonly _name = 'RandomLayout';

  private graph: ClassicGraph | null = null;
  private nodePositions = new Map<string | number, [number, number]>();

  constructor(props: RandomLayoutProps = RandomLayout.defaultProps) {
    super(props, RandomLayout.defaultProps);
  }

  initializeGraph(graph: ClassicGraph): void {
    this.updateGraph(graph);
  }

  updateGraph(graph: ClassicGraph): void {
    this.graph = graph;
    const nextPositions = new Map<string | number, [number, number]>();

    for (const node of graph.getNodes()) {
      const nodeId = node.getId();
      const previous = this.nodePositions.get(nodeId) ?? [0, 0];
      nextPositions.set(nodeId, previous);
    }

    this.nodePositions = nextPositions;
  }

  start(): void {
    this._runLayout();
  }

  update(): void {
    this._runLayout();
  }

  resume(): void {
    this._runLayout();
  }

  stop(): void {}

  getNodePosition(node: NodeInterface): [number, number] | null {
    return this.nodePositions.get(node.getId()) ?? null;
  }

  getEdgePosition(edge: EdgeInterface): EdgePosition {
    const sourcePosition = this.nodePositions.get(edge.getSourceNodeId()) ?? [0, 0];
    const targetPosition = this.nodePositions.get(edge.getTargetNodeId()) ?? [0, 0];

    return {
      type: 'line',
      sourcePosition,
      targetPosition,
      controlPoints: []
    };
  }

  lockNodePosition(node: NodeInterface, x: number, y: number): void {
    this.nodePositions.set(node.getId(), [x, y]);
    this._onLayoutChange();
  }

  unlockNodePosition(node: NodeInterface): void {
    this.nodePositions.delete(node.getId());
    this._onLayoutChange();
  }

  protected override _updateBounds(): void {
    this._bounds = this._calculateBounds(this.nodePositions.values());
  }

  private _runLayout(): void {
    if (!this.graph) {
      return;
    }

    this._onLayoutStart();
    this._randomizePositions();
    this._onLayoutChange();
    this._onLayoutDone();
  }

  private _randomizePositions(): void {
    const {viewportWidth, viewportHeight} = this.props;

    for (const nodeId of this.nodePositions.keys()) {
      this.nodePositions.set(nodeId, [
        Math.random() * viewportWidth,
        Math.random() * viewportHeight
      ]);
    }
  }
}
```

## The layout lifecycle

Graph layouts respond to graph mutations and user interactions through a small set of lifecycle methods and helper utilities.

### Lifecycle phases

A layout transitions through the following phases:

- **Mounting** – `constructor` → `initializeGraph` → `start`
- **Updating** – `updateGraph` → `update`
- **Interruption** – `stop` halts any active run, while `resume` should restart computation (typically by calling `start`).

### Emitting layout events

`GraphLayout` exposes `_onLayoutStart`, `_onLayoutChange`, `_onLayoutDone`, and `_onLayoutError` helpers that notify `GraphLayer` and any user-supplied callbacks. Use them to surface progress:

- Call `_onLayoutStart` before you begin a fresh computation cycle. This transitions the internal state to `calculating` and sends the current bounds to listeners.
- Call `_onLayoutChange` after every iteration that mutates node or edge positions. Invoking this method multiple times during a single run is expected when the layout updates incrementally.
- Call `_onLayoutDone` once an iteration completes and no further updates are pending. This sets the internal state to `done` and re-emits the latest bounds.
- Call `_onLayoutError` when the layout cannot continue (e.g. due to invalid data or an exception).

### GraphLayoutEventDetail

All lifecycle callbacks receive a `GraphLayoutEventDetail` object containing the latest `{bounds}` calculated by the layout:

```ts
type GraphLayoutEventDetail = {
  bounds: [[number, number], [number, number]] | null;
};
```

Bounds follow the [`Bounds2D`](https://github.com/uber-web/math.gl/blob/master/modules/types/docs/api-reference/bounds.md) tuple format `[[minX, minY], [maxX, maxY]]`. You can also call `layout.getBounds()` at any time to retrieve the same values.

### Maintaining layout bounds

Override `_updateBounds` to keep `_bounds` in sync with your layout state. Most layouts only need to funnel their node positions through `_calculateBounds`, which filters out non-finite coordinates before producing the enclosing rectangle. Update bounds **before** each event emission so callbacks receive the freshest extent information.

### Drag interactions

To support drag-and-drop interactions:

1. Call `lockNodePosition` when a drag starts to pin the node.
2. Call `unlockNodePosition` after releasing the pointer.
3. Call `resume` to restart the layout if it needs to continue processing after the drag completes.

A typical sequence looks like `startDragging → lockNodePosition → release → unlockNodePosition → resume`.

## Accessors

`GraphLayout` repeatedly calls `getNodePosition` and `getEdgePosition` to fetch the latest geometry:

- `getNodePosition(node)` returns the node position `[x, y]`. Return `null` when a position is unavailable to hide the node until the layout resolves it.
- `getEdgePosition(edge)` returns rendering information for an edge, including:
  - `type`: the edge primitive (`'line'`, `'spline-curve'`, or `'path'`).
  - `sourcePosition`/`targetPosition`: coordinates for the edge endpoints.
  - `controlPoints`: optional control points for curved or multi-segment edges.

Ensure these methods always return consistent data for the current layout state.
