import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# Panel Widgets

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="widget-panels" size="tall" />

`@deck.gl-community/panels` includes a small composition model for building generic panel-based widgets.
Those panels can be hosted either by deck.gl widget classes or by the standalone `WidgetHost`
API when you want to mount them into plain HTML without a `Deck` instance.

## Core concepts

- `WidgetPanel`: one titled unit of content with optional theme override and disabled/keep-mounted flags.
- `WidgetContainer`: a serialized description of how one or more panels should be arranged.

## Deck wrappers

These panel definitions are consumed by deck-facing wrappers from
[`@deck.gl-community/widgets`](/docs/modules/widgets/README):

- [BoxWidget](/docs/modules/widgets/api-reference/box-widget)
- [FullScreenPanelWidget](/docs/modules/widgets/api-reference/full-screen-panel-widget)
- [ModalWidget](/docs/modules/widgets/api-reference/modal-widget)
- [SidebarWidget](/docs/modules/widgets/api-reference/sidebar-widget)

## Container Panels

- [AccordeonPanel](../api-reference/accordeon-panel.md)
- [TabbedPanel](../api-reference/tabbed-panel.md)
- [ColumnPanel](../api-reference/column-panel.md)

## Panels

- [CustomPanel](../api-reference/custom-panel.md)
- [MarkdownPanel](../api-reference/markdown-panel.md)
- [StatsPanel](../api-reference/stats-panel.md)
- [SettingsPanel](../api-reference/settings-panel.md)
- [KeyboardShortcutsPanel](../api-reference/keyboard-shortcuts-panel.md)
- [TextEditorPanel](../api-reference/text-editor-panel.md)

## Composition patterns

- Use `AccordeonPanel` when you want a stack of collapsible sections.
- Use `TabbedPanel` when several panels share the same footprint and only one should be visible at a time.
- Use `ColumnPanel` when all child panels should remain visible in order.
- Use `MarkdownPanel` for small descriptive content without mounting your own renderer.
- Use `StatsPanel` for compact probe.gl stats tables inside an existing panel layout.
- Use `CustomPanel` when content must be rendered imperatively into a DOM host.
- Use `TextEditorPanel` for Monaco-backed JSON or plaintext editing within a panel layout.
