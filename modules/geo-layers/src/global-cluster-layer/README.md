# GlobalClusterLayer

A composite layer that clusters points and displays them with text-based count labels. This layer provides full globe support with dynamic clustering adjustments.

## Features

- **Automatic clustering** using Supercluster algorithm
- **Dynamic text labels** showing actual cluster counts (not pre-fab icons)
- **Globe support** with billboard text rendering and FOV-based visibility filtering
- **Customizable styling** for clusters and individual points
- **Dynamic clustering** option for accurate cluster counts that adjust as viewport changes
- **Visual scaling** with `sizeByCount` to make larger clusters display with bigger circles
- **Type-safe** implementation without generic types

## Usage

```typescript
import {GlobalClusterLayer} from '@deck.gl-community/geo-layers';

const layer = new GlobalClusterLayer({
  id: 'global-cluster',
  data: myData,
  getPosition: d => d.coordinates,

  // Clustering
  clusterRadius: 80,
  clusterMaxZoom: 16,
  dynamicClustering: true,  // Clusters adjust as viewport changes
  
  // Visual scaling
  sizeByCount: true,        // Larger clusters = bigger circles

  // Cluster styling
  clusterFillColor: [51, 102, 204, 200],
  clusterTextColor: [255, 255, 255, 255],
  clusterRadiusScale: 1,
  clusterRadiusMinPixels: 20,
  clusterRadiusMaxPixels: 100,

  // Individual point styling
  pointFillColor: [255, 140, 0, 200],
  pointRadiusMinPixels: 8,
  pointRadiusMaxPixels: 20,

  // Text styling
  fontFamily: 'Monaco, monospace',
  fontWeight: 'bold',
  clusterTextSize: 16,

  pickable: true
});
```

## Example with GeoJSON

```typescript
import {GlobalClusterLayer} from '@deck.gl-community/geo-layers';

const layer = new GlobalClusterLayer({
  id: 'global-data-points',
  data: features.map(feature => ({
    type: 'Feature',
    geometry: feature.geometry,
    properties: feature.properties
  })),
  sizeMinPixels: 20,
  sizeMaxPixels: 30,
  sizeScale: 40,
  opacity: 1,
  getPosition: d => d.geometry.coordinates,
  parameters: {
    depthTest: false // Ensures visibility on globe
  }
});
```

## Properties

### Data Accessors

#### `getPosition` (Accessor&lt;DataT, Position&gt;, optional)

- Default: `d => d.position || [0, 0]`

Accessor for point coordinates in [longitude, latitude] format.

#### `getPointId` (Accessor&lt;DataT, string | number&gt;, optional)

- Default: `(d, {index}) => index`

Accessor for stable point ID. Required for smooth transitions between zoom levels.

### Clustering Configuration

#### `clusterRadius` (Number, optional)

- Default: `80`

Cluster radius in pixels. Points within this distance will be grouped into a cluster.

#### `clusterMaxZoom` (Number, optional)

- Default: `16`

Maximum zoom level for clustering. Beyond this zoom, all points are shown individually.

#### `dynamicClustering` (Boolean, optional)

- Default: `false`

When enabled, re-clusters based on visible points only. Cluster counts decrement as individual points leave the viewport. More accurate but potentially less performant on viewport changes.

#### `sizeByCount` (Boolean, optional)

- Default: `false`

When enabled, scales cluster circle size based on point count. Larger clusters have bigger circles.

### Cluster Styling

#### `clusterFillColor` (Color, optional)

- Default: `[51, 102, 204, 200]`

Fill color for cluster circles in RGBA format.

#### `clusterTextColor` (Color, optional)

- Default: `[255, 255, 255, 255]`

Text color for cluster count labels in RGBA format.

#### `clusterRadiusScale` (Number, optional)

- Default: `1`

Scale for cluster circle radius.

#### `clusterRadiusMinPixels` (Number, optional)

- Default: `20`

Minimum pixel radius for cluster circles.

#### `clusterRadiusMaxPixels` (Number, optional)

- Default: `100`

Maximum pixel radius for cluster circles (used when `sizeByCount` is enabled).

#### `clusterTextSize` (Number, optional)

- Default: `16`

Font size for cluster count text in pixels.

### Point Styling

#### `pointFillColor` (Color, optional)

- Default: `[255, 140, 0, 200]`

Fill color for individual points in RGBA format.

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

#### `fontWeight` (String, optional)

- Default: `'bold'`

Font weight for cluster count text.

## Globe Support

The layer automatically handles globe projections:
- Text labels use billboard rendering to face the camera
- FOV-based visibility filtering ensures proper rendering on spherical surfaces
- Smooth opacity transitions at the edges of the visible hemisphere
- Works seamlessly with both flat and globe views

## Picking

When picking a cluster, the layer returns:
- `object`: The cluster or point properties
- `objects`: Array of all points in the cluster (only for clusters, not on hover)

```typescript
layer.onClick = (info) => {
  if (info.objects) {
    console.log('Cluster with', info.objects.length, 'points');
  } else if (info.object) {
    console.log('Individual point:', info.object);
  }
};
```

## Source

This layer is based on the IconClusterLayer from [deck.gl PR #9935](https://github.com/visgl/deck.gl/pull/9935).
