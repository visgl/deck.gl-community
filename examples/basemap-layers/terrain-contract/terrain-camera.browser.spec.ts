// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, test} from 'vitest';
import {Deck, OrbitView, COORDINATE_SYSTEM} from '@deck.gl/core';
import {PolygonLayer} from '@deck.gl/layers';
import {Matrix4} from '@math.gl/core';
import {pickTerrainSurface} from '@deck.gl-community/geo-layers';
import {createFixtureTerrain} from './terrain-fixture';

test('actual rendered OrbitView and terrain queries agree in both faces before and after relief changes', async () => {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:400px';
  document.body.append(container);
  let rendered = 0;
  const deck = new Deck({
    parent: container,
    width: 600,
    height: 400,
    views: new OrbitView({id: 'terrain-camera', orbitAxis: 'Z'}),
    initialViewState: {target: [1000, 1000, 60], rotationX: 40, rotationOrbit: -25, zoom: -2},
    onAfterRender: () => {
      rendered++;
    }
  });
  try {
    for (const exaggeration of [4, 0, 10]) {
      const terrain = createFixtureTerrain(exaggeration),
        before = rendered;
      deck.setProps({
        layers: [
          new PolygonLayer({
            id: 'terrain-camera-mesh',
            data: terrain.polygons,
            coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
            getPolygon: item => item.polygon,
            getFillColor: [65, 155, 105],
            stroked: false,
            pickable: true
          })
        ]
      });
      await expect.poll(() => rendered, {timeout: 15000}).toBeGreaterThan(before);
      const viewport = deck.getViewports()[0];
      for (const [horizontal, vertical, elevation, triangleIndex] of [
        [500, 500, 17.5, 0],
        [1500, 1500, 12.5, 1]
      ]) {
        const displayed = [horizontal, vertical, elevation * exaggeration];
        const pixel = viewport.project(displayed);
        expect(deck.pickObject({x: pixel[0], y: pixel[1], radius: 1})?.layer?.id).toBe(
          'terrain-camera-mesh'
        );
        const hit = pickTerrainSurface(
          viewport,
          [pixel[0], pixel[1]],
          terrain.surface,
          new Matrix4()
        );
        expect(hit?.triangleIndex).toBe(triangleIndex);
        expect(hit?.coordinate[2]).toBeCloseTo(elevation, 5);
        displayed.forEach((value, axis) => expect(hit?.position[axis]).toBeCloseTo(value, 4));
      }
    }
  } finally {
    deck.finalize();
    container.remove();
  }
}, 60000);
