import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# KeyboardShortcutsPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="keyboard-shortcuts-panel" />

`KeyboardShortcutsPanel` renders a read-only keyboard, mouse, and trackpad
interaction reference. It can be embedded inside a modal, sidebar, or info box.

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

- Renders keyboard chords, mouse interactions, and trackpad interactions from
  `displayInputs`.
- Groups shortcuts into navigation, interaction, command, and settings sections.
- Uses `displayPair` to render related primary and secondary shortcuts on the
  same row.
- De-duplicates badges for paired rows.
- Defaults to an id of `keyboard-shortcuts` and a title of `Keyboard & Mouse`.
- Works as a plain panel, so it can be combined with tabbed, column, or accordion layouts.
