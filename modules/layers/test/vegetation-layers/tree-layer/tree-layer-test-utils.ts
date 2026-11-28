// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LayerManager, type Layer, type Viewport, WebMercatorViewport} from '@deck.gl/core';
import {device} from '@deck.gl/test-utils/vitest';
import {WindEffect} from '@deck.gl-community/layers/wind-layers/wind-effect';
import {Timeline} from '@luma.gl/engine';
import {afterEach} from 'vitest';
import {type CropKind, TreeLayer, type TreeLayerProps} from '../../../src';

export type TreeTestWind = {
  windStrength?: number;
  windDirection?: number | null;
  windTime?: number | null;
};

type TreePartProps<DataT> = {
  getTag: (row: {object?: DataT}, info: {index: number}) => unknown;
  kind?: CropKind;
  material: Record<string, number>;
  shadowEnabled?: boolean;
  windDirection: [number, number] | null;
  windStrength?: number;
  windTime: number;
};

const scenes: LayerManager[] = [];

afterEach(() => {
  for (const manager of scenes.splice(0)) manager.finalize();
});

/** Run layer updates with deck.gl's source rows and a clock controlled by the test. */
export function mountTreeScene<DataT>(
  viewport: Viewport = new WebMercatorViewport({width: 256, height: 256, zoom: 19, pitch: 30})
) {
  const timeline = new Timeline();
  timeline.setTime(1000);
  const deck = {getViewports: () => [viewport], _addDefaultEffect: () => {}};
  const wind = new WindEffect({strength: 0});
  wind.setup({deck, device} as never);
  const manager = new LayerManager(device, {
    viewport,
    timeline,
    deck
  } as never);
  const errors: Error[] = [];
  manager.setProps({onError: (error: Error) => errors.push(error)});
  scenes.push(manager);
  const layer = () => manager.getLayers().find(child => child.id === 'trees') as TreeLayer<DataT>;
  const assertNoErrors = () => {
    if (errors.length) throw errors.shift()!;
  };
  return {
    layer,
    row: (index = 0) => layer().state.store!.getRowValues(index),
    children: () =>
      manager.getLayers().filter(child => child.id !== 'trees') as Layer<TreePartProps<DataT>>[],
    render({
      windStrength = 0,
      windDirection = null,
      windTime = null,
      ...props
    }: Omit<TreeLayerProps<DataT>, 'id'> & TreeTestWind) {
      wind.setProps({strength: windStrength, direction: windDirection, time: windTime});
      manager.setLayers([new TreeLayer<DataT>({...props, id: 'trees'})]);
      assertNoErrors();
      return layer();
    },
    setViewport(next: Viewport) {
      viewport = next;
      manager.activateViewport(next);
      // A Deck draw normally gives each layer its viewport before the next layer update.
      for (const layer of manager.getLayers()) layer.activateViewport(next);
      manager.updateLayers();
      assertNoErrors();
    },
    tick(time: number) {
      timeline.setTime(time);
      manager.updateLayers();
      assertNoErrors();
    }
  };
}
