import PanelLiveExample from '@site/src/components/docs/panel-live-example';
import CanvasChromeDemo from '@site/src/examples/widgets/canvas-chrome';

# SidebarPanelContainer

An edge-attached drawer that can overlay content or be pinned beside it. Use one class for
inspectors, hideable tool sidebars, and permanent application chrome.

<PanelLiveExample highlight="sidebar-panel-container" size="tall" />

## Usage

```ts
import {MarkdownPanel, PanelManager, SidebarPanelContainer} from '@deck.gl-community/panels';

const manager = new PanelManager({parentElement, contentElement, components: [
  new SidebarPanelContainer({
    title: 'Tools', side: 'left', widthPx: 240,
    pinnable: true, defaultPinned: true, hidable: true, resizable: true,
    panel: new MarkdownPanel({title: 'Tools', markdown: 'Layers · Selection · Settings'})
  })
]});
```

The application owns and positions `parentElement`. Optional `contentElement` starts as its
direct child and hosts the renderer. Pinning moves the sidebar outside that content region and
reduces its available width. Unpinning returns the same mounted content to an overlay.
See the [layout walkthrough](../../README.md#build-chrome-around-a-canvas).

## State and capabilities

| Prop | Default | Meaning |
| --- | --- | --- |
| `open` / `defaultOpen` | uncontrolled, initially `true` | Whether the sidebar is visible |
| `onOpenChange` | — | Requested visibility after a user action |
| `pinned` / `defaultPinned` | uncontrolled, initially `false` | Whether it occupies a docked edge |
| `onPinnedChange` | — | Requested pin state after a user action |
| `pinnable` | `false` | Whether the user gets a pin/unpin button |
| `hidable` | `true` | Whether the user gets hide/restore controls |

Controlled values remain authoritative until the application supplies their next value.
Defaults initialize local state once. Unrelated updates and fresh definitions with stable IDs
retain that state. Programmatic updates do not emit change callbacks.

`pinnable` and `hidable` govern user controls; they do not override application-owned `pinned`
or `open` values. Closing a pinned sidebar releases canvas space and leaves a floating restore
button unless `hideTrigger` is true. Reopening restores its pin state and resized dimensions.

The body remains mounted while closed and across pin transitions, including when its trigger
is hidden. Inputs, editor models, local component state, scrolling, and focus survive pin changes.
Closed content is inert. Nested panels can read `{pinned, side, canPin}` through
`usePanelContainerState()`.

### Permanent chrome

```ts
new SidebarPanelContainer({
  title: 'Tools', side: 'left', panel: toolsPanel,
  pinned: true, pinnable: false, hidable: false
});
```

Permanent chrome has no user pin/hide affordances. Applications can still update `open` or
`pinned` through props. Header and footer chrome remain separate classes.

### Controlled inspector

```ts
const inspector = new SidebarPanelContainer({
  title: 'Inspector', panel: inspectorPanel, pinnable: true,
  pinned: false, open: true,
  onPinnedChange: pinned => inspector.setProps({pinned}),
  onOpenChange: open => inspector.setProps({open})
});
```

For centralized application state, write requests into that state and reconcile fresh
definitions instead. Both update styles use the same mounted instance.

## Props

```ts
type SidebarPanelContainerProps = PanelContainerProps & {
  panel?: Panel;
  side?: 'left' | 'right';
  title?: string;
  widthPx?: number;
  heightPx?: number;
  fitContent?: boolean;
  resizable?: boolean;
  placement?: PanelPlacement;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  pinned?: boolean;
  defaultPinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
  pinnable?: boolean;
  hidable?: boolean;
  triggerLabel?: string;
  triggerIcon?: string;
  showTitleBar?: boolean;
  hideTrigger?: boolean;
  button?: boolean;
  openShortcuts?: KeyboardShortcut[];
  shortcuts?: KeyboardShortcut[];
  viewportMarginPx?: number;
  dockTriggerWhenOpen?: boolean;
  showBackdrop?: boolean;
};
```

- `id` defaults to `sidebar-panel-container`; override it for multiple sidebars in one manager.
- `side` defaults to `right`; `widthPx` defaults to 360. Width is the thickness on either edge.
- `fitContent` and `resizable` default to false. Manual resizing persists across hide and pin
  transitions; `setProps({fitContent: true})` resets content fitting. See [shared sizing](./canvas-chrome.md#shared-props).
- `viewportMarginPx` defaults to 12 and applies to overlays. Docked chrome is flush to its edge.
- `showTitleBar` defaults to true. It governs the header, including pin/hide actions.
- `hideTrigger` defaults to false; set it for application-owned opening controls. `button`
  defaults to false and enables the compact handle style when true.
- `triggerLabel` defaults to `Open sidebar`. `triggerIcon` accepts a glyph or data/http(s) mask URL.
- `dockTriggerWhenOpen` keeps the overlay trigger beside the open drawer; it does not enable pinning.
- `showBackdrop` defaults to false. Backdrop and Escape closing apply only to hideable overlays,
  never pinned chrome. Deck-backed overlays restore focus to the canvas on close.
- `openShortcuts` and `shortcuts` use the structural host event manager when present.

## Optional content host

Without `contentElement`, overlays still work and the user pin button is disabled. A sidebar
configured as pinned remains hidden, preserving its configured state without firing callbacks.
Use `PanelManager` with a content host for docking. `SidebarPanelWidget` remains useful for
Deck-owned overlays; that host alone does not supply the docking layout contract.

## Inline chrome example

<CanvasChromeDemo />

The tools sidebar demonstrates pinning, hiding, restoring, and canvas resizing alongside
headers, footers, and a pinnable inspector.
