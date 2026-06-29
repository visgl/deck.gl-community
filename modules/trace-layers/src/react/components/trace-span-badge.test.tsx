import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  DEFAULT_TRACE_STYLE,
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_TOPOLOGY
} from '../../trace/index';
import {TraceSpanBadge} from './trace-span-badge';

import type {Root} from 'react-dom/client';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('TraceSpanBadge', () => {
  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows the copy shortcut in copyable tooltips and copies the span text', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText}
    });
    renderTraceSpanBadge(
      <TraceSpanBadge
        traceLabels={DEFAULT_TRACE_STYLE.labels}
        label="rpc...call_user_python"
        tooltipText="rpc.actor.call_user_python"
        copyText="rpc.actor.call_user_python"
      />
    );

    const tooltipRoot = container?.firstElementChild;
    expect(tooltipRoot).not.toBeNull();
    act(() => {
      tooltipRoot?.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
    });

    const tooltip = document.querySelector('[role="tooltip"]');
    const shortcut = tooltip?.querySelector('kbd');
    expect(shortcut?.textContent).toMatch(/C$/);
    expect(shortcut?.className).toContain('font-mono');
    expect(tooltip?.textContent).toContain('to copy');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'c', metaKey: true}));
    });

    expect(writeText).toHaveBeenCalledWith('rpc.actor.call_user_python');
  });

  it('renders filtered badges as outlines instead of filled keyword badges', () => {
    renderTraceSpanBadge(
      <TraceSpanBadge
        traceLabels={DEFAULT_TRACE_STYLE.labels}
        label="filtered-span"
        filtered
        style={{
          backgroundColor: 'rgb(0, 112, 224)',
          color: 'rgb(255, 255, 255)'
        }}
      />
    );

    const badge = container?.querySelector('.group') as HTMLElement | null;
    const label = badge?.querySelector('span');

    expect(badge?.className).toContain('border-muted-foreground');
    expect(badge?.className).toContain('bg-background');
    expect(badge?.style.backgroundColor).not.toBe('rgb(0, 112, 224)');
    expect(label?.className).toContain('text-muted-foreground');
  });

  it('explains filter masks in generated badge tooltips', () => {
    renderTraceSpanBadge(
      <TraceSpanBadge
        traceLabels={DEFAULT_TRACE_STYLE.labels}
        label="filtered-span"
        filterMask={TRACE_SPAN_FILTER_MASK_REGEXP}
      />
    );

    const tooltipRoot = container?.firstElementChild;
    expect(tooltipRoot).not.toBeNull();
    act(() => {
      tooltipRoot?.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
    });

    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toContain('filtered-span (Hidden by: span-name filter)');
  });

  it('uses the source badge color for topology-filtered outlines', () => {
    renderTraceSpanBadge(
      <TraceSpanBadge
        traceLabels={DEFAULT_TRACE_STYLE.labels}
        label="topology-filtered-span"
        filterMask={TRACE_SPAN_FILTER_MASK_TOPOLOGY}
        style={{backgroundColor: 'rgb(12, 34, 56)'}}
      />
    );

    const badge = container?.querySelector('.relative.group') as HTMLElement | null;
    expect(badge?.className).toContain('bg-background');
    expect(badge?.style.borderColor).toBe('rgb(12, 34, 56)');
  });
});

function renderTraceSpanBadge(element: React.ReactElement): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(element);
  });
}
