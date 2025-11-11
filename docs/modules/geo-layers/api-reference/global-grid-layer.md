# GlobalGridLayer

<!--
import {GlobalGridLayerDemo} from '@site/src/doc-demos/geo-layers';
<GlobalGridLayerDemo />
-->

The `GlobalGridLayer` renders filled and/or stroked polygons based on the specified DGGS geospatial indexing system.

`GlobalGridLayer` is a [CompositeLayer](https://deck.gl/docs/api-reference/core/composite-layer).

This layer consumes implementations of the [GlobalGrid](./global-grid) interface. The package includes prebuilt helpers for common DGGS formats:

- [A5Grid](./a5-grid)
- [H3Grid](./h3-grid)
- [S2Grid](./s2-grid)
- [GeohashGrid](./geohash-grid)
- [QuadkeyGrid](./quadkey-grid)


import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="language">
  <TabItem value="js" label="JavaScript">

```js
import {Deck} from '@deck.gl/core';
import {GlobalGridLayer, A5Grid} from '@deck.gl/geo-layers';

const layer = new GlobalGridLayer({
  id: 'GlobalGridLayer',
  data: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/sf.bike.parking.a5.json',
  globalGrid: A5Grid,

  extruded: true,
  getPentagon: f => f.pentagon,
  getFillColor: f => {
    const value = f.count / 211;
    return [(1 - value) * 235, 255 - 85 * value, 255 - 170 * value];
  },
  getElevation: f => f.count,
  elevationScale: 10,
  pickable: true
});

new Deck({
  initialViewState: {
    longitude: -122.4,
    latitude: 37.74,
    zoom: 11
  },
  controller: true,
  getTooltip: ({object}) => object && `${object.pentagon} count: ${object.count}`,
  layers: [layer]
});
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
import {Deck, PickingInfo} from '@deck.gl/core';
import {GlobalGridLayer, A5Grid} from '@deck.gl/geo-layers';

type DataType = {
  pentagon: string;
  count: number;
};

const layer = new GlobalGridLayer<DataType>({
  id: 'GlobalGridLayer',
  data: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/sf.bike.parking.a5.json',
  globalGrid: A5Grid,

  extruded: true,
  getPentagon: (f: DataType) => f.pentagon,
  getFillColor: (f: DataType) => {
    const value = f.count / 211;
    return [(1 - value) * 235, 255 - 85 * value, 255 - 170 * value];
  },
  getElevation: (f: DataType) => f.count,
  elevationScale: 10,
  pickable: true
});

new Deck({
  initialViewState: {
    longitude: -122.4,
    latitude: 37.74,
    zoom: 11
  },
  controller: true,
  getTooltip: ({object}: PickingInfo<DataType>) => object && `${object.pentagon} count: ${object.count}`,
  layers: [layer]
});
```

  </TabItem>
  <TabItem value="react" label="React">

```tsx
import React from 'react';
import {DeckGL} from '@deck.gl/react';
import {GlobalGridLayer, A5Grid} from '@deck.gl/geo-layers';
import type {PickingInfo} from '@deck.gl/core';

type DataType = {
  pentagon: string;
  count: number;
};

function App() {
  const layer = new GlobalGridLayer<DataType>({
    id: 'GlobalGridLayer',
    data: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/sf.bike.parking.a5.json',
    globalGrid: A5Grid,

    extruded: true,
    getPentagon: (f: DataType) => f.pentagon,
    getFillColor: (f: DataType) => {
      const value = f.count / 211;
      return [(1 - value) * 235, 255 - 85 * value, 255 - 170 * value];
    },
    getElevation: (f: DataType) => f.count,
    elevationScale: 10,
    pickable: true
  });

  return <DeckGL
    initialViewState={{
      longitude: -122.4,
      latitude: 37.74,
      zoom: 11
    }}
    controller
    getTooltip={({object}: PickingInfo<DataType>) => object && `${object.pentagon} count: ${object.count}`}
    layers={[layer]}
  />;
}
```

  </TabItem>
</Tabs>


## Installation

To install the dependencies from NPM:

```bash
npm install deck.gl
# or
npm install @deck.gl/core @deck.gl/layers @deck.gl/geo-layers
```

```ts
import {GlobalGridLayer} from '@deck.gl/geo-layers';
import type {GlobalGridLayerProps} from '@deck.gl/geo-layers';

new GlobalGridLayer<DataT>(...props: GlobalGridLayerProps<DataT>[]);
```

To use pre-bundled scripts:

```html
<script src="https://unpkg.com/deck.gl@^9.0.0/dist.min.js"></script>
<!-- or -->
<script src="https://unpkg.com/@deck.gl/core@^9.0.0/dist.min.js"></script>
<script src="https://unpkg.com/@deck.gl/layers@^9.0.0/dist.min.js"></script>
<script src="https://unpkg.com/@deck.gl/geo-layers@^9.0.0/dist.min.js"></script>
```

```js
new deck.GlobalGridLayer({});
```


## Properties




Inherits from all [Base Layer](https://deck.gl/docs/api-reference/core/layer), [CompositeLayer](https://deck.gl/docs/api-reference/core/composite-layer), and [PolygonLayer](https://deck.gl/docs/api-reference/layers/polygon-layer) properties, plus the following:

### Data Accessors

#### `getPentagon` (Accessor&lt;bigint | string&gt;] ![transition-enabled](https://img.shields.io/badge/transition-enabled-green.svg?style=flat-square") {#getpentagon}

Called for each data object to retrieve the identifier of the DGGS cell id.  May return one of the following:

- A 64-bit [BigInt](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) identifier for the cell.
- A string token representing the DGGS-specific string encoding of the 64-bit integer


* default: `object => object.pentagon`


## Sub Layers

The `GlobalGridLayer` renders the following sublayers:

* `cell` - a [PolygonLayer](https://deck.gl/docs/api-reference/layers/polygon-layer) rendering the DGGS cells.


## Source

[modules/geo-layers/src/global-grid-layer](https://github.com/visgl/deck.gl/tree/master/modules/geo-layers/src/global-grid-layer)
