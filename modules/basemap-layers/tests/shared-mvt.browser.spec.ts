import {Deck, MapView, _GlobeView as GlobeView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, test} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';

/** A real deck.gl view switch must redraw geographic content without decoding it again. */
test('shared basemap tiles draw in map, globe and map again', async () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  let deck: Deck<any> | undefined;
  let requests = 0;
  const fetch = async (_url: string, options: any) => {
    requests++;
    expect(options.loadOptions.mvt.coordinates).toBe('local');
    return [
      {
        type: 'Feature',
        properties: {layerName: 'water'},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0.45, 0.45],
              [0.55, 0.45],
              [0.55, 0.55],
              [0.45, 0.55],
              [0.45, 0.45]
            ]
          ]
        }
      }
    ];
  };
  const style: any = {
    version: 8,
    sources: {tiles: {type: 'vector', tiles: ['https://example.com/{z}/{x}/{y}.pbf'], maxzoom: 0}},
    layers: [
      {
        id: 'water',
        type: 'fill',
        source: 'tiles',
        'source-layer': 'water',
        paint: {'fill-color': '#ff0000'}
      },
      {id: 'background', type: 'background', paint: {'background-color': 'rgba(255,255,255,0)'}},
      {
        id: 'outline',
        type: 'line',
        source: 'tiles',
        'source-layer': 'water',
        paint: {'line-color': '#ff0000', 'line-width': 2}
      }
    ]
  };
  let complete: (() => void) | undefined;
  let latest = '';
  let modeName = 'map';
  const waitFrame = () =>
    new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`No loaded red frame in ${modeName}: ${latest}`)),
        10000
      );
      complete = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  try {
    const ready = waitFrame();
    deck = new Deck({
      parent,
      width: 128,
      height: 128,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new MapView({id: 'view'}),
      initialViewState: {longitude: 0, latitude: 0, zoom: 0},
      layers: [new BasemapLayer({id: 'basemap', style, fetch})],
      onError: error => {
        throw error;
      },
      onAfterRender: () => {
        if (
          !complete ||
          !(deck as any)?.layerManager.getLayers().every((layer: any) => layer.isLoaded)
        )
          return;
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext('2d')!;
        context.drawImage(deck!.getCanvas()!, 0, 0);
        const pixels = context.getImageData(0, 0, 128, 128).data;
        let red = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] > 200 && pixels[i + 1] < 60 && pixels[i + 2] < 60) red++;
        latest += ` red=${red} requests=${requests}`;
        if (red > 20) {
          const done = complete;
          complete = undefined;
          done();
        }
      }
    });
    await ready;
    for (const mode of ['globe', 'map'] as const) {
      modeName = mode;
      const loaded = waitFrame();
      deck.setProps({
        views: mode === 'globe' ? new GlobeView({id: 'view'}) : new MapView({id: 'view'}),
        layers: [new BasemapLayer({id: 'basemap', style, fetch, mode})]
      });
      await loaded;
    }
    expect(requests).toBe(1);
  } finally {
    deck?.finalize();
    parent.remove();
  }
}, 30000);
