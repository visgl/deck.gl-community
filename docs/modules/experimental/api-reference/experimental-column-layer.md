# ExperimentalColumnLayer

The `ExperimentalColumnLayer` renders extruded cylinders (tessellated regular polygons) at given coordinates with enhanced support for custom bevel shapes and per-instance radius control.

This layer extends the capabilities of deck.gl's base `ColumnLayer` by introducing the `getBevel` and `getRadius` accessors, which are particularly useful for tree-like visualizations and hierarchical data.

## Features

- **Custom Bevel Shapes**: Control the top cap shape of each column with options including flat, dome, cone, or custom configurations
- **Per-Instance Radius**: Scale each column's radius independently using the `getRadius` accessor
- **Advanced Bevel Control**: Fine-tune bevel shape with segment count, height, and bulge parameters
- **Full Material Support**: Maintains all standard deck.gl material and lighting features

## Example

```typescript
import {ExperimentalColumnLayer} from '@deck.gl-community/experimental';

const layer = new ExperimentalColumnLayer({
  id: 'experimental-column-layer',
  data: DATA_URL,
  getPosition: d => d.position,
  getElevation: d => d.height,
  getRadius: d => d.radius,  // Per-instance radius scaling
  getBevel: d => {
    // Custom bevel based on data
    if (d.type === 'leaf') return 'dome';
    if (d.type === 'branch') return 'cone';
    return {segs: 5, height: d.bevelHeight, bulge: 0.2};
  },
  radius: 1000,
  extruded: true,
  getFillColor: d => d.color
});
```

## Properties

Inherits all properties from deck.gl's base `Layer` class, with the following additions:

### `getRadius` (Accessor)

- **Type**: `Accessor<DataT, number>`
- **Default**: `1`

Per-instance radius multiplier. This value is multiplied by the `radius` prop to determine the final column radius.

### `getBevel` (Accessor)

- **Type**: `Accessor<DataT, BevelProp>`
- **Default**: `'flat'`

Controls the bevel (top cap) shape for each column. Can be:

- `'flat'`: No bevel (flat top) - default
- `'dome'`: Rounded dome with smooth normals (height = radius)
- `'cone'`: Pointed cone (height = radius)
- `number`: Custom dome height in world units
- `{segs, height, bulge?}`: Full control over bevel shape
  - `segs`: Number of bevel segments (0-1=flat, 2=cone, 3+=dome)
  - `height`: Bevel height in world units (must be > 0)
  - `bulge`: Curve factor (-1 to 1+), 0=standard dome, negative=concave, positive=convex bulge

### `bevelSegments` (Number, optional)

- **Type**: `number | null`
- **Default**: `diskResolution / 4`

Global number of segments for the bevel cap. Higher values create smoother domes. This is used when the bevel type is 'dome' or when a custom height number is provided without explicit segment count.

## Bevel Behavior Notes

- The bevel always cuts INTO the column (reduces the effective height)
- If the bevel height exceeds the column elevation, it will be capped at the column's elevation
- Flat caps render at the full column elevation
- Per-instance `getBevel` overrides any global bevel settings

## Source

[modules/experimental/src/experimental-column-layer](https://github.com/visgl/deck.gl-community/tree/master/modules/experimental/src/experimental-column-layer)
