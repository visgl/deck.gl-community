# CustomWidgetPanel

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`CustomWidgetPanel` hosts imperative DOM content inside the panel composition model.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {CustomWidgetPanel, type CustomWidgetPanelProps} from '@deck.gl-community/widgets';
```

## Props

```ts
type CustomWidgetPanelProps = {
  id: string;
  title: string;
  onRenderHTML: (rootElement: HTMLElement) => void | (() => void);
  disabled?: boolean;
  keepMounted?: boolean;
  className?: string;
  theme?: WidgetPanelTheme;
};
```

## Behavior

- Mounts a managed host element and calls `onRenderHTML` after that host is available.
- Accepts an optional cleanup callback so callers can tear down manual DOM work.
- Supports `disabled` and `keepMounted` like other panels.

## Usage

Use `CustomWidgetPanel` when panel content must be rendered imperatively instead of as a static JSX subtree.
