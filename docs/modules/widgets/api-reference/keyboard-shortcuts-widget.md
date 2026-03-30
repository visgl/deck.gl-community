# KeyboardShortcutsWidget

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`KeyboardShortcutsWidget` renders a help button and modal listing configured keyboard shortcuts. It can also install those shortcuts against deck's `eventManager`.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {
  KeyboardShortcutsWidget,
  type KeyboardShortcut,
} from '@deck.gl-community/widgets';
```

## Props

```ts
type KeyboardShortcutsWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  keyboardShortcuts: KeyboardShortcut[];
  installShortcuts?: boolean;
};
```

## `KeyboardShortcut`

```ts
type KeyboardShortcut = {
  key: string;
  commandKey?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  dragMouse?: boolean;
  displayPair?: {
    id: string;
    position: 'primary' | 'secondary';
    description: string;
  };
  name: string;
  description: string;
  onKeyPress?: () => void;
};
```

## Behavior

- Renders a `?` button in the deck widget chrome.
- Opens a modal listing shortcut descriptions and formatted keycaps.
- Always includes paired `Cmd/Ctrl+/` and `?` bindings that open the shortcuts modal.
- Renders adjacent shortcuts with matching `displayPair` metadata on one row with two key groups and one shared description.
- When `installShortcuts` is enabled, creates a `KeyboardShortcutsManager` bound to the deck `eventManager`.
- Restarts the manager when the shortcut list changes.
- Cleans up installed listeners on widget removal.

Default props:

- `id: 'keyboard-bindings'`
- `placement: 'top-left'`
- `keyboardShortcuts: []`

## Usage

```ts
const widget = new KeyboardShortcutsWidget({
  keyboardShortcuts: [
    {
      key: '/',
      commandKey: true,
      name: 'Show shortcuts',
      description: 'Open the shortcuts modal',
      onKeyPress: () => openShortcuts(),
    },
    {
      key: 'a',
      name: 'Pan left',
      description: 'Pan left',
      displayPair: {
        id: 'pan-horizontal',
        position: 'primary',
        description: 'Pan horizontally.',
      },
    },
    {
      key: 'd',
      name: 'Pan right',
      description: 'Pan right',
      displayPair: {
        id: 'pan-horizontal',
        position: 'secondary',
        description: 'Pan horizontally.',
      },
    },
  ],
  installShortcuts: true,
});
```

## Related helper

See `KeyboardShortcutsManager` for the lower-level event binding helper used by this widget.
