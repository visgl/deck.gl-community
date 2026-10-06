// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck, MapView, COORDINATE_SYSTEM, CompositeLayer, type Layer} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {describe, expect, it} from 'vitest';
import {SplatLayer, type SplatSource} from '../../src';

function collectLeaves(layer: Layer): Layer[] {
  return layer instanceof CompositeLayer ? layer.getSubLayers().flatMap(collectLeaves) : [layer];
}

const SOURCE: SplatSource = {
  positions: new Float32Array([0, 0, 0]),
  scales: new Float32Array([0.9, 0.18, 0.12]),
  rotations: new Float32Array([1, 0, 0, 0]),
  colors: new Uint8Array([100, 200, 40, 255]),
  opacities: new Float32Array([0.9])
};

describe('Gaussian canopy rendering', () => {
  it('renders an anisotropic soft footprint, picks the owner, and moves it with uniform-only wind', async () => {
    const parent = document.createElement('div');
    parent.style.cssText = 'width:256px;height:256px';
    document.body.append(parent);
    const object = {position: [0, 0, 0] as [number, number, number], name: 'owning-tree'};
    const distant = {position: [800, 0, 0] as [number, number, number], name: 'second-owner'};
    const data = [object, distant];
    const errors: string[] = [];
    let frames = 0;
    let pixels = new Uint8Array();
    const makeLayer = (time: number, pixelError = 0.75) =>
      new SplatLayer({
        id: 'canopy',
        data,
        source: SOURCE,
        pixelError,
        coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
        coordinateOrigin: [0, 0, 0],
        getTranslation: [0, 0, 5],
        getDeformation: [10, 0.7, 1],
        deformationStrength: 0.1,
        deformationTime: time,
        pickable: true,
        material: {unlit: true}
      });
    const deck = new Deck({
      parent,
      width: 256,
      height: 256,
      useDevicePixels: false,
      _animate: true,
      deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
      views: new MapView({id: 'gaussian'}),
      initialViewState: {longitude: 0, latitude: 0, zoom: 21, pitch: 0},
      layers: [makeLayer(0)],
      onError: error => errors.push(error.message),
      onAfterRender({gl}) {
        pixels = new Uint8Array(256 * 256 * 4);
        gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        if (gl.getError() !== gl.NO_ERROR) errors.push('Gaussian pixel read failed');
        frames++;
      }
    });
    try {
      await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(8);
      expect(errors).toEqual([]);
      let count = 0,
        minimumX = 256,
        maximumX = 0,
        minimumY = 256,
        maximumY = 0;
      for (let i = 0; i < 256 * 256; i++)
        if (pixels[i * 4 + 3] > 30) {
          count++;
          minimumX = Math.min(minimumX, i % 256);
          maximumX = Math.max(maximumX, i % 256);
          minimumY = Math.min(minimumY, Math.floor(i / 256));
          maximumY = Math.max(maximumY, Math.floor(i / 256));
        }
      expect(count).toBeGreaterThan(200);
      expect((maximumX - minimumX) / (maximumY - minimumY)).toBeGreaterThan(3);
      const picked = deck.pickObject({
        x: Math.round((minimumX + maximumX) / 2),
        y: 256 - Math.round((minimumY + maximumY) / 2)
      });
      expect(picked?.object).toBe(object);
      const leaves = collectLeaves((deck.props.layers as Layer[])[0]);
      const visual = leaves.find(layer => layer.id.includes('refinement'))!;
      const caster = leaves.find(layer => layer.id.includes('shadow-casters'))!;
      const geometry = (visual.state.model as any)._gpuGeometry;
      expect((caster.state.model as any)._gpuGeometry.indices).toBe(geometry.indices);
      const positions = visual.getAttributeManager()!.getAttributes().instancePositions.getBuffer();
      const rows = (deck.props.layers as Layer[])[0].state.groups;
      const spatialIndex = (deck.props.layers as Layer[])[0].state.spatialIndex;
      const before = pixels.slice();
      const oldFrame = frames;
      deck.setProps({layers: [makeLayer(2)]});
      await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(oldFrame + 3);
      let changed = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (Math.abs(before[i + 3] - pixels[i + 3]) > 20) changed++;
      expect(changed).toBeGreaterThan(100);
      const updated = collectLeaves((deck.props.layers as Layer[])[0]).find(layer =>
        layer.id.includes('refinement')
      )!;
      expect((deck.props.layers as Layer[])[0].state.groups === rows).toBe(true);
      expect((deck.props.layers as Layer[])[0].state.spatialIndex === spatialIndex).toBe(true);
      expect((updated.state.model as any)._gpuGeometry.indices === geometry.indices).toBe(true);
      expect(updated.getAttributeManager()!.getAttributes().instancePositions.getBuffer()).toBe(
        positions
      );
      const beforeQuality = frames;
      deck.setProps({layers: [makeLayer(2, 1)]});
      await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(beforeQuality + 3);
      expect((deck.props.layers as Layer[])[0].state.spatialIndex === spatialIndex).toBe(true);
      const beforePan = frames;
      const owners = (deck.props.layers as Layer[])[0].state.owners;
      deck.setProps({viewState: {longitude: 800 / 111320, latitude: 0, zoom: 21, pitch: 0}});
      await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(beforePan + 3);
      const root = (deck.props.layers as Layer[])[0];
      expect(root.state.spatialIndex === spatialIndex).toBe(true);
      expect(root.state.owners === owners).toBe(true);
      expect(root.state.groups[0]).toHaveLength(1);
      expect(root.state.groups[0][0].object).toBe(distant);
      let left = 256,
        right = 0,
        bottom = 256,
        top = 0;
      for (let i = 0; i < 256 * 256; i++)
        if (pixels[i * 4 + 3] > 30) {
          left = Math.min(left, i % 256);
          right = Math.max(right, i % 256);
          bottom = Math.min(bottom, Math.floor(i / 256));
          top = Math.max(top, Math.floor(i / 256));
        }
      expect(
        deck.pickObject({
          x: Math.round((left + right) / 2),
          y: 256 - Math.round((bottom + top) / 2)
        })?.object
      ).toBe(distant);
      // A light still selects the first owner when the camera sees only the second.
      // Its texel error falls inside the refinement blend band.
      const beforeHierarchy = frames;
      deck.setProps({
        layers: [
          makeLayer(2).clone({
            hierarchy: [
              {source: SOURCE, error: 0},
              {source: {...SOURCE}, error: 0.1}
            ]
          })
        ]
      });
      await expect.poll(() => frames, {timeout: 15000}).toBeGreaterThan(beforeHierarchy + 3);
      const shadowRoot = (deck.props.layers as SplatLayer[])[0];
      const viewport = deck.getViewports()[0];
      const factor = (8.25 * 2) / (256 * viewport.distanceScales.unitsPerMeter[2]);
      shadowRoot.prepareShadow(
        [
          {
            matrix: [factor, 0, 0, 0, 0, factor, 0, 0, 0, 0, factor, 0, 0, 0, 0, 1],
            center: [0, 0, 0, 0],
            width: 256,
            height: 256
          }
        ],
        viewport
      );
      const shadowRows = shadowRoot.state.shadowGroups.flat();
      expect(shadowRows).toHaveLength(2);
      expect(shadowRows.every(row => row.object === object)).toBe(true);
      expect(shadowRows.reduce((sum, row) => sum + row.weight, 0)).toBeCloseTo(1, 6);
      expect(shadowRows.every(row => row.weight > 0 && row.weight < 1)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      deck.finalize();
      parent.remove();
    }
  }, 20000);
});
