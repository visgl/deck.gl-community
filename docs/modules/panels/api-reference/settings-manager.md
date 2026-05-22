# SettingsManager

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`SettingsManager` is a UI-agnostic helper for tracking settings snapshots,
emitting structured change descriptors, and persisting descriptor-backed values
to local storage.

## Import

```ts
import {
  SettingsManager,
  settingsManager,
  type SettingsChangeDescriptor,
  type SettingsManagerOnChange
} from '@deck.gl-community/panels';
```

## Usage

```ts
const manager = new SettingsManager();

manager.setSettingDefinitions(
  new Map(schema.sections.flatMap((section) => section.settings.map((setting) => [setting.name, setting])))
);

manager.setCurrentSettings(settings);
manager.setOnSettingsChange((nextSettings, changedSettings) => {
  console.log(nextSettings, changedSettings);
});

manager.setSettingValue('render.opacity', 0.5);
```

## Persistence

```ts
manager.setLocalStoragePersistence({
  storageKey: 'my-settings'
});
```

Settings persist to local storage by default. Set `persist: 'url'` or
`persist: 'none'` on a setting descriptor when a value should not be written by
the local-storage persistence path.

## Remarks

- `setSettingValue` resolves values through the registered descriptor before
  emitting changes.
- `setSettings` accepts a full settings snapshot and emits one descriptor per
  known value that changed.
- `getSettingsWithLocalStorage` overlays stored values onto a caller-provided
  settings snapshot.
