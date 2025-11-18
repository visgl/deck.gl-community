# HtmlClusterWidget

Cluster HTML overlay items based on zoom level. Subclass this widget and implement the abstract
methods to describe your data. Each method should return [`HtmlOverlayItem`](./html-overlay-item.md)
instances so that the widget can project them.

```ts
import {h} from 'preact';
import {HtmlClusterWidget, HtmlOverlayItem} from '@deck.gl-community/widgets';

class CustomClusterWidget extends HtmlClusterWidget<MyObject> {
  getAllObjects() {
    return this.props.objects;
  }

  getObjectCoordinates(obj: MyObject) {
    return obj.coordinates;
  }

  renderObject(coordinates: number[], obj: MyObject) {
    return h(HtmlOverlayItem, {coordinates, key: obj.id}, obj.label);
  }

  renderCluster(coordinates: number[], clusterId: number, pointCount: number) {
    return h(HtmlOverlayItem, {coordinates, key: `cluster-${clusterId}`}, `${pointCount}`);
  }
}
```

## Methods to override

### getAllObjects()

Return an array of objects that should be clustered. Reuse the same array reference when possible
to avoid rebuilding the cluster.

### getObjectCoordinates(object)

Return `[lng, lat]` coordinates for an object.

### renderObject(coordinates, object)

Return an `HtmlOverlayItem` for an individual object.

### renderCluster(coordinates, clusterId, pointCount)

Return an `HtmlOverlayItem` for the `cluster` at `coordinates`. Use `getClusterObjects(clusterId)`
to retrieve all items in the cluster.

## Methods (provided)

### getClusterObjects(clusterId)

Returns the objects contained in the cluster.

### getClusterOptions()

Override to customize the
[supercluster](https://www.npmjs.com/package/supercluster#options) instantiation options.
