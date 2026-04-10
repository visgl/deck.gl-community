# SettingsWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`SettingsWidget` is a deck.gl HTML widget that renders a dat.gui-style settings button and panel.

## Import

```ts
import {
  SettingsWidget,
  type SettingsWidgetProps,
  type SettingsWidgetSchema,
  type SettingsWidgetSectionDescriptor,
  type SettingsWidgetSettingDescriptor,
  type SettingsWidgetState,
} from '@deck.gl-community/widgets';
```

## Props

```ts
type SettingsWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  label?: string;
  schema?: SettingsWidgetSchema;
  settings?: SettingsWidgetState;
  onSettingsChange?: (
    settings: SettingsWidgetState,
    changedSettings?: Array<{
      name: string;
      previousValue: unknown;
      nextValue: unknown;
      descriptor?: SettingsWidgetSettingDescriptor;
    }>,
  ) => void;
};
```

## Schema model

A settings schema contains sections, and each section contains setting descriptors.

Supported setting types:

- `boolean`
- `number`
- `string`
- `select`

Notable behavior:

- section collapse state is tracked while the widget stays mounted
- dot-path names such as `render.opacity` map into nested settings state
- string controls keep a small recent-values history and require explicit apply/Enter commit
- numeric controls clamp and validate against descriptor limits
- `onSettingsChange` can receive change descriptors, not just the next full settings object

## Usage

```ts
const widget = new SettingsWidget({
  id: 'vis-settings',
  placement: 'top-left',
  label: 'Visualization settings',
  schema,
  settings,
  onSettingsChange: (nextSettings, changed) => {
    setSettings(nextSettings);
    console.log(changed);
  },
});
```

## Related helper

See `SettingsManager` for the UI-agnostic change-tracking helper that complements this widget.
