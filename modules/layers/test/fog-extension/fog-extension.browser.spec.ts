// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, MapView, OrbitView, type DeckProps} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {FogExtension, type FogExtensionProps} from '../../src';

type Point = [number, number, number];

function mount<ViewsT extends OrbitView | MapView>(
  rows: Point[],
  view: ViewsT,
  initialViewState: DeckProps<ViewsT>['initialViewState'],
  coordinateSystem: typeof COORDINATE_SYSTEM.CARTESIAN | typeof COORDINATE_SYSTEM.LNGLAT
) {
  const width = 240;
  const height = 120;
  const parent = document.createElement('div');
  document.body.append(parent);
  const extension = new FogExtension();
  const layer = (fogDensity: number) =>
    new ScatterplotLayer<Point, FogExtensionProps>({
      id: 'observations',
      coordinateSystem,
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
  const deck = new Deck<ViewsT>({
    parent,
    width,
    height,
    useDevicePixels: false,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: view,
    initialViewState,
    layers: [layer(0)],
    onError: error => errors.push(error.message),
    onAfterRender({gl}) {
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      frame++;
    }
  });
  const points = () => rows.map(row => deck.getViewports()[0].project(row).map(Math.round));
  return {
    deck,
    errors,
    points,
    colors: () => points().map(([x, y]) => pixels[((height - 1 - y) * width + x) * 4]),
    async render(fogDensity: number) {
      const before = frame;
      deck.setProps({layers: [layer(fogDensity)]});
      await expect.poll(() => frame).toBeGreaterThan(before);
    },
    finalize() {
      deck.finalize();
      parent.remove();
    }
  };
}

it('adds more fog to a distant object and preserves picking', async () => {
  const rows: Point[] = [
    [-2, -12, 0],
    [6, 8, 0]
  ];
  const scene = mount(
    rows,
    new OrbitView({orbitAxis: 'Z'}),
    {target: [0, 0, 0], rotationX: 0, rotationOrbit: 0, zoom: 3},
    COORDINATE_SYSTEM.CARTESIAN
  );
  try {
    await scene.render(0);
    expect(scene.colors()).toEqual([30, 30]);
    await scene.render(0.1);
    const [near, far] = scene.colors();
    expect(near).toBeGreaterThan(40);
    expect(far).toBeGreaterThan(near + 30);
    const [x, y] = scene.points()[1];
    expect(scene.deck.pickObject({x, y, radius: 2})?.object).toEqual(rows[1]);
    expect(scene.errors).toEqual([]);
  } finally {
    scene.finalize();
  }
}, 60_000);

it.each([
  [0, 14],
  [60, 15]
])(
  'matches fog extinction per meter at latitude %s and zoom %s',
  async (latitude, zoom) => {
    const position: Point = [-122, latitude, 0];
    const density = 0.001;
    const scene = mount(
      [position],
      new MapView(),
      {longitude: position[0], latitude, zoom, pitch: 0},
      COORDINATE_SYSTEM.LNGLAT
    );
    try {
      await scene.render(density);
      const viewport = scene.deck.getViewports()[0];
      const ground = viewport.projectPosition(position);
      const distance =
        Math.abs(viewport.cameraPosition[2] - ground[2]) *
        viewport.getDistanceScales().metersPerUnit[2];
      const expected = 200 + (30 - 200) * Math.exp(-distance * density);
      expect(distance).toBeGreaterThan(100);
      expect(Math.abs(scene.colors()[0] - expected)).toBeLessThan(2);
      expect(scene.errors).toEqual([]);
    } finally {
      scene.finalize();
    }
  },
  60_000
);
