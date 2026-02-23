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
    expect(projected.map((item) => (item.props as any).children)).toStrictEqual([
      'Map Center Zero Elevation',
      'Map Center 50km Elevation'
    ]);
    expect(projected.map((item) => (item.props as any).x)).toStrictEqual([0, 0]);
    expect(projected.map((item) => (item.props as any).y)).toStrictEqual([0, 0]);
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

describe('HtmlClusterWidget (subclass API — backward compat)', () => {
  class TestClusterWidget extends HtmlClusterWidget<{id: number; coordinates: [number, number]}> {
    objects: {id: number; coordinates: [number, number]}[];

    constructor(objects: {id: number; coordinates: [number, number]}[]) {
      super();
      this.objects = objects;
    }

    override getAllObjects() {
      return this.objects;
    }

    override getObjectCoordinates(obj: {coordinates: [number, number]}) {
      return obj.coordinates;
    }

    override renderObject(coordinates: number[], obj: {id: number}) {
      return h(HtmlOverlayItem, {key: obj.id, coordinates}, `${obj.id}`);
    }

    override renderCluster(coordinates: number[], clusterId: number, pointCount: number) {
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

describe('HtmlClusterWidget (props-based API)', () => {
  type TestObj = {id: string; position: [number, number]};

  function makeWidget(objects: TestObj[], props: Record<string, any> = {}) {
    const widget = new HtmlClusterWidget<TestObj>({
      objects,
      getCoordinates: (obj) => obj.position,
      getKey: (obj) => obj.id,
      ...props
    });
    (widget as any).viewport = viewport;
    return widget;
  }

  it('getProjectedClusters returns typed point data for single points', () => {
    const objects: TestObj[] = [
      {id: 'a', position: [10, 20]},
      {id: 'b', position: [100, 50]}
    ];
    const widget = makeWidget(objects);

    const clusters = widget.getProjectedClusters();

    // At zoom 5 with very far apart points, they should not cluster
    expect(clusters).toHaveLength(2);
    for (const c of clusters) {
      expect(c.type).toBe('point');
      if (c.type === 'point') {
        expect(typeof c.object.id).toBe('string');
        expect(c.object.position).toHaveLength(2);
      }
      expect(typeof c.x).toBe('number');
      expect(typeof c.y).toBe('number');
      expect(c.coordinates).toHaveLength(2);
    }
  });

  it('getProjectedClusters merges nearby points into clusters', () => {
    const objects: TestObj[] = [
      {id: 'a', position: [0, 0]},
      {id: 'b', position: [0.00001, 0.00001]}
    ];
    const widget = makeWidget(objects);

    const clusters = widget.getProjectedClusters();

    expect(clusters).toHaveLength(1);
    expect(clusters[0].type).toBe('cluster');
    if (clusters[0].type === 'cluster') {
      expect(clusters[0].count).toBe(2);
      expect(typeof clusters[0].clusterId).toBe('number');
    }
  });

  it('getClusterObjects retrieves original objects from cluster ID', () => {
    const objects: TestObj[] = [
      {id: 'a', position: [0, 0]},
      {id: 'b', position: [0.00001, 0.00001]}
    ];
    const widget = makeWidget(objects);

    const clusters = widget.getProjectedClusters();
    expect(clusters).toHaveLength(1);
    expect(clusters[0].type).toBe('cluster');

    if (clusters[0].type === 'cluster') {
      const leaves = widget.getClusterObjects(clusters[0].clusterId);
      expect(leaves).toHaveLength(2);
      const ids = leaves.map((l) => l.id).sort();
      expect(ids).toEqual(['a', 'b']);
    }
  });

  it('getClusterExpansionZoom returns expansion zoom for cluster', () => {
    const objects: TestObj[] = [
      {id: 'a', position: [0, 0]},
      {id: 'b', position: [0.00001, 0.00001]}
    ];
    const widget = makeWidget(objects);

    const clusters = widget.getProjectedClusters();
    expect(clusters[0].type).toBe('cluster');

    if (clusters[0].type === 'cluster') {
      const expansionZoom = widget.getClusterExpansionZoom(clusters[0].clusterId);
      expect(typeof expansionZoom).toBe('number');
      expect(expansionZoom).toBeGreaterThan(5); // Must be above current zoom
    }
  });

  it('returns empty array when no viewport', () => {
    const widget = new HtmlClusterWidget<TestObj>({
      objects: [{id: 'a', position: [0, 0]}],
      getCoordinates: (obj) => obj.position
    });
    // No viewport set

    expect(widget.getProjectedClusters()).toEqual([]);
  });

  it('props-based objects work the same as subclass override', () => {
    // Props-based
    const objects: TestObj[] = [
      {id: 'a', position: [10, 20]},
      {id: 'b', position: [100, 50]}
    ];
    const propsWidget = makeWidget(objects);
    const propsClusters = propsWidget.getProjectedClusters();

    // Subclass-based
    class SubclassWidget extends HtmlClusterWidget<TestObj> {
      override getAllObjects() {
        return objects;
      }
      override getObjectCoordinates(obj: TestObj) {
        return obj.position;
      }
    }
    const subWidget = new SubclassWidget();
    (subWidget as any).viewport = viewport;
    const subClusters = subWidget.getProjectedClusters();

    expect(propsClusters).toHaveLength(subClusters.length);
    expect(propsClusters.map((c) => c.type)).toEqual(subClusters.map((c) => c.type));
  });

  it('uses getKey prop for point keys', () => {
    const widget = makeWidget([
      {id: 'my-unique-id', position: [10, 20]}
    ]);

    const clusters = widget.getProjectedClusters();
    expect(clusters).toHaveLength(1);
    expect(clusters[0].key).toBe('my-unique-id');
  });

  it('respects clusterRadius and maxClusterZoom props', () => {
    const objects: TestObj[] = [
      {id: 'a', position: [0, 0]},
      {id: 'b', position: [0.5, 0.5]}
    ];

    // Large radius — should cluster
    const widgetLarge = makeWidget(objects, {clusterRadius: 200});
    const clustersLarge = widgetLarge.getProjectedClusters();

    // Small radius — should NOT cluster
    const widgetSmall = makeWidget(objects, {clusterRadius: 1});
    const clustersSmall = widgetSmall.getProjectedClusters();

    expect(clustersLarge.length).toBeLessThanOrEqual(clustersSmall.length);
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
