import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# ColumnPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

This live example uses `PanelManager` and panel containers directly, without deck.gl.

`ColumnPanel` wraps multiple child panels into one vertically stacked panel.

<PanelLiveExample highlight="column-panel" />

## Usage

Use `ColumnPanel` when several small panels should read like one grouped card or sidebar section.

```ts
import {ColumnPanel, type ColumnPanelProps} from '@deck.gl-community/panels';
```

The example assumes two content panels, `summaryPanel` and `detailsPanel`, with those IDs.

```ts
new ColumnPanel({id: 'details', title: 'Details', panels: [summaryPanel, detailsPanel]});
```

## Props

```ts
type ColumnPanelProps = PanelProps & {
  panels: ReadonlyArray<Panel>;
  id?: string;
  title?: string;
  theme?: PanelTheme;
};
```

## See Also

- [Using Panels](../../developer-guide/using-panels.md)

## Remarks

- Preserves all child panels in order and keeps them visible at the same time.
- Produces one composite panel for boxes, sidebars, modals, full-screen containers, or nested layouts.

Child arrays define display order. Give each child a distinct, stable ID.
See [state and updates](../../developer-guide/using-panels.md#state-and-updates)
for controlled values, local defaults, and refreshing definitions. `PanelTheme` is described
in [Panel Themes](../panel-theme.md).
