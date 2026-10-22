# Overview

![From v9.4](https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square)

This package contains [layer extensions](https://deck.gl/docs/api-reference/extensions/overview)
for deck.gl. An extension adds props and shader code to existing layers, including deck.gl's own
layers and the layers in other `@deck.gl-community` packages.

:::caution
The deck.gl-community repository is semi-maintained. One of its goals is to collect and preserve valuable deck.gl ecosystem related code that does not have a dedicated home. Some modules may no longer have dedicated maintainers. This means that there is sometimes no one who can respond quickly to issues.
:::

## Installation

```bash
npm install @deck.gl-community/extensions
```

## Exports

- [`SelectionPulseExtension`](./api-reference/selection-pulse-extension.md): GPU pulse for selected objects
- [`ZoomOpacityExtension`](./api-reference/zoom-opacity-extension.md): layer opacity as a function of zoom, with the `zoomBand` and `interpolateZoom` helpers
