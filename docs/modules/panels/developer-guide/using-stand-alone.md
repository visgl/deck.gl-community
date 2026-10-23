# Using Stand-Alone

Use `@deck.gl-community/panels` directly when you want panel-based UI without
creating a `Deck` instance.

The standalone path has three pieces:

- panel composition through panels and panel containers
- mounting through `PanelManager` and standalone `PanelComponent` instances
- host theming through exported panel theme variables

## When to use this

Use the standalone path when:

- the app does not use deck.gl at all
- the UI should render next to a custom canvas or DOM scene
- you want panel composition without adopting a framework-specific wrapper

## Core pieces

- `MarkdownPanel`, `CustomPanel`, `StatsPanel`, `SettingsPanel`, Arrow inspection panels, and similar classes define content
- `ColumnPanel`, `TabbedPanel`, and `AccordeonPanel` compose multiple panels
- `BoxPanelContainer`, `ModalPanelContainer`, `SidebarPanelContainer`, and
  `FullScreenPanelContainer` mount panel content into concrete standalone containers
- `ToolbarComponent` and `ToastComponent` are specialized standalone
  `PanelComponent` instances rather than panel containers
- `PanelManager` mounts panel-managed UI into an HTML element
- `applyPanelTheme` applies light or dark panel theme variables to a host element
- `toastManager` manages toast state independently of any particular renderer

## Example

```ts
import {
  PANEL_THEME_DARK,
  MarkdownPanel,
  BoxPanelContainer,
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
    new BoxPanelContainer({
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

- [Toast Manager](../api-reference/managers/toast-manager.md)
- [Panel Manager](../api-reference/managers/panel-manager.md)
- [Panel Themes](../api-reference/panel-theme.md)
- [Using Panels](./using-panels.md)
- [Using Components](./using-components.md)
- [Using Managers](./using-managers.md)
- [Standalone panels example](/examples/widgets/standalone-widgets)

## Embed content in an existing surface

Use `mountPanel` when your application already owns the chrome, such as an InfoBox.
This mounts content without placement hosts, overlay positioning, or a `PanelManager`.
It inherits the host's panel theme, including custom definitions and runtime changes.

```ts
import {applyPanelTheme, mountPanel, MarkdownPanel} from '@deck.gl-community/panels';

applyPanelTheme(hostElement, {
  base: 'sleek-dark', variables: {'--button-text': '#ddffee'}
});
const mounted = mountPanel(new MarkdownPanel({
  id: 'summary', title: 'Summary', markdown: 'Embedded content'
}), hostElement);

// Replace or refresh content; matching panel ids preserve component state.
mounted.setPanel(nextPanel);
// Clear content while retaining the mount for later use.
mounted.setPanel(null);
// Unmount and remove only the owned surface; unrelated host children remain.
mounted.finalize();
```

Titles are omitted by default because the application usually supplies its own header.
Pass `{showTitle: true}` as the third argument to render the title. `finalize()` is
idempotent, and later `setPanel()` calls are ignored. This helper does not take ownership
of the panel definition or alter its standalone manager lifecycle.

For React-owned controls, use the [React content bridge](../../react/api-reference/panel.md#react-owned-content).
