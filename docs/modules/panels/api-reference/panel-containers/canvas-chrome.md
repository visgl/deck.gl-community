import Demo from '@site/src/examples/widgets/canvas-chrome';

# Canvas Chrome Containers

`HeaderPanelContainer`, `FooterPanelContainer`, and pinned `SidebarPanelContainer` create permanent
chrome around a canvas host. `BoxPanelContainer` switches between an anchored overlay
and an edge of the same layout when `pinnable: true`. These containers work without deck.gl.

<Demo />

## Application-owned layout

Create the outer boundary and its content element yourself. The manager never wraps or
changes the positioning of the outer boundary:

```ts
import {
  PanelManager, HeaderPanelContainer, FooterPanelContainer,
  SidebarPanelContainer, BoxPanelContainer
} from '@deck.gl-community/panels';

const parentElement = document.createElement('div');
Object.assign(parentElement.style, {position: 'absolute', inset: '0'});
const contentElement = document.createElement('div');
parentElement.append(contentElement);
document.body.append(parentElement);

const manager = new PanelManager({parentElement, contentElement});
// Mount your renderer inside contentElement and let it follow the element's size.
manager.setProps({components: [
  new HeaderPanelContainer({id: 'header', panel: headerPanel, fitContent: true}),
  new FooterPanelContainer({id: 'footer', panel: statusPanel, heightPx: 32}),
  new SidebarPanelContainer({pinned: true, hidable: false, id: 'tools', panel: toolsPanel, side: 'left', widthPx: 180}),
  new BoxPanelContainer({pinnable: true, id: 'inspector', title: 'Inspector', panel: inspectorPanel,
    side: 'right', placement: 'top-right', defaultPinned: false})
]});
```

`contentElement` must initially be a direct child of `parentElement`. It is constructor-only
configuration; recreate the manager to replace it. Give the parent a definite width and height.
The manager creates an internal grid and moves only the supplied content element into its center.
It manages that element's bounds while mounted and restores its position and affected inline styles
on `finalize()`. Unrelated children are preserved. Avoid selectors that require the content element
to remain a direct child while the layout is active.

Top and bottom span the full width; left and right flank the center. Multiple containers
share an edge in registration order: horizontally on top/bottom, vertically on left/right.
Docking uses the overall host, even when a container is associated with a renderer view.
The renderer must respond to changes in its content host's dimensions, for example using
its existing automatic resize support or a `ResizeObserver`.

## Optional content element

`contentElement` is optional. When omitted, existing overlays work as before. Floating pinnable
panels remain visible with a disabled pin button. Permanent chrome and pinnable panels configured
as pinned remain hidden. The manager preserves configured pin state and emits no pin-change
callbacks merely because docking is unavailable.

Use these containers with `PanelManager`; deck widget adapters do not supply the content layout
contract required for pinning.

## Shared props

All four containers accept `panel`, optional `title`, and the usual `PanelContainerProps`.
Permanent containers omit their title bar when no title is supplied.

| Prop | Default | Behavior |
| --- | --- | --- |
| `widthPx` | `320` for chrome, `360` for boxes | Left/right docking thickness and floating width |
| `heightPx` | `240` | Top/bottom docking thickness |
| `fitContent` | `false` | Follow natural content size until manually resized |
| `resizable` | `false` for permanent chrome; `true` for pinnable | Show a divider while docked |

Each edge's thickness is capped at 45% of the host dimension to leave room for the center.
Overflowing content scrolls. Dividers support pointer dragging and arrow keys (10px steps).
Manual resizing retains pixel dimensions across pin/unpin transitions. Calling
`container.setProps({fitContent: true})` resets sizing to follow content again.

Headers always use the top edge and footers the bottom. `SidebarPanelContainer.side` accepts
`'left' | 'right'` and defaults to `'left'`.

## Pin state

`BoxPanelContainer` enables pinning with `pinnable: true` and adds these props:

- `offsetPx`: floating inset in pixels (default zero); removed while pinned.

| Prop | Default | Behavior |
| --- | --- | --- |
| `side` | `'right'` | `'left'`, `'right'`, `'top'`, or `'bottom'` |
| `placement` | `'bottom-left'` | Existing overlay placement anchor |
| `pinned` | `undefined` | Controlled pin state |
| `defaultPinned` | `false` | Initial uncontrolled state |
| `onPinnedChange` | `undefined` | Receives user pin/unpin requests |

In controlled usage, update `pinned` in response to `onPinnedChange`. Switching to uncontrolled
usage retains the last controlled value. Moving between floating and pinned preserves mounted
panel content and local component state. Free dragging and drag-to-dock are not included.

## Adaptive subpanels

Descendants, including those inside composite panels, can call `usePanelContainerState()`
to react to changes without being remounted:

```tsx
/** @jsxImportSource preact */
import {usePanelContainerState} from '@deck.gl-community/panels';

function AdaptiveContent() {
  const state = usePanelContainerState();
  return <div style={{display: 'flex', flexDirection: state?.pinned ? 'column' : 'row'}}>
    {/* panel content */}
  </div>;
}
```

The hook returns `{pinned, side, canPin}` for the nearest chrome container, or `undefined`
outside one. `pinned` is the configured effective state; `canPin` reports whether the manager
supplies `contentElement`. Permanent chrome reports `pinned: true`.

## Hideable side panels

`SidebarPanelContainer` uses `open` / `defaultOpen` / `onOpenChange` for visibility in both
overlay and pinned modes. `hidable` defaults to true; setting it to false removes user
hide/restore controls. Closing pinned chrome releases layout space and preserves the
mounted content and pin state. Permanent chrome uses
`{pinned: true, pinnable: false, hidable: false}`. See [SidebarPanelContainer](./sidebar-panel-container.md).
