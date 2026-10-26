# Using Panels

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`@deck.gl-community/panels` provides the composition model for building panel-based UI.
It focuses on panel definitions, container composition, and rendering structure.

## Core concepts

- A leaf panel defines one titled unit of content.
- A composite panel combines other panels into a larger structure.
- A panel container hosts one panel inside box, modal, sidebar, or full-screen chrome.
- A `PanelComponent` is any panel-managed UI that can be mounted directly.

Use [Using Components](./using-components.md) for panel-managed UI that is not
titled panel content, and [Using Managers](./using-managers.md) when one app
descriptor list should also drive panel help or settings UI.

## State and updates

Use plain props to describe the desired UI. Rebuild panel definitions and pass them to
`manager.setProps({components})` when application data changes. Every panel has a default ID,
following the widget/layer convention. Override it when multiple instances of the same kind
share a list; keep that ID stable across updates. Do not mutate a definition's `content`,
`title`, or `props` fields directly.

`PanelManager` reconciles top-level components by ID and class. It applies the new definition's
props to the mounted instance; nested content is rendered through that instance. Keep the
manager and host elements stable. `finalize()` belongs in your application's cleanup.

Every panel class uses its public props both in the constructor and in typed `setProps`.
Updating a nested panel refreshes the mounted compositions that contain it, including headings
and theme scope. Unchanged component types and IDs retain their local control state.

```ts
const summary = new MarkdownPanel({id: 'summary', title: 'Summary', markdown: 'Ready'});
// After mounting summary directly, in a container, or inside a composite:
summary.setProps({markdown: 'Selected **Station A**', title: 'Station A'});
```

You can also create fresh definitions and reconcile the complete tree through the manager.
Choose either approach according to your application's state model; both render current props.
Data objects and arrays should be replaced rather than mutated in place. IDs identify lifecycles:
keep them stable for updates; use a new definition/ID when a fresh lifecycle is intended.

| UI state | Controlled prop | Initial local state | Change callback |
| --- | --- | --- | --- |
| Box expansion | `open` | `defaultOpen` | `onOpenChange` |
| Box docking | `pinned` | `defaultPinned` | `onPinnedChange` |
| Sidebar visibility | `open` | `defaultOpen` | `onOpenChange` |
| Sidebar docking | `pinned` | `defaultPinned` | `onPinnedChange` |
| Active tab | `activePanelId` | `defaultActivePanelId` | `onActivePanelIdChange` |
| Accordion sections | `expandedPanelIds` | `defaultExpandedPanelIds` | `onExpandedPanelIdsChange` |
| Splitter ratio | `split` | `defaultSplit` | `onSplitChange` |
| Editor text | `value` | `defaultValue` | `onValueChange` |

A controlled prop remains authoritative: the callback requests a change, and your application
must supply the next value. A default initializes local state and does not reset it on every
render. Avoid switching between controlled and uncontrolled modes during a mounted lifetime.

```ts
let activePanelId = 'summary';
function renderInspector() {
  manager.setProps({components: [new BoxPanelContainer({
    id: 'inspector', title: 'Inspector',
    panel: new TabbedPanel({
      id: 'inspector-tabs', panels: [summaryPanel, detailsPanel], activePanelId,
      onActivePanelIdChange: nextId => {
        if (nextId) {
          activePanelId = nextId;
          renderInspector();
        }
      }
    })
  })]});
}
```

Here `manager` is a stable `PanelManager`; `summaryPanel` and `detailsPanel` are content
panels with IDs `summary` and `details`. For local selection, replace the controlled pair
with `defaultActivePanelId: 'summary'`.

## Containers and canvas chrome

Choose a floating `BoxPanelContainer` for an inspector, `ModalPanelContainer` for help,
or `SidebarPanelContainer` for an overlay drawer. These need only `parentElement`.

For UI that consumes space around your visualization, pass optional `contentElement` and use
`HeaderPanelContainer`, `FooterPanelContainer`, or a pinned `SidebarPanelContainer`. A box with
`pinnable: true` can switch between overlay and docked layout. The
[chrome walkthrough](../README.md#build-chrome-around-a-canvas) explains the two hosts,
resizing, hide/restore controls, and cleanup.

## Themes and application content

Set `theme: 'sleek-dark'` on a content panel to theme its subtree, or apply a theme to the
application boundary to include container chrome. Descendants inherit unless they override it.
See [Panel Themes](../api-reference/panel-theme.md) for presets, custom tokens, and scope.

Use [CustomPanel](../api-reference/custom-panel.md) to mount existing application DOM;
use the [React bridge](/docs/modules/react/api-reference/panel) for React-owned content.
You do not need to expose Preact components in application code to compose built-in panels.

## Composite Panels

Panels built from other panels.

- [AccordionPanel](../api-reference/composite-panels/accordion-panel.md)
- [TabbedPanel](../api-reference/composite-panels/tabbed-panel.md)
- [ColumnPanel](../api-reference/composite-panels/column-panel.md)
- [SplitterPanel](../api-reference/composite-panels/splitter-panel.md)

## Leaf Panels

Panels with no child panels.

- [CustomPanel](../api-reference/custom-panel.md)
- [ArrowBatchesPanel](../api-reference/arrow-batches-panel.md)
- [ArrowSchemaPanel](../api-reference/arrow-schema-panel.md)
- [ArrowTablePanel](../api-reference/arrow-table-panel.md)
- [BinaryDataPanel](../api-reference/binary-data-panel.md)
- [MarkdownPanel](../api-reference/markdown-panel.md)
- [StatsPanel](../api-reference/stats-panel.md)
- [SettingsPanel](../api-reference/settings-panel.md)
- [DocumentationLinksPanel](../api-reference/documentation-links-panel.md)
- [KeyboardShortcutsPanel](../api-reference/keyboard-shortcuts-panel.md)
- [TextEditorPanel](../api-reference/text-editor-panel.md)
- [URLParametersPanel](../api-reference/url-parameters-panel.md)

## Composition patterns

- Use `AccordionPanel` when you want a stack of collapsible sections.
- Use `TabbedPanel` when several panels share the same footprint and only one should be visible at a time.
- Use `ColumnPanel` when all child panels should remain visible in order.
- Use `SplitterPanel` when the first child panel should resize against the remaining child panels.
- Use `MarkdownPanel` for small descriptive content without mounting your own renderer.
- Use `ArrowTablePanel`, `ArrowSchemaPanel`, and `ArrowBatchesPanel` to inspect
  Arrow tables, schema metadata, and record batch structure without importing
  deck.gl.
- Use `BinaryDataPanel` for capped hex and ASCII previews of caller-supplied binary data.
- Use `StatsPanel` for compact probe.gl stats tables inside an existing panel layout.
- Use `DocumentationLinksPanel` for generic help and resource links.
- Use `KeyboardShortcutsPanel` for keyboard, mouse, and trackpad interaction
  references.
- Use `URLParametersPanel` for documenting deep-link query parameters.
- Use `CustomPanel` when content must be rendered imperatively into a DOM host.
- Use `TextEditorPanel` for Monaco-backed JSON or plaintext editing within a panel layout.

## Tabbed help modal

Combine standalone panel primitives to build reusable help UI without taking a
dependency on deck.gl.

```ts
import {
  DocumentationLinksPanel,
  KeyboardShortcutsPanel,
  PanelManager,
  ModalPanelContainer,
  TabbedPanel,
  URLParametersPanel
} from '@deck.gl-community/panels';

const helpTabs = new TabbedPanel({
  id: 'help-tabs',
  title: 'Help',
  panels: [
    new KeyboardShortcutsPanel({keyboardShortcuts}),
    new URLParametersPanel({urlParameters}),
    new DocumentationLinksPanel({links: documentationLinks})
  ]
});

const helpModal = new ModalPanelContainer({
  id: 'help-modal',
  panel: helpTabs,
  title: 'Help',
  triggerLabel: 'Help',
  openShortcuts: [
    {
      key: '/',
      commandKey: true,
      name: 'Open help',
      description: 'Open help.',
      preventDefault: true
    }
  ]
});

const panelManager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

panelManager.setProps({
  components: [helpModal]
});
```

## Arrow inspector beside luma.gl

Mount Arrow panels into any DOM host next to a luma.gl canvas. The panels only
depend on structural Arrow APIs and can inspect CPU Arrow tables produced by
luma.gl examples or loaders.gl sources.

```ts
import {
  ArrowBatchesPanel,
  ArrowSchemaPanel,
  ArrowTablePanel,
  ColumnPanel,
  BoxPanelContainer,
  PanelManager
} from '@deck.gl-community/panels';

import type {ArrowSchemaLike, ArrowTableInput} from '@deck.gl-community/panels';

const panelManager = new PanelManager({
  parentElement: document.getElementById('inspector') as HTMLElement
});

let selectedBatchIndex: number | undefined;

function renderArrowInspector(table: ArrowTableInput, schema: ArrowSchemaLike) {
  panelManager.setProps({
    components: [
      new BoxPanelContainer({
        id: 'arrow-inspector-box',
        title: 'Arrow Inspector',
        panel: new ColumnPanel({
          id: 'arrow-inspector',
          title: 'Arrow Inspector',
          panels: [
            new ArrowBatchesPanel({
              id: 'arrow-batches',
              title: 'Batches',
              table,
              selectedBatchIndex,
              onBatchSelect: batchIndex => {
                selectedBatchIndex = batchIndex;
                renderArrowInspector(table, schema);
              }
            }),
            new ArrowTablePanel({
              id: 'arrow-table',
              title: 'Table',
              table,
              batchIndex: selectedBatchIndex ?? 'all',
              showRowIndex: true,
              maxRows: 50,
              maxNestedItems: 6
            }),
            new ArrowSchemaPanel({
              id: 'arrow-schema',
              title: 'Schema',
              schema
            })
          ]
        })
      })
    ]
  });
}
```
