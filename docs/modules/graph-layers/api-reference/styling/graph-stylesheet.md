# Graph stylesheet reference

A `GraphStylesheet` is the declarative object you provide to `GraphLayer` to style nodes, edges, and edge decorators. Each stylesheet describes a single visual primitive and is consumed by the [`GraphStyleEngine`](./graph-style-engine.md), which converts the declaration into the Deck.gl accessors that ultimately render the scene.

## Type signature

```ts
import type {GraphStylesheet} from '@deck.gl-community/graph-layers';

const circleStyle: GraphStylesheet<'circle'> = {
  type: 'circle',
  fill: '#2563EB',
  stroke: '#1D4ED8',
  strokeWidth: 2,
  ':hover': {
    fill: '#60A5FA'
  }
};
```

The generic parameter narrows the `type` field and surfaces the properties that are valid for that primitive. For example:

- Node primitives: `'circle'`, `'rectangle'`, `'rounded-rectangle'`, `'path-rounded-rectangle'`, `'label'`, `'marker'`, and `'icon'` (an alias for image nodes).
- Edge primitives: `'edge'`.
- Edge decorators: `'edge-label'`, `'flow'`, and `'arrow'`.

Refer to the individual [node](./node/node-style.md) and [edge](./edge/edge-style.md) guides for the property lists that each primitive accepts.

## Property values

Every field on a stylesheet can be expressed in one of three shapes:

| Shape | Example | Notes |
| --- | --- | --- |
| Constant | `strokeWidth: 2` | Applied to every rendered object. |
| Accessor | `stroke: edge => edge.isCritical ? '#F97316' : '#94A3B8'` | Receives the node or edge datum. Return values are automatically coerced into Deck.gl-friendly formats (e.g. CSS color strings become `[r, g, b, a]`). |
| Stateful | `strokeWidth: {default: 1, hover: 3}` | Maps interaction states to values. Equivalent selector blocks can be provided via `':hover'` style objects (see below). |

## Selectors and interaction states

Selectors let you override properties for specific interaction states. Prefix a state name with a colon and supply a nested style object:

```js
const edgeStyle = {
  stroke: '#CBD5F5',
  strokeWidth: 1,
  ':hover': {
    stroke: '#2563EB',
    strokeWidth: 2
  },
  ':selected': {
    strokeWidth: 4
  }
};
```

The built-in states are `default`, `hover`, `dragging`, and `selected`. When you use the object-map form (`{default: ..., hover: ...}`) the same state names apply.

## Composition

Stylesheets are composed under the `stylesheet` prop on `GraphLayer`. Provide an array of node layers and either a single edge style or an array of edge styles:

```js
new GraphLayer({
  stylesheet: {
    nodes: [
      {type: 'circle', fill: '#1E293B'},
      {type: 'label', text: '@id'}
    ],
    edges: {
      stroke: '#CBD5F5',
      decorators: [
        {type: 'edge-label', text: '@weight'}
      ]
    }
  }
});
```

Edge styles can omit the `type` field—`GraphLayer` defaults it to `'edge'`—but supplying it enables TypeScript to infer the correct decorator and property options.
