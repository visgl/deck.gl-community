import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# BoxPanelWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="box-widget" />

`BoxPanelWidget` renders a static card-style [`Panel`](/docs/modules/panels/api-reference/custom-panel) in a deck.gl widget corner.

## Usage

```ts
import {MarkdownPanel} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';

const summaryPanel = new MarkdownPanel({
  id: 'summary',
  title: 'Summary',
  markdown: 'Always-visible context for the current view.'
});

const widget = new BoxPanelWidget({
  id: 'summary-widget',
  panel: summaryPanel,
  placement: 'top-right'
});
```

Use `BoxPanelWidget` for always-visible summaries, quick actions, or contextual help that should stay anchored to the canvas without modal or sidebar chrome.

Import panel definitions from `@deck.gl-community/panels` and pass them to `BoxPanelWidget`
through `panel` or `container`.

## Props

```ts
type BoxPanelWidgetProps = WidgetProps & {
  container?: WidgetContainer;
  panel?: WidgetPanel;
  placement?: WidgetPlacement;
  title?: string;
  widthPx?: number;
  collapsible?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};
```

## Remarks

- Accepts either a full panel container description or a single panel.
- Renders a themed box with optional title and collapsible body.
- Supports controlled and uncontrolled open state.
- Clamps width to a practical minimum so narrow configurations stay usable.
