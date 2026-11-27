// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';

import {mountSatelliteOrbitsExample, type SatelliteOrbitsHandle} from './app';
import fixture from './data/gp-fixture.omm.json';

type LayerProps = {
  id: string;
  data: unknown;
  onDataLoad: (stats: {satellites: number; rejected: number}) => void;
};

const deckProps: {layers?: {props: LayerProps}[]} = {};

vi.mock('@deck.gl/core', async importOriginal => ({
  ...(await importOriginal<object>()),
  Deck: class {
    finalize = vi.fn();
    setProps(props: typeof deckProps) {
      Object.assign(deckProps, props);
    }
  },
  GlobeView: class {}
}));

vi.mock('@deck.gl-community/layers/space-layers', async importOriginal => ({
  ...(await importOriginal<object>()),
  OrbitLayer: class {
    constructor(public props: LayerProps) {}
  }
}));

describe('satellite orbits: dataset switching', () => {
  it('ignores a late live fetch and a stale data load after switching to the fixture', async () => {
    let resolveLive: (response: Response) => void;
    const slowLive = new Promise<Response>(resolve => {
      resolveLive = resolve;
    });
    const liveBody = JSON.stringify(fixture.slice(0, 1));
    const fetchGroup = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(liveBody))
      .mockReturnValueOnce(slowLive);

    const controls = new Map<
      string,
      {value?: string; onchange?: () => void; textContent?: string; disabled?: boolean}
    >();
    const panel = {
      style: {},
      remove: vi.fn(),
      querySelector(selector: string) {
        if (!controls.has(selector)) controls.set(selector, {});
        return controls.get(selector);
      }
    };
    const getControl = (id: string) => controls.get(`[data-id="${id}"]`)!;
    const container = {style: {}, appendChild: vi.fn()} as unknown as HTMLElement;

    let renderFrame: () => void = () => {};
    const getOrbitLayer = () => {
      renderFrame();
      return deckProps.layers!.find(layer => layer.props.id === 'orbits')!;
    };

    vi.useFakeTimers();
    vi.stubGlobal('document', {createElement: () => panel});
    vi.stubGlobal('localStorage', {getItem: () => null, setItem: vi.fn()});
    vi.stubGlobal('fetch', fetchGroup);
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      renderFrame = callback;
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    let handle: SatelliteOrbitsHandle;
    let cleanup: (() => void) | undefined;
    try {
      cleanup = mountSatelliteOrbitsExample(container, {
        group: 'gps-ops',
        onReady: value => {
          handle = value;
        }
      });
      await vi.advanceTimersByTimeAsync(0);
      const staleLayer = getOrbitLayer();
      expect(staleLayer.props.data).toBe(liveBody);

      // While a load runs, each frame passes the same `data`: a new array would reload the layer.
      const group = getControl('group');
      group.value = 'stations';
      group.onchange!();
      expect(fetchGroup).toHaveBeenLastCalledWith(expect.stringContaining('GROUP=stations'));
      const loadingData = getOrbitLayer().props.data;
      expect(getOrbitLayer().props.data).toBe(loadingData);
      group.value = 'fixture';
      group.onchange!();
      expect(getOrbitLayer().props.data).toBe(loadingData);
      await vi.advanceTimersByTimeAsync(0);

      // The old data load of the layer reports after the switch: the app drops it.
      staleLayer.props.onDataLoad({satellites: 1, rejected: 0});
      expect(getControl('status').textContent).toBe('Loading fixture...');
      expect(handle!.stats.count).toBe(0);

      const fixtureLayer = getOrbitLayer();
      expect(fixtureLayer.props.data).toBe(fixture);
      fixtureLayer.props.onDataLoad({satellites: fixture.length, rejected: 0});
      expect(getControl('status').textContent).toBe(`${fixture.length} satellites`);
      // The fixture has GEO satellites, so the GEO button is on.
      expect(getControl('geo').disabled).toBe(false);

      resolveLive!(new Response(liveBody));
      await vi.advanceTimersByTimeAsync(0);
      expect(group.value).toBe('fixture');
      expect(getOrbitLayer().props.data).toBe(fixture);
      expect(getControl('status').textContent).toBe(`${fixture.length} satellites`);
      expect(handle!.stats.count).toBe(fixture.length);
    } finally {
      cleanup?.();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
