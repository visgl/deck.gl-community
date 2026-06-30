import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# SidebarPanelContainer

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="sidebar-panel-container" size="tall" />

`SidebarPanelContainer` renders panel content in a slide-over sidebar attached to the left or right edge.

Use it when controls or reference content should stay reachable while the user
continues interacting with the surrounding standalone UI.

## Usage

```ts
import {
  ColumnPanel,
  MarkdownPanel,
  PanelManager,
  SidebarPanelContainer,
  type SidebarPanelContainerProps
} from '@deck.gl-community/panels';

const inspectorPanel = new ColumnPanel({
  id: 'inspector',
  title: 'Inspector',
  panels: [
    new MarkdownPanel({
      id: 'details',
      title: 'Details',
      markdown: 'Persistent standalone controls and context.'
    })
  ]
});

const panelSidebar = new SidebarPanelContainer({
  id: 'inspector-sidebar',
  panel: inspectorPanel,
  side: 'right',
  title: 'Inspector'
});

const panelManager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

panelManager.setProps({
  components: [panelSidebar]
});
```

## Props

```ts
type SidebarPanelContainerProps = PanelContainerProps & {
  panel?: Panel;
  side?: 'left' | 'right';
  widthPx?: number;
  placement?: PanelPlacement;
  title?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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

## Remarks

- Accepts one reusable panel definition.
- Slides open from the selected edge while keeping the shell mounted for smooth transitions.
- Supports controlled and uncontrolled open state.
- `triggerIcon` accepts a text glyph or a data/http(s) image URL rendered as a CSS mask icon.
- Supports `Escape` close, optional backdrop close, and focus restoration to
  `deck.canvas` after close.
- `openShortcuts` and `shortcuts` are registered through structural
  `deck.eventManager` access when available.
- `viewportMarginPx` controls the docked panel margin, and
  `dockTriggerWhenOpen` keeps the trigger aligned beside the open panel.
- Use `SidebarPanelWidget` from `@deck.gl-community/widgets` when the same UI should be mounted through deck.gl.
