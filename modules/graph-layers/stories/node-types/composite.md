# Composite Node Styles

You can create a custom node styles by having multiple node-type objects.

```js
<GraphGL
  {...shareProps}
  nodeStyle={[
    {
      type: NODE_TYPE.CIRCLE,
      radius: 10,
      fill: DEFAULT_COLOR,
    },
    {
      type: NODE_TYPE.MARKER,
      marker: node => markerList[node.id % markerLength],
      fill: 'white',
      size: 20,
    },
    {
      type: NODE_TYPE.LABEL,
      text: node => markerList[node.id % markerLength],
      color: DEFAULT_COLOR,
      fontSize: 10,
      offset: [0, 15],
    },
  ]}
/>
```

## Source

[Storybook example](https://github.com/uber/graph.gl/blob/master/stories/node-types/stories.js)
