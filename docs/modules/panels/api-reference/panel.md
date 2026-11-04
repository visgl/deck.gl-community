import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# Panel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
</p>

`Panel` is the base class for titled panel content. It extends
`PanelComponent`, so a concrete panel can be mounted directly or hosted by a
`PanelContainer`.

<PanelLiveExample highlight="markdown-panel" />

## Usage

```ts
import {MarkdownPanel, PanelManager} from '@deck.gl-community/panels';

const panel = new MarkdownPanel({
  id: 'summary',
  title: 'Summary',
  markdown: 'A concrete Panel can be mounted directly.'
});

const panelManager = new PanelManager({
  parentElement: document.getElementById('app') as HTMLElement
});

panelManager.setProps({components: [panel]});
```

## Props

```ts
type PanelProps = PanelComponentProps & {
  id?: string;
  title?: string;
  content?: ComponentChildren;
  theme?: PanelTheme;
  disabled?: boolean;
  keepMounted?: boolean;
};
```

## Remarks

- Leaf and composite panel classes extend `Panel`.
- Direct mounting renders the panel's themed `content` through the shared
  `PanelComponent` lifecycle.
- Use a real `PanelContainer` when the content needs box, modal, sidebar, or
  full-screen chrome.

## Typed props and rendering

`Panel<PropsT extends PanelProps = PanelProps>` is generic in its public props. Every specialized
class uses the same props type for construction and `setProps(Partial<PropsT>)`. The setter
merges values and refreshes mounted surfaces, including nested compositions and embedded mounts.

```ts
const summary = new MarkdownPanel({id: 'summary', title: 'Summary', markdown: 'Ready'});
summary.setProps({markdown: 'Selected **Station A**', theme: 'sleek-dark'});
```

Shared metadata (`id`, `title`, `theme`, `disabled`, `keepMounted`) is read from current props.
The base defaults are `id: 'panel'`, `title: 'Panel'`, `theme: 'inherit'`, `disabled: false`,
and `keepMounted: false`; concrete classes can define more specific defaults. Concrete panel classes provide their own default IDs. Override the ID when multiple instances
of the same kind share a composition or manager, just as with widgets and layers. Explicit `undefined` restores a
declared default; controlled props with no default remain `undefined`. Metadata accessors and `content`
are read-only: update through props rather than assigning implementation fields.

## Custom panel class

Override `renderContent()` to describe the body from current props. Keep component types
stable across renders so their hook state, input elements, and editor instances survive updates.

```tsx
/** @jsxImportSource preact */
import {Panel, type PanelProps} from '@deck.gl-community/panels';

type SelectionProps = PanelProps & {label: string};
class SelectionPanel extends Panel<SelectionProps> {
  override renderContent() {
    return <div>{this.props.label}</div>;
  }
}
const selection = new SelectionPanel({id: 'selection', title: 'Selection', label: 'None'});
selection.setProps({label: 'Station A'});
```

The base implementation renders `props.content` for simple custom content definitions.
Composite subclasses also override `getChildPanels()` to return their current child definitions;
this lets parent layouts observe nested heading, disabled-state, and child-list updates.
Application DOM integrations should use [CustomPanel](./custom-panel.md), whose render callback
can return cleanup. That callback reruns when its identity changes, not for unrelated metadata.

Use [Panel Themes](./panel-theme.md) for presets and custom definitions, and
[state and updates](../developer-guide/using-panels.md#state-and-updates) for reconciliation.
