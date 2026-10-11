// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, _GlobeView as GlobeView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index';
import {MVTLabelLayer} from '../src/mvt-label-layer';
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
    const viewState = {longitude: 0, latitude: 0, zoom: -1};
    const layout = {'text-field': 'MM', 'text-size': 16};
    const inside = await renderGlobe(
      [createGlobeLabelLayer('edge', layout, {points: [[70, 0]]})],
      viewState
    );
    expect(countPixels(inside, isDark)).toBeGreaterThan(20);
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

/** Resolves once `condition` holds, polling every animation frame, or rejects after 10 seconds. */
function waitFor(condition: () => boolean): Promise<void> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (condition()) {
        resolve();
      } else if (performance.now() - start > 10_000) {
        reject(new Error('Timed out waiting'));
      } else {
        requestAnimationFrame(poll);
      }
    };
    poll();
  });
}

describe('vector tiles across a switch between map and globe views', () => {
  // Tiles decode to tile coordinates on a map and to longitude/latitude on a globe. A view switch
  // that keeps the tile layer must load its tiles again, or they draw in the wrong place.
  test('switching from MapView to GlobeView reloads the loaded tiles', async () => {
    // The tiles are empty and fail to decode; only their requests matter here.
    const requested: string[] = [];
    const fetchFn = (async (url: string) => {
      requested.push(String(url));
      return new Response(new ArrayBuffer(0), {status: 200});
    }) as typeof fetch;
    const getLayers = (mode: 'map' | 'globe') =>
      getBasemapLayers({
        idPrefix: 'switch',
        mode,
        zoom: 0,
        loadOptions: {fetch: fetchFn, core: {fetch: fetchFn}, worker: false} as any,
        styleDefinition: {
          version: 8,
          sources: {tiles: {type: 'vector', tiles: ['https://tiles.test/{z}/{x}/{y}.mvt']}},
          layers: [{id: 'fill', type: 'fill', source: 'tiles', 'source-layer': 'water'}]
        } as any
      });
    const isTileLayerLoaded = () =>
      Boolean(
        (deck as any)?.layerManager?.getLayers().find((layer: any) => layer.id === 'switch-tiles')
          ?.isLoaded
      );

    parent = document.createElement('div');
    document.body.append(parent);
    deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new MapView({id: 'map'}),
      initialViewState: {longitude: 0, latitude: 0, zoom: 0},
      layers: getLayers('map')
    });
    await waitFor(() => requested.length > 0 && isTileLayerLoaded());
    const mapRequests = [...requested];

    deck.setProps({
      views: new GlobeView({id: 'globe'}),
      initialViewState: {longitude: 0, latitude: 0, zoom: 0},
      layers: getLayers('globe')
    });
    // The globe at zoom 0 shows the whole world, so it needs the same tile as the map did.
    await waitFor(() => requested.length > mapRequests.length && isTileLayerLoaded());
    expect(requested.slice(mapRequests.length)).toEqual(expect.arrayContaining(mapRequests));
  });
});
