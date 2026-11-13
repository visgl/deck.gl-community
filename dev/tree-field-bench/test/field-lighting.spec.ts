// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  AmbientLight,
  COORDINATE_SYSTEM,
  DirectionalLight,
  OrbitViewport,
  project,
  type EffectContext
} from '@deck.gl/core';
import type {ShaderModule} from '@luma.gl/shadertools';
import {Matrix4} from '@math.gl/core';
import {describe, expect, it} from 'vitest';
import {createFieldShadowModule, FieldLightingEffect} from '../field-lighting';

const WIDTH = 1163;
const HEIGHT = 654;
const LIGHT = new Matrix4().lookAt({eye: [1, 2, 3]});
const PROBES = [
  [2.37, -1.54, 0.3],
  [-0.71, 0.86, 1.73],
  [4.98, 6.43, 3.1]
];

function view(
  distance: number,
  target: [number, number, number] = [0, 0, 1.5],
  rotationOrbit = 0,
  rotationX = 10
): OrbitViewport {
  return new OrbitViewport({
    width: WIDTH,
    height: HEIGHT,
    fovy: 36.87,
    zoom: Math.log2((1.5 * HEIGHT) / distance),
    target,
    rotationOrbit,
    rotationX
  });
}

function shaderOptions(viewport: OrbitViewport, drawToShadowMap: boolean) {
  return {
    project: {viewport, coordinateSystem: COORDINATE_SYSTEM.CARTESIAN, devicePixelRatio: 1},
    shadowMatrices: [LIGHT],
    drawToShadowMap
  };
}

function sampleWorldTexels(
  field: ReturnType<typeof createFieldShadowModule>,
  viewport: OrbitViewport
) {
  const caster = field.module.getUniforms(shaderOptions(viewport, true));
  const receiver = field.module.getUniforms(shaderOptions(viewport, false));
  expect(caster.drawShadowMap).toBe(true);
  expect(receiver.drawShadowMap).toBe(false);
  expect(caster.viewProjectionMatrix0).toEqual(receiver.viewProjectionMatrix0);
  expect(caster.projectCenter0).toEqual(receiver.projectCenter0);
  const {commonOrigin} = project.getUniforms(shaderOptions(viewport, false).project) as {
    commonOrigin: [number, number, number];
  };
  const matrix = new Matrix4(caster.viewProjectionMatrix0);
  const center = caster.projectCenter0!;
  return PROBES.map(point => {
    const projected = matrix.transformAsPoint(
      point.map((value, index) => value - commonOrigin[index])
    );
    return [
      (1 + projected[0] + center[0]) * 0.5 * WIDTH,
      (1 + projected[1] + center[1]) * 0.5 * HEIGHT
    ];
  });
}

describe('playground light-space shadow window', () => {
  it('keeps shadow texels fixed while pitching moves the framing target', () => {
    const field = createFieldShadowModule();
    field.setAnchor([0, 0, 1.5]);
    const first = sampleWorldTexels(field, view(1));
    const initial = field.diagnostics!;
    const pitched = sampleWorldTexels(field, view(1, [0.4, -0.8, 1.2], 24, 62));
    expect(pitched).toEqual(first);
    expect(field.diagnostics).toEqual(initial);
  });

  it('keeps world points on the same fractional texels during orbit, zoom, and pan', () => {
    const field = createFieldShadowModule();
    const first = sampleWorldTexels(field, view(1));
    const initial = field.diagnostics!;
    expect(initial.span[1]).toBe(16);
    expect(initial.texelMetres).toBe(16 / HEIGHT);
    const sameTarget = sampleWorldTexels(field, view(1.3, [0, 0, 1.5], 108, 65));
    expect(sameTarget).toEqual(first);
    expect(field.diagnostics).toEqual(initial);

    const panned = sampleWorldTexels(field, view(1.15, [0.391, -0.623, 1.761], 42, 20));
    const {texelMetres, span, snappedCenter} = field.diagnostics!;
    expect(texelMetres).toBe(initial.texelMetres);
    expect(span).toEqual(initial.span);
    expect(snappedCenter).not.toEqual(initial.snappedCenter);
    for (let point = 0; point < PROBES.length; point++) {
      for (let axis = 0; axis < 2; axis++) {
        const shift = panned[point][axis] - first[point][axis];
        expect(Math.abs(shift)).toBeGreaterThan(1);
        expect(shift).toBeCloseTo(Math.round(shift), 8);
      }
    }
  });

  it('holds the coarser texel grid through a zoom reversal near a band boundary', () => {
    const field = createFieldShadowModule();
    sampleWorldTexels(field, view(7.9));
    const near = field.diagnostics!.texelMetres;
    sampleWorldTexels(field, view(8.1));
    const coarse = field.diagnostics!.texelMetres;
    expect(coarse).toBe(near * 2);
    sampleWorldTexels(field, view(7.9));
    expect(field.diagnostics!.texelMetres).toBe(coarse);
    sampleWorldTexels(field, view(6.6));
    expect(field.diagnostics!.texelMetres).toBe(near);
  });

  it('keeps the inspection grid through a small zoom reversal', () => {
    const field = createFieldShadowModule();
    for (const [distance, span] of [
      [6.7, 32],
      [6.3, 16],
      [7.3, 16],
      [7.7, 32],
      [7.3, 32]
    ]) {
      sampleWorldTexels(field, view(distance));
      expect(field.diagnostics!.span[1]).toBe(span);
    }
  });

  it('keeps the captured transform through a blend and finishes before reversing', () => {
    const field = createFieldShadowModule();
    const near = view(1);
    const far = view(9);
    const first = field.module.getUniforms(shaderOptions(near, true));
    expect(field.depthRange).toEqual([32, 32]);
    expect(field.beginFrame(far, 1, 1000, true)).toBe(true);
    const caster = field.module.getUniforms(shaderOptions(far, true));
    const receiver = field.module.getUniforms({...shaderOptions(far, false), historyWeight: 1});
    expect(field.historyWeight).toBe(1);
    expect(receiver.lightCount).toBe(2);
    expect(caster.lightCount).toBe(1);
    expect(receiver.viewProjectionMatrix0).toEqual(caster.viewProjectionMatrix0);
    expect(receiver.viewProjectionMatrix1).toEqual(first.viewProjectionMatrix0);
    expect(receiver.projectCenter1).toEqual(first.projectCenter0);
    expect(field.depthRange).toEqual([128, 32]);

    expect(field.beginFrame(near, 1, 1080, true)).toBe(false);
    expect(field.historyWeight).toBeCloseTo(0.5);
    const held = field.module.getUniforms(shaderOptions(near, true));
    expect(held.viewProjectionMatrix0).toEqual(caster.viewProjectionMatrix0);
    expect(field.beginFrame(near, 1, 1160, true)).toBe(true);
    expect(field.module.getUniforms(shaderOptions(near, true)).viewProjectionMatrix0).toEqual(
      first.viewProjectionMatrix0
    );
  });

  it('drops the saved texture transform on framebuffer resize', () => {
    const field = createFieldShadowModule();
    const near = view(1);
    const far = view(9);
    field.module.getUniforms(shaderOptions(near, true));
    expect(field.beginFrame(far, 1, 1000, true)).toBe(true);
    field.module.getUniforms(shaderOptions(far, true));
    expect(field.beginFrame(far, 2, 1040, true)).toBe(false);
    expect(field.historyWeight).toBe(0);
    expect(field.depthRange).toEqual([128, 128]);
    const receiver = field.module.getUniforms({...shaderOptions(far, false), historyWeight: 1});
    expect(receiver.lightCount).toBe(1);
    expect(receiver.viewProjectionMatrix1).toBeUndefined();
  });

  it('rejects an overzoomed pose and recovers a finite light fit at either tilt limit', () => {
    const field = createFieldShadowModule();
    const valid = view(2);
    const initial = field.module.getUniforms(shaderOptions(valid, true));
    for (const pitch of [-87, 87]) {
      const overzoomed = view(1e-10, [0, 0, 1.5], 0, pitch);
      expect(field.beginFrame(overzoomed, 1, 1000, true)).toBe(false);
      expect(field.module.getUniforms(shaderOptions(overzoomed, true)).drawShadowMap).toBe(false);
      const recovered = field.module.getUniforms(
        shaderOptions(view(2, [0, 0, 1.5], 0, pitch), true)
      );
      expect(recovered.drawShadowMap).toBe(true);
      expect(recovered.viewProjectionMatrix0).toEqual(initial.viewProjectionMatrix0);
      expect(recovered.projectCenter0?.every(Number.isFinite)).toBe(true);
    }
  });

  it('does not blend from a shadow attachment overwritten by an invalid pose', () => {
    const field = createFieldShadowModule();
    const close = view(2);
    const invalid = view(1e-10);
    const wide = view(9);
    field.beginFrame(close, 1, 1000, false);
    field.module.getUniforms(shaderOptions(close, true));
    expect(field.diagnostics?.span[1]).toBe(16);

    expect(field.beginFrame(invalid, 1, 1040, true)).toBe(false);
    expect(field.module.getUniforms(shaderOptions(invalid, true)).drawShadowMap).toBe(false);
    expect(field.diagnostics).toBeNull();

    expect(field.beginFrame(wide, 1, 1080, true)).toBe(false);
    expect(field.module.getUniforms(shaderOptions(wide, true)).drawShadowMap).toBe(true);
    expect(field.diagnostics?.span[1]).toBe(64);
    expect(field.historyWeight).toBe(0);
  });
});

it('registers the fitted module only while a shadow light is active', () => {
  const modules = new Set<ShaderModule>();
  const context = {
    deck: {
      _addDefaultShaderModule: (module: ShaderModule) => modules.add(module),
      _removeDefaultShaderModule: (module: ShaderModule) => modules.delete(module)
    },
    device: {
      createTexture: () => ({destroy() {}}),
      createFramebuffer: () => ({destroy() {}})
    }
  } as unknown as EffectContext;
  const ambient = new AmbientLight();
  const sun = new DirectionalLight({_shadow: true});
  const effect = new FieldLightingEffect({ambient});
  effect.setup(context);
  expect(modules.size).toBe(0);
  effect.setProps({ambient, sun});
  expect(modules.size).toBe(1);
  expect([...modules][0].dependencies?.some(module => module.name === 'fieldShadowBlend')).toBe(
    true
  );
  effect.setProps({ambient});
  expect(modules.size).toBe(0);
  effect.cleanup(context);
});
