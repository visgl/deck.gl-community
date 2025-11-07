# Interactions

In this chapter, you'll learn about how to interact with the graph.

There are the porperties you can specify when using the GraphGL component:

### `nodeEvents` (Object, optional)

All events callbacks will be triggered with the following parameters:

```js
info: {
  object:  The object that was picked.
  x: Mouse position x relative to the viewport.
  y: Mouse position y relative to the viewport.
  coordinate:  Mouse position in viewport coordinate system.
}
```

- onClick: This callback will be called when the mouse clicks on a node. Default: `null`.
- onMouseEnter: This callback will be called when the mouse enter a node. Default: `null`.
- onHover: This callback will be called when the mouse hovers over a node. Default: `null`.
- onMouseLeave: This callback will be called when the mouse leaves a node. Default: `null`.
- onDrag: This callback will be called when draggin a node. Default: `null`.

### `edgeEvents` (Object, optional)

All events callbacks will be triggered with the following parameters:

```js
info: {
  object:  The object that was picked.
  x: Mouse position x relative to the viewport.
  y: Mouse position y relative to the viewport.
  coordinate:  Mouse position in viewport coordinate system.
}
```

- onClick: This callback will be called when the mouse clicks on an edge. Default: `null`.
- onHover: This callback will be called when the mouse hovers over an edge. Default: `null`.

### `wheelSensitivity` (Number: 0 to 1, optional)

Changes the scroll wheel sensitivity when zooming. This is a multiplicative modifier.
So, a value between 0 and 1 reduces the sensitivity (zooms slower),
and a value greater than 1 increases the sensitivity (zooms faster)

### `enableZooming` (bool, optional)

Whether zooming the graph is enabled

### `enablePanning` (bool, optional)

Whether panning the graph is enabled

### `enableDragging` (bool, optional)

Whether dragging the node is enabled

### `resumeLayoutAfterDragging` (bool, optional)

Resume layout calculation after dragging a node
