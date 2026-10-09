// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
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
  fail() {
    this._onLayoutError();
  }
}

function initializeLayer(layer: GraphLayer) {
  vi.spyOn(layer, 'setNeedsRedraw').mockImplementation(() => {});
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  layer.initializeState();
  return layer;
}

function createLayer(layoutUpdateInterval = 0) {
  const layout = new ControlledLayout();
  const onLayoutChange = vi.fn();
  const onLayoutDone = vi.fn();
  const onLayoutError = vi.fn();
  const layer = initializeLayer(
    new GraphLayer({
      id: 'throttled',
      data: {nodes: [{id: 'a', x: 0, y: 0}]},
      layout,
      layoutUpdateInterval,
      onLayoutChange,
      onLayoutDone,
      onLayoutError
    })
  );
  vi.mocked(layer.setState).mockClear();
  return {layer, layout, onLayoutChange, onLayoutDone, onLayoutError};
}

function replaceLayer(layer: GraphLayer, props: Parameters<GraphLayer['clone']>[0]) {
  const replacement = layer.clone(props);
  replacement.state = layer.state;
  vi.spyOn(replacement, 'setNeedsRedraw').mockImplementation(() => {});
  vi.spyOn(replacement, 'setState').mockImplementation(state =>
    Object.assign(replacement.state, state)
  );
  replacement.updateState({
    props: replacement.props,
    oldProps: layer.props,
    changeFlags: {propsChanged: true}
  });
  return replacement;
}

describe('GraphLayer layout redraw cadence', () => {
  beforeEach(() => {
    globalThis.CustomEvent ??= Event as any;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY
  ])('updates immediately for interval %s', interval => {
    const {layer, layout, onLayoutChange} = createLayer(interval);
    layout.change();
    layout.change();
    expect(layer.setState).toHaveBeenCalledTimes(2);
    expect(onLayoutChange).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    layer.finalize();
  });

  it('coalesces a burst into the latest snapshot while forwarding every callback', () => {
    const {layer, layout, onLayoutChange} = createLayer(50);
    // Start at monotonic time zero must not disable throttling.
    vi.advanceTimersByTime(10);
    layout.change();
    layout.change();
    expect(layer.setState).not.toHaveBeenCalled();
    expect(onLayoutChange).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(39);
    expect(layer.setState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(layer.setState).toHaveBeenCalledTimes(1);
    expect(layer.state.layoutVersion).toBe(layout.version);
    vi.advanceTimersByTime(50);
    layout.change();
    expect(layer.setState).toHaveBeenCalledTimes(2);
    layer.finalize();
  });

  it.each([
    'done',
    'fail',
    'start'
  ] as const)('flushes %s immediately and cancels trailing work', event => {
    const {layer, layout, onLayoutDone, onLayoutError} = createLayer(50);
    vi.advanceTimersByTime(10);
    layout.change();
    const verifyFinalSnapshot = () => {
      expect(layer.state.layoutVersion).toBe(layout.version);
      expect(layer.state.layoutState).toBe(layout.state);
    };
    onLayoutDone.mockImplementation(verifyFinalSnapshot);
    onLayoutError.mockImplementation(verifyFinalSnapshot);
    layout[event]();
    expect(layer.state.layoutVersion).toBe(layout.version);
    expect(layer.state.layoutState).toBe(layout.state);
    expect(vi.getTimerCount()).toBe(0);
    expect(layer.setState).toHaveBeenCalledTimes(1);
    if (event === 'done') expect(onLayoutDone).toHaveBeenCalledOnce();
    if (event === 'fail') expect(onLayoutError).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(100);
    expect(layer.setState).toHaveBeenCalledTimes(1);
    layer.finalize();
  });

  it.each([0, 20, 100])('reschedules pending work when interval becomes %s', interval => {
    const {layer, layout} = createLayer(50);
    vi.advanceTimersByTime(10);
    layout.change();
    const replacement = replaceLayer(layer, {layoutUpdateInterval: interval});
    if (interval === 0) {
      expect(replacement.state.layoutVersion).toBe(layout.version);
      expect(vi.getTimerCount()).toBe(0);
    } else {
      vi.advanceTimersByTime(interval - 11);
      expect(replacement.setState).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(replacement.state.layoutVersion).toBe(layout.version);
    }
    expect(replacement.setState).toHaveBeenCalledOnce();
    expect(layer.setState).not.toHaveBeenCalled();
    replacement.finalize();
  });

  it('rebinds a pending snapshot and callbacks to a replacement layer with the same interval', () => {
    const {layer, layout, onLayoutChange} = createLayer(50);
    vi.advanceTimersByTime(10);
    layout.change();
    const callback = vi.fn();
    const replacement = replaceLayer(layer, {onLayoutChange: callback});
    layout.change();
    vi.advanceTimersByTime(40);
    expect(replacement.setState).toHaveBeenCalledOnce();
    expect(layer.setState).not.toHaveBeenCalled();
    expect(onLayoutChange).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
    replacement.finalize();
  });

  it('discards old engine work and renders a replacement immediately', () => {
    const {layer, layout} = createLayer(50);
    vi.advanceTimersByTime(10);
    layout.change();
    const nextLayout = new ControlledLayout();
    const replacement = replaceLayer(layer, {layout: nextLayout});
    expect(vi.getTimerCount()).toBe(0);
    expect(replacement.state.layoutVersion).toBe(nextLayout.version);
    vi.mocked(replacement.setState).mockClear();
    layout.change();
    vi.advanceTimersByTime(100);
    expect(replacement.setState).not.toHaveBeenCalled();
    replacement.finalize();
  });

  it('cancels pending work on finalization', () => {
    const {layer, layout} = createLayer(50);
    layout.change();
    layer.finalize();
    vi.mocked(layer.setState).mockClear();
    vi.advanceTimersByTime(100);
    expect(vi.getTimerCount()).toBe(0);
    expect(layer.setState).not.toHaveBeenCalled();
  });
});
