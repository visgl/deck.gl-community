// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, expect, it, vi} from 'vitest';
import {TreeLayer, WindEffect, WindExtension, type TreeSpec} from '../../src';
import {getLayerWind, getLayerWindBound} from '../../src/wind-effect/wind-effect';
import {
  WIND_DEFAULT_DIRECTION,
  getWindGust,
  getWindUniforms
} from '../../src/wind-effect/wind-module';

const device = {} as any;

/** A stand-in layer: `getLayerWind` reads only the context and state. */
function createLayer(deck: object, seconds = 2, state: Record<string, unknown> = {}) {
  return {
    context: {deck, timeline: {getTime: () => seconds * 1000}},
    state,
    setNeedsUpdate: vi.fn(),
    getCurrentLayer() {
      return this;
    }
  } as any;
}

function mat2Multiply(m: number[], p: number[]) {
  return [m[0] * p[0] + m[2] * p[1], m[1] * p[0] + m[3] * p[1]];
}

/** Rotate a world vector clockwise by a compass bearing change. */
function rotateBearing(p: number[], degrees: number) {
  const angle = (-degrees * Math.PI) / 180;
  return [
    Math.cos(angle) * p[0] - Math.sin(angle) * p[1],
    Math.sin(angle) * p[0] + Math.cos(angle) * p[1]
  ];
}

describe('wind shader module', () => {
  it('reproduces the original fixed axis and crown mode at the default direction', () => {
    const uniforms = getWindUniforms({strength: 0.05, time: 1.25});
    expect(WIND_DEFAULT_DIRECTION).toBeCloseTo(65.77, 2);
    uniforms.axis.forEach((value, i) => expect(value).toBeCloseTo([1, 0.45][i], 12));
    uniforms.mode.forEach((value, i) => expect(value).toBeCloseTo([0.65, -0.25, 0.3, 0.8][i], 12));
    expect(uniforms.strength).toBe(0.05);
    expect(uniforms.wave).toEqual([Math.sin(2), Math.cos(2), Math.sin(4), Math.cos(4)]);
  });

  it('rotates the whole deformation with the wind direction', () => {
    const base = getWindUniforms({});
    for (const turn of [90, -35, 180]) {
      const turned = getWindUniforms({direction: WIND_DEFAULT_DIRECTION + turn});
      const axis = rotateBearing(base.axis, turn);
      turned.axis.forEach((value, i) => expect(value).toBeCloseTo(axis[i], 12));
      // A point rotated with the wind moves exactly as the rotated, original displacement.
      for (const point of [
        [1, 0],
        [0.3, -2],
        [-4, 1.5]
      ]) {
        const expected = rotateBearing(mat2Multiply(base.mode, point), turn);
        const actual = mat2Multiply(turned.mode, rotateBearing(point, turn));
        actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 12));
      }
    }
    // Due east: the bend axis points along +x.
    const east = getWindUniforms({direction: 90});
    expect(east.axis[1]).toBeCloseTo(0, 12);
    expect(east.axis[0]).toBeCloseTo(Math.hypot(1, 0.45), 12);
  });

  it('swells strength within the gust band and scales the crown mode by turbulence', () => {
    const strengths: number[] = [];
    for (let time = 0; time < 30; time += 0.05) {
      expect(Math.abs(getWindGust(time))).toBeLessThanOrEqual(1);
      strengths.push(getWindUniforms({strength: 0.1, gust: 0.5, time}).strength);
    }
    expect(Math.min(...strengths)).toBeGreaterThanOrEqual(0.05 - 1e-12);
    expect(Math.max(...strengths)).toBeLessThanOrEqual(0.15 + 1e-12);
    expect(Math.max(...strengths) - Math.min(...strengths)).toBeGreaterThan(0.05);
    expect(getWindUniforms({strength: 0.1, time: 3}).strength).toBe(0.1);
    const doubled = getWindUniforms({turbulence: 2}).mode;
    getWindUniforms({}).mode.forEach((value, i) => expect(doubled[i]).toBeCloseTo(value * 2, 12));
    expect(getWindUniforms({turbulence: 0}).mode.every(value => value === 0)).toBe(true);
  });
});

describe('WindEffect', () => {
  it('registers per deck and supplies module props on the layer timeline or a fixed clock', () => {
    const deck = {};
    const effect = new WindEffect({strength: 0.04, direction: 90});
    expect(effect.props).toMatchObject({strength: 0.04, direction: 90, gust: 0, turbulence: 1});
    expect(effect.useInPicking).toBe(true);
    expect(WindEffect.get(deck)).toBeUndefined();
    effect.setup({deck, device} as any);
    expect(WindEffect.get(deck)).toBe(effect);
    expect(WindEffect.get(undefined)).toBeUndefined();
    const layer = createLayer(deck, 3);
    expect(effect.getShaderModuleProps(layer).wind).toEqual({
      strength: 0.04,
      direction: 90,
      gust: 0,
      turbulence: 1,
      time: 3
    });
    effect.setProps({strength: 0.02, time: 7});
    expect(effect.props.direction).toBe(WIND_DEFAULT_DIRECTION);
    expect(effect.getShaderModuleProps(layer).wind.time).toBe(7);
    effect.cleanup({deck, device} as any);
    expect(WindEffect.get(deck)).toBeUndefined();
  });

  it('updates layers whose wind bounds came from another wind', () => {
    const deck = {};
    const effect = new WindEffect({strength: 0.04, gust: 0.25});
    effect.setup({deck, device} as any);
    const current = createLayer(deck, 0, {windKey: effect.boundKey});
    const stale = createLayer(deck, 0, {windKey: ''});
    const unrelated = createLayer(deck, 0);
    effect.preRender({layers: [current, stale, unrelated]} as any);
    expect(current.setNeedsUpdate).not.toHaveBeenCalled();
    expect(stale.setNeedsUpdate).toHaveBeenCalledOnce();
    expect(unrelated.setNeedsUpdate).not.toHaveBeenCalled();
    // Direction does not change bounds; strength does.
    effect.setProps({...effect.props, direction: 10});
    effect.preRender({layers: [current]} as any);
    expect(current.setNeedsUpdate).not.toHaveBeenCalled();
    effect.setProps({...effect.props, strength: 0.06});
    effect.preRender({layers: [current]} as any);
    expect(current.setNeedsUpdate).toHaveBeenCalledOnce();
    // Removing the effect releases every layer that used it.
    effect.cleanup({deck, device} as any);
    expect(current.setNeedsUpdate).toHaveBeenCalledTimes(2);
  });

  it('lets layer strength and clock override the effect and redraws only on the timeline', () => {
    const still = createLayer({});
    expect(getLayerWind(still)).toEqual({
      wind: {strength: 0, direction: WIND_DEFAULT_DIRECTION, gust: 0, turbulence: 1, time: 2},
      animated: false
    });
    expect(getLayerWind(still, 0.03).animated).toBe(true);
    expect(getLayerWind(still, 0.03, 5)).toMatchObject({wind: {time: 5}, animated: false});

    const deck = {};
    const effect = new WindEffect({strength: 0.04, direction: 120, gust: 0.5, turbulence: 0.5});
    effect.setup({deck, device} as any);
    const layer = createLayer(deck, 4);
    expect(getLayerWind(layer)).toEqual({
      wind: {strength: 0.04, direction: 120, gust: 0.5, turbulence: 0.5, time: 4},
      animated: true
    });
    // A sheltered layer keeps the scene's direction and gusts.
    expect(getLayerWind(layer, 0.01).wind).toMatchObject({strength: 0.01, direction: 120});
    expect(getLayerWind(layer, 0).animated).toBe(false);
    expect(getLayerWind(layer, null, 9)).toMatchObject({wind: {time: 9}, animated: false});
    effect.setProps({...effect.props, time: 6});
    expect(getLayerWind(layer)).toMatchObject({wind: {time: 6}, animated: false});
    effect.cleanup({deck, device} as any);
  });

  it('pads bounds for the gust peak and records the wind they cover', () => {
    const deck = {};
    const layer = createLayer(deck);
    expect(getLayerWindBound(layer)).toEqual({strength: 0, peak: 0, turbulence: 1});
    expect(layer.state.windKey).toBe('');
    const effect = new WindEffect({strength: 0.04, gust: 0.5, turbulence: 2});
    effect.setup({deck, device} as any);
    const bound = getLayerWindBound(layer);
    expect(bound.strength).toBe(0.04);
    expect(bound.peak).toBeCloseTo(0.06, 12);
    expect(bound.turbulence).toBe(2);
    expect(layer.state.windKey).toBe(effect.boundKey);
    expect(getLayerWindBound(layer, 0.1).peak).toBeCloseTo(0.15, 12);
    effect.cleanup({deck, device} as any);
  });
});

describe('TreeLayer under a WindEffect', () => {
  function prepare(data: TreeSpec[], deck: object, extra = {}) {
    const layer = new TreeLayer<TreeSpec>({id: 'wind-trees', data, ...extra});
    layer.initializeState();
    vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
    layer.updateState({
      props: layer.props,
      oldProps: {} as any,
      changeFlags: {dataChanged: true} as any
    });
    (layer as any).context = {deck};
    return layer;
  }
  const strengths = (layer: TreeLayer<TreeSpec>) =>
    layer
      .renderLayers()
      .map(child => [
        child.props.windStrength ?? child.props.deformationStrength,
        child.props.windTime ?? child.props.deformationTime
      ]);

  it('follows the effect strength unless the layer or a tree sets its own', () => {
    const deck = {};
    const trees: TreeSpec[] = [{position: [0, 0], species: 'oak'}];
    expect(strengths(prepare(trees, deck))).toContainEqual([0, null]);
    const effect = new WindEffect({strength: 0.04});
    effect.setup({deck, device} as any);
    const layer = prepare(trees, deck);
    const inherited = strengths(layer);
    expect(inherited.length).toBeGreaterThan(1);
    expect(inherited.every(([strength]) => strength === 0.04)).toBe(true);
    expect(layer.state.windKey).toBe(effect.boundKey);
    // An explicit 0 keeps a sheltered layer still; a clock override passes through.
    expect(strengths(prepare(trees, deck, {windStrength: 0, windTime: 2}))).toContainEqual([0, 2]);
    // A pinned tree keeps its own strength relative to the effect's.
    const pinned = prepare(
      [
        {position: [0, 0], species: 'citrus'},
        {position: [0.0001, 0], species: 'citrus', wind: 0.08}
      ],
      deck
    );
    const wood = pinned.renderLayers().find(child => child.id.includes('-wood-'))!;
    expect(wood.props.windStrength).toBe(0.08);
    expect(wood.props.data.map(row => wood.props.getWind(row)[2])).toEqual([0.5, 1]);
    effect.cleanup({deck, device} as any);
  });
});

describe('WindExtension', () => {
  function createExtended(deck: object, type = 'webgl', props: Record<string, unknown> = {}) {
    const extension = new WindExtension();
    const attributes: Record<string, any> = {};
    const layer = {
      ...createLayer(deck, 3),
      props: {...WindExtension.defaultProps, ...props},
      context: {deck, device: {type}, timeline: {getTime: () => 3000}},
      getAttributeManager: () => ({
        addInstanced: (added: object) => Object.assign(attributes, added)
      }),
      setShaderModuleProps: vi.fn(),
      setNeedsRedraw: vi.fn()
    } as any;
    return {extension, layer, attributes};
  }

  it('adds the wind module on WebGL2 and leaves WGSL layers unchanged', () => {
    const {extension, layer} = createExtended({});
    const shaders = extension.getShaders.call(layer, extension);
    expect(shaders.modules.map(module => module.name)).toEqual(['wind', 'windExtension']);
    const injected = shaders.modules[1].inject['vs:DECKGL_FILTER_GL_POSITION'];
    expect(injected.order).toBeLessThan(0);
    expect(injected.injection).toContain('splatDeform');
    const webgpu = createExtended({}, 'webgpu');
    expect(webgpu.extension.getShaders.call(webgpu.layer, webgpu.extension)).toEqual({});
  });

  it('packs per-object phases and spreads the default phase by index', () => {
    const {extension, layer, attributes} = createExtended({});
    extension.initializeState.call(layer, layer.context, extension);
    const {accessor, size, transform} = attributes.instanceWindExtension;
    expect([accessor, size]).toEqual(['getWind', 4]);
    expect(transform([12, Math.PI / 2, 2])).toEqual([12, 2, 1, Math.cos(Math.PI / 2)]);
    const getWind = WindExtension.defaultProps.getWind as any;
    const [first, second] = [0, 1].map(index => getWind.value(null, {index}));
    expect(first[0]).toBe(10);
    expect(second[1] - first[1]).toBeCloseTo(Math.PI * (3 - Math.sqrt(5)), 12);
  });

  it('draws with the effect, its own overrides, and redraws only on the timeline', () => {
    const deck = {};
    const effect = new WindEffect({strength: 0.05, direction: 200});
    effect.setup({deck, device} as any);
    const {extension, layer} = createExtended(deck, 'webgl', {windBase: 'ground'});
    extension.draw.call(layer, {}, extension);
    expect(layer.setShaderModuleProps).toHaveBeenCalledWith({
      wind: {strength: 0.05, direction: 200, gust: 0, turbulence: 1, time: 3},
      windExtension: {ground: 1}
    });
    expect(layer.setNeedsRedraw).toHaveBeenCalledOnce();
    const pinned = createExtended(deck, 'webgl', {windStrength: 0, windTime: 1});
    pinned.extension.draw.call(pinned.layer, {}, pinned.extension);
    expect(pinned.layer.setShaderModuleProps.mock.calls[0][0].wind).toMatchObject({
      strength: 0,
      direction: 200,
      time: 1
    });
    expect(pinned.layer.setNeedsRedraw).not.toHaveBeenCalled();
    effect.cleanup({deck, device} as any);
  });
});
