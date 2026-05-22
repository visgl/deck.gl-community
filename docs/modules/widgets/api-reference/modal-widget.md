import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# ModalPanelWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="modal-widget" />

`ModalPanelWidget` renders a deck.gl widget trigger that opens a centered overlay panel.

## Usage

```ts
import {MarkdownPanel, TabbedPanel} from '@deck.gl-community/panels';
import {ModalPanelWidget} from '@deck.gl-community/widgets';

const helpPanel = new TabbedPanel({
  id: 'help',
  title: 'Help',
  panels: [
    new MarkdownPanel({
      id: 'overview',
      title: 'Overview',
      markdown: 'Secondary content that opens on demand.'
    })
  ]
});

const widget = new ModalPanelWidget({
  id: 'help-widget',
  panel: helpPanel,
  triggerLabel: 'Help'
});
```

Use `ModalPanelWidget` for secondary controls or reference material that should be available on demand without permanently occupying canvas space.

Import panel definitions from `@deck.gl-community/panels` and pass them to `ModalPanelWidget`
through `panel`.

## Props

```ts
type ModalPanelWidgetProps = WidgetProps & {
  icon?: string;
  panel?: WidgetPanel;
  placement?: WidgetPlacement;
  title?: string;
  triggerLabel?: string;
  triggerIcon?: string;
  presentation?: 'modal' | 'floating';
  draggable?: boolean;
  dragHandleSelector?: string;
  dialogStyle?: JSX.CSSProperties;
  dialogPlacement?: 'center' | 'left';
  contentStyle?: JSX.CSSProperties;
  hideTrigger?: boolean;
  hideCloseButton?: boolean;
  button?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};
```

## Remarks

- Accepts one reusable `panel` definition.
- Can render with the built-in icon trigger or be controlled externally.
- Supports controlled and uncontrolled open state.
- Closes on backdrop click and `Escape`.
- Supports non-blocking floating dialogs, left-biased placement, custom dialog
  sizing, and content-rendered close controls.
- Raises its placement container while open so the dialog stays above neighboring widgets.
