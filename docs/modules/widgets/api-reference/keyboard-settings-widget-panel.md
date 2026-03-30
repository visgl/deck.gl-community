# KeyboardSettingsWidgetPanel

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`KeyboardSettingsWidgetPanel` renders a read-only keyboard-shortcuts panel that can be embedded inside a modal, sidebar, or info box.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {
  KeyboardSettingsWidgetPanel,
  type KeyboardSettingsWidgetPanelProps,
} from '@deck.gl-community/widgets';
```

## Props

```ts
type KeyboardSettingsWidgetPanelProps = {
  keyboardShortcuts?: KeyboardShortcut[];
  theme?: WidgetPanelTheme;
};
```

## Behavior

- Uses the built-in keyboard shortcut list renderer from the keyboard widget.
- Defaults to an id of `keyboard-shortcuts` and a title of `Keyboard Shortcuts`.
- Works as a plain `WidgetPanel`, so it can be combined with tabbed, column, or accordion layouts.

## Usage

Use `KeyboardSettingsWidgetPanel` when the shortcuts reference should live inside an existing panel widget rather than a standalone popup widget.
