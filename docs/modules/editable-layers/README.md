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

A fork of @nebula.gl. [nebula.gl](https://nabula.gl) is an important part of the deck.gl ecosystem but the repository has lacked maintainers for several years and the repository no longer accepts external contributions.

## What's New

This page contains highlights of each `editable-layers` release.

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

Notes:
- `react-map-gl-draw`- A notable omission is that `react-map-gl-draw` is not included in this fork. This decision was made to simplify the nebula.gl code base with the hope of making it easier for non-dedicated maintainers to keep the deck.gl layers version of nebula.gl alive. Given that the new version is no longer broken into deck.gl independent modules, it may not be easy to add.
The main reason for updating react-map-gl-draw is likely to make it work with the latest React versions. If it helps, `react-map-gl-draw` is a small module and you can probably copy the source code into your app and bump the react dependency.
