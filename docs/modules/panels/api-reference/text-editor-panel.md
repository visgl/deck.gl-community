import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# TextEditorPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`TextEditorPanel` lazily loads Monaco and renders one text editor inside a panel.

<PanelLiveExample highlight="text-editor-panel" />

## Usage

Use `TextEditorPanel` when a sidebar or modal needs inline document editing without building a custom editor shell.

```ts
import {TextEditorPanel, type TextEditorPanelProps} from '@deck.gl-community/panels';
```

## Props

```ts
type TextEditorPanelProps = PanelProps & {
  id?: string;
  title: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (nextValue: string) => void;
  language?: string;
  jsonSchema?: Record<string, unknown>;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  theme?: PanelTheme;
  lightMonacoTheme?: string;
  darkMonacoTheme?: string;
};
```

## Remarks

- Dynamically imports the runtime when the editor content first mounts. Constructing a definition or importing the panels package does not load Monaco.
- Supports controlled and uncontrolled text values.
- Applies JSON schema validation in `json` mode and swaps Monaco themes with the effective panel theme.

- Defaults to the `json` language identifier. Other Monaco identifiers pass through unchanged;
  the host registers any additional languages and language services.

## Controlled editor

```ts
let source = '{"visible":true}';
function createEditor() {
  return new TextEditorPanel({
    id: 'scene-source', title: 'Scene source', language: 'json', value: source,
    onValueChange: nextValue => {
      source = nextValue;
      renderPanels(); // Recreate the definitions and reconcile through PanelManager.
    }
  });
}
```

Here `renderPanels` is the application's update function; it places `createEditor()` in the
current container definition. For local text state, use `defaultValue` and omit `value`.

## Loading and workers

Both the editor runtime bridge and Monaco itself use dynamic `import()`. The first mounted
editor shows a loading indicator until the shared runtime resolves, or an error message if
loading fails. Subsequent editors share the runtime but own their editor models and cleanup.

An editor in an unmounted collapsed section does not trigger loading until its content
mounts. `keepMounted` retains collapsed content. `TabbedPanel` mounts all tab bodies and hides
inactive ones, so an editor in an inactive tab still loads Monaco. A live reference example
containing a mounted editor also loads it.

Use a bundler that supports dynamic imports and module workers. The default worker factory
resolves Monaco's editor and JSON workers via `new URL(..., import.meta.url)`. If your host
already configures `globalThis.MonacoEnvironment`, the panel respects it. Configure any custom
worker URLs before mounting an editor. Lazy loading affects network/runtime initialization;
`monaco-editor` remains an installed package dependency.

`PanelTheme` includes sleek presets and custom definitions; see [Panel Themes](./panel-theme.md).

Prefer the package ESM entry point to preserve dynamic loading. A downstream CommonJS
bundler may choose a different chunk strategy; installation size and emitted asynchronous
chunks are separate from the static dependency graph downloaded on initial load.
