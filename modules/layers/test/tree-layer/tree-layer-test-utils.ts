// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LayerManager, type Layer, type Viewport, WebMercatorViewport} from '@deck.gl/core';
import {device} from '@deck.gl/test-utils/vitest';
import {Timeline} from '@luma.gl/engine';
import {afterEach} from 'vitest';
import {type CropKind, TreeLayer, type TreeLayerProps} from '../../src';

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
  const manager = new LayerManager(device, {
    viewport,
    timeline,
    deck: {getViewports: () => [viewport], _addDefaultEffect: () => {}}
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
    render(props: Omit<TreeLayerProps<DataT>, 'id'>) {
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
