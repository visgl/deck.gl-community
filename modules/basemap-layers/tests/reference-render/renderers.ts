// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {TextLayer} from '@deck.gl/layers';
import {Model} from '@luma.gl/engine';
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
  /** RGBA pixels composited on white, `VIEWPORT.width` by `VIEWPORT.height` times the pixel ratio. */
  pixels: Uint8ClampedArray;
  /** The text of every label the renderer drew (after collision). */
  labels: string[];
  /** Fixture URLs the renderer requested. */
  requests: string[];
  /** Requests that left the page origin, or fixtures that were missing. */
  problems: string[];
  /**
   * Milliseconds until the render was complete. For `BasemapLayer`, both its draws and the font
   * atlases built between them (see `renderBasemapLayer`).
   */
  duration: number;
  /** `BasemapLayer` only: milliseconds of its first draw alone, from empty font atlases. */
  firstDrawDuration?: number;
  /** `BasemapLayer` only: primitive layers and model draws of the frame read back. */
  layers?: number;
  draws?: number;
  /**
   * `BasemapLayer` only: the cache keys of the fonts whose atlas its second draw built or grew
   * itself, with characters in the order its tiles loaded, instead of drawing from the atlas built
   * with them sorted (see `resetFontAtlases`). Empty when the frame does not depend on that order.
   */
  unsortedFontAtlases?: string[];
};

const RENDER_TIMEOUT = 60_000;

function createContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.style.cssText = `position: absolute; left: 0; top: 0; width: ${VIEWPORT.width}px; height: ${VIEWPORT.height}px;`;
  document.body.append(container);
  return container;
}

/** Options of a render. */
export type RenderOptions = {
  /** Device pixel ratio: the pixels are `VIEWPORT` times this. Default 1. */
  pixelRatio?: number;
  /** Camera pitch, in degrees. Default 0. */
  pitch?: number;
  /** Camera bearing, in degrees. Default 0. */
  bearing?: number;
};

/** Options of a `BasemapLayer` render. */
export type BasemapLayerRenderOptions = RenderOptions & {
  /**
   * Runs once the render read back is read, before the deck is finalized: to move the view, say.
   */
  onRendered?: (deck: Deck<any>) => Promise<void>;
};

/**
 * The pixels of a WebGL canvas composited on white, `pixelRatio` times the viewport. Call while its
 * drawing buffer is valid.
 */
function readCanvas(source: HTMLCanvasElement, pixelRatio = 1): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = VIEWPORT.width * pixelRatio;
  canvas.height = VIEWPORT.height * pixelRatio;
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

const GEOMETRY_TYPES = ['Unknown', 'Point', 'LineString', 'Polygon'];

/**
 * The text of every label MapLibre drew in the view: of each symbol whose collision box (text or
 * icon) its collision index has in the view, as `queryRenderedFeatures` finds them, if that
 * symbol's text placed. `queryRenderedFeatures` alone would also return a symbol whose icon placed
 * without its optional text.
 *
 * `BasemapLayer`'s labels are read by their drawn glyphs instead (see `renderBasemapLayer`), so a
 * label whose collision shape reaches into the view but whose glyphs do not counts here only. In
 * `new-york-dark-z12.3`, "Bowery" is such a label: both renderers place it, with the same
 * collision circles, which reach 1.2 px into the view, and neither draws a pixel of it there.
 */
function getPlacedTexts(map: maplibregl.Map, style: any, zoom: number): string[] {
  const mapStyle = (map as any).style;
  const placement = mapStyle.placement;
  if (!placement) {
    return [];
  }
  const {width, height} = VIEWPORT;
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

/** Renders a scene with MapLibre GL JS and reads back the placed labels. */
export async function renderMapLibre(
  style: any,
  scene: ReferenceScene,
  {pixelRatio = 1, pitch = 0, bearing = 0}: RenderOptions = {}
): Promise<Render> {
  const container = createContainer();
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
    const pixels = readCanvas(map.getCanvas(), pixelRatio);
    const labels = getPlacedTexts(map, style, map.getZoom());
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

/**
 * Fonts a scene may draw without one evicting another from deck.gl's font atlas cache (3 by
 * default), which would rebuild the evicted font's atlas in another order.
 */
const FONT_ATLAS_CACHE_LIMIT = 64;

/** A font of the text layers of a draw: its atlas manager, characters and atlases. */
type FontAtlas = {
  /** deck.gl's font atlas cache key of the font. */
  key: string;
  /** The font atlas manager of one of the layers, with the font's settings, key and renderer. */
  manager: {
    props: Record<string, unknown>;
    setProps(props: Record<string, unknown>): void;
    atlas?: object;
  };
  characters: Set<string>;
  /** The atlases the layers drew from: more than one where a layer holds an earlier atlas. */
  atlases: Set<object>;
};

/**
 * The fonts the text layers among `layers` draw, with every character any of them holds. A layer
 * not updated since its font gained characters still holds an earlier atlas of that font.
 */
function getFontAtlases(layers: any[]): FontAtlas[] {
  // By deck.gl's font atlas cache key, which the layers of one font share.
  const fonts = new Map<string, FontAtlas>();
  for (const layer of layers) {
    const manager = layer.state?.fontAtlasManager;
    if (!manager?.mapping) {
      continue;
    }
    let font = fonts.get(manager._key);
    if (!font) {
      font = {key: manager._key, manager, characters: new Set(), atlases: new Set()};
      fonts.set(manager._key, font);
    }
    font.atlases.add(manager.atlas);
    for (const character of Object.keys(manager.mapping)) {
      font.characters.add(character);
    }
  }
  return [...fonts.values()];
}

/**
 * Empties deck.gl's font atlas cache, then builds the given atlases with their characters sorted.
 * `TextLayer` keeps one atlas per font for all its layers and appends each character where the
 * last ended, in the order the layers first draw them: the order their tiles load, after the
 * characters of earlier renders on the page. Small text samples the atlas's mipmaps, whose texels
 * average blocks aligned to the texture, not to the glyph, so a glyph moved to another place in
 * the atlas draws different pixels along its edges. Returns the atlases built.
 */
function resetFontAtlases(atlases: FontAtlas[] = []): Set<object> {
  // Setting the limit replaces the cache with an empty one.
  TextLayer.fontAtlasCacheLimit = FONT_ATLAS_CACHE_LIMIT;
  const built = new Set<object>();
  for (const {manager, characters} of atlases) {
    // Through the manager of a layer of the first draw, whose cache key and font renderer may be
    // its layer's own: a `LabelTextLayer` keys its atlases apart from `TextLayer`'s, and a new
    // manager would build them under `TextLayer`'s key, where no label layer looks.
    manager.setProps({characterSet: [...characters].sort()});
    built.add(manager.atlas!);
  }
  return built;
}

/**
 * Renders a scene with `BasemapLayer` in a deck.gl `MapView` and reads back the drawn labels. The
 * scene is drawn twice: once to learn the characters of each font, and once, read back, from font
 * atlases holding those characters in a fixed order (see `resetFontAtlases`), so that the pixels
 * do not depend on the order the tiles loaded nor on the scenes drawn before.
 */
export async function renderBasemapLayer(
  style: any,
  scene: ReferenceScene,
  layerProps: Record<string, unknown> = {},
  options: BasemapLayerRenderOptions = {},
  draw = drawBasemapLayer
): Promise<Render> {
  const start = performance.now();
  resetFontAtlases();
  const first = await draw(structuredClone(style), scene, layerProps, {
    ...options,
    onRendered: undefined
  });
  const prebuilt = resetFontAtlases(first.fontAtlases);
  const {fontAtlases, ...render} = await draw(style, scene, layerProps, options);
  return {
    ...render,
    unsortedFontAtlases: fontAtlases
      .filter(({atlases}) => [...atlases].some(atlas => !prebuilt.has(atlas)))
      .map(({key}) => key),
    duration: performance.now() - start,
    firstDrawDuration: first.duration,
    requests: [...new Set([...first.requests, ...render.requests])],
    problems: [...new Set([...first.problems, ...render.problems])]
  };
}

/** One `BasemapLayer` render of a scene, with the font atlases its text layers drew from. */
export type BasemapLayerDraw = Render & {fontAtlases: FontAtlas[]};

async function drawBasemapLayer(
  style: any,
  scene: ReferenceScene,
  layerProps: Record<string, unknown>,
  {pixelRatio = 1, pitch = 0, bearing = 0, onRendered}: BasemapLayerRenderOptions
): Promise<BasemapLayerDraw> {
  const parent = createContainer();
  performance.clearResourceTimings();
  performance.setResourceTimingBufferSize(100_000);
  const start = performance.now();
  let deck: Deck<any> | null = null;
  let settled = 0;
  // Model draws per frame (every pass: collision maps, shadows and the screen).
  let draws = 0;
  let frameDraws = 0;
  let frameLayers = 0;
  let fontAtlases: FontAtlas[] = [];
  const modelDraw = Model.prototype.draw;
  Model.prototype.draw = function countedDraw(this: Model, ...args: Parameters<Model['draw']>) {
    draws++;
    return modelDraw.apply(this, args);
  };
  try {
    const pixels = await withTimeout(
      new Promise<Uint8ClampedArray>((resolve, reject) => {
        deck = new Deck({
          parent,
          width: VIEWPORT.width,
          height: VIEWPORT.height,
          useDevicePixels: pixelRatio === 1 ? false : pixelRatio,
          deviceProps: {adapters: [webgl2Adapter]},
          views: new MapView(),
          initialViewState: {
            longitude: scene.center[0],
            latitude: scene.center[1],
            zoom: scene.zoom,
            pitch,
            bearing
          },
          layers: [
            new ProbeBasemapLayer({
              id: 'basemap',
              style,
              loadOptions: {mvt: {workerUrl: mvtWorkerUrl}},
              // Placed at every frame, as MapLibre with `fadeDuration: 0`.
              labelPlacementInterval: 0,
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
            frameDraws = draws;
            draws = 0;
            const ready =
              resolvedStyle &&
              (!resolvedStyle.sprite || basemap.state.spriteAtlases) &&
              tileLayers.length > 0 &&
              tileLayers.every((layer: any) => layer.state.tileset.selectedTiles) &&
              layers.every((layer: any) => layer.isLoaded) &&
              // Labels along lines are placed by a length estimate until their web font has
              // loaded, and again once it has: a frame read before then shows the estimate.
              document.fonts.status === 'loaded';
            if (!ready) {
              settled = 0;
              // A font that loads without changing a layer would not draw another frame.
              if (document.fonts.status !== 'loaded') {
                document.fonts.ready.then(() => {
                  // Unless the render is over, and the deck finalized.
                  const current = deck as any;
                  if (current?.layerManager) {
                    current.redraw('reference-render fonts');
                  }
                });
              }
              return;
            }
            if (settled < SETTLE_FRAMES) {
              settled++;
              deck!.redraw('reference-render settle');
              return;
            }
            frameLayers = layers.filter(
              (layer: any) => !layer.isComposite && layer.props.visible
            ).length;
            fontAtlases = getFontAtlases(layers);
            resolve(readCanvas(deck!.getCanvas()!, pixelRatio));
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

    await onRendered?.(deck!);
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
      duration: performance.now() - start,
      layers: frameLayers,
      draws: frameDraws,
      fontAtlases
    };
  } finally {
    Model.prototype.draw = modelDraw;
    (deck as Deck<any> | null)?.finalize();
    parent.remove();
  }
}
