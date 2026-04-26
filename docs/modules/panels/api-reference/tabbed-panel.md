import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# TabbedPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="tabbed-panel" />

`TabbedPanel` wraps multiple child panels into one tabbed parent panel.

## Usage

Use `TabbedPanel` when several panels share the same footprint and only one should be visible at a time.

```ts
import {TabbedPanel, type TabbedPanelProps} from '@deck.gl-community/panels';
```

## Props

```ts
type TabbedPanelProps = {
  panels: Record<string, Panel>;
  id?: string;
  title?: string;
  tabListLayout?: 'wrap' | 'scroll';
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
};
```

## See Also

- [Using Panels](../developer-guide/using-panels.md)

## Remarks

- Produces one composite panel whose body is a tabbed switcher of child panels.
- Supports wrapped or horizontally scrolling tab lists.
