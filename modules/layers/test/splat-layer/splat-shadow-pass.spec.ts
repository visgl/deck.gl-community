// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {WebMercatorViewport, type Viewport} from '@deck.gl/core';
import {expect, it, vi} from 'vitest';
import {SplatShadowPass} from '../../src';

it('rasters one complete light map independently of camera size, inset and view count', () => {
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
  const setParameters = vi.fn();
  const device = {
    type: 'webgl',
    canvasContext: {getDrawingBufferSize: () => [1200, 800]},
    createFramebuffer: vi.fn(props => ({...props, destroy: vi.fn()})),
    beginRenderPass: vi.fn(() => ({setParameters, end: vi.fn()})),
    submit: vi.fn()
  };
  const pass = new SplatShadowPass(device as any);
  const onViewportActive = vi.fn();
  try {
    pass.renderTransmission(
      {
        layers: [],
        viewports: [viewport, new WebMercatorViewport({id: 'other', width: 300, height: 300})],
        onViewportActive
      },
      {
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        center: [0, 0, 0, 0],
        width: 1024,
        height: 1024
      }
    );
    expect(setParameters.mock.calls).toEqual([[{viewport: [0, 0, 1024, 1024]}]]);
    expect(onViewportActive).toHaveBeenCalledOnce();
    const raster = onViewportActive.mock.calls[0][0] as Viewport;
    expect(raster.center).toEqual(viewport.center);
    expect(raster.projectionMode).toBe(viewport.projectionMode);
    expect(raster.projectPosition([12, 35, 10])).toEqual(viewport.projectPosition([12, 35, 10]));
    expect(raster.subViewports).toBeNull();
    expect(raster.equals(viewport)).toBe(false);
    expect(viewport.equals(raster)).toBe(false);
    expect([viewport.x, viewport.y, viewport.width, viewport.height]).toEqual([100, 50, 800, 600]);
  } finally {
    pass.destroy();
  }
});
