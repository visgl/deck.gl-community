import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# AIAssistPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/experimental-orange.svg?style=flat-square" alt="experimental" />
</p>

<PanelLiveExample highlight="ai-assist-panel" size="tall" />

`AIAssistPanel` renders the OpenAssistant chat UI inside a panel.

## Usage

Use `AIAssistPanel` when a sidebar, modal, full-screen workspace, or deck-facing panel widget needs an AI assistant chat surface.

Install the panel package first:

```bash
yarn add @deck.gl-community/panels
```

`AIAssistPanel` lazy-loads its AI runtime. Install these optional peer dependencies only in applications that render `AIAssistPanel`:

```bash
yarn add @openassistant/ui@^0.5.20 @openassistant/core@0.5.20 react react-dom
```

This keeps the base `@deck.gl-community/panels` install free of OpenAssistant, React, and AI SDK packages. Applications that do not construct `AIAssistPanel` do not need any of the dependencies below.

| Dependency                        | Required when                 | Notes                                                                   |
| --------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `@openassistant/ui`               | Rendering `AIAssistPanel`     | Provides the chat UI and config panel.                                  |
| `@openassistant/core`             | Rendering `AIAssistPanel`     | Provides assistant runtime, models, and endpoint integration.           |
| `react`, `react-dom`              | Rendering `AIAssistPanel`     | OpenAssistant UI is React-based; other panels remain Preact/native DOM. |
| `@ai-sdk/openai`, `openai`, `zod` | Using OpenAI provider support | Needed by OpenAssistant's default OpenAI provider path.                 |
| Other `@ai-sdk/*` providers       | Exposing non-OpenAI providers | Install only the providers your app lets users select.                  |

OpenAssistant's default OpenAI provider also needs its AI SDK/OpenAI runtime packages available to the bundler:

```bash
yarn add @ai-sdk/openai@^1.3.21 @ai-sdk/provider-utils@2.2.8 openai@^4.93.0 zod@^3.25.76
```

If your app exposes the other providers from OpenAssistant's config panel, install their provider packages as well:

```bash
yarn add @ai-sdk/anthropic@1.1.14 @ai-sdk/google@1.1.8 @ai-sdk/deepseek@0.1.8 @ai-sdk/xai@1.1.8 @ai-sdk/amazon-bedrock@1.1.6 ollama-ai-provider-v2@^0.0.6
```

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
  functionTools?: Record<string, unknown>;
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

- Shows the built-in model config panel by default.
- Does not store or provide API keys; applications should supply keys or endpoints at runtime.
