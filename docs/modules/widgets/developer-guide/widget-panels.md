import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# Panel Widgets

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="widget-panels" size="tall" />

Panel widgets let you use components from the
[`@deck.gl-community/panels`](/docs/modules/panels) module in deck.gl applications.

- `@deck.gl-community/panels` owns `PanelComponent`, panels, containers, toolbar,
  toast, and their rendering behavior.
- `@deck.gl-community/widgets` adapts those components to deck.gl's widget
  lifecycle.

## Usage

Import components from [`@deck.gl-community/panels`](/docs/modules/panels).
Wrap any component in `PanelWidget`, or use one of the thin named adapters from
`@deck.gl-community/widgets`.

## Adapter API

See [PanelWidget](../api-reference/panel-widget.md) for the generic adapter and
the concise named-adapter list.

## Panel definitions

Use [`@deck.gl-community/panels`](/docs/modules/panels) for panel composition:

- [Using with deck.gl](/docs/modules/panels/developer-guide/using-with-deck-gl)
- [Leaf Panels](/docs/modules/panels/api-reference/custom-panel)
- [Composite Panels](/docs/modules/panels/api-reference/composite-panels/accordeon-panel)
- [Panel Containers](/docs/modules/panels/api-reference/panel-containers/panel-container)

## Composition patterns

- Use `PanelWidget` when the application already has a `PanelComponent`
  instance.
- Use named adapters for concise construction of built-in panel containers,
  toolbar, or toast.
- Build panel content itself in `@deck.gl-community/panels`, then reuse the same
  definitions across standalone and deck hosts.

## Renderer selection

When a surface needs to switch between WebGPU and WebGL while keeping a reusable luma device alive, use the widgets package's renderer-selection APIs:

- [`DeviceManager`](../api-reference/device-manager.md) owns shared backend state, cached devices, and canvas reparenting.
- [`DeviceTabsWidget`](../api-reference/device-tabs-widget.md) provides a deck.gl widget UI for switching the active backend.

This backend-selection layer is separate from panel composition, but it fits naturally beside panel widgets when an application needs both a control surface and a managed render device.
