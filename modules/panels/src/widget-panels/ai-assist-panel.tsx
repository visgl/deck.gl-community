/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {useEffect, useMemo, useRef, useState} from 'preact/hooks';

import {ensureFallbackStylesheet} from '../lib/panel-styles';
import {OPENASSISTANT_UI_STYLES} from '../lib/openassistant-ui-styles';
import {useEffectiveWidgetPanelThemeMode} from './widget-containers';

import type {WidgetPanel, WidgetPanelTheme} from './widget-containers';
import type {JSX} from 'preact';

type AIAssistFunctionTools = Record<string, unknown>;

type ReactRoot = {
  render: (element: unknown) => void;
  unmount: () => void;
};

type OpenAssistantRuntime = {
  createElement: (
    type: unknown,
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ) => unknown;
  createRoot: (element: Element | DocumentFragment) => ReactRoot;
  AiAssistant: unknown;
  ConfigPanel: unknown;
};

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
  functionTools?: AIAssistFunctionTools;
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

const OPENASSISTANT_STYLESHEET_ATTRIBUTE = 'data-deck-gl-community-openassistant-styles';
const OPENASSISTANT_OVERRIDES_ATTRIBUTE = 'data-deck-gl-community-openassistant-overrides';
const OPENASSISTANT_OVERRIDES = `
[data-ai-assist-panel] .order-1.overflow-y-auto {
  overflow-y: hidden;
}
`;

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
  const reactRootRef = useRef<ReactRoot | null>(null);
  const effectiveThemeMode = useEffectiveWidgetPanelThemeMode();
  const resolvedAssistantTheme = assistantTheme ?? effectiveThemeMode;
  const [loadError, setLoadError] = useState<Error | null>(null);
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

    ensureOpenAssistantStylesheet(hostElement.ownerDocument);

    let isActive = true;
    loadOpenAssistantRuntime()
      .then((runtime) => {
        if (!isActive) {
          return;
        }
        setLoadError(null);
        const reactRoot = reactRootRef.current ?? runtime.createRoot(hostElement);
        reactRootRef.current = reactRoot;
        reactRoot.render(
          runtime.createElement(AIAssistReactContent, {
            assistantConfig,
            assistantName,
            chatEndpoint,
            enableVoice,
            functionTools,
            handleConfigChange,
            instructions,
            resolvedAssistantTheme,
            runtime,
            showConfigPanel,
            version,
            voiceEndpoint,
            welcomeMessage
          })
        );
      })
      .catch((error: unknown) => {
        if (isActive) {
          setLoadError(error instanceof Error ? error : new Error(String(error)));
        }
      });

    return () => {
      isActive = false;
    };
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
      {loadError ? <div style={AI_ASSIST_ERROR_STYLE}>{getAIAssistLoadErrorMessage()}</div> : null}
      <div ref={hostElementRef} style={AI_ASSIST_HOST_STYLE} data-ai-assist-panel-host="" />
    </div>
  );
}

type AIAssistReactContentProps = {
  assistantConfig: AIAssistPanelConfig;
  assistantName: string;
  chatEndpoint: string;
  enableVoice: boolean;
  functionTools: AIAssistFunctionTools;
  handleConfigChange: (config: AIAssistPanelConfig) => void;
  instructions: string;
  resolvedAssistantTheme: 'light' | 'dark';
  runtime: OpenAssistantRuntime;
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
  runtime,
  showConfigPanel,
  version,
  voiceEndpoint,
  welcomeMessage
}: AIAssistReactContentProps): unknown {
  return runtime.createElement(runtime.AiAssistant, {
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
      ? [
          {
            direction: 'incoming',
            position: 'single',
            payload: runtime.createElement(
              'div',
              {style: {display: 'grid', gap: '16px'}},
              runtime.createElement(
                'p',
                {style: {margin: 0}},
                'Please select your preferred LLM model and use your API key to start the chat.'
              ),
              runtime.createElement(runtime.ConfigPanel, {
                initialConfig: getOpenAssistantConfig(assistantConfig),
                onConfigChange: handleConfigChange
              })
            )
          }
        ]
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

function getOpenAssistantConfig(config: AIAssistPanelConfig): Record<string, unknown> {
  return {
    isReady: false,
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    temperature: config.temperature,
    topP: config.topP,
    baseUrl: config.baseUrl ?? ''
  };
}

async function loadOpenAssistantRuntime(): Promise<OpenAssistantRuntime> {
  const [react, reactDomClient, openAssistantUi] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('@openassistant/ui')
  ]);

  return {
    createElement: react.createElement as OpenAssistantRuntime['createElement'],
    createRoot: reactDomClient.createRoot as OpenAssistantRuntime['createRoot'],
    AiAssistant: openAssistantUi.AiAssistant,
    ConfigPanel: openAssistantUi.ConfigPanel
  };
}

function getAIAssistLoadErrorMessage(): string {
  return [
    'AIAssistPanel requires optional peer dependencies to be installed:',
    '@openassistant/ui, @openassistant/core, react, and react-dom.'
  ].join(' ');
}

function ensureOpenAssistantStylesheet(document: Document): void {
  ensureFallbackStylesheet(document, {
    attribute: OPENASSISTANT_STYLESHEET_ATTRIBUTE,
    styles: OPENASSISTANT_UI_STYLES,
    isExistingRule: hasOpenAssistantRule,
    isExistingLink: hasOpenAssistantLink
  });
  ensureFallbackStylesheet(document, {
    attribute: OPENASSISTANT_OVERRIDES_ATTRIBUTE,
    styles: OPENASSISTANT_OVERRIDES
  });
}

function hasOpenAssistantRule(rule: CSSRule): boolean {
  return rule.cssText.includes('--heroui-') || rule.cssText.includes('.bg-content2');
}

function hasOpenAssistantLink(linkElement: HTMLLinkElement): boolean {
  return /@openassistant\/ui|openassistant-ui/.test(linkElement.href);
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

const AI_ASSIST_ERROR_STYLE: JSX.CSSProperties = {
  padding: '12px',
  fontSize: '13px',
  lineHeight: 1.4,
  color: 'var(--menu-text, currentColor)'
};
