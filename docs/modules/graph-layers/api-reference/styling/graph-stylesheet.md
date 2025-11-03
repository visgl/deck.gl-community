# Graph stylesheet reference

`GraphLayer` accepts a single `stylesheet` prop that describes how every node,
edge, and decorator should render. A stylesheet is a declarative bundle of
**style layers** that the [`GraphStyleEngine`](./graph-style-engine.md) normalizes
into Deck.gl accessors. Each entry focuses on *what* to draw, while the engine
coerces values, wires update triggers, and fans the configuration out across the
underlying Deck.gl primitives.

## Top-level structure

```ts
import type {GraphLayerProps} from '@deck.gl-community/graph-layers';

const stylesheet: NonNullable<GraphLayerProps['stylesheet']> = {
  nodes: [
    {type: 'circle', radius: 10, fill: '#2563EB'},
    {type: 'label', text: '@id', color: '#0F172A'}
  ],
  edges: {
    stroke: '#CBD5F5',
    strokeWidth: 1.5,
    decorators: [{type: 'arrow', size: 8}]
  }
};
```

`nodes` is always an array—the order controls drawing order. `edges` can be a
single style object or an array when you want to stack multiple edge passes. The
legacy `nodeStyle`/`edgeStyle` props continue to work but forward to the new
structure and will be removed in a future release.

Every style entry is a `GraphStylesheet<TType>` whose `type` narrows the set of
supported properties:

- **Node primitives** – `'circle'`, `'rectangle'`, `'rounded-rectangle'`,
  `'path-rounded-rectangle'`, `'label'`, `'marker'`, `'icon'` (alias of
  `'marker'`).
- **Edge primitives** – `'edge'`.
- **Edge decorators** – `'edge-label'`, `'flow'`, and `'arrow'`.

## Declarative values

Every property accepts one of the following shapes:

| Shape | Example | Notes |
| --- | --- | --- |
| Constant | `strokeWidth: 2` | Applied verbatim to every rendered object. |
| Attribute binding | `fill: '@statusColor'` | Reads the named graph attribute from nodes/edges. Shortcuts described below. |
| Accessor | `stroke: edge => edge.isCritical ? '#F97316' : '#94A3B8'` | Receives the node or edge datum. The return value is automatically coerced into Deck.gl-friendly formats (CSS colors → `[r, g, b, a]`). |
| Stateful | `strokeWidth: {default: 1, hover: 3}` | Maps interaction states to values. Equivalent selector blocks can be provided via `':hover'` style objects. |

### Attribute bindings

Attribute bindings are the quickest way to connect graph data to visuals. They
come in two forms:

```js
// String shorthand: pulls `node.getPropertyValue('group')`
fill: '@group',

// Object form: add fallbacks or remap data with a scale/formatter
strokeWidth: {
  attribute: 'weight',
  fallback: 1,
  scale: value => Math.sqrt(value)
},

// Declarative scale mapping (uses d3-scale under the hood)
color: {
  attribute: 'region',
  scale: {
    type: 'ordinal',
    domain: ['Americas', 'EMEA', 'APAC'],
    range: ['#2563EB', '#10B981', '#F97316']
  }
}
```

The `attribute` reads from `GraphNode.getPropertyValue(attribute)`/
`GraphEdge.getPropertyValue(attribute)` if available, falling back to the raw
datum. Use `fallback` to supply defaults when the attribute is missing. When
`scale` is an object the engine instantiates the specified D3 scale; pass a
function if you want full control.

### Selectors and interaction states

Selectors override properties for specific interaction states. Prefix a state
with a colon and supply a nested style object:

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

The built-in states are `default`, `hover`, `dragging`, and `selected`. When you
use the map form (`{default: ..., hover: ...}`) the same state names apply.

## Node styles

Node visuals are composed by stacking one or more style layers under the
`stylesheet.nodes` array:

```js
const stylesheet = {
  nodes: [
    {type: 'circle', radius: {attribute: 'degree', fallback: 6, scale: value => 4 + value}},
    {type: 'label', text: '@id', color: '#172B4D', offset: [0, 16]}
  ]
};
```

Entries are drawn in array order (earlier entries render beneath later entries).

### Shared node properties

Every node style understands these keys in addition to its type-specific
properties:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string literal | – | Selects the primitive (`'circle'`, `'rectangle'`, `'label'`, etc.). |
| `data` | `(nodes: any[]) => any` | `nodes => nodes` | Replace the data object passed to Deck.gl when a sublayer needs derived data. |
| `visible` | `boolean` | `true` | Toggle the sublayer without removing it from the stylesheet. |
| `opacity` | number \| accessor \| attribute binding | `1` | Multiplies the alpha channel produced by the primitive. |
| `offset` | `[number, number]` \| accessor \| attribute binding | `null` | Pixel offset from the layout position. Positive Y moves up. |

All other properties accept the same declarative value shapes listed above:
constants, attribute bindings such as `fill: '@statusColor'`, functions, or
state maps.

### Node primitives

Mix primitives to create layered nodes. For example:

```js
const stylesheet = {
  nodes: [
    {
      type: 'rounded-rectangle',
      width: 120,
      height: 48,
      cornerRadius: 0.4,
      fill: {
        default: '#0F172A',
        hover: '#1E293B'
      },
      stroke: '#38BDF8',
      strokeWidth: {attribute: 'isSelected', scale: value => (value ? 4 : 1)}
    },
    {type: 'label', text: '@label', color: '#F8FAFC', fontSize: 18}
  ]
};
```

#### Circle node style

The circle primitive renders filled disks using Deck.gl’s `ScatterplotLayer`. It
is ideal for compact node markers or when you want the radius to encode a
numerical value. Pair it with attribute bindings to map graph properties
directly onto color and size.

In addition to the [shared node style options](#shared-node-properties), circles
understand the following keys:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `fill` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Fill color. Accepts CSS strings, `[r, g, b]`/`[r, g, b, a]` arrays, or bindings such as `fill: '@groupColor'`. |
| `radius` | constant \| accessor \| attribute binding | `1` | Radius in pixels. Accessors can read node data to size circles proportionally. |
| `stroke` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Outline color. |
| `strokeWidth` | constant \| accessor \| attribute binding | `0` | Outline width in pixels. |

All color accessors can return either a color string or an array. Alpha values
are optional—when omitted the color is treated as fully opaque.

```js
{
  type: 'circle',
  radius: {attribute: 'degree', fallback: 4, scale: (value) => Math.max(4, value)},
  fill: {
    default: '#CBD5F5',
    hover: '#3B82F6'
  },
  stroke: '#1E3A8A',
  strokeWidth: 1.5
}
```

To add a subtle highlight when selecting a node you can combine selectors with
accessors:

```js
{
  type: 'circle',
  radius: 10,
  fill: '#22C55E',
  strokeWidth: {
    default: 0,
    selected: {attribute: 'isSelected', fallback: false, scale: (value) => (value ? 4 : 0)}
  },
  stroke: '#052E16'
}
```

#### Rectangle node style

Rectangles are rendered with Deck.gl’s `PolygonLayer` and are useful for
card-like nodes or to provide a background behind other primitives. Attribute
bindings let you size and color cards directly from node metadata.

Besides the [shared node options](#shared-node-properties), rectangles support:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `width` | constant \| accessor \| attribute binding | – (required) | Rectangle width in pixels. |
| `height` | constant \| accessor \| attribute binding | – (required) | Rectangle height in pixels. |
| `fill` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Interior color. |
| `stroke` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Border color. |
| `strokeWidth` | constant \| accessor \| attribute binding | `0` | Border width in pixels. |

```js
{
  type: 'rectangle',
  width: {attribute: 'width', fallback: 120},
  height: {attribute: 'height', fallback: 60},
  fill: '#1F2937',
  stroke: '#93C5FD',
  strokeWidth: 1
}
```

You can combine selectors to animate the border as the user interacts with the
node:

```js
{
  type: 'rectangle',
  width: {attribute: 'padding', fallback: 0, scale: (value) => 100 + value * 2},
  height: 48,
  fill: {
    default: '#0F172A',
    hover: '#1E293B'
  },
  strokeWidth: {
    default: 1,
    selected: 4
  },
  stroke: '#38BDF8'
}
```

#### Rounded rectangle node style

This primitive uses a custom shader to draw rectangles with smoothly rounded
corners while keeping the geometry lightweight. It is great for pill-shaped or
card-style nodes that remain crisp at any zoom level, and it supports the same
attribute-binding shortcuts as other node styles.

Rounded rectangles share all options from [basic rectangles](#rectangle-node-style)
and add the following controls:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `cornerRadius` | constant \| accessor \| attribute binding | `0.1` | Amount of corner rounding. `0` keeps sharp corners, `1` approaches a circle. Values between 0 and 1 are typical. |
| `radius` | constant \| accessor \| attribute binding | `1` | Optional radius multiplier for the underlying geometry. It can expand or shrink the shader’s falloff and exists primarily for compatibility. |

Because the shape is generated in the shader it remains smooth regardless of the
polygon resolution.

```js
{
  type: 'rounded-rectangle',
  width: 140,
  height: 56,
  cornerRadius: {attribute: 'cornerRadius', fallback: 0.5},
  fill: '#111827',
  stroke: '#4ADE80',
  strokeWidth: {
    default: 1,
    selected: 3
  }
}
```

You can also adjust the radius dynamically to highlight specific groups:

```js
{
  type: 'rounded-rectangle',
  width: 110,
  height: 44,
  cornerRadius: {attribute: 'cluster', fallback: 'default', scale: value => (value === 'core' ? 0.35 : 0.15)},
  fill: '@clusterColor'
}
```

#### Path rounded rectangle node style

This variant generates the rounded rectangle geometry on the CPU and feeds it to
Deck.gl’s `PolygonLayer`. It trades slightly higher CPU cost for compatibility
with features that rely on actual polygon outlines (e.g. GPU picking or custom
polygon processing) while still honoring attribute bindings for every property.

Path rounded rectangles accept the rectangle properties plus:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `cornerRadius` | constant \| accessor \| attribute binding | `0.1` | Corner rounding factor. As with the shader version, `0` is sharp and `1` is fully rounded. |

The width, height, fill, stroke, and strokeWidth options behave identically to
the [`'rectangle'` node style](#rectangle-node-style).

```js
{
  type: 'path-rounded-rectangle',
  width: {attribute: 'children', fallback: [], scale: value => 120 + (value?.length ?? 0) * 8},
  height: 48,
  cornerRadius: 0.35,
  fill: '#0B1120',
  stroke: '#38BDF8',
  strokeWidth: 1.5
}
```

Because the geometry is computed per node you can animate the radius as part of
an interaction:

```js
{
  type: 'path-rounded-rectangle',
  width: 96,
  height: 40,
  cornerRadius: {
    default: 0.2,
    hover: 0.5
  },
  fill: '#1E3A8A'
}
```

#### Marker node style

Markers render vector icons from the bundled marker set. Under the hood the
style uses a Deck.gl `IconLayer` with zoom-aware sizing logic.

Marker styles extend the [shared node options](#shared-node-properties) with the
following keys:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `marker` | constant \| accessor \| attribute binding | `'circle'` | Name of the marker glyph. See the list below for supported values. |
| `size` | constant \| accessor \| attribute binding | `12` | Marker size in pixels before zoom scaling. |
| `fill` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Fill color for the glyph. |
| `scaleWithZoom` | constant \| accessor \| attribute binding | `true` | When `true`, markers grow/shrink with the viewport zoom level. Set to `false` to keep a constant pixel size. |

Supported marker names include:

```
"location-marker-filled", "bell-filled", "bookmark-filled", "bookmark", "cd-filled",
"cd", "checkmark", "circle-check-filled", "circle-check", "circle-filled", "circle-i-filled",
"circle-i", "circle-minus-filled", "circle-minus", "circle-plus-filled", "circle-plus",
"circle-questionmark-filled", "circle-questionmark", "circle-slash-filled", "circle-slash",
"circle-x-filled", "circle-x", "circle", "diamond-filled", "diamond", "flag-filled",
"flag", "gear", "heart-filled", "heart", "bell", "location-marker", "octagonal-star-filled",
"octagonal-star", "person-filled", "person", "pin-filled", "pin", "plus-small", "plus",
"rectangle-filled", "rectangle", "star-filled", "star", "tag-filled", "tag", "thumb-down-filled",
"thumb-down", "thumb-up", "thumb_up-filled", "triangle-down-filled", "triangle-down",
"triangle-left-filled", "triangle-left", "triangle-right-filled", "triangle-right",
"triangle-up-filled", "triangle-up", "x-small", "x"
```

```js
{
  type: 'marker',
  marker: {attribute: 'status', fallback: 'online', scale: value => (value === 'offline' ? 'triangle-down-filled' : 'circle-filled')},
  size: 18,
  fill: {
    default: '#6B7280',
    hover: '#F59E0B'
  },
  scaleWithZoom: false
}
```

Use selectors to show different icons for interaction states:

```js
{
  type: 'marker',
  marker: {
    default: '@defaultIcon',
    selected: 'star-filled'
  },
  size: 16,
  fill: '#FBBF24'
}
```

#### Label node style

Labels are rendered with Deck.gl’s `TextLayer` and are typically combined with a
background primitive (circle, rectangle, etc.).

Alongside the [shared node options](#shared-node-properties), labels support the
following keys:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `text` | constant \| accessor \| attribute binding | – (required) | Text to display. Attribute strings such as `text: '@label'` read from node properties. |
| `color` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Font color. |
| `fontSize` | constant \| accessor \| attribute binding | `12` | Font size in pixels. |
| `textAnchor` | constant \| accessor \| attribute binding | `'middle'` | Horizontal alignment: `'start'`, `'middle'`, or `'end'`. |
| `alignmentBaseline` | constant \| accessor \| attribute binding | `'center'` | Vertical alignment: `'top'`, `'center'`, or `'bottom'`. |
| `angle` | constant \| accessor \| attribute binding | `0` | Clockwise rotation in degrees. |
| `textMaxWidth` | constant \| accessor \| attribute binding | `-1` | Maximum width in pixels before wrapping. `-1` disables wrapping. |
| `textWordBreak` | constant \| accessor \| attribute binding | `'break-all'` | Word-breaking mode passed to `TextLayer` (`'break-all'`, `'break-word'`, etc.). |
| `textSizeMinPixels` | constant \| accessor \| attribute binding | `9` | Minimum size the text is allowed to shrink to. |
| `scaleWithZoom` | constant \| accessor \| attribute binding | `true` | Whether the font scales with zoom. Set to `false` to keep screen-space size. |

```js
{
  type: 'label',
  text: '@label',
  color: '#E2E8F0',
  fontSize: 16,
  offset: [0, 18],
  alignmentBaseline: 'top'
}
```

Using selectors you can provide contextual hints:

```js
{
  type: 'label',
  text: '@label',
  color: {
    default: '#64748B',
    hover: '#F8FAFC'
  },
  textMaxWidth: 160,
  textWordBreak: 'break-word',
  ':selected': {
    fontSize: 20,
    scaleWithZoom: false
  }
}
```

## Edge styles

Edges are styled via the `stylesheet.edges` prop on `GraphLayer`. The legacy
`edgeStyle` prop forwards to this shape but will be removed in a future release.
Similar to nodes, a `GraphStylesheet` definition is normalized by the
`GraphStyleEngine`, which resolves colors, attribute bindings, and interaction
states before feeding them into Deck.gl’s `LineLayer`.

```js
const stylesheet = {
  edges: {
    stroke: {attribute: 'isCritical', fallback: false, scale: value => (value ? '#F97316' : '#94A3B8')},
    strokeWidth: {
      default: 1,
      hover: 3,
      selected: {attribute: 'weight', fallback: 2, scale: value => Math.min(6, 2 + value)}
    },
    decorators: [
      {type: 'edge-label', text: '@id', color: '#000', fontSize: 18},
      {type: 'arrow', color: '#222', size: 8, offset: [4, 0]}
    ]
  }
};
```

### Shared edge properties

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `stroke` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Line color. Accepts CSS strings, `[r, g, b, a]` arrays, or bindings such as `stroke: '@color'`. |
| `strokeWidth` | constant \| accessor \| attribute binding | `0` | Line width in pixels. |
| `data` | `(edges: any[]) => any` | `edges => edges` | Override the data object passed to the Deck.gl layer. |
| `visible` | `boolean` | `true` | Toggle the entire edge layer on/off. |
| `decorators` | `Array` | `[]` | Additional visual adornments such as labels or animated flow indicators. |

Edge styles honor the same selectors as node styles (`:hover`, `:dragging`, and
`:selected`). Selector blocks can override any property, including decorators.

### Edge decorators

Decorators add auxiliary visuals that travel along the edge path. Each decorator
is an object with a `type` field and accepts the same declarative value shapes as
nodes and edges.

#### Edge label decorator

Adds text anchored near the edge’s midpoint. Internally this uses the same
`ZoomableTextLayer` as node labels, so the available options are similar.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `text` | constant \| accessor \| attribute binding | – (required) | Label content. Attribute strings such as `text: '@weight'` pull from edge properties. |
| `color` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Font color. |
| `fontSize` | constant \| accessor \| attribute binding | `12` | Font size in pixels. |
| `textAnchor` | constant \| accessor \| attribute binding | `'middle'` | Horizontal alignment relative to the computed position. |
| `alignmentBaseline` | constant \| accessor \| attribute binding | `'center'` | Vertical alignment. |
| `angle` | constant \| accessor \| attribute binding | Automatic | Rotation in degrees. Defaults to the edge direction; override to lock the angle. |
| `textMaxWidth` | constant \| accessor \| attribute binding | `-1` | Maximum width before wrapping. `-1` disables wrapping. |
| `textWordBreak` | constant \| accessor \| attribute binding | `'break-all'` | Word-breaking mode (`'break-word'`, `'break-all'`, etc.). |
| `textSizeMinPixels` | constant \| accessor \| attribute binding | `9` | Minimum rendered size for zooming out. |
| `scaleWithZoom` | constant \| accessor \| attribute binding | `true` | Whether the label scales with the viewport zoom level. |
| `offset` | constant \| accessor \| attribute binding | `null` | Additional pixel offset from the centroid-derived anchor position. |

All properties support selectors (`:hover`, `:selected`, …) and accessors, just
like the base edge style.

```js
{
  type: 'edge-label',
  text: {attribute: 'weight', scale: value => `${value} ms`},
  color: {
    default: '#1F2937',
    hover: '#111827'
  },
  textAnchor: 'start',
  offset: [8, 0]
}
```

To keep labels readable while zooming, disable scaling at small sizes:

```js
{
  type: 'edge-label',
  text: '@label',
  scaleWithZoom: {
    default: true,
    dragging: false
  },
  textSizeMinPixels: 12
}
```

#### Flow decorator

The flow decorator draws animated segments moving along the edge direction. It
is useful to express throughput or directional emphasis.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `color` | constant \| accessor \| attribute binding | black (`[0, 0, 0]`) | Color of the animated segment. |
| `speed` | constant \| accessor \| attribute binding | `0` | Segments per second that travel along the edge. Positive values flow from source to target. |
| `width` | constant \| accessor \| attribute binding | `1` | Visual width of the segment in pixels. |
| `tailLength` | constant \| accessor \| attribute binding | `1` | Length of the fading trail behind each segment. |

All fields support accessors and selectors. A speed of `0` disables the motion
while still rendering a static highlight.

```js
{
  type: 'flow',
  color: '#22D3EE',
  width: 2,
  speed: {attribute: 'loadFactor', fallback: 0},
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

#### Arrow decorator

Renders arrowheads for directed edges. Supports `color`, `size`, and `offset`.
The `offset` accessor accepts `[along, perpendicular]` distances in layer units,
where `along` shifts the arrow away from the target node and `perpendicular`
offsets it orthogonally from the edge.

Decorators are processed by the stylesheet engine, so they can use selectors and
accessors just like the main edge style.

## Composing stylesheets

Supply the stylesheet via the `stylesheet` prop when constructing `GraphLayer`
(or React’s `<GraphLayer />`). The layer merges the declaration with sensible
defaults and feeds the result into the renderer:

```js
new GraphLayer({
  stylesheet: {
    nodes: [
      {type: 'circle', radius: 12, fill: '@groupColor'},
      {type: 'label', text: '@id', color: '#0F172A'}
    ],
    edges: {
      stroke: {
        attribute: 'weight',
        scale: {type: 'linear', domain: [0, 10], range: ['#CBD5F5', '#1E3A8A']}
      },
      strokeWidth: {attribute: 'weight', fallback: 1, scale: value => 0.5 + value * 0.2},
      decorators: [{type: 'edge-label', text: '@weight'}]
    }
  }
});
```

Edge styles may omit the `type` field—`GraphLayer` defaults it to `'edge'`—but
supplying it enables TypeScript to infer the correct decorator and property
options. Decorators are simply additional stylesheet entries inside the
`decorators` array and support the same value shapes and selectors as nodes and
edges.
