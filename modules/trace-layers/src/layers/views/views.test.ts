import {describe, expect, it} from 'vitest';

import {buildViewsFromViewLayout} from '@deck.gl-community/infovis-layers';
import {buildTracevisViewLayout} from './views';

import type {TracevisViewLayoutOptions} from './views';
import type {OrthographicView} from '@deck.gl/core';

function buildTracevisViews(
  args: TracevisViewLayoutOptions & {width: number; height: number}
): OrthographicView[] {
  return buildViewsFromViewLayout({
    layout: buildTracevisViewLayout(args),
    width: args.width,
    height: args.height
  }).views as OrthographicView[];
}

describe('buildTracevisViewLayout', () => {
  it('keeps the interaction capture view out of the minimap band when minimap is enabled', () => {
    const views = buildTracevisViews({
      width: 1000,
      height: 600,
      headerViewHeight: 36,
      legendViewWidth: 150,
      minimap: true,
      minimapViewHeight: 150,
      traceDragInteractionMode: 'drag-to-pan'
    });
    const interactionCaptureView = views.find(view => view.props.id === 'interaction-capture');
    const legendBackgroundView = views.find(view => view.props.id === 'legend-background');
    const minimapView = views.find(view => view.props.id === 'minimap');
    const interactionCaptureController = interactionCaptureView?.props.controller as
      | Record<string, unknown>
      | undefined;
    const minimapController = minimapView?.props.controller as Record<string, unknown> | undefined;

    expect(interactionCaptureView?.props.x).toBe(0);
    expect(interactionCaptureView?.props.y).toBe(0);
    expect(interactionCaptureView?.props.width).toBe(1000);
    expect(interactionCaptureView?.props.height).toBe(450);
    expect(interactionCaptureView?.props.padding).toEqual({left: 150, top: 36});
    expect(interactionCaptureController?.traceDragInteractionMode).toBe('drag-to-pan');
    expect(minimapController?.traceDragInteractionMode).toBe('drag-to-zoom');
    expect(minimapController?.scrollZoom).toBe(false);
    expect(minimapView?.props.x).toBe(0);
    expect(minimapView?.props.width).toBe(1000);
    expect(minimapView?.props.y).toBe(450);
    expect(minimapView?.props.height).toBe(150);
    expect(views.find(view => view.props.id === 'header')?.props).toMatchObject({
      x: 150,
      y: 0,
      width: 850,
      height: 600
    });
    expect(views.find(view => view.props.id === 'header')?.props.padding).toEqual({
      top: 36,
      bottom: 'calc(100% - 36px)'
    });
    expect(legendBackgroundView?.props).toMatchObject({
      clear: false,
      x: 0,
      y: 36,
      width: 150,
      height: 414
    });
    expect(views.findIndex(view => view.props.id === 'legend-background')).toBeLessThan(
      views.findIndex(view => view.props.id === 'main')
    );
    expect(views.find(view => view.props.id === 'legend')?.props).toMatchObject({
      x: 0,
      y: 36,
      width: 1000,
      height: 414
    });
    expect(views.find(view => view.props.id === 'legend')?.props.padding).toEqual({
      left: 150,
      right: 'calc(100% - 150px)'
    });
  });

  it('reserves a fixed run-event strip between the header and main view', () => {
    const views = buildTracevisViews({
      width: 1000,
      height: 600,
      headerViewHeight: 36,
      legendViewWidth: 150,
      runEventViewHeight: 40,
      minimap: true,
      minimapViewHeight: 150
    });
    const interactionCaptureView = views.find(view => view.props.id === 'interaction-capture');
    const mainView = views.find(view => view.props.id === 'main');
    const runEventsView = views.find(view => view.props.id === 'run-events');
    const runEventsLegendView = views.find(view => view.props.id === 'run-events-legend');
    const legendBackgroundView = views.find(view => view.props.id === 'legend-background');
    const legendView = views.find(view => view.props.id === 'legend');

    expect(interactionCaptureView?.props.padding).toEqual({left: 150, top: 76});
    expect(mainView?.props.y).toBe(76);
    expect(mainView?.props.height).toBe(374);
    expect(runEventsView?.props.clear).toBe(false);
    expect(runEventsView?.props.x).toBe(150);
    expect(runEventsView?.props.width).toBe(850);
    expect(runEventsView?.props.y).toBe(36);
    expect(runEventsView?.props.height).toBe(40);
    expect(runEventsView?.props.viewState).toMatchObject({id: 'main', target: [NaN, 0]});
    expect(runEventsLegendView?.props.x).toBe(0);
    expect(runEventsLegendView?.props.width).toBe(1000);
    expect(runEventsLegendView?.props.y).toBe(36);
    expect(runEventsLegendView?.props.height).toBe(40);
    expect(runEventsLegendView?.props.padding).toEqual({
      left: 150,
      right: 'calc(100% - 150px)'
    });
    expect(legendBackgroundView?.props).toMatchObject({
      clear: false,
      x: 0,
      y: 76,
      width: 150,
      height: 374
    });
    expect(legendView?.props.y).toBe(76);
    expect(legendView?.props.width).toBe(1000);
    expect(legendView?.props.height).toBe(374);
    expect(legendView?.props.padding).toEqual({
      left: 150,
      right: 'calc(100% - 150px)'
    });
  });

  it('collapses reserved legend width while preserving a process-label overlay view', () => {
    const views = buildTracevisViews({
      width: 1000,
      height: 600,
      headerViewHeight: 36,
      legendViewWidth: 150,
      collapseLegendToProcessLabelOverlay: true,
      runEventViewHeight: 40,
      minimap: true,
      minimapViewHeight: 150
    });
    const interactionCaptureView = views.find(view => view.props.id === 'interaction-capture');
    const mainView = views.find(view => view.props.id === 'main');
    const headerView = views.find(view => view.props.id === 'header');
    const runEventsView = views.find(view => view.props.id === 'run-events');
    const legendBackgroundView = views.find(view => view.props.id === 'legend-background');
    const legendView = views.find(view => view.props.id === 'legend');

    expect(interactionCaptureView?.props.padding).toEqual({left: 0, top: 76});
    expect(mainView?.props.x).toBe(0);
    expect(mainView?.props.width).toBe(1000);
    expect(headerView?.props.x).toBe(0);
    expect(headerView?.props.width).toBe(1000);
    expect(runEventsView?.props.x).toBe(0);
    expect(runEventsView?.props.width).toBe(1000);
    expect(legendBackgroundView).toBeUndefined();
    expect(legendView?.props).toMatchObject({
      x: 0,
      y: 76,
      width: 1000,
      height: 374
    });
    expect(legendView?.props.padding).toEqual({
      left: 150,
      right: 'calc(100% - 150px)'
    });
  });

  it('keeps the interaction capture view full-height when minimap is disabled', () => {
    const views = buildTracevisViews({
      width: 1000,
      height: 600,
      headerViewHeight: 36,
      legendViewWidth: 150,
      minimap: false,
      minimapViewHeight: 150
    });
    const interactionCaptureView = views.find(view => view.props.id === 'interaction-capture');

    expect(interactionCaptureView?.props.x).toBe(0);
    expect(interactionCaptureView?.props.y).toBe(0);
    expect(interactionCaptureView?.props.width).toBe(1000);
    expect(interactionCaptureView?.props.height).toBe(600);
    expect(interactionCaptureView?.props.padding).toEqual({left: 150, top: 36});
    expect(views.find(view => view.props.id === 'main')?.props).toMatchObject({
      x: 150,
      y: 36,
      width: 850,
      height: 564
    });
    expect(views.find(view => view.props.id === 'header')?.props.padding).toEqual({
      top: 36,
      bottom: 'calc(100% - 36px)'
    });
    expect(views.find(view => view.props.id === 'legend')?.props.padding).toEqual({
      left: 150,
      right: 'calc(100% - 150px)'
    });
  });
});
