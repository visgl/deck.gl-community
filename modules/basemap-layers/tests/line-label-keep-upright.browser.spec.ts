// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, _GlobeView as GlobeView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';

// A straight street label, kept upright (the default), as the view turns half a turn in 2 degree
// steps without zooming. At every step, the label drawn must lie along the street as the view
// draws it, and read upright. Both are measured in the drawn pixels.

type Scene = {
  mode: 'map' | 'globe';
  /** The only tile with a street. */
  tile: {z: number; x: number; y: number};
  /** The street, in tile coordinates. */
  street: [number, number][];
  /** The middle of the view, in tile coordinates. */
  center: [number, number];
  size: number;
};

/** About 14 degrees north of east, at the middle of a 200 pixel view that keeps to its tile. */
const CENTERED: Omit<Scene, 'mode'> = {
  tile: {z: 9, x: 270, y: 241},
  street: [
    [0.3, 0.55],
    [0.7, 0.45]
  ],
  center: [0.5, 0.5],
  size: 200
};

/**
 * Far from the middle of a view of the globe at zoom 3, near latitude 55, where the bearing alone
 * does not tell how the view turns a line: there it differs by several degrees.
 */
const OFF_CENTER: Scene = {
  mode: 'globe',
  tile: {z: 3, x: 4, y: 2},
  street: [
    [0.45, 0.52],
    [0.75, 0.48]
  ],
  center: [0.4, 0.7],
  size: 480
};

/** Heavy glyphs first, then light ones, so that the drawn ink tells which way the text reads. */
const NAME = 'MMMMMM-------';
/** How far past vertical text may turn before it flips: half of `BEARING_STEP`. */
const FLIP_TOLERANCE = 2.5;
/** How far the drawn label may turn from its street. */
const ANGLE_TOLERANCE = 2;

function fromTile({z, x, y}: Scene['tile'], [u, v]: [number, number]): [number, number] {
  const scale = 2 ** z;
  const n = Math.PI - (2 * Math.PI * (y + v)) / scale;
  return [((x + u) / scale) * 360 - 180, (Math.atan(Math.sinh(n)) * 180) / Math.PI];
}

function getFetchTile({tile, street}: Scene) {
  return async (url: string) => {
    const [z, x, y] = url
      .match(/(\d+)\/(\d+)\/(\d+)\.mvt/)!
      .slice(1)
      .map(Number);
    return z === tile.z && x === tile.x && y === tile.y
      ? [
          {
            type: 'Feature',
            properties: {layerName: 'road', name: NAME},
            geometry: {type: 'LineString', coordinates: street}
          }
        ]
      : [];
  };
}

const STYLE = {
  version: 8,
  sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
  layers: [
    {id: 'background', type: 'background', paint: {'background-color': '#ffffff'}},
    {
      id: 'road-label',
      type: 'symbol',
      source: 'tiles',
      'source-layer': 'road',
      layout: {'text-field': ['get', 'name'], 'text-size': 14, 'symbol-placement': 'line'},
      paint: {'text-color': '#000000'}
    }
  ]
} as any;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;
let onFrame: ((image: ImageData) => void) | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
  onFrame = null;
});

function frames(count: number): Promise<void> {
  return new Promise(resolve => {
    const step = () => (count-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
}

/** The next frame drawn, read back. */
function readFrame(): Promise<ImageData> {
  return new Promise(resolve => {
    onFrame = image => {
      onFrame = null;
      resolve(image);
    };
    deck!.redraw('read');
  });
}

function hasLabels(): boolean {
  return ((deck as any).layerManager.getLayers() as any[]).some(
    layer => !layer.isComposite && layer.id.includes('road-label') && layer.getNumInstances() > 0
  );
}

async function settle(): Promise<void> {
  for (let i = 0; i < 300; i++) {
    await frames(2);
    const layers = (deck as any).layerManager.getLayers();
    if (layers.length > 1 && layers.every((layer: any) => layer.isLoaded) && hasLabels()) {
      await frames(10);
      return;
    }
  }
  throw new Error('Timed out loading');
}

/** Counter-clockwise degrees in [-180, 180). */
const normalize = (angle: number) => ((((angle + 180) % 360) + 360) % 360) - 180;

/**
 * The direction, counter-clockwise on screen in degrees, in which the drawn text reads: the main
 * axis of its ink, pointing from its heavy glyphs to its light ones. Null without ink.
 */
function getReadingAngle(image: ImageData): number | null {
  const points: [number, number][] = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4] < 128) {
        points.push([x, image.height - y]);
      }
    }
  }
  if (points.length < 20) {
    return null;
  }
  const [mx, my] = points
    .reduce(([sx, sy], [x, y]) => [sx + x, sy + y], [0, 0])
    .map(sum => sum / points.length);
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const [x, y] of points) {
    xx += (x - mx) ** 2;
    xy += (x - mx) * (y - my);
    yy += (y - my) ** 2;
  }
  const axis = 0.5 * Math.atan2(2 * xy, xx - yy);
  const along = points.map(([x, y]) => (x - mx) * Math.cos(axis) + (y - my) * Math.sin(axis));
  const middle = (Math.min(...along) + Math.max(...along)) / 2;
  // The heavy glyphs hold most of the ink: the text reads away from that half.
  const heavyFirst = along.filter(value => value < middle).length > points.length / 2;
  return normalize((axis * 180) / Math.PI + (heavyFirst ? 0 : 180));
}

/** The street's direction, counter-clockwise on screen in degrees. */
function getStreetAngle(scene: Scene): number {
  const viewport = (deck as any).getViewports()[0];
  const [x0, y0] = viewport.project(fromTile(scene.tile, scene.street[0]));
  const [x1, y1] = viewport.project(fromTile(scene.tile, scene.street[1]));
  return (Math.atan2(-(y1 - y0), x1 - x0) * 180) / Math.PI;
}

/** The labels drawn at every bearing step, as `bearing: problem`. */
async function turn(scene: Scene): Promise<string[]> {
  const {size} = scene;
  const [longitude, latitude] = fromTile(scene.tile, scene.center);
  const viewState = {longitude, latitude, zoom: scene.tile.z};
  parent = document.createElement('div');
  document.body.append(parent);
  deck = new Deck({
    parent,
    width: size,
    height: size,
    useDevicePixels: false,
    deviceProps: {adapters: [webgl2Adapter]},
    views: scene.mode === 'globe' ? new GlobeView({id: 'view'}) : new MapView({id: 'view'}),
    viewState: {...viewState, bearing: 30},
    layers: [
      new BasemapLayer({
        id: 'basemap',
        mode: scene.mode,
        fetch: getFetchTile(scene),
        style: STYLE
      })
    ],
    onAfterRender: () => {
      if (onFrame) {
        const copy = document.createElement('canvas');
        copy.width = size;
        copy.height = size;
        const context = copy.getContext('2d')!;
        context.drawImage(deck!.getCanvas()!, 0, 0);
        onFrame(context.getImageData(0, 0, size, size));
      }
    },
    onError: error => {
      throw error;
    }
  });
  await settle();

  const failures: string[] = [];
  for (let bearing = 30; bearing <= 210; bearing += 2) {
    deck.setProps({viewState: {...viewState, bearing}});
    await frames(2);
    const reading = getReadingAngle(await readFrame());
    const street = getStreetAngle(scene);
    if (reading === null) {
      failures.push(`${bearing}: no label`);
      continue;
    }
    // Along the street, either way.
    const offStreet = Math.abs(normalize(2 * (reading - street)) / 2);
    if (offStreet > ANGLE_TOLERANCE) {
      failures.push(`${bearing}: drawn at ${reading.toFixed(1)}, street at ${street.toFixed(1)}`);
    }
    if (Math.abs(reading) > 90 + FLIP_TOLERANCE) {
      failures.push(`${bearing}: reads at ${reading.toFixed(1)}, upside down`);
    }
  }
  return failures;
}

describe('labels along a straight line, kept upright', () => {
  for (const mode of ['map', 'globe'] as const) {
    test(`follow the line and read upright as the view turns (${mode})`, async () => {
      expect(await turn({...CENTERED, mode})).toEqual([]);
    }, 120_000);
  }

  test('follow the line far from the middle of a globe view', async () => {
    expect(await turn(OFF_CENTER)).toEqual([]);
  }, 120_000);
});
