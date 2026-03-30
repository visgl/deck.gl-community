# WidgetContainerRenderer

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`WidgetContainerRenderer` renders a serialized `WidgetContainer` description into Preact UI.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {
  WidgetContainerRenderer,
  type WidgetContainer,
} from '@deck.gl-community/widgets';
```

## Props

```ts
type WidgetContainerRendererProps = {
  container: WidgetContainer;
};
```

## Behavior

- Dispatches between accordion, tabbed, and single-panel container variants.
- Applies the shared panel theme scope for the rendered subtree.
- Serves as the common renderer used by `BoxWidget`, `ModalWidget`, and `SidebarWidget`.

## Usage

Use `WidgetContainerRenderer` when a caller has already assembled a `WidgetContainer` descriptor and wants to render it manually inside custom widget chrome.
