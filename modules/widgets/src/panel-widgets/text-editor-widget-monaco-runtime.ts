import type * as MonacoNamespace from 'monaco-editor';

/**
 * Shared Monaco runtime services used by the text-editor widget panel.
 */
export type TextEditorMonacoRuntime = {
  /** Monaco module namespace used for model and editor creation. */
  monaco: typeof MonacoNamespace;
  /** Registers or replaces the JSON schema associated with one model URI. */
  configureJsonSchema: (modelUri: string, schema?: Record<string, unknown>) => void;
  /** Removes the JSON schema associated with one model URI. */
  clearJsonSchema: (modelUri: string) => void;
};

let monacoRuntimePromise: Promise<TextEditorMonacoRuntime> | undefined;
const jsonSchemasByModelUri = new Map<string, Record<string, unknown>>();

/**
 * Lazily loads the Monaco runtime and returns the shared editor services singleton.
 */
export async function loadTextEditorMonacoRuntime(): Promise<TextEditorMonacoRuntime> {
  monacoRuntimePromise ??= createTextEditorMonacoRuntime();
  return monacoRuntimePromise;
}

/**
 * Creates the Monaco runtime singleton used by text-editor widget panels.
 */
async function createTextEditorMonacoRuntime(): Promise<TextEditorMonacoRuntime> {
  configureMonacoEnvironment();

  const [monaco] = await Promise.all([
    import('monaco-editor'),
    import('monaco-editor/esm/vs/language/json/monaco.contribution'),
  ]);

  return {
    monaco,
    configureJsonSchema: (modelUri, schema) => {
      if (schema === undefined) {
        jsonSchemasByModelUri.delete(modelUri);
      } else {
        jsonSchemasByModelUri.set(modelUri, schema);
      }

      applyJsonDiagnostics(monaco);
    },
    clearJsonSchema: (modelUri) => {
      jsonSchemasByModelUri.delete(modelUri);
      applyJsonDiagnostics(monaco);
    },
  };
}

/**
 * Installs Monaco worker resolution into the current browser-like runtime once.
 */
function configureMonacoEnvironment(): void {
  const runtimeTarget = globalThis as typeof globalThis & {
    MonacoEnvironment?: {
      getWorker: (_workerId: string, label: string) => Worker;
    };
  };

  if (runtimeTarget.MonacoEnvironment) {
    return;
  }

  runtimeTarget.MonacoEnvironment = {
    getWorker: (_workerId, label) => {
      if (label === 'json') {
        return new Worker(
          new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url),
          {type: 'module'}
        );
      }
      return new Worker(
        new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
        {type: 'module'}
      );
    },
  };
}

/**
 * Recomputes Monaco JSON diagnostics from the active schema registry.
 */
function applyJsonDiagnostics(monaco: typeof MonacoNamespace): void {
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    enableSchemaRequest: false,
    schemas: [...jsonSchemasByModelUri.entries()].map(([modelUri, schema]) => ({
      uri: `${modelUri}#schema`,
      fileMatch: [modelUri],
      schema,
    })),
  });
}
