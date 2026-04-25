import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# CustomPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="custom-panel" />

`CustomPanel` hosts imperative DOM content inside the panel composition model.

## Import

```ts
import {CustomPanel, type CustomPanelProps} from '@deck.gl-community/panels';
```

## Props

```ts
type CustomPanelProps = {
  id: string;
  title: string;
  onRenderHTML: (rootElement: HTMLElement) => void | (() => void);
  disabled?: boolean;
  keepMounted?: boolean;
  className?: string;
  theme?: WidgetPanelTheme;
};
```


## Usage

Use `CustomPanel` when panel content must be rendered imperatively instead of as a static JSX subtree.

## Remarks

- Mounts a managed host element and calls `onRenderHTML` after that host is available.
- Accepts an optional cleanup callback so callers can tear down manual DOM work.
- Supports `disabled` and `keepMounted` like other panels.
