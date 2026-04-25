import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# SidebarWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="sidebar-widget" />

`SidebarWidget` renders a slide-over panel anchored to the left or right edge of the deck overlay.

## Usage

```ts
import {ColumnPanel, MarkdownPanel} from '@deck.gl-community/panels';
import {SidebarWidget} from '@deck.gl-community/widgets';

const inspectorPanel = new ColumnPanel({
  id: 'inspector',
  title: 'Inspector',
  panels: {
    details: new MarkdownPanel({
      id: 'details',
      title: 'Details',
      markdown: 'Persistent controls and context.'
    })
  }
});

const widget = new SidebarWidget({
  id: 'inspector-widget',
  panel: inspectorPanel,
  side: 'right'
});
```

Use `SidebarWidget` for persistent controls, inspector panels, or other UI that should stay reachable while the user continues interacting with the visualization.

Import panel definitions from `@deck.gl-community/panels` and pass them to `SidebarWidget`
through `panel` or `container`.

## Props

```ts
type SidebarWidgetProps = WidgetProps & {
  icon?: string;
  container?: WidgetContainer;
  panel?: WidgetPanel;
  side?: 'left' | 'right';
  widthPx?: number;
  placement?: WidgetPlacement;
  title?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerLabel?: string;
  triggerIcon?: string;
  hideTrigger?: boolean;
  button?: boolean;
};
```

## Remarks

- Accepts either a full panel `container` description or a single `panel`.
- Slides open from the selected edge while keeping the shell mounted for smooth animation.
- Can render with a built-in handle trigger or stay externally controlled.
- Stops pointer, mouse, touch, and wheel propagation so sidebar interactions do not leak into the deck canvas.
- Reparents itself to the full widget overlay so the sidebar can span the full deck edge.
