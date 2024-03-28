# Graph Class

The `Graph` class is the base class of the graph.

## Constructor

```js
new Graph(graph);
```

Parameters:

##### `graph` (Graph, optional)

## setGraphName()

Set the name of the graph.

## getGraphName()

Get the name of the graph. Normally it can be used for dirty check.

## addEdge(edge)

Add a new edge to the graph.

##### `edge` (Edge, required)

Expect a Edge object to be added to the graph.

## addNode(node)

Add a new node to the graph.

##### `node` (Node, required)

Expect a Node object to be added to the graph.

## batchAddEdges(edges)

Batch add edges to the graph.

##### `edges` (Edge[], required)

Expect a list of Edge objects to be added to the graph.

## batchAddNodes(nodes)

Batch add nodes to the graph.

##### `nodes` (Node[], required)

Expect a list of Node objects to be added to the graph.

## findEdge(edgeId)

##### `edgeId` (String|Number, required)

The target edge ID.

Find the edge by edge ID.

##### `edgeId` (String|Number, required)

The target edge ID.

## findNode(nodeId)

Find the node by node ID.

##### `nodeId` (String|Number, required)

The target node ID.

## getDegree(nodeId)

Get the degree of the node by node ID.

##### `nodeId` (String|Number, required)

The target node ID.

## getEdgeMap()

Get the edge map of the graph. The key of the map is the ID of the edges.

## getEdges()

Get all the edges of the graph.

## getConnectedEdges(nodeId)

Return all the connected edges of a node by nodeID.

##### `nodeId` (String|Number, required)

The target node ID.

## getNodeMap()

Get the node map of the graph. The key of the map is the ID of the nodes.

## getNodes()

Get all the nodes of the graph.

## getNodeSiblings(nodeId)

Return all the sibling nodes of a node by nodeID.

##### `nodeId` (String|Number, required)

The target node ID.

## isEmpty()

Return true if the graph is empty.

## removeEdge(edgeId)

Remove an edge from the graph by the edge ID

##### `edgeId` (String|Number, required)

The target edge ID.

## removeNode(nodeId)

Remove a node from the graph by node ID

##### `nodeId` (String|Number, required)

The target node ID.

## reset()

Clean up everything in the graph.

## resetEdges()

Clean up all the edges in the graph.

## resetNodes()

Clean up all the nodes in the graph.

# transaction(cb)

Perform a batch of operations defined by cb before indicating graph is updated

##### `cb` (Function, required)

## updateEdge(edge)

Update the indicated edge to the provided value

##### `edge` (Edge, required)

## updateNode(node)

Update the indicated node to the provided value

##### `node` (Node, required)
