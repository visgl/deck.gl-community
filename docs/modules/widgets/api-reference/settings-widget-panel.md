# SettingsWidgetPanel

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`SettingsWidgetPanel` embeds the settings-schema UI inside the panel composition model.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {
  SettingsWidgetPanel,
  type SettingsWidgetPanelProps,
  type SettingsWidgetSchema,
  type SettingsWidgetState,
} from '@deck.gl-community/widgets';
```

## Props

```ts
type SettingsWidgetPanelProps = {
  id?: string;
  label?: string;
  schema?: SettingsWidgetSchema;
  settings?: SettingsWidgetState;
  onSettingsChange?: (
    settings: SettingsWidgetState,
    changedSettings?: Array<{
      name: string;
      previousValue: unknown;
      nextValue: unknown;
      descriptor?: SettingDescriptor;
    }>,
  ) => void;
  theme?: WidgetPanelTheme;
};
```

## Behavior

- Reuses the same schema-driven controls as `SettingsWidget`, but exposes them as a `WidgetPanel`.
- Tracks section collapse state while the panel stays mounted.
- Supports nested dot-path setting names and change descriptors in `onSettingsChange`.

## Usage

Use `SettingsWidgetPanel` when a settings form should live inside `SidebarWidget`, `ModalWidget`, or `BoxWidget` instead of the standalone floating settings button.

## See Also

- [SettingsWidget](./settings-widget.md)
- [Widget Panels](./widget-panels.md)
