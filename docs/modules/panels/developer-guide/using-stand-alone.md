# Using Stand-Alone

Use `@deck.gl-community/panels` directly when you want panel-based UI without
creating a `Deck` instance.

The standalone path has three pieces:

- panel composition through panels and panel containers
- mounting through `PanelManager` and standalone panel containers
- host theming through exported panel theme variables

## When to use this

Use the standalone path when:

- the app does not use deck.gl at all
- the UI should render next to a custom canvas or DOM scene
- you want panel composition without adopting a framework-specific wrapper

## Core pieces

- `MarkdownPanel`, `CustomPanel`, `StatsPanel`, `SettingsPanel`, and similar classes define content
- `ColumnPanel`, `TabbedPanel`, and `AccordeonPanel` compose multiple panels
- `PanelBox`, `PanelModal`, `PanelSidebar`, and `PanelFullScreen` mount panel content into concrete standalone containers
- `PanelManager` mounts panel-managed UI into an HTML element
- `applyPanelTheme` applies light or dark panel theme variables to a host element
- `toastManager` manages toast state independently of any particular renderer

## Example

```ts
import {
  PANEL_THEME_DARK,
  MarkdownPanel,
  PanelBox,
  PanelManager,
  applyPanelTheme,
  toastManager
} from '@deck.gl-community/panels';

const hostElement = document.getElementById('panel-root') as HTMLElement;
const panelManager = new PanelManager({parentElement: hostElement});
applyPanelTheme(hostElement, PANEL_THEME_DARK);

const overviewPanel = new MarkdownPanel({
  id: 'intro',
  title: 'Overview',
  markdown: 'Rendered without deck.gl.'
});

panelManager.setProps({
  components: [
    new PanelBox({
      id: 'summary-box',
      title: 'Summary',
      panel: overviewPanel
    })
  ]
});

toastManager.toast({
  type: 'info',
  message: 'Rendered without deck.gl.'
});
```

## Related pages

- [Toast Manager](../api-reference/toast-manager.md)
- [Panel Manager](../api-reference/panel-manager.md)
- [Panel Themes](../api-reference/panel-theme.md)
- [Using Panels](./using-panels.md)
- [Standalone panels example](/examples/widgets/standalone-widgets)
