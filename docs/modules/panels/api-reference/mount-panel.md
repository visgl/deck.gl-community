# mountPanel

Embed panel content in an existing application-owned DOM surface. Use `PanelManager` when
you need floating placement, a modal, or canvas chrome; use `mountPanel` when you already
own the outer UI and need only the content.

## Usage

```ts
import {MarkdownPanel, mountPanel} from '@deck.gl-community/panels';

const mounted = mountPanel(new MarkdownPanel({
  id: 'summary', title: 'Summary', markdown: 'Select an object.'
}), inspectorElement, {showTitle: true});

function showSelection(label: string) {
  mounted.setPanel(new MarkdownPanel({id: 'summary', title: 'Summary', markdown: label}));
}

// When the owning application is removed:
mounted.finalize();
```

`inspectorElement` is an existing DOM element. The mount inherits its panel theme and
adds one owned child; it does not reposition the parent or replace unrelated children.

## Signature

```ts
mountPanel(panel: Panel | null, parentElement: HTMLElement, options?: PanelMountOptions): PanelMount;

type PanelMountOptions = {
  showTitle?: boolean; // false by default
};
type PanelMount = {
  setPanel(panel: Panel | null): void;
  finalize(): void;
};
```

## Updates and ownership

`setPanel` replaces or refreshes the rendered content. Matching IDs preserve component state;
a changed ID remounts the subtree. `null` clears the content while keeping the mount available.
Update a mounted panel directly with its typed `setProps`, or pass a fresh definition through
`setPanel`. Both paths render current props; stable IDs retain local component state.

`finalize()` unmounts the content, runs its effect cleanup, and removes the owned child.
It is idempotent; subsequent `setPanel` calls are ignored. This helper renders panel content,
rather than invoking a standalone `PanelComponent` lifecycle. Do not use it to mount containers
or toolbar components.

For React-owned children and context, use the
[React content bridge](../../react/api-reference/panel.md#react-owned-content).
See [Panel Themes](./panel-theme.md) for host presets and custom variables.
