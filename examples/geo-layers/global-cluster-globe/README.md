# GlobalClusterLayer Globe Example

This example demonstrates the `GlobalClusterLayer` working on a globe projection with text-based cluster counts.

## Features Demonstrated

- **Globe View**: Uses `_GlobeView` for 3D globe rendering
- **Point Clustering**: Automatic clustering using Supercluster algorithm
- **Dynamic Clustering**: Optional re-clustering based on visible points
- **Visual Scaling**: Cluster circles scale based on point count
- **Text Labels**: Shows actual cluster counts as text overlays
- **Globe-Aware Rendering**: FOV-based visibility filtering and opacity transitions

## Key Configuration

```typescript
new GlobalClusterLayer({
  clusterRadius: 80,           // Cluster points within 80px radius
  clusterMaxZoom: 16,          // Beyond zoom 16, show all points
  dynamicClustering: true,     // Re-cluster on viewport change
  sizeByCount: true,           // Scale circles by count
  clusterRadiusMinPixels: 20,
  clusterRadiusMaxPixels: 45
})
```

## Running the Example

```bash
yarn
cd examples/geo-layers/global-cluster-globe
yarn start
```

## Controls

- **Click and drag**: Rotate the globe
- **Mouse wheel**: Zoom in/out
- **Hover**: See cluster or point information

## Notes

- `dynamicClustering: true` provides more accurate cluster counts but may impact performance on viewport changes
- `sizeByCount: true` makes larger clusters visually more prominent
- The layer automatically handles FOV-based visibility and smooth opacity transitions for the globe view
