// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, it, vi} from 'vitest';
import {SharedTile2DHeader, SharedTile2DLayer} from '../../src';

/** Reports a failed tile to the layer as its tileset does, and returns the tile. */
function failTile(layer: SharedTile2DLayer, error: Error): SharedTile2DHeader {
  const tile = new SharedTile2DHeader({x: 0, y: 0, z: 0});
  const testLayer = layer as any;
  testLayer.state = {tileLayers: new Map()};
  testLayer.setNeedsUpdate = () => {};
  testLayer._onTileError(error, tile);
  return tile;
}

describe('SharedTile2DLayer onTileError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a failed tile with console.error by default, as TileLayer does', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const layer = new SharedTile2DLayer({id: 'tiles', data: 'https://example.com/{z}/{x}/{y}'});
    const error = new Error('tile request failed');

    failTile(layer, error);

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(error);
  });

  it('calls an application handler instead of logging', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onTileError = vi.fn();
    const layer = new SharedTile2DLayer({
      id: 'tiles',
      data: 'https://example.com/{z}/{x}/{y}',
      onTileError
    });
    const error = new Error('tile request failed');
    const tile = failTile(layer, error);

    expect(onTileError).toHaveBeenCalledWith(error, tile);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
