// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck} from '@deck.gl/core';
import {D3ForceLayout} from '@deck.gl-community/graph-layers';
import {expect, test, vi} from 'vitest';
import {mountGraphViewerExample} from './app';

test('keeps the loading overlay visible across frames while an async layout is pending', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'width:800px;height:600px';
  document.body.append(host);
  // Hold the worker response while retaining the real layout-start event and deck rendering.
  const engageWorker = vi
    .spyOn(D3ForceLayout.prototype, '_engageWorker')
    .mockImplementation(() => {});
  const setProps = vi.spyOn(Deck.prototype, 'setProps');
  const unmount = mountGraphViewerExample(host, {graphType: 'graph'});
  try {
    await vi.waitFor(() => expect(engageWorker).toHaveBeenCalled(), {timeout: 10_000});
    const layout = engageWorker.mock.contexts[0] as D3ForceLayout;
    const deck = setProps.mock.contexts[0] as Deck<any>;
    const afterRender = vi.fn(deck.props.onAfterRender);
    deck.setProps({onAfterRender: afterRender});
    deck.redraw('pending layout overlay regression');
    await vi.waitFor(() => expect(afterRender).toHaveBeenCalled(), {timeout: 10_000});
    const overlay = [...host.querySelectorAll('div')].find(
      element => element.textContent === 'Computing layout...'
    )!;
    expect(overlay.hidden).toBe(false);
    expect(overlay.style.display).toBe('flex');
    layout.getProps().onLayoutDone?.({bounds: null});
    expect(overlay.hidden).toBe(true);
    expect(overlay.style.display).toBe('none');
  } finally {
    unmount();
    host.remove();
    vi.restoreAllMocks();
  }
}, 30_000);

test('mini-map clicks recenter the mounted viewer, preserve zoom, and avoid navigation controls', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'width:1000px;height:600px';
  document.body.append(host);
  const setProps = vi.spyOn(Deck.prototype, 'setProps');
  const unmount = mountGraphViewerExample(host, {graphType: 'dag', showInfoWidget: false});
  try {
    await vi.waitFor(
      () => expect(host.querySelector<HTMLCanvasElement>('.graph-mini-map')?.hidden).toBe(false),
      {timeout: 20_000}
    );
    const deck = setProps.mock.contexts[0] as Deck<any>;
    const canvas = host.querySelector<HTMLCanvasElement>('.graph-mini-map')!;
    const graphLayer = (deck as any).layerManager
      .getLayers()
      .find((layer: any) => layer.constructor.layerName === 'GraphLayer');
    const engine = graphLayer.state.graphEngine;
    const {fitMiniMap} = await import('./mini-map');
    const points = engine.getNodes().map((node: any) => engine.getNodePosition(node));
    const transform = fitMiniMap(points)!;

    (deck.props.onViewStateChange as any)({viewState: {target: [100, 80], zoom: 2}});
    await vi.waitFor(() => expect((deck.props.viewState as any).zoom).toBe(2));
    const rect = canvas.getBoundingClientRect();
    for (const control of host.querySelectorAll<HTMLElement>(
      '.deck-widget-pan,.deck-widget-zoom-range'
    )) {
      const bounds = control.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(bounds.right);
    }
    const click = new MouseEvent('click', {
      clientX: rect.left + canvas.clientLeft + canvas.clientWidth / 4,
      clientY: rect.top + canvas.clientTop + canvas.clientHeight / 3
    });
    // MouseEvent quantizes coordinates; account for its actual content-box position.
    const expectedTarget = transform.unproject([
      ((click.clientX - rect.left - canvas.clientLeft) * 200) / canvas.clientWidth,
      ((click.clientY - rect.top - canvas.clientTop) * 150) / canvas.clientHeight
    ]);
    canvas.dispatchEvent(click);
    await vi.waitFor(() => {
      const viewState = deck.props.viewState as any;
      expect(viewState.target[0]).toBeCloseTo(expectedTarget[0]);
      expect(viewState.target[1]).toBeCloseTo(expectedTarget[1]);
      expect(viewState.zoom).toBe(2);
    });
    // Toggling the sidebar must refresh even with the deck animation loop stopped.
    (deck as any).animationLoop.stop();
    host.style.width = '600px';
    const sidebar = (deck.props.widgets as any[]).find(
      widget => widget.id === 'graph-viewer-sidebar'
    );
    sidebar.component.props.onOpenChange(false);
    expect(canvas.hidden).toBe(false);
    sidebar.component.props.onOpenChange(true);
    expect(canvas.hidden).toBe(true);
    sidebar.component.props.onOpenChange(false);
    expect(canvas.hidden).toBe(false);
  } finally {
    unmount();
    expect(host.querySelector('.graph-mini-map')).toBeNull();
    host.remove();
    vi.restoreAllMocks();
  }
}, 60_000);
