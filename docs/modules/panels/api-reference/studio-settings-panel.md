# StudioSettingsPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`StudioSettingsPanel` renders a dense schema-driven settings surface with a
section rail, compact mode, grouped settings, and a visual dependency-shape
selector for a `lineRoutingMode` setting.

## Import

```ts
import {
  StudioSettingsPanel,
  createStudioSettingsPanel,
  type StudioSettingsPanelProps
} from '@deck.gl-community/panels';
```

## Props

```ts
type StudioSettingsPanelProps = {
  schema: SettingsSchema;
  applicationSchema?: SettingsSchema;
  fontFamily?: string;
  settings: SettingsState;
  onSettingsChange?: SettingsManagerOnChange;
  presetLabel?: string;
  settingRowLayout?: 'aligned' | 'fit-labels';
};
```

`schema` supplies visualization controls. `applicationSchema` is rendered as a
separate rail group for app-level controls. Setting descriptors may include
`group` to organize rows within a section and `sliderDebounceMs` for numeric
range controls. Select options may include `description` alongside `label` and
`value` to render supporting copy below each option label in the open menu.
`settingRowLayout` defaults to `'aligned'`; use `'fit-labels'` when each row
should size its label column to its content and give more width to the control.

## Panel Factory

```ts
const panel = createStudioSettingsPanel({
  schema,
  settings,
  onSettingsChange: manager.setSettings.bind(manager)
});
```

The factory returns a deck-independent `Panel` object that can be used with
`ModalPanelContainer`, `SidebarPanelContainer`, or any panel container.

When deck.gl should host the panel, pass that panel into `ModalPanelWidget` or
another named adapter from `@deck.gl-community/widgets`.

## Remarks

- The panel is deck.gl-independent and lives in `@deck.gl-community/panels`.
- The close button emits `data-modal-panel-container-close="true"` so `ModalPanelContainer` can
  close from content when built-in modal chrome is hidden.
- Compact mode is remembered in `localStorage` under the
  `deck.gl-community:studio-settings:navigation-collapsed` key.
