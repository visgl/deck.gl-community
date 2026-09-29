// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {getShaderAssembler, project32} from '@deck.gl/core';
import {describe, expect, it, vi} from 'vitest';

import {interpolateZoom, zoomBand, ZoomOpacityExtension} from '../../src';
import {getViewportZoom} from '../../src/zoom-opacity-extension/zoom-opacity';
import {zoomOpacityShaderModule} from '../../src/zoom-opacity-extension/zoom-opacity-shader-module';

describe('interpolateZoom', () => {
  const stops = [
    [4, 0],
    [6, 1],
    [10, 0.5]
  ] as const;

  it('returns 1 for missing stops or zoom', () => {
    expect(interpolateZoom(5, null)).toBe(1);
    expect(interpolateZoom(5, [])).toBe(1);
    expect(interpolateZoom(Number.NaN, stops)).toBe(1);
  });

  it('clamps at both ends', () => {
    expect(interpolateZoom(0, stops)).toBe(0);
    expect(interpolateZoom(4, stops)).toBe(0);
    expect(interpolateZoom(10, stops)).toBe(0.5);
    expect(interpolateZoom(20, stops)).toBe(0.5);
  });

  it('interpolates linearly between stops', () => {
    expect(interpolateZoom(5, stops)).toBeCloseTo(0.5);
    expect(interpolateZoom(6, stops)).toBe(1);
    expect(interpolateZoom(8, stops)).toBeCloseTo(0.75);
  });

  it('treats equal-zoom stops as a step where the later stop wins', () => {
    const cutoffs = [
      [5, 0],
      [5, 1],
      [8, 1],
      [8, 0]
    ] as const;
    expect(interpolateZoom(4.999, cutoffs)).toBe(0);
    expect(interpolateZoom(5, cutoffs)).toBe(1);
    expect(interpolateZoom(7.999, cutoffs)).toBe(1);
    expect(interpolateZoom(8, cutoffs)).toBe(0);
  });

  it('clamps stop values to [0, 1]', () => {
    expect(
      interpolateZoom(0, [
        [0, 2],
        [1, -1]
      ])
    ).toBe(1);
    expect(
      interpolateZoom(1, [
        [0, 2],
        [1, -1]
      ])
    ).toBe(0);
  });
});

describe('zoomBand', () => {
  it('centers fade ramps on the band edges', () => {
    expect(zoomBand({minZoom: 8, maxZoom: 11, fadeWidth: 1})).toEqual([
      [7.5, 0],
      [8.5, 1],
      [10.5, 1],
      [11.5, 0]
    ]);
  });

  it('supports open-ended bands and a default fade width', () => {
    expect(zoomBand({minZoom: 12})).toEqual([
      [11.5, 0],
      [12.5, 1]
    ]);
    expect(zoomBand({maxZoom: 6})).toEqual([
      [5.5, 1],
      [6.5, 0]
    ]);
    expect(zoomBand({})).toEqual([]);
  });

  it('produces MapLibre-style hard cutoffs with a zero fade width', () => {
    const stops = zoomBand({minZoom: 5, maxZoom: 8, fadeWidth: 0});
    expect(interpolateZoom(4.9, stops)).toBe(0);
    expect(interpolateZoom(5, stops)).toBe(1);
    expect(interpolateZoom(8, stops)).toBe(0);
  });

  it('keeps stops sorted when the band is narrower than the fade', () => {
    const stops = zoomBand({minZoom: 5, maxZoom: 5.5, fadeWidth: 2});
    const zooms = stops.map(([zoom]) => zoom);
    expect(zooms).toEqual([...zooms].sort((a, b) => a - b));
    expect(interpolateZoom(5.25, stops)).toBe(1);
  });

  it('crossfades adjacent bands', () => {
    const lower = zoomBand({maxZoom: 10, fadeWidth: 2});
    const upper = zoomBand({minZoom: 10, fadeWidth: 2});
    for (const zoom of [8, 9, 9.5, 10, 10.7, 12]) {
      expect(interpolateZoom(zoom, lower) + interpolateZoom(zoom, upper)).toBeCloseTo(1);
    }
    expect(interpolateZoom(10, lower)).toBeCloseTo(0.5);
  });

  it('rejects inverted bands', () => {
    expect(() => zoomBand({minZoom: 10, maxZoom: 5})).toThrow();
  });
});

describe('getViewportZoom', () => {
  it('handles scalar, per-axis and missing zoom', () => {
    expect(getViewportZoom({zoom: 3})).toBe(3);
    expect(getViewportZoom({zoom: [4, 2]})).toBe(2);
    expect(getViewportZoom({})).toBeNaN();
    expect(getViewportZoom(null)).toBeNaN();
  });
});

type LayerHarness = {
  isComposite: boolean;
  context: {device: {type: string}; viewport: {zoom: number}};
  props: Record<string, any>;
  setShaderModuleProps: ReturnType<typeof vi.fn>;
};

function createLayerHarness({
  deviceType = 'webgl',
  isComposite = false,
  zoom = 9,
  props = {}
}: {
  deviceType?: string;
  isComposite?: boolean;
  zoom?: number;
  props?: Record<string, any>;
} = {}): LayerHarness {
  return {
    isComposite,
    context: {device: {type: deviceType}, viewport: {zoom}},
    props: {opacity: 0.8, updateTriggers: {}, ...props},
    setShaderModuleProps: vi.fn()
  };
}

describe('ZoomOpacityExtension', () => {
  const extension = new ZoomOpacityExtension();
  const stops = [
    [8, 0],
    [10, 1]
  ];

  it('adds the GLSL module to primitive WebGL layers only', () => {
    const webgl = createLayerHarness();
    expect(extension.getShaders.call(webgl as any, extension)).toEqual({
      modules: [zoomOpacityShaderModule]
    });
    expect(
      extension.getShaders.call(createLayerHarness({deviceType: 'webgpu'}) as any, extension)
    ).toBeNull();
    // Composite layers (e.g. GPU aggregators) must not be affected
    expect(
      extension.getShaders.call(createLayerHarness({isComposite: true}) as any, extension)
    ).toBeNull();
  });

  it('scales layer opacity by the zoom-derived value in draw', () => {
    const layer = createLayerHarness({zoom: 9, props: {zoomOpacity: stops}});
    extension.draw.call(layer as any, {context: layer.context}, extension);
    expect(layer.setShaderModuleProps).toHaveBeenCalledWith({
      layer: {opacity: 0.4},
      zoomOpacity: {opacity: 0.5}
    });
  });

  it('uses the viewport passed to draw', () => {
    const layer = createLayerHarness({zoom: 20, props: {zoomOpacity: stops}});
    extension.draw.call(layer as any, {context: {viewport: {zoom: 8}}}, extension);
    expect(layer.setShaderModuleProps).toHaveBeenCalledWith({
      layer: {opacity: 0},
      zoomOpacity: {opacity: 0}
    });
  });

  it('is a no-op multiplier without stops', () => {
    const layer = createLayerHarness({props: {zoomOpacity: null}});
    extension.draw.call(layer as any, {context: layer.context}, extension);
    expect(layer.setShaderModuleProps).toHaveBeenCalledWith({
      layer: {opacity: 0.8},
      zoomOpacity: {opacity: 1}
    });
  });

  it('fades and skips drawing through the layer draw on WebGPU', () => {
    const protoDraw = vi.fn();
    const layer = Object.assign(Object.create({draw: protoDraw}), {
      ...createLayerHarness({deviceType: 'webgpu', zoom: 9, props: {zoomOpacity: stops}})
    });
    extension.draw.call(layer, {context: layer.context}, extension);
    expect(layer.setShaderModuleProps).not.toHaveBeenCalled();

    layer.draw({});
    expect(layer.setShaderModuleProps).toHaveBeenCalledWith({layer: {opacity: 0.4}});
    expect(protoDraw).toHaveBeenCalledTimes(1);

    layer.context.viewport.zoom = 7;
    extension.draw.call(layer, {context: layer.context}, extension);
    layer.draw({});
    expect(protoDraw).toHaveBeenCalledTimes(1);
  });

  it('fades sublayers of drawable composites that drop the extension', () => {
    const cellDraw = vi.fn();
    class CellLayer {
      isComposite = false;
      props = {opacity: 0.5, extensions: []};
      setShaderModuleProps = vi.fn();
      draw(opts) {
        cellDraw(opts);
      }
    }
    const cells = new CellLayer();
    const withExtension = {...new CellLayer(), props: {opacity: 1, extensions: [extension]}};
    const parent = {
      ...createLayerHarness({isComposite: true, zoom: 9, props: {zoomOpacity: stops}}),
      getSubLayers: () => [cells, withExtension]
    };

    extension.draw.call(parent as any, {context: parent.context}, extension);
    expect(parent.setShaderModuleProps).not.toHaveBeenCalled();
    // Sublayers carrying the extension handle it themselves
    expect(Object.hasOwn(withExtension, 'draw')).toBe(false);

    const opts = {renderPass: null};
    (cells as any).draw(opts);
    expect(cells.setShaderModuleProps).toHaveBeenCalledWith({layer: {opacity: 0.25}});
    expect(cellDraw).toHaveBeenCalledWith(opts);

    // Fully faded: the sublayer is not drawn at all, so it cannot be picked
    parent.context.viewport.zoom = 7;
    extension.draw.call(parent as any, {context: parent.context}, extension);
    cellDraw.mockClear();
    (cells as any).draw(opts);
    expect(cellDraw).not.toHaveBeenCalled();
  });

  it('passes stops through to sublayers', () => {
    const composite = createLayerHarness({isComposite: true, props: {zoomOpacity: stops}});
    const passThrough = extension.getSubLayerProps.call(composite as any, extension);
    expect(passThrough.zoomOpacity).toBe(stops);
  });
});

describe('zoomOpacity shader module', () => {
  it('assembles into a GLSL layer shader', () => {
    const vs = /* glsl */ `\
#version 300 es
in vec3 positions;
void main(void) {
  gl_Position = vec4(positions, 1.0);
}
`;
    const fs = /* glsl */ `\
#version 300 es
precision highp float;
out vec4 fragColor;
void main(void) {
  fragColor = vec4(1.0);
}
`;
    const {vs: assembledVs} = getShaderAssembler('glsl').assembleGLSLShaderPair({
      vs,
      fs,
      modules: [project32, zoomOpacityShaderModule],
      platformInfo: {
        type: 'webgl',
        shaderLanguage: 'glsl',
        shaderLanguageVersion: 300,
        gpu: 'test',
        features: new Set()
      }
    });
    expect(assembledVs).toContain('uniform zoomOpacityUniforms');
    expect(assembledVs).toMatch(
      /if \(zoomOpacity\.opacity <= 0\.0\) \{\s*gl_Position = vec4\(0\.0\);/
    );
  });

  it('defaults to fully opaque', () => {
    expect(zoomOpacityShaderModule.defaultUniforms.opacity).toBe(1);
    expect(zoomOpacityShaderModule.getUniforms({opacity: 0.25})).toEqual({opacity: 0.25});
    expect(zoomOpacityShaderModule.getUniforms()).toEqual({});
  });
});
