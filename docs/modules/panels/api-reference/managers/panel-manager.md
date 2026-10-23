import Demo from '@site/src/examples/widgets/standalone-widgets';

# Panel Manager

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<Demo />

`PanelManager` mounts `PanelComponent` instances into a plain HTML element
without creating a `Deck` instance.

## Usage

A `PanelManager` mounts panel-module UI such as direct `Panel` instances, real
`PanelContainer` instances, `ToolbarComponent`, and `ToastComponent`.

For overlays owned by deck.gl's widget lifecycle, use the adapters in
[`@deck.gl-community/widgets`](/docs/modules/widgets). For permanent chrome and pinnable
panels around a deck.gl canvas, use `PanelManager` with `contentElement` and mount deck.gl
inside that content host.

```ts
import {PanelManager} from '@deck.gl-community/panels';

const panelManager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

panelManager.setProps({
  components: []
});
```

## Styling

`PanelManager` ensures that the base panel CSS is available in the document.

- If deck widget CSS has not been loaded, `PanelManager` injects a deck-theme-compatible stylesheet automatically.
- If deck widget CSS is already present, `PanelManager` does not inject another copy.

This lets standalone panel apps render with the expected light/dark theme styles
without importing deck.gl styles manually. When the same panels are used through
[`@deck.gl-community/widgets`](/docs/modules/widgets), they inherit the
existing deck.gl widget styling and theming instead.

## Types

```ts
type PanelManagerProps = {
  parentElement: HTMLElement;
  contentElement?: HTMLElement;
  deck?: unknown | null;
  className?: string;
};
```

## Constructor

```ts
new PanelManager({
  parentElement,
  deck,
  className
});
```

## Methods

```ts
getComponents(): PanelComponent[];
setProps(props: {
  components?: (PanelComponent | null | undefined)[];
}): void;
addDefault(component: PanelComponent): void;
finalize(): void;
onRedraw(params: {
  viewports: Array<{id: string; x: number; y: number; width: number; height: number}>;
  layers: unknown[];
}): void;
onHover(info: {viewport?: {id?: string}}, event: MjolnirPointerEvent): void;
onEvent(
  eventHandlerProp: 'onClick' | 'onDrag' | 'onDragStart' | 'onDragEnd',
  info: {viewport?: {id?: string}},
  event: MjolnirGestureEvent
): void;
```

## Remarks

- Adds `deck-widget-container` to the supplied host root so existing panel theme inference continues to work.
- Reconciles components by `id` and type, preserving mounted instances and
  routing same-type updates through each component's `setProps`.
- Supports the normal placement buckets: `top-left`, `top-right`, `bottom-left`, `bottom-right`, and `fill`.
- Honors `_container` when a component points at an explicit `HTMLElement`.
- Can optionally forward redraw, viewport, hover, and gesture hooks when paired with a real deck instance or another runtime that can supply equivalent event data.
- Does not make deck-coupled widget adapters useful on its own; controls that fundamentally depend on view-state mutation, redraws, or picking still need those inputs.

## Canvas chrome

Pass optional `contentElement`, an application-created direct child of `parentElement`, to enable
[permanent chrome and pinnable panels](../panel-containers/canvas-chrome.md). The manager arranges
this canvas host alongside docked panels inside the outer boundary, preserving the application's
positioning of `parentElement`. Omit it to retain overlay-only behavior; docked chrome stays hidden.
