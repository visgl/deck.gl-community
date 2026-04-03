# Widgets

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`@deck.gl-community/widgets` ships a set of HTML widgets that can be mounted into deck.gl view corners.

Most of these widgets extend `Widget` from `@deck.gl/core` and render Preact content into the deck overlay.

## Panel Widgets

Generic panel widgets and the composition helpers they use:

- [Widget Panels](./widget-panels.md)
- [BoxWidget](./box-widget.md)
- [ModalWidget](./modal-widget.md)
- [SidebarWidget](./sidebar-widget.md)
- [ToolbarWidget](./toolbar-widget.md)
- [AccordeonWidgetPanel](./accordeon-widget-panel.md)
- [ColumnWidgetPanel](./column-widget-panel.md)
- [CustomWidgetPanel](./custom-widget-panel.md)
- [KeyboardSettingsWidgetPanel](./keyboard-settings-widget-panel.md)
- [MarkdownWidgetPanel](./markdown-widget-panel.md)
- [StatsWidgetPanel](./stats-widget-panel.md)
- [SettingsWidgetPanel](./settings-widget-panel.md)
- [TabbedWidgetPanel](./tabbed-widget-panel.md)
- [TextEditorWidgetPanel](./text-editor-widget-panel.md)
- [AccordeonWidgetContainer](./accordeon-widget-container.md)
- [ColumnWidgetContainer](./column-widget-container.md)
- [TabbedWidgetContainer](./tabbed-widget-container.md)
- [WidgetContainerRenderer](./widget-container-renderer.md)

## Overlay Widgets

- [HtmlOverlayWidget](./html-overlay-widget.md)
- [HtmlClusterWidget](./html-cluster-widget.md)
- [HtmlOverlayItem](./html-overlay-item.md)
- [HtmlTooltipWidget](./html-tooltip-widget.md)

## Other Widgets

- [HeapMemoryWidget](./heap-memory-widget.md)
- [KeyboardShortcutsWidget](./keyboard-shortcuts-widget.md)
- [OmniBoxWidget](./omni-box-widget.md)
- [PanWidget](./pan-widget.md)
- [ResetViewWidget](./reset-view-widget.md)
- [SettingsWidget](./settings-widget.md)
- [TimeMeasureWidget](./time-measure-widget.md)
- [ToastWidget](./toast-widget.md)
- [YZoomWidget](./y-zoom-widget.md)
- [ZoomRangeWidget](./zoom-range-widget.md)

## Related helpers

Several widgets wrap helper libraries rather than owning their own state model:

- `KeyboardShortcutsManager`
- `SettingsManager`
- `ToastManager`
