# Overview

`@deck.gl-community/panels` provides a modest set of composable UI components intended
for small data visualization applications.

- Composable: built on `PanelComponent`, `Panel`, and panel containers.
- Framework-independent: owns Preact-rendered UI without requiring a React application.
- deck.gl integration: can be used with deck.gl's widget system, through `PanelWidget` adapters from `@deck.gl-community/widgets`.

Use this package when you want reusable panel composition, standalone mounting
through `PanelManager`, standalone panel theming, and application-managed UI
state such as toast notifications.

## Panels

Panels are titled content definitions. Leaf panels render one unit of content;
composite panels arrange other panels; panel containers mount one panel inside
box, modal, sidebar, or full-screen chrome.

- Core: [Panel](./api-reference/panel.md), [Panel Themes](./api-reference/panel-theme.md)
- Leaf panels: [MarkdownPanel](./api-reference/markdown-panel.md), [SettingsPanel](./api-reference/settings-panel.md), [KeyboardShortcutsPanel](./api-reference/keyboard-shortcuts-panel.md), [URLParametersPanel](./api-reference/url-parameters-panel.md), Arrow inspection panels, stats, docs links, binary data, and text editor panels
- Composite panels: [AccordeonPanel](./api-reference/composite-panels/accordeon-panel.md), [ColumnPanel](./api-reference/composite-panels/column-panel.md), [SplitterPanel](./api-reference/composite-panels/splitter-panel.md), [TabbedPanel](./api-reference/composite-panels/tabbed-panel.md)
- Panel containers: [PanelContainer](./api-reference/panel-containers/panel-container.md), [BoxPanelContainer](./api-reference/panel-containers/box-panel-container.md), [ModalPanelContainer](./api-reference/panel-containers/modal-panel-container.md), [SidebarPanelContainer](./api-reference/panel-containers/sidebar-panel-container.md), [FullScreenPanelContainer](./api-reference/panel-containers/full-screen-panel-container.md)

## Components

Components are panel-owned mountable UI that are not necessarily panels.
`PanelComponent` is the root lifecycle class; `Panel`, panel containers,
toolbars, toast stacks, and app-specific panel-managed controls extend it.

- [PanelComponent](./api-reference/panel-components/panel-component.md)
- [ToolbarComponent](./api-reference/panel-components/toolbar-component.md)
- [ToastComponent](./api-reference/panel-components/toast-component.md)

## Managers

Managers keep application behavior and state outside rendering. Descriptor-backed
managers can share the same definitions with panels so settings, shortcut help,
and URL docs stay synchronized with the app.

- [PanelManager](./api-reference/managers/panel-manager.md) mounts `PanelComponent[]` without deck.gl
- [SettingsManager](./api-reference/managers/settings-manager.md) tracks settings snapshots and persistence for `SettingsPanel`
- [KeyboardShortcutsManager](./api-reference/managers/keyboard-shortcuts-manager.md) dispatches shortcuts documented by `KeyboardShortcutsPanel`
- [URLManager](./api-reference/managers/url-manager.md) parses and serializes deep links documented by `URLParametersPanel`
- [CommandManager](./api-reference/managers/command-manager.md) registers executable app commands
- [Toast Manager](./api-reference/managers/toast-manager.md) owns toast state rendered by `ToastComponent`

Start with [Using Panels](./developer-guide/using-panels.md) for panel
composition, [Using Components](./developer-guide/using-components.md) for
non-panel `PanelComponent` instances, and
[Using Managers](./developer-guide/using-managers.md) when application
descriptors should also drive panel help or settings UI.

:::caution
The deck.gl-community repository is semi-maintained. One of its goals is to collect and preserve valuable deck.gl ecosystem related code that does not have a dedicated home. Some modules may no longer have dedicated maintainers. This means that there is sometimes no one who can respond quickly to issues.
:::
