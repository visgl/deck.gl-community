import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# SettingsPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="settings-panel" />

`SettingsPanel` embeds the settings-schema UI inside the panel composition model.

## Import

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
  theme?: WidgetPanelTheme;
};
```


## Usage

Use `SettingsPanel` when a settings form should live inside `SidebarWidget`, `ModalWidget`, or `BoxWidget` instead of the standalone floating settings button.

## See Also

- [Widget Panels](../developer-guide/widget-panels.md)

## Remarks

- Reuses the shared schema-driven controls, but exposes them as a `WidgetPanel`.
- Tracks section collapse state while the panel stays mounted.
- Supports nested dot-path setting names and change descriptors in `onSettingsChange`.
