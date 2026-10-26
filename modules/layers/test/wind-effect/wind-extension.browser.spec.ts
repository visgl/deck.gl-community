// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {COORDINATE_SYSTEM, Deck, MapView, type Layer} from '@deck.gl/core';
import {ColumnLayer, GridCellLayer, PointCloudLayer} from '@deck.gl/layers';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {CubeGeometry} from '@luma.gl/engine';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {WindEffect, WindExtension} from '../../src';

const SIZE = 256;
const HEIGHT = 10;
const PHASE = 0.7;
// sin(1.6 t + phase) = 1: every layer is at its peak bend along the wind axis.
const PEAK_TIME = (Math.PI / 2 - PHASE) / 1.6;
const METER_OFFSETS = {
  coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
  coordinateOrigin: [0, 0, 0] as [number, number, number]
};
const windProps = {extensions: [new WindExtension()], getWind: [HEIGHT, PHASE, 1], pickable: true};
const object = {position: [0, 0, 0]};
// GridCellLayer anchors a cell at its corner; centre it like the other layers.
const cell = {position: [-1.5, -1.5, 0]};

const LAYERS: Record<string, () => Layer> = {
  ColumnLayer: () =>
    new ColumnLayer({
      ...METER_OFFSETS,
      ...windProps,
      id: 'columns',
      data: [object],
      getPosition: d => d.position,
      getElevation: HEIGHT,
      radius: 1.5,
      extruded: true,
      getFillColor: [200, 80, 40]
    }),
  GridCellLayer: () =>
    new GridCellLayer({
      ...METER_OFFSETS,
      ...windProps,
      id: 'grid-cells',
      data: [cell],
      getPosition: d => d.position,
      getElevation: HEIGHT,
      cellSize: 3,
      getFillColor: [40, 80, 200]
    }),
  SimpleMeshLayer: () =>
    new SimpleMeshLayer({
      ...METER_OFFSETS,
      ...windProps,
      id: 'reeds',
      data: [object],
      getPosition: d => d.position,
      mesh: new CubeGeometry(),
      getScale: [1, 1, HEIGHT / 2],
      getTranslation: [0, 0, HEIGHT / 2],
      getColor: [60, 160, 60]
    }),
  PointCloudLayer: () =>
    new PointCloudLayer({
      ...METER_OFFSETS,
      ...windProps,
      windBase: 'ground',
      id: 'scan',
      data: Array.from({length: HEIGHT + 1}, (_, z) => ({position: [0, 0, z]})),
      getPosition: d => d.position,
      getNormal: [0, 0, 1],
      getColor: [120, 60, 160],
      pointSize: 6
    })
};

/** Alpha-weighted centroid in GL pixels, origin bottom-left (north is up). */
function getCentroid(pixels: Uint8Array): [number, number] {
  let x = 0,
    y = 0,
    total = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const alpha = pixels[i * 4 + 3];
    if (alpha < 30) continue;
    x += (i % SIZE) * alpha;
    y += Math.floor(i / SIZE) * alpha;
    total += alpha;
  }
  return [x / total, y / total];
}

it('bends instanced deck.gl layers with the WindEffect direction, and picks them there', async () => {
  const parent = document.createElement('div');
  parent.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
  document.body.append(parent);
  const errors: string[] = [];
  let frames = 0;
  let pixels = new Uint8Array();
  const wind = (direction: number, strength = 0.2) =>
    new WindEffect({strength, direction, time: PEAK_TIME});
  const deck = new Deck({
    parent,
    width: SIZE,
    height: SIZE,
    useDevicePixels: false,
    _animate: true,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: new MapView(),
    // High enough that perspective barely magnifies the 10 m objects' tops.
    initialViewState: {longitude: 0, latitude: 0, zoom: 18.5, pitch: 0},
    effects: [wind(90, 0)],
    layers: [],
    onError: error => errors.push(error.message),
    onAfterRender({gl}) {
      pixels = new Uint8Array(SIZE * SIZE * 4);
      gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      frames++;
    }
  });
  const settle = async () => {
    const before = frames;
    await expect.poll(() => frames, {timeout: 30000}).toBeGreaterThan(before + 4);
  };
  try {
    for (const [name, createLayer] of Object.entries(LAYERS)) {
      deck.setProps({effects: [wind(90, 0)], layers: [createLayer()]});
      await settle();
      const [stillX, stillY] = getCentroid(pixels);
      const shifts: Record<number, [number, number]> = {};
      for (const direction of [90, 270, 0]) {
        deck.setProps({effects: [wind(direction)]});
        await settle();
        const [x, y] = getCentroid(pixels);
        shifts[direction] = [x - stillX, y - stillY];
      }
      // A 2.2 m peak bend at the top, about 0.21 m per pixel.
      expect(shifts[90][0], `${name} bends east`).toBeGreaterThan(2);
      expect(Math.abs(shifts[90][1]), `${name} stays on the east axis`).toBeLessThan(1);
      expect(shifts[270][0], `${name} bends west`).toBeLessThan(-2);
      expect(shifts[0][1], `${name} bends north`).toBeGreaterThan(2);
      const [x, y] = getCentroid(pixels);
      const picked = deck.pickObject({x: Math.round(x), y: SIZE - Math.round(y)});
      expect(picked?.layer?.id, `${name} picks its bent pose`).toBe(
        (deck.props.layers as Layer[])[0].id
      );
    }
    expect(errors).toEqual([]);
  } finally {
    deck.finalize();
    parent.remove();
  }
}, 120000);
