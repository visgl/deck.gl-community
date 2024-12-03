# Overview

:::danger
The deck.gl-community repo is specifically set up to collect useful code that no longer has dedicated maintainers. This means that there is often no one who can respond quickly to issues. The vis.gl / Open Visualization team members who try to keep this running can only put a few hours into it every now and then. It is important to understand this limitation. If your project depends on timely fixes, and you are not able to contribute them yourself, deck.gl-community modules may not be the right choice for you.
:::

![deck.gl v9](https://img.shields.io/badge/deck.gl-v9-green.svg?style=flat-square")
![WebGPU not supported](https://img.shields.io/badge/webgpu-no-red.svg?style=flat-square")

Provides editable and interactive map overlay layers, built using the power of [deck.gl](https://deck.gl/).

## Design Goals

`@deck.gl-community/editable-layers` aspires to be an ultra-performant, fully 3D-enabled GeoJSON editing system primarily focused on geospatial editing use cases.

- Maximal rendering and editing performance.
- Editing at 60fps (e.g. dragging sub objects) in GeoJSON payloads with 100K features (points, lines or polygons).
- Handle GeoJSON corner cases (e.g. automatically changing object types from `Polygon` to `MultiPolygon` when addition polygons are added).
- Fully 3D enabled (Can use WebGL z-buffer so that lines being rendered are properly occluded by other geometry).
- Seamless integration with deck.gl, allowing for GeoJSON editing to be interleaved with rich 3D visualizations.
- Handle event handling, including touch screen support.

## History

A fork of @nebula.gl. [nebula.gl](https://nebula.gl) is an important part of the deck.gl ecosystem but the repository has lacked maintainers for several years and the repository no longer accepts external contributions.

## What's New

This page contains highlights of each `editable-layers` release.

### editable-layers v9.1

- Now stores properties of created circles and ellipses in `properties.editProperties`.

### editable-layers v9.0

- The code has been updated to work with deck.gl v9.
- The module structure has been simplified via the module mapping in the table below.

| @deck.gl-community/editable-layers module | Description         | deck.gl-community module                |
| ----------------------------------------- | ------------------- | --------------------------------------- |
| nebula.gl                                 | The core module     | => `@deck.gl-community/editable-layers` |
| `@nebula.gl/edit-modes`                   | Optional edit modes | => `@deck.gl-community/editable-layers` |
| `@nebula.gl/layers`                       | The actual layers   | => `@deck.gl-community/editable-layers` |
| `@nebula.gl/overlays`                     | React overlays      | => `@deck.gl-community/react`           |
| `@nebula.gl/editor`                       | React wrappers      | => Code moved into "editor" example     |
| `react-map-gl-draw`                       | Non-deck-wrapper    | => NOT FORKED                           |

## Upgrade Guide

### Upgrade to editable-layers v9.1

- Changes
  - Make sure your deck.gl and luma.gl dependencies are updated to v9.1
- Deprecations:
  - `properties.shape` is deprecated, use `properties.editProperties.shape`.

### Upgrading from nebula.gl to editable-layers v9.0

The main effort should be to replace your dependencies in package.json and replace import statements in your code:

| nebula.gl import                 | deck.gl-community import                | Comment                                                  |
| -------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| nebula.gl                        | => `@deck.gl-community/editable-layers` |                                                          |
| `import '@nebula.gl/edit-modes'` | => `@deck.gl-community/editable-layers` |                                                          |
| `import '@nebula.gl/layers`      | => `@deck.gl-community/editable-layers` |                                                          |
| `import '@nebula.gl/overlays`    | => `@deck.gl-community/react`           |                                                          |
| `import '@nebula.gl/editor'`     | => N/A                                  | Copy code from `examples/editor` directory into your app |
| `import 'react-map-gl-draw'`     | => N/A                                  | Copy code from nebula.gl repo into your app.             |

- **`react-map-gl-draw`**
  - nebula.gl's `react-map-gl-draw` module was not ported to `deck.gl-community`.
  - The main reason why a user would want to update `react-map-gl-draw` is likely to make it work with a newer React version.
  - `react-map-gl-draw` is a small module in nebula.gl and you could probably just copy the source code into your app and bump the react dependency.
