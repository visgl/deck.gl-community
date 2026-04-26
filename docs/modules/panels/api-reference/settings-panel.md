import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# SettingsPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="settings-panel" />

`SettingsPanel` embeds the settings-schema UI inside the panel composition model.

## Usage

Use `SettingsPanel` when a settings form should live inside a panel layout or panel container.

```ts
import {
  SettingsPanel,
  type SettingsPanelProps,
  type SettingDescriptor,
  type SettingsSchema,
  type SettingsState
} from '@deck.gl-community/panels';
```

## Props

```ts
type SettingsPanelProps = {
  id?: string;
  label?: string;
  schema?: SettingsSchema;
  settings?: SettingsState;
  onSettingsChange?: (
    settings: SettingsState,
    changedSettings?: Array<{
      name: string;
      previousValue: unknown;
      nextValue: unknown;
      descriptor?: SettingDescriptor;
    }>
  ) => void;
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
};
```

## See Also

- [Using Panels](../developer-guide/using-panels.md)

## Remarks

- Reuses the shared schema-driven controls as a panel.
- Tracks section collapse state while the panel stays mounted.
- Supports nested dot-path setting names and change descriptors in `onSettingsChange`.
