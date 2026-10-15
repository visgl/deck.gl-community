// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, test, vi} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer.ts';
import {LabelPlacement} from '../src/label-placement.ts';

/** A basemap without a style, set up as deck.gl sets up a layer, in the deck of `layerManager`. */
function basemap(layerManager: object, props: Record<string, unknown> = {}): any {
  const layer: any = new BasemapLayer({id: 'basemap', style: null, ...props} as any);
  layer.context = {layerManager};
  layer.initializeState();
  layer.setState = (partial: Record<string, unknown>) => Object.assign(layer.state, partial);
  update(layer);
  return layer;
}

/** Updates `layer` as deck.gl does, from `oldProps`. */
function update(layer: any, oldProps: Record<string, unknown> = {}): void {
  layer.updateState({props: layer.props, oldProps: {style: null, ...oldProps}, changeFlags: {}});
}

describe('BasemapLayer label placement', () => {
  test('the BasemapLayers of a deck place their labels together, as one style', () => {
    const layerManager = {};
    const base = basemap(layerManager);
    const labels = basemap(layerManager);
    const elsewhere = basemap({});
    expect(base.state.labelPlacement).toBeInstanceOf(LabelPlacement);
    expect(labels.state.labelPlacement).toBe(base.state.labelPlacement);
    expect(elsewhere.state.labelPlacement).not.toBe(base.state.labelPlacement);
  });

  test('separateLabelPlacement gives a BasemapLayer a placement of its own', () => {
    const layerManager = {};
    const base = basemap(layerManager);
    const separate = basemap(layerManager, {separateLabelPlacement: true});
    expect(separate.state.labelPlacement).toBeInstanceOf(LabelPlacement);
    expect(separate.state.labelPlacement).not.toBe(base.state.labelPlacement);
    // Its own placement is released with it; the shared one is not.
    const own = vi.spyOn(separate.state.labelPlacement, 'destroy');
    const shared = vi.spyOn(base.state.labelPlacement, 'destroy');
    separate.finalizeState();
    expect(own).toHaveBeenCalledTimes(1);
    expect(shared).not.toHaveBeenCalled();
  });

  test('the shared placement outlives each BasemapLayer but the last', () => {
    const layerManager = {};
    const base = basemap(layerManager);
    const labels = basemap(layerManager);
    const shared = base.state.labelPlacement;
    const destroy = vi.spyOn(shared, 'destroy');
    base.finalizeState();
    expect(destroy).not.toHaveBeenCalled();
    expect(labels.state.labelPlacement).toBe(shared);
    labels.finalizeState();
    expect(destroy).toHaveBeenCalledTimes(1);
    // A BasemapLayer added afterwards starts a new shared placement.
    expect(basemap(layerManager).state.labelPlacement).not.toBe(shared);
  });

  test('turning separateLabelPlacement on and off moves the layer between placements', () => {
    const layerManager = {};
    const base = basemap(layerManager);
    const toggled = basemap(layerManager);
    const shared = base.state.labelPlacement;
    const destroyShared = vi.spyOn(shared, 'destroy');

    toggled.props = {...toggled.props, separateLabelPlacement: true};
    update(toggled, {separateLabelPlacement: false});
    const own = toggled.state.labelPlacement;
    expect(own).not.toBe(shared);
    const destroyOwn = vi.spyOn(own, 'destroy');

    toggled.props = {...toggled.props, separateLabelPlacement: false};
    update(toggled, {separateLabelPlacement: true});
    expect(toggled.state.labelPlacement).toBe(shared);
    expect(destroyOwn).toHaveBeenCalledTimes(1);

    // The shared placement counted the toggled layer once: it goes with the last of the two.
    base.finalizeState();
    expect(destroyShared).not.toHaveBeenCalled();
    toggled.finalizeState();
    expect(destroyShared).toHaveBeenCalledTimes(1);
  });

  test('bare label layers of the deck share the placement of its BasemapLayers', async () => {
    const {MVTLabelLayer} = await import('../src/mvt-label-layer.ts');
    const layerManager = {};
    const base = basemap(layerManager);
    const label: any = new MVTLabelLayer({
      id: 'labels',
      config: {labels: true},
      styleLayer: {layout: {'text-field': 'x'}, paint: {}},
      zoom: 8
    } as any);
    label.context = {layerManager};
    label.state = {};
    expect(label.getLabelPlacement()).toBe(base.state.labelPlacement);
  });
});
