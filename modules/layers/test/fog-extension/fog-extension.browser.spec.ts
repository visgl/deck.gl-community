// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, OrbitView} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {FogExtension, type FogExtensionProps} from '../../src';

it('adds more fog to a distant object and preserves picking', async () => {
  const width = 240;
  const height = 120;
  const parent = document.createElement('div');
  document.body.append(parent);
  const rows: [number, number, number][] = [
    [-2, -12, 0],
    [6, 8, 0]
  ];
  const extension = new FogExtension();
  const layer = (fogDensity: number) =>
    new ScatterplotLayer<(typeof rows)[number], FogExtensionProps>({
      id: 'observations',
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: rows,
      getPosition: row => row,
      getRadius: 8,
      radiusUnits: 'pixels',
      billboard: true,
      getFillColor: [30, 80, 20],
      pickable: true,
      extensions: [extension],
      fogColor: [200, 200, 200],
      fogDensity
    });
  const errors: string[] = [];
  const pixels = new Uint8Array(width * height * 4);
  let frame = 0;
  const deck = new Deck<OrbitView>({
    parent,
    width,
    height,
    useDevicePixels: false,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: new OrbitView({orbitAxis: 'Z'}),
    initialViewState: {target: [0, 0, 0], rotationX: 0, rotationOrbit: 0, zoom: 3},
    layers: [layer(0)],
    onError: error => errors.push(error.message),
    onAfterRender({gl}) {
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      frame++;
    }
  });
  try {
    await expect.poll(() => frame).toBeGreaterThan(0);
    const points = rows.map(row => deck.getViewports()[0].project(row).map(Math.round));
    const read = ([x, y]: number[]) => pixels[((height - 1 - y) * width + x) * 4];
    expect(points.map(read)).toEqual([30, 30]);
    const before = frame;
    deck.setProps({layers: [layer(0.1)]});
    await expect.poll(() => frame).toBeGreaterThan(before);
    const [near, far] = points.map(read);
    expect(near).toBeGreaterThan(40);
    expect(far).toBeGreaterThan(near + 30);
    expect(deck.pickObject({x: points[1][0], y: points[1][1], radius: 2})?.object).toEqual(rows[1]);
    expect(errors).toEqual([]);
  } finally {
    deck.finalize();
    parent.remove();
  }
}, 60_000);
