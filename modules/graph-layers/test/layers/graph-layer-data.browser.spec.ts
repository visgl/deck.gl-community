// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {DOTLoaderWithParser} from '@loaders.gl/graphs/dot-loader';
import {expect, test, vi} from 'vitest';
import {GraphLayer} from '../../src/layers/graph-layer';
import {ClassicGraph} from '../../src/graph/classic-graph';
import {SimpleLayout} from '../../src/layouts/simple-layout';
import karateDot from '../data/__fixtures__/dot/karate.dot?raw';

test('deck.gl resolves graph URLs and replaces them with loaded graphs without an engine prop', async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const onDataLoad = vi.fn();
  const onError = vi.fn();
  const layer = new GraphLayer({
    id: 'graph-url',
    data: `data:text/vnd.graphviz,${encodeURIComponent(karateDot)}`,
    loaders: [DOTLoaderWithParser],
    layout: new SimpleLayout(),
    onDataLoad
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
  try {
    await expect.poll(() => layer.state?.graphEngine?.getNodes().length, {timeout: 10_000}).toBe(8);
    expect(onDataLoad).toHaveBeenCalledOnce();
    expect(layer.state.graphEngine!.getNodes()[0].getPropertyValue('label')).toBe('Mr. Hi');
    const graph = new ClassicGraph({
      data: {shape: 'plain-graph-data', nodes: [{id: 'replacement', attributes: {x: 10, y: 20}}]}
    });
    const replacement = layer.clone({data: graph});
    deck.setProps({layers: [replacement]});
    await expect
      .poll(() => replacement.state?.graphEngine?.getNodes().length, {timeout: 10_000})
      .toBe(1);
    expect(replacement.state.graphEngine!.getNodes()[0]).toBe(graph.findNodeById('replacement'));
    expect(onError).not.toHaveBeenCalled();
  } finally {
    deck.finalize();
    canvas.remove();
  }
}, 30_000);
