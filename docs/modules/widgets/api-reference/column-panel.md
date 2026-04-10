import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# ColumnPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="column-panel" />

`ColumnPanel` wraps multiple child panels into one vertically stacked panel.

## Import

```ts
import {ColumnPanel, type ColumnPanelProps} from '@deck.gl-community/widgets';
```

## Props

```ts
type ColumnPanelProps = {
  panels: Record<string, WidgetPanel>;
  id?: string;
  title?: string;
  theme?: WidgetPanelTheme;
};
```


## Usage

Use `ColumnPanel` when several small panels should read like one grouped card or sidebar section.

## See Also

- [Widget Panels](../developer-guide/widget-panels.md)

## Remarks

- Preserves all child panels in order and keeps them visible at the same time.
- Exposes one outer `WidgetPanel` for container widgets.
