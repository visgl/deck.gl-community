import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {HeapMemoryInfoBar} from './heap-memory-info-bar';

import type {ReactElement} from 'react';

const {logProbeMock, logTableMock} = vi.hoisted(() => ({
  logProbeMock: vi.fn(() => () => undefined),
  logTableMock: vi.fn(() => () => undefined)
}));

vi.mock('../../trace/log', () => ({
  log: {
    probe: logProbeMock,
    table: logTableMock
  }
}));

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('HeapMemoryInfoBar', () => {
  afterEach(() => {
    setBrowserHeapMemoryInfo(null);
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('colors the used-heap bar green, orange, or red as heap pressure rises', () => {
    const lowPressureView = renderHeapMemoryInfoBar({
      jsHeapSizeLimit: 100,
      totalJSHeapSize: 80,
      usedJSHeapSize: 60
    });
    expect(getUsedHeapBar(lowPressureView.container)?.className).toContain('bg-emerald-500/60');
    lowPressureView.cleanup();

    const mediumPressureView = renderHeapMemoryInfoBar({
      jsHeapSizeLimit: 100,
      totalJSHeapSize: 90,
      usedJSHeapSize: 75
    });
    expect(getUsedHeapBar(mediumPressureView.container)?.className).toContain('bg-orange-500/65');
    mediumPressureView.cleanup();

    const highPressureView = renderHeapMemoryInfoBar({
      jsHeapSizeLimit: 100,
      totalJSHeapSize: 95,
      usedJSHeapSize: 90
    });
    expect(getUsedHeapBar(highPressureView.container)?.className).toContain('bg-red-500/70');
    highPressureView.cleanup();
  });

  it('shows compact trace memory totals in the memory popup when provided', () => {
    const view = renderElement(
      <HeapMemoryInfoBar
        buildTraceMemoryReport={() => ({
          traceGraphSizeReport: {
            totalBytes: 123 * 1024 * 1024,
            bytesByKind: {
              arrow: 95 * 1024 * 1024,
              map: 12 * 1024 * 1024,
              array: 8 * 1024 * 1024,
              object: 6 * 1024 * 1024,
              string: 2 * 1024 * 1024,
              'typed-array': 0,
              primitive: 0
            },
            entries: [
              {
                path: 'spanTables.0',
                bytes: 80 * 1024 * 1024,
                kind: 'arrow',
                rowCount: 1000,
                columnCount: 12
              }
            ]
          },
          traceLayoutSizeBytes: 45 * 1024 * 1024,
          traceViewStateSizeBytes: 112 * 1024 * 1024
        })}
      />
    );
    hoverMemoryBar(view.container);

    expect(getTooltipText()).toContain('Tracevis-owned memory');
    expect(getTooltipText()).toContain('TraceGraph retained123 MB');
    expect(getTooltipText()).toContain('TraceViewState retained112 MB');
    expect(getTooltipText()).toContain('TraceLayout retained45 MB');
    expect(getTooltipText()).not.toContain('spanTables.0');
    view.cleanup();
  });

  it('builds expensive trace memory diagnostics only when hovered', () => {
    const buildTraceMemoryReport = vi.fn(() => ({
      traceLayoutSizeBytes: 45 * 1024 * 1024,
      traceViewStateSizeBytes: 112 * 1024 * 1024
    }));
    const view = renderElement(
      <HeapMemoryInfoBar buildTraceMemoryReport={buildTraceMemoryReport} />
    );

    expect(buildTraceMemoryReport).not.toHaveBeenCalled();

    hoverMemoryBar(view.container);

    expect(buildTraceMemoryReport).toHaveBeenCalledTimes(1);
    expect(getTooltipText()).toContain('TraceViewState retained112 MB');
    view.cleanup();
  });

  it('logs detailed trace graph tables when hovered', () => {
    const view = renderElement(
      <HeapMemoryInfoBar
        buildTraceMemoryReport={() => ({
          traceGraphSizeReport: {
            totalBytes: 123 * 1024 * 1024,
            bytesByKind: {
              arrow: 95 * 1024 * 1024,
              map: 0,
              array: 0,
              object: 0,
              string: 0,
              'typed-array': 0,
              primitive: 0
            },
            entries: [
              {
                path: 'spanTables.0',
                bytes: 80 * 1024 * 1024,
                kind: 'arrow',
                rowCount: 1000,
                columnCount: 12
              }
            ]
          },
          traceViewStateSizeBytes: 112 * 1024 * 1024,
          traceLayoutSizeBytes: 45 * 1024 * 1024
        })}
      />
    );

    hoverMemoryBar(view.container);

    expect(logTableMock).toHaveBeenCalled();
    expect(JSON.stringify(logTableMock.mock.calls)).toContain('TraceViewState retained');
    expect(JSON.stringify(logTableMock.mock.calls)).toContain('TraceLayout retained');
    expect(JSON.stringify(logTableMock.mock.calls)).toContain('spanTables.0');
    view.cleanup();
  });
});

type TestBrowserHeapMemoryInfo = {
  /** Maximum JavaScript heap size available to this renderer. */
  jsHeapSizeLimit: number;
  /** JavaScript heap bytes allocated from the OS. */
  totalJSHeapSize: number;
  /** JavaScript heap bytes currently used by live objects. */
  usedJSHeapSize: number;
};

/**
 * Stubs Chromium's non-standard performance.memory object for the next component render.
 */
function setBrowserHeapMemoryInfo(memoryInfo: TestBrowserHeapMemoryInfo | null): void {
  Object.defineProperty(window.performance, 'memory', {
    configurable: true,
    value: memoryInfo ?? undefined
  });
}

function hoverMemoryBar(container: HTMLElement): void {
  const memoryBar = container.querySelector('[aria-label="JavaScript heap memory"]');
  if (!memoryBar) {
    throw new Error('Missing heap memory bar');
  }
  act(() => {
    memoryBar.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
  });
}

function getTooltipText(): string {
  return document.body.querySelector('[role="tooltip"]')?.textContent ?? '';
}

/**
 * Renders the compact heap widget with a browser-memory snapshot installed.
 */
function renderHeapMemoryInfoBar(memoryInfo: TestBrowserHeapMemoryInfo) {
  setBrowserHeapMemoryInfo(memoryInfo);
  return renderElement(<HeapMemoryInfoBar />);
}

/**
 * Finds the foreground used-heap bar by its health color class.
 */
function getUsedHeapBar(container: HTMLElement): HTMLDivElement | undefined {
  return Array.from(container.querySelectorAll('div')).find(
    (element): element is HTMLDivElement =>
      element.className.includes('bg-emerald-500') ||
      element.className.includes('bg-orange-500') ||
      element.className.includes('bg-red-500')
  );
}

/**
 * Renders a React element into a temporary DOM root for component tests.
 */
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
