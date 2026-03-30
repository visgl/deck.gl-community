# AccordeonWidgetContainer

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`AccordeonWidgetContainer` is the low-level accordion renderer used by `AccordeonWidgetPanel`.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {
  AccordeonWidgetContainer,
  type AccordeonWidgetContainerProps,
} from '@deck.gl-community/widgets';
```

## Props

```ts
type AccordeonWidgetContainerProps = {
  className?: string;
  panels: ReadonlyArray<WidgetPanel>;
  defaultExpandedPanelIds?: ReadonlyArray<string>;
  expandedPanelIds?: ReadonlyArray<string>;
  onExpandedPanelIdsChange?: (expandedPanelIds: ReadonlyArray<string>) => void;
  allowMultipleExpanded?: boolean;
};
```

## Behavior

- Renders a stack of collapsible sections from a list of `WidgetPanel` objects.
- Supports controlled and uncontrolled expansion state.
- Honors `disabled` and `keepMounted` on each child panel.

## Usage

Use `AccordeonWidgetContainer` directly when you already have an ordered panel array and want the raw accordion renderer rather than the wrapper `AccordeonWidgetPanel`.
