import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# PanelWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
</p>

<WidgetPanelsLiveExample highlight="widget-panels" size="tall" />

`PanelWidget` adapts one `PanelComponent` from `@deck.gl-community/panels` to
deck.gl's `widgets` prop.

## Usage

```ts
import {BoxPanelContainer, MarkdownPanel} from '@deck.gl-community/panels';
import {PanelWidget} from '@deck.gl-community/widgets';

const widget = new PanelWidget({
  component: new BoxPanelContainer({
    id: 'summary',
    placement: 'top-right',
    panel: new MarkdownPanel({
      id: 'summary-content',
      title: 'Summary',
      markdown: 'Mounted through deck.gl.'
    })
  })
});
```

Pass `widget` through `Deck`'s `widgets` prop.

## Props

```ts
type PanelWidgetProps<ComponentT extends PanelComponent = PanelComponent> = WidgetProps & {
  component: ComponentT;
  viewId?: string | null;
};
```

## Named Adapters

The widgets package keeps thin convenience adapters that only construct the
matching panels component:

- `BoxPanelWidget` -> `BoxPanelContainer`
- `ModalPanelWidget` -> `ModalPanelContainer`
- `SidebarPanelWidget` -> `SidebarPanelContainer`
- `FullScreenPanelWidget` -> `FullScreenPanelContainer`
- `ToolbarWidget` -> `ToolbarComponent`
- `ToastWidget` -> `ToastComponent`

Use `triggerIcon` for modal and sidebar trigger icons. The removed `icon`
alias is not supported.

## Remarks

- Panel rendering and behavior stay in `@deck.gl-community/panels`.
- `PanelWidget` forwards deck lifecycle, redraw, viewport, hover, and pointer
  hooks to its component.
- Reusing the same component id and type updates the mounted component; changing
  component identity or type swaps the delegate.
