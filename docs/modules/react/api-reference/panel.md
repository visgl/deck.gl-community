import PanelContentBridgeDemo from '@site/src/components/docs/panel-content-bridge-demo';
import * as React from 'react';
import {Panel as PanelHost} from '@deck.gl-community/react';
import {ColumnPanel, MarkdownPanel} from '@deck.gl-community/panels';

# Panel

![From v9.3](https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square)

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
  theme?: PanelThemePreset | PanelThemeDefinition | 'inherit';
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

## Presets and custom themes

The `theme` prop accepts the panel presets (`light`, `dark`, `sleek-light`, `sleek-dark`)
or a `PanelThemeDefinition`. It takes precedence over the existing `themeMode` prop.
Set `theme="inherit"` to inherit application CSS variables. Explicit per-panel themes
still apply within a composition. Frame padding and corner radius follow the preset.

```tsx
<Panel panel={summaryPanel} theme={{
  base: 'sleek-dark',
  variables: {'--button-text': '#ddffee', '--panel-accent-color': '#16856b'}
}} />
```

## React-owned content

Use `ReactPanel` for a direct surface containing React children. Context, hooks, events,
and state belong to the caller's React tree; the bridge does not create another React root.
`title` is required, `id` is optional, and the host accepts the same theme/frame props as `Panel`.

```tsx
import {ReactPanel} from '@deck.gl-community/react';

<ReactPanel title="Controls" theme="sleek-light">
  <ApplicationControls />
</ReactPanel>
```

For tabs, columns, accordions, or manager-owned containers, `useReactPanel` returns a
panel definition and a React portal. Include the definition in your composition and
render the portal in your React tree, beneath the context providers your controls need.

```tsx
const {panel, portal} = useReactPanel({
  id: 'controls', title: 'Controls', children: <ApplicationControls />,
  keepMounted: true
});
const tabs = useMemo(() => new TabbedPanel({panels: [panel, notesPanel]}), [panel]);
return <ApplicationContext.Provider value={state}>
  <Panel panel={tabs} theme="inherit" />
  {portal}
</ApplicationContext.Provider>;
```

The hook also accepts panel `theme`, `disabled`, and `keepMounted` options. Changing
children updates the portal without rebuilding the panel. Inactive content follows the
composition's normal mount policy; use `keepMounted` when local state must survive hiding.
Unmounting cleans up the portal. React StrictMode is supported.

<PanelContentBridgeDemo />
