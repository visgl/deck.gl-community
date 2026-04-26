# Using Panels

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`@deck.gl-community/panels` provides the composition model for building panel-based UI.
It focuses on panel definitions, container composition, and rendering structure.

## Core concepts

- A leaf panel defines one titled unit of content.
- A composite panel combines other panels into a larger structure.
- A panel container describes how panels are arranged and rendered.

## Composite Panels

Panels built from other panels.

- [AccordeonPanel](../api-reference/accordeon-panel.md)
- [TabbedPanel](../api-reference/tabbed-panel.md)
- [ColumnPanel](../api-reference/column-panel.md)

## Leaf Panels

Panels with no child panels.

- [CustomPanel](../api-reference/custom-panel.md)
- [AIAssistPanel](../api-reference/ai-assist-panel.md)
- [BinaryDataPanel](../api-reference/binary-data-panel.md)
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
- Use `AIAssistPanel` for OpenAssistant-powered chat inside panel containers.
- Use `BinaryDataPanel` for capped hex and ASCII previews of caller-supplied binary data.
- Use `StatsPanel` for compact probe.gl stats tables inside an existing panel layout.
- Use `CustomPanel` when content must be rendered imperatively into a DOM host.
- Use `TextEditorPanel` for Monaco-backed JSON or plaintext editing within a panel layout.
