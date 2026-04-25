# Panel Container

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`PanelContainer` is the base class for creating custom panel containers in
`@deck.gl-community/panels`.

Extend it when the built-in panel containers do not match the behavior or
layout your application needs.

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

- `PanelBox`, `PanelModal`, `PanelSidebar`, and `PanelFullScreen` all extend
  `PanelContainer`.
- `PanelManager` mounts `PanelContainer` instances into plain HTML.
- Deck.gl wrapper widgets in `@deck.gl-community/widgets` build on the same
  panel-container model.

## Related pages

- [PanelBox](./panel-box.md)
- [PanelModal](./panel-modal.md)
- [PanelSidebar](./panel-sidebar.md)
- [PanelFullScreen](./panel-full-screen.md)
- [AccordeonPanel](./accordeon-panel.md)
- [ColumnPanel](./column-panel.md)
- [TabbedPanel](./tabbed-panel.md)
