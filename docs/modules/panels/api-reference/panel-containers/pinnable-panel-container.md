import Demo from '@site/src/examples/widgets/canvas-chrome';

# PinnablePanelContainer

An anchored floating panel that users can pin beside the canvas.

<Demo />

## Usage

```ts
import {PanelManager, MarkdownPanel, PinnablePanelContainer} from '@deck.gl-community/panels';

// Application-owned elements; position and size parentElement in your layout.
const contentElement = document.createElement('div');
parentElement.append(contentElement);
const manager = new PanelManager({parentElement, contentElement});
const panel = new MarkdownPanel({id: 'pinnable-content', title: 'Content', markdown: 'Application UI'});

manager.setProps({components: [new PinnablePanelContainer({
  id: 'pinnable', panel, title: 'Inspector', side: 'right', placement: 'top-right', defaultPinned: false
})]});
```

`side` accepts `'left' | 'right' | 'top' | 'bottom'` and defaults to `'right'`. `placement` controls the floating anchor and defaults to `'top-left'`. Floating is the initial default state.

## Props

`PinnablePanelContainerProps` includes `panel`, optional `title`, and the standard `PanelContainerProps`.
It also accepts `widthPx` (default 320), `heightPx` (default 240), `fitContent` (default false),
and `resizable` (default true).

The docking axis uses width for left/right and height for top/bottom. Content fitting follows
natural size until divider resizing takes over; pass `setProps({fitContent: true})` to reset.
Dividers support pointer dragging and arrow keys. See [shared sizing rules](./canvas-chrome.md#shared-props).

## Host requirements

`contentElement` is an optional `PanelManager` constructor prop and must be a direct child
of `parentElement`. The application retains control of the parent's outer positioning.
Without it, floating panels remain visible with a disabled pin button; pinned panels are hidden.
The renderer must follow the changing content-region size.

## Pin state

Use `defaultPinned` for uncontrolled state or `pinned` plus `onPinnedChange` for controlled state:

```ts
const inspector = new PinnablePanelContainer({
  id: 'controlled-inspector', pinned: false, panel,
  onPinnedChange: pinned => inspector.setProps({pinned})
});
```

The header button requests pin/unpin changes. Updating `pinned` through `setProps` applies
controlled state; programmatic prop changes do not emit `onPinnedChange`. Returning to
uncontrolled state retains the last controlled value. Content and user sizing survive pin cycles.

Nested content can call `usePanelContainerState()` to adapt to `{pinned, side, canPin}` changes.
See [adaptive subpanels](./canvas-chrome.md#adaptive-subpanels) for an inline example.

See the [panel system walkthrough](../../README.md#build-chrome-around-a-canvas),
[layout contract](./canvas-chrome.md), and [website example](/examples/widgets/canvas-chrome).
