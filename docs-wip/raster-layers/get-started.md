# Install

```
yarn add @kylebarron/deck.gl-raster
```

Several peer dependencies are also necessary:

```
yarn add deck.gl @luma.gl/constants @luma.gl/core @luma.gl/engine @luma.gl/webgl
```

These are listed as peer dependencies to avoid version conflicts in larger
applications that use other deck.gl layers.

You should also be able to load necessary modules as scripts:

```html
<script src="https://unpkg.com/@kylebarron/deck.gl-raster@^0.3.1/dist/dist.min.js"></script>
<script src="https://unpkg.com/@deck.gl/core@^8.2.0/dist.min.js"></script>
<script src="https://unpkg.com/@deck.gl/layers@^8.2.0/dist.min.js"></script>
<script src="https://unpkg.com/@deck.gl/mesh-layers@^8.2.0/dist.min.js"></script>
<script src="https://unpkg.com/@luma.gl/constants@^8.2.0/dist.min.js"></script>
<script src="https://unpkg.com/@luma.gl/core@^8.2.0/dist.min.js"></script>
<script src="https://unpkg.com/@luma.gl/engine@^8.2.0/dist.min.js"></script>
<script src="https://unpkg.com/@luma.gl/webgl@^8.2.0/dist.min.js"></script>
```
