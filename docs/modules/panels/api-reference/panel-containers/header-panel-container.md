import Demo from '@site/src/examples/widgets/canvas-chrome';

# HeaderPanelContainer

Permanent top chrome spanning the full visualization boundary.

<Demo />

## Usage

```ts
import {PanelManager, MarkdownPanel, HeaderPanelContainer} from '@deck.gl-community/panels';

// Application-owned elements; position and size parentElement in your layout.
const contentElement = document.createElement('div');
parentElement.append(contentElement);
const manager = new PanelManager({parentElement, contentElement});
const panel = new MarkdownPanel({id: 'header-content', title: 'Content', markdown: 'Application UI'});

manager.setProps({components: [new HeaderPanelContainer({
  id: 'header', panel, fitContent: true
})]});
```

Header chrome sits above both side regions and the canvas. Without a title, no title bar is rendered.

## Props

`HeaderPanelContainerProps` includes `panel`, optional `title`, and the standard `PanelContainerProps`.
It also accepts `widthPx` (default 320), `heightPx` (default 240), `fitContent` (default false),
and `resizable` (default false).

The docking axis uses width for left/right and height for top/bottom. Content fitting follows
natural size until divider resizing takes over; pass `setProps({fitContent: true})` to reset.
Dividers support pointer dragging and arrow keys. See [shared sizing rules](./canvas-chrome.md#shared-props).

## Host requirements

`contentElement` is an optional `PanelManager` constructor prop and must be a direct child
of `parentElement`. The application retains control of the parent's outer positioning.
Without it, this permanent container stays hidden.
The renderer must follow the changing content-region size.

See the [panel system walkthrough](../../README.md#build-chrome-around-a-canvas),
[layout contract](./canvas-chrome.md), and [website example](/examples/widgets/canvas-chrome).
