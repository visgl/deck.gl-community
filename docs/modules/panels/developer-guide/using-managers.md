# Using Managers

Keep application behavior in managers and pass the same descriptors into
panels when you want the UI to explain or edit that behavior. This keeps
keyboard help, settings controls, and deep-link documentation synchronized with
the definitions the app actually uses.

This is the automatic documentation path for descriptor-backed panels: define
the app behavior once, then render the panel from that same definition instead
of maintaining a second help table by hand.

## Manager Pairings

| Manager | App responsibility | Panel or component using the same source |
| --- | --- | --- |
| `KeyboardShortcutsManager` or `KeyboardShortcutsManagerDocument` | Dispatch `KeyboardShortcut[]` entries | `KeyboardShortcutsPanel` renders the same shortcuts as help |
| `SettingsManager` | Track settings snapshots, changes, and persistence | `SettingsPanel` renders the same `SettingsSchema` as controls |
| `URLManager` | Parse and serialize `URLParameter[]` deep links | `URLParametersPanel` renders the same URL descriptors as docs |
| `CommandManager` | Register and execute commands | Route shortcut callbacks into commands; `KeyboardShortcutsPanel` documents those shortcuts |
| `toastManager` | Queue and dismiss notifications | `ToastComponent` renders current toast state |
| `PanelManager` | Mount `PanelComponent[]` without deck.gl | Hosts panels and components; it is not a descriptor docs source |

## Keyboard Shortcuts Become Help

Define shortcuts once, install them through a manager, and pass the same array
to `KeyboardShortcutsPanel`.

```ts
import {
  KeyboardShortcutsManagerDocument,
  KeyboardShortcutsPanel,
  type KeyboardShortcut
} from '@deck.gl-community/panels';

const keyboardShortcuts: KeyboardShortcut[] = [
  {
    key: '/',
    commandKey: true,
    name: 'Show help',
    description: 'Open help.',
    preventDefault: true,
    onKeyPress: () => setHelpOpen(true)
  }
];

const shortcutManager = new KeyboardShortcutsManagerDocument(keyboardShortcuts);
shortcutManager.start();

const helpPanel = new KeyboardShortcutsPanel({keyboardShortcuts});

// Call shortcutManager.stop() when the app removes these shortcuts.
```

The manager uses `onKeyPress`; the panel uses the display metadata. Do not
maintain a second hand-written shortcut list for help UI.

## Settings Schema Becomes Controls

Register settings descriptors with `SettingsManager`, then give the same schema
and current values to `SettingsPanel`.

```ts
import {
  SettingsManager,
  SettingsPanel,
  getChangedSetting,
  getSettingDefinitions
} from '@deck.gl-community/panels';

const settingsManager = new SettingsManager();
settingsManager.setSettingDefinitions(getSettingDefinitions(settingsSchema));
settingsManager.setLocalStoragePersistence({storageKey: 'app-settings'});

let settings = settingsManager.getSettingsWithLocalStorage(defaultSettings);
settingsManager.setCurrentSettings(settings);

const unsubscribe = settingsManager.setOnSettingsChange((nextSettings, changedSettings) => {
  settings = nextSettings;
  const densityChange = getChangedSetting(changedSettings, 'layout.density');
  if (densityChange) {
    applyDensity(densityChange.nextValue);
  }
  renderPanels();
});

function createSettingsPanel() {
  return new SettingsPanel({
    schema: settingsSchema,
    settings,
    onSettingsChange: nextSettings => settingsManager.setSettings(nextSettings)
  });
}

// Call unsubscribe() when the app removes this settings surface.
```

`getSettingDefinitions(schema)` replaces the hand-written schema indexing map.
`getChangedSetting(changedSettings, name)` keeps app reactions focused on one
setting instead of repeatedly scanning the emitted change list.

## URL Descriptors Become Deep-Link Docs

URL parameter descriptors define both serialization behavior and the help panel
copy shown to users.

```ts
import {
  URLManager,
  URLParametersPanel,
  type URLParameter,
  type URLParameterValue
} from '@deck.gl-community/panels';

type AppState = {
  mode: string;
};

const urlParameters: URLParameter<AppState>[] = [
  {
    name: 'mode',
    description: 'Active view mode.',
    serialize: state => state.mode,
    deserialize: (value: URLParameterValue, state) => {
      if (typeof value === 'string') {
        state.mode = value;
      }
    }
  }
];

const appState: AppState = {mode: 'overview'};
const urlManager = new URLManager(urlParameters);
urlManager.parseIntoState(appState, window.location.search);

const urlParametersPanel = new URLParametersPanel({urlParameters});
```

The app should update the browser URL through `URLManager` when state changes;
the panel remains documentation for the same canonical and legacy parameter
descriptors.

## Commands And Toasts

`CommandManager` stores executable command metadata, but this package does not
currently ship a command leaf panel. When a command has a keyboard shortcut,
make the shortcut callback execute the command and let
`KeyboardShortcutsPanel` document the shortcut.

```ts
import {commandManager, type KeyboardShortcut} from '@deck.gl-community/panels';

const unregisterReset = commandManager.registerCommand({
  id: 'view.reset',
  label: 'Reset view',
  description: 'Reset the current viewport.',
  do: () => resetView()
});

const commandShortcuts: KeyboardShortcut[] = [
  {
    key: 'r',
    name: 'Reset view',
    description: 'Reset the current viewport.',
    onKeyPress: () => commandManager.executeCommand('view.reset')
  }
];

// Call unregisterReset() when the command leaves the app.
```

`toastManager` is similar app-owned state, but its renderer is
`ToastComponent`, not a leaf panel. Mount one toast component once, then let
application code call `toastManager.toast(...)` from anywhere.

## Related Pages

- [KeyboardShortcutsManager](../api-reference/managers/keyboard-shortcuts-manager.md)
- [KeyboardShortcutsPanel](../api-reference/keyboard-shortcuts-panel.md)
- [SettingsManager](../api-reference/managers/settings-manager.md)
- [SettingsPanel](../api-reference/settings-panel.md)
- [URLManager](../api-reference/managers/url-manager.md)
- [URLParametersPanel](../api-reference/url-parameters-panel.md)
- [CommandManager](../api-reference/managers/command-manager.md)
- [Toast Manager](../api-reference/managers/toast-manager.md)
- [Using Components](./using-components.md)
