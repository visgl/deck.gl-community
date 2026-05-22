# StudioSettingsWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`StudioSettingsWidget` helpers create and update a floating deck widget around
`StudioSettingsPanel`.

## Import

```ts
import {
  createStudioSettingsWidget,
  updateStudioSettingsWidget,
  type StudioSettingsWidgetProps
} from '@deck.gl-community/widgets';
```

## Usage

```ts
const widget = createStudioSettingsWidget({
  schema,
  settings,
  onSettingsChange,
  placement: 'top-left'
});

deck.setProps({widgets: [widget]});
```

`createStudioSettingsWidget` returns a `ModalPanelWidget` configured as a
non-blocking floating modal. It uses the Studio panel's header as the drag
handle and hides the modal chrome close button because the panel renders its
own close action.

## Updating

```ts
updateStudioSettingsWidget(widget, {
  schema,
  settings: nextSettings,
  onSettingsChange
});
```

Use `updateStudioSettingsWidget` when the schema or settings snapshot changes
and the deck widget instance should be preserved.
