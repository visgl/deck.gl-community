import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {TRACE_SPAN_FILTER_MASK_SOURCE, TRACE_SPAN_FILTER_MASK_TOPOLOGY} from '../../../trace/index';
import {SpanInspectorHiddenSpanNotice} from './span-inspector-hidden-span-notice';

import type {SpanRef} from '../../../trace/index';
import type {ReactElement} from 'react';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('SpanInspectorHiddenSpanNotice', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders compact first-line navigation in ancestor then descendant order', () => {
    const onNavigateToSpanRef = vi.fn();
    const view = renderElement(
      <SpanInspectorHiddenSpanNotice
        filterMask={TRACE_SPAN_FILTER_MASK_SOURCE | TRACE_SPAN_FILTER_MASK_TOPOLOGY}
        visibleAncestorSpanRef={1 as SpanRef}
        visibleDescendantSpanRef={2 as SpanRef}
        onNavigateToSpanRef={onNavigateToSpanRef}
      />
    );

    const firstLine = view.container.firstElementChild?.firstElementChild;
    expect(firstLine?.children[0]?.tagName.toLowerCase()).toBe('svg');
    expect(Array.from(firstLine?.children ?? []).map(child => child.textContent)).toEqual([
      '',
      'Hidden Span',
      'Go to closest visible',
      'Ancestor',
      'Descendant'
    ]);
    expect(view.container.textContent).toContain('Hidden by: filename filter, topological filter');

    const buttons = Array.from(view.container.querySelectorAll('button'));
    act(() => {
      buttons[0]?.click();
      buttons[1]?.click();
    });
    expect(onNavigateToSpanRef).toHaveBeenNthCalledWith(1, 1);
    expect(onNavigateToSpanRef).toHaveBeenNthCalledWith(2, 2);

    view.cleanup();
  });

  it('uses explicit reason labels without requiring a filter mask', () => {
    const view = renderElement(
      <SpanInspectorHiddenSpanNotice
        reasonLabel="Hidden by: time window"
        visibleAncestorSpanRef={null}
        visibleDescendantSpanRef={null}
        onNavigateToSpanRef={vi.fn()}
      />
    );

    expect(view.container.textContent).toContain('Hidden Span');
    expect(view.container.textContent).toContain('Hidden by: time window');
    expect(view.container.textContent).not.toContain('Go to closest visible');
    expect(view.container.querySelectorAll('button')).toHaveLength(0);

    view.cleanup();
  });
});

function renderElement(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  };
}
