import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# ModalWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="modal-widget" />

`ModalWidget` renders a deck.gl widget trigger that opens a centered overlay panel.

## Usage

```ts
import {MarkdownPanel, TabbedPanel} from '@deck.gl-community/panels';
import {ModalWidget} from '@deck.gl-community/widgets';

const helpPanel = new TabbedPanel({
  id: 'help',
  title: 'Help',
  panels: {
    overview: new MarkdownPanel({
      id: 'overview',
      title: 'Overview',
      markdown: 'Secondary content that opens on demand.'
    })
  }
});

const widget = new ModalWidget({
  id: 'help-widget',
  panel: helpPanel,
  triggerLabel: 'Help'
});
```

Use `ModalWidget` for secondary controls or reference material that should be available on demand without permanently occupying canvas space.

Import panel definitions from `@deck.gl-community/panels` and pass them to `ModalWidget`
through `panel` or `container`.

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

## Remarks

- Accepts either a full panel `container` description or a single `panel`.
- Can render with the built-in icon trigger or be controlled externally.
- Supports controlled and uncontrolled open state.
- Closes on backdrop click and `Escape`.
- Raises its placement container while open so the dialog stays above neighboring widgets.
