import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# BoxWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="box-widget" />

`BoxWidget` renders a static card-style panel in a deck.gl widget corner.

## Import

```ts
import {BoxWidget} from '@deck.gl-community/widgets';
```

## Props

```ts
type BoxWidgetProps = WidgetProps & {
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


## Usage

Use `BoxWidget` for always-visible summaries, quick actions, or contextual help that should stay anchored to the canvas without modal or sidebar chrome.

## Remarks

- Accepts either a full container description or a single panel.
- Renders a themed box with optional title and collapsible body.
- Supports controlled and uncontrolled open state.
- Clamps width to a practical minimum so narrow configurations stay usable.
