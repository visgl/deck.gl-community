// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, it, vi} from 'vitest';
import {SharedTile2DLayer} from '../../src';

describe('SharedTile2DLayer onTileError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a failed tile with console.error by default, as TileLayer does', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const layer = new SharedTile2DLayer({id: 'tiles', data: 'https://example.com/{z}/{x}/{y}'});
    const error = new Error('tile request failed');

    layer.props.onTileError(error);

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

    layer.props.onTileError(error);

    expect(onTileError).toHaveBeenCalledWith(error);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
