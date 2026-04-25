import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# KeyboardShortcutsPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="keyboard-shortcuts-panel" />

`KeyboardShortcutsPanel` renders a read-only keyboard-shortcuts panel that can be embedded inside a modal, sidebar, or info box.

## Usage

```ts
import {
  KeyboardShortcutsPanel,
  type KeyboardShortcutsPanelProps
} from '@deck.gl-community/panels';
```

## Props

```ts
type KeyboardShortcutsPanelProps = {
  keyboardShortcuts?: KeyboardShortcut[];
  theme?: WidgetPanelTheme;
};
```


## Usage

Use `KeyboardShortcutsPanel` when the shortcuts reference should live inside an existing panel widget rather than a standalone popup widget.

## Remarks

- Uses the built-in keyboard shortcut list renderer from the keyboard widget.
- Defaults to an id of `keyboard-shortcuts` and a title of `Keyboard Shortcuts`.
- Works as a plain `WidgetPanel`, so it can be combined with tabbed, column, or accordion layouts.
