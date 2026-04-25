import Demo from '@site/src/examples/widgets/standalone-widgets';

# WidgetHost

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<Demo />

`WidgetHost` mounts compatible widget instances into a plain HTML element without creating a `Deck` instance.

## Import

```ts
import {WidgetHost, type WidgetHostProps} from '@deck.gl-community/panels';
```

## Types

```ts
type WidgetHostProps = {
  parentElement: HTMLElement;
  deck?: unknown | null;
  className?: string;
};
```

## Constructor

```ts
new WidgetHost({
  parentElement,
  deck,
  className
});
```

## Methods

```ts
getWidgets(): Widget[];
setProps(props: {widgets?: (Widget | null | undefined)[]}): void;
addDefault(widget: Widget): void;
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

## Usage

Use `WidgetHost` when you want to mount standalone `ToolbarWidget`, `ToastWidget`,
or your own `Widget` subclasses into plain HTML without deck.gl's canvas lifecycle.

```ts
import {ToolbarWidget, WidgetHost} from '@deck.gl-community/panels';

const host = new WidgetHost({
  parentElement: document.getElementById('app') as HTMLElement
});

host.setProps({
  widgets: [
    new ToolbarWidget({
      id: 'toolbar',
      items: [{kind: 'action', id: 'refresh', label: 'Refresh'}]
    })
  ]
});
```

## Remarks

- Adds `deck-widget-container` to the supplied host root so existing widget theming and panel theme inference continue to work.
- Reconciles widgets by `id`, preserving mounted instances and routing updates through each widget's `setProps`.
- Supports the normal deck widget placement buckets: `top-left`, `top-right`, `bottom-left`, `bottom-right`, and `fill`.
- Honors `_container` when a widget points at an explicit `HTMLElement`.
- Can optionally forward redraw, viewport, hover, and gesture hooks when paired with a real deck instance or another runtime that can supply equivalent event data.
- Does not make deck-coupled widgets useful on its own; widgets that fundamentally depend on view-state mutation, redraws, or picking still need those inputs.
