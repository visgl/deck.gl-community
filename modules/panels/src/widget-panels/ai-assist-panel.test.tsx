/** @jsxImportSource preact */
import {h, render} from 'preact';
import * as React from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {WidgetContainerRenderer, asPanelContainer} from './widget-containers';
import {AIAssistPanel} from './ai-assist-panel';

const OPENASSISTANT_STYLES_SELECTOR = 'style[data-deck-gl-community-openassistant-styles]';
const OPENASSISTANT_OVERRIDES_SELECTOR = 'style[data-deck-gl-community-openassistant-overrides]';

const reactRootHarness = vi.hoisted(() => {
  const createRoot = vi.fn();
  const renderRoot = vi.fn();
  const unmountRoot = vi.fn();

  function reset() {
    createRoot.mockReset();
    renderRoot.mockReset();
    unmountRoot.mockReset();
    createRoot.mockReturnValue({
      render: renderRoot,
      unmount: unmountRoot
    });
  }

  return {
    createRoot,
    renderRoot,
    reset,
    unmountRoot
  };
});

const openAssistantHarness = vi.hoisted(() => ({
  AiAssistant: vi.fn(() => null),
  ConfigPanel: vi.fn(() => null)
}));

vi.mock('react-dom/client', () => ({
  createRoot: reactRootHarness.createRoot
}));

vi.mock('@openassistant/ui', () => ({
  AiAssistant: openAssistantHarness.AiAssistant,
  ConfigPanel: openAssistantHarness.ConfigPanel
}));

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

async function waitForReactRender(previousRenderCount = 0): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (reactRootHarness.renderRoot.mock.calls.length > previousRenderCount) {
      return;
    }
    await flushEffects();
  }

  throw new Error('Expected AI assist panel to render into its React root.');
}

function renderPanel(panel: AIAssistPanel): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(panel.content, root);
  return root;
}

function getLastReactElement(): React.ReactElement {
  const element = reactRootHarness.renderRoot.mock.lastCall?.[0];
  if (!React.isValidElement(element)) {
    throw new Error('Expected React root to render a valid element.');
  }
  return element;
}

function renderAIAssistReactContent(): React.ReactElement {
  const element = getLastReactElement();
  const renderComponent = element.type as (props: unknown) => React.ReactNode;
  const renderedElement = renderComponent(element.props);
  if (!React.isValidElement(renderedElement)) {
    throw new Error('Expected AI assist React content to render a valid element.');
  }
  return renderedElement;
}

afterEach(() => {
  for (const rootElement of [...document.body.children]) {
    render(null, rootElement as HTMLElement);
  }
  document.body.innerHTML = '';
  document.head.querySelectorAll(OPENASSISTANT_STYLES_SELECTOR).forEach((element) => {
    element.remove();
  });
  document.head.querySelectorAll(OPENASSISTANT_OVERRIDES_SELECTOR).forEach((element) => {
    element.remove();
  });
});

beforeEach(() => {
  reactRootHarness.reset();
  openAssistantHarness.AiAssistant.mockClear();
  openAssistantHarness.ConfigPanel.mockClear();
});

describe('AIAssistPanel', () => {
  it('creates a widget panel with stable id, title, theme, and content', () => {
    const panel = new AIAssistPanel({
      id: 'assistant',
      title: 'Assistant',
      theme: 'dark'
    });

    expect(panel.id).toBe('assistant');
    expect(panel.title).toBe('Assistant');
    expect(panel.theme).toBe('dark');
    expect(panel.content).toBeTruthy();
  });

  it('renders OpenAssistant with upstream-compatible default assistant props', async () => {
    const root = renderPanel(new AIAssistPanel());
    await waitForReactRender();

    expect(root.querySelector('[data-ai-assist-panel]')).toBeTruthy();
    expect(document.head.querySelector(OPENASSISTANT_STYLES_SELECTOR)?.textContent).toContain(
      '--heroui-'
    );
    expect(document.head.querySelector(OPENASSISTANT_OVERRIDES_SELECTOR)?.textContent).toContain(
      '.order-1.overflow-y-auto'
    );
    expect(reactRootHarness.createRoot).toHaveBeenCalledWith(
      root.querySelector('[data-ai-assist-panel-host]')
    );

    const assistantElement = renderAIAssistReactContent();
    expect(assistantElement.type).toBe(openAssistantHarness.AiAssistant);
    expect(assistantElement.props).toMatchObject({
      name: 'My Assistant',
      apiKey: '',
      version: 'v1',
      modelProvider: 'openai',
      model: 'gpt-4o',
      welcomeMessage: 'Hello, how can I help you today?',
      instructions: '',
      temperature: 0.5,
      topP: 1,
      baseUrl: '',
      chatEndpoint: '',
      enableVoice: true,
      voiceEndpoint: '',
      theme: 'light'
    });
  });

  it('passes a built-in config panel message when showConfigPanel is true', async () => {
    renderPanel(
      new AIAssistPanel({
        welcomeMessage: 'Welcome'
      })
    );
    await waitForReactRender();

    const assistantElement = renderAIAssistReactContent();
    expect(assistantElement.props.welcomeMessage).toBe('Welcome');
    expect(assistantElement.props.initialMessages).toHaveLength(1);
    expect(assistantElement.props.initialMessages[0]).toMatchObject({
      direction: 'incoming',
      position: 'single'
    });
    expect(
      assistantElement.props.initialMessages[0].payload.props.children[0].props.children
    ).toContain('preferred LLM model');

    const configPanelElement = assistantElement.props.initialMessages[0].payload.props.children[1];
    expect(configPanelElement.type).toBe(openAssistantHarness.ConfigPanel);
    expect(configPanelElement.props.initialConfig).toMatchObject({
      isReady: false,
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: '',
      temperature: 0.5,
      topP: 1,
      baseUrl: ''
    });
  });

  it('updates assistant config and emits onConfigChange from the built-in config panel', async () => {
    const handleConfigChange = vi.fn();
    renderPanel(new AIAssistPanel({onConfigChange: handleConfigChange}));
    await waitForReactRender();

    let assistantElement = renderAIAssistReactContent();
    const configPanelElement = assistantElement.props.initialMessages[0].payload.props.children[1];
    const previousRenderCount = reactRootHarness.renderRoot.mock.calls.length;

    configPanelElement.props.onConfigChange({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      apiKey: 'test-key',
      temperature: 0.2,
      topP: 0.9,
      baseUrl: 'https://example.test'
    });
    await waitForReactRender(previousRenderCount);

    expect(handleConfigChange).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      apiKey: 'test-key',
      temperature: 0.2,
      topP: 0.9,
      baseUrl: 'https://example.test'
    });

    assistantElement = renderAIAssistReactContent();
    expect(assistantElement.props).toMatchObject({
      modelProvider: 'anthropic',
      model: 'claude-3-5-sonnet',
      apiKey: 'test-key',
      temperature: 0.2,
      topP: 0.9,
      baseUrl: 'https://example.test'
    });
  });

  it('omits config messages when showConfigPanel is false', async () => {
    renderPanel(new AIAssistPanel({showConfigPanel: false}));
    await waitForReactRender();

    const assistantElement = renderAIAssistReactContent();
    expect(assistantElement.props.initialMessages).toEqual([]);
  });

  it('uses the effective panel theme when assistantTheme is not supplied', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(
      h(WidgetContainerRenderer, {
        container: asPanelContainer(
          new AIAssistPanel({
            theme: 'dark'
          })
        )
      }),
      root
    );
    await waitForReactRender();

    const assistantElement = renderAIAssistReactContent();
    expect(assistantElement.props.theme).toBe('dark');
  });

  it('stops interaction events from propagating outside the panel', async () => {
    const parentClickHandler = vi.fn();
    const root = renderPanel(new AIAssistPanel());
    await waitForReactRender();
    root.addEventListener('click', parentClickHandler);

    root
      .querySelector('[data-ai-assist-panel]')
      ?.dispatchEvent(new MouseEvent('click', {bubbles: true}));

    expect(parentClickHandler).not.toHaveBeenCalled();
  });

  it('does not inject fallback styles when app-provided OpenAssistant styles are present', async () => {
    const styleElement = document.createElement('style');
    styleElement.textContent = ':root { --heroui-background: 0 0% 100%; }';
    document.head.appendChild(styleElement);

    renderPanel(new AIAssistPanel());
    await waitForReactRender();

    expect(document.head.querySelector(OPENASSISTANT_STYLES_SELECTOR)).toBeNull();
    expect(document.head.querySelector(OPENASSISTANT_OVERRIDES_SELECTOR)).toBeTruthy();

    styleElement.remove();
  });
});
