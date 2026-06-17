# Using with deck.gl

Use `@deck.gl-community/panels` with `@deck.gl-community/widgets` when the UI
should be mounted through deck.gl's widget system.

In this setup:

- `@deck.gl-community/panels` provides `PanelComponent`, panel, and container definitions
- `@deck.gl-community/widgets` provides the deck-facing `PanelWidget` adapter layer
- deck.gl theming should come from `@deck.gl/widgets`, not `applyPanelTheme(...)`

## When to use this

Use the deck.gl path when:

- the UI should stay anchored to a deck.gl view
- widget placement should follow deck.gl corners or fill layout
- panel interactions should live inside the deck.gl panel lifecycle

## Core pieces

- leaf panels and composite panels describe UI structure
- `PanelWidget` mounts any `PanelComponent` through deck.gl
- `BoxPanelWidget`, `SidebarPanelWidget`, `ModalPanelWidget`, and
  `FullScreenPanelWidget` are thin named adapters for real panel containers
- `Deck` owns placement and lifecycle through its `widgets` prop

## Example

```ts
import {BoxPanelContainer, ColumnPanel, MarkdownPanel} from '@deck.gl-community/panels';
import {PanelWidget, SidebarPanelWidget} from '@deck.gl-community/widgets';

const sharedPanel = new ColumnPanel({
  id: 'summary',
  title: 'Summary',
  panels: [
    new MarkdownPanel({
      id: 'intro',
      title: 'Overview',
      markdown: 'Rendered through a deck.gl panel adapter.'
    })
  ]
});

const boxWidget = new PanelWidget({
  component: new BoxPanelContainer({
    id: 'box',
    title: 'Summary',
    panel: sharedPanel,
    placement: 'top-left'
  })
});

const sidebarWidget = new SidebarPanelWidget({
  id: 'sidebar',
  title: 'Details',
  panel: sharedPanel,
  placement: 'top-right'
});
```

Pass those widget instances to deck.gl through the `widgets` prop on `Deck`.

## Related pages

- [PanelWidget](/docs/modules/widgets/api-reference/panel-widget)
- [PanelComponent](/docs/modules/panels/api-reference/panel-components/panel-component)
- [PanelContainer](/docs/modules/panels/api-reference/panel-containers/panel-container)
- [Using Components](./using-components.md)
- [Using Managers](./using-managers.md)
