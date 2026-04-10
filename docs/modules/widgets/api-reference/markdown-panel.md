import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# MarkdownPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="markdown-panel" />

`MarkdownPanel` renders a small built-in Markdown subset inside a widget panel.

## Import

```ts
import {MarkdownPanel, type MarkdownPanelProps} from '@deck.gl-community/widgets';
```

## Props

```ts
type MarkdownPanelProps = {
  id: string;
  title: string;
  markdown: string;
  disabled?: boolean;
  keepMounted?: boolean;
  className?: string;
  theme?: WidgetPanelTheme;
};
```


## Usage

Use `MarkdownPanel` when panel content is mostly descriptive text or links.

## Remarks

- Converts Markdown source into built-in rendered panel content without pulling in an external parser.
- Supports standard panel flags such as `disabled`, `keepMounted`, and theme overrides.
- Works well for lightweight help, status text, and example descriptions.
