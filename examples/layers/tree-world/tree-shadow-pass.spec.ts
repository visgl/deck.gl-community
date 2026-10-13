// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {WebMercatorViewport, COORDINATE_SYSTEM, type Viewport} from '@deck.gl/core';
import {expect, it, vi} from 'vitest';
import {TreeShadowPass} from './tree-shadow-pass';
import {Matrix4} from '@math.gl/core';
import {getBoundedShadowUniforms} from './shadow-frustum';

it('rasters one complete opaque map with the first view common-space reference', () => {
  const viewport = new WebMercatorViewport({
    id: 'camera',
    x: 100,
    y: 50,
    width: 800,
    height: 600,
    longitude: 12,
    latitude: 35,
    zoom: 16
  });
  const depth = {destroy: vi.fn()};
  const target = {
    width: 1,
    height: 1,
    depthStencilAttachment: {texture: depth},
    resize: vi.fn(function (size) {
      Object.assign(this, size);
    }),
    destroy: vi.fn()
  };
  const setParameters = vi.fn();
  const device = {
    type: 'webgl',
    canvasContext: {getDrawingBufferSize: () => [1200, 800], cssToDeviceRatio: () => 1},
    createTexture: vi.fn(() => depth),
    createFramebuffer: vi.fn(() => target),
    beginRenderPass: vi.fn(() => ({setParameters, end: vi.fn()})),
    submit: vi.fn()
  };
  const draw = vi.fn();
  const layer = {
    id: 'opaque',
    isDrawable: true,
    props: {visible: true, operation: 'shadow', coordinateSystem: COORDINATE_SYSTEM.LNGLAT},
    context: {device, viewport, defaultShaderModules: []},
    activateViewport: vi.fn(),
    _drawLayer: draw,
    raiseError: (error: Error) => {
      throw error;
    }
  };
  const shadowMatrices = [new Matrix4().lookAt({eye: [1, 1, 2]})];
  const pass = new TreeShadowPass(device as any);
  const onViewportActive = vi.fn();
  try {
    pass.render(
      {
        pass: 'screen',
        layers: [layer as any],
        viewports: [viewport, new WebMercatorViewport({id: 'other', width: 300, height: 300})],
        onViewportActive,
        shaderModuleProps: {shadow: {shadowMatrices, dummyShadowMap: depth}}
      },
      1024
    );
    expect(setParameters.mock.calls).toEqual([[{viewport: [0, 0, 1024, 768]}]]);
    expect(onViewportActive).toHaveBeenCalledOnce();
    const raster = onViewportActive.mock.calls[0][0] as Viewport;
    expect(raster.center).toEqual(viewport.center);
    expect(raster.projectPosition([12, 35, 10])).toEqual(viewport.projectPosition([12, 35, 10]));
    expect(raster.subViewports).toBeNull();
    expect(raster.equals(viewport)).toBe(false);
    expect([viewport.x, viewport.y, viewport.width, viewport.height]).toEqual([100, 50, 800, 600]);
    const props = draw.mock.calls[0][0].shaderModuleProps;
    expect(props.project.viewport).toBe(raster);
    const opaque = getBoundedShadowUniforms(props.shadow);
    const receiving = getBoundedShadowUniforms({
      project: {...props.project, viewport},
      shadowMatrices,
      dummyShadowMap: depth as any
    });
    expect(opaque.viewProjectionMatrix0).toEqual(receiving.viewProjectionMatrix0);
    expect(opaque.projectCenter0).toEqual(receiving.projectCenter0);
  } finally {
    pass.destroy();
  }
});
