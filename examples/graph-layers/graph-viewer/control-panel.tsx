// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import type {ReactNode} from 'react';
import type {
  ExampleDefinition,
  ExampleMetadata,
  GraphExampleType,
  LayoutType
} from './layout-options';
import {LAYOUT_LABELS} from './layout-options';
import {filterExamplesByType} from './examples';
import {LayoutOptionsPanel} from './layout-options-panel';

const METADATA_SECTION_STYLE: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#334155',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem'
};

const METADATA_GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  columnGap: '0.75rem',
  rowGap: '0.35rem',
  margin: 0
};

const METADATA_LABEL_STYLE: React.CSSProperties = {
  fontWeight: 600,
  color: '#0f172a',
  margin: 0
};

const METADATA_VALUE_STYLE: React.CSSProperties = {
  margin: 0,
  color: '#1f2937'
};

const METADATA_ATTRIBUTE_LIST_STYLE: React.CSSProperties = {
  margin: '0.35rem 0 0',
  paddingLeft: '1.25rem',
  display: 'grid',
  rowGap: '0.25rem'
};

const LOADING_TEXT_STYLE: React.CSSProperties = {
  fontSize: '0.8125rem',
  color: '#475569',
  margin: 0
};

function formatMetadataValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return value.map((entry) => formatMetadataValue(entry)).join(', ');
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return String(value);
    }
  }

  return String(value);
}

type MetadataSectionProps = {
  metadata?: ExampleMetadata | null;
  dataLoading?: boolean;
  attributeEntries: Array<[string, unknown]>;
};

// eslint-disable-next-line complexity
function MetadataSection({metadata, dataLoading, attributeEntries}: MetadataSectionProps) {
  if (dataLoading) {
    return (
      <section style={METADATA_SECTION_STYLE}>
        <h3 style={{margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
          Dataset stats
        </h3>
        <p style={LOADING_TEXT_STYLE}>Loading dataset details…</p>
      </section>
    );
  }

  if (!metadata) {
    return null;
  }

  return (
    <section style={METADATA_SECTION_STYLE}>
      <h3 style={{margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
        Dataset stats
      </h3>
      <dl style={METADATA_GRID_STYLE}>
        {metadata.sourceType ? (
          <>
            <dt style={METADATA_LABEL_STYLE}>Source</dt>
            <dd style={METADATA_VALUE_STYLE}>
              {metadata.sourceType === 'remote' ? 'Remote (URL)' : 'Inline sample'}
            </dd>
          </>
        ) : null}
        {typeof metadata.nodeCount === 'number' ? (
          <>
            <dt style={METADATA_LABEL_STYLE}>Nodes</dt>
            <dd style={METADATA_VALUE_STYLE}>{metadata.nodeCount.toLocaleString()}</dd>
          </>
        ) : null}
        {typeof metadata.edgeCount === 'number' ? (
          <>
            <dt style={METADATA_LABEL_STYLE}>Edges</dt>
            <dd style={METADATA_VALUE_STYLE}>{metadata.edgeCount.toLocaleString()}</dd>
          </>
        ) : null}
        {metadata.graphId ? (
          <>
            <dt style={METADATA_LABEL_STYLE}>Graph ID</dt>
            <dd style={METADATA_VALUE_STYLE}>{metadata.graphId}</dd>
          </>
        ) : null}
        {metadata.directed !== undefined ? (
          <>
            <dt style={METADATA_LABEL_STYLE}>Directed</dt>
            <dd style={METADATA_VALUE_STYLE}>{metadata.directed ? 'Yes' : 'No'}</dd>
          </>
        ) : null}
        {metadata.strict !== undefined ? (
          <>
            <dt style={METADATA_LABEL_STYLE}>Strict</dt>
            <dd style={METADATA_VALUE_STYLE}>{metadata.strict ? 'Yes' : 'No'}</dd>
          </>
        ) : null}
      </dl>
      {attributeEntries.length ? (
        <details>
          <summary
            style={{
              cursor: 'pointer',
              fontWeight: 600,
              color: '#0f172a'
            }}
          >
            Additional attributes
          </summary>
          <ul style={METADATA_ATTRIBUTE_LIST_STYLE}>
            {attributeEntries.map(([key, value]) => (
              <li key={key} style={{color: '#475569'}}>
                <strong style={{color: '#0f172a'}}>{key}:</strong> {formatMetadataValue(value)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

type ControlPanelProps = {
  examples: ExampleDefinition[];
  defaultExample?: ExampleDefinition;
  graphType?: GraphExampleType;
  onExampleChange: (example: ExampleDefinition, layout: LayoutType) => void;
  children?: ReactNode;
  layoutOptions?: Record<string, unknown>;
  onLayoutOptionsApply?: (layout: LayoutType, options: Record<string, unknown>) => void;
  metadata?: ExampleMetadata | null;
  dataLoading?: boolean;
};

export function ControlPanel({
  examples,
  defaultExample,
  graphType,
  onExampleChange,
  layoutOptions,
  onLayoutOptionsApply,
  metadata,
  dataLoading,
  children
}: ControlPanelProps) {
  const filteredExamples = useMemo(
    () => filterExamplesByType(examples, graphType),
    [examples, graphType]
  );

  const resolveExampleIndex = useCallback(
    (example?: ExampleDefinition) => {
      if (!example) {
        return 0;
      }

      const index = filteredExamples.findIndex((candidate) => candidate === example);
      return index === -1 ? 0 : index;
    },
    [filteredExamples]
  );

  const [selectedExampleIndex, setSelectedExampleIndex] = useState(() =>
    resolveExampleIndex(defaultExample)
  );
  const selectedExample = filteredExamples[selectedExampleIndex];
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

  const attributeEntries = useMemo(() => {
    if (!metadata?.attributes) {
      return [] as Array<[string, unknown]>;
    }

    return Object.entries(metadata.attributes).filter(([key]) => key.length);
  }, [metadata]);

  if (!filteredExamples.length) {
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
          {filteredExamples.map((example, index) => (
            <option key={example.name} value={index}>
              {example.name}
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
      <MetadataSection
        metadata={metadata}
        dataLoading={dataLoading}
        attributeEntries={attributeEntries}
      />
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
      <LayoutOptionsPanel
        layout={selectedLayout}
        appliedOptions={layoutOptions}
        onApply={onLayoutOptionsApply}
      />
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
          {children}
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
    </div>
  );
}
