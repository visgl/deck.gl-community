# Overview

`@deck.gl-community/panels` provides a set of composable UI-components intended
for small data visualization applications.

- Composable: built on a concept of composable panels and panel containers.
- Framework agnostic: no dependency on a specific UI framework, such as React.
- deck.gl integration: can be used through panel wrapper widgets from `@deck.gl-community/widgets`.

Use this package when you want reusable panel composition, framework-agnostic
rendering, standalone mounting through `PanelManager`, standalone panel
theming, and application-managed UI state such as toast notifications.

## Using with deck.gl

For deck-facing wrappers, use [`@deck.gl-community/widgets`](/docs/modules/widgets/README):

- [BoxPanelWidget](/docs/modules/widgets/api-reference/box-widget)
- [ModalPanelWidget](/docs/modules/widgets/api-reference/modal-widget)
- [SidebarPanelWidget](/docs/modules/widgets/api-reference/sidebar-widget)
- [FullScreenPanelWidget](/docs/modules/widgets/api-reference/full-screen-panel-widget)

:::caution
The deck.gl-community repository is semi-maintaned. One of its goals is to collect and preserve valuable deck.gl ecosystem related code that does not have a dedicated home. Some modules may no longer have dedicated maintainers. This means that there is sometimes no one who can respond quickly to issues.
:::
