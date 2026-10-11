// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expression as styleExpression, latest} from '@maplibre/maplibre-gl-style-spec';
import mvtWorkerUrl from '@loaders.gl/mvt/mvt-worker.js?url';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import {BasemapLayer} from '../../src/index';
import {MVTLabelLayer} from '../../src/mvt-label-layer';
import {fromFixtureUrl} from './fixtures';
import {VIEWPORT, type ReferenceScene} from './scenes';

// Both renderers parse tiles in workers served by the test server. MapLibre resolves its worker
// relative to its bundle, which the dependency optimizer moves; loaders.gl defaults to a CDN copy.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

/** One render of a scene. */
export type Render = {
  /** RGBA pixels composited on white, `VIEWPORT.width` by `VIEWPORT.height`. */
  pixels: Uint8ClampedArray;
  /** The text of every label the renderer drew (after collision). */
  labels: string[];
  /** Fixture URLs the renderer requested. */
  requests: string[];
  /** Requests that left the page origin, or fixtures that were missing. */
  problems: string[];
  /** Milliseconds until the render was complete. */
  duration: number;
};

const RENDER_TIMEOUT = 60_000;

function createContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.style.cssText = `position: absolute; left: 0; top: 0; width: ${VIEWPORT.width}px; height: ${VIEWPORT.height}px;`;
  document.body.append(container);
  return container;
}

/** The pixels of a WebGL canvas composited on white. Call while its drawing buffer is valid. */
function readCanvas(source: HTMLCanvasElement): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = VIEWPORT.width;
  canvas.height = VIEWPORT.height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${RENDER_TIMEOUT} ms`)),
      RENDER_TIMEOUT
    );
    promise.then(
      value => {
        window.clearTimeout(timer);
        resolve(value);
      },
      error => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

const textFieldCache = new Map<unknown, any>();

/**
 * The text a symbol layer's `text-field` gives a feature, evaluated with the style specification
 * package (independently of `BasemapLayer`'s own evaluation). `{token}` strings are resolved as
 * MapLibre resolves them.
 */
function evaluateTextField(textField: unknown, feature: any, zoom: number): string {
  if (textField === undefined || textField === null) {
    return '';
  }
  let compiled = textFieldCache.get(textField);
  if (!compiled) {
    // Handles expressions, constants and legacy `{stops}` functions.
    compiled = styleExpression.normalizePropertyExpression(
      textField as any,
      (latest as any).layout_symbol['text-field']
    );
    textFieldCache.set(textField, compiled);
  }
  const value = compiled.evaluate(
    {zoom},
    {
      type: feature.geometry?.type,
      properties: feature.properties,
      id: feature.id
    }
  );
  const text = typeof value === 'string' ? value : value?.toString?.() || '';
  // MapLibre resolves `{token}`s only in constants and zoom functions, as `getValueAndResolveTokens`.
  const dataDriven = Boolean(textField && typeof textField === 'object' && 'property' in textField);
  if (styleExpression.isExpression(textField) || dataDriven) {
    return text;
  }
  return text.replace(/{([^{}]+)}/g, (_: string, key: string) => {
    const property = feature.properties?.[key];
    return property === undefined || property === null ? '' : String(property);
  });
}

/** Renders a scene with MapLibre GL JS and reads back the placed labels. */
export async function renderMapLibre(style: any, scene: ReferenceScene): Promise<Render> {
  const container = createContainer();
  const requests: string[] = [];
  const problems: string[] = [];
  const start = performance.now();
  const map = new maplibregl.Map({
    container,
    style,
    center: scene.center,
    zoom: scene.zoom,
    pixelRatio: 1,
    // Labels at full opacity in the first idle frame.
    fadeDuration: 0,
    interactive: false,
    attributionControl: false,
    canvasContextAttributes: {preserveDrawingBuffer: true},
    transformRequest: url => {
      if (!url.startsWith(location.origin)) {
        problems.push(`Off-origin request: ${url}`);
        return {url: `${location.origin}/__blocked__`};
      }
      requests.push(url);
      return {url};
    }
  });
  map.on('error', event => {
    const error = (event as any).error;
    const status = error?.status ? ` (${error.status})` : '';
    const url = error?.url ? ` ${error.url}` : '';
    problems.push(`MapLibre error${status}${url}: ${error?.message || error}`);
  });
  try {
    await withTimeout(new Promise(resolve => map.once('idle', resolve)), 'MapLibre render');
    const pixels = readCanvas(map.getCanvas());
    const symbolLayers = style.layers
      .filter((layer: any) => layer.type === 'symbol')
      .map((layer: any) => layer.id);
    const zoom = map.getZoom();
    const labels = map
      .queryRenderedFeatures({layers: symbolLayers})
      .map(feature => {
        const layer = style.layers.find((styleLayer: any) => styleLayer.id === feature.layer.id);
        return evaluateTextField(layer?.layout?.['text-field'], feature, zoom);
      })
      .filter(Boolean);
    return {
      pixels,
      labels,
      requests,
      problems,
      duration: performance.now() - start
    };
  } finally {
    map.remove();
    container.remove();
  }
}

/** A label layer whose icons are not pickable, so that a pick means its text was drawn. */
class ProbeLabelLayer extends MVTLabelLayer {
  static layerName = 'ProbeLabelLayer';

  renderIconLayers(...args: any[]) {
    return (super.renderIconLayers as any)(...args).map((layer: any) =>
      layer.clone({pickable: false})
    );
  }
}

/**
 * `BasemapLayer` with only its label text pickable, so that the labels left after collision can be
 * read back by picking. Drawing is unchanged.
 */
class ProbeBasemapLayer extends BasemapLayer {
  static layerName = 'ProbeBasemapLayer';

  renderLayers() {
    const toProbe = (layers: unknown): any[] =>
      ([layers].flat(Infinity) as any[])
        .filter(Boolean)
        .map(subLayer =>
          subLayer instanceof MVTLabelLayer
            ? new ProbeLabelLayer(subLayer.props as any)
            : subLayer.clone({pickable: false})
        );
    return (super.renderLayers() as any[]).map(layer => {
      const {renderSubLayers, renderLabelLayers} = layer.props;
      if (!renderSubLayers) {
        return layer.clone({pickable: false});
      }
      return layer.clone({
        pickable: true,
        renderSubLayers: (props: any) => toProbe(renderSubLayers(props)),
        // Where the tile layer draws each symbol style layer's labels for all its tiles at once.
        ...(renderLabelLayers && {
          renderLabelLayers: (...args: any[]) => toProbe(renderLabelLayers(...args))
        })
      });
    });
  }
}

/**
 * Fixture requests seen by the page since `start`, with their HTTP status. The resource timing
 * buffer is cleared before each render (see `renderBasemapLayer`), so it cannot fill and drop
 * entries.
 */
function getResourceRequests(start: number): Array<{url: string; status: number}> {
  return (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
    .filter(entry => entry.startTime >= start)
    .map(entry => ({
      url: entry.name,
      status: (entry as any).responseStatus ?? 0
    }));
}

/** Frames drawn after everything has loaded and before the frame is read. */
const SETTLE_FRAMES = 1;

/** Renders a scene with `BasemapLayer` in a deck.gl `MapView` and reads back the drawn labels. */
export async function renderBasemapLayer(
  style: any,
  scene: ReferenceScene,
  layerProps: Record<string, unknown> = {}
): Promise<Render> {
  const parent = createContainer();
  performance.clearResourceTimings();
  performance.setResourceTimingBufferSize(100_000);
  const start = performance.now();
  let deck: Deck<any> | null = null;
  let settled = 0;
  try {
    const pixels = await withTimeout(
      new Promise<Uint8ClampedArray>((resolve, reject) => {
        deck = new Deck({
          parent,
          width: VIEWPORT.width,
          height: VIEWPORT.height,
          useDevicePixels: false,
          deviceProps: {adapters: [webgl2Adapter]},
          views: new MapView(),
          initialViewState: {
            longitude: scene.center[0],
            latitude: scene.center[1],
            zoom: scene.zoom,
            pitch: 0,
            bearing: 0
          },
          layers: [
            new ProbeBasemapLayer({
              id: 'basemap',
              style,
              loadOptions: {mvt: {workerUrl: mvtWorkerUrl}},
              ...layerProps
            })
          ],
          onAfterRender: () => {
            const layerManager = (deck as any)?.layerManager;
            const basemap = layerManager?.getLayers({
              layerIds: ['basemap']
            })[0];
            const resolvedStyle = basemap?.state?.resolvedStyle;
            const layers = layerManager?.getLayers() || [];
            // A tile layer reports loaded before it has selected any tiles.
            const tileLayers = layers.filter((layer: any) => layer.state?.tileset);
            const ready =
              resolvedStyle &&
              (!resolvedStyle.sprite || basemap.state.spriteAtlases) &&
              tileLayers.length > 0 &&
              tileLayers.every((layer: any) => layer.state.tileset.selectedTiles) &&
              layers.every((layer: any) => layer.isLoaded);
            if (!ready) {
              settled = 0;
              return;
            }
            if (settled < SETTLE_FRAMES) {
              settled++;
              deck!.redraw('reference-render settle');
              return;
            }
            resolve(readCanvas(deck!.getCanvas()!));
          },
          onError: error => reject(error)
        });
      }),
      'BasemapLayer render'
    );

    const {width, height} = VIEWPORT;
    const labels = new Set<string>();
    for (const info of (deck as any).pickObjects({
      x: 0,
      y: 0,
      width,
      height
    })) {
      const labelLayer = info.sourceTileSubLayer;
      if (labelLayer instanceof ProbeLabelLayer && info.object) {
        const text = labelLayer.getLabel(info.object);
        if (text) {
          labels.add(String(text));
        }
      }
    }

    const resources = getResourceRequests(start);
    const problems = resources
      .filter(({url}) => !url.startsWith(location.origin))
      .map(({url}) => `Off-origin request: ${url}`);
    for (const {url, status} of resources) {
      if (fromFixtureUrl(url) && status >= 400) {
        problems.push(`Missing fixture (${status}): ${url}`);
      }
    }
    return {
      pixels,
      labels: [...labels],
      requests: resources.map(({url}) => url).filter(url => fromFixtureUrl(url)),
      problems,
      duration: performance.now() - start
    };
  } finally {
    (deck as Deck<any> | null)?.finalize();
    parent.remove();
  }
}
