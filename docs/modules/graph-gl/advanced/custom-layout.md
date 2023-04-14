# Write your own custom layout

Here's the method you will likely to implement when creating your own custom layout:
```js
import {BaseLayout} from 'react-graph-layers';

export default class MyLayout extends BaseLayout {
  // initialize the layout
  constructor(options) {}
  // first time to pass the graph data into this layout
  initializeGraph(graph) {}
  // update the existing graph
  updateGraph(grpah) {}
  // start the layout calculation
  start() {}
  // resume the layout calculation manually
  resume() {}
  // stop the layout calculation manually
  stop() {}
  // access the position of the node in the layout
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


### Lifecycles

For a graph layout, everything goes through a set of events. In each event, the layout will need to take the inputs and do the different computations.  Lifecycle methods are various methods which are invoked at different phases of the lifecycle of a graph layout. If you are aware of these lifecycle events, it will enable you to control their entire flow and it will definitely help us to produce better results.

A layout goes through the following phases:

- Mounting:
  `constructor` => `initializeGraph` => `start`
- Updating:
  `updageGraph` => `start`


There are a few callbacks should be triggered when the layout changes:
 - `this._callbacks.onLayoutChange()`
  Every time when the layout changes, `onLayoutChange` callback should be triggered to notify GraphGL to re-render and update the view. Then GraphGL will use `getNodePosition` and `getEdgePosition` to get the position information to render the graph. Some users might also want to leverage this event hook to perform different interactions, ex: show a spinner on the UI to indicate the layout is computing.

 - `this._callbacks.onLayoutDone()`
  When the layout is completed, 'onLayoutDone' should be triggered to notify GraphGL/User. Some users might also want to leverage this event hook to perform different interactions, ex: remove the spinner from the UI.

If you want to implement the drag & drag interaction on nodes, you will have to implement:
 - `lockNodePosition`: pin the node at the designated position.
 - `unlockNodePosition`: free the node from the position.
 - `resume`: resume the layout calculation.

The sequence of the events is like:
startDragging => lockNodePosition => release => unlockNodePosition => resume

### constructor

In the constructor, you can initialize some internal object you'll need for the layout state.
The most important part is to create a 'map' to keep the position of nodes.

```js

export default class RandomLayout extends BaseLayout {

  static defaultOptions = {
    viewportWidth: 1000,
    viewportHeight: 1000
  };

  constructor(options) {
    // init BaseLayout
    super(options);
    // give a name to this layout
    this._name = 'RandomLayout';
    // combine the default options with user input
    this._options = {
      ...this.defaultOptions,
      ...options,
    };
    // a map to persis the position of nodes.
    this._nodePositionMap = {};
  }
}
```

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
In this case, the computation is easy as assigning random position for each node only.
Once the layout is completed, you will need to call `this._callbacks.onLayoutChange()` to notify the render redraw.
Then call `this._callbacks.onLayoutDone()` to notify the render that layout is completed.

```js
  start() {
    const {viewportWidth, viewportHeight} = this._options;
    this._nodePositionMap = Object.keys(this._nodePositionMap).reduce((res, nodeId) => {
      res[nodeId] = [Math.random() * viewportWidth, Math.random() * viewportHeight];
      return res;
    }, {});
    this._callbacks.onLayoutChange();
    this._callbacks.onLayoutDone();
  }
```

### Getters

GraphGL will keep retrieving the position of nodes and edges from the layout. You will need to provide two getters `getNodePosition` and `getEdgePosition`.

 - getNodePosition: return the position of the node [x, y].
 - getEdgePosition: return the rendering information of the edge, including:
   -- type: the type of the edge, it should be 'LINE', 'SPLINE_CURVE', or 'PATH'.
   -- sourcePosition: the position of source node.
   -- targetPosition: the position of target node.
   -- controlPoints: a set of control points for 'SPLINE_CURVE', or 'PATH' edge.


```js
  getNodePosition = node => this._nodePositionMap[node.getId()];

  getEdgePosition = edge => {
    const sourcePos = this._nodePositionMap[edge.getSourceNodeId()];
    const targetPos = this._nodePositionMap[edge.getTargetNodeId()];
    return {
      type: EDGE_TYPE.LINE,
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      controlPoints: [],
    };
  };
```


### Full source code

```js
import {BaseLayout} from 'react-graph-layers';

export default class RandomLayout extends BaseLayout {
  constructor(options) {
    super(options);
    this._name = 'RandomLayout';
    this._options = {
      ...defaultOptions,
      ...options,
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
    this._nodePositionMap = Object.keys(this._nodePositionMap).reduce((res, nodeId) => {
      res[nodeId] = [Math.random() * viewportWidth, Math.random() * viewportHeight];
      return res;
    }, {});
    this._callbacks.onLayoutChange();
    this._callbacks.onLayoutDone();
  }

  getNodePosition = node => this._nodePositionMap[node.getId()];

  getEdgePosition = edge => {
    const sourcePos = this._nodePositionMap[edge.getSourceNodeId()];
    const targetPos = this._nodePositionMap[edge.getTargetNodeId()];
    return {
      type: EDGE_TYPE.LINE,
      sourcePosition: sourcePos,
      targetPosition: targetPos,
      controlPoints: [],
    };
  };
}
```
