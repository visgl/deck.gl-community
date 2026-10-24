// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck, _GlobeView as GlobeView, type Layer} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {describe, expect, it} from 'vitest';
import {SplatLayer, TreeLayer, type SplatSource} from '../../src';

const EARTH_RADIUS = 6370972;
const SCALE = 300000;
// A green Gaussian stretched east at the owner, and a larger red one 2R straight down from it: on
// the far side of the globe, behind the first along the camera's line of sight.
const SOURCE: SplatSource = {
  positions: new Float32Array([0, 0, 0, 0, 0, (-2 * EARTH_RADIUS) / SCALE]),
  scales: new Float32Array([0.9, 0.18, 0.12, 1, 1, 1]),
  rotations: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]),
  colors: new Uint8Array([60, 230, 60, 255, 255, 30, 30, 255]),
  opacities: new Float32Array([0.95, 0.95])
};

async function renderGlobe(layers: Layer[]) {
  const parent = document.createElement('div');
  parent.style.cssText = 'width:256px;height:256px';
  document.body.append(parent);
  const errors: string[] = [];
  let frames = 0;
  let pixels = new Uint8Array();
  const deck = new Deck({
    parent,
    width: 256,
    height: 256,
    useDevicePixels: false,
    _animate: true,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: new GlobeView({id: 'globe'}),
    viewState: {longitude: 0, latitude: 0, zoom: 1.5},
    layers,
    onError: error => errors.push(error.message),
    onAfterRender({gl}) {
      pixels = new Uint8Array(256 * 256 * 4);
      gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      frames++;
    }
  });
  await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(6);
  return {deck, errors, pixels: () => pixels, parent};
}

describe('Gaussian canopies on GlobeView', () => {
  it('orients Gaussians east-north-up, hides the far side of the globe, and picks the owner', async () => {
    const object = {position: [0, 0, 0] as [number, number, number], name: 'front'};
    const {deck, errors, pixels, parent} = await renderGlobe([
      new SplatLayer({
        id: 'globe-canopy',
        data: [object],
        source: SOURCE,
        getScale: [SCALE, SCALE, SCALE],
        getTranslation: [400000, 0, 0],
        pickable: true,
        material: {unlit: true}
      })
    ]);
    try {
      expect(errors).toEqual([]);
      const image = pixels();
      let green = 0,
        red = 0,
        minimumX = 256,
        maximumX = 0,
        minimumY = 256,
        maximumY = 0;
      for (let i = 0; i < 256 * 256; i++) {
        const [r, g] = [image[i * 4], image[i * 4 + 1]];
        if (g > 60 && g > r * 1.5) {
          green++;
          minimumX = Math.min(minimumX, i % 256);
          maximumX = Math.max(maximumX, i % 256);
          minimumY = Math.min(minimumY, Math.floor(i / 256));
          maximumY = Math.max(maximumY, Math.floor(i / 256));
        }
        if (r > 60 && r > g * 1.5) red++;
      }
      expect(green).toBeGreaterThan(100);
      // Local east is screen right over the equator at bearing 0, for both the stretch and the
      // 400 km translation. deck.gl's own globe frame would move it 400 km west.
      const [x, y] = deck
        .getViewports()[0]
        .project([(400000 / EARTH_RADIUS) * (180 / Math.PI), 0, 0]);
      expect(x).toBeGreaterThan(140);
      expect((maximumX - minimumX) / (maximumY - minimumY)).toBeGreaterThan(3);
      expect(Math.abs((minimumX + maximumX) / 2 - x)).toBeLessThan(3);
      expect(Math.abs((minimumY + maximumY) / 2 - (256 - y))).toBeLessThan(3);
      // The owner's bounds reach through the globe, so only the per-Gaussian horizon test hides
      // the antipodal Gaussian; without it, the red footprint would surround the green one.
      expect(red).toBe(0);
      expect(deck.pickObject({x: Math.round(x), y: Math.round(y)})?.object).toBe(object);
    } finally {
      deck.finalize();
      parent.remove();
    }
  });

  it('draws and picks trees on the near side only', async () => {
    const near = {name: 'near', position: [0, 0, 0]};
    const far = {name: 'far', position: [180, 0, 0]};
    const {deck, errors, pixels, parent} = await renderGlobe([
      new TreeLayer({
        id: 'globe-trees',
        data: [near, far],
        getPosition: (row: typeof near) => row.position,
        getTreeType: () => 'oak',
        getHeight: () => 900000,
        getCanopyRadius: () => 300000,
        getTrunkRadius: () => 30000,
        pickable: true
      })
    ]);
    try {
      expect(errors).toEqual([]);
      const image = pixels();
      let drawn = 0;
      for (let i = 0; i < 256 * 256; i++) if (image[i * 4 + 3] > 30) drawn++;
      expect(drawn).toBeGreaterThan(50);
      expect(deck.pickObject({x: 128, y: 128, radius: 4})?.object).toBe(near);
      const canopies = deck.layerManager!.getLayers().filter(layer => layer instanceof SplatLayer);
      const selected = canopies.flatMap(layer =>
        (layer as SplatLayer<{object: unknown}>).state.candidates.map(
          candidate => candidate.owner.row.object.object
        )
      );
      expect(selected).toContain(near);
      expect(selected).not.toContain(far);
    } finally {
      deck.finalize();
      parent.remove();
    }
  });
});
