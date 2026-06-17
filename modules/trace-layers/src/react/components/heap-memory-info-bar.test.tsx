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
    vi.useRealTimers();
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

  it('shows separate TraceChunkStore and visualization window estimates in the memory popup', () => {
    const view = renderElement(
      <HeapMemoryInfoBar
        buildTraceMemoryReport={() => ({
          traceChunkStoreDiagnostics: createTraceChunkStoreDiagnostics(),
          traceChunkStoreSizeReport: {
            totalBytes: 2 * 1024 * 1024 * 1024,
            bytesByKind: {
              arrow: 2 * 1024 * 1024 * 1024,
              map: 0,
              array: 0,
              object: 0,
              string: 0,
              'typed-array': 0,
              primitive: 0
            },
            entries: [
              {
                path: 'traceChunkStore.processMetadataSnapshots',
                bytes: 1024 * 1024 * 1024,
                kind: 'array'
              },
              {
                path: 'traceChunkStore.spanSidecarRows',
                bytes: 512 * 1024 * 1024,
                kind: 'array'
              }
            ]
          },
          traceChunkStoreObservedHeapDeltaBytes: 3 * 1024 * 1024 * 1024,
          traceChunkStoreUnattributedHeapDeltaBytes: 901 * 1024 * 1024,
          traceChunkStoreReadyChunkCount: 25,
          traceChunkStoreReadySpanCount: 250_000,
          traceVisualizationWindowSizeReport: {
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
          traceEngineDiagnostics: createTraceEngineDiagnostics()
        })}
      />
    );
    hoverMemoryBar(view.container);

    expect(getTooltipText()).toContain('TraceChunkStore');
    expect(getTooltipText()).toContain('Retained payload estimate2 GB');
    expect(getTooltipText()).toContain('Descriptors30');
    expect(getTooltipText()).toContain('Loaded chunks25');
    expect(getTooltipText()).toContain('Loaded spans250,000');
    expect(getTooltipText()).toContain('Observed store heap delta3 GB');
    expect(getTooltipText()).toContain('Unattributed store delta901 MB');
    expect(getTooltipText()).toContain('Process snapshots1 GB');
    expect(getTooltipText()).toContain('Span sidecars512 MB');
    expect(getTooltipText()).toContain('Visualization window');
    expect(getTooltipText()).toContain('TraceGraph estimate123 MB');
    expect(getTooltipText()).toContain('TraceEngine');
    expect(getTooltipText()).toContain('Retained viewer state112 MB');
    expect(getTooltipText()).toContain('Active TraceLayout45 MB');
    expect(getTooltipText()).toContain('Prepared deck inputs67 MB');
    expect(getTooltipText()).toContain('Revision7');
    expect(getTooltipText()).toContain('Last build12.3 ms');
    expect(getTooltipText()).toContain('Estimates are bounded retained drivers');
    expect(getTooltipText()).not.toContain('spanTables.0');
    view.cleanup();
  });

  it('builds trace memory diagnostics only when hovered', () => {
    const buildTraceMemoryReport = vi.fn(() => ({
      traceEngineDiagnostics: createTraceEngineDiagnostics()
    }));
    const view = renderElement(
      <HeapMemoryInfoBar buildTraceMemoryReport={buildTraceMemoryReport} />
    );

    expect(buildTraceMemoryReport).not.toHaveBeenCalled();

    hoverMemoryBar(view.container);

    expect(buildTraceMemoryReport).toHaveBeenCalledTimes(1);
    expect(getTooltipText()).toContain('Retained viewer state112 MB');
    view.cleanup();
  });

  it('keeps small nonzero TraceEngine estimates visible', () => {
    const view = renderElement(
      <HeapMemoryInfoBar
        buildTraceMemoryReport={() => ({
          traceEngineDiagnostics: {
            ...createTraceEngineDiagnostics(),
            traceEngineRetainedSizeBytes: 2918,
            traceLayoutSizeBytes: 2294,
            traceDeckInputsSizeBytes: 624
          }
        })}
      />
    );

    hoverMemoryBar(view.container);

    expect(getTooltipText()).toContain('Retained viewer state2.8 KB');
    expect(getTooltipText()).toContain('Active TraceLayout2.2 KB');
    expect(getTooltipText()).toContain('Prepared deck inputs624 B');
    view.cleanup();
  });

  it('logs a watermark report once until heap usage falls below the reset band', () => {
    vi.useFakeTimers();
    const buildTraceMemoryReport = vi.fn(() => ({
      traceEngineDiagnostics: createTraceEngineDiagnostics()
    }));
    setBrowserHeapMemoryInfo({
      jsHeapSizeLimit: 4 * 1024 * 1024 * 1024,
      totalJSHeapSize: 3.2 * 1024 * 1024 * 1024,
      usedJSHeapSize: 3 * 1024 * 1024 * 1024
    });
    const view = renderElement(
      <HeapMemoryInfoBar buildTraceMemoryReport={buildTraceMemoryReport} />
    );

    expect(buildTraceMemoryReport).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(buildTraceMemoryReport).toHaveBeenCalledTimes(1);

    setBrowserHeapMemoryInfo({
      jsHeapSizeLimit: 4 * 1024 * 1024 * 1024,
      totalJSHeapSize: 2.6 * 1024 * 1024 * 1024,
      usedJSHeapSize: 2.5 * 1024 * 1024 * 1024
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    setBrowserHeapMemoryInfo({
      jsHeapSizeLimit: 4 * 1024 * 1024 * 1024,
      totalJSHeapSize: 3.2 * 1024 * 1024 * 1024,
      usedJSHeapSize: 3 * 1024 * 1024 * 1024
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(buildTraceMemoryReport).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logProbeMock.mock.calls)).toContain('heap watermark diagnostics');
    view.cleanup();
  });

  it('logs detailed trace graph tables when hovered', () => {
    const view = renderElement(
      <HeapMemoryInfoBar
        buildTraceMemoryReport={() => ({
          traceChunkStoreSizeReport: {
            totalBytes: 2 * 1024 * 1024 * 1024,
            bytesByKind: {
              arrow: 0,
              map: 0,
              array: 2 * 1024 * 1024 * 1024,
              object: 0,
              string: 0,
              'typed-array': 0,
              primitive: 0
            },
            entries: [
              {
                path: 'traceChunkStore.processMetadataSnapshots',
                bytes: 2 * 1024 * 1024 * 1024,
                kind: 'array'
              }
            ]
          },
          traceVisualizationWindowSizeReport: {
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
          traceEngineDiagnostics: createTraceEngineDiagnostics()
        })}
      />
    );

    hoverMemoryBar(view.container);

    expect(logTableMock).toHaveBeenCalled();
    expect(JSON.stringify(logTableMock.mock.calls)).toContain('TraceEngine retained viewer state');
    expect(JSON.stringify(logTableMock.mock.calls)).toContain('TraceEngine active TraceLayout');
    expect(JSON.stringify(logTableMock.mock.calls)).toContain(
      'TraceChunkStore retained payload estimate'
    );
    expect(JSON.stringify(logTableMock.mock.calls)).toContain('processMetadataSnapshots');
    expect(JSON.stringify(logTableMock.mock.calls)).toContain(
      'Visualization window TraceGraph estimate'
    );
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

/** Builds cheap TraceChunkStore counters for heap diagnostics tests. */
function createTraceChunkStoreDiagnostics() {
  return {
    descriptorCount: 30,
    readyChunkCount: 25,
    pendingChunkCount: 2,
    failedChunkCount: 1,
    traceWindowCount: 1,
    sourceSpanFilterCount: 0,
    sourceSpanFilterRevision: 0
  };
}

/** Builds cheap TraceEngine counters for heap diagnostics tests. */
function createTraceEngineDiagnostics() {
  return {
    revision: 7,
    lastUpdateReason: 'sync' as const,
    listenerCount: 2,
    displayedGraphCount: 1,
    displayedProcessCount: 4,
    displayedThreadCount: 8,
    displayedSpanCount: 250_000,
    displayedLocalDependencyCount: 320_000,
    displayedCrossDependencyCount: 12_000,
    selectedSpanCount: 1,
    focusedSpanCount: 0,
    selectedLocalDependencyCount: 0,
    selectedCrossDependencyCount: 0,
    activeLayoutCount: 1,
    baseLayoutCount: 1,
    focusedLayoutCount: 0,
    preparedForegroundSceneCount: 1,
    preparedOverviewSceneCount: 1,
    preparedForegroundRowCount: 4,
    preparedForegroundSpanCount: 250_000,
    preparedOverviewRowCount: 4,
    preparedOverviewSpanCount: 250_000,
    buildPhaseTimings: {
      totalDurationMs: 12.3,
      baseLayoutDurationMs: 4.1,
      focusedLayoutDurationMs: 0,
      threadCollapsePruneDurationMs: 0,
      preparedSceneDurationMs: 7.2
    },
    traceEngineRetainedSizeBytes: 112 * 1024 * 1024,
    traceLayoutSizeBytes: 45 * 1024 * 1024,
    traceDeckInputsSizeBytes: 67 * 1024 * 1024,
    retainedSizeEstimateDurationMs: 1
  };
}

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
