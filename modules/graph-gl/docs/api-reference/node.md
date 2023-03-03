# Node Class

The `Node` class is the base class of the node, which provides a list of basic util functions to be used through out the applications.


## Constructor
```js
new Node(props);
```

Parameters:
- `props` (Object) - `Node` properties.

### Basic Properties
##### `id` (String|Number, required)

The `id` must be unique among all nodes in the graph at a given time.

##### `data` (Object, optional)

- Default: `{}`

The origin node data.


## getConnectedEdges()
Return all the connected edges.


## getDegree()

Return the degree of the node -- includes in-degree and out-degree


## getId()

Return the ID of the node.


## getInDegree()

Return the in-degree of the node.


## getOutDegree()

Return the out-degree of the node.


## getPropertyValue(key)

Return of the value of the selected property key.

##### `key` (String|Number, required)

The property key.


## getSiblingIds()

Return all the IDs of the sibling nodes.


## setData(data)

Set the new node data.

##### `data` (Any, required)

The new data of the node.


## setDataProperty(key, value)

Update a data property.

##### `key` (String, required)

The key of the property

##### `value` (Any, required)

The value of the property.


## addConnectedEdges(edges)

Add new connected edges to the node.


## removeConnectedEdges(edges)

Remove edges from `this._connectedEdges`


## clearConnectedEdges()

Clear `this._connectedEdges`


## Source

[src/core/node.js](TBD/master/src/core/node.js)
