// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, _GlobeView as GlobeView} from '@deck.gl/core';
import {parse} from '@loaders.gl/core';
import {MVTLoader} from '@loaders.gl/mvt';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';
import {MVTLabelLayer} from '../src/mvt-label-layer';
import {isGlobeViewport} from '@deck.gl-community/geo-layers';
import {encodeBoxTile} from '../../geo-layers/test/shared-mvt-layer/mvt-test-tile';
import {loadSpriteAtlases} from '../src/sprite';
import type {SpriteAtlas} from '../src/sprite';

const SIZE = 128;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/** A sprite with one image, `square`: a solid red 16x16 square. */
async function loadSquareSprite(): Promise<SpriteAtlas[]> {
  const canvas = new OffscreenCanvas(16, 16);
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'rgb(255, 0, 0)';
  context.fillRect(0, 0, 16, 16);
  const png = await canvas.convertToBlob({type: 'image/png'});
  const json = {square: {x: 0, y: 0, width: 16, height: 16, pixelRatio: 1}};
  const fetchFn = (async (url: string) =>
    url.endsWith('.json')
      ? new Response(JSON.stringify(json), {status: 200})
      : new Response(png, {status: 200})) as typeof fetch;
  return loadSpriteAtlases('https://sprites.test/sprite', {fetch: fetchFn, pixelRatio: 1});
}

/** A label layer with a point label at each of `points`, drawn in `textColor`. */
function createGlobeLabelLayer(
  id: string,
  layout: Record<string, unknown>,
  {
    points = [[0, 0]],
    spriteAtlases = null,
    ...props
  }: {points?: number[][]; spriteAtlases?: SpriteAtlas[] | null} & Record<string, unknown> = {}
): MVTLabelLayer {
  return new MVTLabelLayer({
    id,
    config: {labels: true},
    mode: 'globe',
    zoom: 1,
    styleLayer: {layout, paint: {}},
    textColor: [0, 0, 0, 255],
    spriteAtlases,
    ...props,
    data: points.map(coordinates => ({
      type: 'Feature',
      geometry: {type: 'Point', coordinates},
      properties: {}
    }))
  } as any);
}

/**
 * Renders `layers` in a `GlobeView` centered at longitude/latitude 0, 0 and returns the frame. A
 * label at 0, 0 draws at the canvas center; one at 180, 0 is behind the globe, at the same point
 * of the canvas.
 */
function renderGlobe(
  layers: MVTLabelLayer[],
  viewState: Record<string, number> = {longitude: 0, latitude: 0, zoom: 0},
  view: GlobeView = new GlobeView({id: 'globe-label-test'})
): Promise<ImageData> {
  parent = document.createElement('div');
  document.body.append(parent);
  return new Promise<ImageData>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 10_000);
    deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: view,
      initialViewState: viewState,
      layers,
      onAfterRender: () => {
        const allLayers = (deck as any)?.layerManager?.getLayers() || [];
        if (!allLayers.length || allLayers.some((layer: any) => !layer.isLoaded)) {
          return;
        }
        // Read the frame back in the render callback, before the drawing buffer is cleared.
        const copy = document.createElement('canvas');
        copy.width = SIZE;
        copy.height = SIZE;
        const context = copy.getContext('2d')!;
        context.drawImage(deck!.getCanvas()!, 0, 0);
        window.clearTimeout(timeout);
        resolve(context.getImageData(0, 0, SIZE, SIZE));
      },
      onError: error => {
        window.clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

/** Renders one point label at longitude/latitude 0, 0, at the canvas center. */
function renderGlobeLabel(
  layout: Record<string, unknown>,
  spriteAtlases: SpriteAtlas[] | null = null
): Promise<ImageData> {
  return renderGlobe([createGlobeLabelLayer('labels', layout, {spriteAtlases})]);
}

/** Number of opaque pixels for which `match(r, g, b)` holds. */
function countPixels(image: ImageData, match: (r: number, g: number, b: number) => boolean) {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] > 200 && match(image.data[i], image.data[i + 1], image.data[i + 2])) {
      count++;
    }
  }
  return count;
}

describe('labels on a globe in the browser', () => {
  test('a point label draws in GlobeView', async () => {
    const image = await renderGlobeLabel({'text-field': 'MMMM', 'text-size': 16});
    expect(countPixels(image, (r, g, b) => r < 80 && g < 80 && b < 80)).toBeGreaterThan(20);
  });

  test('a sprite icon draws in GlobeView', async () => {
    const image = await renderGlobeLabel({'icon-image': 'square'}, await loadSquareSprite());
    expect(countPixels(image, (r, g, b) => r > 200 && g < 60 && b < 60)).toBeGreaterThan(100);
  });
});

const isDark = (r: number, g: number, b: number) => r < 80 && g < 80 && b < 80;
const isRed = (r: number, g: number, b: number) => r > 200 && g < 60 && b < 60;
const isBlue = (r: number, g: number, b: number) => r < 60 && g < 60 && b > 200;

describe('labels beyond the horizon of a globe', () => {
  // Labels draw without a depth test, so the globe does not hide them; the shader hides those whose
  // anchor is on the far side.
  test('a label on the far side of the globe does not draw', async () => {
    const image = await renderGlobe([
      createGlobeLabelLayer('far', {'text-field': 'MMMM', 'text-size': 16}, {points: [[180, 0]]})
    ]);
    expect(countPixels(image, isDark)).toBe(0);
  });

  test('a sprite icon on the far side of the globe does not draw', async () => {
    const image = await renderGlobe([
      createGlobeLabelLayer(
        'far',
        {'icon-image': 'square'},
        {points: [[180, 0]], spriteAtlases: await loadSquareSprite()}
      )
    ]);
    expect(countPixels(image, isRed)).toBe(0);
  });

  test('a label just inside the horizon draws, one just beyond it does not', async () => {
    // At zoom -1 the camera is 5.71 globe radii from the globe's center, so the horizon is
    // acos(1 / 5.71) = 79.9 degrees from the view's center. Labels at longitudes 70 and 90 both
    // land about 33 pixels right of the canvas center, on the near and the far side.
    // The same label at the view's center sets the expected pixel count, which depends on the
    // platform's font rendering.
    const viewState = {longitude: 0, latitude: 0, zoom: -1};
    const layout = {'text-field': 'MM', 'text-size': 16};
    const center = await renderGlobe(
      [createGlobeLabelLayer('edge', layout, {points: [[0, 0]]})],
      viewState
    );
    const centerPixels = countPixels(center, isDark);
    expect(centerPixels).toBeGreaterThan(10);
    deck?.finalize();
    parent?.remove();
    const inside = await renderGlobe(
      [createGlobeLabelLayer('edge', layout, {points: [[70, 0]]})],
      viewState
    );
    expect(countPixels(inside, isDark)).toBeGreaterThan(centerPixels / 2);
    deck?.finalize();
    parent?.remove();
    const beyond = await renderGlobe(
      [createGlobeLabelLayer('edge', layout, {points: [[90, 0]]})],
      viewState
    );
    expect(countPixels(beyond, isDark)).toBe(0);
  });

  test('with an orthographic camera the horizon is 90 degrees from the view center', async () => {
    // A perspective camera at zoom -1 would hide a label at longitude 85 (see above).
    const viewState = {longitude: 0, latitude: 0, zoom: -1};
    const layout = {'text-field': 'MM', 'text-size': 16};
    const view = new GlobeView({id: 'globe-ortho', orthographic: true} as any);
    const inside = await renderGlobe(
      [createGlobeLabelLayer('edge', layout, {points: [[85, 0]]})],
      viewState,
      view
    );
    expect(countPixels(inside, isDark)).toBeGreaterThan(10);
    deck?.finalize();
    parent?.remove();
    const beyond = await renderGlobe(
      [createGlobeLabelLayer('edge', layout, {points: [[95, 0]]})],
      viewState,
      view
    );
    expect(countPixels(beyond, isDark)).toBe(0);
  });

  test('a far-side label does not hide a near-side label in the collision pass', async () => {
    // Both labels land on the canvas center. The far one has the higher collision priority, so it
    // would win the collision map if it were drawn there. The collision filter tells labels apart
    // by row index only, so the far label is the second row of its layer, after a far-side label
    // well away from the center.
    const image = await renderGlobe([
      createGlobeLabelLayer(
        'near',
        {'text-field': 'MMMM', 'text-size': 16},
        {textColor: [255, 0, 0, 255], collisionPriorityRange: [-1000, -500]}
      ),
      createGlobeLabelLayer(
        'far',
        {'text-field': 'MMMM', 'text-size': 16},
        {
          points: [
            [180, 60],
            [180, 0]
          ],
          textColor: [0, 0, 255, 255],
          collisionPriorityRange: [500, 1000]
        }
      )
    ]);
    expect(countPixels(image, isBlue)).toBe(0);
    expect(countPixels(image, isRed)).toBeGreaterThan(20);
  });
});

/** A box west of and north of longitude/latitude 0, 0, so that a misplaced box is off its spot. */
const BOX: [number, number, number, number] = [-40, 10, -10, 35];

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
 * Checks that the red box draws where the viewport projects it: its center is red, and no red
 * pixel lies outside its projected bounds.
 */
function expectBoxAt(image: ImageData, viewport: any): void {
  const [minX, minY, maxX, maxY] = getProjectedBounds(viewport);
  const [west, south, east, north] = BOX;
  const [centerX, centerY] = viewport.project([(west + east) / 2, (south + north) / 2]);
  const at = (x: number, y: number) => {
    const i = (Math.round(y) * SIZE + Math.round(x)) * 4;
    return isRed(image.data[i], image.data[i + 1], image.data[i + 2]);
  };
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
  expect(outside.slice(0, 5), 'red pixels outside the projected box').toEqual([]);
  expect(inside).toBeGreaterThan(50);
}

describe('vector tiles across a switch between map and globe views', () => {
  // Tiles decode once, to tile-local coordinates, into a cache the basemap owns. A view switch
  // converts them for the new view: drawn in tile coordinates on a map, in longitude/latitude on
  // a globe. It neither fetches nor decodes them again.
  test('switching from MapView to GlobeView draws the decoded tile in place, without a refetch', async () => {
    const tileBytes = encodeBoxTile(BOX);
    const requests = new Map<string, number>();
    let decodes = 0;
    // Fetches and decodes on the main thread with the options the tile cache passes.
    const fetchTile = async (url: string, {loadOptions}: any) => {
      requests.set(url, (requests.get(url) || 0) + 1);
      const response = new Response(tileBytes.slice().buffer, {status: 200});
      decodes++;
      return parse(await response.arrayBuffer(), MVTLoader, {...loadOptions, worker: false});
    };
    const style = {
      version: 8,
      sources: {
        shapes: {type: 'vector', tiles: ['https://tiles.test/{z}/{x}/{y}.mvt'], maxzoom: 0}
      },
      layers: [
        {id: 'background', type: 'background', paint: {'background-color': '#ffffff'}},
        {
          id: 'box',
          type: 'fill',
          source: 'shapes',
          'source-layer': 'shapes',
          paint: {'fill-color': '#ff0000'}
        }
      ]
    };
    // `style` and `fetchTile` keep their identity across the switch, as an application's would.
    const getBasemap = (mode: 'map' | 'globe') =>
      new BasemapLayer({id: 'basemap', style, fetch: fetchTile, mode} as any);

    let onFrame: ((image: ImageData) => void) | null = null;
    /** Resolves with the first frame, once every layer is loaded, that shows red. */
    const nextRedFrame = (viewName: string) =>
      new Promise<ImageData>((resolve, reject) => {
        const timeout = window.setTimeout(
          () =>
            reject(
              new Error(
                `No loaded frame with red in ${viewName}; requests ` +
                  `${JSON.stringify(Object.fromEntries(requests))}, decodes ${decodes}`
              )
            ),
          10_000
        );
        onFrame = image => {
          if (countPixels(image, isRed) > 0) {
            window.clearTimeout(timeout);
            onFrame = null;
            resolve(image);
          }
        };
      });
    const getTileset = () => {
      const basemap = (deck as any).layerManager.getLayers().find((l: any) => l.id === 'basemap');
      const tilesets = [...basemap.state.tilesets.values()];
      expect(tilesets).toHaveLength(1);
      return tilesets[0];
    };

    parent = document.createElement('div');
    document.body.append(parent);
    const mapFrame = nextRedFrame('MapView');
    deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new MapView({id: 'view'}),
      initialViewState: {longitude: 0, latitude: 0, zoom: 0},
      layers: [getBasemap('map')],
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

    const mapImage = await mapFrame;
    const mapViewport = deck.getViewports()[0];
    expectBoxAt(mapImage, mapViewport);
    expect(Object.fromEntries(requests)).toEqual({'https://tiles.test/0/0/0.mvt': 1});
    expect(decodes).toBe(1);
    const tileset = getTileset();
    const [tile] = tileset.tiles;
    const decoded = tile.content;
    expect(decoded).toHaveLength(1);

    const globeFrame = nextRedFrame('GlobeView');
    deck.setProps({views: new GlobeView({id: 'view'}), layers: [getBasemap('globe')]});
    const image = await globeFrame;
    const globeViewport = deck.getViewports()[0];
    expect(isGlobeViewport(globeViewport), 'a globe viewport').toBe(true);
    // The box's north-west corner, where map and globe projections differ most, falls outside
    // the box's globe bounds as drawn on the map: a box left in map positions is caught.
    const [cornerX, cornerY] = mapViewport.project([BOX[0], BOX[3]]);
    const [minX, minY] = getProjectedBounds(globeViewport);
    expect(Math.min(minX - cornerX, minY - cornerY)).toBeGreaterThan(8);
    expectBoxAt(image, globeViewport);

    // No second fetch or decode: the same decoded content stays in the same cache.
    expect(Object.fromEntries(requests)).toEqual({'https://tiles.test/0/0/0.mvt': 1});
    expect(decodes).toBe(1);
    expect(getTileset()).toBe(tileset);
    expect(tileset.tiles[0]).toBe(tile);
    expect(tile.content).toBe(decoded);
  }, 30_000);
});
