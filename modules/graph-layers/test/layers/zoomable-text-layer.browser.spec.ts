// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {expect, test, vi} from 'vitest';
import {ZoomableTextLayer} from '../../src/layers/common-layers/zoomable-text-layer/zoomable-text-layer';

test('text labels render supported widths and fall back for invalid scalar props', async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const onError = vi.fn();
  const deck = new Deck({
    canvas,
    width: 320,
    height: 240,
    views: [new OrthographicView()],
    initialViewState: {target: [0, 0, 0], zoom: 0},
    layers: [],
    onError
  });
  try {
    for (const width of [undefined, -1, 0, 120, 50000, NaN, Infinity, () => 32]) {
      const layer = new ZoomableTextLayer({
        id: 'label',
        data: [{text: 'Graph label'}],
        getPosition: () => [0, 0],
        getText: d => d.text,
        getSize: 16,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        getAngle: 0,
        getColor: [0, 0, 0, 255],
        textMaxWidth: width,
        updateTriggers: {}
      } as any);
      deck.setProps({layers: [layer]});
      await expect.poll(() => layer.getSubLayers()[0]?.isLoaded).toBe(true);
      const child = layer.getSubLayers()[0];
      expect(child.props.maxWidth).toBe(
        typeof width === 'number' && Number.isFinite(width) ? width : 12
      );
      expect(child.state.numInstances).toBe('Graph label'.length);
    }
    expect(onError).not.toHaveBeenCalled();
  } finally {
    deck.finalize();
    canvas.remove();
  }
}, 30_000);

test('node and edge label stylesheets preserve configured widths through actual sublayers', async () => {
  const {GraphLayer} = await import('../../src/layers/graph-layer');
  const {SimpleLayout} = await import('../../src/layouts/simple-layout');
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const onError = vi.fn();
  const layer = new GraphLayer({
    id: 'labels',
    data: {
      nodes: [
        {id: 'a', x: -20, y: 0},
        {id: 'b', x: 20, y: 0}
      ],
      edges: [{id: 'ab', sourceId: 'a', targetId: 'b'}]
    },
    layout: new SimpleLayout(),
    stylesheet: {
      nodes: [{type: 'label', text: 'Node', textMaxWidth: 120}],
      edges: {decorators: [{type: 'edge-label', text: 'Edge', textMaxWidth: 240}]}
    }
  });
  const deck = new Deck({
    canvas,
    width: 320,
    height: 240,
    views: [new OrthographicView()],
    initialViewState: {target: [0, 0, 0], zoom: 0},
    layers: [layer],
    onError
  });
  function collectWidths(composite: any): number[] {
    if (composite.constructor.layerName === 'TextLayer') return [composite.props.maxWidth];
    return composite.getSubLayers?.().flatMap(collectWidths) ?? [];
  }
  try {
    await expect.poll(() => collectWidths(layer).sort((a, b) => a - b)).toEqual([120, 240]);
    expect(onError).not.toHaveBeenCalled();
  } finally {
    deck.finalize();
    canvas.remove();
  }
}, 30_000);
