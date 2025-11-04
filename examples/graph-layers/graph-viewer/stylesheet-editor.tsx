// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import Editor from '@monaco-editor/react';
import type {Monaco} from '@monaco-editor/react';
import type {editor as MonacoEditor, languages} from 'monaco-editor';

export type StylesheetSchema = languages.json.DiagnosticsOptions['schemas'][number];

type StylesheetEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  schema?: StylesheetSchema;
  height?: number | string;
};

const THEME_NAME = 'graph-viewer-dark';

export function StylesheetEditor({
  value,
  onChange,
  onSubmit,
  schema,
  height = '16rem'
}: StylesheetEditorProps) {
  const monacoRef = useRef<Monaco | null>(null);

  const editorOptions = useMemo<MonacoEditor.IStandaloneEditorConstructionOptions>(
    () => ({
      fontSize: 12,
      lineHeight: 18,
      minimap: {enabled: false},
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      renderLineHighlight: 'none',
      wordWrap: 'on'
    }),
    []
  );

  const applySchema = useCallback(
    (monaco: Monaco | null, schemaConfig?: StylesheetSchema) => {
      if (!monaco) {
        return;
      }

      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: false,
        enableSchemaRequest: true,
        schemas: schemaConfig ? [schemaConfig] : []
      });
    },
    []
  );

  const handleMount = useCallback(
    (editor: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) => {
      monacoRef.current = monaco;

      monaco.editor.defineTheme(THEME_NAME, {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#000000',
          'editorLineNumber.foreground': '#6b7280',
          'editorLineNumber.activeForeground': '#e5e7eb'
        }
      });
      monaco.editor.setTheme(THEME_NAME);

      applySchema(monaco, schema);

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        onSubmit?.(editor.getValue());
      });
    },
    [applySchema, onSubmit, schema]
  );

  useEffect(() => {
    applySchema(monacoRef.current, schema);
  }, [applySchema, schema]);

  const handleChange = useCallback(
    (nextValue?: string) => {
      onChange?.(nextValue ?? '');
    },
    [onChange]
  );

  return (
    <Editor
      height={height}
      value={value}
      language="json"
      theme={THEME_NAME}
      onMount={handleMount}
      onChange={handleChange}
      options={editorOptions}
    />
  );
}

