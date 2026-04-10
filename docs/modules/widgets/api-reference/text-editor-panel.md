import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# TextEditorPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="text-editor-panel" />

`TextEditorPanel` lazily loads Monaco and renders one text editor inside a widget panel.

## Import

```ts
import {TextEditorPanel, type TextEditorPanelProps} from '@deck.gl-community/widgets';
```

## Props

```ts
type TextEditorPanelProps = {
  id: string;
  title: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (nextValue: string) => void;
  language?: 'json' | 'plaintext';
  jsonSchema?: Record<string, unknown>;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  theme?: WidgetPanelTheme;
  lightMonacoTheme?: string;
  darkMonacoTheme?: string;
};
```


## Usage

Use `TextEditorPanel` when a sidebar or modal needs inline JSON or plaintext editing without building a custom editor shell.

## Remarks

- Loads the Monaco runtime on demand instead of at initial widget mount.
- Supports controlled and uncontrolled text values.
- Applies JSON schema validation in `json` mode and swaps Monaco themes with the effective panel theme.
