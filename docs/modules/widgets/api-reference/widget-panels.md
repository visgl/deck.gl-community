# Widget Panels

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`@deck.gl-community/widgets` includes a small composition model for building generic panel-based widgets.

## Core concepts

- `WidgetPanel`: one titled unit of content with optional theme override and disabled/keep-mounted flags.
- `WidgetContainer`: a serialized description of how one or more panels should be arranged.
- `WidgetContainerRenderer`: the renderer that turns a `WidgetContainer` into Preact UI inside `BoxWidget`, `ModalWidget`, or `SidebarWidget`.

## Container widgets

These are the deck.gl widgets that consume `WidgetPanel` and `WidgetContainer` values:

- [BoxWidget](./box-widget.md)
- [ModalWidget](./modal-widget.md)
- [SidebarWidget](./sidebar-widget.md)
- [ToolbarWidget](./toolbar-widget.md)

## Exported panel helpers

- [AccordeonWidgetPanel](./accordeon-widget-panel.md)
- [TabbedWidgetPanel](./tabbed-widget-panel.md)
- [ColumnWidgetPanel](./column-widget-panel.md)
- [CustomWidgetPanel](./custom-widget-panel.md)
- [MarkdownWidgetPanel](./markdown-widget-panel.md)
- [SettingsWidgetPanel](./settings-widget-panel.md)
- [KeyboardSettingsWidgetPanel](./keyboard-settings-widget-panel.md)
- [TextEditorWidgetPanel](./text-editor-widget-panel.md)

## Exported container helpers

- [AccordeonWidgetContainer](./accordeon-widget-container.md)
- [TabbedWidgetContainer](./tabbed-widget-container.md)
- [ColumnWidgetContainer](./column-widget-container.md)
- [WidgetContainerRenderer](./widget-container-renderer.md)
- `asPanelContainer`

## Composition patterns

- Use `AccordeonWidgetPanel` when you want a stack of collapsible sections.
- Use `TabbedWidgetPanel` when several panels share the same footprint and only one should be visible at a time.
- Use `ColumnWidgetPanel` when all child panels should remain visible in order.
- Use `MarkdownWidgetPanel` for small descriptive content without mounting your own renderer.
- Use `CustomWidgetPanel` when content must be rendered imperatively into a DOM host.
- Use `TextEditorWidgetPanel` for Monaco-backed JSON or plaintext editing within a panel layout.

## Example

The [Widget Panels example](/examples/widgets/widget-panels) shows the same panel definitions reused in:

- a persistent `SidebarWidget`
- a tabbed `ModalWidget`
- a summary `BoxWidget`
