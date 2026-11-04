import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# SplitterPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

This live example uses `PanelManager` and panel containers directly, without deck.gl.

`SplitterPanel` places the first child panel in one resizable pane and all remaining child panels in the other pane.

<PanelLiveExample highlight="splitter-panel" size="tall" />

## Usage

Use `SplitterPanel` when one primary panel should be compared with, or resized against, supporting panels.

```ts
import {SplitterPanel, type SplitterPanelProps} from '@deck.gl-community/panels';
```

The example assumes two content panels, `summaryPanel` and `detailsPanel`, with those IDs.

```ts
new SplitterPanel({
  id: 'compare', title: 'Compare', panels: [summaryPanel, detailsPanel],
  orientation: 'horizontal', defaultSplit: 0.4
});
```

## Props

```ts
type SplitterPanelProps = PanelProps & {
  panels: ReadonlyArray<Panel>;
  id?: string;
  title?: string;
  theme?: PanelTheme;
  orientation?: 'horizontal' | 'vertical';
  split?: number;
  defaultSplit?: number;
  editable?: boolean;
  minSplit?: number;
  maxSplit?: number;
  onSplitChange?: (split: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};
```

## Remarks

- `horizontal` renders side-by-side panes and resizes the first pane by width.
- `vertical` renders stacked panes and resizes the first pane by height.
- `defaultSplit`, `minSplit`, and `maxSplit` are ratios from `0` to `1`.
- If only one child panel is supplied, it fills the content area without a splitter handle.

Child arrays define display order. Give each child a distinct, stable ID.
See [state and updates](../../developer-guide/using-panels.md#state-and-updates)
for controlled values, local defaults, and refreshing definitions. `PanelTheme` is described
in [Panel Themes](../panel-theme.md).

## Controlled ratio and callback order

Ratios are clamped to the current `minSplit` / `maxSplit` bounds. `split` takes precedence
when both `split` and `defaultSplit` are supplied. `defaultSplit` initializes local state once;
changing it after mounting does not reset a user-resized divider.

```ts
const compare = new SplitterPanel({
  id: 'compare', panels: [summaryPanel, detailsPanel], split: 0.4,
  onSplitChange: split => compare.setProps({split})
});
```

In an application with centralized state, write the requested ratio there and supply the next
`split` through normal reconciliation instead. During controlled dragging the displayed divider
stays at the supplied ratio until that update arrives; there is no independent optimistic ratio.

For an editable divider, pointer down calls `onDragStart` once. Each pointer move with usable
geometry calls `onSplitChange` once with the clamped requested ratio; uncontrolled mode also
updates its local ratio. Pointer up or cancel calls `onDragEnd` once and removes drag listeners.
Pointer up does not emit another split request. Updates during an active drag use the current
callbacks, orientation, bounds, and controlled state. `editable: false` suppresses movement.
Unmounting removes listeners without calling application callbacks.

Programmatic `setProps` updates, including changed bounds, do not emit `onSplitChange`.
Displayed controlled ratios are clamped to current bounds; the application remains responsible
for its stored value. There is one split callback, `onSplitChange`; no callback aliases or
callback precedence rules between multiple names are needed.
