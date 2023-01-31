## Edge Label Decorator

User can specify the edge label decorator as:
```js
edgeStyle={{
  stroke: 'black',
  strokeWidth: 2,
  decorators: [
    {
      type: EDGE_DECORATOR_TYPE.LABEL,
      text: edge => edge.id,
      color: '#000',
      fontSize: 18,
    }
  ]
}}
```

The text label will be placed at the middle of the edge.
The angle is determined by the source and target node positions by default.

