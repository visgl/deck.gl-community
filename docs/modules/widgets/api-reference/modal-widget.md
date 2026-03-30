# ModalWidget

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`ModalWidget` renders a deck.gl widget trigger that opens a centered overlay panel.

It is exported from `@deck.gl-community/widgets`.

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

## Behavior

- Accepts either a full `container` description or a single `panel`.
- Can render with the built-in icon trigger or be controlled externally.
- Supports controlled and uncontrolled open state.
- Closes on backdrop click and `Escape`.
- Raises its placement container while open so the dialog stays above neighboring widgets.

## Usage

Use `ModalWidget` for secondary controls or reference material that should be available on demand without permanently occupying canvas space.
