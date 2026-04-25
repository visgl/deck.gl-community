import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# AccordeonPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="accordeon-panel" />

`AccordeonPanel` wraps multiple child panels into one collapsible accordion panel.

## Usage

```ts
import {AccordeonPanel, type AccordeonPanelProps} from '@deck.gl-community/panels';
```

## Props

```ts
type AccordeonPanelProps = {
  panels: Record<string, WidgetPanel>;
  id?: string;
  title?: string;
  theme?: WidgetPanelTheme;
};
```


## Usage

Use `AccordeonPanel` when a single widget panel should expand into several collapsible subsections.

## See Also

- [Widget Panels](../developer-guide/widget-panels.md)

## Remarks

- Normalizes an object map of child panels into insertion-order accordion sections.
- Exposes one outer `WidgetPanel` that can be passed into `BoxPanelWidget`, `ModalPanelWidget`, or `SidebarPanelWidget`.
