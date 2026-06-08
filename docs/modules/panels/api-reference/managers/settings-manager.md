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
  getChangedSetting,
  getSettingDefinitions,
  SettingsManager,
  settingsManager,
  type SettingsChangeDescriptor,
  type SettingsManagerOnChange
} from '@deck.gl-community/panels';
```

## Usage

```ts
const manager = new SettingsManager();

manager.setSettingDefinitions(getSettingDefinitions(schema));

manager.setCurrentSettings(settings);
manager.setOnSettingsChange((nextSettings, changedSettings) => {
  const opacityChange = getChangedSetting(changedSettings, 'render.opacity');
  console.log(nextSettings, opacityChange?.nextValue);
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
- `getSettingDefinitions` indexes schema descriptors for
  `setSettingDefinitions`.
- `getChangedSetting` returns the change descriptor for one setting name from
  an emitted change list.
- `setSettings` accepts a full settings snapshot and emits one descriptor per
  known value that changed.
- `getSettingsWithLocalStorage` overlays stored values onto a caller-provided
  settings snapshot.
