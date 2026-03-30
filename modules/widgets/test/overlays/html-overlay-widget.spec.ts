// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {h} from 'preact';
import {describe, expect, it, vi} from 'vitest';

import {HtmlClusterWidget} from '../../src/widgets/html-cluster-widget';
import {HtmlOverlayItem} from '../../src/widgets/html-overlay-item';
import {HtmlOverlayWidget} from '../../src/widgets/html-overlay-widget';
import {HtmlTooltipWidget} from '../../src/widgets/html-tooltip-widget';

const viewport = {
  id: 'default-view',
  width: 800,
  height: 600,
  zoom: 5,
  project: (coords: number[]) => coords
} as any;

describe('HtmlOverlayWidget', () => {
  it('renders overlay items and ignores null entries', () => {
    const overlay = new HtmlOverlayWidget({
      items: [
        h(HtmlOverlayItem, {coordinates: [0, 0, 0]}, 'Map Center Zero Elevation'),
        null,
        h(HtmlOverlayItem, {coordinates: [0, 0, 50000]}, 'Map Center 50km Elevation')
      ]
    });
    (overlay as any).viewport = viewport;

    const projected = overlay.projectItems(overlay.getOverlayItems(viewport), viewport);

    expect(projected).toHaveLength(2);
    expect(projected.map((item) => (item.props).children)).toStrictEqual([
      'Map Center Zero Elevation',
      'Map Center 50km Elevation'
    ]);
    expect(projected.map((item) => (item.props).x)).toStrictEqual([0, 0]);
    expect(projected.map((item) => (item.props).y)).toStrictEqual([0, 0]);
  });

  it('renders no content when no items are provided', () => {
    const overlay = new HtmlOverlayWidget();
    (overlay as any).viewport = viewport;

    const projected = overlay.projectItems(overlay.getOverlayItems(viewport), viewport);
    expect(projected).toHaveLength(0);
  });

  it('calls onCreateOverlay once and delegates rendering to onRenderOverlay', () => {
    const mockRoot = {id: 'mock-overlay-root'};
    const onCreateOverlay = vi.fn(() => mockRoot);
    const onRenderOverlay = vi.fn();

    const overlay = new HtmlOverlayWidget({
      items: [h(HtmlOverlayItem, {coordinates: [0, 0]}, 'Test')],
      onCreateOverlay,
      onRenderOverlay
    });
    (overlay as any).viewport = viewport;

    // Minimal HTMLElement stub — onRenderHTML only needs .style assignment
    const rootElement = {style: {}} as unknown as HTMLElement;

    // First render: should create overlay root and delegate
    overlay.onRenderHTML(rootElement);
    expect(onCreateOverlay).toHaveBeenCalledTimes(1);
    expect(onCreateOverlay).toHaveBeenCalledWith(rootElement);
    expect(onRenderOverlay).toHaveBeenCalledTimes(1);
    expect(onRenderOverlay.mock.calls[0][0]).toBe(mockRoot);
    expect(onRenderOverlay.mock.calls[0][2]).toBe(rootElement);
    // element (arg 1) should be a Preact VNode, not null
    expect(onRenderOverlay.mock.calls[0][1]).not.toBeNull();

    // Second render: should NOT recreate overlay root
    overlay.onRenderHTML(rootElement);
    expect(onCreateOverlay).toHaveBeenCalledTimes(1);
    expect(onRenderOverlay).toHaveBeenCalledTimes(2);
  });

  it('passes null element to onRenderOverlay when no viewport is set', () => {
    const onCreateOverlay = vi.fn(() => ({id: 'mock-root'}));
    const onRenderOverlay = vi.fn();

    const overlay = new HtmlOverlayWidget({
      onCreateOverlay,
      onRenderOverlay
    });
    // No viewport set — element should be null

    const rootElement = {style: {}} as unknown as HTMLElement;
    overlay.onRenderHTML(rootElement);

    expect(onRenderOverlay).toHaveBeenCalledTimes(1);
    expect(onRenderOverlay.mock.calls[0][1]).toBeNull();
  });

  it('resets overlay root on remove', () => {
    const onCreateOverlay = vi.fn(() => ({id: 'mock-root'}));
    const onRenderOverlay = vi.fn();

    const overlay = new HtmlOverlayWidget({
      items: [h(HtmlOverlayItem, {coordinates: [0, 0]}, 'Test')],
      onCreateOverlay,
      onRenderOverlay
    });
    (overlay as any).viewport = viewport;

    const rootElement = {style: {}} as unknown as HTMLElement;
    overlay.onRenderHTML(rootElement);
    expect(onCreateOverlay).toHaveBeenCalledTimes(1);

    // Remove and re-add — should recreate overlay root
    overlay.onRemove();
    (overlay as any).viewport = viewport;
    overlay.onRenderHTML(rootElement);
    expect(onCreateOverlay).toHaveBeenCalledTimes(2);
  });
});

describe('HtmlClusterWidget', () => {
  class TestClusterWidget extends HtmlClusterWidget<{id: number; coordinates: [number, number]}> {
    objects: {id: number; coordinates: [number, number]}[];

    constructor(objects: {id: number; coordinates: [number, number]}[]) {
      super();
      this.objects = objects;
    }

    getAllObjects() {
      return this.objects;
    }

    getObjectCoordinates(obj: {coordinates: [number, number]}) {
      return obj.coordinates;
    }

    renderObject(coordinates: number[], obj: {id: number}) {
      return h(HtmlOverlayItem, {key: obj.id, coordinates}, `${obj.id}`);
    }

    renderCluster(coordinates: number[], clusterId: number, pointCount: number) {
      return h(HtmlOverlayItem, {key: `cluster-${clusterId}`, coordinates}, `${pointCount}`);
    }
  }

  it('clusters overlapping overlay items', () => {
    const widget = new TestClusterWidget([
      {id: 1, coordinates: [0, 0]},
      {id: 2, coordinates: [0.00001, 0.00001]}
    ]);
    (widget as any).viewport = viewport;

    const overlayItems = widget.getOverlayItems(viewport);
    const projected = widget.projectItems(overlayItems, viewport);

    expect(projected).toHaveLength(1);
    expect((projected[0].props as any).children).toBe('2');
  });
});

describe('HtmlTooltipWidget', () => {
  it('displays tooltip content after hover delay', () => {
    vi.useFakeTimers();
    const widget = new HtmlTooltipWidget();
    (widget as any).viewport = viewport;
    widget.updateHTML = () => {};

    widget.onHover({
      object: {style: {tooltip: 'Hello tooltip'}},
      coordinate: [10, 10],
      viewport
    } as any);

    vi.advanceTimersByTime(300);
    const overlayItems = widget.getOverlayItems(viewport);
    const projected = widget.projectItems(overlayItems, viewport);
    expect((projected[0].props as any).children).toBe('Hello tooltip');

    widget.onHover({object: null, coordinate: [0, 0], viewport} as any);
    const hiddenItems = widget.getOverlayItems(viewport);
    expect(hiddenItems).toHaveLength(0);

    widget.onRemove();
    vi.useRealTimers();
  });
});
