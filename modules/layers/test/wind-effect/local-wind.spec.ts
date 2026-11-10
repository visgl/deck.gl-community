// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, expect, it, vi} from 'vitest';
import {
  TreeLayer,
  WindEffect,
  getLocalWindStrengths,
  getWindStrength,
  type TreeSpec,
  type WindSampler
} from '../../src';

const device = {} as any;

// Speed rises 1 m/s every 10 m eastward; nothing is known west of x = -50.
const sampleRamp: WindSampler = ([x], time) =>
  x < -50 ? null : {speed: 6 + x / 10 + time, direction: 90};

describe('getLocalWindStrengths', () => {
  it('turns each sampled speed into that object’s bend', () => {
    const trees: TreeSpec[] = [-20, 0, 40, 400].map(x => ({position: [x, 0], species: 'oak'}));
    const strengths = getLocalWindStrengths(trees, sampleRamp);
    expect(strengths).toEqual([4, 6, 10, 46].map(getWindStrength));
    expect(strengths[3]).toBe(0.2);
    expect(strengths[0]!).toBeLessThan(strengths[1]!);
    // The sampler's time and a custom position accessor pass through.
    const points = [{x: 0}, {x: 30}];
    const sampler = vi.fn(sampleRamp);
    const later = getLocalWindStrengths(points, sampler, {
      getPosition: ({x}, index) => [x, index],
      time: 2
    });
    expect(sampler.mock.calls).toEqual([
      [[0, 0], 2],
      [[30, 1], 2]
    ]);
    expect(later).toEqual([8, 11].map(getWindStrength));
  });

  it('leaves objects without data or position to the scene wind', () => {
    const strengths = getLocalWindStrengths(
      [{position: [-80, 0]}, {}, {position: [0, 0]}, null, {position: [10, 0]}],
      ([x], time) => (x === 10 ? {speed: Number.NaN} : sampleRamp([x], time))
    );
    expect(strengths).toEqual([undefined, undefined, getWindStrength(6), undefined, undefined]);
  });

  it('feeds TreeLayer per-tree strengths that keep the effect’s direction and clock', () => {
    const deck = {};
    const effect = new WindEffect({speed: 6, direction: 45, gust: 0.4});
    effect.setup({deck, device} as any);
    const base: TreeSpec[] = [-60, 0, 30].map(x => ({position: [x, 0], species: 'citrus'}));
    const strengths = getLocalWindStrengths(base, sampleRamp);
    const trees = base.map((tree, i) => ({...tree, wind: strengths[i]}));
    const layer = new TreeLayer<TreeSpec>({id: 'local-wind', data: trees});
    layer.initializeState();
    vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
    layer.updateState({
      props: layer.props,
      oldProps: {} as any,
      changeFlags: {dataChanged: true} as any
    });
    (layer as any).context = {deck};
    const wood = layer.renderLayers().find(child => child.id.includes('-wood-'))!;
    // The windiest tree sets the layer strength; the others are fractions of it.
    const strongest = getWindStrength(9);
    expect(wood.props.windStrength).toBeCloseTo(strongest, 12);
    const flex = wood.props.data.map(row => wood.props.getWind(row)[2]);
    // The first tree is outside the stations, so it follows the effect's own 6 m/s.
    [getWindStrength(6), getWindStrength(6), strongest].forEach((value, i) =>
      expect(flex[i]).toBeCloseTo(value / strongest, 6)
    );
    // Strength is pinned per tree; direction, gusts and the clock stay the effect's.
    expect(wood.props.windTime).toBeNull();
    effect.cleanup({deck, device} as any);
  });
});
