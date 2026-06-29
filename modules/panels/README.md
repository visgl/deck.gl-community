# @deck.gl-community/panels

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/panels.svg)](https://www.npmjs.com/package/@deck.gl-community/panels)
[![NPM Downloads](https://img.shields.io/npm/dw/@deck.gl-community/panels.svg)](https://www.npmjs.com/package/@deck.gl-community/panels)

This module provides a set of composable UI components intended for small data
visualization applications.

- Composable: built on `PanelComponent`, `Panel`, and panel containers.
- Reusable: owns Preact-rendered UI without requiring a React application.
- deck.gl widget integration: can be adapted through `PanelWidget` from
  `@deck.gl-community/widgets`.

It exports `PanelComponent`, panel/container types, reusable panel content
classes, `ToolbarComponent`, `ToastComponent`, `PanelManager`, panel theme
primitives, and application-managed helpers such as `toastManager`.

## Panels

`Panel` is the titled content base class. Leaf panels render one content unit;
composite panels arrange other panels; `PanelContainer` subclasses mount one
panel inside box, modal, sidebar, or full-screen chrome.

## Components

`PanelComponent` is the root mountable lifecycle class owned by this package.
`Panel`, panel containers, `ToolbarComponent`, `ToastComponent`, and
application-specific panel-managed controls extend it.

## Managers

`PanelManager` mounts `PanelComponent[]` without deck.gl. `SettingsManager`,
keyboard shortcut managers, `URLManager`, `CommandManager`, and `toastManager`
keep app behavior and state outside rendering so panels and components can
reuse the same descriptors or state.
