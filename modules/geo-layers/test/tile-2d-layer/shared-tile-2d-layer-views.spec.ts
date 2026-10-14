// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {SharedTile2DLayer} from '../../src';

/** A stand-in tileset view that records whether the layer finalized it. */
function createView() {
  return {
    finalized: false,
    isLoaded: true,
    selectedTiles: [],
    update: () => 1,
    finalize() {
      this.finalized = true;
    }
  };
}

describe('SharedTile2DLayer view pruning', () => {
  it('drops the bootstrap view when every known real view is gone from the deck', () => {
    const placeholder = createView();
    const removed = createView();
    const layer: any = new SharedTile2DLayer({id: 'tiles', getTileData: () => null});
    // The deck replaced its only view `a` with `b`, which the layer has not been drawn in yet.
    layer.context = {deck: {getViewports: () => [{id: 'b'}]}};
    layer.state = {
      tilesetViews: new Map([
        ['DEFAULT-INITIAL-VIEWPORT', placeholder],
        ['a', removed]
      ]),
      frameNumbers: new Map(),
      isLoaded: false,
      tileLayers: new Map()
    };
    layer._knownViewports.set('DEFAULT-INITIAL-VIEWPORT', {});
    layer._knownViewports.set('a', {});
    layer.setState = (state: any) => Object.assign(layer.state, state);

    layer._updateTileset();

    expect([...layer.state.tilesetViews.keys()]).toEqual([]);
    expect([...layer._knownViewports.keys()]).toEqual([]);
    expect(placeholder.finalized).toBe(true);
    expect(removed.finalized).toBe(true);
  });

  it('keeps the bootstrap view while the deck has no viewports', () => {
    const placeholder = createView();
    const layer: any = new SharedTile2DLayer({id: 'tiles', getTileData: () => null});
    layer.context = {deck: {getViewports: () => []}};
    layer.state = {
      tilesetViews: new Map([['DEFAULT-INITIAL-VIEWPORT', placeholder]]),
      frameNumbers: new Map(),
      isLoaded: false,
      tileLayers: new Map()
    };
    layer._knownViewports.set('DEFAULT-INITIAL-VIEWPORT', {});
    layer.setState = (state: any) => Object.assign(layer.state, state);

    layer._updateTileset();

    expect([...layer.state.tilesetViews.keys()]).toEqual(['DEFAULT-INITIAL-VIEWPORT']);
    expect(placeholder.finalized).toBe(false);
  });
});
