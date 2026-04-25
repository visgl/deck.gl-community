import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# PanelSidebar

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="panel-sidebar" size="tall" />

`PanelSidebar` renders panel content in a slide-over sidebar attached to the left or right edge.

Use it when controls or reference content should stay reachable while the user
continues interacting with the surrounding standalone UI.

## Usage

```ts
import {
  ColumnPanel,
  MarkdownPanel,
  PanelManager,
  PanelSidebar,
  type PanelSidebarProps
} from '@deck.gl-community/panels';

const inspectorPanel = new ColumnPanel({
  id: 'inspector',
  title: 'Inspector',
  panels: {
    details: new MarkdownPanel({
      id: 'details',
      title: 'Details',
      markdown: 'Persistent standalone controls and context.'
    })
  }
});

const panelSidebar = new PanelSidebar({
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
type PanelSidebarProps = PanelContainerProps & {
  container?: PanelContainer;
  panel?: Panel;
  side?: 'left' | 'right';
  widthPx?: number;
  placement?: PanelPlacement;
  title?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerLabel?: string;
  hideTrigger?: boolean;
  button?: boolean;
};
```

## Remarks

- Accepts either a full panel container description or a single panel.
- Slides open from the selected edge while keeping the shell mounted for smooth transitions.
- Supports controlled and uncontrolled open state.
- Use `SidebarPanelWidget` from `@deck.gl-community/widgets` when the same UI should be mounted through deck.gl.
