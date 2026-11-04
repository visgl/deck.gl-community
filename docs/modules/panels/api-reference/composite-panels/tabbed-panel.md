import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# TabbedPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`TabbedPanel` wraps multiple child panels into one tabbed parent panel.

<PanelLiveExample highlight="tabbed-panel" />

## Usage

Use `TabbedPanel` when several panels share the same footprint and only one should be visible at a time.

```ts
import {TabbedPanel, type TabbedPanelProps} from '@deck.gl-community/panels';
```

The example assumes two content panels, `summaryPanel` and `detailsPanel`, with those IDs.

```ts
new TabbedPanel({
  id: 'inspector', title: 'Inspector', panels: [summaryPanel, detailsPanel],
  defaultActivePanelId: 'summary', tabListLayout: 'scroll'
});
```

## Props

```ts
type TabbedPanelProps = PanelProps & {
  panels: ReadonlyArray<Panel>;
  id?: string;
  title?: string;
  tabListLayout?: 'wrap' | 'scroll';
  theme?: PanelTheme;
  defaultActivePanelId?: PanelId;
  activePanelId?: PanelId;
  onActivePanelIdChange?: (id: PanelId | undefined) => void;
};
```

## See Also

- [Using Panels](../../developer-guide/using-panels.md)

## Remarks

- Produces one composite panel whose body is a tabbed switcher of child panels.
- Supports wrapped or horizontally scrolling tab lists.

Child arrays define display order. Give each child a distinct, stable ID.
See [state and updates](../../developer-guide/using-panels.md#state-and-updates)
for controlled values, local defaults, and refreshing definitions. `PanelTheme` is described
in [Panel Themes](../panel-theme.md).

All tab bodies remain mounted; inactive bodies are hidden. This preserves their local state,
but their mount effects still run (including editor loading). Use an unmounted collapsible
section when expensive content must wait until first opened.
