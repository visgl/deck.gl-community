// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * On a globe below zoom 12, buildings are shaded with the light placed relative to the ground
 * under them, as on a map: the normals, in deck.gl's globe space, are taken in the local east,
 * north and up before MapLibre's shading applies. `reference-render/extrusion-lighting` checks the
 * map's shading against MapLibre GL JS; this checks that a building on the globe, at several
 * longitudes and latitudes, draws its roof and walls in the colors it draws in on the map.
 */

import {Deck, MapView, _GlobeView as GlobeView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {lngLatToWorld, worldToLngLat} from '@math.gl/web-mercator';
import {afterEach, describe, expect, test} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';

const SIZE = 256;
const ZOOM = 11;
const PITCH = 50;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

function cleanup() {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
}

afterEach(cleanup);

/**
 * A square building in the middle of the zoom 11 tile that holds `longitude` and `latitude`, so
 * that one tile holds it, and the view center west and south of it, so that the view shows its
 * roof, its south wall and its west wall. Returns the ring and the view center.
 */
function placeBuilding(
  longitude: number,
  latitude: number
): {ring: number[][]; center: [number, number]} {
  const scale = 2 ** ZOOM;
  const [worldX, worldY] = lngLatToWorld([longitude, latitude]);
  const tileX = Math.floor((worldX / 512) * scale);
  const tileY = Math.floor((worldY / 512) * scale);
  const [west, south] = worldToLngLat([
    ((tileX + 0.4) / scale) * 512,
    ((tileY + 0.4) / scale) * 512
  ]);
  const [east, north] = worldToLngLat([
    ((tileX + 0.6) / scale) * 512,
    ((tileY + 0.6) / scale) * 512
  ]);
  const ring = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ];
  const center: [number, number] = [west - (east - west) * 0.6, south - (north - south) * 1.2];
  return {ring, center};
}

/**
 * A basemap whose source holds `ring` as a building. The walls take one color each without the
 * vertical gradient.
 */
function basemap(ring: number[][], mode: 'map' | 'globe') {
  const fetch = async (url: string) => {
    const [z, x, y] = url
      .match(/(\d+)\/(\d+)\/(\d+)\.mvt/)!
      .slice(1)
      .map(Number);
    const scale = 2 ** z;
    const local = ring.map(position => {
      const [worldX, worldY] = lngLatToWorld(position as [number, number]);
      return [(worldX / 512) * scale - x, (1 - worldY / 512) * scale - y];
    });
    const inside = local.every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1);
    return inside
      ? [
          {
            type: 'Feature',
            properties: {layerName: 'building'},
            geometry: {type: 'Polygon', coordinates: [local]}
          }
        ]
      : [];
  };
  return new BasemapLayer({
    id: 'basemap',
    mode,
    fetch,
    style: {
      version: 8,
      sources: {
        tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt'], maxzoom: ZOOM}
      },
      layers: [
        {id: 'background', type: 'background', paint: {'background-color': '#ffffff'}},
        {
          id: 'building-3d',
          type: 'fill-extrusion',
          source: 'tiles',
          'source-layer': 'building',
          paint: {
            'fill-extrusion-color': '#c08060',
            'fill-extrusion-height': 1500,
            'fill-extrusion-vertical-gradient': false
          }
        }
      ]
    } as any
  });
}

/**
 * The colors of the building's faces: those that cover at least `share` of its pixels. Edges,
 * blended with the white background or the next face, each cover far less.
 */
function getFaceColors(image: ImageData, share = 0.05): number[][] {
  const counts = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const [r, g, b] = [image.data[i], image.data[i + 1], image.data[i + 2]];
    if (r + g + b < 750) {
      const key = (r << 16) | (g << 8) | b;
      counts.set(key, (counts.get(key) || 0) + 1);
      total++;
    }
  }
  return [...counts]
    .filter(([, count]) => count >= share * total)
    .map(([key]) => [key >> 16, (key >> 8) & 255, key & 255]);
}

let onFrame: ((image: ImageData) => void) | null = null;

/** Resolves with a frame drawn a few frames after every sublayer has loaded. */
function nextFrame(): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    let frames = 0;
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 20_000);
    onFrame = image => {
      if (++frames < 5) {
        window.requestAnimationFrame(() => deck?.redraw('settle'));
        return;
      }
      onFrame = null;
      window.clearTimeout(timeout);
      resolve(image);
    };
    window.requestAnimationFrame(() => deck?.redraw('frame'));
  });
}

function render(layer: unknown, view: unknown, longitude: number, latitude: number) {
  cleanup();
  parent = document.createElement('div');
  document.body.append(parent);
  const frame = nextFrame();
  deck = new Deck({
    parent,
    width: SIZE,
    height: SIZE,
    useDevicePixels: false,
    deviceProps: {adapters: [webgl2Adapter]},
    views: view as any,
    viewState: {longitude, latitude, zoom: ZOOM, pitch: PITCH, bearing: 0} as any,
    layers: [layer] as any,
    onAfterRender: () => {
      const loaded = (deck as any)?.layerManager?.getLayers() || [];
      if (!onFrame || loaded.length < 2 || loaded.some((layer: any) => !layer.isLoaded)) {
        return;
      }
      const copy = document.createElement('canvas');
      copy.width = SIZE;
      copy.height = SIZE;
      const context = copy.getContext('2d')!;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, SIZE, SIZE);
      context.drawImage(deck!.getCanvas()!, 0, 0);
      onFrame(context.getImageData(0, 0, SIZE, SIZE));
    },
    onError: error => {
      throw error;
    }
  });
  return frame;
}

/** Whether every color of `colors` is within `tolerance` per channel of one of `others`. */
function getUnmatched(colors: number[][], others: number[][], tolerance = 3): number[][] {
  return colors.filter(
    color =>
      !others.some(other =>
        other.every((value, channel) => Math.abs(value - color[channel]) <= tolerance)
      )
  );
}

describe('fill-extrusion lighting on a globe', () => {
  for (const [longitude, latitude] of [
    [0.01, 0.05],
    [120, 35],
    [-75, -30],
    [30, 60]
  ]) {
    test(`a building at ${longitude}, ${latitude} is shaded as on a map`, async () => {
      const {ring, center} = placeBuilding(longitude, latitude);
      const onMap = getFaceColors(
        await render(basemap(ring, 'map'), new MapView({id: 'map'}), ...center)
      );
      const onGlobe = getFaceColors(
        await render(basemap(ring, 'globe'), new GlobeView({id: 'globe'}), ...center)
      );
      const message = JSON.stringify({onMap, onGlobe});
      // The roof and walls, of which a view may show one wall too thin to count.
      expect(onMap.length, message).toBeGreaterThanOrEqual(2);
      expect(getUnmatched(onMap, onGlobe), message).toEqual([]);
      expect(getUnmatched(onGlobe, onMap), message).toEqual([]);
    }, 60_000);
  }
});
