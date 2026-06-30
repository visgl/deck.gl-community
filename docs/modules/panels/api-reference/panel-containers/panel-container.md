import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# Panel Container

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="box-panel-container" />

`PanelContainer` is the base class for `PanelComponent` instances that host one
`Panel`.

Extend it when the built-in panel containers do not match the behavior or
layout your application needs. Extend `PanelComponent` directly for mountable UI
that does not host a panel.

## Usage

```ts
import {PanelContainer, type PanelContainerProps} from '@deck.gl-community/panels';

class CustomPanelContainer extends PanelContainer<PanelContainerProps> {
  placement = 'top-right' as const;
  className = 'custom-panel-container';

  onRenderHTML(rootElement: HTMLElement): void {
    rootElement.textContent = 'Custom container content';
  }
}

const container = new CustomPanelContainer({id: 'custom-container'});
```

## Remarks

- `BoxPanelContainer`, `ModalPanelContainer`, `SidebarPanelContainer`, and
  `FullScreenPanelContainer` all extend `PanelContainer`.
- `PanelManager` mounts any `PanelComponent`, including `PanelContainer`
  instances, into plain HTML.
- Deck.gl uses the same components through `PanelWidget` and its thin named
  adapters in `@deck.gl-community/widgets`.

## Related pages

- [BoxPanelContainer](./box-panel-container.md)
- [ModalPanelContainer](./modal-panel-container.md)
- [SidebarPanelContainer](./sidebar-panel-container.md)
- [FullScreenPanelContainer](./full-screen-panel-container.md)
- [PanelComponent](../panel-components/panel-component.md)
- [Panel](../panel.md)
- [AccordeonPanel](../composite-panels/accordeon-panel.md)
- [ColumnPanel](../composite-panels/column-panel.md)
- [TabbedPanel](../composite-panels/tabbed-panel.md)
