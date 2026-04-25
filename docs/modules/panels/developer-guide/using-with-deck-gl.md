# Using with deck.gl

Use `@deck.gl-community/panels` with `@deck.gl-community/widgets` when the UI
should be mounted through deck.gl's widget system.

In this setup:

- `@deck.gl-community/panels` provides panel and container definitions
- `@deck.gl-community/widgets` provides deck-facing panel wrappers
- deck.gl theming should come from `@deck.gl/widgets`, not `applyPanelTheme(...)`

## When to use this

Use the deck.gl path when:

- the UI should stay anchored to a deck.gl view
- widget placement should follow deck.gl corners or fill layout
- panel interactions should live inside the deck.gl widget lifecycle

## Core pieces

- leaf panels and composite panels describe UI structure
- `BoxPanelWidget`, `SidebarPanelWidget`, `ModalPanelWidget`, and `FullScreenPanelWidget` mount those panel definitions through deck.gl
- `Deck` owns placement and lifecycle through its `widgets` prop

## Example

```ts
import {ColumnPanel, MarkdownPanel} from '@deck.gl-community/panels';
import {BoxPanelWidget, SidebarPanelWidget} from '@deck.gl-community/widgets';

const sharedPanel = new ColumnPanel({
  id: 'summary',
  title: 'Summary',
  panels: {
    intro: new MarkdownPanel({
      id: 'intro',
      title: 'Overview',
      markdown: 'Rendered inside deck.gl widget wrappers.'
    })
  }
});

const boxWidget = new BoxPanelWidget({
  id: 'box',
  title: 'Summary',
  panel: sharedPanel,
  placement: 'top-left'
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

- [BoxPanelWidget](/docs/modules/widgets/api-reference/box-widget)
- [SidebarPanelWidget](/docs/modules/widgets/api-reference/sidebar-widget)
- [ModalPanelWidget](/docs/modules/widgets/api-reference/modal-widget)
- [FullScreenPanelWidget](/docs/modules/widgets/api-reference/full-screen-panel-widget)
