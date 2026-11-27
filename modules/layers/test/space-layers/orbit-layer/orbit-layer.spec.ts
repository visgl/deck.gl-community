// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LayerManager, WebMercatorViewport} from '@deck.gl/core';
import {device} from '@deck.gl/test-utils/vitest';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {OrbitLayer, type OrbitLayerProps} from '@deck.gl-community/layers/space-layers';
import fixture from './data/gp-fixture.omm.json';

const ISS = 25544;
const TIME_MS = Date.UTC(2026, 10, 24);
const SATELLITES = 224;
const viewport = new WebMercatorViewport({width: 100, height: 100, zoom: 0});
const managers: LayerManager[] = [];

afterEach(() => {
  for (const layerManager of managers.splice(0)) {
    layerManager.finalize();
  }
  vi.unstubAllGlobals();
});

function mount(props: Partial<OrbitLayerProps>) {
  const layerManager = new LayerManager(device, {viewport});
  managers.push(layerManager);
  const errors: Error[] = [];
  let layerProps: Partial<OrbitLayerProps> = {
    id: 'orbits',
    currentTime: TIME_MS,
    propagation: 'main-thread',
    onError: error => {
      errors.push(error);
    }
  };
  const setLayer = (nextProps: Partial<OrbitLayerProps>) => {
    layerProps = {...layerProps, ...nextProps};
    layerManager.setLayers([new OrbitLayer(layerProps)]);
  };
  setLayer(props);
  const getLayer = () => layerManager.getLayers()[0] as OrbitLayer;
  return {errors, getLayer, setLayer, layerManager};
}

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out: ${message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** True when the layer has a sample for all satellites. */
function hasSatellites(layer: OrbitLayer): boolean {
  const {dataset, sampleB} = layer.state;
  return Boolean(dataset && sampleB && dataset.satellites.length === SATELLITES);
}

/** A `fetch` prop that returns the fixture rows for any URL. */
function createFetch() {
  return vi.fn(async () => fixture);
}

describe('OrbitLayer (node)', () => {
  it('falls back to the main thread once when the worker cannot load', async () => {
    expect(typeof Worker).toBe('undefined');
    const onDataLoad = vi.fn();
    const {errors, getLayer} = mount({
      data: JSON.stringify(fixture),
      propagation: 'worker',
      onDataLoad
    });
    await waitFor(() => hasSatellites(getLayer()), 'satellites after the fallback');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/worker/i);
    expect(errors[0].message).toMatch(/main thread/);
    expect(errors[0].message).toContain("optimizeDeps: {exclude: ['@deck.gl-community/layers']}");
    expect(onDataLoad).toHaveBeenCalledTimes(1);
    // No second report and no second fallback while time moves on.
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(errors).toHaveLength(1);
  });

  it.each([
    'data/active.json',
    'blob:http://localhost/1234',
    'https://example.com/gp.json'
  ])('loads the string %s as a URL', async url => {
    const fetch = createFetch();
    const {errors, getLayer} = mount({data: url, fetch} as Partial<OrbitLayerProps>);
    await waitFor(() => hasSatellites(getLayer()), 'satellites from the URL');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe(url);
    expect(errors).toEqual([]);
  });

  it('reads a single-line JSON string as OMM text', async () => {
    const fetch = createFetch();
    const {errors, getLayer} = mount({
      data: JSON.stringify(fixture),
      fetch
    } as Partial<OrbitLayerProps>);
    await waitFor(() => hasSatellites(getLayer()), 'satellites from JSON text');
    expect(fetch).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('reports a new selection while time is paused', async () => {
    const onSelectedPositionChange = vi.fn();
    const {getLayer, setLayer} = mount({data: JSON.stringify(fixture), onSelectedPositionChange});
    await waitFor(() => hasSatellites(getLayer()), 'a sample at the paused time');

    const layer = getLayer();
    const index = layer.state.dataset!.satellites.findIndex(satellite => satellite.noradId === ISS);
    const satellite = layer.getSatellite(index)!;
    expect(satellite.position).not.toBeNull();

    setLayer({selectedNoradId: ISS});
    expect(onSelectedPositionChange).toHaveBeenCalledExactlyOnceWith(satellite.position, satellite);

    setLayer({selectedNoradId: -1});
    expect(onSelectedPositionChange).toHaveBeenCalledTimes(1);
  });

  it('does not report a pending worker init rejected on unmount', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        postMessage() {}
        terminate() {}
      }
    );
    const onError = vi.fn();
    const {getLayer, layerManager} = mount({
      data: JSON.stringify(fixture),
      propagation: 'worker',
      onError
    });
    const init = vi.spyOn(getLayer().state.propagator, 'init');
    await waitFor(() => init.mock.calls.length > 0, 'the worker init request');

    layerManager.setLayers([]);
    await expect(init.mock.results[0].value).rejects.toThrow(/destroyed/);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports an error that a user callback throws', async () => {
    const {errors} = mount({
      data: JSON.stringify(fixture),
      onDataLoad: () => {
        throw new Error('onDataLoad failed');
      }
    });
    await waitFor(() => errors.length > 0, 'the callback error');
    expect(errors[0].message).toMatch(/onDataLoad failed/);
  });
});
