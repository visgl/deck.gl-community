import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# BoxPanelContainer

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`BoxPanelContainer` renders one panel inside a themed card with optional pinning.

Use it when panel content should stay visible in a fixed standalone card without
deck.gl widget placement.

<PanelLiveExample highlight="box-panel-container" />

## Usage

```ts
import {MarkdownPanel, BoxPanelContainer, PanelManager, type BoxPanelContainerProps} from '@deck.gl-community/panels';

const summaryPanel = new MarkdownPanel({
  id: 'summary',
  title: 'Summary',
  markdown: 'Always-visible standalone context.'
});

const panelBox = new BoxPanelContainer({
  id: 'summary-box',
  panel: summaryPanel,
  title: 'Summary'
});

const panelManager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

panelManager.setProps({
  components: [panelBox]
});
```

## Props

```ts
type BoxPanelContainerProps = PanelContainerProps & {
  panel?: Panel;
  placement?: PanelPlacement;
  title?: string;
  widthPx?: number;
  collapsible?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  pinnable?: boolean;
  side?: 'left' | 'right' | 'top' | 'bottom';
  pinned?: boolean;
  defaultPinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
  offsetPx?: number;
  heightPx?: number;
  fitContent?: boolean;
  resizable?: boolean;
};
```

## Remarks

- Accepts one reusable panel definition.
- Renders a themed card with optional title and collapsible body.
- Supports controlled and uncontrolled open state.
- Use `BoxPanelWidget` from `@deck.gl-community/widgets` when the same UI should be mounted through deck.gl.

## Optional pinning

Set `pinnable: true` to enable pin controls. Existing boxes remain floating by default.
`offsetPx` adds an inset from the floating placement edges and is ignored while docked.

### Pinnable example

```ts
import {PanelManager, MarkdownPanel, BoxPanelContainer} from '@deck.gl-community/panels';

// Application-owned elements; position and size parentElement in your layout.
const contentElement = document.createElement('div');
parentElement.append(contentElement);
const manager = new PanelManager({parentElement, contentElement});
const panel = new MarkdownPanel({id: 'pinnable-content', title: 'Content', markdown: 'Application UI'});

manager.setProps({components: [new BoxPanelContainer({pinnable: true,
  id: 'pinnable', panel, title: 'Inspector', side: 'right', placement: 'top-right', defaultPinned: false
})]});
```

`side` accepts `'left' | 'right' | 'top' | 'bottom'` and defaults to `'right'`. `placement` controls the floating anchor and defaults to `'bottom-left'`. Floating is the initial default state.

### Docking and sizing props

`BoxPanelContainerProps` includes `panel`, optional `title`, and the standard `PanelContainerProps`.
It also accepts `widthPx` (default 360), `heightPx` (default 240), `fitContent` (default false),
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
const inspector = new BoxPanelContainer({pinnable: true,
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

## Collapse a pinned box

`collapsible` defaults to `true`. Clicking the title collapses the box into a compact
floating title bar, releasing its docked width or height back to the visualization.
Expanding restores the previous docking edge and user-resized size. Pin state and
mounted content are retained; collapsing does not emit `onPinnedChange`.

Use `defaultOpen` for the initial state or `open` and `onOpenChange` for controlled
expansion. The title bar remains available to expand the panel. If no container title
is supplied, it uses the content panel's title or "Panel". Set `collapsible: false`
to omit the user collapse control.
