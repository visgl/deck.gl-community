# AccordeonWidgetPanel

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`AccordeonWidgetPanel` wraps multiple child panels into one collapsible accordion panel.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {AccordeonWidgetPanel, type AccordeonWidgetPanelProps} from '@deck.gl-community/widgets';
```

## Props

```ts
type AccordeonWidgetPanelProps = {
  panels: Record<string, WidgetPanel>;
  id?: string;
  title?: string;
  theme?: WidgetPanelTheme;
};
```

## Behavior

- Normalizes an object map of child panels into insertion-order accordion sections.
- Exposes one outer `WidgetPanel` that can be passed into `BoxWidget`, `ModalWidget`, or `SidebarWidget`.
- Uses `AccordeonWidgetContainer` internally to render the child sections.

## Usage

Use `AccordeonWidgetPanel` when a single widget panel should expand into several collapsible subsections.

## See Also

- [AccordeonWidgetContainer](./accordeon-widget-container.md)
- [Widget Panels](./widget-panels.md)
