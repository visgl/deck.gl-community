import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# ModalWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="modal-widget" />

`ModalWidget` renders a deck.gl widget trigger that opens a centered overlay panel.

## Import

```ts
import {ModalWidget} from '@deck.gl-community/widgets';
```

## Props

```ts
type ModalWidgetProps = WidgetProps & {
  icon?: string;
  container?: WidgetContainer;
  panel?: WidgetPanel;
  placement?: WidgetPlacement;
  title?: string;
  triggerLabel?: string;
  triggerIcon?: string;
  hideTrigger?: boolean;
  button?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};
```


## Usage

Use `ModalWidget` for secondary controls or reference material that should be available on demand without permanently occupying canvas space.

## Remarks

- Accepts either a full `container` description or a single `panel`.
- Can render with the built-in icon trigger or be controlled externally.
- Supports controlled and uncontrolled open state.
- Closes on backdrop click and `Escape`.
- Raises its placement container while open so the dialog stays above neighboring widgets.
