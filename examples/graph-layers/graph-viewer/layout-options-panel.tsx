// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useId, useState} from 'react';
import type {LayoutType, DagLayoutFormState, DagNumericKey, DagSelectKey} from './layout-options';
import {createDagFormState, mapDagFormStateToOptions} from './layout-options';

type LayoutOptionsPanelProps = {
  layout?: LayoutType;
  appliedOptions?: Record<string, unknown>;
  onApply?: (layout: LayoutType, options: Record<string, unknown>) => void;
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: '#0f172a'
};

const SELECT_STYLE: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '0.8125rem',
  padding: '0.375rem 0.5rem',
  borderRadius: '0.375rem',
  border: '1px solid #cbd5f5',
  backgroundColor: '#ffffff',
  color: '#0f172a'
};

const INPUT_STYLE: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '0.8125rem',
  padding: '0.375rem 0.5rem',
  borderRadius: '0.375rem',
  border: '1px solid #cbd5f5',
  color: '#0f172a',
  backgroundColor: '#ffffff'
};

const FIELD_GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  columnGap: '0.75rem',
  rowGap: '0.5rem',
  alignItems: 'center'
};

const CHECKBOX_GROUP_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '0.5rem'
};

const CHECKBOX_LABEL_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  fontSize: '0.8125rem',
  color: '#334155'
};

function DagLayoutOptionsSection({
  appliedOptions,
  onApply
}: {
  appliedOptions?: Record<string, unknown>;
  onApply?: (options: Record<string, unknown>) => void;
}) {
  const [formState, setFormState] = useState<DagLayoutFormState>(() =>
    createDagFormState(appliedOptions)
  );
  const fieldGroupId = useId();

  useEffect(() => {
    setFormState(createDagFormState(appliedOptions));
  }, [appliedOptions]);

  const updateFormState = useCallback(
    (updater: (current: DagLayoutFormState) => DagLayoutFormState) => {
      setFormState((current) => {
        const nextState = updater(current);
        if (onApply) {
          onApply(mapDagFormStateToOptions(nextState));
        }
        return nextState;
      });
    },
    [onApply]
  );

  const handleSelectChange = useCallback(
    <K extends DagSelectKey>(key: K) => {
      return (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value as DagLayoutFormState[K];
        updateFormState((current) => ({
          ...current,
          [key]: value
        }));
      };
    },
    [updateFormState]
  );

  const handleNumberChange = useCallback(
    <K extends DagNumericKey>(key: K) => {
      return (event: React.ChangeEvent<HTMLInputElement>) => {
        const numericValue = Number(event.target.value);
        updateFormState((current) => ({
          ...current,
          [key]: Number.isFinite(numericValue)
            ? (numericValue as DagLayoutFormState[K])
            : current[key]
        }));
      };
    },
    [updateFormState]
  );

  const handleCheckboxChange = useCallback(<K extends 'centerX' | 'centerY'>(key: K) => {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      updateFormState((current) => ({
        ...current,
        [key]: event.target.checked
      }));
    };
  }, [updateFormState]);

  return (
    <section
      style={{
        borderTop: '1px solid #e2e8f0',
        paddingTop: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        fontSize: '0.875rem',
        color: '#334155'
      }}
    >
      <div style={FIELD_GRID_STYLE}>
        <label htmlFor={`${fieldGroupId}-layout`} style={LABEL_STYLE}>
          Layout operator
        </label>
        <select
          id={`${fieldGroupId}-layout`}
          value={formState.layout}
          onChange={handleSelectChange('layout')}
          style={SELECT_STYLE}
        >
          <option value="sugiyama">Sugiyama</option>
          <option value="grid">Grid</option>
          <option value="zherebko">Zherebko</option>
        </select>
        <label htmlFor={`${fieldGroupId}-layering`} style={LABEL_STYLE}>
          Layering
        </label>
        <select
          id={`${fieldGroupId}-layering`}
          value={formState.layering}
          onChange={handleSelectChange('layering')}
          style={SELECT_STYLE}
        >
          <option value="topological">Topological</option>
          <option value="longestPath">Longest path</option>
          <option value="simplex">Simplex</option>
        </select>
        <label htmlFor={`${fieldGroupId}-node-rank`} style={LABEL_STYLE}>
          Node rank
        </label>
        <select
          id={`${fieldGroupId}-node-rank`}
          value={formState.nodeRank}
          onChange={handleSelectChange('nodeRank')}
          style={SELECT_STYLE}
        >
          <option value="none">Automatic</option>
          <option value="rank">Use node.rank</option>
        </select>
        <label htmlFor={`${fieldGroupId}-decross`} style={LABEL_STYLE}>
          Decross
        </label>
        <select
          id={`${fieldGroupId}-decross`}
          value={formState.decross}
          onChange={handleSelectChange('decross')}
          style={SELECT_STYLE}
        >
          <option value="twoLayer">Two layer</option>
          <option value="opt">Opt</option>
          <option value="dfs">DFS</option>
        </select>
        <label htmlFor={`${fieldGroupId}-coord`} style={LABEL_STYLE}>
          Coordinate assignment
        </label>
        <select
          id={`${fieldGroupId}-coord`}
          value={formState.coord}
          onChange={handleSelectChange('coord')}
          style={SELECT_STYLE}
        >
          <option value="greedy">Greedy</option>
          <option value="simplex">Simplex</option>
          <option value="quad">Quad</option>
          <option value="center">Center</option>
          <option value="topological">Topological</option>
        </select>
        <label htmlFor={`${fieldGroupId}-orientation`} style={LABEL_STYLE}>
          Orientation
        </label>
        <select
          id={`${fieldGroupId}-orientation`}
          value={formState.orientation}
          onChange={handleSelectChange('orientation')}
          style={SELECT_STYLE}
        >
          <option value="TB">Top to bottom</option>
          <option value="BT">Bottom to top</option>
          <option value="LR">Left to right</option>
          <option value="RL">Right to left</option>
        </select>
        <label htmlFor={`${fieldGroupId}-dag-builder`} style={LABEL_STYLE}>
          DAG builder
        </label>
        <select
          id={`${fieldGroupId}-dag-builder`}
          value={formState.dagBuilder}
          onChange={handleSelectChange('dagBuilder')}
          style={SELECT_STYLE}
        >
          <option value="graph">Graph</option>
          <option value="connect">Connect</option>
          <option value="stratify">Stratify</option>
        </select>
      </div>
      <div style={FIELD_GRID_STYLE}>
        <label htmlFor={`${fieldGroupId}-node-width`} style={LABEL_STYLE}>
          Node width
        </label>
        <input
          id={`${fieldGroupId}-node-width`}
          type="number"
          value={formState.nodeWidth}
          onChange={handleNumberChange('nodeWidth')}
          style={INPUT_STYLE}
        />
        <label htmlFor={`${fieldGroupId}-node-height`} style={LABEL_STYLE}>
          Node height
        </label>
        <input
          id={`${fieldGroupId}-node-height`}
          type="number"
          value={formState.nodeHeight}
          onChange={handleNumberChange('nodeHeight')}
          style={INPUT_STYLE}
        />
        <label htmlFor={`${fieldGroupId}-gap-x`} style={LABEL_STYLE}>
          Gap X
        </label>
        <input
          id={`${fieldGroupId}-gap-x`}
          type="number"
          value={formState.gapX}
          onChange={handleNumberChange('gapX')}
          style={INPUT_STYLE}
        />
        <label htmlFor={`${fieldGroupId}-gap-y`} style={LABEL_STYLE}>
          Gap Y
        </label>
        <input
          id={`${fieldGroupId}-gap-y`}
          type="number"
          value={formState.gapY}
          onChange={handleNumberChange('gapY')}
          style={INPUT_STYLE}
        />
        <label htmlFor={`${fieldGroupId}-separation-x`} style={LABEL_STYLE}>
          Separation X
        </label>
        <input
          id={`${fieldGroupId}-separation-x`}
          type="number"
          value={formState.separationX}
          onChange={handleNumberChange('separationX')}
          style={INPUT_STYLE}
        />
        <label htmlFor={`${fieldGroupId}-separation-y`} style={LABEL_STYLE}>
          Separation Y
        </label>
        <input
          id={`${fieldGroupId}-separation-y`}
          type="number"
          value={formState.separationY}
          onChange={handleNumberChange('separationY')}
          style={INPUT_STYLE}
        />
      </div>
      <div style={CHECKBOX_GROUP_STYLE}>
        <label style={CHECKBOX_LABEL_STYLE}>
          <input
            type="checkbox"
            checked={formState.centerX}
            onChange={handleCheckboxChange('centerX')}
            style={{width: '1rem', height: '1rem'}}
          />
          Center horizontally
        </label>
        <label style={CHECKBOX_LABEL_STYLE}>
          <input
            type="checkbox"
            checked={formState.centerY}
            onChange={handleCheckboxChange('centerY')}
            style={{width: '1rem', height: '1rem'}}
          />
          Center vertically
        </label>
      </div>
    </section>
  );
}

export function LayoutOptionsPanel({
  layout,
  appliedOptions,
  onApply
}: LayoutOptionsPanelProps) {
  if (!layout) {
    return null;
  }

  if (layout === 'd3-dag-layout') {
    return (
      <details defaultOpen style={{borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem'}}>
        <summary
          style={{
            margin: 0,
            fontSize: '0.875rem',
            fontWeight: 600,
            color: '#0f172a',
            cursor: 'pointer'
          }}
        >
          Layout options
        </summary>
        <p style={{margin: '0.5rem 0', fontSize: '0.8125rem', color: '#475569'}}>
          Tune the D3 DAG layout operators and spacing. Changes apply immediately when adjusted.
        </p>
        <DagLayoutOptionsSection
          appliedOptions={appliedOptions}
          onApply={onApply ? (options) => onApply(layout, options) : undefined}
        />
      </details>
    );
  }

  return (
    <details style={{borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem', fontSize: '0.8125rem'}}>
      <summary
        style={{
          margin: 0,
          fontSize: '0.875rem',
          fontWeight: 600,
          color: '#0f172a',
          cursor: 'pointer'
        }}
      >
        Layout options
      </summary>
      <p style={{margin: '0.5rem 0 0', color: '#475569'}}>
        This layout does not expose configurable options in the control panel yet.
      </p>
    </details>
  );
}
