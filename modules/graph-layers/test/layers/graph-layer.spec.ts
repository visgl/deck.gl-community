// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, it, vi} from 'vitest';

import {GraphLayer} from '../../src/layers/graph-layer';

function makeGraphLayerHarness(layoutUpdateInterval: number) {
  const layer = Object.create(GraphLayer.prototype) as GraphLayer & {
    props: {layoutUpdateInterval: number};
    state: {graphEngine: unknown};
    _layoutUpdateTimer: ReturnType<typeof setTimeout> | null;
    _lastLayoutUpdateTime: number;
    _pendingLayoutSnapshotEngine: unknown;
    _scheduleLayoutSnapshotUpdate: (engine?: unknown) => void;
    _clearLayoutUpdateTimer: () => void;
    _updateLayoutSnapshot: ReturnType<typeof vi.fn>;
  };

  layer.props = {layoutUpdateInterval};
  layer.state = {graphEngine: 'current-engine'};
  layer._layoutUpdateTimer = null;
  layer._lastLayoutUpdateTime = 0;
  layer._pendingLayoutSnapshotEngine = undefined;
  layer._updateLayoutSnapshot = vi.fn();

  return layer;
}

describe('layers/graph-layer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates layout snapshots immediately by default', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const layer = makeGraphLayerHarness(0);

    layer._scheduleLayoutSnapshotUpdate('first-engine');
    layer._scheduleLayoutSnapshotUpdate('second-engine');

    expect(layer._updateLayoutSnapshot).toHaveBeenCalledTimes(2);
    expect(layer._updateLayoutSnapshot).toHaveBeenNthCalledWith(1, 'first-engine');
    expect(layer._updateLayoutSnapshot).toHaveBeenNthCalledWith(2, 'second-engine');
  });

  it('coalesces layout snapshots when layoutUpdateInterval is set', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const layer = makeGraphLayerHarness(50);

    layer._scheduleLayoutSnapshotUpdate('first-engine');
    expect(layer._updateLayoutSnapshot).toHaveBeenCalledTimes(1);
    expect(layer._updateLayoutSnapshot).toHaveBeenLastCalledWith('first-engine');

    vi.advanceTimersByTime(10);
    layer._scheduleLayoutSnapshotUpdate('second-engine');
    layer._scheduleLayoutSnapshotUpdate('third-engine');

    expect(layer._updateLayoutSnapshot).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(39);
    expect(layer._updateLayoutSnapshot).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(layer._updateLayoutSnapshot).toHaveBeenCalledTimes(2);
    expect(layer._updateLayoutSnapshot).toHaveBeenLastCalledWith('third-engine');
  });

  it('clears pending throttled layout snapshots', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const layer = makeGraphLayerHarness(50);

    layer._scheduleLayoutSnapshotUpdate('first-engine');
    vi.advanceTimersByTime(10);
    layer._scheduleLayoutSnapshotUpdate('second-engine');
    layer._clearLayoutUpdateTimer();
    vi.advanceTimersByTime(50);

    expect(layer._updateLayoutSnapshot).toHaveBeenCalledTimes(1);
    expect(layer._updateLayoutSnapshot).toHaveBeenLastCalledWith('first-engine');
  });
});
