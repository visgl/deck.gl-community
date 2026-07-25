// @vitest-environment happy-dom

/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {TRACEVIS_EXAMPLE_TRACES} from '../examples/tracevis-examples';
import {TraceCatalogPanel} from './trace-catalog-widget';

import type {AppState} from '../tracevis-store';

let container: HTMLDivElement | null = null;

/** Mounts the trace catalog widget body into a detached test container. */
function renderCatalog(state: AppState) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new TraceCatalogPanel({
    store: {
      getState: () => state,
      subscribe: () => () => undefined
    }
  });
  render(panel.content, container);
}

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  container = null;
});

describe('TraceCatalogPanel', () => {
  it('renders the synthetic example tile and updates example selection', () => {
    const example = TRACEVIS_EXAMPLE_TRACES[0];
    const setExampleTraceSelectionMap = vi.fn();

    renderCatalog({
      tracevis: {
        exampleTraceSelectionMap: {},
        uploadedTraceMetadatas: [],
        uploadedTraceSelectionMap: {},
        uploadTraceFiles: vi.fn(),
        setExampleTraceSelectionMap,
        setUploadedTraceSelectionMap: vi.fn()
      }
    } as unknown as AppState);

    expect(container?.textContent).toContain(example.name);
    expect(container?.textContent).toContain('1 process');
    expect(container?.textContent).toContain('2 threads');
    expect(container?.textContent).toContain('4 spans');
    expect(container?.textContent).toContain('1 dependency');

    const exampleCheckbox = container?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(exampleCheckbox).not.toBeNull();
    exampleCheckbox!.checked = true;
    exampleCheckbox!.dispatchEvent(new Event('change', {bubbles: true}));

    expect(setExampleTraceSelectionMap).toHaveBeenCalledWith({
      [example.traceId]: true
    });
  });

  it('counts selected examples and uploads together for overflow messaging', () => {
    const example = TRACEVIS_EXAMPLE_TRACES[0];

    renderCatalog({
      tracevis: {
        exampleTraceSelectionMap: {
          [example.traceId]: true
        },
        uploadedTraceMetadatas: [
          {traceId: 'uploaded-a', runId: null, type: 'chrome_trace', name: 'uploaded-a'},
          {traceId: 'uploaded-b', runId: null, type: 'chrome_trace', name: 'uploaded-b'}
        ],
        uploadedTraceSelectionMap: {
          'uploaded-a': true,
          'uploaded-b': true
        },
        uploadTraceFiles: vi.fn(),
        setExampleTraceSelectionMap: vi.fn(),
        setUploadedTraceSelectionMap: vi.fn()
      }
    } as unknown as AppState);

    expect(container?.textContent).toContain('Only the first two selected traces render.');
    expect(container?.textContent).toContain('Deselect 1 extra trace');
  });
});
