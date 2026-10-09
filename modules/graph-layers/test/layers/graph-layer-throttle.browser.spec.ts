// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {expect, test, vi} from 'vitest';
import {GraphLayer} from '../../src/layers/graph-layer';
import {SimpleLayout} from '../../src/layouts/simple-layout';

class ControlledLayout extends SimpleLayout {
  start() {
    this._onLayoutStart();
  }
  change() {
    this._onLayoutChange();
  }
  done() {
    this._onLayoutDone();
  }
}

test('pending graph snapshots follow deck.gl layer replacement and flush on completion', async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const layout = new ControlledLayout();
  const onError = vi.fn();
  const onLayoutChange = vi.fn();
  const layer = new GraphLayer({
    id: 'throttled-graph',
    data: {nodes: [{id: 'a', x: 0, y: 0}]},
    layout,
    layoutUpdateInterval: 10_000,
    onLayoutChange,
    stylesheet: {nodes: [{type: 'circle', getRadius: 5}]}
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
    await expect.poll(() => layer.state?.graphEngine?.getNodes().length).toBe(1);
    const initialVersion = layer.state.layoutVersion;
    layout.change();
    expect(onLayoutChange).toHaveBeenCalledOnce();
    expect(layer.state.layoutVersion).toBe(initialVersion);
    const callback = vi.fn();
    const replacement = layer.clone({layoutUpdateInterval: 50, onLayoutChange: callback});
    deck.setProps({layers: [replacement]});
    await expect.poll(() => replacement.state?.layoutVersion).toBe(layout.version);
    layout.change();
    expect(callback).toHaveBeenCalledOnce();
    layout.done();
    expect(replacement.state.layoutVersion).toBe(layout.version);
    expect(replacement.state.layoutState).toBe('done');
    expect(replacement.state.layoutUpdates.timer).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  } finally {
    deck.finalize();
    canvas.remove();
  }
}, 30_000);
