import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# MarkdownPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`MarkdownPanel` renders a small built-in Markdown subset inside a panel.

<PanelLiveExample highlight="markdown-panel" />

## Usage

Use `MarkdownPanel` when panel content is mostly descriptive text or links.

```ts
import {MarkdownPanel, type MarkdownPanelProps} from '@deck.gl-community/panels';
```

## Props

```ts
type MarkdownPanelProps = PanelProps & {
  id?: string;
  title: string;
  markdown: string;
  disabled?: boolean;
  keepMounted?: boolean;
  className?: string;
  theme?: PanelTheme;
};
```

## Remarks

- Converts Markdown source into built-in rendered panel content without pulling in an external parser.
- Supports standard panel flags such as `disabled`, `keepMounted`, and theme overrides.
- Works well for lightweight help, status text, and example descriptions.

`PanelTheme` is shared across panels; see [Panel Themes](./panel-theme.md) for presets and custom definitions.
