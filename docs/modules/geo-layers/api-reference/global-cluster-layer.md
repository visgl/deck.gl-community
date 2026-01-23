# GlobalClusterLayer

The `GlobalClusterLayer` is a composite layer that clusters points and displays them with text-based count labels. It provides full support for both 2D maps and 3D globe projections with dynamic clustering adjustments.

```typescript
import {GlobalClusterLayer} from '@deck.gl-community/geo-layers';

const layer = new GlobalClusterLayer({
  id: 'global-cluster',
  data: points,
  getPosition: d => d.coordinates,
  clusterRadius: 80,
  clusterMaxZoom: 16,
  dynamicClustering: true,
  sizeByCount: true
});
```

## Installation

```bash
npm install @deck.gl-community/geo-layers
```

## Features

- **Automatic clustering** using the Supercluster algorithm
- **Dynamic text labels** showing actual cluster counts (not pre-rendered icons)
- **Globe support** with FOV-based visibility filtering and billboard text rendering
- **Dynamic clustering** option for accurate cluster counts that adjust as viewport changes
- **Visual scaling** with `sizeByCount` to make larger clusters display with bigger circles
- **Smooth transitions** between zoom levels with stable IDs

## Properties

### Data Accessors

#### `data` (Array)

- Required

Array of data objects to cluster.

#### `getPosition` (Accessor&lt;DataT, Position&gt;, optional)

- Default: `d => d.position || [0, 0]`

Accessor for point coordinates in `[longitude, latitude]` format.

```typescript
getPosition: d => d.coordinates
```

#### `getPointId` (Accessor&lt;DataT, string | number&gt;, optional)

- Default: `(d, {index}) => index`

Accessor for stable point ID. Required for smooth transitions between zoom levels. If your data has a unique identifier, use it here for best results.

```typescript
getPointId: d => d.id
```

### Clustering Configuration

#### `clusterRadius` (Number, optional)

- Default: `80`

Cluster radius in pixels. Points within this distance will be grouped into a cluster.

#### `clusterMaxZoom` (Number, optional)

- Default: `16`

Maximum zoom level for clustering. Beyond this zoom, all points are shown individually.

#### `dynamicClustering` (Boolean, optional)

- Default: `false`

When enabled, re-clusters based on visible points only. Cluster counts decrement as individual points leave the viewport (particularly visible on globe views). More accurate but potentially less performant on viewport changes.

```typescript
dynamicClustering: true  // More accurate counts, slightly lower performance
```

#### `sizeByCount` (Boolean, optional)

- Default: `false`

When enabled, scales cluster circle size based on point count. Larger clusters have bigger circles.

```typescript
sizeByCount: true  // Visual scaling by cluster size
```

### Cluster Styling

#### `clusterFillColor` (Color, optional)

- Default: `[51, 102, 204, 200]`

Fill color for cluster circles in RGBA format.

```typescript
clusterFillColor: [51, 102, 204, 220]
```

#### `clusterTextColor` (Color, optional)

- Default: `[255, 255, 255, 255]`

Text color for cluster count labels in RGBA format.

```typescript
clusterTextColor: [255, 255, 255, 255]
```

#### `clusterRadiusScale` (Number, optional)

- Default: `1`

Scale multiplier for cluster circle radius.

#### `clusterRadiusMinPixels` (Number, optional)

- Default: `20`

Minimum pixel radius for cluster circles.

#### `clusterRadiusMaxPixels` (Number, optional)

- Default: `100`

Maximum pixel radius for cluster circles. Used when `sizeByCount` is enabled.

#### `clusterTextSize` (Number, optional)

- Default: `16`

Font size for cluster count text in pixels.

### Point Styling

#### `pointFillColor` (Color, optional)

- Default: `[255, 140, 0, 200]`

Fill color for individual points (non-clustered) in RGBA format.

```typescript
pointFillColor: [255, 140, 0, 220]
```

#### `pointRadiusMinPixels` (Number, optional)

- Default: `8`

Minimum pixel radius for individual points.

#### `pointRadiusMaxPixels` (Number, optional)

- Default: `20`

Maximum pixel radius for individual points.

### Text Styling

#### `fontFamily` (String, optional)

- Default: `'Monaco, monospace'`

Font family for cluster count text.

```typescript
fontFamily: 'Monaco, monospace'
```

#### `fontWeight` (String, optional)

- Default: `'bold'`

Font weight for cluster count text.

```typescript
fontWeight: 'bold'
```

## Usage Examples

### Basic Usage

```typescript
import {Deck} from '@deck.gl/core';
import {GlobalClusterLayer} from '@deck.gl-community/geo-layers';

const points = [
  {coordinates: [-122.4, 37.8], id: 1, value: 100},
  {coordinates: [-122.5, 37.9], id: 2, value: 200},
  // ...
];

new Deck({
  layers: [
    new GlobalClusterLayer({
      id: 'clusters',
      data: points,
      getPosition: d => d.coordinates,
      pickable: true
    })
  ]
});
```

### With Globe View

```typescript
import {Deck, _GlobeView as GlobeView} from '@deck.gl/core';
import {GlobalClusterLayer} from '@deck.gl-community/geo-layers';

new Deck({
  views: new GlobeView(),
  layers: [
    new GlobalClusterLayer({
      id: 'global-clusters',
      data: worldwidePoints,
      getPosition: d => d.coordinates,
      
      // Globe-specific settings
      dynamicClustering: true,  // Accurate counts as points rotate out of view
      sizeByCount: true,        // Visual emphasis on larger clusters
      
      clusterRadius: 80,
      clusterMaxZoom: 16,
      clusterRadiusMinPixels: 20,
      clusterRadiusMaxPixels: 45
    })
  ]
});
```

### Custom Styling

```typescript
new GlobalClusterLayer({
  id: 'styled-clusters',
  data: points,
  getPosition: d => d.coordinates,
  
  // Custom cluster appearance
  clusterFillColor: [51, 102, 204, 220],
  clusterTextColor: [255, 255, 255, 255],
  clusterRadiusMinPixels: 25,
  clusterRadiusMaxPixels: 60,
  clusterTextSize: 18,
  
  // Custom point appearance
  pointFillColor: [255, 140, 0, 220],
  pointRadiusMinPixels: 6,
  pointRadiusMaxPixels: 18,
  
  // Custom text
  fontFamily: 'Arial, sans-serif',
  fontWeight: 'normal'
});
```

## Interaction

### Picking

When picking a cluster or point, the layer returns:

- `object`: The cluster or point properties
- `objects`: Array of all points in the cluster (only for clusters, not available on hover)

```typescript
const layer = new GlobalClusterLayer({
  // ... other props
  pickable: true,
  onClick: (info) => {
    if (info.objects) {
      // Clicked on a cluster
      console.log(`Cluster contains ${info.objects.length} points`);
      console.log('Points:', info.objects);
    } else if (info.object) {
      // Clicked on individual point
      console.log('Individual point:', info.object);
    }
  },
  onHover: (info) => {
    if (info.object) {
      // Note: objects array not available on hover, only on click
      console.log('Hovering:', info.object);
    }
  }
});
```

### Tooltips

```typescript
new Deck({
  layers: [layer],
  getTooltip: ({object, objects}) => {
    if (objects) {
      return `Cluster: ${objects.length} points`;
    } else if (object) {
      return `Point: ${object.name}`;
    }
    return null;
  }
});
```

## Globe View Support

The `GlobalClusterLayer` is specifically designed to work seamlessly with globe projections:

- **FOV-based visibility filtering**: Points and clusters automatically fade out as they rotate away from the camera
- **Billboard text rendering**: Cluster count labels always face the camera
- **Smooth opacity transitions**: Gradual fade at the edges of the visible hemisphere
- **Dynamic clustering support**: Re-cluster based on visible points for accurate counts

### Globe-Specific Considerations

When using `dynamicClustering: true` on a globe:
- Cluster counts accurately reflect only the visible points
- Points that rotate out of view are excluded from clusters
- Provides the most accurate visual representation but may impact performance

When using `dynamicClustering: false` on a globe:
- Clusters are calculated from all points globally
- Entire clusters fade together as they rotate away
- Better performance, slightly less accurate visual representation

## Performance

- The layer uses the efficient Supercluster algorithm for point clustering
- For datasets with thousands of points, consider disabling `dynamicClustering` for better performance
- The `getPointId` accessor should return stable IDs for smooth transitions between zoom levels

## Source

Based on the IconClusterLayer from [deck.gl PR #9935](https://github.com/visgl/deck.gl/pull/9935).

## Related Layers

- [GlobalGridLayer](./global-grid-layer.md) - For cell-based clustering on global grid systems
- [ScatterplotLayer](https://deck.gl/docs/api-reference/layers/scatterplot-layer) - For non-clustered point visualization
