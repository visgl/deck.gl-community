/** @jsxImportSource preact */
import {DarkTheme, LightTheme} from '@deck.gl/widgets';
import {h, render} from 'preact';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {WidgetContainerRenderer, asPanelContainer} from './widget-containers';
import {TextEditorPanel} from './text-editor-panel';

const monacoHarness = vi.hoisted(() => {
  type FakeListener = () => void;
  type FakeModel = {
    uri: {toString: () => string};
    language: string;
    getValue: () => string;
    setValue: (nextValue: string) => void;
    onDidChangeContent: (listener: FakeListener) => {dispose: () => void};
    dispose: ReturnType<typeof vi.fn>;
    emitUserInput: (nextValue: string) => void;
  };
  type FakeEditor = {
    updateOptions: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };

  const modelsByUri = new Map<string, FakeModel>();
  const configureJsonSchema = vi.fn();
  const clearJsonSchema = vi.fn();
  const setTheme = vi.fn();
  const loadTextEditorMonacoRuntime = vi.fn();
  let lastCreatedModel: FakeModel | null = null;
  let lastCreatedEditor: FakeEditor | null = null;

  /**
   * Builds a fake Monaco runtime used by the text-editor widget tests.
   */
  function createRuntime() {
    return {
      monaco: {
        Uri: {
          parse: (uri: string) => ({
            toString: () => uri
          })
        },
        editor: {
          getModel: (uri: {toString: () => string}) => modelsByUri.get(uri.toString()) ?? null,
          createModel: (value: string, language: string, uri: {toString: () => string}) => {
            let currentValue = value;
            const listeners = new Set<FakeListener>();
            const model: FakeModel = {
              uri,
              language,
              getValue: () => currentValue,
              setValue: (nextValue: string) => {
                currentValue = nextValue;
                listeners.forEach(listener => listener());
              },
              onDidChangeContent: (listener: FakeListener) => {
                listeners.add(listener);
                return {
                  dispose: () => listeners.delete(listener)
                };
              },
              dispose: vi.fn(),
              emitUserInput: (nextValue: string) => {
                currentValue = nextValue;
                listeners.forEach(listener => listener());
              }
            };
            modelsByUri.set(uri.toString(), model);
            lastCreatedModel = model;
            return model;
          },
          create: (_hostElement: HTMLElement, _options: unknown) => {
            const editor: FakeEditor = {
              updateOptions: vi.fn(),
              dispose: vi.fn()
            };
            lastCreatedEditor = editor;
            return editor;
          },
          setModelLanguage: (model: FakeModel, language: string) => {
            model.language = language;
          },
          setTheme
        }
      },
      configureJsonSchema,
      clearJsonSchema
    };
  }

  /**
   * Resets the fake Monaco harness to the default resolved runtime state.
   */
  function reset() {
    modelsByUri.clear();
    configureJsonSchema.mockReset();
    clearJsonSchema.mockReset();
    setTheme.mockReset();
    loadTextEditorMonacoRuntime.mockReset();
    loadTextEditorMonacoRuntime.mockResolvedValue(createRuntime());
    lastCreatedModel = null;
    lastCreatedEditor = null;
  }

  /**
   * Returns the most recently created fake Monaco model.
   */
  function getLastCreatedModel(): FakeModel | null {
    return lastCreatedModel;
  }

  /**
   * Returns the most recently created fake Monaco editor.
   */
  function getLastCreatedEditor(): FakeEditor | null {
    return lastCreatedEditor;
  }

  return {
    clearJsonSchema,
    configureJsonSchema,
    createRuntime,
    getLastCreatedEditor,
    getLastCreatedModel,
    loadTextEditorMonacoRuntime,
    reset,
    setTheme
  };
});

vi.mock('./text-editor-panel-monaco-runtime', () => ({
  loadTextEditorMonacoRuntime: monacoHarness.loadTextEditorMonacoRuntime
}));

/**
 * Flushes queued microtasks so Preact effects and mocked async loaders settle.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Waits until a test predicate becomes true or fails after a bounded number of retries.
 */
async function waitForCondition(
  predicate: () => boolean,
  message: string,
  attempts = 8
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await flushMicrotasks();
  }

  throw new Error(message);
}

afterEach(() => {
  for (const rootElement of [...document.body.children]) {
    render(null, rootElement as HTMLElement);
  }
  document.body.innerHTML = '';
});

beforeEach(() => {
  monacoHarness.reset();
});

describe('TextEditorPanel', () => {
  it('creates a widget panel with the expected id and title', () => {
    const panel = new TextEditorPanel({
      id: 'text-editor',
      title: 'Text editor'
    });

    expect(panel.id).toBe('text-editor');
    expect(panel.title).toBe('Text editor');
  });

  it('renders a loading state before monaco resolves', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let resolveRuntime: ((value: unknown) => void) | undefined;
    const pendingRuntime = new Promise(resolve => {
      resolveRuntime = resolve;
    });
    monacoHarness.loadTextEditorMonacoRuntime.mockReturnValueOnce(pendingRuntime);

    render(new TextEditorPanel({id: 'loading', title: 'Loading'}).content, root);

    expect(root.querySelector('[data-text-editor-loading]')?.textContent).toContain(
      'Loading editor'
    );
    expect(root.querySelector('[data-text-editor-host]')).toBeNull();

    resolveRuntime?.(monacoHarness.createRuntime());
  });

  it('initializes from defaultValue when uncontrolled', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    render(
      new TextEditorPanel({
        id: 'uncontrolled',
        title: 'Uncontrolled',
        defaultValue: '{\"alpha\":1}'
      }).content,
      root
    );
    await waitForCondition(
      () => monacoHarness.getLastCreatedModel() !== null,
      'Expected Monaco model to be created for uncontrolled panel.'
    );

    expect(monacoHarness.getLastCreatedModel()?.getValue()).toBe('{"alpha":1}');
    expect(root.querySelector('[data-text-editor-host]')).toBeTruthy();
  });

  it('uses the light Monaco theme by default', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    render(
      h(WidgetContainerRenderer, {
        container: asPanelContainer(new TextEditorPanel({id: 'light', title: 'Light'}))
      }),
      root
    );

    await waitForCondition(
      () => monacoHarness.getLastCreatedModel() !== null,
      'Expected Monaco model to be created for light theme panel.'
    );

    expect(monacoHarness.setTheme).toHaveBeenCalledWith('vs');
  });

  it('uses the dark Monaco theme for a dark panel override', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    render(
      h(WidgetContainerRenderer, {
        container: asPanelContainer(
          new TextEditorPanel({
            id: 'dark',
            title: 'Dark',
            theme: 'dark'
          })
        )
      }),
      root
    );

    await waitForCondition(
      () => monacoHarness.getLastCreatedModel() !== null,
      'Expected Monaco model to be created for dark theme panel.'
    );

    expect(monacoHarness.setTheme).toHaveBeenCalledWith('vs-dark');
  });

  it('uses custom Monaco theme ids when provided', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    render(
      h(WidgetContainerRenderer, {
        container: asPanelContainer(
          new TextEditorPanel({
            id: 'custom-theme',
            title: 'Custom theme',
            theme: 'dark',
            lightMonacoTheme: 'custom-light',
            darkMonacoTheme: 'custom-dark'
          })
        )
      }),
      root
    );

    await waitForCondition(
      () => monacoHarness.getLastCreatedModel() !== null,
      'Expected Monaco model to be created for custom theme panel.'
    );

    expect(monacoHarness.setTheme).toHaveBeenCalledWith('custom-dark');
  });

  it('updates the Monaco theme when the effective panel theme changes', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    render(
      h(WidgetContainerRenderer, {
        container: asPanelContainer(
          new TextEditorPanel({
            id: 'theme-switch',
            title: 'Theme switch',
            theme: 'dark'
          })
        )
      }),
      root
    );
    await waitForCondition(
      () => monacoHarness.getLastCreatedModel() !== null,
      'Expected Monaco model to be created before theme update.'
    );

    render(
      h(WidgetContainerRenderer, {
        container: asPanelContainer(
          new TextEditorPanel({
            id: 'theme-switch',
            title: 'Theme switch',
            theme: 'light'
          })
        )
      }),
      root
    );
    await flushMicrotasks();

    await waitForCondition(
      () => monacoHarness.setTheme.mock.lastCall?.[0] === 'vs',
      'Expected Monaco theme to update to the light theme.'
    );
    expect(monacoHarness.setTheme).toHaveBeenLastCalledWith('vs');
  });

  it('updates to the custom light Monaco theme when the effective panel theme changes', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    render(
      h(WidgetContainerRenderer, {
        container: asPanelContainer(
          new TextEditorPanel({
            id: 'custom-theme-switch',
            title: 'Custom theme switch',
            theme: 'dark',
            lightMonacoTheme: 'custom-light',
            darkMonacoTheme: 'custom-dark'
          })
        )
      }),
      root
    );
    await waitForCondition(
      () => monacoHarness.getLastCreatedModel() !== null,
      'Expected Monaco model to be created before custom theme update.'
    );

    render(
      h(WidgetContainerRenderer, {
        container: asPanelContainer(
          new TextEditorPanel({
            id: 'custom-theme-switch',
            title: 'Custom theme switch',
            theme: 'light',
            lightMonacoTheme: 'custom-light',
            darkMonacoTheme: 'custom-dark'
          })
        )
      }),
      root
    );
    await flushMicrotasks();

    await waitForCondition(
      () => monacoHarness.setTheme.mock.lastCall?.[0] === 'custom-light',
      'Expected Monaco theme to update to the custom light theme.'
    );
    expect(monacoHarness.setTheme).toHaveBeenLastCalledWith('custom-light');
  });

  it('updates the Monaco theme when inherited panel theme variables change', async () => {
    const panelContainer = document.createElement('div');
    const root = document.createElement('div');
    panelContainer.className = 'deck-panel-container';
    panelContainer.style.setProperty('--menu-background', LightTheme['--menu-background'] ?? '');
    panelContainer.appendChild(root);
    document.body.appendChild(panelContainer);

    render(
      h(WidgetContainerRenderer, {
        container: asPanelContainer(
          new TextEditorPanel({
            id: 'theme-vars-switch',
            title: 'Theme vars switch'
          })
        )
      }),
      root
    );
    await waitForCondition(
      () => monacoHarness.getLastCreatedModel() !== null,
      'Expected Monaco model to be created before inherited theme update.'
    );
    expect(monacoHarness.setTheme).toHaveBeenLastCalledWith('vs');

    panelContainer.style.setProperty('--menu-background', DarkTheme['--menu-background'] ?? '');
    await waitForCondition(
      () => monacoHarness.setTheme.mock.lastCall?.[0] === 'vs-dark',
      'Expected Monaco theme to update after inherited widget theme changes.'
    );

    expect(monacoHarness.setTheme).toHaveBeenLastCalledWith('vs-dark');
  });

  it('respects controlled value updates', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    render(
      new TextEditorPanel({
        id: 'controlled',
        title: 'Controlled',
        value: '{"alpha":1}'
      }).content,
      root
    );
    await waitForCondition(
      () => monacoHarness.getLastCreatedModel() !== null,
      'Expected Monaco model to be created for controlled panel.'
    );
    expect(monacoHarness.getLastCreatedModel()?.getValue()).toBe('{"alpha":1}');

    render(
      new TextEditorPanel({
        id: 'controlled',
        title: 'Controlled',
        value: '{"alpha":2}'
      }).content,
      root
    );
    await waitForCondition(
      () => monacoHarness.getLastCreatedModel()?.getValue() === '{"alpha":2}',
      'Expected controlled Monaco value to update after rerender.'
    );

    expect(monacoHarness.getLastCreatedModel()?.getValue()).toBe('{"alpha":2}');
  });

  it('calls onValueChange when the editor content changes', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const onValueChange = vi.fn();

    render(
      new TextEditorPanel({
        id: 'changes',
        title: 'Changes',
        defaultValue: 'start',
        onValueChange
      }).content,
      root
    );
    await waitForCondition(
      () => monacoHarness.getLastCreatedModel() !== null,
      'Expected Monaco model before simulating user input.'
    );

    monacoHarness.getLastCreatedModel()?.emitUserInput('next');
    await waitForCondition(
      () => onValueChange.mock.calls.length > 0,
      'Expected onValueChange to be called after simulated input.'
    );

    expect(onValueChange).toHaveBeenLastCalledWith('next');
  });

  it('applies JSON-schema configuration only in json mode', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    render(
      new TextEditorPanel({
        id: 'json-editor',
        title: 'JSON editor',
        jsonSchema: {
          type: 'object'
        }
      }).content,
      root
    );
    await waitForCondition(
      () => monacoHarness.configureJsonSchema.mock.calls.length > 0,
      'Expected JSON schema registration for JSON editor.'
    );

    expect(monacoHarness.configureJsonSchema).toHaveBeenCalledWith(
      'inmemory://deck-gl-community/widgets/json-editor',
      {type: 'object'}
    );

    render(
      new TextEditorPanel({
        id: 'plain-editor',
        title: 'Plain editor',
        language: 'plaintext',
        jsonSchema: {
          type: 'object'
        }
      }).content,
      root
    );
    await waitForCondition(
      () =>
        monacoHarness.clearJsonSchema.mock.calls.some(
          ([uri]) => uri === 'inmemory://deck-gl-community/widgets/plain-editor'
        ),
      'Expected plain-text mode to clear JSON schema registration.'
    );

    expect(monacoHarness.clearJsonSchema).toHaveBeenCalledWith(
      'inmemory://deck-gl-community/widgets/plain-editor'
    );
  });

  it('updates schema registration when jsonSchema changes', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    render(
      new TextEditorPanel({
        id: 'schema-editor',
        title: 'Schema editor',
        jsonSchema: {
          type: 'object',
          required: ['alpha']
        }
      }).content,
      root
    );
    await flushMicrotasks();

    render(
      new TextEditorPanel({
        id: 'schema-editor',
        title: 'Schema editor',
        jsonSchema: {
          type: 'object',
          required: ['beta']
        }
      }).content,
      root
    );
    await flushMicrotasks();

    await waitForCondition(
      () =>
        monacoHarness.configureJsonSchema.mock.lastCall?.[0] ===
          'inmemory://deck-gl-community/widgets/schema-editor' &&
        JSON.stringify(monacoHarness.configureJsonSchema.mock.lastCall?.[1]) ===
          JSON.stringify({
            type: 'object',
            required: ['beta']
          }),
      'Expected schema registration to update after jsonSchema changes.'
    );
    expect(monacoHarness.configureJsonSchema).toHaveBeenLastCalledWith(
      'inmemory://deck-gl-community/widgets/schema-editor',
      {
        type: 'object',
        required: ['beta']
      }
    );
  });

  it('disposes editor resources on unmount', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    render(new TextEditorPanel({id: 'dispose', title: 'Dispose'}).content, root);
    await waitForCondition(
      () =>
        monacoHarness.getLastCreatedModel() !== null &&
        monacoHarness.getLastCreatedEditor() !== null,
      'Expected Monaco resources before unmount.'
    );

    const model = monacoHarness.getLastCreatedModel();
    const editor = monacoHarness.getLastCreatedEditor();

    render(null, root);
    await flushMicrotasks();

    expect(editor?.dispose).toHaveBeenCalledTimes(1);
    expect(model?.dispose).toHaveBeenCalledTimes(1);
    expect(monacoHarness.clearJsonSchema).toHaveBeenCalledWith(
      'inmemory://deck-gl-community/widgets/dispose'
    );
  });

  it('renders a load error fallback when monaco loading fails', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    monacoHarness.loadTextEditorMonacoRuntime.mockRejectedValueOnce(new Error('boom'));

    render(new TextEditorPanel({id: 'error', title: 'Error'}).content, root);
    await waitForCondition(
      () => (root.querySelector('[data-text-editor-error]')?.textContent ?? '').includes('boom'),
      'Expected text editor error fallback to render when Monaco loading fails.'
    );

    expect(root.querySelector('[data-text-editor-error]')?.textContent).toContain('boom');
  });
});
