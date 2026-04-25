import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# KeyboardShortcutsPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="keyboard-shortcuts-panel" />

`KeyboardShortcutsPanel` renders a read-only keyboard-shortcuts panel that can be embedded inside a modal, sidebar, or info box.

## Usage

Use `KeyboardShortcutsPanel` when the shortcuts reference should live inside an existing panel layout.

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
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
};
```

## Remarks

- Uses the built-in keyboard shortcut list renderer from the keyboard widget.
- Defaults to an id of `keyboard-shortcuts` and a title of `Keyboard Shortcuts`.
- Works as a plain panel, so it can be combined with tabbed, column, or accordion layouts.
