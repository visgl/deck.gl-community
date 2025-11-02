// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import type {GraphLayerProps} from '@deck.gl-community/graph-layers';

export type LayoutType = 'd3-force-layout' | 'gpu-force-layout' | 'simple-layout';

export type ExampleStyles = Pick<GraphLayerProps, 'nodeStyle' | 'edgeStyle'>;

export type ExampleDefinition = {
  name: string;
  description: string;
  data: () => {nodes: unknown[]; edges: unknown[]};
  /** First listed layout is the default */
  layouts: LayoutType[];
  layoutDescriptions: Record<LayoutType, string>;
  style: ExampleStyles;
};

type ControlPanelProps = {
  examples: ExampleDefinition[];
  onExampleChange: (example: ExampleDefinition, layout: LayoutType) => void;
};

const LAYOUT_LABELS: Record<LayoutType, string> = {
  'd3-force-layout': 'D3 Force Layout',
  'gpu-force-layout': 'GPU Force Layout',
  'simple-layout': 'Simple Layout'
};

export function ControlPanel({examples, onExampleChange}: ControlPanelProps) {
  const [selectedExampleIndex, setSelectedExampleIndex] = useState(0);
  const selectedExample = examples[selectedExampleIndex];
  const availableLayouts = selectedExample?.layouts ?? [];
  const [selectedLayout, setSelectedLayout] = useState<LayoutType | undefined>(
    availableLayouts[0]
  );

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

  if (!examples.length) {
    return null;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        padding: '0.5rem 0 1rem'
      }}
    >
      <label style={{display: 'flex', flexDirection: 'column', fontSize: '0.875rem', gap: '0.25rem'}}>
        Dataset
        <select value={selectedExampleIndex} onChange={handleExampleChange}>
          {examples.map((example, index) => (
            <option key={example.name} value={index}>
              {example.name}
            </option>
          ))}
        </select>
      </label>
      <label style={{display: 'flex', flexDirection: 'column', fontSize: '0.875rem', gap: '0.25rem'}}>
        Layout
        <select value={selectedLayout} onChange={handleLayoutChange} disabled={!availableLayouts.length}>
          {availableLayouts.map((layout) => (
            <option key={layout} value={layout}>
              {LAYOUT_LABELS[layout] ?? layout}
            </option>
          ))}
        </select>
      </label>
      {datasetDescription ? (
        <section style={{fontSize: '0.875rem', lineHeight: 1.5}}>
          <h3 style={{margin: '0 0 0.25rem', fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
            Dataset description
          </h3>
          <p style={{margin: 0, color: '#334155'}}>{datasetDescription}</p>
        </section>
      ) : null}
      {layoutDescription ? (
        <section style={{fontSize: '0.875rem', lineHeight: 1.5}}>
          <h3 style={{margin: '0 0 0.25rem', fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
            Layout description
          </h3>
          <p style={{margin: 0, color: '#334155'}}>{layoutDescription}</p>
        </section>
      ) : null}
      <section style={{display: 'flex', flexDirection: 'column', fontSize: '0.75rem', gap: '0.25rem'}}>
        <h3 style={{margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
          Style JSON
        </h3>
        <pre
          style={{
            margin: 0,
            padding: '0.75rem',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '0.5rem',
            fontSize: '0.75rem',
            lineHeight: 1.4,
            maxHeight: '16rem',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            fontFamily:
              'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
          }}
        >
          {styleJson || '// No style defined for this example'}
        </pre>
      </section>
    </div>
  );
}
