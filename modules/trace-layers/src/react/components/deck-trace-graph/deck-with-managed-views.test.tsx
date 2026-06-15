import {act, createRef} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {fitBoundsOrthographic} from '@deck.gl-community/infovis-layers';

import {
  applyDeckViewAnchorTransition,
  applyManagedMainViewConstraints,
  buildManagedDeckViews,
  buildManagedMainMinZoomX,
  buildManagedOverviewViewState,
  DeckWithManagedViews
} from './deck-with-managed-views';

import type {DeckWithManagedViewsRef} from './deck-with-managed-views';
import type {Bounds} from '@deck.gl-community/infovis-layers';
import type {CSSProperties, RefObject} from 'react';
import type {Root} from 'react-dom/client';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT =
  true;

type MockWidgetProps = {
  /** Stable widget id used for lookup assertions. */
  id?: string;
  /** Deck widget placement slot used by the mocked widget. */
  placement?: string;
  /** Deck view id scoped to the mocked widget. */
  viewId?: string | null;
  /** Internal deck widget container override. */
  _container?: HTMLDivElement | string | null;
  /** Inline style overrides forwarded to the mocked widget. */
  style?: CSSProperties;
  /** Minimum widget zoom used by zoom-control mocks. */
  minZoom?: number;
  /** Maximum widget zoom used by zoom-control mocks. */
  maxZoom?: number;
  /** Scrollbar orientation requested by the managed deck wrapper. */
  orientation?: string;
  /** Scrollbar content bounds requested by the managed deck wrapper. */
  contentBounds?: Bounds;
  /** Accessible label for the scrollbar start step button. */
  startButtonAriaLabel?: string;
  /** Accessible label for the scrollbar end step button. */
  endButtonAriaLabel?: string;
  /** Accessible label for custom widget buttons. */
  label?: string;
  /** Custom widget icon data URL. */
  icon?: string;
  /** Callback invoked by custom reset-view widgets. */
  onReset?: () => void;
  /** Callback invoked by command-backed reset-view widgets. */
  onCommand?: () => void;
};

type RenderDeckWithManagedViewsArgs = {
  /** Whether the overview minimap is rendered. */
  isOverviewEnabled?: boolean;
  /** Whether the thread legend is collapsed into a process-label overlay. */
  collapseLegendToProcessLabelOverlay?: boolean;
  /** Whether the main timeline vertical scrollbar is requested by the app timeline view. */
  showMainVerticalScrollbar?: boolean;
  /** Whether Tracevis-owned default widgets should render. */
  showDefaultWidgets?: boolean;
  /** Optional bounds used when fitting the overview minimap. */
  overviewBounds?: Bounds;
  /** Trace drag interaction mode passed into synchronized deck views. */
  traceDragInteractionMode?: 'drag-to-zoom' | 'drag-to-pan';
  /** Whether to collect app-owned luma timestamp queries for Deck GPU timing stats. */
  enableDeckGpuTimeStats?: boolean;
  /** Whether Deck should continuously redraw for active layer animations. */
  enableDeckAnimation?: boolean;
  /** Optional one-shot anchor correction applied to the managed main view. */
  viewAnchorTransition?: {key: string; deltaY: number} | null;
  /** Caller-provided widgets rendered alongside managed built-in widgets. */
  widgets?: Array<InstanceType<typeof mockState.MockWidget>>;
  /** Optional imperative ref used by tests that exercise managed view commands. */
  deckRef?: RefObject<DeckWithManagedViewsRef | null>;
};

const mockState = vi.hoisted(() => {
  const controllerInstances: Array<{
    panByCalls: Array<{
      delta: [number, number];
      options?: {transition?: boolean; transitionDurationMs?: number};
    }>;
    zoomXByCalls: Array<{
      delta: number;
      options?: {transition?: boolean; transitionDurationMs?: number};
    }>;
    fitToBoundsCalls: Array<{bounds: Bounds; transition: boolean}>;
    fitEntireBoundsCalls: Array<{bounds: Bounds; transition: boolean}>;
    width: number;
    height: number;
  }> = [];

  class HoistedMockWidget {
    props: MockWidgetProps;
    placement: string;
    viewId: string | null;

    constructor(props: MockWidgetProps = {}) {
      this.props = props;
      this.placement = props.placement ?? 'top-left';
      this.viewId = props.viewId ?? null;
    }
  }

  class HoistedMockToastWidget extends HoistedMockWidget {
    constructor(props: MockWidgetProps = {}) {
      super({id: 'toast', placement: 'bottom-right', ...props});
    }
  }

  class HoistedMockTraceGraphController {
    panByCalls: Array<{
      delta: [number, number];
      options?: {transition?: boolean; transitionDurationMs?: number};
    }> = [];
    zoomXByCalls: Array<{
      delta: number;
      options?: {transition?: boolean; transitionDurationMs?: number};
    }> = [];
    fitToBoundsCalls: Array<{bounds: Bounds; transition: boolean}> = [];
    fitEntireBoundsCalls: Array<{bounds: Bounds; transition: boolean}> = [];
    width = 0;
    height = 0;

    constructor() {
      controllerInstances.push(this);
    }

    fitToBounds(bounds: Bounds, transition: boolean) {
      this.fitToBoundsCalls.push({bounds, transition});
      return {target: [1, 2], zoomX: -1, zoomY: 1};
    }

    fitEntireBounds(bounds: Bounds, transition: boolean) {
      this.fitEntireBoundsCalls.push({bounds, transition});
      return {target: [3, 4], zoomX: -2, zoomY: 2};
    }

    zoomToSpan() {
      return null;
    }

    centerOnSpan() {
      return null;
    }

    panTo() {
      return null;
    }

    panBy(
      delta: [number, number],
      options?: {transition?: boolean; transitionDurationMs?: number}
    ) {
      this.panByCalls.push({delta, options});
      return {target: [0, 0], zoomX: 0, zoomY: 0};
    }

    zoomXBy(delta: number, options?: {transition?: boolean; transitionDurationMs?: number}) {
      this.zoomXByCalls.push({delta, options});
      return {target: [0, 0], zoomX: delta, zoomY: 0};
    }
  }

  const deckMetrics = {
    gpuTime: 0,
    gpuTimePerFrame: 0
  };
  const gpuTimeStat = {
    time: 0,
    samples: 0,
    addTime(timeMs: number) {
      this.time += timeMs;
      this.samples += 1;
    },
    getAverageTime() {
      return this.samples > 0 ? this.time / this.samples : 0;
    }
  };
  const deckStats = {
    get(name: string) {
      return name === 'GPU Time' ? gpuTimeStat : null;
    }
  };

  return {
    MockWidget: HoistedMockWidget,
    MockToastWidget: HoistedMockToastWidget,
    MockTraceGraphController: HoistedMockTraceGraphController,
    controllerInstances,
    deckMetrics,
    deckStats,
    gpuTimeStat,
    lastDeckProps: null as Record<string, unknown> | null,
    synchronizedViewArgs: [] as Record<string, unknown>[]
  };
});

vi.mock('@deck.gl/react', async () => {
  const ReactModule = await import('react');

  return {
    DeckGL: ReactModule.forwardRef(function MockDeckGL(props: Record<string, any>, ref) {
      ReactModule.useImperativeHandle(ref, () => ({
        deck: {
          isInitialized: true,
          metrics: mockState.deckMetrics,
          stats: mockState.deckStats,
          getViewports: () => [{id: 'main', width: 960, height: 504}]
        }
      }));
      ReactModule.useEffect(() => {
        props.onResize?.({width: 960, height: 540});
      }, []);
      mockState.lastDeckProps = props;
      return <div data-testid="mock-deck-gl" />;
    })
  };
});

vi.mock('@deck.gl/widgets', () => ({
  _FpsWidget: class MockFpsWidget extends mockState.MockWidget {
    constructor(props: MockWidgetProps = {}) {
      super({id: 'fps', placement: 'top-right', ...props});
    }
  },
  _StatsWidget: class MockStatsWidget extends mockState.MockWidget {
    constructor(props: MockWidgetProps = {}) {
      super({id: 'deck-stats', placement: 'top-right', ...props});
    }
  },
  FullscreenWidget: class MockFullscreenWidget extends mockState.MockWidget {
    constructor(props: MockWidgetProps = {}) {
      super({id: 'fullscreen', placement: 'top-left', ...props});
    }
  },
  ResetViewWidget: class MockResetViewWidget extends mockState.MockWidget {
    constructor(props: MockWidgetProps = {}) {
      super({id: 'reset-view', placement: 'top-left', ...props});
    }
  },
  ScrollbarWidget: class MockScrollbarWidget extends mockState.MockWidget {
    constructor(props: MockWidgetProps = {}) {
      super({id: 'scrollbar', placement: 'top-right', ...props});
    }
  },
  ZoomWidget: class MockZoomWidget extends mockState.MockWidget {
    constructor(props: MockWidgetProps = {}) {
      super({id: 'zoom', placement: 'top-right', ...props});
    }
  },
  LightTheme: {
    '--button-text': '#111827',
    '--widget-margin': '8px'
  }
}));

vi.mock('@deck.gl-community/infovis-layers', () => ({
  buildViewsFromViewLayout: () => {
    return {views: [], rectsById: {}};
  },
  fitBoundsOrthographic: vi.fn(() => ({
    target: [0, 0],
    zoom: [0, 0]
  }))
}));

vi.mock('../../../layers', () => ({
  DeckTraceGraphController: mockState.MockTraceGraphController,
  buildTracevisViewLayout: (args: Record<string, unknown>) => {
    mockState.synchronizedViewArgs.push(args);
    return {type: 'mock-tracevis-layout'};
  },
  ToastWidget: mockState.MockToastWidget
}));

vi.mock('@deck.gl-community/panels', () => ({
  commandManager: {
    registerCommand: vi.fn(() => () => undefined)
  }
}));

vi.mock('@deck.gl-community/widgets', () => ({
  CommandResetViewWidget: class MockCommandResetViewWidget extends mockState.MockWidget {
    constructor(props: MockWidgetProps = {}) {
      super({id: props.id ?? 'command-reset', placement: 'top-right', ...props});
    }

    onRenderHTML(rootElement: HTMLElement) {
      const button = document.createElement('button');
      button.setAttribute('aria-label', this.props.label ?? 'Reset View');
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this.props.onCommand?.();
      });
      rootElement.append(button);
    }
  },
  HeapMemoryWidget: class MockHeapMemoryWidget extends mockState.MockWidget {
    constructor(props: MockWidgetProps = {}) {
      super({id: 'heap-memory', placement: 'top-right', ...props});
    }
  }
}));

class ExternalWidget extends mockState.MockWidget {
  constructor(props: MockWidgetProps = {}) {
    super({id: 'external-widget', placement: 'bottom-left', ...props});
  }
}

class HelpWidget extends mockState.MockWidget {
  constructor(props: MockWidgetProps = {}) {
    super({id: 'tracevis-help', placement: 'top-left', ...props});
  }
}

class TraceCatalogWidget extends mockState.MockWidget {
  constructor(props: MockWidgetProps = {}) {
    super({id: 'tracevis-trace-catalog', placement: 'bottom-left', ...props});
  }
}

class StudioSettingsWidget extends mockState.MockWidget {
  constructor(props: MockWidgetProps = {}) {
    super({id: 'tracevis-studio-settings', placement: 'top-right', ...props});
  }
}

class TimeMeasureWidget extends mockState.MockWidget {
  constructor(props: MockWidgetProps = {}) {
    super({id: 'time-measure', placement: 'top-right', ...props});
  }
}

class ThemeWidget extends mockState.MockWidget {
  constructor(props: MockWidgetProps = {}) {
    super({id: 'tracevis-theme', placement: 'top-right', ...props});
  }
}

class HoverPopupWidget extends mockState.MockWidget {
  constructor(props: MockWidgetProps = {}) {
    super({id: 'tracevis-hover-popup', placement: 'fill', ...props});
  }
}

class OverviewToggleWidget extends mockState.MockWidget {
  constructor(props: MockWidgetProps = {}) {
    super({id: 'tracevis-overview-toggle', placement: 'bottom-right', ...props});
  }
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderDeckWithManagedViews(args?: RenderDeckWithManagedViewsArgs) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  const render = (nextArgs?: RenderDeckWithManagedViewsArgs) => {
    root?.render(
      <DeckWithManagedViews
        bounds={[
          [0, 0],
          [100, 100]
        ]}
        overviewBounds={nextArgs?.overviewBounds}
        layers={[]}
        layerFilter={() => true}
        widgets={(nextArgs?.widgets ?? [new ExternalWidget()]) as any}
        onHover={() => null}
        onClick={() => null}
        isOverviewEnabled={nextArgs?.isOverviewEnabled ?? false}
        collapseLegendToProcessLabelOverlay={nextArgs?.collapseLegendToProcessLabelOverlay ?? false}
        showMainVerticalScrollbar={nextArgs?.showMainVerticalScrollbar ?? false}
        showDefaultWidgets={nextArgs?.showDefaultWidgets}
        traceDragInteractionMode={nextArgs?.traceDragInteractionMode}
        enableDeckGpuTimeStats={nextArgs?.enableDeckGpuTimeStats}
        enableDeckAnimation={nextArgs?.enableDeckAnimation}
        viewAnchorTransition={nextArgs?.viewAnchorTransition}
        ref={nextArgs?.deckRef}
      />
    );
  };

  await act(async () => {
    flushSync(() => {
      render(args);
    });
  });

  return Object.assign(container, {
    rerender: async (nextArgs?: RenderDeckWithManagedViewsArgs) => {
      await act(async () => {
        flushSync(() => {
          render(nextArgs);
        });
      });
    }
  });
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
  mockState.deckMetrics.gpuTime = 0;
  mockState.deckMetrics.gpuTimePerFrame = 0;
  mockState.gpuTimeStat.time = 0;
  mockState.gpuTimeStat.samples = 0;
  mockState.lastDeckProps = null;
  mockState.synchronizedViewArgs = [];
  mockState.controllerInstances.length = 0;
  vi.mocked(fitBoundsOrthographic).mockReset();
  vi.mocked(fitBoundsOrthographic).mockImplementation(() => ({
    target: [0, 0],
    zoomX: 0,
    zoomY: 0
  }));
});

describe('DeckWithManagedViews', () => {
  it('builds managed deck views from prepared layout inputs', () => {
    buildManagedDeckViews({
      deckDimensions: {width: 640, height: 480},
      collapseLegendToProcessLabelOverlay: true,
      isRunEventViewEnabled: true,
      isOverviewEnabled: true,
      traceDragInteractionMode: 'drag-to-pan'
    });

    expect(mockState.synchronizedViewArgs.at(-1)).toMatchObject({
      headerViewHeight: 36,
      collapseLegendToProcessLabelOverlay: true,
      runEventViewHeight: 40,
      minimap: true,
      minimapViewHeight: 150,
      traceDragInteractionMode: 'drag-to-pan'
    });
  });

  it('builds capped overview view state from minimap bounds', () => {
    vi.mocked(fitBoundsOrthographic).mockReturnValueOnce({
      target: [0, 0],
      zoomX: -5,
      zoomY: 8
    });
    const overviewBounds: Bounds = [
      [10, 20],
      [80, 40]
    ];

    const overviewViewState = buildManagedOverviewViewState({
      deckDimensions: {width: 960, height: 540},
      bounds: [
        [0, 0],
        [100, 100]
      ],
      overviewBounds,
      isOverviewEnabled: true
    });

    expect(fitBoundsOrthographic).toHaveBeenLastCalledWith(960, 150, overviewBounds, 'per-axis');
    expect(overviewViewState).toMatchObject({
      target: [0, 0],
      zoomX: -5,
      zoomY: 4
    });
  });

  it('derives main X zoom floor without mutating view state objects', () => {
    const thirteenHoursMs = 13 * 60 * 60 * 1000;
    const mainMinZoomX = buildManagedMainMinZoomX({
      deckWidth: 960,
      bounds: [
        [0, 0],
        [100, 100]
      ],
      overviewBounds: [
        [0, 0],
        [thirteenHoursMs, 100]
      ],
      isOverviewEnabled: true,
      collapseLegendToProcessLabelOverlay: true
    });
    const viewState = {
      target: [0, 0] as [number, number],
      zoomX: -5,
      zoomY: 5,
      minZoomX: -12,
      maxZoomX: 6
    };

    const constrainedViewState = applyManagedMainViewConstraints(viewState, mainMinZoomX);

    expect(mainMinZoomX).toBeCloseTo(Math.log2((960 - 75 * 2) / thirteenHoursMs) - 0.5);
    expect(constrainedViewState).not.toBe(viewState);
    expect(constrainedViewState.minZoomX).toBe(mainMinZoomX);
    expect(viewState.minZoomX).toBe(-12);
    expect(applyManagedMainViewConstraints(constrainedViewState, mainMinZoomX)).toBe(
      constrainedViewState
    );
  });

  it('passes the animation redraw flag to DeckGL only when requested', async () => {
    const rendered = await renderDeckWithManagedViews({enableDeckAnimation: false});

    expect(mockState.lastDeckProps?._animate).toBe(false);

    await rendered.rerender({enableDeckAnimation: true});

    expect(mockState.lastDeckProps?._animate).toBe(true);
  });

  it('keeps deck views stable across unrelated rerenders', async () => {
    const rendered = await renderDeckWithManagedViews({enableDeckAnimation: false});
    const deckViews = mockState.lastDeckProps?.views;

    await rendered.rerender({enableDeckAnimation: true});

    expect(mockState.lastDeckProps?.views).toBe(deckViews);
  });

  it('disables deck typed-array over-allocation for trace-sized attribute buffers', async () => {
    await renderDeckWithManagedViews();

    expect(mockState.lastDeckProps?._typedArrayManagerProps).toEqual({
      overAlloc: 1,
      poolSize: 0
    });
  });

  it('passes updated trace interaction mode into synchronized deck views', async () => {
    const rendered = await renderDeckWithManagedViews({
      traceDragInteractionMode: 'drag-to-pan'
    });

    expect(mockState.synchronizedViewArgs.at(-1)?.traceDragInteractionMode).toBe('drag-to-pan');

    await rendered.rerender({traceDragInteractionMode: 'drag-to-zoom'});

    expect(mockState.synchronizedViewArgs.at(-1)?.traceDragInteractionMode).toBe('drag-to-zoom');
  });

  it('passes collapsed legend overlay mode into synchronized deck views', async () => {
    const rendered = await renderDeckWithManagedViews({
      collapseLegendToProcessLabelOverlay: true
    });

    expect(mockState.synchronizedViewArgs.at(-1)?.collapseLegendToProcessLabelOverlay).toBe(true);

    await rendered.rerender({collapseLegendToProcessLabelOverlay: false});

    expect(mockState.synchronizedViewArgs.at(-1)?.collapseLegendToProcessLabelOverlay).toBe(false);
  });

  it('fits the minimap to the exact content bounds without extra y padding', async () => {
    await renderDeckWithManagedViews({isOverviewEnabled: true, showDefaultWidgets: true});

    expect(fitBoundsOrthographic).toHaveBeenLastCalledWith(
      960,
      150,
      [
        [0, 0],
        [100, 100]
      ],
      'per-axis'
    );
    const widgets = (mockState.lastDeckProps?.widgets ?? []) as Array<{
      props: Record<string, unknown>;
      placement?: string;
      onRenderHTML?: (rootElement: HTMLElement) => void;
    }>;
    const separatorWidget = widgets.find(widget => widget.props.id === 'overview-separator');

    expect(separatorWidget?.placement).toBe('bottom-left');

    const separatorRoot = document.createElement('div');
    separatorWidget?.onRenderHTML?.(separatorRoot);

    const separator = separatorRoot.querySelector('hr');
    expect(separator).toBeTruthy();
    expect(separator?.getAttribute('aria-hidden')).toBe('true');
    expect(separatorRoot.style.bottom).toBe('0px');
    expect(separatorRoot.style.pointerEvents).toBe('none');
    expect(separator?.style.height).toBe('150px');
    expect(separator?.style.borderTop).toBe('1px solid rgba(148, 163, 184, 0.55)');
    expect(separator?.style.boxShadow).toMatch(
      /^(?:0(?:px)? 0(?:px)? 8px rgba\(0, 0, 0, 0\.2\)|rgba\(0, 0, 0, 0\.2\) 0px 0px 8px)$/
    );
  });

  it('only adds the overview separator widget when the minimap is enabled', async () => {
    await renderDeckWithManagedViews({isOverviewEnabled: false, showDefaultWidgets: true});

    const widgets = (mockState.lastDeckProps?.widgets ?? []) as Array<{
      props: Record<string, unknown>;
    }>;

    expect(widgets.some(widget => widget.props.id === 'overview-separator')).toBe(false);
  });

  it('uses overview-specific bounds when fitting the minimap', async () => {
    const overviewBounds: Bounds = [
      [10, 20],
      [80, 40]
    ];

    await renderDeckWithManagedViews({isOverviewEnabled: true, overviewBounds});

    expect(fitBoundsOrthographic).toHaveBeenLastCalledWith(960, 150, overviewBounds, 'per-axis');
  });

  it('caps the minimap Y zoom for tiny overview bounds', async () => {
    vi.mocked(fitBoundsOrthographic)
      .mockReturnValueOnce({
        target: [0, 0],
        zoomX: -5,
        zoomY: 8
      })
      .mockReturnValueOnce({
        target: [0, 0],
        zoomX: -5,
        zoomY: 8
      });

    await renderDeckWithManagedViews({
      isOverviewEnabled: true,
      overviewBounds: [
        [0, 0],
        [100, 1]
      ]
    });

    const overviewViewState = (
      mockState.lastDeckProps?.viewState as Record<string, any> | undefined
    )?.minimap;
    expect(overviewViewState?.zoomX).toBe(-5);
    expect(overviewViewState?.zoomY).toBe(4);
  });

  it('lowers the main X zoom floor enough to fit long overview bounds', async () => {
    const thirteenHoursMs = 13 * 60 * 60 * 1000;
    await renderDeckWithManagedViews({
      isOverviewEnabled: true,
      overviewBounds: [
        [0, 0],
        [thirteenHoursMs, 100]
      ]
    });
    await Promise.resolve();

    const mainViewState = (mockState.lastDeckProps?.viewState as Record<string, any> | undefined)
      ?.main;
    expect(mainViewState?.minZoomX).toBeCloseTo(
      Math.log2((960 - 150 - 75 * 2) / thirteenHoursMs) - 0.5
    );
    expect(mainViewState?.minZoomX).toBeLessThan(-12);
  });

  it('uses the full deck width for the main X zoom floor when the legend is collapsed', async () => {
    const thirteenHoursMs = 13 * 60 * 60 * 1000;
    await renderDeckWithManagedViews({
      collapseLegendToProcessLabelOverlay: true,
      isOverviewEnabled: true,
      overviewBounds: [
        [0, 0],
        [thirteenHoursMs, 100]
      ]
    });
    await Promise.resolve();

    const mainViewState = (mockState.lastDeckProps?.viewState as Record<string, any> | undefined)
      ?.main;
    expect(mainViewState?.minZoomX).toBeCloseTo(Math.log2((960 - 75 * 2) / thirteenHoursMs) - 0.5);
  });

  it('lets imperative pan and x-zoom commands disable viewport transitions', async () => {
    const deckRef = createRef<DeckWithManagedViewsRef>();

    await renderDeckWithManagedViews({deckRef});

    await act(async () => {
      deckRef.current?.panBy(10, 20, {transition: false});
      deckRef.current?.zoomXBy(1, {transition: false});
    });

    const controller = mockState.controllerInstances.at(-1);

    expect(controller?.panByCalls.at(-1)).toEqual({
      delta: [10, 20],
      options: {transition: false}
    });
    expect(controller?.zoomXByCalls.at(-1)).toEqual({
      delta: 1,
      options: {transition: false}
    });
  });

  it('keeps transitions enabled by default for imperative pan and x-zoom commands', async () => {
    const deckRef = createRef<DeckWithManagedViewsRef>();

    await renderDeckWithManagedViews({deckRef});

    await act(async () => {
      deckRef.current?.panBy(30, 40);
      deckRef.current?.zoomXBy(-1);
    });

    const controller = mockState.controllerInstances.at(-1);

    expect(controller?.panByCalls.at(-1)).toEqual({
      delta: [30, 40],
      options: {transition: true}
    });
    expect(controller?.zoomXByCalls.at(-1)).toEqual({
      delta: -1,
      options: {transition: true}
    });
  });

  it('passes custom transition durations through imperative pan and x-zoom commands', async () => {
    const deckRef = createRef<DeckWithManagedViewsRef>();

    await renderDeckWithManagedViews({deckRef});

    await act(async () => {
      deckRef.current?.panBy(50, 60, {transition: true, transitionDurationMs: 80});
      deckRef.current?.zoomXBy(0.5, {transition: true, transitionDurationMs: 80});
    });

    const controller = mockState.controllerInstances.at(-1);

    expect(controller?.panByCalls.at(-1)).toEqual({
      delta: [50, 60],
      options: {transition: true, transitionDurationMs: 80}
    });
    expect(controller?.zoomXByCalls.at(-1)).toEqual({
      delta: 0.5,
      options: {transition: true, transitionDurationMs: 80}
    });
  });

  it('maps minimap drag-pan state changes to inverted main view x-only panning', async () => {
    await renderDeckWithManagedViews({isOverviewEnabled: true});
    const onViewStateChange = mockState.lastDeckProps?.onViewStateChange as
      | ((params: {
          viewId: string;
          viewState: Record<string, unknown>;
          oldViewState?: Record<string, unknown>;
          interactionState?: Record<string, unknown>;
        }) => void)
      | undefined;

    await act(async () => {
      flushSync(() => {
        onViewStateChange?.({
          viewId: 'main',
          viewState: {
            target: [12, 34],
            zoomX: -5,
            zoomY: 5,
            minZoomX: -12,
            maxZoomX: 6
          }
        });
      });
    });
    await act(async () => {
      flushSync(() => {
        onViewStateChange?.({
          viewId: 'minimap',
          oldViewState: {
            target: [50, 0]
          },
          viewState: {
            target: [45, 999],
            zoomX: 0,
            zoomY: 0
          },
          interactionState: {
            isPanning: true
          }
        });
      });
    });

    const mainViewState = (mockState.lastDeckProps?.viewState as Record<string, any> | undefined)
      ?.main;
    expect(mainViewState?.target).toEqual([17, 34]);
    expect(mainViewState?.zoomX).toEqual(-5);
    expect(mainViewState?.zoomY).toEqual(5);
    expect(mainViewState?.transitionDuration).toBe(0);
  });

  it('preserves the main view top edge when hiding the minimap', async () => {
    const rendered = await renderDeckWithManagedViews({isOverviewEnabled: true});

    await rendered.rerender({isOverviewEnabled: false});

    const mainViewState = (mockState.lastDeckProps?.viewState as Record<string, any> | undefined)
      ?.main;
    expect(mainViewState?.target?.[1]).toBeCloseTo(2.34375);
    expect(mainViewState?.transitionDuration).toBe(0);
  });

  it('applies each view anchor transition once to the main view target y', async () => {
    const rendered = await renderDeckWithManagedViews({
      viewAnchorTransition: {key: 'enter-focused', deltaY: 20}
    });

    let mainViewState = (mockState.lastDeckProps?.viewState as Record<string, any> | undefined)
      ?.main;
    expect(mainViewState?.target).toEqual([0, 20, 0]);
    expect(mainViewState?.zoomX).toEqual(-5);
    expect(mainViewState?.zoomY).toEqual(5);
    expect(mainViewState?.transitionDuration).toBe(0);

    await rendered.rerender({
      viewAnchorTransition: {key: 'enter-focused', deltaY: 20}
    });
    mainViewState = (mockState.lastDeckProps?.viewState as Record<string, any> | undefined)?.main;
    expect(mainViewState?.target).toEqual([0, 20, 0]);

    await rendered.rerender({
      viewAnchorTransition: {key: 'exit-focused', deltaY: -15}
    });
    mainViewState = (mockState.lastDeckProps?.viewState as Record<string, any> | undefined)?.main;
    expect(mainViewState?.target).toEqual([0, 5, 0]);
  });

  it('preserves x target and zoom when applying a view anchor transition', () => {
    expect(
      applyDeckViewAnchorTransition(
        {
          target: [12, 34, 7],
          zoomX: -3,
          zoomY: 4,
          minZoomX: -12,
          maxZoomX: 6
        },
        {key: 'anchor', deltaY: 9}
      )
    ).toMatchObject({
      target: [12, 43, 7],
      zoomX: -3,
      zoomY: 4,
      minZoomX: -12,
      maxZoomX: 6,
      transitionDuration: 0,
      transitionInterpolator: undefined
    });
  });

  it('promotes the Tracevis help widget to the first widget passed to deck', async () => {
    await renderDeckWithManagedViews({
      widgets: [new ExternalWidget(), new HelpWidget()]
    });

    const widgets = (mockState.lastDeckProps?.widgets ?? []) as InstanceType<
      typeof mockState.MockWidget
    >[];

    expect(widgets[0]?.props.id).toBe('tracevis-help');
  });

  it('places fullscreen above the custom reset-view widgets in the top-right widget stack', async () => {
    await renderDeckWithManagedViews({showDefaultWidgets: true});

    const widgets = (mockState.lastDeckProps?.widgets ?? []) as Array<{
      placement?: string;
      props: MockWidgetProps;
    }>;
    const topRightWidgets = widgets.filter(
      widget =>
        widget.placement === 'top-right' && widget.props._container === 'interaction-capture'
    );

    expect(topRightWidgets[0]?.props.id).toBe('fullscreen');
    expect(topRightWidgets[1]?.props.id).toBe('tracevis-reset-timeline-view');
    expect(topRightWidgets[2]?.props.id).toBe('tracevis-reset-bounds-view');
  });

  it('places help and measure-time first in the top-right widget stack', async () => {
    await renderDeckWithManagedViews({
      showDefaultWidgets: true,
      widgets: [
        new ExternalWidget(),
        new TimeMeasureWidget(),
        new ThemeWidget(),
        new StudioSettingsWidget(),
        new HelpWidget({placement: 'top-right'})
      ]
    });

    const widgets = (mockState.lastDeckProps?.widgets ?? []) as Array<{
      placement?: string;
      props: MockWidgetProps;
    }>;
    const topRightWidgetIds = widgets
      .filter(widget => widget.placement === 'top-right')
      .map(widget => widget.props.id);

    expect(topRightWidgetIds.slice(0, 7)).toEqual([
      'tracevis-help',
      'time-measure',
      'tracevis-studio-settings',
      'tracevis-theme',
      'fullscreen',
      'tracevis-reset-timeline-view',
      'tracevis-reset-bounds-view'
    ]);
  });

  it('suppresses managed default widgets by default while preserving caller widgets and explicit scrollbar', async () => {
    await renderDeckWithManagedViews({
      isOverviewEnabled: true,
      showMainVerticalScrollbar: true,
      widgets: [new ExternalWidget()]
    });

    const widgets = (mockState.lastDeckProps?.widgets ?? []) as Array<{
      props: MockWidgetProps;
    }>;
    const widgetIds = widgets.map(widget => widget.props.id);

    expect(widgetIds).toEqual(['tracevis-main-vertical-scrollbar', 'external-widget']);
    expect(widgetIds).not.toContain('fullscreen');
    expect(widgetIds).not.toContain('zoom');
    expect(widgetIds).not.toContain('tracevis-reset-timeline-view');
    expect(widgetIds).not.toContain('tracevis-reset-bounds-view');
    expect(widgetIds).not.toContain('heap-memory');
    expect(widgetIds).not.toContain('deck-stats');
    expect(widgetIds).not.toContain('overview-separator');
  });

  it('renders and wires the custom reset-view widgets', async () => {
    await renderDeckWithManagedViews({showDefaultWidgets: true});

    const widgets = (mockState.lastDeckProps?.widgets ?? []) as Array<{
      props: MockWidgetProps;
      onRenderHTML?: (rootElement: HTMLElement) => void;
    }>;
    const timelineWidget = widgets.find(
      widget => widget.props.id === 'tracevis-reset-timeline-view'
    );
    const boundsWidget = widgets.find(widget => widget.props.id === 'tracevis-reset-bounds-view');
    const timelineRoot = document.createElement('div');
    const boundsRoot = document.createElement('div');

    timelineWidget?.onRenderHTML?.(timelineRoot);
    boundsWidget?.onRenderHTML?.(boundsRoot);

    const timelineButton = timelineRoot.querySelector('button');
    const boundsButton = boundsRoot.querySelector('button');
    expect(timelineButton?.getAttribute('aria-label')).toBe('Show full timeline');
    expect(boundsButton?.getAttribute('aria-label')).toBe('Show Entire Trace');

    await act(async () => {
      timelineButton?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
      boundsButton?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
    });

    const controller = mockState.controllerInstances.at(-1);
    const expectedBounds: Bounds = [
      [0, 0],
      [100, 100]
    ];

    expect(controller?.width).toBe(960);
    expect(controller?.height).toBe(504);
    expect(controller?.fitToBoundsCalls.at(-1)).toEqual({
      bounds: expectedBounds,
      transition: true
    });
    expect(controller?.fitEntireBoundsCalls.at(-1)).toEqual({
      bounds: expectedBounds,
      transition: true
    });
  });

  it('keeps the overview separator, trace catalog, hover popup, and overview toggle out of interaction-capture', async () => {
    const traceCatalogWidget = new TraceCatalogWidget();
    traceCatalogWidget.viewId = 'main';
    const studioSettingsWidget = new StudioSettingsWidget();
    const hoverPopupWidget = new HoverPopupWidget();
    hoverPopupWidget.viewId = 'legend';
    const overviewToggleWidget = new OverviewToggleWidget();
    overviewToggleWidget.viewId = 'minimap';

    await renderDeckWithManagedViews({
      isOverviewEnabled: true,
      showDefaultWidgets: true,
      widgets: [
        new ExternalWidget(),
        new HelpWidget(),
        traceCatalogWidget,
        studioSettingsWidget,
        hoverPopupWidget,
        overviewToggleWidget
      ],
      showMainVerticalScrollbar: true
    });

    const widgets = (mockState.lastDeckProps?.widgets ?? []) as InstanceType<
      typeof mockState.MockWidget
    >[];
    const renderedTraceCatalogWidget = widgets.find(
      widget => widget.props.id === 'tracevis-trace-catalog'
    );
    const overviewSeparatorWidget = widgets.find(
      widget => widget.props.id === 'overview-separator'
    );
    const renderedHoverPopupWidget = widgets.find(
      widget => widget.props.id === 'tracevis-hover-popup'
    );
    const renderedStudioSettingsWidget = widgets.find(
      widget => widget.props.id === 'tracevis-studio-settings'
    );
    const scrollbarWidget = widgets.find(
      widget => widget.props.id === 'tracevis-main-vertical-scrollbar'
    );
    const renderedOverviewToggleWidget = widgets.find(
      widget => widget.props.id === 'tracevis-overview-toggle'
    );
    const zoomWidget = widgets.find(widget => widget.props.id === 'zoom');
    const resetTimelineWidget = widgets.find(
      widget => widget.props.id === 'tracevis-reset-timeline-view'
    );
    const resetBoundsWidget = widgets.find(
      widget => widget.props.id === 'tracevis-reset-bounds-view'
    );
    const heapMemoryWidget = widgets.find(widget => widget.props.id === 'heap-memory');
    const statsWidget = widgets.find(widget => widget.props.id === 'deck-stats');

    expect(renderedTraceCatalogWidget?.placement).toBe('bottom-left');
    expect(renderedTraceCatalogWidget?.viewId).toBe('main');
    expect(renderedTraceCatalogWidget?.props._container).toBeNull();
    expect(renderedStudioSettingsWidget?.placement).toBe('top-right');
    expect(renderedStudioSettingsWidget?.props._container).toBe('interaction-capture');
    expect(renderedHoverPopupWidget?.placement).toBe('fill');
    expect(renderedHoverPopupWidget?.viewId).toBe('legend');
    expect(renderedHoverPopupWidget?.props._container).toBeNull();
    expect(renderedOverviewToggleWidget?.placement).toBe('bottom-right');
    expect(renderedOverviewToggleWidget?.viewId).toBe('minimap');
    expect(renderedOverviewToggleWidget?.props._container).toBeNull();
    expect(overviewSeparatorWidget?.props._container).toBeNull();
    expect(scrollbarWidget?.props._container).toBe('main');
    expect(resetTimelineWidget?.placement).toBe('top-right');
    expect(resetTimelineWidget?.props._container).toBe('interaction-capture');
    expect(resetBoundsWidget?.placement).toBe('top-right');
    expect(resetBoundsWidget?.props._container).toBe('interaction-capture');
    expect(zoomWidget?.props.style).toMatchObject({marginRight: '20px'});
    expect((zoomWidget?.props as Record<string, unknown> | undefined)?.zoomDelta).toBe(0.25);
    expect(resetTimelineWidget?.props.style).toMatchObject({marginRight: '20px'});
    expect(resetBoundsWidget?.props.style).toMatchObject({marginRight: '20px'});
    expect(heapMemoryWidget?.props.style).toMatchObject({marginRight: '20px'});
    expect(statsWidget?.props.style).toMatchObject({
      marginRight: '20px',
      marginTop: '0px'
    });
    expect(widgets[0]?.props.id).toBe('tracevis-main-vertical-scrollbar');
    expect(widgets[1]?.props.id).toBe('tracevis-help');
  });

  it('adds a vertical scrollbar under the other main timeline widgets', async () => {
    await renderDeckWithManagedViews({
      showDefaultWidgets: true,
      showMainVerticalScrollbar: true
    });

    const widgets = (mockState.lastDeckProps?.widgets ?? []) as Array<{
      props: MockWidgetProps;
      placement?: string;
      viewId?: string | null;
    }>;
    const scrollbarWidget = widgets.find(
      widget => widget.props.id === 'tracevis-main-vertical-scrollbar'
    );

    expect(widgets[0]?.props.id).toBe('tracevis-main-vertical-scrollbar');
    expect(scrollbarWidget?.placement).toBe('top-right');
    expect(scrollbarWidget?.viewId).toBe('main');
    expect(scrollbarWidget?.props).toMatchObject({
      viewId: 'main',
      orientation: 'vertical',
      contentBounds: [
        [0, 0],
        [100, 100]
      ],
      startButtonAriaLabel: 'Scroll timeline rows up',
      endButtonAriaLabel: 'Scroll timeline rows down',
      style: {
        '--range-step-button-size': '0px',
        '--widget-margin': '0px'
      },
      _container: 'main'
    });
  });

  it('does not add the main timeline scrollbar unless requested by the timeline view', async () => {
    await renderDeckWithManagedViews({showDefaultWidgets: true});

    const widgets = (mockState.lastDeckProps?.widgets ?? []) as Array<{
      props: MockWidgetProps;
    }>;

    expect(widgets.some(widget => widget.props.id === 'tracevis-main-vertical-scrollbar')).toBe(
      false
    );
  });

  it('uses compact spacing for the deck stats widget in the top-right stack', async () => {
    await renderDeckWithManagedViews({showDefaultWidgets: true});

    const widgets = (mockState.lastDeckProps?.widgets ?? []) as Array<{
      props: MockWidgetProps;
      placement?: string;
    }>;
    const statsWidget = widgets.find(widget => widget.props.id === 'deck-stats');

    expect(statsWidget?.placement).toBe('top-right');
    expect(statsWidget?.props.style).toMatchObject({
      marginTop: '0px'
    });
  });

  it('keeps luma device debug disabled by default', async () => {
    await renderDeckWithManagedViews();

    expect(mockState.lastDeckProps?.deviceProps).toMatchObject({
      debug: false
    });
  });

  it('keeps luma device debug disabled and hooks app-owned GPU timing when requested', async () => {
    await renderDeckWithManagedViews({enableDeckGpuTimeStats: true});

    expect(mockState.lastDeckProps?.deviceProps).toMatchObject({
      debug: false
    });
    expect(mockState.lastDeckProps?.onBeforeRender).toEqual(expect.any(Function));
    expect(mockState.lastDeckProps?.onAfterRender).toEqual(expect.any(Function));
  });

  it('keeps deck device props and GPU timing render callbacks stable when toggling GPU timing', async () => {
    const rendered = await renderDeckWithManagedViews({enableDeckGpuTimeStats: false});
    const deviceProps = mockState.lastDeckProps?.deviceProps;
    const onBeforeRender = mockState.lastDeckProps?.onBeforeRender;
    const onAfterRender = mockState.lastDeckProps?.onAfterRender;

    await rendered.rerender({enableDeckGpuTimeStats: true});

    expect(mockState.lastDeckProps?.deviceProps).toBe(deviceProps);
    expect(mockState.lastDeckProps?.onBeforeRender).toBe(onBeforeRender);
    expect(mockState.lastDeckProps?.onAfterRender).toBe(onAfterRender);
  });

  it('submits luma timestamp queries and mirrors resolved GPU time into deck stats metrics', async () => {
    await renderDeckWithManagedViews({enableDeckGpuTimeStats: true});
    const submit = vi.fn();
    const timingDevice = {
      features: new Set(['timestamp-query']),
      commandEncoder: {
        writeTimestamp: vi.fn()
      },
      createQuerySet: vi.fn(() => ({
        readResults: vi.fn(async () => [0n, 4_000_000n])
      })),
      submit
    };
    const deckProps = mockState.lastDeckProps as {
      onBeforeRender?: (params: {device: typeof timingDevice; gl: unknown}) => void;
      onAfterRender?: (params: {device: typeof timingDevice; gl: unknown}) => void;
    };

    deckProps.onBeforeRender?.({device: timingDevice, gl: {}});
    deckProps.onAfterRender?.({device: timingDevice, gl: {}});
    await act(async () => {
      await Promise.resolve();
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(mockState.gpuTimeStat.time).toBe(4);
    expect(mockState.deckMetrics.gpuTime).toBe(4);
    expect(mockState.deckMetrics.gpuTimePerFrame).toBe(4);
  });
});
