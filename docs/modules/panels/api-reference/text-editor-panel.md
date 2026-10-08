import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# TextEditorPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<PanelLiveExample highlight="text-editor-panel" />

`TextEditorPanel` lazily loads Monaco and renders one text editor inside a panel.

## Usage

Use `TextEditorPanel` when a sidebar or modal needs inline document editing without building a custom editor shell.

```ts
import {TextEditorPanel, type TextEditorPanelProps} from '@deck.gl-community/panels';
```

## Props

```ts
type TextEditorPanelProps = {
  id: string;
  title: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (nextValue: string) => void;
  language?: string;
  jsonSchema?: Record<string, unknown>;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
  lightMonacoTheme?: string;
  darkMonacoTheme?: string;
};
```

## Remarks

- Loads the Monaco runtime on demand instead of at initial panel mount.
- Supports controlled and uncontrolled text values.
- Applies JSON schema validation in `json` mode and swaps Monaco themes with the effective panel theme.

- Defaults to the `json` language identifier. Other Monaco identifiers pass through unchanged;
  the host registers any additional languages and language services.
