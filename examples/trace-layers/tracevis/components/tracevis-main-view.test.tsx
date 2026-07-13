// @vitest-environment happy-dom

import React from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {TraceGraph} from '@deck.gl-community/trace-layers/trace';

import {TRACEVIS_EXAMPLE_TRACES} from '../examples/tracevis-examples';
import {MainView} from './tracevis-main-view';

import type {
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '@deck.gl-community/trace-layers/trace';
import type {Root} from 'react-dom/client';

const mockState = vi.hoisted(() => ({current: null as any}));
const renderedDeckTraceGraphProps = vi.hoisted(() => ({current: null as any}));
const renderedEmptyDeckProps = vi.hoisted(() => ({current: null as any}));

/** Projects mocked DeckTraceGraph engine and React config props for test assertions. */
function projectRenderedDeckTraceGraphProps(props: {
  /** Mocked mounted TraceEngine exposed by the DeckTraceGraph test double. */
  engine?: {
    /** Returns the mocked engine renderer snapshot. */
    getSnapshot: () => Record<string, unknown>;
  };
  /** Mocked React-owned DeckTraceGraph config props. */
  reactConfig?: Record<string, unknown>;
}) {
  return {
    ...props,
    ...(props.engine?.getSnapshot() ?? {}),
    ...(props.reactConfig ?? {})
  };
}

vi.mock('../tracevis-store', () => ({
  useRoomStore: (selector: (state: unknown) => unknown) => selector(mockState.current),
  roomStore: {
    getState: () => mockState.current,
    subscribe: () => () => undefined
  }
}));
vi.mock('../widgets/trace-catalog-widget', () => ({
  TraceCatalogPanel: class TraceCatalogPanel {
    constructor(public readonly props: unknown) {}
  }
}));
vi.mock('@deck.gl-community/trace-layers/react', () => ({
  BreadcrumbNavigator: () => null,
  DeckTraceGraph: (props: unknown) => {
    renderedDeckTraceGraphProps.current = projectRenderedDeckTraceGraphProps(
      props as Parameters<typeof projectRenderedDeckTraceGraphProps>[0]
    );
    return <div data-testid="deck-trace-graph" />;
  },
  SpanInspectorPopup: ({children}: {children?: React.ReactNode}) => <div>{children}</div>,
  SPAN_INSPECTOR_DEFAULT_WIDTH_PX: 300,
  TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX: 300,
  getRankNumForSpanRef: () => null,
  getSameNameNavigation: () => null,
  getThreadNavigation: () => null,
  getTraceSpanBadgeStyleForRef: () => ({}),
  SpanInspectorHiddenSpanNotice: () => null,
  TraceSpanCard: () => null,
  TRACEVIS_SHORTCUTS: []
}));
vi.mock('@deck.gl-community/widgets', () => ({
  createStudioSettingsWidget: (props: Record<string, unknown>) => ({
    placement: props.placement ?? 'top-left',
    viewId: null,
    props: {id: props.id, ...props}
  }),
  SidebarPanelWidget: class SidebarPanelWidget {
    placement: string;
    viewId: string | null = null;
    props: Record<string, unknown>;

    constructor(props: Record<string, unknown>) {
      this.props = {showCloseButton: false, ...props};
      this.placement = String(props.placement ?? 'top-left');
    }
  }
}));
vi.mock('../lib/vis-settings-panel-definitions', () => ({
  getVisSettingsSchema: () => ({sections: []}),
  getVisSettingsUpdatesFromPanelState: () => ({}),
  toVisSettingsState: () => ({})
}));
vi.mock('@deck.gl/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@deck.gl/core')>();
  return {
    ...actual,
    OrthographicView: class OrthographicView {
      constructor(public readonly props: unknown) {}
    }
  };
});
vi.mock('@deck.gl/react', () => ({
  DeckGL: (props: unknown) => {
    renderedEmptyDeckProps.current = props;
    return <div data-testid="deck-empty-shell" />;
  }
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/**
 * Builds one minimal uploaded-trace process for tracevis demo tests.
 */
function createProcess(processId: string, spanId: string): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: `${processId}-thread`,
    threadId: `${processId}-thread` as TraceThreadId,
    processId
  };
  const block: TraceSpan = {
    type: 'trace-span',
    spanId: spanId as TraceSpanId,
    threadId: thread.threadId,
    processName: processId,
    name: spanId,
    keywords: [],
    primaryTimingKey: 'primary',
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: 0,
        endTimeMs: 1,
        durationMs: 1,
        durationMsAsString: '1ms'
      }
    },
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };

  return {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [block],
    spanMap: {[block.spanId]: block},
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    sameProcessDependencies: [],
    remoteDependencies: []
  };
}

/**
 * Renders a component into a detached happy-dom root.
 */
function renderComponent(element: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => {
    root?.render(element);
  });
}

/**
 * Waits one event-loop turn so async trace loading effects can commit state.
 */
async function waitForQueuedEffects() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

afterEach(() => {
  flushSync(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
  renderedDeckTraceGraphProps.current = null;
  renderedEmptyDeckProps.current = null;
});

describe('MainView', () => {
  it('renders the widget shell before any trace is selected', async () => {
    mockState.current = {
      tracevis: {
        errorMap: {},
        visSettings: {
          traceColorSchemeId: 'processes',
          sameProcessDependencyMode: 'all',
          crossProcessDependencyMode: 'all',
          trackAggregationMode: 'none',
          showInstants: false,
          showCounters: false,
          transitions: false,
          followCriticalPathAnimationMode: 'none',
          criticalPathAnimationIntervalMs: 75,
          criticalPathTrailLength: 1,
          showPathsOnly: false,
          showOverview: false,
          showSubmits: true,
          dependencyOpacity: 1,
          highlightFadeFactor: 0.2,
          extendedSelectionFadeOpacity: 0.2,
          minBlockTimeMs: 0,
          threadDisplayMode: 'all',
          selectedThreadNames: [],
          sortThreads: false,
          lineRoutingMode: 'straight',
          processLayoutMode: 'interleaved',
          layoutDensity: 'comfortable',
          traceOffsetMs: 0,
          traceScale: 1,
          widgetTheme: 'light'
        },
        getSelectedTraceColorScheme: () => ({id: 'processes'}),
        traceColorSchemes: [{id: 'processes'}],
        setVisSettings: vi.fn(),
        setSelectedTimeRange: vi.fn(),
        setError: vi.fn(),
        uploadedTraces: {},
        uploadedTraceMetadatas: [],
        loadTrace: vi.fn(),
        uploadedTraceSelectionMap: {},
        selectedSpanRefs: [],
        setSelectedSpanRefs: vi.fn(),
        defaultSelectionState: {
          selectedSpanRefs: [],
          expandedProcessIds: []
        },
        setExpandedProcessIds: vi.fn(),
        pushBreadcrumb: vi.fn(),
        highlightedSpanRefs: [],
        extendedSelectionMode: 'none',
        navigateToSpanRef: vi.fn(),
        breadcrumb: [],
        breadcrumbIndex: -1,
        goToBreadcrumb: vi.fn()
      }
    };

    renderComponent(<MainView />);
    await waitForQueuedEffects();

    expect(renderedDeckTraceGraphProps.current).toBeNull();
    expect(renderedEmptyDeckProps.current.layers).toEqual([]);
    expect(renderedEmptyDeckProps.current.widgets).toHaveLength(3);
    expect(renderedEmptyDeckProps.current.widgets[1].props.id).toBe('tracevis-theme');
    expect(renderedEmptyDeckProps.current.widgets[2].props.id).toBe('tracevis-studio-settings');
  });

  it('stores uploaded traces as TraceGraph before rendering DeckTraceGraph', async () => {
    mockState.current = {
      tracevis: {
        errorMap: {},
        visSettings: {
          traceColorSchemeId: 'processes',
          sameProcessDependencyMode: 'all',
          crossProcessDependencyMode: 'all',
          trackAggregationMode: 'none',
          showInstants: false,
          showCounters: false,
          transitions: false,
          followCriticalPathAnimationMode: 'none',
          criticalPathAnimationIntervalMs: 75,
          criticalPathTrailLength: 1,
          showPathsOnly: false,
          showOverview: false,
          showSubmits: true,
          dependencyOpacity: 1,
          highlightFadeFactor: 0.2,
          extendedSelectionFadeOpacity: 0.2,
          minBlockTimeMs: 0,
          threadDisplayMode: 'all',
          selectedThreadNames: [],
          sortThreads: false,
          lineRoutingMode: 'straight',
          processLayoutMode: 'interleaved',
          layoutDensity: 'comfortable',
          traceOffsetMs: 0,
          traceScale: 1,
          widgetTheme: 'light'
        },
        getSelectedTraceColorScheme: () => ({id: 'processes'}),
        traceColorSchemes: [{id: 'processes'}],
        setVisSettings: vi.fn(),
        setSelectedTimeRange: vi.fn(),
        setError: vi.fn(),
        uploadedTraces: {
          'trace-a': {traceId: 'trace-a'}
        },
        uploadedTraceMetadatas: [],
        loadTrace: vi.fn(async () => ({
          ranks: [createProcess('rank-1', 'block-1')],
          crossProcessDependencies: []
        })),
        uploadedTraceSelectionMap: {
          'trace-a': true
        },
        selectedSpanRefs: [],
        setSelectedSpanRefs: vi.fn(),
        defaultSelectionState: {
          selectedSpanRefs: [],
          expandedProcessIds: []
        },
        setExpandedProcessIds: vi.fn(),
        pushBreadcrumb: vi.fn(),
        highlightedSpanRefs: [],
        extendedSelectionMode: 'none',
        navigateToSpanRef: vi.fn(),
        breadcrumb: [],
        breadcrumbIndex: -1,
        goToBreadcrumb: vi.fn()
      }
    };

    renderComponent(<MainView />);
    await waitForQueuedEffects();
    await waitForQueuedEffects();

    expect(renderedDeckTraceGraphProps.current.traceGraph).toBeInstanceOf(TraceGraph);
    expect(renderedDeckTraceGraphProps.current.controlWidgetPlacement).toBe('top-right');
    expect(renderedDeckTraceGraphProps.current.deckWidgetTheme).toBeDefined();
    expect(renderedDeckTraceGraphProps.current.widgets[0].props.id).toBe('tracevis-theme');
    expect(renderedDeckTraceGraphProps.current.settingsConfig).toMatchObject({
      label: 'Visualization settings',
      placement: 'top-right',
      visualizationSchema: {sections: []},
      showStudioSettingsWidget: false
    });
    expect(renderedDeckTraceGraphProps.current.settingsConfig.schema).toBeUndefined();
    expect(renderedDeckTraceGraphProps.current.widgets[1].props.id).toBe(
      'tracevis-studio-settings'
    );
  });

  it('loads selected example traces through the shared trace rendering path', async () => {
    const example = TRACEVIS_EXAMPLE_TRACES[0];
    const loadTrace = vi.fn(async () => ({
      ranks: [createProcess('example-rank', 'example-block')],
      crossProcessDependencies: []
    }));

    mockState.current = {
      tracevis: {
        errorMap: {},
        visSettings: {
          traceColorSchemeId: 'processes',
          sameProcessDependencyMode: 'all',
          crossProcessDependencyMode: 'all',
          trackAggregationMode: 'none',
          showInstants: false,
          showCounters: false,
          transitions: false,
          followCriticalPathAnimationMode: 'none',
          criticalPathAnimationIntervalMs: 75,
          criticalPathTrailLength: 1,
          showPathsOnly: false,
          showOverview: false,
          showSubmits: true,
          dependencyOpacity: 1,
          highlightFadeFactor: 0.2,
          extendedSelectionFadeOpacity: 0.2,
          minBlockTimeMs: 0,
          threadDisplayMode: 'all',
          selectedThreadNames: [],
          sortThreads: false,
          lineRoutingMode: 'straight',
          processLayoutMode: 'interleaved',
          layoutDensity: 'comfortable',
          traceOffsetMs: 0,
          traceScale: 1,
          widgetTheme: 'light'
        },
        getSelectedTraceColorScheme: () => ({id: 'processes'}),
        traceColorSchemes: [{id: 'processes'}],
        setVisSettings: vi.fn(),
        setSelectedTimeRange: vi.fn(),
        setError: vi.fn(),
        uploadedTraces: {},
        uploadedTraceMetadatas: [],
        loadTrace,
        exampleTraceSelectionMap: {
          [example.traceId]: true
        },
        uploadedTraceSelectionMap: {},
        selectedSpanRefs: [],
        setSelectedSpanRefs: vi.fn(),
        defaultSelectionState: {
          selectedSpanRefs: [],
          expandedProcessIds: []
        },
        setExpandedProcessIds: vi.fn(),
        pushBreadcrumb: vi.fn(),
        highlightedSpanRefs: [],
        extendedSelectionMode: 'none',
        navigateToSpanRef: vi.fn(),
        breadcrumb: [],
        breadcrumbIndex: -1,
        goToBreadcrumb: vi.fn()
      }
    };

    renderComponent(<MainView />);
    await waitForQueuedEffects();
    await waitForQueuedEffects();

    expect(loadTrace).toHaveBeenCalledWith({
      traceId: example.traceId,
      source: 'example'
    });
    expect(renderedDeckTraceGraphProps.current.traceGraph).toBeInstanceOf(TraceGraph);
  });

  it('keeps the trace catalog sidebar open on the top-left overlay', async () => {
    const buildState = (showOverview: boolean) => ({
      tracevis: {
        errorMap: {},
        visSettings: {
          traceColorSchemeId: 'processes',
          sameProcessDependencyMode: 'all',
          crossProcessDependencyMode: 'all',
          trackAggregationMode: 'none',
          showInstants: false,
          showCounters: false,
          transitions: false,
          followCriticalPathAnimationMode: 'none',
          criticalPathAnimationIntervalMs: 75,
          criticalPathTrailLength: 1,
          showPathsOnly: false,
          showOverview,
          showSubmits: true,
          dependencyOpacity: 1,
          highlightFadeFactor: 0.2,
          extendedSelectionFadeOpacity: 0.2,
          minBlockTimeMs: 0,
          threadDisplayMode: 'all',
          selectedThreadNames: [],
          sortThreads: false,
          lineRoutingMode: 'straight',
          processLayoutMode: 'interleaved',
          layoutDensity: 'comfortable',
          traceOffsetMs: 0,
          traceScale: 1,
          widgetTheme: 'light'
        },
        getSelectedTraceColorScheme: () => ({id: 'processes'}),
        traceColorSchemes: [{id: 'processes'}],
        setVisSettings: vi.fn(),
        setSelectedTimeRange: vi.fn(),
        setError: vi.fn(),
        uploadedTraces: {
          'trace-a': {traceId: 'trace-a'}
        },
        uploadedTraceMetadatas: [],
        loadTrace: vi.fn(async () => ({
          ranks: [createProcess('rank-1', 'block-1')],
          crossProcessDependencies: []
        })),
        uploadedTraceSelectionMap: {
          'trace-a': true
        },
        selectedSpanRefs: [],
        setSelectedSpanRefs: vi.fn(),
        defaultSelectionState: {
          selectedSpanRefs: [],
          expandedProcessIds: []
        },
        setExpandedProcessIds: vi.fn(),
        pushBreadcrumb: vi.fn(),
        highlightedSpanRefs: [],
        extendedSelectionMode: 'none',
        navigateToSpanRef: vi.fn(),
        breadcrumb: [],
        breadcrumbIndex: -1,
        goToBreadcrumb: vi.fn()
      }
    });

    mockState.current = buildState(false);
    renderComponent(<MainView />);
    await waitForQueuedEffects();
    await waitForQueuedEffects();

    let traceCatalogWidget = renderedDeckTraceGraphProps.current.widgets[2];
    expect(traceCatalogWidget.placement).toBe('top-left');
    expect(traceCatalogWidget.props.defaultOpen).toBe(true);
    expect(traceCatalogWidget.props.button).toBe(true);
    expect(traceCatalogWidget.props.showCloseButton).toBe(false);
    expect(traceCatalogWidget.viewId).toBeNull();

    mockState.current = buildState(true);
    flushSync(() => {
      root?.render(<MainView />);
    });
    await waitForQueuedEffects();
    await waitForQueuedEffects();

    traceCatalogWidget = renderedDeckTraceGraphProps.current.widgets[2];
    expect(traceCatalogWidget.placement).toBe('top-left');
    expect(traceCatalogWidget.viewId).toBeNull();
  });
});
