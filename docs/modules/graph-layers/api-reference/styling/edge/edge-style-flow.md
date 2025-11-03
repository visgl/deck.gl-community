# Flow decorator

The flow decorator draws animated segments moving along the edge direction. It
is useful to express throughput or directional emphasis.

## Properties

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `color` | `string \| number[] \| function` | black (`[0, 0, 0]`) | Color of the animated segment. |
| `speed` | `number \| function` | `0` | Segments per second that travel along the edge. Positive values flow from source to target. |
| `width` | `number \| function` | `1` | Visual width of the segment in pixels. |
| `tailLength` | `number \| function` | `1` | Length of the fading trail behind each segment. |

All fields support accessors and selectors. A speed of `0` disables the motion
while still rendering a static highlight.

## Examples

```js
{
  type: 'flow',
  color: '#22D3EE',
  width: 2,
  speed: edge => edge.capacity > 0 ? edge.load / edge.capacity : 0,
  tailLength: 4
}
```

To create directional emphasis only while hovering:

```js
{
  type: 'flow',
  color: '#FACC15',
  width: 3,
  speed: {
    default: 0,
    hover: 2
  }
}
```
