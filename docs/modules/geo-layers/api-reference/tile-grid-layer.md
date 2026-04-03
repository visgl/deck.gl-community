# TileGridLayer

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/experimental-orange.svg?style=flat-square" alt="experimental" />
</p>

`TileGridLayer` is a public helper layer for visualizing tile loading. It renders a
border and optional label for a single tile header.

It is intended to be used inside `Tile2DLayer.renderSubLayers`, where `props.tile` is already available. This makes it useful for:

- visualizing tile boundaries
- showing tile zoom depth and `x/y/z` indices
- understanding which tiles are active while panning and zooming
- debugging shared tileset traversal across multiple views

## Import

```ts
import {TileGridLayer, type TileGridLayerProps} from '@deck.gl-community/geo-layers';
```

## Usage

```ts
import {Tile2DLayer, TileGridLayer} from '@deck.gl-community/geo-layers';

new Tile2DLayer({
  id: 'tile-grid',
  data: sharedTileset,
  pickable: false,
  renderSubLayers: props =>
    new TileGridLayer(props, {
      tile: props.tile,
      borderColor: [255, 255, 255, 180],
      labelBackgroundColor: [15, 23, 42, 210]
    })
});
```

## Props

#### `tile` (`Tile2DHeader2`) {#tile}

Tile header whose bounds and index should be visualized.

#### `showBorder` (`boolean`, optional) {#showborder}

- Default: `true`

Whether to draw the tile border.

#### `showLabel` (`boolean`, optional) {#showlabel}

- Default: `true`

Whether to render a label at the tile center.

#### `getLabel` (`string | (tile) => string`, optional) {#getlabel}

- Default: `tile => \`z\${tile.index.z} x\${tile.index.x} y\${tile.index.y}\``

Static label text or formatter for per-tile label content.

#### `borderColor` (`Color`, optional) {#bordercolor}

- Default: `[255, 255, 255, 180]`

Stroke color used for the tile border.

#### `labelColor` (`Color`, optional) {#labelcolor}

- Default: `[255, 255, 255, 255]`

Text color used for the tile label.

#### `labelBackgroundColor` (`Color`, optional) {#labelbackgroundcolor}

- Default: `[15, 23, 42, 210]`

Background color shown behind the tile label.

#### `borderWidthMinPixels` (`number`, optional) {#borderwidthminpixels}

- Default: `1`

Minimum screen-space width of the tile border.

#### `labelSize` (`number`, optional) {#labelsize}

- Default: `12`

Screen-space font size of the tile label in pixels.

## Notes

- `TileGridLayer` does not select or load tiles by itself.
- It is best paired with `Tile2DLayer` or another tiled renderer that already exposes tile headers.
- Use it as a lightweight overlay when you want to inspect tile loading behavior without changing your tile source or tileset implementation.
- For geospatial tiles, the border is rendered in longitude/latitude coordinates taken from the tile bounds.

## See Also

- [Tile2DLayer](./tile-2d-layer.md)
- [Tile2DTileset](./tile-2d-tileset.md)
- [Tile2DLayer example](/examples/geo-layers/tile-2d-layer)
