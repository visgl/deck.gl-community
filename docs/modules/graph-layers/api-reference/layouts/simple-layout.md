# Simple Layout

<p align="center">
  <img src="/gatsby/images/layouts/simple.png" height="400" />
</p>

This example demonstrates how to render a pre-layout graph using `@deck.gl-community/graph-layers`.
You can pre-compute the layout and have the position information in each node.
By simply specifying the `nodePositionAccessor` through constructor, you'll be able to render the graph right away.

## Configurations

#### nodePositionAccessor
The accessor to get the position ([x, y]) of the node.
Example:
```js
<GraphGL
  {...otherProps}
  layout={
    new SimpleLayout({
      nodePositionAccessor: node => [
        node.getPropertyValue('x'),
        node.getPropertyValue('y'),
      ]
    })
  }
/>
````
