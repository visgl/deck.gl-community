import { afterEach, describe, expect, it, vi } from 'vitest';

import { TraceYZoomWidget } from './trace-y-zoom-widget';

type MockViewportOptions = {
  id?: string;
  zoomY?: number;
  zoomX?: number;
  minZoom?: number | [number, number];
  maxZoom?: number | [number, number];
  target?: [number, number, number];
};

/**
 * Creates a minimal orthographic viewport-shaped object for widget tests.
 */
function createViewport(options: MockViewportOptions = {}) {
  return {
    id: options.id ?? 'main',
    zoomY: options.zoomY ?? 0,
    zoomX: options.zoomX ?? 0,
    minZoom: options.minZoom,
    maxZoom: options.maxZoom,
    target: options.target ?? [0, 0, 0],
  } as any;
}

/**
 * Builds a widget instance with a spyable HTML update path.
 */
function createWidget(props: ConstructorParameters<typeof TraceYZoomWidget>[0] = {}) {
  const widget = new TraceYZoomWidget(props);
  const updateHTMLSpy = vi.spyOn(widget, 'updateHTML').mockImplementation(() => undefined);
  return { widget, updateHTMLSpy };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('TraceYZoomWidget', () => {
  it('does not re-render for viewport updates when Y zoom and bounds are unchanged', () => {
    const { widget, updateHTMLSpy } = createWidget();
    const viewport = createViewport({ zoomY: 2, minZoom: [-5, -3], maxZoom: [5, 4] });

    widget.onViewportChange(viewport);
    widget.onViewportChange(viewport);

    expect(updateHTMLSpy).toHaveBeenCalledTimes(1);
  });

  it('re-renders when Y zoom changes', () => {
    const { widget, updateHTMLSpy } = createWidget();

    widget.onViewportChange(createViewport({ zoomY: 1, minZoom: [-5, -3], maxZoom: [5, 4] }));
    widget.onViewportChange(createViewport({ zoomY: 2, minZoom: [-5, -3], maxZoom: [5, 4] }));

    expect(updateHTMLSpy).toHaveBeenCalledTimes(2);
  });

  it('re-renders when effective zoom bounds change without changing Y zoom', () => {
    const { widget, updateHTMLSpy } = createWidget();

    widget.onViewportChange(createViewport({ zoomY: 1, minZoom: [-5, -3], maxZoom: [5, 4] }));
    widget.onViewportChange(createViewport({ zoomY: 1, minZoom: [-5, -2], maxZoom: [5, 4] }));

    expect(updateHTMLSpy).toHaveBeenCalledTimes(2);
  });

  it('only re-renders once across repeated identical viewport updates', () => {
    const { widget, updateHTMLSpy } = createWidget();
    const viewport = createViewport({ zoomY: 1.5, minZoom: [-5, -3], maxZoom: [5, 4] });

    widget.onViewportChange(viewport);
    widget.onViewportChange(viewport);
    widget.onViewportChange(viewport);

    expect(updateHTMLSpy).toHaveBeenCalledTimes(1);
  });

  it('does not double re-render when a widget-driven zoom is followed by the matching viewport callback', () => {
    const { widget, updateHTMLSpy } = createWidget();
    const viewport = createViewport({ zoomY: 1, zoomX: 0, minZoom: [-5, -3], maxZoom: [5, 4] });
    const deck = {
      _onViewStateChange: vi.fn(),
    } as any;

    widget.deck = deck;
    widget.onViewportChange(viewport);
    updateHTMLSpy.mockClear();

    (widget as any).updateViewState(viewport, 2);
    widget.onViewportChange(
      createViewport({ zoomY: 2, zoomX: 0, minZoom: [-5, -3], maxZoom: [5, 4] }),
    );

    expect(updateHTMLSpy).toHaveBeenCalledTimes(1);
    expect(deck._onViewStateChange).toHaveBeenCalledTimes(1);
  });
});
