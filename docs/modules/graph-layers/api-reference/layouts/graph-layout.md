# Write your own custom layout


## Usage 

The example belows illustrates the methods you will need to implement when creating your own custom layout.

```js
import {GraphLayout} from '@deck.gl-community/graph-layers';

export class MyLayout extends GraphLayout {
  // initialize the layout
  constructor(options) {}
  // first time to pass the graph data into this layout
  initializeGraph(graph) {}
  // update the existing graph
  updateGraph(graph) {}
  // start the layout calculation
  start() {}
  // update the layout calculation
  update() {}
  // resume the layout calculation manually
  resume() {}
  // stop the layout calculation manually
  stop() {}

  // Access the position of the node in the layout
  // If the position is not available (not calculated), returning nullish will hide the node.
  getNodePosition(node) {}
  // access the layout information of the edge
  getEdgePosition(edge) {}
  // Pin the node to a designated position, and the node won't move anymore
  lockNodePosition(node, x, y) {}
  // Unlock the node, the node will be able to move freely.
  unlockNodePosition(node) {}
}
```

We will start with a `RandomLayout` as an example, you can follow the steps one by one and find the source code at the bottom.

## The Layout Lifecycle

For a graph layout, everything goes through a set of events. In each event, the layout will need to take the inputs and do the different computations. Lifecycle methods are various methods which are invoked at different phases of the lifecycle of a graph layout. If you are aware of these lifecycle events, it will enable you to control their entire flow and it will definitely help us to produce better results.

A layout goes through the following phases:

- Mounting:
  `constructor` => `initializeGraph` => `start`
- Updating:
  `updateGraph` => `update`

There are a few events that should be triggered when the layout changes:

- `this._onLayoutStart()`
  When the layout starts, `onLayoutStart` should be triggered to notify GraphGL/User. Some users might also want to leverage this event hook to perform different interactions, ex: show a spinner on the UI to indicate a new layout is computing.

- `this._onLayoutChange()`
  Every time when the layout changes, `onLayoutChange` should be triggered to notify GraphGL to re-render and update the view. Then GraphGL will use `getNodePosition` and `getEdgePosition` to get the position information to render the graph. Some users might also want to leverage this event hook to perform different interactions, ex: show a spinner on the UI to indicate the layout is computing.

  All layout lifecycle events emit a `CustomEvent` whose `detail` property contains the latest `{bounds}` calculated by the layout. Bounds follow the [`Bounds2D`](https://github.com/uber-web/math.gl/blob/master/modules/types/docs/api-reference/bounds.md) tuple format `[[minX, minY], [maxX, maxY]]`. You can also call `layout.getBounds()` at any time to retrieve the same values.

- `this._onLayoutDone()`
  When the layout is completed, 'onLayoutDone' should be triggered to notify GraphGL/User. Some users might also want to leverage this event hook to perform different interactions, ex: remove the spinner from the UI.

If you want to implement the drag & drag interaction on nodes, you will have to implement:

- `lockNodePosition`: pin the node at the designated position.
- `unlockNodePosition`: free the node from the position.
- `resume`: resume the layout calculation.

The sequence of the events is like:
startDragging => lockNodePosition => release => unlockNodePosition => resume

### Update the graph data

GraphGL will call `initializeGraph` to pass the graph data into the layout.
If the graph is the same one but part ofthe data is changed, GraphGL will call `updateGraph` method to notify the layout.

In this case, we can just simply update the `this._nodePositionMap` by going through all nodes in the graph.

```js
  initializeGraph(graph) {
    this.updateGraph(graph);
  }

  updateGraph(grpah) {
    this._graph = graph;
    this._nodePositionMap = graph.getNodes().reduce((res, node) => {
      res[node.getId()] = this._nodePositionMap[node.getId()] || [0, 0];
      return res;
    }, {});
  }
```

### Compute layout

GraphGL will call `start()` of the layout to kick start the layout calculation.
Before starting the calculation you should call `this._onLayoutStart()` to notify that a new layout has been started
In this case, the computation is easy as assigning random position for each node only.
Once the layout is completed, you will need to call `this._onLayoutChange()` to notify the render redraw.
Then call `this._onLayoutDone()` to notify the render that layout is completed.

```js
  start() {
    const {viewportWidth, viewportHeight} = this._options;
    this._onLayoutStart();
    this._nodePositionMap = Object.keys(this._nodePositionMap).reduce((res, nodeId) => {
      res[nodeId] = [Math.random() * viewportWidth, Math.random() * viewportHeight];
      return res;
    }, {});
    this._onLayoutChange();
    this._onLayoutDone();
  }
```

### Update layout

GraphGL will call `update()` of the layout to update the layout calculation when a full new layout is not required.
Most commonly this will be when nodes or edges of the graph are updated.
In this case we will simply assign a random position for each node.
Once the layout is completed, you will need to call `this._onLayoutChange()` to notify the render redraw.
Then call `this._onLayoutDone()` to notify the render that layout is completed.

```js
  update() {
    const {viewportWidth, viewportHeight} = this._options;
    this._nodePositionMap = Object.keys(this._nodePositionMap).reduce((res, nodeId) => {
      res[nodeId] = [Math.random() * viewportWidth, Math.random() * viewportHeight];
      return res;
    }, {});
    this._onLayoutChange();
    this._onLayoutDone();
  }
```

## Methpds

### constructor

In the constructor, you can initialize some internal object you'll need for the layout state.
The most important part is to create a 'map' to keep the position of nodes.

```js
export default class RandomLayout extends GraphLayout {
  static defaultProps = {
    viewportWidth: 1000,
    viewportHeight: 1000
  };

  constructor(options) {
    // init GraphLayout
    super(options);
    // give a name to this layout
    this._name = 'RandomLayout';
    // combine the default options with user input
    this._options = {
      ...this.defaultProps,
      ...options
    };
    // a map to persis the position of nodes.
    this._nodePositionMap = {};
  }
}
```


### Getters

GraphGL will keep retrieving the position of nodes and edges from the layout. You will need to provide two getters `getNodePosition` and `getEdgePosition`.

- getNodePosition: return the position of the node [x, y]. If the position is not available (not calculated), returning nullish will hide the node.
- getEdgePosition: return the rendering information of the edge, including:
  -- type: the type of the edge, it should be 'line', 'spline-curve', or 'path'.
  -- sourcePosition: the position of source node.
  -- targetPosition: the position of target node.
  -- controlPoints: a set of control points for 'spline-curve', or 'path' edge.

```js
getNodePosition = (node) => this._nodePositionMap[node.getId()];

getEdgePosition = (edge) => {
  const sourcePos = this._nodePositionMap[edge.getSourceNodeId()];
  const targetPos = this._nodePositionMap[edge.getTargetNodeId()];
  return {
    type: 'line',
    sourcePosition: sourcePos,
    targetPosition: targetPos,
    controlPoints: []
  };
};
```

### Full source code

```js
import {GraphLayout} from '@deck.gl-community/graph-layers';

export default class RandomLayout extends GraphLayout {
  constructor(options) {
    super(options);
    this._name = 'RandomLayout';
    this._options = {
      ...defaultProps,
      ...options
    };
    this._nodePositionMap = {};
  }

  // first time to pass the graph data into this layout
  initializeGraph(graph) {
    this.updateGraph(graph);
  }
  // update the existing graph
  updateGraph(grpah) {
    this._graph = graph;
    this._nodePositionMap = graph.getNodes().reduce((res, node) => {
      res[node.getId()] = this._nodePositionMap[node.getId()] || [0, 0];
      return res;
    }, {});
  }

  start() {
    const {viewportWidth, viewportHeight} = this._options;
    this._onLayoutStart();
    this._nodePositionMap = Object.keys(this._nodePositionMap).reduce((res, nodeId) => {
      res[nodeId] = [Math.random() * viewportWidth, Math.random() * viewportHeight];
      return res;
    }, {});
    this._onLayoutChange();
    this._onLayoutDone();
  }

  update() {
    const {viewportWidth, viewportHeight} = this._options;
    this._nodePositionMap = Object.keys(this._nodePositionMap).reduce((res, nodeId) => {
      res[nodeId] = [Math.random() * viewportWidth, Math.random() * viewportHeight];
      return res;
    }, {});
    this._onLayoutChange();
    this._onLayoutDone();
  }

  getNodePosition = (node) => this._nodePositionMap[node.getId()];

  getEdgePosition = (edge) => {
    const sourcePos = this._nodePositionMap[edge.getSourceNodeId()];
    const targetPos = this._nodePositionMap[edge.getTargetNodeId()];
    return {
      type: 'line',
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      controlPoints: []
    };
  };
}
```
