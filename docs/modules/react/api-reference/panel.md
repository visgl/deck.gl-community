import * as React from 'react';
import {Panel as PanelHost} from '@deck.gl-community/react';
import {ColumnPanel, MarkdownPanel} from '@deck.gl-community/panels';

# Panel

`Panel` renders a `@deck.gl-community/panels` panel definition inside a React tree.

## Import

```tsx
import {Panel, type PanelProps} from '@deck.gl-community/react';
```

## Props

```ts
type PanelProps = {
  panel: PanelDefinition;
  themeMode?: 'inherit' | 'light' | 'dark';
  className?: string;
  style?: CSSProperties;
  framed?: boolean;
};
```

## Demo

The component is intended for React surfaces such as Docusaurus MDX. This page is rendering one directly:

<PanelHost
themeMode="light"
panel={
  new ColumnPanel({
    id: 'mdx-react-panel',
    title: 'MDX',
    panels: [
      new MarkdownPanel({
        id: 'intro',
        title: 'React host',
        markdown:
          'This panel is rendered in MDX through `@deck.gl-community/react`.'
      }),
      new MarkdownPanel({
        id: 'notes',
        title: 'Why this exists',
        markdown:
          'Use it when you want panels in docs, React apps, or other component trees without creating a Deck instance.'
      })
    ]
  })
}
style={{maxWidth: 720, marginBottom: 24}}
/>

## Usage

```tsx
import {Panel} from '@deck.gl-community/react';
import {MarkdownPanel} from '@deck.gl-community/panels';

const summaryPanel = new MarkdownPanel({
  id: 'summary',
  title: 'Summary',
  markdown: 'Rendered inside React without a PanelManager.'
});

export function DocsCallout() {
  return <Panel panel={summaryPanel} themeMode="light" />;
}
```

## Arrow panels in MDX

Create Arrow inspection panels from `@deck.gl-community/panels` and render them
with `Panel` in MDX.

```tsx
import {Panel} from '@deck.gl-community/react';
import {ArrowTablePanel} from '@deck.gl-community/panels';

const tablePanel = new ArrowTablePanel({
  id: 'arrow-table',
  title: 'Arrow Table',
  table,
  maxRows: 50,
  showRowIndex: true
});

export function ArrowTableDocsPanel() {
  return <Panel panel={tablePanel} themeMode="light" />;
}
```

## Remarks

- Accepts one reusable panel definition from `@deck.gl-community/panels`.
- Uses the panels module's existing Preact renderer internally, so existing panel implementations keep working unchanged.
- Supports `light`, `dark`, and `inherit` theme modes using the panels module's theme variables.
- `framed={false}` is useful when the surrounding React layout already provides the outer surface.
