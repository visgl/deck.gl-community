# Edge Class

The `Edge` class is the base class of the edge, which provides a list of basic util functions to be used throughout the applications.


## Constructor
```js
new Edge(props);
```

Parameters:
- `props` (Object) - `Edge` properties.

### Basic Properties
##### `id` (String|Number, required)

The `id` must be unique among all edges in the graph at a given time.


##### `sourceId` (String|Number, required)
The id of the source node.

##### `targetId` (String|Number, required)
The id of the target node.


##### `directed` (Boolean, optional)

- Default: `false`
The edge has direction or not.


##### `data` (Object, optional)

- Default: `{}`

The origin edge data.


## getId()
Return the ID of the edge.


## getPropertyValue(key)
Return of the value of the selected property key.

##### `key` (String|Number, required)

The property key.

## getSourceNodeId()
Get the ID of the source node.


## getTargetNodeId()
Get the ID of the target node.


## isDirected()
Return whether the edge is directed or not.


## setData(data)

Set the new edge data.

##### `data` (Any, required)

The new data of the edge.


## setDataProperty(key, value)

Update a data property.

##### `key` (String, required)

The key of the property

##### `value` (Any, required)

The value of the property.



## Source

[src/core/edge.js](TBD/blob/master/src/core/edge.js)
