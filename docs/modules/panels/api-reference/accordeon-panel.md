import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# AccordeonPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="accordeon-panel" />

`AccordeonPanel` wraps multiple child panels into one collapsible accordion panel.

## Usage

Use `AccordeonPanel` when one panel should expand into several collapsible subsections.

```ts
import {AccordeonPanel, type AccordeonPanelProps} from '@deck.gl-community/panels';
```

## Props

```ts
type AccordeonPanelProps = {
  panels: Record<string, Panel>;
  id?: string;
  title?: string;
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
};
```

## See Also

- [Using Panels](../developer-guide/widget-panels.md)

## Remarks

- Normalizes an object map of child panels into insertion-order accordion sections.
- Produces one composite panel that can be used directly or passed into the deck.gl wrapper module.
