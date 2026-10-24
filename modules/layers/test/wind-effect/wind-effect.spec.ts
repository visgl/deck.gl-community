// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, expect, it, vi} from 'vitest';
import {TreeLayer, WindEffect, WindExtension, type TreeSpec} from '../../src';
import {getLayerWind, getLayerWindBound} from '../../src/wind-effect/wind-effect';
import {
  WIND_DEFAULT_DIRECTION,
  getWindDisplacement,
  getWindGust,
  getWindGustIntegral,
  getWindStrength,
  getWindUniforms,
  getWindVelocity
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

  it('runs the leaf flutter faster than the trunk, scaled by turbulence', () => {
    const {flutter} = getWindUniforms({time: 2, turbulence: 1.5});
    expect(flutter).toEqual([
      1.5 * Math.sin(2 * 6.1),
      1.5 * Math.cos(2 * 6.1),
      1.5 * Math.sin(2 * 9.7),
      1.5 * Math.cos(2 * 9.7)
    ]);
    expect(getWindUniforms({turbulence: 0, time: 4}).flutter.every(value => value === 0)).toBe(
      true
    );
  });
});

describe('physical wind helpers', () => {
  it('maps speed to bend on the vegetation response curve, capped at 0.2', () => {
    expect(getWindStrength(5)).toBeCloseTo(0.025, 12);
    expect(getWindStrength(6)).toBeCloseTo(0.025 * 1.2 ** 1.4, 12);
    expect(getWindStrength(6)).toBeCloseTo(0.032, 3);
    expect(getWindStrength(15)).toBeCloseTo(0.116, 3);
    // Doubling the speed less than quadruples the bend: crowns streamline.
    expect(getWindStrength(10) / getWindStrength(5)).toBeCloseTo(2 ** 1.4, 12);
    const speeds = Array.from({length: 61}, (_, i) => i * 0.5);
    const strengths = speeds.map(getWindStrength);
    strengths.slice(1).forEach((value, i) => expect(value).toBeGreaterThanOrEqual(strengths[i]));
    const capped = 5 * 8 ** (1 / 1.4);
    expect(getWindStrength(capped - 0.01)).toBeLessThan(0.2);
    expect(getWindStrength(capped + 0.01)).toBe(0.2);
    expect(getWindStrength(60)).toBe(0.2);
    for (const still of [0, -4, Number.NaN]) expect(getWindStrength(still)).toBe(0);
  });

  it('follows the power-law height profile along the bearing the wind blows toward', () => {
    const [east, north] = getWindVelocity({speed: 6, direction: 90}, 10);
    expect(east).toBeCloseTo(6, 12);
    expect(north).toBeCloseTo(0, 12);
    // Default shear 1/7: four times higher is 4^(1/7) faster.
    expect(getWindVelocity({speed: 6, direction: 0}, 40)[1]).toBeCloseTo(6 * 4 ** (1 / 7), 12);
    // A rougher city profile.
    const city = getWindVelocity({speed: 6, direction: 180, shear: 0.25}, 2.5);
    expect(city[1]).toBeCloseTo(-6 * 0.25 ** 0.25, 12);
    expect(getWindVelocity({speed: 6, direction: 0, shear: 0}, 300)[1]).toBeCloseTo(6, 12);
    // Southwest-bound wind has equal, negative components.
    const southwest = getWindVelocity({speed: Math.SQRT2, direction: 225}, 10);
    southwest.forEach(value => expect(value).toBeCloseTo(-1, 12));
    expect(getWindVelocity({speed: 6}, 0)).toEqual([0, 0]);
    expect(getWindVelocity({speed: null}, 10)).toEqual([0, 0]);
    expect(getWindVelocity({}, 10)).toEqual([0, 0]);
    // The gust swell is the one that scales the bend.
    for (const time of [0, 1.7, 12.25]) {
      const gusty = getWindVelocity({speed: 4, direction: 90, gust: 0.5}, 10, time);
      expect(gusty[0]).toBeCloseTo(4 * (1 + 0.5 * getWindGust(time)), 12);
    }
  });

  it('integrates the gusty velocity exactly into the displacement', () => {
    const wind = {speed: 7, direction: 200, gust: 0.6, shear: 0.2};
    // Simpson's rule over the velocity, against the closed form.
    const integrate = (height: number, end: number) => {
      const steps = 4000;
      const h = end / steps;
      const sum = [0, 0];
      for (let i = 0; i <= steps; i++) {
        const weight = i === 0 || i === steps ? 1 : i % 2 ? 4 : 2;
        const velocity = getWindVelocity(wind, height, i * h);
        sum[0] += weight * velocity[0];
        sum[1] += weight * velocity[1];
      }
      return sum.map(value => (value * h) / 3);
    };
    for (const [height, end] of [
      [10, 3],
      [225, 17.5],
      [1500, 120]
    ]) {
      const exact = getWindDisplacement(wind, height, end);
      integrate(height, end).forEach((value, i) => expect(exact[i]).toBeCloseTo(value, 6));
    }
    getWindDisplacement(wind, 10, 0).forEach(value => expect(value).toBeCloseTo(0, 12));
    expect(getWindGustIntegral(0)).toBeCloseTo(0, 15);
    // Without gusts the air travels velocity × time.
    const steady = getWindDisplacement({speed: 5, direction: 90}, 10, 8);
    expect(steady[0]).toBeCloseTo(40, 12);
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

  it('derives the bend from speed unless strength is given', () => {
    expect(new WindEffect().strength).toBe(0.025);
    expect(new WindEffect({speed: undefined, strength: undefined}).strength).toBe(0.025);
    expect(new WindEffect({speed: 5}).strength).toBeCloseTo(0.025, 12);
    expect(new WindEffect({speed: 15}).strength).toBe(getWindStrength(15));
    expect(new WindEffect({speed: 0}).strength).toBe(0);
    expect(new WindEffect({speed: 40}).strength).toBe(0.2);
    // An explicit strength wins over speed, and 0 is still air.
    expect(new WindEffect({speed: 15, strength: 0.01}).strength).toBe(0.01);
    expect(new WindEffect({speed: 15, strength: 0}).strength).toBe(0);
    expect(new WindEffect({speed: 6}).props).toMatchObject({
      speed: 6,
      strength: null,
      shear: 1 / 7
    });

    const deck = {};
    const effect = new WindEffect({speed: 10, gust: 0.5});
    effect.setup({deck, device} as any);
    const layer = createLayer(deck, 1);
    expect(effect.getShaderModuleProps(layer).wind.strength).toBe(getWindStrength(10));
    expect(getLayerWind(layer).wind.strength).toBe(getWindStrength(10));
    const bound = getLayerWindBound(layer);
    expect(bound.strength).toBe(getWindStrength(10));
    expect(bound.peak).toBeCloseTo(getWindStrength(10) * 1.5, 12);
    expect(layer.state.windKey).toBe(effect.boundKey);
    // A new speed changes the bound; a new shear, or a speed past the cap, does not.
    effect.setProps({speed: 12, gust: 0.5});
    effect.preRender({layers: [layer]} as any);
    expect(layer.setNeedsUpdate).toHaveBeenCalledOnce();
    getLayerWindBound(layer);
    effect.setProps({speed: 12, gust: 0.5, shear: 0.3});
    effect.preRender({layers: [layer]} as any);
    expect(layer.setNeedsUpdate).toHaveBeenCalledOnce();
    effect.setProps({speed: 30, gust: 0.5});
    getLayerWindBound(layer);
    effect.setProps({speed: 45, gust: 0.5});
    effect.preRender({layers: [layer]} as any);
    expect(layer.setNeedsUpdate).toHaveBeenCalledOnce();
    effect.cleanup({deck, device} as any);
  });

  it('reads an app-owned callback clock without requesting redraws', () => {
    const deck = {};
    let seconds = 1.5;
    const clock = vi.fn(() => seconds);
    const effect = new WindEffect({speed: 8, time: clock});
    effect.setup({deck, device} as any);
    const layer = createLayer(deck, 30);
    expect(effect.getShaderModuleProps(layer).wind.time).toBe(1.5);
    expect(getLayerWind(layer)).toMatchObject({wind: {time: 1.5}, animated: false});
    seconds = 4;
    expect(getLayerWind(layer).wind.time).toBe(4);
    expect(getLayerWind(layer).wind.strength).toBe(getWindStrength(8));
    expect(clock).toHaveBeenCalled();
    // A layer's own clock still wins.
    expect(getLayerWind(layer, null, 9).wind.time).toBe(9);
    // `null` returns to the deck timeline and its redraw requests.
    effect.setProps({speed: 8, time: null});
    expect(getLayerWind(layer)).toMatchObject({wind: {time: 30}, animated: true});
    effect.cleanup({deck, device} as any);
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
    // An app-owned clock: the extension draws the app's time and leaves scheduling to the app.
    effect.setProps({strength: 0.05, direction: 200, time: () => 6.5});
    const scheduled = createExtended(deck);
    scheduled.extension.draw.call(scheduled.layer, {}, scheduled.extension);
    expect(scheduled.layer.setShaderModuleProps.mock.calls[0][0].wind.time).toBe(6.5);
    expect(scheduled.layer.setNeedsRedraw).not.toHaveBeenCalled();
    effect.cleanup({deck, device} as any);
  });
});
