// deck.gl-community
// SPDX-License-Identifier: MIT

import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';

import {CollapseControls} from './collapse-controls';

describe('CollapseControls', () => {
  it('returns null when no summary is provided', () => {
    const element = CollapseControls({
      enabled: true,
      summary: null,
      onToggle: () => undefined,
      onCollapseAll: () => undefined,
      onExpandAll: () => undefined
    });

    expect(element).toBeNull();
  });

  it('renders status text derived from the summary', () => {
    const markup = renderToStaticMarkup(
      <CollapseControls
        enabled
        summary={{chainIds: ['a', 'b', 'c'], collapsedIds: ['a', 'b']}}
        onToggle={vi.fn()}
        onCollapseAll={vi.fn()}
        onExpandAll={vi.fn()}
      />
    );

    expect(markup).toContain('Collapsed chains');
    expect(markup).toContain('2 / 3 collapsed');
    expect(markup).toContain('Disable collapse');
    expect(markup).toContain('Collapse all');
    expect(markup).toContain('Expand all');
    expect(markup).toContain('Keyboard shortcuts');
    expect(markup).toContain('Toggle focused chain');
  });
});
