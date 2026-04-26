/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {useEffect, useRef, useState} from 'preact/hooks';

import {loadTextEditorMonacoRuntime} from './text-editor-panel-monaco-runtime';
import {useEffectivePanelThemeMode} from './panel-containers';

import type {Panel, PanelTheme} from './panel-containers';
import type {editor as EditorNamespace, IDisposable} from 'monaco-editor';
import type {JSX} from 'preact';

/** Text-editor panel configuration. */
export type TextEditorPanelProps = {
  /** Stable panel id used by parent containers. */
  id: string;
  /** Visible heading text for the panel. */
  title: string;
  /** Controlled editor text. If supplied, callers own the current value. */
  value?: string;
  /** Uncontrolled initial editor text used when `value` is not supplied. */
  defaultValue?: string;
  /** Called when user edits the current document text. */
  onValueChange?: (nextValue: string) => void;
  /** Monaco language mode used by the document model. */
  language?: 'json' | 'plaintext';
  /** JSON schema used to drive diagnostics and completion in JSON mode. */
  jsonSchema?: Record<string, unknown>;
  /** If true, prevent editing while still showing Monaco viewer chrome. */
  readOnly?: boolean;
  /** Optional placeholder shown while the document is empty. */
  placeholder?: string;
  /** Optional class name applied to the outer panel content wrapper. */
  className?: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
  /** Monaco theme id used when the effective panel theme resolves to light mode. */
  lightMonacoTheme?: string;
  /** Monaco theme id used when the effective panel theme resolves to dark mode. */
  darkMonacoTheme?: string;
};

/**
 * A panel that lazily loads Monaco and edits one text document.
 */
export class TextEditorPanel implements Panel {
  id: string;
  title: string;
  theme?: PanelTheme;
  content: JSX.Element;

  constructor(props: TextEditorPanelProps) {
    this.id = props.id;
    this.title = props.title;
    this.theme = props.theme ?? 'inherit';
    this.content = <TextEditorPanelContent {...props} />;
  }
}

/**
 * Internal runtime state for the asynchronous Monaco loader.
 */
type TextEditorLoadState =
  | {status: 'loading'}
  | {status: 'ready'; runtime: Awaited<ReturnType<typeof loadTextEditorMonacoRuntime>>}
  | {status: 'error'; error: Error};

/**
 * Renders the Monaco-backed editor body used by the panel.
 */
function TextEditorPanelContent({
  id,
  value,
  defaultValue = '',
  onValueChange,
  language = 'json',
  jsonSchema,
  readOnly = false,
  placeholder,
  className,
  lightMonacoTheme = 'vs',
  darkMonacoTheme = 'vs-dark'
}: TextEditorPanelProps) {
  const hostElementRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorNamespace.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<EditorNamespace.ITextModel | null>(null);
  const modelChangeSubscriptionRef = useRef<IDisposable | null>(null);
  const isApplyingExternalValueRef = useRef(false);
  const isControlledRef = useRef(value !== undefined);
  const resolvedValueRef = useRef(resolveInitialEditorValue(value, defaultValue));
  const languageRef = useRef<TextEditorPanelProps['language']>(language);
  const onValueChangeRef = useRef(onValueChange);
  const [loadState, setLoadState] = useState<TextEditorLoadState>({status: 'loading'});
  const [displayValue, setDisplayValue] = useState(() =>
    resolveInitialEditorValue(value, defaultValue)
  );
  const isControlled = value !== undefined;
  const resolvedValue = isControlled ? value : displayValue;
  const runtime = loadState.status === 'ready' ? loadState.runtime : undefined;
  const themeMode = useEffectivePanelThemeMode();

  useEffect(() => {
    isControlledRef.current = isControlled;
    resolvedValueRef.current = resolvedValue;
    languageRef.current = language;
    onValueChangeRef.current = onValueChange;
  }, [isControlled, language, onValueChange, resolvedValue]);

  useEffect(() => {
    let isDisposed = false;

    loadTextEditorMonacoRuntime()
      .then(loadedRuntime => {
        if (isDisposed) {
          return;
        }
        setLoadState({status: 'ready', runtime: loadedRuntime});
      })
      .catch(error => {
        if (isDisposed) {
          return;
        }
        setLoadState({
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error))
        });
      });

    return () => {
      isDisposed = true;
    };
  }, []);

  useEffect(() => {
    if (!runtime || !hostElementRef.current || editorRef.current) {
      return undefined;
    }

    const {monaco} = runtime;
    const modelUri = monaco.Uri.parse(getTextEditorModelUri(id));
    const existingModel = monaco.editor.getModel(modelUri);
    const model =
      existingModel ??
      monaco.editor.createModel(
        resolvedValueRef.current,
        getTextEditorLanguageId(languageRef.current),
        modelUri
      );

    if (existingModel && existingModel.getValue() !== resolvedValueRef.current) {
      model.setValue(resolvedValueRef.current);
    }

    modelRef.current = model;
    monaco.editor.setTheme(getMonacoThemeId(themeMode, lightMonacoTheme, darkMonacoTheme));
    editorRef.current = monaco.editor.create(hostElementRef.current, {
      ...TEXT_EDITOR_MONACO_OPTIONS,
      model,
      readOnly
    });
    setDisplayValue(model.getValue());

    modelChangeSubscriptionRef.current = model.onDidChangeContent(() => {
      if (isApplyingExternalValueRef.current) {
        return;
      }

      const nextValue = model.getValue();
      setDisplayValue(nextValue);
      onValueChangeRef.current?.(nextValue);
      if (isControlledRef.current) {
        return;
      }
    });

    return () => {
      modelChangeSubscriptionRef.current?.dispose();
      modelChangeSubscriptionRef.current = null;
      editorRef.current?.dispose();
      editorRef.current = null;
      runtime.clearJsonSchema(model.uri.toString());
      model.dispose();
      modelRef.current = null;
    };
  }, [darkMonacoTheme, id, lightMonacoTheme, runtime, themeMode]);

  useEffect(() => {
    if (!runtime) {
      return;
    }

    runtime.monaco.editor.setTheme(getMonacoThemeId(themeMode, lightMonacoTheme, darkMonacoTheme));
  }, [darkMonacoTheme, lightMonacoTheme, runtime, themeMode]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.updateOptions({
      ...TEXT_EDITOR_MONACO_OPTIONS,
      readOnly
    });
  }, [readOnly]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model || !runtime) {
      return undefined;
    }

    runtime.monaco.editor.setModelLanguage(model, getTextEditorLanguageId(language));
    return undefined;
  }, [language, runtime]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model || !runtime) {
      return () => {};
    }

    const modelUri = model.uri.toString();
    if (language === 'json') {
      runtime.configureJsonSchema(modelUri, jsonSchema);
      return () => {
        runtime.clearJsonSchema(modelUri);
      };
    }

    runtime.clearJsonSchema(modelUri);
    return () => {};
  }, [jsonSchema, language, runtime]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) {
      return;
    }

    if (model.getValue() === resolvedValue) {
      setDisplayValue(resolvedValue);
      return;
    }

    isApplyingExternalValueRef.current = true;
    model.setValue(resolvedValue);
    isApplyingExternalValueRef.current = false;
    setDisplayValue(resolvedValue);
  }, [resolvedValue]);

  return (
    <div className={className} style={TEXT_EDITOR_PANEL_STYLE} data-text-editor-root="">
      {loadState.status === 'loading' ? (
        <div style={TEXT_EDITOR_STATUS_STYLE} data-text-editor-loading="">
          Loading editor…
        </div>
      ) : null}
      {loadState.status === 'error' ? (
        <div style={TEXT_EDITOR_ERROR_STYLE} data-text-editor-error="">
          Failed to load editor: {loadState.error.message}
        </div>
      ) : null}
      {loadState.status === 'ready' ? (
        <div style={TEXT_EDITOR_SURFACE_STYLE}>
          <div ref={hostElementRef} style={TEXT_EDITOR_HOST_STYLE} data-text-editor-host="" />
          {placeholder && displayValue.length === 0 ? (
            <div style={TEXT_EDITOR_PLACEHOLDER_STYLE} data-text-editor-placeholder="">
              {placeholder}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Returns the initial editor value based on controlled or uncontrolled props.
 */
function resolveInitialEditorValue(value: string | undefined, defaultValue: string): string {
  return value ?? defaultValue;
}

/**
 * Returns the stable in-memory Monaco model URI for one panel id.
 */
function getTextEditorModelUri(id: string): string {
  return `inmemory://deck-gl-community/panels/${encodeURIComponent(id)}`;
}

/**
 * Maps public panel language names onto Monaco language ids.
 */
function getTextEditorLanguageId(language: TextEditorPanelProps['language']): string {
  if (language === 'plaintext') {
    return 'plaintext';
  }

  return 'json';
}

/**
 * Maps the effective panel theme mode onto a Monaco editor theme id.
 */
function getMonacoThemeId(
  themeMode: 'light' | 'dark',
  lightMonacoTheme: string,
  darkMonacoTheme: string
): string {
  return themeMode === 'dark' ? darkMonacoTheme : lightMonacoTheme;
}

const TEXT_EDITOR_MONACO_OPTIONS: EditorNamespace.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  minimap: {enabled: false},
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10
  },
  fontSize: 12,
  lineHeight: 18,
  wordWrap: 'on',
  lineNumbers: 'on',
  glyphMargin: false,
  folding: false,
  scrollBeyondLastLine: false,
  tabSize: 2
};

const TEXT_EDITOR_PANEL_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: '280px'
};

const TEXT_EDITOR_SURFACE_STYLE: JSX.CSSProperties = {
  position: 'relative',
  minHeight: '280px',
  border: '1px solid var(--menu-border, rgba(148, 163, 184, 0.35))',
  borderRadius: 'var(--button-corner-radius, 8px)',
  overflow: 'hidden',
  background: 'var(--menu-background, #fff)'
};

const TEXT_EDITOR_HOST_STYLE: JSX.CSSProperties = {
  width: '100%',
  minHeight: '280px'
};

const TEXT_EDITOR_STATUS_STYLE: JSX.CSSProperties = {
  ...TEXT_EDITOR_SURFACE_STYLE,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: '12px',
  padding: '16px'
};

const TEXT_EDITOR_ERROR_STYLE: JSX.CSSProperties = {
  ...TEXT_EDITOR_STATUS_STYLE,
  color: 'rgb(185, 28, 28)'
};

const TEXT_EDITOR_PLACEHOLDER_STYLE: JSX.CSSProperties = {
  position: 'absolute',
  top: '12px',
  left: '14px',
  right: '14px',
  color: 'var(--button-icon-idle, rgb(100, 116, 139))',
  fontSize: '12px',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
};
