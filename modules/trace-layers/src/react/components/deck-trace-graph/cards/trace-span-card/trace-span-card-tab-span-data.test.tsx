import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {TraceSpanSpanDataTab} from './trace-span-card-tab-span-data';

import type {Root} from 'react-dom/client';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('TraceSpanSpanDataTab', () => {
  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.restoreAllMocks();
  });

  it('renders external_span_id rows with a hover copy button', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText}
    });

    renderTraceSpanSpanDataTab(
      <TraceSpanSpanDataTab
        rows={[
          ['spanTable.external_span_id', '6149800612493239450'],
          ['spanTable.name', 'trace-span']
        ]}
      />
    );

    const copyButton = container?.querySelector('button[aria-label="Copy external_span_id"]');
    expect(copyButton).toBeInstanceOf(HTMLButtonElement);
    expect(container?.textContent).toContain('6149800612493239450');

    act(() => {
      copyButton?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    });

    expect(writeText).toHaveBeenCalledWith('6149800612493239450');
  });
});

/**
 * Render a Span Data tab into a detached happy-dom root.
 */
function renderTraceSpanSpanDataTab(element: React.ReactElement): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(element);
  });
}
