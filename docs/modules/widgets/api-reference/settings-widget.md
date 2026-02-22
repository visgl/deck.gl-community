# SettingsWidget

`SettingsWidget` is a deck.gl widget that renders a button that opens a settings panel. The panel is driven by a simple JSON schema and accepts a settings object, and emits updates whenever the user changes a setting.

The `SettingsWidget` makes it very easy to add a settings menu to your application.

## Import

```ts
import {
  SettingsWidget,
  type SettingsWidgetSchema,
  type SettingsWidgetState,
} from '@deck.gl-community/widgets';
```

## Props

```ts
type SettingsWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  label?: string;
  schema?: SettingsWidgetSchema;
  settings?: Record<string, unknown>;
  onSettingsChange?: (settings: Record<string, unknown>) => void;
};
```

## Schema shape

A schema contains sections, and each section contains controls.

```ts
const schema: SettingsWidgetSchema = {
  title: 'Visualization settings',
  sections: [
    {
      id: 'rendering',
      name: 'Rendering',
      description: 'Visual toggles and appearance.',
      settings: [
        {
          name: 'showDependencies',
          label: 'Show dependencies',
          type: 'boolean',
          description: 'Render dependency links.',
        },
        {
          name: 'dependencyOpacity',
          label: 'Dependency opacity',
          type: 'number',
          min: 0,
          max: 1,
          step: 0.01,
        },
        {
          name: 'lineRoutingMode',
          type: 'select',
          options: ['straight', 'route'],
        },
      ],
    },
  ],
};
```

## Control types

Supported control types:

- `boolean` → checkbox
- `number` → numeric input, and range slider when `min`/`max` are supplied
- `string` → text input
- `select` → dropdown from `options`

Each setting renders on a single row with the setting name on the left and the control on the right. Hovering anywhere on the setting row shows the setting description tooltip.

Setting names support dot-path notation (for example `rendering.opacity`) when you want to update nested keys.

## Usage with Deck

```ts
const widget = new SettingsWidget({
  id: 'vis-settings',
  placement: 'top-left',
  label: 'Visualization settings',
  schema,
  settings: {
    showDependencies: true,
    dependencyOpacity: 0.2,
    lineRoutingMode: 'straight',
  },
  onSettingsChange: (nextSettings) => {
    // Persist state in your store.
    setSettings(nextSettings);
  },
});

new Deck({
  // ...
  widgets: [widget],
});
```

## Notes

- Sections are collapsible, start collapsed by default, and preserve collapse state while the widget remains mounted.
- Click outside the panel to close it.
- The widget can be updated over time via `widget.setProps(...)`.
