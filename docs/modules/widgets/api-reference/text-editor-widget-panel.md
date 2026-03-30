# TextEditorWidgetPanel

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`TextEditorWidgetPanel` lazily loads Monaco and renders one text editor inside a widget panel.

It is exported from `@deck.gl-community/widgets`.

## Import

```ts
import {TextEditorWidgetPanel, type TextEditorWidgetPanelProps} from '@deck.gl-community/widgets';
```

## Props

```ts
type TextEditorWidgetPanelProps = {
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

## Behavior

- Loads the Monaco runtime on demand instead of at initial widget mount.
- Supports controlled and uncontrolled text values.
- Applies JSON schema validation in `json` mode and swaps Monaco themes with the effective panel theme.

## Usage

Use `TextEditorWidgetPanel` when a sidebar or modal needs inline JSON or plaintext editing without building a custom editor shell.
