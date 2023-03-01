# Simple Layout

<p align="center">
  <img src="/gatsby/images/layouts/simple.png" height="400" />
</p>

This example demonstrates how to render a pre-layoued graph using react-graph-gl.
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

## Source
 - [simple-layout.js](TBD/master/src/layouts/simple-layout/index.js)

 - [Storybook example](TBD/master/stories/basic-layouts/stories.js#L30-L45)
