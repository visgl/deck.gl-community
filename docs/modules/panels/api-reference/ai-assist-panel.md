import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# AIAssistPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
</p>

<PanelLiveExample highlight="ai-assist-panel" size="tall" />

`AIAssistPanel` renders the OpenAssistant chat UI inside a panel.

## Usage

Use `AIAssistPanel` when a sidebar, modal, full-screen workspace, or deck-facing panel widget needs an AI assistant chat surface.

```ts
import {AIAssistPanel, type AIAssistPanelProps} from '@deck.gl-community/panels';

const panel = new AIAssistPanel({
  id: 'assistant',
  title: 'AI Assist',
  showConfigPanel: true,
  heightPx: 640
});
```

## Props

```ts
type AIAssistPanelProps = {
  id?: string;
  title?: string;
  className?: string;
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
  widthPx?: number;
  heightPx?: number;
  assistantTheme?: 'light' | 'dark';
  showConfigPanel?: boolean;
  assistantName?: string;
  apiKey?: string;
  version?: string;
  modelProvider?: string;
  model?: string;
  welcomeMessage?: string;
  instructions?: string;
  functionTools?: UseAssistantProps['tools'];
  temperature?: number;
  topP?: number;
  baseUrl?: string;
  chatEndpoint?: string;
  voiceEndpoint?: string;
  enableVoice?: boolean;
  onConfigChange?: (config: AIAssistPanelConfig) => void;
};
```

## Remarks

- Uses OpenAssistant UI internally and does not import deck.gl.
- Shows the built-in model config panel by default.
- Does not store or provide API keys; applications should supply keys or endpoints at runtime.
