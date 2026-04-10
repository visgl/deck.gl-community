import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# TabbedPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="tabbed-panel" />

`TabbedPanel` wraps multiple child panels into one tabbed parent panel.

## Import

```ts
import {TabbedPanel, type TabbedPanelProps} from '@deck.gl-community/widgets';
```

## Props

```ts
type TabbedPanelProps = {
  panels: Record<string, WidgetPanel>;
  id?: string;
  title?: string;
  tabListLayout?: 'wrap' | 'scroll';
  theme?: WidgetPanelTheme;
};
```


## Usage

Use `TabbedPanel` when several panels share the same footprint and only one should be visible at a time.

## See Also

- [Widget Panels](../developer-guide/widget-panels.md)

## Remarks

- Exposes one outer `WidgetPanel` whose body is a tabbed switcher of child panels.
- Supports wrapped or horizontally scrolling tab lists.
