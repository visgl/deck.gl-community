# Overview

:::caution
The deck.gl-community repository is semi-maintaned. One of its goals is to collect and preserve valuable deck.gl ecosystem related code that does not have a dedicated home. Some modules may no longer have dedicated maintainers. This means that there is sometimes no one who can respond quickly to issues.
:::

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/widgets.svg)](https://www.npmjs.com/package/@deck.gl-community/widgets)
[![NPM Downloads](https://img.shields.io/npm/dw/@deck.gl-community/widgets.svg)](https://www.npmjs.com/package/@deck.gl-community/widgets)
![deck.gl v9](https://img.shields.io/badge/deck.gl-v9-green.svg?style=flat-square")
![WebGPU not supported](https://img.shields.io/badge/webgpu-no-red.svg?style=flat-square")

This module packages UI widgets that integrate with [deck.gl](https://deck.gl) view state management. It includes classic navigation widgets such as `PanWidget` and `ZoomRangeWidget`, HTML overlays, and deck-facing panel widgets for composing sidebars, modals, and info cards around a deck.gl canvas.

Panel definitions and standalone mounting live in `@deck.gl-community/panels`. Import panels from `panels`, then pass them to the deck-facing widgets in this package.

## Installation

```bash
npm install @deck.gl-community/widgets
```

## Usage

```ts
import DeckGL from '@deck.gl/react';
import {OrthographicView} from '@deck.gl/core';
import {PanWidget, ZoomRangeWidget} from '@deck.gl-community/widgets';

const widgets = [
  new PanWidget({placement: 'top-left', style: {margin: '16px'}}),
  new ZoomRangeWidget({placement: 'top-left', style: {margin: '96px 0 0 16px'}})
];

function App() {
  return (
    <DeckGL
      views={new OrthographicView({id: 'ortho'})}
      initialViewState={{target: [0, 0], zoom: 0}}
      controller={true}
      widgets={widgets}
      layers={[/* ... */]}
    />
  );
}
```

See the [Pan and Zoom widgets example](../../examples/widgets/pan-and-zoom-controls) for a non-geospatial walkthrough.

See the [Standalone Widgets example](../../examples/widgets/standalone-widgets) for deck-independent usage through `@deck.gl-community/panels`.

For the deck-facing panel widget APIs, see the [Widget Panels example](../../examples/widgets/widget-panels), which combines:

- `SidebarPanelWidget` for persistent controls
- `ModalPanelWidget` for tabbed secondary panels
- `BoxPanelWidget` for static summary cards
- `ToolbarWidget` for compact action and toggle controls
- reusable panel definitions imported from `@deck.gl-community/panels`
