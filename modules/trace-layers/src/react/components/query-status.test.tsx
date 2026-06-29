import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  CompactQueryStatus,
  createOrUpdateQueryStatus,
  createQueryStatus,
  resetQueryStatus,
  updateQueryStatus
} from './query-status';

import type {ReactElement} from 'react';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('CompactQueryStatus', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders a loading glyph for active queries', () => {
    const view = renderElement(
      <CompactQueryStatus
        queryStatus={{
          error: null,
          isLoading: true,
          loadStartTimestamp: 100,
          resourceName: 'Rank 8',
          warning: null
        }}
      />
    );

    expect(view.container.textContent).toContain('loading');
    expect(view.container.querySelector('[aria-label="Rank 8 loading"]')).not.toBeNull();
    view.cleanup();
  });

  it('omits fallback loading before a query starts', () => {
    const view = renderElement(<CompactQueryStatus fallbackStatus="loading" />);

    expect(view.container.textContent).toBe('');
    view.cleanup();
  });

  it('renders a success glyph with a duration tooltip', () => {
    const view = renderElement(
      <CompactQueryStatus
        queryStatus={{
          error: null,
          isLoading: false,
          loadEndTimestamp: 1250,
          loadStartTimestamp: 250,
          resourceName: 'Rank 8',
          warning: null
        }}
      />
    );

    expect(view.container.textContent).toContain('✅');
    hoverFirstStatus(view.container);
    expect(getTooltipText()).toContain('Rank 8 loaded in 1.00s');
    view.cleanup();
  });

  it('renders warning and error glyphs with message tooltips', () => {
    const warningView = renderElement(
      <CompactQueryStatus
        queryStatus={{
          error: null,
          isLoading: false,
          loadEndTimestamp: 200,
          loadStartTimestamp: 100,
          resourceName: 'Rank 8',
          warning: new Error('partial data')
        }}
      />
    );
    expect(warningView.container.textContent).toContain('⚠️');
    hoverFirstStatus(warningView.container);
    expect(getTooltipText()).toContain('partial data');
    warningView.cleanup();

    const errorView = renderElement(
      <CompactQueryStatus
        queryStatus={{
          error: new Error('failed to fetch'),
          isLoading: false,
          loadStartTimestamp: 100,
          resourceName: 'Rank 8',
          warning: null
        }}
      />
    );
    expect(errorView.container.textContent).toContain('❌');
    hoverFirstStatus(errorView.container);
    expect(getTooltipText()).toContain('failed to fetch');
    errorView.cleanup();
  });

  it('renders interactive status buttons', () => {
    const onClick = vi.fn();
    const view = renderElement(
      <CompactQueryStatus
        interactive
        onClick={onClick}
        queryStatus={{
          error: new Error('failed to fetch'),
          isLoading: false,
          loadStartTimestamp: 100,
          resourceName: 'Rank 8',
          warning: null
        }}
      />
    );

    act(() => {
      view.container
        .querySelector('button')
        ?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    view.cleanup();
  });
});

describe('query status helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates, updates, creates-or-updates, and resets query statuses', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(250);
    const initial = createQueryStatus('Rank 8');
    const loading = updateQueryStatus(initial, {isLoading: true});
    const loaded = updateQueryStatus(loading, {isLoading: false});
    const created = createOrUpdateQueryStatus(undefined, {isLoading: false}, 'Rank 9');
    const reset = resetQueryStatus(loaded);

    expect(initial.resourceName).toBe('Rank 8');
    expect(loading.loadStartTimestamp).toBe(100);
    expect(loaded.loadEndTimestamp).toBe(250);
    expect(created.resourceName).toBe('Rank 9');
    expect(reset.isLoading).toBe(false);
    expect(reset.loadStartTimestamp).toBeNull();
  });
});

function hoverFirstStatus(container: HTMLElement): void {
  const target = container.querySelector('span,button');
  if (!target) {
    throw new Error('Missing rendered status glyph');
  }

  act(() => {
    target.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
  });
}

function getTooltipText(): string {
  return document.body.querySelector('[role="tooltip"]')?.textContent ?? '';
}

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
