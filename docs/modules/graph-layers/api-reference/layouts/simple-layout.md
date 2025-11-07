# SimpleLayout

The `SimpleLayout` allows an application to render a pre-layouted graph. This is useful when the application already has or is able to calculated positions for nodes.

## Usage 

If you are able to pre-compute the layout and position information is available in in each node.
By simply specifying the `nodePositionAccessor` through constructor, you'll be able to render the graph right away.

## SimpleLayoutProps

#### nodePositionAccessor

Simply supply the `nodePositionAccessor` to extract the position ([x, y]) of the node.

```js
new GraphLayer({
  {...otherProps}
  layout={
    new SimpleLayout({
      nodePositionAccessor: node => [
        node.getPropertyValue('x'),
        node.getPropertyValue('y'),
      ]
    })
  }
});
````
