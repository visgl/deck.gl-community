/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {AiAssistant, ConfigPanel} from '@openassistant/ui';

import {useEffectiveWidgetPanelThemeMode} from './widget-containers';

import type {MessageModel, UseAssistantProps} from '@openassistant/core';
import type {AiAssistantConfig} from '@openassistant/ui';
import type {Root} from 'react-dom/client';
import type {WidgetPanel, WidgetPanelTheme} from './widget-containers';
import type {JSX} from 'preact';

import '@openassistant/ui/dist/index.css';

/** Model configuration edited by the built-in OpenAssistant config panel. */
export type AIAssistPanelConfig = {
  /** Model provider identifier, for example `openai`. */
  provider: string;
  /** Model identifier, for example `gpt-4o`. */
  model: string;
  /** API key used by the assistant. */
  apiKey: string;
  /** Sampling temperature. */
  temperature: number;
  /** Nucleus sampling top-p value. */
  topP: number;
  /** Optional API base URL. */
  baseUrl?: string;
};

/** Configuration for {@link AIAssistPanel}. */
export type AIAssistPanelProps = {
  /** Stable panel id used by parent containers. */
  id?: string;
  /** Visible heading text for the panel. */
  title?: string;
  /** Optional class name applied to the outer panel content wrapper. */
  className?: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: WidgetPanelTheme;
  /** Optional fixed content width in pixels. */
  widthPx?: number;
  /** Fixed content height in pixels. Defaults to 800. */
  heightPx?: number;
  /** Explicit assistant theme. Defaults to the effective panel theme. */
  assistantTheme?: 'light' | 'dark';
  /** Whether to show the OpenAssistant model config panel in the chat history. */
  showConfigPanel?: boolean;
  /** The assistant display name. */
  assistantName?: string;
  /** API key passed to OpenAssistant. */
  apiKey?: string;
  /** Assistant version. */
  version?: string;
  /** Model provider passed to OpenAssistant. */
  modelProvider?: string;
  /** Model passed to OpenAssistant. */
  model?: string;
  /** Initial welcome message. */
  welcomeMessage?: string;
  /** System instructions passed to OpenAssistant. */
  instructions?: string;
  /** Function tools passed to OpenAssistant. */
  functionTools?: UseAssistantProps['tools'];
  /** Sampling temperature. */
  temperature?: number;
  /** Nucleus sampling top-p value. */
  topP?: number;
  /** Optional API base URL. */
  baseUrl?: string;
  /** Optional chat endpoint for a caller-owned chat service. */
  chatEndpoint?: string;
  /** Optional voice endpoint for a caller-owned voice service. */
  voiceEndpoint?: string;
  /** Whether voice input is enabled. Defaults to true. */
  enableVoice?: boolean;
  /** Called when the OpenAssistant config panel changes model settings. */
  onConfigChange?: (config: AIAssistPanelConfig) => void;
};

type ResolvedAIAssistPanelProps = Required<
  Pick<
    AIAssistPanelProps,
    | 'id'
    | 'title'
    | 'heightPx'
    | 'showConfigPanel'
    | 'assistantName'
    | 'apiKey'
    | 'version'
    | 'modelProvider'
    | 'model'
    | 'welcomeMessage'
    | 'instructions'
    | 'temperature'
    | 'topP'
    | 'baseUrl'
    | 'chatEndpoint'
    | 'voiceEndpoint'
    | 'enableVoice'
  >
> &
  Pick<
    AIAssistPanelProps,
    'className' | 'theme' | 'widthPx' | 'assistantTheme' | 'functionTools' | 'onConfigChange'
  >;

const DEFAULT_AI_ASSIST_PANEL_PROPS = {
  id: 'ai-assist',
  title: 'AI Assist',
  heightPx: 800,
  showConfigPanel: true,
  assistantName: 'My Assistant',
  apiKey: '',
  version: 'v1',
  modelProvider: 'openai',
  model: 'gpt-4o',
  welcomeMessage: 'Hello, how can I help you today?',
  instructions: '',
  temperature: 0.5,
  topP: 1.0,
  baseUrl: '',
  chatEndpoint: '',
  voiceEndpoint: '',
  enableVoice: true
} satisfies Omit<
  ResolvedAIAssistPanelProps,
  'className' | 'theme' | 'widthPx' | 'assistantTheme' | 'functionTools' | 'onConfigChange'
>;

/** Widget panel that renders the OpenAssistant chat UI inside panel containers. */
export class AIAssistPanel implements WidgetPanel {
  /** Stable panel id used by parent containers. */
  id: string;
  /** Visible heading text for the panel. */
  title: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: WidgetPanelTheme;
  /** Rendered Preact content for this panel. */
  content: JSX.Element;

  /** Creates an AI assist panel. */
  constructor(props: AIAssistPanelProps = {}) {
    const resolvedProps = resolveAIAssistPanelProps(props);
    this.id = resolvedProps.id;
    this.title = resolvedProps.title;
    this.theme = resolvedProps.theme ?? 'inherit';
    this.content = <AIAssistPanelContent {...resolvedProps} />;
  }
}

function resolveAIAssistPanelProps(props: AIAssistPanelProps): ResolvedAIAssistPanelProps {
  return {
    ...DEFAULT_AI_ASSIST_PANEL_PROPS,
    ...getDefinedProps(props)
  } as ResolvedAIAssistPanelProps;
}

function getDefinedProps(props: AIAssistPanelProps): Partial<AIAssistPanelProps> {
  return Object.fromEntries(
    Object.entries(props).filter((entry) => entry[1] !== undefined)
  ) as Partial<AIAssistPanelProps>;
}

function AIAssistPanelContent(props: ResolvedAIAssistPanelProps): JSX.Element {
  const {
    className,
    widthPx,
    heightPx,
    assistantTheme,
    showConfigPanel,
    assistantName,
    version,
    welcomeMessage,
    instructions,
    functionTools = {},
    chatEndpoint,
    voiceEndpoint,
    enableVoice,
    onConfigChange
  } = props;
  const hostElementRef = useRef<HTMLDivElement | null>(null);
  const reactRootRef = useRef<Root | null>(null);
  const effectiveThemeMode = useEffectiveWidgetPanelThemeMode();
  const resolvedAssistantTheme = assistantTheme ?? effectiveThemeMode;
  const [assistantConfig, setAssistantConfig] = useState<AIAssistPanelConfig>(() =>
    getInitialAssistantConfig(props)
  );

  const handleConfigChange = useMemo(
    () => (config: AIAssistPanelConfig) => {
      const nextConfig = {
        provider: config.provider,
        model: config.model,
        apiKey: config.apiKey,
        temperature: config.temperature,
        topP: config.topP,
        baseUrl: config.baseUrl ?? ''
      };
      setAssistantConfig(nextConfig);
      onConfigChange?.(nextConfig);
    },
    [onConfigChange]
  );

  useEffect(() => {
    const hostElement = hostElementRef.current;
    if (!hostElement) {
      return undefined;
    }

    const reactRoot = reactRootRef.current ?? createRoot(hostElement);
    reactRootRef.current = reactRoot;
    reactRoot.render(
      React.createElement(AIAssistReactContent, {
        assistantConfig,
        assistantName,
        chatEndpoint,
        enableVoice,
        functionTools,
        handleConfigChange,
        instructions,
        resolvedAssistantTheme,
        showConfigPanel,
        version,
        voiceEndpoint,
        welcomeMessage
      })
    );

    return undefined;
  }, [
    assistantConfig,
    assistantName,
    chatEndpoint,
    enableVoice,
    functionTools,
    handleConfigChange,
    instructions,
    resolvedAssistantTheme,
    showConfigPanel,
    version,
    voiceEndpoint,
    welcomeMessage
  ]);

  useEffect(() => {
    return () => {
      reactRootRef.current?.unmount();
      reactRootRef.current = null;
    };
  }, []);

  return (
    <div
      className={className}
      style={{
        ...AI_ASSIST_PANEL_STYLE,
        width: widthPx ? `${widthPx}px` : '100%',
        height: `${heightPx}px`
      }}
      data-ai-assist-panel=""
      onPointerDown={stopEventPropagation}
      onPointerMove={stopEventPropagation}
      onMouseDown={stopEventPropagation}
      onMouseMove={stopEventPropagation}
      onClick={stopEventPropagation}
      onWheel={stopEventPropagation}
      onTouchStart={stopEventPropagation}
      onTouchMove={stopEventPropagation}
    >
      <div ref={hostElementRef} style={AI_ASSIST_HOST_STYLE} data-ai-assist-panel-host="" />
    </div>
  );
}

type AIAssistReactContentProps = {
  assistantConfig: AIAssistPanelConfig;
  assistantName: string;
  chatEndpoint: string;
  enableVoice: boolean;
  functionTools: UseAssistantProps['tools'];
  handleConfigChange: (config: AIAssistPanelConfig) => void;
  instructions: string;
  resolvedAssistantTheme: 'light' | 'dark';
  showConfigPanel: boolean;
  version: string;
  voiceEndpoint: string;
  welcomeMessage: string;
};

function AIAssistReactContent({
  assistantConfig,
  assistantName,
  chatEndpoint,
  enableVoice,
  functionTools,
  handleConfigChange,
  instructions,
  resolvedAssistantTheme,
  showConfigPanel,
  version,
  voiceEndpoint,
  welcomeMessage
}: AIAssistReactContentProps): React.ReactElement {
  return React.createElement(AiAssistant, {
    name: assistantName,
    apiKey: assistantConfig.apiKey,
    version,
    modelProvider: assistantConfig.provider,
    model: assistantConfig.model,
    welcomeMessage,
    instructions,
    tools: functionTools,
    temperature: assistantConfig.temperature,
    topP: assistantConfig.topP,
    baseUrl: assistantConfig.baseUrl ?? '',
    chatEndpoint,
    enableVoice,
    voiceEndpoint,
    theme: resolvedAssistantTheme,
    initialMessages: showConfigPanel
      ? ([
          {
            direction: 'incoming',
            position: 'single',
            payload: React.createElement(
              'div',
              {style: {display: 'grid', gap: '16px'}},
              React.createElement(
                'p',
                {style: {margin: 0}},
                'Please select your preferred LLM model and use your API key to start the chat.'
              ),
              React.createElement(ConfigPanel, {
                initialConfig: getOpenAssistantConfig(assistantConfig),
                onConfigChange: handleConfigChange
              } as React.ComponentProps<typeof ConfigPanel>)
            )
          }
        ] satisfies MessageModel[])
      : []
  });
}

function getInitialAssistantConfig(props: ResolvedAIAssistPanelProps): AIAssistPanelConfig {
  return {
    provider: props.modelProvider,
    model: props.model,
    apiKey: props.apiKey,
    temperature: props.temperature,
    topP: props.topP,
    baseUrl: props.baseUrl
  };
}

function getOpenAssistantConfig(config: AIAssistPanelConfig): AiAssistantConfig {
  return {
    isReady: false,
    provider: config.provider as AiAssistantConfig['provider'],
    model: config.model,
    apiKey: config.apiKey,
    temperature: config.temperature,
    topP: config.topP,
    baseUrl: config.baseUrl ?? ''
  };
}

function stopEventPropagation(event: Event): void {
  event.stopPropagation();
  if (
    typeof (event as {stopImmediatePropagation?: () => void}).stopImmediatePropagation ===
    'function'
  ) {
    (event as {stopImmediatePropagation?: () => void}).stopImmediatePropagation?.();
  }
}

const AI_ASSIST_PANEL_STYLE: JSX.CSSProperties = {
  minWidth: 0,
  maxWidth: '100%',
  overflow: 'hidden',
  borderRadius: '6px',
  background: 'var(--menu-background, #fff)',
  color: 'var(--menu-text, currentColor)'
};

const AI_ASSIST_HOST_STYLE: JSX.CSSProperties = {
  width: '100%',
  height: '100%',
  minWidth: 0
};
