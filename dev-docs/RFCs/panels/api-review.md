# Panel props API implementation

Panel is generic in its public props. Every leaf, composite, settings-section, and Studio bridge
class renders from current props. Typed setProps updates work directly and through nested
compositions, mountPanel, or PanelManager reconciliation. Stable component types retain local
state. Composite definitions expose their child list for nested metadata invalidation.

AccordionPanel is the sole spelling, including props, rendering component, exports, source file,
and reference route. There are no compatibility aliases. SplitterPanel exposes split,
defaultSplit, and onSplitChange; initialSplit and the generic onChange name are removed.

A controlled split wins over its default. Dragging requests clamped changes, then waits for the
application's supplied ratio. Defaults initialize only once; programmatic updates emit no split
callbacks. Drag callbacks run start, movement requests, then end. Active drags read current props;
unmounting removes listeners silently. See the public reference and upgrade guide for details.

The Monaco runtime bridge and Monaco remain dynamically imported. ESM is the best entry point
for preserving this boundary; a downstream CommonJS bundler may choose a different chunk strategy.


## Verification

- Clean repository build and final panels ESM/CJS package build pass.
- Strict public consumer checks run in `yarn test-types`; removed names are compile errors.
- 255 browser integration tests pass, including React, widget, responsive host, and inline chrome.
- Focused reruns cover the final editor model/undo behavior (18 tests) and mutable Stats plus
  nested update/retention behavior (26 tests).
- 65 panel Node tests pass, including ESM distribution bundle graph checks and export absence.
- Lint passes without fixes; the final production website validates 198 Markdown pages.
- Only ESM distribution dynamic loading is asserted; downstream CommonJS chunk strategy is
  intentionally left to the consuming bundler.

## Default identities

All concrete panel classes now provide stable default IDs. IDs are optional constructor props;
applications override them when multiple instances of the same kind share an identity scope,
following widgets and layers. Defaults are stable rather than globally generated IDs.

## Sidebar consolidation

SidebarPanelContainer is now the public edge-panel class; SidePanelContainer is removed. Reuse the common docking/layout machinery rather
than compose two separately mounted panel implementations.

- `open` / `defaultOpen` / `onOpenChange` control visibility in both modes.
- `pinned` / `defaultPinned` / `onPinnedChange` select layout-consuming versus overlay mode.
- `pinnable` enables the user pin toggle. Programmatic `pinned` remains available independently.
- `hidable` governs user hide/restore controls; permanent chrome uses
  `{pinned: true, pinnable: false, hidable: false}`.
- Closing releases docked layout space and retains the configured pin state for reopening.
- Both modes own one content subtree. Moving between hosts preserves input/editor state,
  focus, scrolling, and user-resized dimensions.
- A pinned sidebar uses no backdrop. Existing overlay shortcuts/backdrop behavior stay scoped
  to the overlay mode; pinned chrome should not disappear on an unrelated Escape press.
- Without contentElement, overlays work and user pinning is unavailable, preserving the
  established optional-host contract. A configured pinned sidebar remains hidden.
- Migrate `hidden` to `open: !hidden`; keep one visibility API rather than two equivalent states.
- The redundant class/export/reference route is removed, with an upgrade-guide migration and
  no compatibility alias.

The implementation uses one persistent Preact body tree and the shared docked layout, pin control,
and resize-divider hooks. There is no compatibility class or export.

Default-ID follow-up verification: 244 panel browser tests, 65 Node tests, strict consumer
types, panel package build, lint, and the 198-page production website build pass. Independent
hosts sharing default IDs retain isolated Monaco models and source-picker input labels.
