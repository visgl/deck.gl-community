# Overview

:::danger
The deck.gl-community repo is specifically set up to collect useful code that no longer has dedicated maintainers. This means that there is often no one who can respond quickly to issues. The vis.gl / Open Visualization team members who try to keep this running can only put a few hours into it every now and then. It is important to understand this limitation. If your project depends on timely fixes, and you are not able to contribute them yourself, deck.gl-community modules may not be the right choice for you.
:::

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/widgets.svg)](https://www.npmjs.com/package/@deck.gl-community/widgets)
[![NPM Downloads](https://img.shields.io/npm/dw/@deck.gl-community/widgets.svg)](https://www.npmjs.com/package/@deck.gl-community/widgets)
![deck.gl v9](https://img.shields.io/badge/deck.gl-v9-green.svg?style=flat-square")
![WebGPU not supported](https://img.shields.io/badge/webgpu-no-red.svg?style=flat-square")

This module packages UI widgets that integrate with [deck.gl](https://deck.gl) view state management. It includes classic navigation widgets such as `PanWidget` and `ZoomRangeWidget`, HTML overlays, and a newer set of generic panel widgets for composing sidebars, modals, info cards, and reusable panel content.

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

For the generic panel APIs, see the [Widget Panels example](../../examples/widgets/widget-panels), which combines:

- `SidebarWidget` for persistent controls
- `ModalWidget` for tabbed secondary panels
- `BoxWidget` for static summary cards
- `ToolbarWidget` for compact action and toggle controls
- `AccordeonPanel`, `TabbedPanel`, `ColumnPanel`, `MarkdownPanel`, `CustomPanel`, and `TextEditorPanel` for reusable panel composition
