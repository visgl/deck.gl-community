// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, MapView, _GlobeView as GlobeView} from '@deck.gl/core';
import {parse} from '@loaders.gl/core';
import {MVTLoader} from '@loaders.gl/mvt';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {SharedMVTLayer, SharedTileset2D} from '../../src';
import {encodeBoxTile} from './mvt-test-tile';

const SIZE = 128;

/** A box west of and north of longitude/latitude 0, 0, so that a misplaced box is off its spot. */
const BOX: [number, number, number, number] = [-40, 10, -10, 35];

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

function isRed(r: number, g: number, b: number): boolean {
  return r > 200 && g < 60 && b < 60;
}

/** Canvas pixel bounds of the box in a viewport, from points sampled across it. */
function getProjectedBounds(viewport: any): [number, number, number, number] {
  const [west, south, east, north] = BOX;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const [x, y] = viewport.project([
        west + ((east - west) * i) / 10,
        south + ((north - south) * j) / 10
      ]);
      xs.push(x);
      ys.push(y);
    }
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * The box's center is red, and no more than `strayPixels` red pixels lie outside its projected
 * bounds. Returns the number of red pixels inside them.
 */
function expectBoxAt(image: ImageData, viewport: any, strayPixels = 0): number {
  const [minX, minY, maxX, maxY] = getProjectedBounds(viewport);
  const at = (x: number, y: number) => {
    const i = (Math.round(y) * SIZE + Math.round(x)) * 4;
    return image.data[i + 3] > 200 && isRed(image.data[i], image.data[i + 1], image.data[i + 2]);
  };
  const [centerX, centerY] = viewport.project([(BOX[0] + BOX[2]) / 2, (BOX[1] + BOX[3]) / 2]);
  expect(at(centerX, centerY), `red at the box center ${centerX}, ${centerY}`).toBe(true);

  const margin = 2;
  let inside = 0;
  const outside: string[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!at(x, y)) {
        continue;
      }
      if (x < minX - margin || x > maxX + margin || y < minY - margin || y > maxY + margin) {
        outside.push(`${x},${y}`);
      } else {
        inside++;
      }
    }
  }
  expect(
    outside.length,
    `red pixels outside the projected box: ${outside.slice(0, 5)}`
  ).toBeLessThanOrEqual(strayPixels);
  expect(inside).toBeGreaterThan(50);
  return inside;
}

/** Every longitude/latitude of a picked polygon lies on the box's edges. */
function expectGeographicBox(feature: any): void {
  const [west, south, east, north] = BOX;
  const ring: number[][] = feature.geometry.coordinates[0];
  expect(ring.length).toBeGreaterThan(3);
  for (const [longitude, latitude] of ring) {
    expect(longitude).toBeGreaterThan(west - 0.5);
    expect(longitude).toBeLessThan(east + 0.5);
    expect(latitude).toBeGreaterThan(south - 0.5);
    expect(latitude).toBeLessThan(north + 0.5);
  }
}

/**
 * Waits until the tile sublayers of both consumers are built for the current view. For a few
 * frames after a switch from a globe to a map, the consumers still draw the sublayers built for the
 * globe, whose longitude/latitude geometry also draws in place on a map; picking on those frames
 * converts the already geographic features a second time.
 */
async function waitForTileSubLayers(coordinateSystem: string): Promise<void> {
  for (let frame = 0; frame < 120; frame++) {
    const subLayers = (deck as any).layerManager
      .getLayers()
      .filter((layer: any) => layer.constructor.layerName === 'GeoJsonLayer');
    if (
      subLayers.length === 2 &&
      subLayers.every((layer: any) => layer.props.coordinateSystem === coordinateSystem)
    ) {
      return;
    }
    deck!.redraw('waiting for tile sublayers');
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  throw new Error(`Tile sublayers were not rebuilt in ${coordinateSystem} coordinates`);
}

describe('SharedMVTLayer consumers in the browser', () => {
  // Tiles decode once, to tile-local coordinates, into one tileset that two consumers share. A
  // view switch converts them for the new view: drawn in tile coordinates on a map, in
  // longitude/latitude on a globe. It neither fetches nor decodes them again.
  test('two consumers draw and pick one decoded tile in map, globe and map again', async () => {
    const tileBytes = encodeBoxTile(BOX);
    let requests = 0;
    let decodes = 0;
    const fetch = async (_url: string, {loadOptions}: any) => {
      requests++;
      const data = await parse(tileBytes.slice().buffer, MVTLoader, {
        ...loadOptions,
        worker: false
      });
      decodes++;
      return data;
    };
    const loader = new SharedMVTLayer({data: 'https://tiles.test/{z}/{x}/{y}.mvt', fetch});
    const tileset = new SharedTileset2D({...loader._getTilesetOptions(), maxZoom: 0});
    const getLayers = () => [
      new SharedMVTLayer({id: 'fill', data: tileset, getFillColor: [255, 0, 0], stroked: false}),
      new SharedMVTLayer({
        id: 'pick',
        data: tileset,
        pickable: true,
        getFillColor: [255, 0, 0],
        stroked: false
      })
    ];

    let onFrame: ((image: ImageData) => void) | null = null;
    const nextLoadedFrame = (viewName: string) =>
      new Promise<ImageData>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error(`No loaded frame with red in ${viewName}`)),
          10_000
        );
        onFrame = image => {
          let red = 0;
          for (let i = 0; i < image.data.length; i += 4) {
            if (isRed(image.data[i], image.data[i + 1], image.data[i + 2])) red++;
          }
          if (red > 0) {
            window.clearTimeout(timeout);
            onFrame = null;
            resolve(image);
          }
        };
      });

    try {
      parent = document.createElement('div');
      document.body.append(parent);
      let frame = nextLoadedFrame('MapView');
      deck = new Deck({
        parent,
        width: SIZE,
        height: SIZE,
        useDevicePixels: false,
        deviceProps: {adapters: [webgl2Adapter]},
        views: new MapView({id: 'view'}),
        initialViewState: {longitude: 0, latitude: 0, zoom: 0},
        layers: getLayers(),
        onAfterRender: () => {
          const layers = (deck as any)?.layerManager?.getLayers() || [];
          if (!onFrame || !layers.length || layers.some((layer: any) => !layer.isLoaded)) {
            return;
          }
          // Read the frame back in the render callback, before the drawing buffer is cleared.
          const copy = document.createElement('canvas');
          copy.width = SIZE;
          copy.height = SIZE;
          const context = copy.getContext('2d')!;
          context.drawImage(deck!.getCanvas()!, 0, 0);
          onFrame(context.getImageData(0, 0, SIZE, SIZE));
        },
        onError: error => {
          throw error;
        }
      });

      await frame;
      const [tile] = tileset.tiles;
      const decoded = tile.content;
      expect(decoded).toHaveLength(1);
      const local = structuredClone(decoded);

      let mapViewport: any = null;
      let mapInside = 0;
      for (const [index, view] of (['map', 'globe', 'map'] as const).entries()) {
        if (index > 0) {
          deck.setProps({
            views: view === 'globe' ? new GlobeView({id: 'view'}) : new MapView({id: 'view'}),
            layers: getLayers()
          });
        }
        await waitForTileSubLayers(
          view === 'globe' ? COORDINATE_SYSTEM.LNGLAT : COORDINATE_SYSTEM.CARTESIAN
        );
        frame = nextLoadedFrame(view);
        deck.redraw('capture');
        const image = await frame;
        const viewport = deck.getViewports()[0];
        expect(Boolean(viewport.resolution), `${view} viewport`).toBe(view === 'globe');
        if (index === 0) {
          mapViewport = viewport;
          mapInside = expectBoxAt(image, viewport);
        } else if (view === 'map') {
          // Back on the map, the tile sublayers are updated in place from their globe geometry,
          // which can leave a stray pixel; the box itself draws exactly as before the switch.
          expect(expectBoxAt(image, viewport, 2)).toBe(mapInside);
        } else {
          expectBoxAt(image, viewport);
          // The box's north-west corner, where map and globe projections differ most, falls
          // outside the box's globe bounds as drawn on the map: a box left in map positions fails.
          const [cornerX, cornerY] = mapViewport.project([BOX[0], BOX[3]]);
          const [minX, minY] = getProjectedBounds(viewport);
          expect(Math.min(minX - cornerX, minY - cornerY)).toBeGreaterThan(8);
        }

        const [x, y] = viewport.project([(BOX[0] + BOX[2]) / 2, (BOX[1] + BOX[3]) / 2]);
        const picked = deck.pickObject({x, y, radius: 2, layerIds: ['pick']});
        expect(picked?.object, `a picked feature in ${view}`).toBeTruthy();
        expectGeographicBox(picked!.object);
      }

      // No second fetch or decode: the same decoded tile-local content stays in the same cache.
      expect(requests).toBe(1);
      expect(decodes).toBe(1);
      expect(tileset.tiles).toHaveLength(1);
      expect(tileset.tiles[0]).toBe(tile);
      expect(tile.content).toBe(decoded);
      expect(decoded).toEqual(local);
    } finally {
      deck?.finalize();
      deck = null;
      tileset.finalize();
    }
  }, 30_000);
});
