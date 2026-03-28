# Widgets

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`@deck.gl-community/widgets` ships a set of HTML widgets that can be mounted into deck.gl view corners.

Most of these widgets extend `Widget` from `@deck.gl/core` and render Preact content into the deck overlay. Some are generic, while others are trace-specific.

## Publicly exported widgets

These are exported from `@deck.gl-community/widgets`:

- [HeapMemoryWidget](./heap-memory-widget.md)
- [KeyboardShortcutsWidget](./keyboard-shortcuts-widget.md)
- [OmniBoxWidget](./omni-box-widget.md)
- [ResetViewWidget](./reset-view-widget.md)
- [SettingsWidget](./settings-widget.md)
- [TimeMeasureWidget](./time-measure-widget.md)
- [ToastWidget](./toast-widget.md)
- [TraceYZoomWidget](./trace-y-zoom-widget.md)

## Related helpers

Several widgets wrap helper libraries rather than owning their own state model:

- `KeyboardShortcutsManager`
- `SettingsManager`
- `ToastManager`
