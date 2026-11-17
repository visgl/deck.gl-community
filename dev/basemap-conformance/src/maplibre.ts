// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The reference renderer: MapLibre GL JS, with the text of every label it placed read back from
 * its collision index. Moved from basemap-layers' `tests/reference-render/renderers.ts`, unchanged
 * except that MapLibre and its style specification package are passed in. It imports neither, so a
 * harness can import it by path and render with its own pinned copy of MapLibre (and the report
 * records which version).
 */

import {withTimeout} from './browser';
import {VIEWPORT} from './scenes';
import type {ConformanceRenderer} from './types';

/** What the reference renderer needs from the harness's dependencies. */
export type MapLibreDependencies = {
  /** `import * as maplibregl from 'maplibre-gl'`, its worker URL already set. */
  maplibregl: any;
  /** `import {expression, latest} from '@maplibre/maplibre-gl-style-spec'`. */
  styleSpec: {expression: any; latest: any};
};

/** One MapLibre render of a scene. */
export type MapLibreRender = {
  /** RGBA pixels composited on white, `width` by `height` times the pixel ratio. */
  pixels: Uint8ClampedArray;
  /** The text of every label MapLibre drew (after collision). */
  labels: string[];
  /** Same-origin URLs MapLibre requested. */
  requests: string[];
  /** Requests that left the page origin, and MapLibre errors. */
  problems: string[];
  /** Milliseconds until the map was idle. */
  duration: number;
};

/** The camera of a render. */
export type MapLibreScene = {
  /** `[longitude, latitude]`. */
  center: [number, number];
  zoom: number;
  /** Camera pitch, in degrees, unless the options give one. Default 0. */
  pitch?: number;
  /** Camera bearing, in degrees, unless the options give one. Default 0. */
  bearing?: number;
};

/** Options of a MapLibre render. */
export type MapLibreRenderOptions = {
  /** Canvas width, in CSS pixels. Default `VIEWPORT.width`. */
  width?: number;
  /** Canvas height, in CSS pixels. Default `VIEWPORT.height`. */
  height?: number;
  /** Device pixel ratio: the pixels are `width` by `height` times this. Default 1. */
  pixelRatio?: number;
  /** Camera pitch, in degrees. Default the scene's. */
  pitch?: number;
  /** Camera bearing, in degrees. Default the scene's. */
  bearing?: number;
};

const RENDER_TIMEOUT = 60_000;

const textFieldCaches = new WeakMap<object, Map<unknown, any>>();

/**
 * The text a symbol layer's `text-field` gives a feature, evaluated with the style specification
 * package (independently of the candidate renderer's own evaluation). `{token}` strings are
 * resolved as MapLibre resolves them.
 */
function evaluateTextField(
  styleSpec: MapLibreDependencies['styleSpec'],
  textField: unknown,
  feature: any,
  zoom: number
): string {
  if (textField === undefined || textField === null) {
    return '';
  }
  let cache = textFieldCaches.get(styleSpec);
  if (!cache) {
    cache = new Map();
    textFieldCaches.set(styleSpec, cache);
  }
  let compiled = cache.get(textField);
  if (!compiled) {
    // Handles expressions, constants and legacy `{stops}` functions. Style specification 26 added
    // a `rootKey` argument before the property specification.
    const {normalizePropertyExpression} = styleSpec.expression;
    const specification = styleSpec.latest.layout_symbol['text-field'];
    compiled =
      normalizePropertyExpression.length >= 4
        ? normalizePropertyExpression(textField, 'text-field', specification)
        : normalizePropertyExpression(textField, specification);
    cache.set(textField, compiled);
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
  if (styleSpec.expression.isExpression(textField) || dataDriven) {
    return text;
  }
  return text.replace(/{([^{}]+)}/g, (_: string, key: string) => {
    const property = feature.properties?.[key];
    return property === undefined || property === null ? '' : String(property);
  });
}

const GEOMETRY_TYPES = ['Unknown', 'Point', 'LineString', 'Polygon'];

/**
 * The text of every label MapLibre drew in the view: of each symbol whose collision box (text or
 * icon) its collision index has in the view, as `queryRenderedFeatures` finds them, if that
 * symbol's text placed. `queryRenderedFeatures` alone would also return a symbol whose icon placed
 * without its optional text. Reads MapLibre internals (`style.placement`, `tileManagers`).
 *
 * A candidate that reads its labels by their drawn glyphs instead (as basemap-layers'
 * `renderBasemapLayer` does) misses a label whose collision shape reaches into the view but whose
 * glyphs do not. In basemap-layers' `new-york-dark-z12.3`, "Bowery" is such a label: both
 * renderers place it, with the same collision circles, which reach 1.2 px into the view, and
 * neither draws a pixel of it there.
 */
function getPlacedTexts(
  styleSpec: MapLibreDependencies['styleSpec'],
  map: any,
  style: any,
  zoom: number,
  width: number,
  height: number
): string[] {
  const mapStyle = map.style;
  const placement = mapStyle.placement;
  if (!placement) {
    return [];
  }
  // Bucket instance id -> feature indices with a collision box in the view.
  const inView: Record<number, number[]> = placement.collisionIndex.queryRenderedSymbols([
    {x: 0, y: 0},
    {x: width, y: 0},
    {x: width, y: height},
    {x: 0, y: height}
  ]);
  const texts: string[] = [];
  for (const tileManager of Object.values<any>(mapStyle.tileManagers)) {
    for (const id of tileManager.getRenderableIds(true)) {
      const tile = tileManager.getTileByID(id);
      const featureIndex = tile?.latestFeatureIndex;
      for (const bucket of Object.values<any>(tile?.buckets || {})) {
        const features = inView[bucket.bucketInstanceId];
        if (!features || bucket.layers?.[0]?.type !== 'symbol' || !featureIndex) {
          continue;
        }
        const wanted = new Set(features);
        // The layers of a bucket share their layout, and so their text.
        const layer = style.layers.find((styleLayer: any) => styleLayer.id === bucket.layerIds[0]);
        const sourceLayer =
          featureIndex.loadVTLayers()[
            featureIndex.sourceLayerCoder.decode(bucket.sourceLayerIndex)
          ];
        const placed = new Set<number>();
        for (let i = 0; i < bucket.symbolInstances.length; i++) {
          const symbol = bucket.symbolInstances.get(i);
          if (wanted.has(symbol.featureIndex) && placement.placements[symbol.crossTileID]?.text) {
            placed.add(symbol.featureIndex);
          }
        }
        for (const index of placed) {
          const feature = sourceLayer.feature(index);
          const text = evaluateTextField(
            styleSpec,
            layer?.layout?.['text-field'],
            {
              geometry: {type: GEOMETRY_TYPES[feature.type]},
              properties: feature.properties,
              id: feature.id
            },
            zoom
          );
          if (text) {
            texts.push(text);
          }
        }
      }
    }
  }
  return texts;
}

/**
 * The pixels of a WebGL canvas composited on white, `pixelRatio` times `width` x `height`. Call
 * while its drawing buffer is valid.
 */
function readCanvas(
  source: HTMLCanvasElement,
  width: number,
  height: number,
  pixelRatio: number
): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** Renders a scene with MapLibre GL JS and reads back the placed labels. */
export async function renderMapLibreScene(
  {maplibregl, styleSpec}: MapLibreDependencies,
  style: any,
  scene: MapLibreScene,
  {
    width = VIEWPORT.width,
    height = VIEWPORT.height,
    pixelRatio = 1,
    pitch = scene.pitch ?? 0,
    bearing = scene.bearing ?? 0
  }: MapLibreRenderOptions = {}
): Promise<MapLibreRender> {
  const container = document.createElement('div');
  container.style.cssText = `position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px;`;
  document.body.append(container);
  const requests: string[] = [];
  const problems: string[] = [];
  const start = performance.now();
  const map = new maplibregl.Map({
    container,
    style,
    center: scene.center,
    zoom: scene.zoom,
    pitch,
    bearing,
    pixelRatio,
    // Labels at full opacity in the first idle frame.
    fadeDuration: 0,
    interactive: false,
    attributionControl: false,
    canvasContextAttributes: {preserveDrawingBuffer: true},
    transformRequest: (url: string) => {
      if (!url.startsWith(location.origin)) {
        problems.push(`Off-origin request: ${url}`);
        return {url: `${location.origin}/__blocked__`};
      }
      requests.push(url);
      return {url};
    }
  });
  map.on('error', (event: any) => {
    const error = event.error;
    const status = error?.status ? ` (${error.status})` : '';
    const url = error?.url ? ` ${error.url}` : '';
    problems.push(`MapLibre error${status}${url}: ${error?.message || error}`);
  });
  try {
    await withTimeout(
      new Promise(resolve => map.once('idle', resolve)),
      'MapLibre render',
      RENDER_TIMEOUT
    );
    const pixels = readCanvas(map.getCanvas(), width, height, pixelRatio);
    const labels = getPlacedTexts(styleSpec, map, style, map.getZoom(), width, height);
    return {pixels, labels, requests, problems, duration: performance.now() - start};
  } finally {
    map.remove();
    container.remove();
  }
}

/**
 * The reference renderer of a conformance runner. Its id, `maplibre`, is what the scorer compares
 * every other renderer with. A runner that renders a second MapLibre (another version, or another
 * repository's copy) gives it another id starting with `maplibre`, and the scorer reports how far
 * it is from the reference.
 */
export function createMapLibreRenderer(
  dependencies: MapLibreDependencies,
  id = 'maplibre'
): ConformanceRenderer {
  const version = dependencies.maplibregl.getVersion?.() || 'unknown';
  return {
    id,
    name: `MapLibre GL JS ${version}`,
    supports: () => true,
    async render(scene, style) {
      const result = await renderMapLibreScene(dependencies, style, scene);
      return {
        pixels: result.pixels,
        width: VIEWPORT.width,
        height: VIEWPORT.height,
        labels: result.labels,
        problems: result.problems,
        meta: {renderMs: Math.round(result.duration), version}
      };
    }
  };
}
