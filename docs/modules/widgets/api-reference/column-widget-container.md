# ColumnWidgetContainer

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`ColumnWidgetContainer` is the low-level stacked renderer used by `ColumnWidgetPanel`.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {
  ColumnWidgetContainer,
  type ColumnWidgetContainerProps,
} from '@deck.gl-community/widgets';
```

## Props

```ts
type ColumnWidgetContainerProps = {
  className?: string;
  panels: ReadonlyArray<WidgetPanel>;
};
```

## Behavior

- Renders every child panel in order in one vertical column.
- Adds section dividers between later panels.
- Applies per-panel theme overrides through the shared panel theme scope.

## Usage

Use `ColumnWidgetContainer` directly when the calling code already owns the ordered panel array and does not need the object-map wrapper constructor.
