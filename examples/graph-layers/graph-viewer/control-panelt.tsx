// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useMemo, useState} from 'react';

export type LayoutType = 'd3-force-layout' | 'gpu-force-layout' | 'simple-layout';

export type ExampleDefinition = {
  name: string;
  description: string;
  data: () => {nodes: unknown[]; edges: unknown[]};
  /** First listed layout is the default */
  layouts: LayoutType[];
  layoutDescriptions?: Partial<Record<LayoutType, string>>;
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

  const layoutDescription = useMemo(() => {
    if (!selectedExample || !selectedLayout) {
      return undefined;
    }

    return selectedExample.layoutDescriptions?.[selectedLayout] ?? selectedExample.description;
  }, [selectedExample, selectedLayout]);

  if (!examples.length) {
    return null;
  }

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.5rem 0'}}>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: '1rem'}}>
        <label style={{display: 'flex', flexDirection: 'column', fontSize: '0.875rem'}}>
          Data
          <select value={selectedExampleIndex} onChange={handleExampleChange}>
            {examples.map((example, index) => (
              <option key={example.name} value={index}>
                {example.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{display: 'flex', flexDirection: 'column', fontSize: '0.875rem'}}>
          Layout
          <select value={selectedLayout} onChange={handleLayoutChange} disabled={!availableLayouts.length}>
            {availableLayouts.map((layout) => (
              <option key={layout} value={layout}>
                {LAYOUT_LABELS[layout] ?? layout}
              </option>
            ))}
          </select>
        </label>
      </div>
      {layoutDescription ? (
        <div style={{fontSize: '0.875rem', lineHeight: 1.4}}>{layoutDescription}</div>
      ) : null}
    </div>
  );
}
