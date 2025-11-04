// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import type {ReactNode} from 'react';
import type {GraphLayerProps} from '@deck.gl-community/graph-layers';
import {StylesheetEditor, type StylesheetSchema} from './stylesheet-editor';

const DEFAULT_STYLESHEET_MESSAGE = '// No style defined for this example';

export type LayoutType =
  | 'd3-force-layout'
  | 'gpu-force-layout'
  | 'simple-layout'
  | 'radial-layout'
  | 'hive-plot-layout'
  | 'force-multi-graph-layout'
  | 'd3-dag-layout';

export type ExampleStyles = NonNullable<GraphLayerProps['stylesheet']>;

export type ExampleDefinition = {
  name: string;
  description: string;
  data: () => {nodes: unknown[]; edges: unknown[]};
  /** First listed layout is the default */
  layouts: LayoutType[];
  layoutDescriptions: Record<LayoutType, string>;
  style: ExampleStyles;
  getLayoutOptions?: (
    layout: LayoutType,
    data: {nodes: unknown[]; edges: unknown[]}
  ) => Record<string, unknown> | undefined;
};

type ControlPanelProps = {
  examples: ExampleDefinition[];
  defaultExample?: ExampleDefinition;
  onExampleChange: (example: ExampleDefinition, layout: LayoutType) => void;
  children?: ReactNode;
  onStylesheetChange?: (value: string) => void;
  onStylesheetSubmit?: (value: string) => void;
  stylesheetSchema?: StylesheetSchema;
};

const LAYOUT_LABELS: Record<LayoutType, string> = {
  'd3-force-layout': 'D3 Force Layout',
  'gpu-force-layout': 'GPU Force Layout',
  'simple-layout': 'Simple Layout',
  'radial-layout': 'Radial Layout',
  'hive-plot-layout': 'Hive Plot Layout',
  'force-multi-graph-layout': 'Force Multi-Graph Layout',
  'd3-dag-layout': 'D3 DAG Layout',
};

export function ControlPanel({
  examples,
  defaultExample,
  onExampleChange,
  children,
  onStylesheetChange,
  onStylesheetSubmit,
  stylesheetSchema
}: ControlPanelProps) {
  const resolveExampleIndex = useCallback(
    (example?: ExampleDefinition) => {
      if (!example) {
        return 0;
      }

      const index = examples.findIndex((candidate) => candidate === example);
      return index === -1 ? 0 : index;
    },
    [examples]
  );

  const [selectedExampleIndex, setSelectedExampleIndex] = useState(() =>
    resolveExampleIndex(defaultExample)
  );
  const selectedExample = examples[selectedExampleIndex];
  const availableLayouts = selectedExample?.layouts ?? [];
  const [selectedLayout, setSelectedLayout] = useState<LayoutType | undefined>(
    availableLayouts[0]
  );
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (!availableLayouts.length) {
      setSelectedLayout(undefined);
      return;
    }

    setSelectedLayout((currentLayout) =>
      currentLayout && availableLayouts.includes(currentLayout)
        ? currentLayout
        : availableLayouts[0]
    );
  }, [availableLayouts]);

  useEffect(() => {
    if (selectedExample && selectedLayout) {
      onExampleChange(selectedExample, selectedLayout);
    }
  }, [selectedExample, selectedLayout, onExampleChange]);

  const handleExampleChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const index = Number(event.target.value);
      setSelectedExampleIndex(Number.isNaN(index) ? 0 : index);
    },
    []
  );

  useEffect(() => {
    setSelectedExampleIndex((currentIndex) => {
      const nextIndex = resolveExampleIndex(defaultExample);
      return currentIndex === nextIndex ? currentIndex : nextIndex;
    });
  }, [defaultExample, resolveExampleIndex]);

  const handleLayoutChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedLayout(event.target.value as LayoutType);
  }, []);

  const datasetDescription = selectedExample?.description;

  const layoutDescription = useMemo(() => {
    if (!selectedExample || !selectedLayout) {
      return undefined;
    }

    return selectedExample.layoutDescriptions[selectedLayout];
  }, [selectedExample, selectedLayout]);

  const styleJson = useMemo(() => {
    const styles = selectedExample?.style;
    if (!styles) {
      return '';
    }

    return JSON.stringify(
      styles,
      (_key, value) => (typeof value === 'function' ? value.toString() : value),
      2
    );
  }, [selectedExample]);

  const [stylesheetValue, setStylesheetValue] = useState(
    styleJson || DEFAULT_STYLESHEET_MESSAGE
  );

  useEffect(() => {
    setStylesheetValue(styleJson || DEFAULT_STYLESHEET_MESSAGE);
  }, [styleJson]);

  const handleStylesheetChange = useCallback(
    (nextValue: string) => {
      setStylesheetValue(nextValue);
      onStylesheetChange?.(nextValue);
    },
    [onStylesheetChange]
  );

  const handleStylesheetSubmit = useCallback(
    (nextValue: string) => {
      onStylesheetSubmit?.(nextValue);
    },
    [onStylesheetSubmit]
  );

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((value) => !value);
  }, []);

  if (!examples.length) {
    return null;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        padding: '0.5rem 0 1rem',
        fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif'
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gridAutoRows: 'auto',
          columnGap: '0.75rem',
          rowGap: '0.75rem',
          alignItems: 'center'
        }}
      >
        <label
          htmlFor="graph-viewer-example"
          style={{fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}
        >
          Dataset
        </label>
        <select
          id="graph-viewer-example"
          value={selectedExampleIndex}
          onChange={handleExampleChange}
          style={{
            fontFamily: 'inherit',
            fontSize: '0.875rem',
            padding: '0.375rem 0.5rem',
            borderRadius: '0.375rem',
            border: '1px solid #cbd5f5',
            backgroundColor: '#ffffff',
            color: '#0f172a'
          }}
        >
          {examples.map((example, index) => (
            <option key={example.name} value={index}>
              {example.name}
            </option>
          ))}
        </select>
        <label htmlFor="graph-viewer-layout" style={{fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
          Layout
        </label>
        <select
          id="graph-viewer-layout"
          value={selectedLayout}
          onChange={handleLayoutChange}
          disabled={!availableLayouts.length}
          style={{
            fontFamily: 'inherit',
            fontSize: '0.875rem',
            padding: '0.375rem 0.5rem',
            borderRadius: '0.375rem',
            border: '1px solid #cbd5f5',
            backgroundColor: '#ffffff',
            color: '#0f172a'
          }}
        >
          {availableLayouts.map((layout) => (
            <option key={layout} value={layout}>
              {LAYOUT_LABELS[layout] ?? layout}
            </option>
          ))}
        </select>
      </div>
      {datasetDescription ? (
        <section style={{fontSize: '0.875rem', lineHeight: 1.5, color: '#334155'}}>
          <h3 style={{margin: '0 0 0.25rem', fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
            Dataset overview
          </h3>
          <p style={{margin: 0}}>{datasetDescription}</p>
        </section>
      ) : null}
      {children ? (
        <section
          style={{
            borderTop: '1px solid #e2e8f0',
            paddingTop: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          }}
        >
          <button
            type="button"
            onClick={toggleCollapsed}
            style={{
              alignSelf: 'flex-start',
              fontSize: '0.8125rem',
              fontWeight: 600,
              border: '1px solid #cbd5f5',
              background: '#f8fafc',
              color: '#0f172a',
              borderRadius: '0.5rem',
              padding: '0.25rem 0.5rem',
              cursor: 'pointer'
            }}
          >
            {isCollapsed ? 'Expand details' : 'Collapse details'}
          </button>
          {!isCollapsed ? <div>{children}</div> : null}
        </section>
      ) : null}
      {layoutDescription ? (
        <section style={{fontSize: '0.875rem', lineHeight: 1.5, color: '#334155'}}>
          <h3 style={{margin: '0 0 0.25rem', fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
            Layout overview
          </h3>
          <p style={{margin: 0}}>{layoutDescription}</p>
        </section>
      ) : null}
      <section style={{display: 'flex', flexDirection: 'column', fontSize: '0.75rem', gap: '0.25rem'}}>
        <h3 style={{margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
          Stylesheet JSON
        </h3>
        <div style={{borderRadius: '0.5rem', overflow: 'hidden', border: '1px solid #1f2937'}}>
          <StylesheetEditor
            value={stylesheetValue}
            onChange={handleStylesheetChange}
            onSubmit={handleStylesheetSubmit}
            schema={stylesheetSchema}
          />
        </div>
      </section>
    </div>
  );
}
