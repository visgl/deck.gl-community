import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# SplitterPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="splitter-panel" size="tall" />

This live example uses `PanelManager` and panel containers directly, without deck.gl.

`SplitterPanel` places the first child panel in one resizable pane and all remaining child panels in the other pane.

## Usage

Use `SplitterPanel` when one primary panel should be compared with, or resized against, supporting panels.

```ts
import {SplitterPanel, type SplitterPanelProps} from '@deck.gl-community/panels';
```

## Props

```ts
type SplitterPanelProps = {
  panels: Record<string, Panel>;
  id?: string;
  title?: string;
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
  orientation?: 'horizontal' | 'vertical';
  initialSplit?: number;
  editable?: boolean;
  minSplit?: number;
  maxSplit?: number;
  onChange?: (split: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};
```

## Remarks

- `horizontal` renders side-by-side panes and resizes the first pane by width.
- `vertical` renders stacked panes and resizes the first pane by height.
- `initialSplit`, `minSplit`, and `maxSplit` are ratios from `0` to `1`.
- If only one child panel is supplied, it fills the content area without a splitter handle.
