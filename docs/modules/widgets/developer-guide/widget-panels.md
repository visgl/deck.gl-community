import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# Panel Widgets

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="widget-panels" size="tall" />

Panel widgets lets you use panels and components from the
[`@deck.gl-community/panels`](/docs/modules/panels/README) module in deck.gl applications.

- `@deck.gl-community/panels` provides a generic panel-based UI.
- `@deck.gl-community/widgets` enables you to use those panel definitions through
  convenient deck.gl wrapper widgets.

## Usage

Import panels from [`@deck.gl-community/panels`](/docs/modules/panels/README).
Pass those panel definitions to deck.gl widgets from `@deck.gl-community/widgets`.

## Container widgets

These are the deck.gl widgets that consume `WidgetPanel` and `WidgetContainer` values:

| Widget | Purpose |
| --- | --- |
| [BoxPanelWidget](../api-reference/box-widget.md) | Static panel content anchored in a deck.gl widget corner. |
| [FullScreenPanelWidget](../api-reference/full-screen-panel-widget.md) | A large inset panel layout that occupies most of the viewport. |
| [ModalPanelWidget](../api-reference/modal-widget.md) | On-demand panel content shown in a centered overlay. |
| [SidebarPanelWidget](../api-reference/sidebar-widget.md) | Persistent panel content attached to the left or right edge. |

## Panel definitions

Use [`@deck.gl-community/panels`](/docs/modules/panels/README) for panel composition:

- [Using with deck.gl](/docs/modules/panels/developer-guide/using-with-deck-gl)
- [Leaf Panels](/docs/modules/panels/api-reference/custom-panel)
- [Composite Panels](/docs/modules/panels/api-reference/accordeon-panel)
- [Panel Containers](/docs/modules/panels/api-reference/panel-container)

## Composition patterns

- Use `BoxPanelWidget` for compact summaries or status cards.
- Use `SidebarPanelWidget` for persistent controls or inspectors.
- Use `ModalPanelWidget` when panel content should open on demand.
- Use `FullScreenPanelWidget` when one panel layout should temporarily take over the viewport.
- Build the panel content itself in `@deck.gl-community/panels`, then reuse the same definitions across multiple widget wrappers.
