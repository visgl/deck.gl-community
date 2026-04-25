# KeyboardShortcutsManager

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`KeyboardShortcutsManager` installs keyboard shortcuts on an event source that
forwards DOM `keydown` events.

## Usage

Use `KeyboardShortcutsManager` when your application already has an event
manager that forwards keyboard events.

```ts
import {
  KeyboardShortcutsManager,
  type KeyboardShortcut
} from '@deck.gl-community/panels';

const shortcuts: KeyboardShortcut[] = [
  {
    key: '/',
    commandKey: true,
    name: 'Show shortcuts',
    description: 'Open keyboard shortcuts',
    onKeyPress: () => setOpen(true)
  }
];

const manager = new KeyboardShortcutsManager(eventManager, shortcuts);
manager.start();
```

Use `KeyboardShortcutsManagerDocument` when shortcuts should be installed
directly on `document`.

```ts
import {
  KeyboardShortcutsManagerDocument,
  type KeyboardShortcut
} from '@deck.gl-community/panels';

const shortcuts: KeyboardShortcut[] = [
  {
    key: 'Escape',
    name: 'Close',
    description: 'Close the active panel',
    onKeyPress: () => setOpen(false)
  }
];

const manager = new KeyboardShortcutsManagerDocument(shortcuts);
manager.start();
```

## Types

```ts
type KeyboardShortcutManagerEvent = {
  srcEvent: KeyboardEvent;
};

type KeyboardShortcutEventManager = {
  on(event: 'keydown', handler: (event: KeyboardShortcutManagerEvent) => void): void;
  off(event: 'keydown', handler: (event: KeyboardShortcutManagerEvent) => void): void;
};
```

## Methods

```ts
start(): void;
stop(): void;
```

## Remarks

- `KeyboardShortcutsManager` works with any event manager that implements the
  `on('keydown', ...)` and `off('keydown', ...)` contract.
- `KeyboardShortcutsManagerDocument` is the simplest option for stand-alone DOM
  usage.
- Both managers dispatch `onKeyPress` on the first matching `KeyboardShortcut`.
- Shortcut matching is shared with `KeyboardShortcutsPanel` and the exported
  keyboard shortcut helpers.

## Related pages

- [KeyboardShortcutsPanel](./keyboard-shortcuts-panel.md)
