# TabbedWidgetContainer

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`TabbedWidgetContainer` is the low-level tab renderer used by `TabbedWidgetPanel`.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {
  TabbedWidgetContainer,
  type TabbedWidgetContainerProps,
} from '@deck.gl-community/widgets';
```

## Props

```ts
type TabbedWidgetContainerProps = {
  className?: string;
  panels: ReadonlyArray<WidgetPanel>;
  defaultActivePanelId?: string;
  activePanelId?: string;
  onActivePanelIdChange?: (activePanelId: string | undefined) => void;
  tabListLayout?: 'wrap' | 'scroll';
};
```

## Behavior

- Supports controlled and uncontrolled active-tab state.
- Skips disabled child panels when choosing the initial active tab.
- Supports wrapped or horizontally scrolling tab lists.

## Usage

Use `TabbedWidgetContainer` directly when the calling code already has an ordered `WidgetPanel[]` and wants raw tab rendering without the wrapper `TabbedWidgetPanel`.
