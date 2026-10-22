// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {getShaderAssembler, picking, project32, shadow} from '@deck.gl/core';
import {phongMaterial} from '@luma.gl/shadertools';
import {describe, expect, it, vi} from 'vitest';
import {SplatPrimitiveLayer} from '../../src/splat-layer/splat-primitive-layer';
import {SPLAT_FRAGMENT, SPLAT_VERTEX, splatUniforms} from '../../src/splat-layer/splat-shaders';
import {TreeLayer} from '../../src/tree-layer/tree-layer';
import {TreeMeshLayer} from '../../src/tree-layer/tree-mesh-layer';

const GLSL_PLATFORM = {
  type: 'webgl',
  shaderLanguage: 'glsl',
  shaderLanguageVersion: 300,
  gpu: 'test-webgl',
  features: new Set<string>()
} as const;

function assembleGLSL(vs: string, fs: string, modules: any[]) {
  return getShaderAssembler('glsl').assembleGLSLShaderPair({
    vs,
    fs,
    modules,
    platformInfo: GLSL_PLATFORM as any
  });
}

describe('TreeLayer shadow casting', () => {
  it('casts from every wood, crop and canopy sublayer unless shadowEnabled is false', () => {
    const data = [{species: 'oak', position: [0, 0, 0], height: 10, crownRadius: 4}];
    for (const [extra, expected] of [
      [{}, true],
      [{shadowEnabled: false}, false]
    ] as const) {
      const layer = new TreeLayer({
        id: 'trees',
        data,
        getTree: (row: any) => ({
          ...row,
          crop: {count: 4, droppedCount: 2, radius: 0.1, color: [200, 100, 30, 255]}
        }),
        ...extra
      } as any);
      layer.initializeState();
      vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
      layer.updateState({
        props: layer.props,
        oldProps: {},
        changeFlags: {dataChanged: true, propsChanged: true}
      } as any);
      const children = layer.renderLayers() as any[];
      const kinds = children.map(child => child.constructor.layerName);
      expect(kinds).toEqual(expect.arrayContaining(['TreeWoodLayer', 'SplatLayer']));
      expect(children.some(child => child.id.includes('crops'))).toBe(true);
      for (const child of children) expect(child.props.shadowEnabled).toBe(expected);
    }
  });
});

describe('SplatPrimitiveLayer shadow pass', () => {
  function makeLayer(type: 'webgl' | 'webgpu') {
    const model = {shaderInputs: {setProps: vi.fn()}, setInstanceCount: vi.fn(), draw: vi.fn()};
    const layer = Object.assign(Object.create(SplatPrimitiveLayer.prototype), {
      context: {device: {type, setParametersWebGL: vi.fn()}, timeline: {getTime: () => 0}},
      state: {model, effect: {resolve: vi.fn()}},
      props: {...SplatPrimitiveLayer.defaultProps, source: {}, deformationTime: 0},
      getNumInstances: () => 3,
      setNeedsRedraw: vi.fn()
    });
    return {layer, model};
  }
  const renderPass = {};
  const shadowPass = {
    picking: {isActive: false},
    project: {viewport: {id: 'map'}},
    shadow: {drawToShadowMap: true}
  };

  it('draws its Gaussians into the WebGL2 shadow map with the ordinary model', () => {
    const {layer, model} = makeLayer('webgl');
    layer.draw({shaderModuleProps: shadowPass, renderPass});
    expect(model.draw).toHaveBeenCalledWith(renderPass);
    expect(model.setInstanceCount).toHaveBeenCalledWith(3);
    expect(model.shaderInputs.setProps.mock.lastCall![0].splat.mode).toBe(0);
    // deck.gl's per-layer depth offset would pull later layers' shadow depth toward the light.
    expect(layer.context.device.setParametersWebGL).toHaveBeenCalledWith({polygonOffset: [0, 0]});
  });

  it('skips the shadow pass on WebGPU', () => {
    const {layer, model} = makeLayer('webgpu');
    layer.draw({shaderModuleProps: shadowPass, renderPass});
    expect(model.draw).not.toHaveBeenCalled();
  });

  it('projects and alpha-tests Gaussians in light space with the shadow module', () => {
    const modules = [project32, picking, phongMaterial, splatUniforms, shadow];
    const {vs, fs} = assembleGLSL(SPLAT_VERTEX, SPLAT_FRAGMENT, modules);
    // The footprint uses the light's matrix and is expanded after deck's position filter.
    expect(vs).toMatch(
      /rowX = vec3\(light\[0\]\.x, light\[1\]\.x, light\[2\]\.x\) \* viewportSize\.x \* 0\.5;[\s\S]*DECKGL_FILTER_GL_POSITION\(gl_Position, geometry\);\n#ifdef MODULE_SHADOW\n {2}\/\/[^\n]*\n {2}if \(shadow\.drawShadowMap\) \{\n {4}gl_Position\.xy \+= offset/
    );
    expect(fs).toMatch(
      /if \(alpha <= splatShadowThreshold\) discard;\n {4}fragColor = shadow_filterShadowColor/
    );
  });
});

describe('TreeMeshLayer shadow pass', () => {
  function makeLayer(type: 'webgl' | 'webgpu') {
    const setProps = vi.fn();
    const layer = Object.assign(Object.create(TreeMeshLayer.prototype), {
      context: {
        device: {type, setParametersWebGL: vi.fn()},
        defaultShaderModules: [shadow],
        timeline: {getTime: () => 0}
      },
      state: {model: {shaderInputs: {setProps}}},
      props: {...TreeMeshLayer.defaultProps, extensions: []},
      setNeedsRedraw: vi.fn()
    });
    return {layer, setProps};
  }

  it('writes the packed shadow depth after SimpleMeshLayer lighting', () => {
    const {vs, fs, modules} = makeLayer('webgl').layer.getShaders();
    expect(assembleGLSL(vs, fs, modules).fs).toMatch(
      /fragColor = vec4\(lightColor, color\.a \* layer\.opacity\);\s*#ifdef MODULE_SHADOW\n {2}if \(shadow\.drawShadowMap\) fragColor = shadow_filterShadowColor\(vec4\(0\.0\)\);/
    );
  });

  it('draws shadow depth without deck.gl layer depth offsets on WebGL2', () => {
    const {layer} = makeLayer('webgl');
    const draw = vi.spyOn(Object.getPrototypeOf(TreeMeshLayer.prototype), 'draw');
    draw.mockImplementation(() => {});
    layer.draw({shaderModuleProps: {shadow: {drawToShadowMap: true}}});
    expect(layer.context.device.setParametersWebGL).toHaveBeenCalledWith({polygonOffset: [0, 0]});
    expect(draw).toHaveBeenCalled();
    draw.mockRestore();
  });

  it('skips the shadow pass on WebGPU', () => {
    const {layer, setProps} = makeLayer('webgpu');
    layer.draw({shaderModuleProps: {shadow: {drawToShadowMap: true}}});
    expect(setProps).not.toHaveBeenCalled();
  });
});
