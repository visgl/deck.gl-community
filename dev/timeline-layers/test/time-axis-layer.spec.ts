// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {TimeAxisLayer} from '../src/layers/time-axis-layer';

import type {TimeAxisLayerProps} from '../src/layers/time-axis-layer';
import type {Tick} from '../src/utils/tick-utils';
import type {UpdateParameters, Viewport} from '@deck.gl/core';

type TestableTimeAxisLayer = TimeAxisLayer & {
  context: {viewport: Viewport};
  state: {
    ticks: Tick[];
    step: number;
    viewportWidth: number;
    visibleRange: [start: number, end: number];
    coveredRange: [start: number, end: number];
  };
};

const DEFAULT_PROPS = {
  id: 'time-axis',
  mode: 'duration' as const,
  unit: 'ms' as const,
  startTimeMs: 0,
  tickCount: 5,
  minorTickCount: 2,
  coverage: 3,
  minY: 0,
  maxY: 10,
  axisLine: true,
  tickLabels: true,
  labelY: 0,
  textColor: [0, 0, 0, 255] as [number, number, number, number],
  gridColor: [0, 0, 0, 255] as [number, number, number, number],
  timeZoneOffsetHours: 0,
  fontSize: 12
};

function makeViewport(bounds: unknown, width = 800): Viewport {
  return {
    width,
    getBounds: () => {
      if (bounds instanceof Error) {
        throw bounds;
      }
      return bounds;
    }
  } as Viewport;
}

function makeLayer(
  viewport: Viewport,
  props: Partial<TimeAxisLayerProps> = {}
): TestableTimeAxisLayer {
  const layer = new TimeAxisLayer({...DEFAULT_PROPS, ...props}) as TestableTimeAxisLayer;
  layer.state = {
    ticks: [{type: 'major', x: 1, value: 1, stepStart: 0}],
    step: 1,
    viewportWidth: 0,
    visibleRange: [0, 1],
    coveredRange: [0, 1]
  };
  Object.defineProperty(layer, 'context', {
    configurable: true,
    value: {viewport}
  });
  layer.setState = (nextState: Partial<TestableTimeAxisLayer['state']>) => {
    layer.state = {...layer.state, ...nextState};
  };
  return layer;
}

function updateLayer(layer: TestableTimeAxisLayer): void {
  layer.updateState({
    props: layer.props,
    oldProps: {...layer.props},
    changeFlags: {viewportChanged: true}
  } as UpdateParameters<TimeAxisLayer>);
}

describe('TimeAxisLayer', () => {
  it('clears ticks without throwing when viewport bounds are unavailable', () => {
    const layer = makeLayer(makeViewport(new Error('missing projection')));

    expect(() => updateLayer(layer)).not.toThrow();
    expect(layer.state.ticks).toEqual([]);
    expect(layer.state.visibleRange).toEqual([0, 0]);
    expect(layer.state.coveredRange).toEqual([0, 0]);
  });

  it('clears ticks without throwing when clamped bounds are empty', () => {
    const layer = makeLayer(makeViewport([0, 0, 100, 100]), {minX: 50, maxX: 50});

    expect(() => updateLayer(layer)).not.toThrow();
    expect(layer.state.ticks).toEqual([]);
    expect(layer.state.coveredRange).toEqual([0, 0]);
  });

  it('rebuilds ticks after an empty range becomes valid', () => {
    const layer = makeLayer(makeViewport([0, 0, 100, 100]));
    layer.state.ticks = [];
    layer.state.visibleRange = [0, 0];
    layer.state.coveredRange = [0, 0];

    updateLayer(layer);

    expect(layer.state.ticks.length).toBeGreaterThan(0);
    expect(layer.state.visibleRange).toEqual([0, 100]);
    expect(layer.state.coveredRange).toEqual([-100, 200]);
  });
});
