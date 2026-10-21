/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test, vi} from 'vitest';
import {WebMercatorViewport} from '@deck.gl/core';
import {SharedTileset2D} from '../../geo-layers/src';
import {BasemapLayer} from '../src/basemap-layer';
import {createDemTileset} from '../src';
import {getBasemapLayers, getStyleLayerRuns} from '../src/globe-layers';
import {
  type DemTile,
  HillshadeTileLayer,
  decodeDemTile,
  getDemUnpackVector,
  getHillshadeParameters,
  getHillshadeUniforms,
  prepareHillshadeTexture
} from '../src/hillshade-layer';
import {parseProperties} from '../src/map-style';

/** The RGBA pixels of a tile whose pixels encode `elevations` with `encode`. */
function encodeTile(
  elevations: number[],
  encode: (elevation: number) => [number, number, number]
): Uint8Array {
  const pixels = new Uint8Array(elevations.length * 4);
  elevations.forEach((elevation, index) => {
    pixels.set([...encode(elevation), 255], index * 4);
  });
  return pixels;
}

/** Mapbox Terrain-RGB: height = -10000 + (R * 256 * 256 + G * 256 + B) * 0.1. */
function encodeMapbox(elevation: number): [number, number, number] {
  const value = Math.round((elevation + 10000) * 10);
  return [Math.floor(value / 65536), Math.floor(value / 256) % 256, value % 256];
}

/** Terrarium: height = R * 256 + G + B / 256 - 32768. */
function encodeTerrarium(elevation: number): [number, number, number] {
  const value = elevation + 32768;
  return [Math.floor(value / 256), Math.floor(value) % 256, Math.round((value % 1) * 256)];
}

function demOf(dim: number, getElevation: (x: number, y: number) => number): DemTile {
  const elevations = new Float32Array(dim * dim);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      elevations[y * dim + x] = getElevation(x, y);
    }
  }
  return {dim, elevations};
}

/** The red and green bytes of a texture pixel. */
function slopeAt(texture: Uint8ClampedArray, size: number, column: number, row: number) {
  const index = (row * size + column) * 4;
  return [texture[index], texture[index + 1]];
}

describe('raster-dem decoding', () => {
  test('unpack vectors are those of MapLibre GL JS', () => {
    expect(getDemUnpackVector({type: 'raster-dem'})).toEqual([6553.6, 25.6, 0.1, 10000]);
    expect(getDemUnpackVector({type: 'raster-dem', encoding: 'mapbox'})).toEqual([
      6553.6, 25.6, 0.1, 10000
    ]);
    expect(getDemUnpackVector({type: 'raster-dem', encoding: 'terrarium'})).toEqual([
      256,
      1,
      1 / 256,
      32768
    ]);
    expect(
      getDemUnpackVector({type: 'raster-dem', encoding: 'custom', redFactor: 2, baseShift: 5})
    ).toEqual([2, 1, 1, 5]);
  });

  test.each([
    ['mapbox', encodeMapbox],
    ['terrarium', encodeTerrarium]
  ] as const)('decodes %s elevations', (encoding, encode) => {
    const elevations = [-432.5, 0, 1.5, 4392.25];
    const pixels = encodeTile(elevations, encode);
    const dem = decodeDemTile(pixels, 2, 2, getDemUnpackVector({encoding}));
    expect(dem.dim).toBe(2);
    for (let i = 0; i < elevations.length; i++) {
      expect(dem.elevations[i]).toBeCloseTo(elevations[i], 1);
    }
  });

  test('decodes custom factors', () => {
    const dem = decodeDemTile(new Uint8Array([10, 20, 30, 255]), 1, 1, [1, 2, 3, 4]);
    expect(dem.elevations[0]).toBe(10 + 40 + 90 - 4);
  });

  test('rejects tiles that are not square', () => {
    expect(() => decodeDemTile(new Uint8Array(4 * 2), 2, 1, [1, 1, 1, 0])).toThrow(RangeError);
  });
});

describe('hillshade slopes', () => {
  const ZOOM = 12;
  /** Meters per pixel of the test ramps. */
  const STEP = 2000;
  /** MapLibre's slope scale: (slope sum) * dim / 2^(exaggeration + 28.2562 - zoom) / 8. */
  const scale = (dim: number, zoom: number) =>
    dim / 2 ** ((zoom - 15) * 0.3 + (28.2562 - zoom)) / 8;

  test('flat ground stores 128 in red and green, with a one-pixel border', () => {
    const texture = prepareHillshadeTexture(
      demOf(4, () => 1234),
      ZOOM
    );
    expect(texture.length).toBe(6 * 6 * 4);
    for (let index = 0; index < texture.length; index += 4) {
      expect([...texture.subarray(index, index + 4)]).toEqual([128, 128, 255, 255]);
    }
  });

  test('a slope rising to the east is stored in red, scaled for the zoom', () => {
    // Steep for a tile this small: the slopes are scaled by the tile's size.
    const dem = demOf(8, x => x * STEP);
    const texture = prepareHillshadeTexture(dem, ZOOM);
    // (c + 2f + i) - (a + 2d + g), each term two steps apart.
    const sum = 8 * STEP;
    const expected = Math.round(Math.min(Math.max(sum * scale(8, ZOOM) + 128 / 255, 0), 1) * 255);
    expect(expected).toBeGreaterThan(128);
    expect(slopeAt(texture, 10, 4, 4)).toEqual([expected, 128]);
    // MapLibre exaggerates the slopes less with each zoom up to 15.
    const higher = prepareHillshadeTexture(dem, 14);
    expect(slopeAt(higher, 10, 4, 4)[0]).toBeGreaterThan(expected);
  });

  test('a slope rising to the south is stored in green', () => {
    const texture = prepareHillshadeTexture(
      demOf(8, (_x, y) => y * STEP),
      ZOOM
    );
    const [red, green] = slopeAt(texture, 10, 4, 4);
    expect(red).toBe(128);
    expect(green).toBeGreaterThan(128);
  });

  test("the border takes the neighbors' pixels, or the nearest edge pixel", () => {
    const dim = 4;
    // A ramp rising to the east across two tiles.
    const west = demOf(dim, x => x * STEP);
    const east = demOf(dim, x => (x + dim) * STEP);
    const alone = prepareHillshadeTexture(west, ZOOM);
    const joined = prepareHillshadeTexture(west, ZOOM, (dx, dy) =>
      dx === 1 && dy === 0 ? east : null
    );
    const size = dim + 2;
    // The tile's last column: alone, its east neighbor repeats the edge, which halves the slope.
    expect(slopeAt(joined, size, dim, 2)[0]).toBe(slopeAt(joined, size, 2, 2)[0]);
    expect(slopeAt(alone, size, dim, 2)[0]).toBeLessThan(slopeAt(joined, size, dim, 2)[0]);
    // The west edge has no neighbor in either.
    expect(slopeAt(joined, size, 1, 2)).toEqual(slopeAt(alone, size, 1, 2));
  });

  test('a neighbor of another size is ignored', () => {
    const dem = demOf(4, x => x * STEP);
    const other = demOf(8, () => 0);
    expect(prepareHillshadeTexture(dem, ZOOM, () => other)).toEqual(
      prepareHillshadeTexture(dem, ZOOM)
    );
  });
});

describe('hillshade paint', () => {
  const evaluate = (paint: Record<string, unknown>, zoom = 10) =>
    getHillshadeParameters(
      Object.fromEntries(
        parseProperties({id: 'hillshade', type: 'hillshade', paint}, {zoom}).map(
          entry => Object.entries(entry)[0]
        )
      )
    );

  test("the specification's defaults", () => {
    expect(evaluate({})).toEqual({
      method: 0,
      exaggeration: 0.5,
      accent: [0, 0, 0, 1],
      viewportAnchored: true,
      directions: [335],
      altitudes: [45],
      shadows: [[0, 0, 0, 1]],
      highlights: [[1, 1, 1, 1]]
    });
  });

  test('colors are premultiplied, and the method and anchor are read', () => {
    const parameters = evaluate({
      'hillshade-method': 'igor',
      'hillshade-illumination-anchor': 'map',
      'hillshade-shadow-color': 'rgba(255, 0, 0, 0.5)',
      'hillshade-accent-color': '#336699'
    });
    expect(parameters.method).toBe(2);
    expect(parameters.viewportAnchored).toBe(false);
    expect(parameters.shadows).toEqual([[0.5, 0, 0, 0.5]]);
    expect(parameters.accent.map(value => Math.round(value * 255))).toEqual([51, 102, 153, 255]);
  });

  test.each([
    ['standard', 0],
    ['combined', 1],
    ['igor', 2],
    ['multidirectional', 3],
    ['basic', 4]
  ])('hillshade-method %s', (method, uniform) => {
    expect(evaluate({'hillshade-method': method}).method).toBe(uniform);
  });

  test('zoom-dependent exaggeration is evaluated at the zoom', () => {
    const paint = {'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 15, 1]};
    expect(evaluate(paint, 10).exaggeration).toBeCloseTo(0.6);
  });

  test('light sources: as many as highlight colors, other lists repeat their last value', () => {
    const parameters = evaluate({
      'hillshade-method': 'multidirectional',
      'hillshade-illumination-direction': [270, 315, 0],
      'hillshade-illumination-altitude': [30, 45],
      'hillshade-highlight-color': ['#ffffff', '#ffffff', '#ffffff'],
      'hillshade-shadow-color': ['#000000', '#ff0000']
    });
    expect(parameters.directions).toEqual([270, 315, 0]);
    expect(parameters.altitudes).toEqual([30, 45, 45]);
    expect(parameters.shadows).toEqual([
      [0, 0, 0, 1],
      [1, 0, 0, 1],
      [1, 0, 0, 1]
    ]);
    // Directions beyond the highlight colors are not lights, as in MapLibre.
    expect(evaluate({'hillshade-illumination-direction': [270, 315, 0]}).directions).toEqual([270]);
  });

  test('a viewport-anchored light turns with the map; a map-anchored one does not', () => {
    const viewport = evaluate({'hillshade-illumination-direction': 90});
    const map = evaluate({
      'hillshade-illumination-direction': 90,
      'hillshade-illumination-anchor': 'map'
    });
    const rad = (degrees: number) => (degrees * Math.PI) / 180;
    expect(getHillshadeUniforms(viewport, 30, [1, 0]).azimuths[0]).toBeCloseTo(rad(120));
    // MapLibre wraps the bearing to [-180, 180].
    expect(getHillshadeUniforms(viewport, 270, [1, 0]).azimuths[0]).toBeCloseTo(rad(0));
    expect(getHillshadeUniforms(map, 30, [1, 0]).azimuths[0]).toBeCloseTo(rad(90));
  });

  test('uniforms hold up to four lights, colors as matrix columns', () => {
    const parameters = evaluate({
      'hillshade-method': 'multidirectional',
      'hillshade-highlight-color': ['#ff0000', '#00ff00'],
      'hillshade-illumination-altitude': [10, 20]
    });
    const uniforms = getHillshadeUniforms(parameters, 0, [47, 46]);
    expect(uniforms.lightCount).toBe(2);
    expect(uniforms.highlights.slice(0, 8)).toEqual([1, 0, 0, 1, 0, 1, 0, 1]);
    expect(uniforms.altitudes.map(value => Math.round((value * 180) / Math.PI))).toEqual([
      10, 20, 20, 20
    ]);
    expect(uniforms.latRange).toEqual([47, 46]);
  });
});

describe('hillshade layers', () => {
  const SOURCES = {
    terrain: {
      type: 'raster-dem',
      tiles: ['https://dem.example.com/{z}/{x}/{y}.png'],
      tileSize: 256,
      encoding: 'terrarium'
    },
    relief: {type: 'raster', tiles: ['https://relief.example.com/{z}/{x}/{y}.png']},
    tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}
  };
  const style = (layers: unknown[]) => ({version: 8, sources: SOURCES, layers}) as any;

  test('draws in style order between vector layers', () => {
    const layers = [
      {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
      {id: 'hills', type: 'hillshade', source: 'terrain'},
      {id: 'roads', type: 'line', source: 'tiles', 'source-layer': 'road'}
    ];
    const runs = getStyleLayerRuns(layers as any, style(layers));
    expect(runs.map(run => [run.type, run.id])).toEqual([
      ['vector', 'tiles'],
      ['hillshade', 'hills'],
      ['vector', 'tiles-"roads"']
    ]);
    const deckLayers = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 10,
      styleDefinition: style(layers)
    });
    const hillshade = deckLayers[1] as any;
    expect(hillshade).toBeInstanceOf(HillshadeTileLayer);
    expect(hillshade.id).toBe('test-hills');
    expect(hillshade.props.tileSize).toBe(256);
    expect(hillshade.props.hillshadeParameters.exaggeration).toBe(0.5);
  });

  test('a hillshade over a source that is not raster-dem draws nothing', () => {
    const layers = [{id: 'hills', type: 'hillshade', source: 'relief'}];
    expect(getStyleLayerRuns(layers as any, style(layers))).toEqual([]);
  });

  test('draws nothing at hillshade-exaggeration 0, as MapLibre', () => {
    const layers = [
      {id: 'hills', type: 'hillshade', source: 'terrain', paint: {'hillshade-exaggeration': 0}}
    ];
    const [hillshade] = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 10,
      styleDefinition: style(layers)
    }) as any[];
    expect(hillshade.props.visible).toBe(false);
  });

  test('resampling: nearest filters the slopes with the nearest texel', () => {
    const layers = [
      {id: 'hills', type: 'hillshade', source: 'terrain', paint: {resampling: 'nearest'}}
    ];
    const [hillshade] = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 10,
      styleDefinition: style(layers)
    }) as any[];
    expect(hillshade.props.hillshadeSubLayerProps.textureParameters).toEqual({
      minFilter: 'nearest',
      magFilter: 'nearest',
      mipmapFilter: 'none'
    });
  });
});

describe('hillshade layers share the decoded tiles of their source', () => {
  // Fetch and decode counts against real tiles, and through a switch to a globe, are in
  // `hillshade-shared-tiles.browser.spec.ts`.
  const terrain = {
    type: 'raster-dem',
    tiles: ['https://dem.example.com/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxzoom: 0,
    encoding: 'terrarium'
  };
  const style: any = {
    version: 8,
    sources: {terrain},
    layers: [
      {id: 'shadow', type: 'hillshade', source: 'terrain'},
      {id: 'highlight', type: 'hillshade', source: 'terrain'}
    ]
  };
  const viewport = new WebMercatorViewport({width: 128, height: 128, zoom: 0});

  function createBasemap(props: Record<string, unknown> = {}) {
    const basemap = new BasemapLayer({id: 'test', style, ...props});
    basemap.initializeState();
    basemap.state.resolvedStyle = style;
    basemap.context = {viewport} as any;
    return basemap;
  }

  test('both layers of a basemap draw from one tileset, kept through rerenders and a globe', () => {
    const basemap = createBasemap();
    const [shadow, highlight]: any[] = basemap.renderLayers();
    expect(shadow).toBeInstanceOf(HillshadeTileLayer);
    expect(shadow.props.data).toBeInstanceOf(SharedTileset2D);
    expect(highlight.props.data).toBe(shadow.props.data);
    expect(basemap.state.tilesets.get(terrain as any)).toBe(shadow.props.data);
    expect((basemap.renderLayers()[0] as any).props.data).toBe(shadow.props.data);

    const globe = basemap.clone({mode: 'globe'});
    globe.state = basemap.state;
    globe.context = basemap.context;
    const finalize = vi.spyOn(shadow.props.data, 'finalize');
    const globeLayers = globe.renderLayers() as any[];
    expect(globeLayers.find(layer => layer.id === 'test-shadow').props.data).toBe(
      shadow.props.data
    );
    expect(finalize).not.toHaveBeenCalled();
    globe.finalizeState();
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test("a basemap replaces the tileset when the source's encoding changes", () => {
    const basemap = createBasemap();
    const tileset = (basemap.renderLayers()[0] as any).props.data;
    const finalize = vi.spyOn(tileset, 'finalize');
    (terrain as any).encoding = 'mapbox';
    try {
      expect((basemap.renderLayers()[0] as any).props.data).not.toBe(tileset);
      expect(finalize).toHaveBeenCalledTimes(1);
    } finally {
      terrain.encoding = 'terrarium';
      basemap.finalizeState();
    }
  });

  test('direct helper callers load each tile once and release the tileset with the last layer', async () => {
    const [shadow, highlight]: any[] = getBasemapLayers({styleDefinition: style});
    const tileset = shadow.props.data;
    expect(tileset).toBeInstanceOf(SharedTileset2D);
    expect(highlight.props.data).toBe(tileset);
    const load = vi.fn(async () => ({dim: 1, elevations: new Float32Array(1)}));
    tileset.setOptions({getTileData: load});
    const finalize = vi.spyOn(tileset, 'finalize');
    for (const layer of [shadow, highlight]) {
      layer.context = {viewport} as any;
      layer.initializeState();
      layer.setState = ((state: any) => Object.assign(layer.state, state)) as any;
      layer.updateState({changeFlags: {dataChanged: true, propsOrDataChanged: true}} as any);
    }
    await vi.waitFor(() => expect(shadow.isLoaded && highlight.isLoaded).toBe(true));
    expect(load).toHaveBeenCalledTimes(1);
    shadow.finalizeState();
    expect(finalize).not.toHaveBeenCalled();
    highlight.finalizeState();
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test('direct helper callers keep the tiles across calls with their own createDemTileset', () => {
    const tileset = createDemTileset(terrain as any);
    expect(tileset).toBeInstanceOf(SharedTileset2D);
    const finalize = vi.spyOn(tileset, 'finalize');
    const tilesets = new Map([[terrain as any, tileset]]);
    for (let call = 0; call < 2; call++) {
      const layers: any[] = getBasemapLayers({styleDefinition: style, tilesets});
      expect(layers.map(layer => layer.props.data)).toEqual([tileset, tileset]);
      for (const layer of layers) {
        layer.context = {viewport} as any;
        layer.initializeState();
        layer.finalizeState();
      }
    }
    // The caller owns it.
    expect(finalize).not.toHaveBeenCalled();
    tileset.finalize();
  });

  test("a tile's load prepares its loaded neighbors' slopes again in every layer", async () => {
    const [shadow, highlight]: any[] = getBasemapLayers({
      styleDefinition: {...style, sources: {terrain: {...terrain, maxzoom: 1}}}
    });
    const tileset = shadow.props.data;
    tileset.setOptions({getTileData: async () => ({dim: 1, elevations: new Float32Array(1)})});
    const zoomed = new WebMercatorViewport({width: 512, height: 512, zoom: 1});
    for (const layer of [shadow, highlight]) {
      layer.context = {viewport: zoomed} as any;
      layer.initializeState();
      layer.setState = ((state: any) => Object.assign(layer.state, state)) as any;
      layer.setNeedsUpdate = () => {};
      layer.updateState({changeFlags: {dataChanged: true, propsOrDataChanged: true}} as any);
    }
    await vi.waitFor(() => expect(shadow.isLoaded && highlight.isLoaded).toBe(true));
    const [first, second] = tileset.tiles;
    expect(tileset.tiles.length).toBe(4);
    for (const layer of [shadow, highlight]) {
      layer.state.tileLayers.set(first.id, []);
      layer.state.tileLayers.set(second.id, []);
    }
    // The shared tileset reports a load to each layer drawn from it.
    for (const layer of [shadow, highlight]) {
      layer._onTileLoad(second);
      expect(layer.state.tileLayers.has(first.id)).toBe(false);
    }
    shadow.finalizeState();
    highlight.finalizeState();
  });
});
