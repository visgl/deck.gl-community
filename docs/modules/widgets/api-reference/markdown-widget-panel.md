# MarkdownWidgetPanel

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`MarkdownWidgetPanel` renders a small built-in Markdown subset inside a widget panel.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {MarkdownWidgetPanel, type MarkdownWidgetPanelProps} from '@deck.gl-community/widgets';
```

## Props

```ts
type MarkdownWidgetPanelProps = {
  id: string;
  title: string;
  markdown: string;
  disabled?: boolean;
  keepMounted?: boolean;
  className?: string;
  theme?: WidgetPanelTheme;
};
```

## Behavior

- Converts Markdown source into built-in rendered panel content without pulling in an external parser.
- Supports standard panel flags such as `disabled`, `keepMounted`, and theme overrides.
- Works well for lightweight help, status text, and example descriptions.

## Usage

Use `MarkdownWidgetPanel` when panel content is mostly descriptive text or links.
