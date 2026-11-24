---
title: Getting Started
description: Install a deck.gl-community package and choose a layer entry point.
---

# Getting Started

deck.gl-community packages add layers and components to a deck.gl application. Start by
choosing a package from the [Packages index](/docs/category/packages). Its overview lists the
installation command and the available APIs.

## Install a package

If you already use deck.gl, choose a compatible community release and install the package
that contains the API you need. Check its peer dependencies and the [upgrade guide](./upgrade-guide.md)
when switching deck.gl versions.

```sh
npm install @deck.gl-community/layers
```

## Add a layer

The Layers package groups related APIs under import subpaths. This path example uses the
common family. Add the layer to your deck.gl application's `layers` array.

```ts
import {PathOutlineLayer} from '@deck.gl-community/layers/common-layers';

const layer = new PathOutlineLayer({
  id: 'route',
  data: [{path: [[-122.42, 37.77], [-122.40, 37.79]]}],
  getPath: row => row.path,
  getWidth: 4
});
```

See the [Layers overview](./modules/layers/README.md) for geo, global grid, wind, and tree
imports and the optional libraries that some subpaths require.

## Choose a rendering backend

Check [WebGPU support](./webgpu.md) for the layers and components you plan to use. The
[deck.gl developer guide](https://deck.gl/docs/get-started) covers creating a deck.gl application.
