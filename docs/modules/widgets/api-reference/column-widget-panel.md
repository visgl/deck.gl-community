# ColumnWidgetPanel

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`ColumnWidgetPanel` wraps multiple child panels into one vertically stacked panel.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {ColumnWidgetPanel, type ColumnWidgetPanelProps} from '@deck.gl-community/widgets';
```

## Props

```ts
type ColumnWidgetPanelProps = {
  panels: Record<string, WidgetPanel>;
  id?: string;
  title?: string;
  theme?: WidgetPanelTheme;
};
```

## Behavior

- Preserves all child panels in order and keeps them visible at the same time.
- Exposes one outer `WidgetPanel` for container widgets.
- Uses `ColumnWidgetContainer` internally for the stacked layout.

## Usage

Use `ColumnWidgetPanel` when several small panels should read like one grouped card or sidebar section.

## See Also

- [ColumnWidgetContainer](./column-widget-container.md)
- [Widget Panels](./widget-panels.md)
