import Demo from '@site/src/examples/widgets/standalone-widgets';

# Panel Manager

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<Demo />

`PanelManager` mounts compatible panel-managed UI instances into a plain HTML element without creating a `Deck` instance.

## Usage

A `PanelManager` lets your application add Panel Container components to your web
application. It mounts compatible panel module UI components into your HTML DOM.

Note: If your application is using deck.gl it is recommended to use the panel
widgets in [`@deck.gl-community/widgets`](/docs/modules/widgets) directly
instead of instantiating a `PanelManager`.

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
getComponents(): PanelContainer[];
setProps(props: {
  components?: (PanelContainer | null | undefined)[];
}): void;
addDefault(component: PanelContainer): void;
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

- Adds `deck-panel-container` to the supplied host root so existing panel theme inference continues to work.
- Reconciles components by `id`, preserving mounted instances and routing updates through each component's `setProps`.
- Supports the normal placement buckets: `top-left`, `top-right`, `bottom-left`, `bottom-right`, and `fill`.
- Honors `_container` when a component points at an explicit `HTMLElement`.
- Can optionally forward redraw, viewport, hover, and gesture hooks when paired with a real deck instance or another runtime that can supply equivalent event data.
- Does not make deck-coupled widget wrappers useful on its own; controls that fundamentally depend on view-state mutation, redraws, or picking still need those inputs.
