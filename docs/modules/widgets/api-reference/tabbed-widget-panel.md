# TabbedWidgetPanel

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`TabbedWidgetPanel` wraps multiple child panels into one tabbed parent panel.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {TabbedWidgetPanel, type TabbedWidgetPanelProps} from '@deck.gl-community/widgets';
```

## Props

```ts
type TabbedWidgetPanelProps = {
  panels: Record<string, WidgetPanel>;
  id?: string;
  title?: string;
  tabListLayout?: 'wrap' | 'scroll';
  theme?: WidgetPanelTheme;
};
```

## Behavior

- Exposes one outer `WidgetPanel` whose body is a tabbed switcher of child panels.
- Supports wrapped or horizontally scrolling tab lists.
- Uses `TabbedWidgetContainer` internally to render the active child panel.

## Usage

Use `TabbedWidgetPanel` when several panels share the same footprint and only one should be visible at a time.

## See Also

- [TabbedWidgetContainer](./tabbed-widget-container.md)
- [Widget Panels](./widget-panels.md)
