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

## Chrome around a deck.gl canvas

For permanent headers, footers, side regions, or pinnable inspectors, use a standalone
`PanelManager({parentElement, contentElement})`. Create and position the outer `parentElement`
in the application, create its direct-child `contentElement`, and initialize deck.gl inside
that content host. Let deck.gl follow that element's size as panels dock and undock.

Keep these chrome containers with the standalone manager rather than passing them through
`PanelWidget`: deck.gl's widget manager does not provide the optional content-layout contract.
You can still use ordinary deck widgets inside the canvas region alongside application chrome.

The [panel system walkthrough](../README.md#build-chrome-around-a-canvas) shows the complete setup,
and the [canvas chrome example](/examples/widgets/canvas-chrome) demonstrates resizing and
adaptive nested content without requiring a renderer dependency in the panels module.

## Related pages

- [PanelWidget](/docs/modules/widgets/api-reference/panel-widget)
- [PanelComponent](/docs/modules/panels/api-reference/panel-components/panel-component)
- [PanelContainer](/docs/modules/panels/api-reference/panel-containers/panel-container)
- [Using Components](./using-components.md)
- [Using Managers](./using-managers.md)
