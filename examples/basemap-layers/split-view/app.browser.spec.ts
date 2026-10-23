// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mountBasemapSplitViewExample} from './app';

const mocks = vi.hoisted(() => ({
  failMap: false,
  workerUrl: 'original-worker',
  mapOptions: {} as Record<string, unknown>,
  finalize: vi.fn(),
  remove: vi.fn(),
  maxZoom: 20,
  maxPitch: 60
}));

vi.mock('@deck.gl/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@deck.gl/core')>();
  class View {}
  return {
    ...actual,
    MapView: View,
    FirstPersonView: View,
    _GlobeView: View,
    WebMercatorViewport: View,
    Deck: class {
      private widgets: import('@deck.gl/core').Widget[];
      constructor({
        parent,
        widgets = []
      }: {parent: HTMLElement; widgets?: import('@deck.gl/core').Widget[]}) {
        this.widgets = widgets;
        for (const widget of widgets) {
          const element = widget.onAdd({deck: this as never, viewId: null});
          parent.append(element);
          widget.onRenderHTML(element);
        }
      }
      setProps() {}
      finalize() {
        for (const widget of this.widgets) widget.onRemove();
        mocks.finalize();
      }
    }
  };
});
vi.mock('@deck.gl-community/basemap-layers', () => ({BasemapLayer: class {}}));
vi.mock('maplibre-gl', () => ({
  getWorkerUrl: () => mocks.workerUrl,
  setWorkerUrl: (url: string) => {
    mocks.workerUrl = url;
  },
  Map: class {
    constructor(options: Record<string, unknown>) {
      mocks.mapOptions = options;
      if (mocks.failMap) throw new Error('WebGL unavailable');
      mocks.maxZoom = options.maxZoom as number;
      mocks.maxPitch = options.maxPitch as number;
    }
    on() {}
    jumpTo() {}
    setProjection() {}
    resize() {}
    getMaxZoom() {
      return mocks.maxZoom;
    }
    getMaxPitch() {
      return mocks.maxPitch;
    }
    setMaxZoom(value: number) {
      mocks.maxZoom = value;
    }
    setMaxPitch(value: number) {
      mocks.maxPitch = value;
    }
    calculateCameraOptionsFromCameraLngLatAltRotation() {
      return {};
    }
    remove = mocks.remove;
  }
}));

describe('basemap comparison lifecycle and camera limits', () => {
  let container: HTMLDivElement;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.failMap = false;
    mocks.workerUrl = 'original-worker';
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    container.remove();
  });

  it('uses matching map limits and restores them after first-person mode', () => {
    cleanup = mountBasemapSplitViewExample(container);
    expect(mocks.mapOptions.maxZoom).toBe(20);
    expect(mocks.mapOptions.maxPitch).toBe(60);
    const selector = container.querySelector<HTMLSelectElement>('[aria-label="View mode"]')!;
    selector.value = 'first-person';
    selector.dispatchEvent(new Event('change'));
    expect(mocks.maxZoom).toBe(24);
    expect(mocks.maxPitch).toBe(85);
    selector.value = 'map';
    selector.dispatchEvent(new Event('change'));
    expect(mocks.maxZoom).toBe(20);
    expect(mocks.maxPitch).toBe(60);
  });

  it('releases the deck renderer, worker URL, and DOM when MapLibre setup fails', () => {
    mocks.failMap = true;
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL');
    try {
      expect(() => mountBasemapSplitViewExample(container)).toThrow('WebGL unavailable');
      expect(mocks.finalize).toHaveBeenCalledOnce();
      expect(mocks.workerUrl).toBe('original-worker');
      expect(revokeUrl).toHaveBeenCalledOnce();
      expect(container.childElementCount).toBe(0);
    } finally {
      revokeUrl.mockRestore();
    }
  });
});
