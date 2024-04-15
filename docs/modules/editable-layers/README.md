# Overview

![deck.gl](https://img.shields.io/badge/deck.gl-v9-green.svg?style=flat-square")
![WebGPU](https://img.shields.io/badge/webgpu-no-red.svg?style=flat-square")


Provides editable and interactive map overlay layers, built using the power of [deck.gl](https://deck.gl/).

## History

A fork of @nebula.gl. nebula.gl is an important part of the deck.gl ecosystem but the repository has lacked maintainers for several years and the repository no longer accepts external contributions.

## What's New

This page contains highlights of each `editable-layers` release.

### editable-layers v9.0


- The code has been updated to work with deck.gl v9. 
- The module structure has been simplified via the module mapping in the table below.

| @deck.gl-community/editable-layers module | Description         | deck.gl-community module                      |
| ----------------------------------------- | ------------------- | --------------------------------------------- |
| nebula.gl                                 | The core module     | => `@deck.gl-community/editable-layers`       |
| `@nebula.gl/edit-modes`                   | Optional edit modes | => `@deck.gl-community/editable-layers`       |
| `@nebula.gl/layers`                       | The actual layers   | => `@deck.gl-community/editable-layers`       |
| `@nebula.gl/overlays`                     | React overlays      | => `@deck.gl-community/react`                 |
| `@nebula.gl/editor`                       | React wrappers      | => `@deck.gl-community/react-editable-layers` |
| `react-map-gl-draw`                       | Non-deck-wrapper    | => NOT FORKED                                 |


### editable-layers v0.0.1

Release date: TBD

- new `DrawRectangleFromCenterMode`. User can draw a new rectangular `Polygon` feature by clicking the center, then along a corner of the rectangle.
- `screenSpace` option can be provided in the `modeConfig` of Translate mode so the features will be translated without distortion in screen space.
- `lockRectangles` option can be provided in the `modeConfig` object for ModifyMode, so the features with `properties.shape === 'Rectangle'` will preserve rectangular shape.
- `pickingLineWidthExtraPixels` property to specify additional line width in pixels for picking. Can be useful when `EditableGeojsonLayer` is over a deck.gl layer and precise picking is problematic, and when usage of `pickingDepth` introduces performance issues.

