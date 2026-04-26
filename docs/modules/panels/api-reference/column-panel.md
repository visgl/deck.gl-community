import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# ColumnPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="column-panel" />

This live example uses `PanelManager` and panel containers directly, without deck.gl.

`ColumnPanel` wraps multiple child panels into one vertically stacked panel.

## Usage

Use `ColumnPanel` when several small panels should read like one grouped card or sidebar section.

```ts
import {ColumnPanel, type ColumnPanelProps} from '@deck.gl-community/panels';
```

## Props

```ts
type ColumnPanelProps = {
  panels: Record<string, Panel>;
  id?: string;
  title?: string;
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
};
```

## See Also

- [Using Panels](../developer-guide/using-panels.md)

## Remarks

- Preserves all child panels in order and keeps them visible at the same time.
- Produces one composite panel for boxes, sidebars, modals, full-screen containers, or nested layouts.
