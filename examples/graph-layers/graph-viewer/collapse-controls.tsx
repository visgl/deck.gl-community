// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React from 'react';

type DagChainSummary = {
  chainIds: string[];
  collapsedIds: string[];
};

export type CollapseControlsProps = {
  enabled: boolean;
  summary: DagChainSummary | null;
  onToggle: () => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 0.5rem',
  fontSize: '0.875rem',
  fontWeight: 600,
  color: '#0f172a'
};

const detailsStyle: React.CSSProperties = {
  fontSize: '0.8125rem',
  color: '#334155',
  margin: '0 0 0.5rem'
};

const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontWeight: 600,
  outline: 'none',
  listStyle: 'none'
};

const descriptionStyle: React.CSSProperties = {
  margin: '0.5rem 0 0',
  lineHeight: 1.5
};

const statusRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: '0.8125rem',
  color: '#475569'
};

const controlsContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  flexWrap: 'wrap'
};

const buttonBaseStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: '0.375rem',
  padding: '0.375rem 0.75rem',
  fontFamily: 'inherit',
  fontSize: '0.8125rem',
  color: '#ffffff'
};

function getToggleButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    ...buttonBaseStyle,
    background: enabled ? '#4c6ef5' : '#1f2937',
    cursor: 'pointer'
  };
}

function getActionButtonStyle(disabled: boolean, background: string): React.CSSProperties {
  return {
    ...buttonBaseStyle,
    background,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1
  };
}

export function CollapseControls({
  enabled,
  summary,
  onToggle,
  onCollapseAll,
  onExpandAll
}: CollapseControlsProps) {
  if (!summary) {
    return null;
  }

  const totalChainCount = summary.chainIds.length;
  const collapsedChainCount = summary.collapsedIds.length;

  const collapseAllDisabled = !enabled || totalChainCount === 0;
  const expandAllDisabled = !enabled || collapsedChainCount === 0;

  return (
    <section style={{fontSize: '0.875rem'}}>
      <h3 style={headingStyle}>Collapsed chains</h3>
      <details style={detailsStyle}>
        <summary style={summaryStyle}>How collapsed chains work</summary>
        <p style={descriptionStyle}>
          Linear chains collapse to a single node marked with plus and minus icons. Use these controls to expand or collapse all
          chains. Individual chains remain interactive on the canvas.
        </p>
      </details>
      <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
        <div style={statusRowStyle}>
          <span>Status</span>
          <span>
            {collapsedChainCount} / {totalChainCount} collapsed
          </span>
        </div>
        <div style={controlsContainerStyle}>
          <button type="button" onClick={onToggle} style={getToggleButtonStyle(enabled)}>
            {enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            type="button"
            onClick={onCollapseAll}
            disabled={collapseAllDisabled}
            style={getActionButtonStyle(collapseAllDisabled, '#2563eb')}
          >
            Collapse all
          </button>
          <button
            type="button"
            onClick={onExpandAll}
            disabled={expandAllDisabled}
            style={getActionButtonStyle(expandAllDisabled, '#16a34a')}
          >
            Expand all
          </button>
        </div>
      </div>
    </section>
  );
}
