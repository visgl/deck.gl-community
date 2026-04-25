import * as React from 'react';
import {WidgetPanel as ReactWidgetPanel} from '@deck.gl-community/react';
import {ColumnPanel, MarkdownPanel} from '@deck.gl-community/panels';

# WidgetPanel

`WidgetPanel` renders a `@deck.gl-community/panels` panel or container inside a React tree.

## Import

```tsx
import {WidgetPanel, type WidgetPanelProps} from '@deck.gl-community/react';
```

## Props

```ts
type WidgetPanelProps =
  | {
      panel: WidgetPanelDefinition;
      container?: never;
      themeMode?: 'inherit' | 'light' | 'dark';
      className?: string;
      style?: CSSProperties;
      framed?: boolean;
    }
  | {
      container: WidgetContainer;
      panel?: never;
      themeMode?: 'inherit' | 'light' | 'dark';
      className?: string;
      style?: CSSProperties;
      framed?: boolean;
    };
```

## Demo

The component is intended for React surfaces such as Docusaurus MDX. This page is rendering one directly:

<ReactWidgetPanel
themeMode="light"
container={{
    kind: 'panel',
    props: {
      panel: new ColumnPanel({
        id: 'mdx-react-panel',
        title: 'MDX',
        panels: {
          intro: new MarkdownPanel({
            id: 'intro',
            title: 'React host',
            markdown:
              'This panel is rendered in MDX through `@deck.gl-community/react`.'
          }),
          notes: new MarkdownPanel({
            id: 'notes',
            title: 'Why this exists',
            markdown:
              'Use it when you want widget panels in docs, React apps, or other component trees without creating a Deck instance.'
          })
        }
      })
    }
  }}
style={{maxWidth: 720, marginBottom: 24}}
/>

## Usage

```tsx
import {WidgetPanel} from '@deck.gl-community/react';
import {MarkdownPanel} from '@deck.gl-community/panels';

export function DocsCallout() {
  return (
    <WidgetPanel
      panel={
        new MarkdownPanel({
          id: 'summary',
          title: 'Summary',
          markdown: 'Rendered inside React without a WidgetHost.'
        })
      }
      themeMode="light"
    />
  );
}
```

## Remarks

- Accepts either one `WidgetPanel` definition or a full `WidgetContainer`.
- Uses the panels module's existing Preact renderer internally, so existing panel implementations keep working unchanged.
- Adds `deck-widget-container` to its host so panel theme inference behaves the same way it does in widget hosts.
- Supports `light`, `dark`, and `inherit` theme modes.
- `framed={false}` is useful when the surrounding React layout already provides the outer surface.
