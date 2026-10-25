# Overview

![From v9.3](https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square)

`@deck.gl-community/panels` builds inspectors, settings, editors, and application chrome
around a visualization. Use it with any canvas or DOM renderer; deck.gl is optional.

Build UI in three steps: define **content panels**, compose them, then choose a
**container** and mount it with **PanelManager**. Application data stays in your
application. Panel props describe what to show; callbacks report user changes.

```sh
yarn add @deck.gl-community/panels
```

The examples below use TypeScript and an application-owned DOM host with a definite size.

- Composable: built on `PanelComponent`, `Panel`, and panel containers.
- Framework-independent: owns Preact-rendered UI without requiring a React application.
- deck.gl integration: can be used with deck.gl's widget system, through `PanelWidget` adapters from `@deck.gl-community/widgets`.

Use this package when you want reusable panel composition, standalone mounting
through `PanelManager`, standalone panel theming, and application-managed UI
state such as toast notifications.

## In-content panels

Start with panels that organize the UI **inside** a content area. A `Panel` defines a titled
piece of content; it does not decide where it sits relative to a canvas.

Leaf panels provide individual content units such as Markdown, settings, a table, or an editor.
Composite panels arrange other panels into columns, tabs, accordions, or split views. Build up
these content definitions first, then choose how to mount them.

```ts
import {MarkdownPanel, ColumnPanel, TabbedPanel} from '@deck.gl-community/panels';

const summary = new MarkdownPanel({
  id: 'summary', title: 'Summary', markdown: '**Scene:** City center'
});
const selection = new MarkdownPanel({
  id: 'selection', title: 'Selection', markdown: 'No object selected.'
});
const details = new ColumnPanel({
  id: 'details', title: 'Details', panels: [summary, selection]
});
const help = new MarkdownPanel({
  id: 'help', title: 'Help', markdown: 'Select an object to inspect its properties.'
});
const inspectorContent = new TabbedPanel({
  id: 'inspector-content', title: 'Inspector', panels: [details, help]
});
```

`inspectorContent` now describes reusable content with tabs and a column of subpanels. Use
`CustomPanel` for imperative application DOM or extend `Panel` for Preact-rendered content.
The application continues to own its data and behavior.

### Embed content in your own UI

If your application already has a sidebar or inspector surface, mount the content there directly:

```ts
import {mountPanel} from '@deck.gl-community/panels';

const mounted = mountPanel(inspectorContent, inspectorElement, {showTitle: true});
// Later, replace the content with another definition:
mounted.setPanel(nextInspectorContent);
// During application cleanup:
mounted.finalize();
```

Here `inspectorElement` is your application-owned DOM surface and `nextInspectorContent`
is a new panel definition. [mountPanel](./api-reference/mount-panel.md) adds no positioning
or outer chrome. Use a container when the panels package should own that shell.

### Mount content in a container

A container supplies the outer shell. For example, display the composed content in a floating box:

```ts
import {PanelManager, BoxPanelContainer} from '@deck.gl-community/panels';

const manager = new PanelManager({parentElement, components: [new BoxPanelContainer({
  id: 'inspector-box', title: 'Inspector', panel: inspectorContent,
  placement: 'top-right'
})]});
```

`PanelManager` mounts panel-module components, reconciles them by id, and owns their DOM lifecycle.
Boxes, modals, and overlay sidebars can show the same composed content. This overlay-only setup
needs only an application-positioned `parentElement`; no canvas layout management is required.
Call `manager.finalize()` when the application is removed.

### Update UI from application state

Every specialized panel renders from its current public props. Update a nested content panel
directly without rebuilding its surrounding layout:

```ts
function showSelection(label: string) {
  selection.setProps({markdown: label});
}
```

For applications that render a complete tree from state, pass fresh definitions through
`manager.setProps({components})`. Stable IDs and types preserve mounted instances and local
control state. A new ID or type starts a new lifecycle. The list describes the complete desired
UI: omit a component to remove it, or pass `[]` to clear it. Both update styles use the same
render-from-props implementation.

For controlled UI state, supply a value and its change callback. For local UI state, use
`default…` props. See [state and updates](./developer-guide/using-panels.md#state-and-updates)
for tabs, expansion, visibility, and pinning.

### Choose a container

| Container | Behavior | Needs `contentElement`? |
| --- | --- | --- |
| `BoxPanelContainer` | Floating card; optionally pinnable and collapsible | Only for pinning |
| `ModalPanelContainer` | Dialog opened from a trigger | No |
| `SidebarPanelContainer` | Overlay drawer, pinnable sidebar, or permanent side chrome | Only for pinning |
| `FullScreenPanelContainer` | Expanded overlay | No |
| `HeaderPanelContainer` / `FooterPanelContainer` | Space above / below the content | Yes |

`SidebarPanelContainer` overlays content when unpinned and resizes the content region when pinned.
Use `pinnable` to expose that choice to the user; use `hidable` for hide/restore controls.

### Available panels and containers

Panels are titled content definitions. Leaf panels render one unit of content;
composite panels arrange other panels; panel containers mount one panel inside
box, modal, sidebar, or full-screen chrome.

- Core: [Panel](./api-reference/panel.md),
  [Panel Themes](./api-reference/panel-theme.md)
- Leaf panels: [SourcePickerPanel](./api-reference/source-picker-panel.md),
  [MetricsPanel](./api-reference/metrics-panel.md),
  [MarkdownPanel](./api-reference/markdown-panel.md),
  [SettingsPanel](./api-reference/settings-panel.md),
  [KeyboardShortcutsPanel](./api-reference/keyboard-shortcuts-panel.md),
  [URLParametersPanel](./api-reference/url-parameters-panel.md), Arrow
  inspection panels, stats, docs links, binary data, and text editor panels
- Composite panels:
  [AccordionPanel](./api-reference/composite-panels/accordion-panel.md),
  [ColumnPanel](./api-reference/composite-panels/column-panel.md),
  [SplitterPanel](./api-reference/composite-panels/splitter-panel.md),
  [TabbedPanel](./api-reference/composite-panels/tabbed-panel.md)
- Panel containers:
  [PanelContainer](./api-reference/panel-containers/panel-container.md),
  [BoxPanelContainer](./api-reference/panel-containers/box-panel-container.md),
  [ModalPanelContainer](./api-reference/panel-containers/modal-panel-container.md),
  [SidebarPanelContainer](./api-reference/panel-containers/sidebar-panel-container.md),
  [FullScreenPanelContainer](./api-reference/panel-containers/full-screen-panel-container.md),
  [HeaderPanelContainer](./api-reference/panel-containers/header-panel-container.md),
  [FooterPanelContainer](./api-reference/panel-containers/footer-panel-container.md),
  optional pinning on [BoxPanelContainer](./api-reference/panel-containers/box-panel-container.md)

## Build chrome around a canvas

Chrome panels form the application UI **around** a canvas or other renderer. Reuse the content
panels above inside permanent headers, footers, and side regions, or put them in a pinnable
inspector. Docked chrome consumes layout space; floating containers overlay the canvas.

This mode adds an optional content host to the same `PanelManager`. The panels package remains
independent of deck.gl, and your application continues to own its renderer.

### 1. Create the application boundary and canvas host

The application creates two elements:

| Element | Application responsibility | Manager responsibility |
| --- | --- | --- |
| `parentElement` | Position and size the overall visualization area | Mount panel UI inside this boundary |
| `contentElement` (optional) | Create it as a direct child and mount the renderer inside it | Arrange it alongside docked chrome and resize its available region |

The manager never wraps or changes the outer positioning of `parentElement`. It creates an
internal layout **inside** that boundary and moves the supplied `contentElement` into the center.
It does not collect or move unrelated application children.

```ts
import {PanelManager} from '@deck.gl-community/panels';

const parentElement = document.createElement('div');
Object.assign(parentElement.style, {
  position: 'absolute', inset: '0', width: '100%', height: '100%'
});
const contentElement = document.createElement('div');
parentElement.append(contentElement);
document.body.append(parentElement);

const manager = new PanelManager({parentElement, contentElement});
// Initialize your canvas, map, or other renderer inside contentElement.
```

Give the parent a definite size using your application's layout. Let the renderer follow the
content host's changing dimensions through its automatic resizing support or a `ResizeObserver`.
Do not continue sizing the renderer against the larger outer boundary after adding chrome.

### 2. Define panel content and choose its shell

This example uses Markdown content; replace it with settings, composite panels, or `CustomPanel`
for application-specific DOM. Each mounted container needs a distinct id.

```ts
import {
  MarkdownPanel, HeaderPanelContainer, FooterPanelContainer,
  SidebarPanelContainer, BoxPanelContainer
} from '@deck.gl-community/panels';

const createTextPanel = (id: string, markdown: string) =>
  new MarkdownPanel({id, title: id, markdown});

const inspector = new BoxPanelContainer({pinnable: true,
  id: 'inspector', title: 'Inspector', side: 'right',
  placement: 'top-left', offsetPx: 16, widthPx: 280,
  panel: createTextPanel('selection', 'Select an object to inspect it.')
});

manager.setProps({components: [
  new HeaderPanelContainer({
    id: 'header', fitContent: true,
    panel: createTextPanel('heading', '**Scene explorer**')
  }),
  new FooterPanelContainer({
    id: 'status', heightPx: 36,
    panel: createTextPanel('status-text', 'Ready')
  }),
  new SidebarPanelContainer({pinned: true, hidable: true, title: 'Tools',
    id: 'tools', side: 'left', widthPx: 180, resizable: true,
    panel: createTextPanel('tool-list', 'Layers · Selection · Settings')
  }),
  inspector
]});
```

Header and footer span the full width. Side chrome flanks the center between them. The inspector
starts floating over the canvas; its pin button moves it to the right edge and makes the canvas
region narrower. Unpinning returns it to its overlay anchor, preserving mounted content state.
Collapsing its title releases the docked space and leaves a compact floating title bar.
Expanding restores its pin state and resized dimensions.

Use `widthPx` for side thickness and `heightPx` for top/bottom thickness. `fitContent: true`
follows natural content size. With `resizable: true`, a divider supports pointer dragging and
arrow keys; manual resizing takes over from content fitting until you reset it through
`setProps({fitContent: true})`. Large panels are constrained and their content scrolls.

### 3. Let nested panels adapt to pinning

Use `usePanelContainerState()` inside Preact-rendered content to obtain the nearest chrome
container's `{pinned, side, canPin}` state. It updates on pin or edge changes, including inside
composite panels. It returns `undefined` outside chrome containers.

```tsx
/** @jsxImportSource preact */
import {usePanelContainerState} from '@deck.gl-community/panels';

function InspectorContent() {
  const layout = usePanelContainerState();
  return <div style={{display: 'flex', flexDirection: layout?.pinned ? 'column' : 'row'}}>
    <span>Selection</span><span>Properties</span>
  </div>;
}
```

For application-controlled pinning, pass `pinned` and update it in response to
`onPinnedChange`. Otherwise, use `defaultPinned` for the initial state and let the container
handle its pin button.

### 4. Clean up with the application

```ts
// When the application is removed:
manager.finalize();
// Also dispose your renderer and disconnect any application-owned resize observer.
```

Finalization removes managed panel DOM and restores the content element's original position
and affected inline styles. Keep the content element stable for the manager's lifetime; recreate
the manager to use a different one.

### Overlay-only applications

Omit `contentElement` to keep existing overlay-only usage:

```ts
const overlays = new PanelManager({parentElement});
```

Floating containers still work. Pinnable panels that are floating have a disabled pin button.
Permanent header/footer/side chrome and pinnable containers configured as pinned stay hidden.
Their configured state is preserved, and no pin-change callback fires because docking is unavailable.

Use standalone `PanelManager` for canvas chrome, including in deck.gl applications.
`PanelWidget` adapters remain useful for existing overlays but do not provide the content layout
contract needed for docking. The panels package itself does not import deck.gl.

Sidebars support hide/restore controls with `hidable: true` (the default). Use `open` and
`onOpenChange` to control visibility, or `defaultOpen` for initial local state. Closing a pinned
sidebar releases canvas space and leaves a floating restore button.

### Try the complete example

import CanvasChromeDemo from '@site/src/examples/widgets/canvas-chrome';

<CanvasChromeDemo />

The [Canvas Chrome website example](/examples/widgets/canvas-chrome) combines permanent chrome,
a pinnable inspector, a canvas that follows the remaining space, and adaptive nested content.
The [source](https://github.com/visgl/deck.gl-community/blob/master/examples/widgets/panel-docs/canvas-chrome.tsx)
exports `mountCanvasChromeExample(container)` and returns a cleanup function.

## Components

Components are panel-owned mountable UI that are not necessarily panels.
`PanelComponent` is the root lifecycle class; `Panel`, panel containers,
toolbars, toast stacks, and app-specific panel-managed controls extend it.

- [PanelComponent](./api-reference/panel-components/panel-component.md)
- [ToolbarComponent](./api-reference/panel-components/toolbar-component.md)
- [ToastComponent](./api-reference/panel-components/toast-component.md)

## Managers

Managers keep application behavior and state outside rendering. Descriptor-backed
managers can share the same definitions with panels so settings, shortcut help,
and URL docs stay synchronized with the app.

- [PanelManager](./api-reference/managers/panel-manager.md) mounts
  `PanelComponent[]` without deck.gl
- [SettingsManager](./api-reference/managers/settings-manager.md) tracks
  settings snapshots and persistence for `SettingsPanel`
- [KeyboardShortcutsManager](./api-reference/managers/keyboard-shortcuts-manager.md)
  dispatches shortcuts documented by `KeyboardShortcutsPanel`
- [URLManager](./api-reference/managers/url-manager.md) parses and serializes
  deep links documented by `URLParametersPanel`
- [CommandManager](./api-reference/managers/command-manager.md) registers
  executable app commands
- [Toast Manager](./api-reference/managers/toast-manager.md) owns toast state
  rendered by `ToastComponent`

Start with [Using Panels](./developer-guide/using-panels.md) for panel
composition, [Using Components](./developer-guide/using-components.md) for
non-panel `PanelComponent` instances, and
[Using Managers](./developer-guide/using-managers.md) when application
descriptors should also drive panel help or settings UI.

:::caution
The deck.gl-community repository is semi-maintained. One of its goals is to collect and preserve valuable deck.gl ecosystem related code that does not have a dedicated home. Some modules may no longer have dedicated maintainers. This means that there is sometimes no one who can respond quickly to issues.
:::
