// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React from 'react';

import type {ShortcutHint} from './shortcuts';

const shortcutsSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  padding: '0.75rem 0 0',
  borderTop: '1px solid #cbd5f5',
  marginTop: '0.75rem'
};

const shortcutHeadingStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#0f172a'
};

const shortcutListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  margin: 0,
  padding: 0,
  listStyle: 'none',
  fontSize: '0.75rem',
  color: '#475569'
};

const shortcutItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem'
};

const shortcutKeyStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '1.75rem',
  padding: '0.125rem 0.5rem',
  borderRadius: '0.25rem',
  border: '1px solid #cbd5f5',
  background: '#e2e8f0',
  color: '#0f172a',
  fontSize: '0.75rem',
  fontFamily: 'inherit',
  lineHeight: 1.2
};

export type ShortcutHintsProps = {
  hints: ShortcutHint[];
  heading?: string;
};

export function ShortcutHints({hints, heading = 'Keyboard shortcuts'}: ShortcutHintsProps) {
  if (!hints.length) {
    return null;
  }

  return (
    <div style={shortcutsSectionStyle}>
      <span style={shortcutHeadingStyle}>{heading}</span>
      <ul style={shortcutListStyle}>
        {hints.map(({key, description}) => (
          <li key={`${key}-${description}`} style={shortcutItemStyle}>
            <kbd style={shortcutKeyStyle}>{key}</kbd>
            <span>{description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
