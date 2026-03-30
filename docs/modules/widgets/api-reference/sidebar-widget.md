# SidebarWidget

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`SidebarWidget` renders a slide-over panel anchored to the left or right edge of the deck overlay.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {SidebarWidget} from '@deck.gl-community/widgets';
```

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

## Behavior

- Accepts either a full `container` description or a single `panel`.
- Slides open from the selected edge while keeping the shell mounted for smooth animation.
- Can render with a built-in handle trigger or stay externally controlled.
- Stops pointer, mouse, touch, and wheel propagation so sidebar interactions do not leak into the deck canvas.
- Reparents itself to the full widget overlay so the sidebar can span the full deck edge.

## Usage

Use `SidebarWidget` for persistent controls, inspector panels, or other UI that should stay reachable while the user continues interacting with the visualization.
