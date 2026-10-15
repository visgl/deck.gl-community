// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrbitView, COORDINATE_SYSTEM} from '@deck.gl/core';
import {PolygonLayer} from '@deck.gl/layers';
import {Matrix4} from '@math.gl/core';
import {pickTerrainSurface} from '@deck.gl-community/geo-layers';
import {createFixtureTerrain} from './terrain-fixture';

/** Mount a hermetic physical/display terrain contract demonstration with host-owned queries. */
export function mountTerrainContractExample(container: HTMLElement): () => void {
  const canvasHost = document.createElement('div');
  canvasHost.style.cssText =
    'position:relative;width:100%;height:100%;min-height:400px;background:#162132';
  const controls = document.createElement('div');
  controls.style.cssText =
    'position:absolute;z-index:1;top:12px;left:12px;padding:14px;background:white;color:#162132;max-width:300px;font:14px sans-serif';
  const label = document.createElement('label');
  label.textContent = 'Display exaggeration (physical heights unchanged) ';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '10';
  slider.step = '0.1';
  slider.value = '4';
  slider.setAttribute('aria-label', 'Terrain exaggeration');
  const status = document.createElement('p');
  status.textContent =
    'Drag to orbit. Hover to compare displayed and physical heights. Offline synthetic fixture, not a live basemap.';
  label.append(slider);
  controls.append(label, status);
  canvasHost.append(controls);
  container.append(canvasHost);
  let terrain = createFixtureTerrain(4);
  const createLayers = () => [
    new PolygonLayer({
      id: 'terrain-contract',
      data: terrain.polygons,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPolygon: item => item.polygon,
      getFillColor: [65, 155, 105],
      stroked: true,
      getLineColor: [220, 240, 230],
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      pickable: true
    })
  ];
  const deck = new Deck({
    parent: canvasHost,
    views: new OrbitView({id: 'terrain', orbitAxis: 'Z'}),
    controller: true,
    initialViewState: {target: [1000, 1000, 60], rotationX: 40, rotationOrbit: -25, zoom: -2},
    layers: createLayers(),
    onHover(info) {
      if (!info.viewport) return;
      const hit = pickTerrainSurface(
        info.viewport,
        [info.x, info.y],
        terrain.surface,
        new Matrix4()
      );
      status.textContent = hit
        ? `Physical elevation: ${hit.coordinate[2].toFixed(2)} m. Displayed Z: ${hit.position[2].toFixed(2)} m. Triangle: ${hit.triangleIndex}.`
        : 'No loaded terrain hit. This does not certify world coverage.';
    }
  });
  const update = () => {
    terrain = createFixtureTerrain(Number(slider.value));
    deck.setProps({layers: createLayers()});
  };
  slider.addEventListener('input', update);
  return () => {
    slider.removeEventListener('input', update);
    deck.finalize();
    canvasHost.remove();
  };
}
