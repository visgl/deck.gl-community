import {describe, expect, test, vi} from 'vitest';
import Point from '@mapbox/point-geometry';
import {mat4} from 'gl-matrix';
import {WebMercatorViewport, _GlobeViewport as GlobeViewport} from '@deck.gl/core';
// MapLibre GL JS's own functions, from the source its package ships, to compare against.
import {placeGlyphAlongLine} from '../node_modules/maplibre-gl/src/symbol/projection.ts';
import {PathInterpolator} from '../node_modules/maplibre-gl/src/symbol/path_interpolator.ts';
import {LabelCharactersLayer} from '../src/label-text-layer';
import {GridIndex} from '../src/grid-index';
import {
  PLACEMENT_VIEWPORT_PADDING,
  TEXT_VISIBLE,
  placeSymbol,
  type PlacementSymbol
} from '../src/label-placement';
import {getPathCircles, needsFlip, placeLineGlyphs, type LabelLine} from '../src/line-glyphs';
import {LINE_GLYPH_STATS, MVTLabelLayer} from '../src/mvt-label-layer';
import {getTextLayerFontWeight} from '../src/text-font';
import {FALLBACK_CHARACTER_WIDTH, forgetCharacterWidths} from '../src/text-layout';

/** A bending line, in pixels at the placement zoom, drawn left to right and turning down. */
const BEND = [0, 0, 40, 4, 70, 14, 95, 32, 112, 55, 120, 80];

/** The same line drawn right to left. */
const BEND_REVERSED = Array.from({length: BEND.length / 2}, (_, i) => [
  BEND[BEND.length - 2 - i * 2],
  BEND[BEND.length - 1 - i * 2]
]).flat();

/** Glyph advance centres of a 10-glyph label 60 px long, from its anchor, as MapLibre's shaping. */
const OFFSETS = [-27, -21, -15, -9, -3, 3, 9, 15, 21, 27];

/**
 * MapLibre's placement of each glyph, in its label plane: the map plane, here the line's pixels
 * scaled by `scale` (the pitched label plane matrix of a flat, unturned map), anchored on `line`.
 */
function mapLibreGlyphs(
  line: LabelLine,
  offsets: number[],
  scale: number,
  flip: boolean,
  lineOffsetX = 0,
  lineOffsetY = 0
): (number[] | null)[] {
  const {points, segment, t} = line;
  const anchor = new Point(
    points[segment * 2] + (points[segment * 2 + 2] - points[segment * 2]) * t,
    points[segment * 2 + 1] + (points[segment * 2 + 3] - points[segment * 2 + 1]) * t
  );
  const count = points.length / 2;
  const matrix = mat4.fromScaling(mat4.create(), [scale, scale, 1]);
  const projectionContext: any = {
    getElevation: undefined,
    pitchedLabelPlaneMatrix: matrix,
    lineVertexArray: {getx: (i: number) => points[i * 2], gety: (i: number) => points[i * 2 + 1]},
    pitchWithMap: true,
    projectionCache: {
      projections: {},
      offsets: {},
      cachedAnchorPoint: undefined,
      anyProjectionOccluded: false
    },
    transform: null,
    tileAnchorPoint: anchor,
    unwrappedTileID: null,
    width: 512,
    height: 512,
    translation: [0, 0]
  };
  return offsets.map(offset => {
    const glyph = placeGlyphAlongLine(
      offset,
      lineOffsetX,
      lineOffsetY,
      flip,
      segment,
      0,
      count,
      projectionContext,
      true
    );
    // Relative to the anchor, and in deck.gl's counter-clockwise degrees.
    return glyph
      ? [
          glyph.point.x - anchor.x * scale,
          glyph.point.y - anchor.y * scale,
          (-glyph.angle * 180) / Math.PI
        ]
      : null;
  });
}

function expectSameGlyphs(
  line: LabelLine,
  scale: number,
  flip: boolean,
  lineOffsetX = 0,
  lineOffsetY = 0
): void {
  const ours = placeLineGlyphs(line, {offsets: OFFSETS, scale, flip, lineOffsetX, lineOffsetY});
  const theirs = mapLibreGlyphs(line, OFFSETS, scale, flip, lineOffsetX, lineOffsetY);
  expect(ours).not.toBeNull();
  theirs.forEach((glyph, i) => {
    expect(glyph).not.toBeNull();
    const [x, y, angle] = glyph!;
    expect(ours!.glyphs[i * 3]).toBeCloseTo(x, 3);
    expect(ours!.glyphs[i * 3 + 1]).toBeCloseTo(y, 3);
    // Angles may differ by whole turns.
    const delta = ((((ours!.glyphs[i * 3 + 2] - angle) % 360) + 540) % 360) - 180;
    expect(delta).toBeCloseTo(0, 3);
  });
}

describe('placeLineGlyphs, as MapLibre GL JS places glyphs along a line', () => {
  // The anchor partway along the third segment.
  const line = {points: BEND, segment: 2, t: 0.4};

  test('places each glyph on the bending line, turned to the segment it lands on', () => {
    expectSameGlyphs(line, 1, false);
    // The glyphs follow the bend: the last one is turned further than the first.
    const {glyphs} = placeLineGlyphs(line, {offsets: OFFSETS, scale: 1, flip: false})!;
    expect(glyphs[2]).toBeGreaterThan(-20);
    expect(glyphs[29]).toBeLessThan(-40);
  });

  test('walks the line scaled to the current zoom, with the text at its size', () => {
    expectSameGlyphs(line, 1.6, false);
    expectSameGlyphs(line, 0.8, false);
  });

  test('walks the other way when the label is turned to read upright', () => {
    expectSameGlyphs({points: BEND_REVERSED, segment: 2, t: 0.6}, 1, true);
    expectSameGlyphs(line, 1.3, true);
  });

  test('places glyphs along the line moved by text-offset', () => {
    expectSameGlyphs(line, 1, false, 4, -6);
    expectSameGlyphs(line, 1.2, true, -3, 5);
    // Moved across the bend, near a vertex.
    expectSameGlyphs({points: BEND, segment: 3, t: 0.05}, 1, false, 0, 8);
  });

  test('anchored on a vertex', () => {
    expectSameGlyphs({points: BEND, segment: 2, t: 0}, 1, false);
    expectSameGlyphs({points: BEND, segment: 2, t: 0}, 1, false, 0, -5);
  });

  test('places nothing when a glyph falls off the line, as MapLibre then hides the label', () => {
    const nearStart = {points: BEND, segment: 0, t: 0.3};
    expect(mapLibreGlyphs(nearStart, OFFSETS, 1, false)[0]).toBeNull();
    expect(placeLineGlyphs(nearStart, {offsets: OFFSETS, scale: 1, flip: false})).toBeNull();
    // Zoomed in, the line is longer under the same text: it fits.
    expect(placeLineGlyphs(nearStart, {offsets: OFFSETS, scale: 2.5, flip: false})).not.toBeNull();
  });

  test('gives the collision path from the first glyph to the last along the line', () => {
    const {path, glyphs} = placeLineGlyphs(line, {offsets: OFFSETS, scale: 1, flip: false})!;
    // From the first glyph, through the line's vertices under the label, to the last glyph.
    expect(path.slice(0, 2)).toEqual([glyphs[0], glyphs[1]].map(v => expect.closeTo(v, 4)));
    expect(path.slice(-2)).toEqual([glyphs[27], glyphs[28]].map(v => expect.closeTo(v, 4)));
    // Vertex 2 (70, 14) and vertex 3 (95, 32), from the anchor at (80, 21.2), in order.
    expect(path).toHaveLength(8);
    expect(path.slice(2, 6)).toEqual([-10, -7.2, 15, 10.8].map(v => expect.closeTo(v, 4)));
  });

  test('flips a label that would read right to left on screen', () => {
    const glyphs = placeLineGlyphs(line, {offsets: OFFSETS, scale: 1, flip: false})!;
    expect(needsFlip(glyphs, 0)).toBe(false);
    expect(needsFlip(glyphs, 180)).toBe(true);
    const reversed = placeLineGlyphs(
      {points: BEND_REVERSED, segment: 2, t: 0.6},
      {offsets: OFFSETS, scale: 1, flip: false}
    )!;
    expect(needsFlip(reversed, 0)).toBe(true);
    // The line runs down and to the right, ~30 degrees below east: turned 90 degrees
    // counter-clockwise, it runs up and to the right on screen, and still reads left to right.
    expect(needsFlip(glyphs, 90)).toBe(false);
    expect(needsFlip(glyphs, -90)).toBe(true);
  });
});

describe('getPathCircles, as MapLibre GL JS lays collision circles along a path', () => {
  test('insets the ends by a quarter radius and spaces circles at most 2.5 radii apart', () => {
    const path = [0, 0, 30, 10, 60, 40, 70, 80];
    for (const radius of [3, 7, 40, 200]) {
      const circles = getPathCircles(path, radius);
      const points = Array.from(
        {length: path.length / 2},
        (_, i) => new Point(path[i * 2], path[i * 2 + 1])
      );
      const interpolator = new PathInterpolator(points, radius * 0.25);
      const count =
        interpolator.length <= 0.5 * radius
          ? 1
          : Math.ceil(interpolator.paddedLength / (radius * 2.5)) + 1;
      expect(circles).toHaveLength(count * 3);
      for (let i = 0; i < count; i++) {
        const point = interpolator.lerp(i / Math.max(count - 1, 1));
        expect(circles[i * 3]).toBeCloseTo(point.x, 9);
        expect(circles[i * 3 + 1]).toBeCloseTo(point.y, 9);
        expect(circles[i * 3 + 2]).toBe(radius);
      }
    }
  });
});

test('getPathCircles gives a label without height one circle, at the middle of its path', () => {
  expect(getPathCircles([0, 0, 20, 0], 0)).toEqual([10, 0, 0]);
});

describe('MVTLabelLayer glyphs along lines', () => {
  // A bending street in tile coordinates of a 512 px tile, drawn west to east, then east to west.
  const EAST = [
    [0.1, 0.4],
    [0.3, 0.42],
    [0.45, 0.47],
    [0.6, 0.58],
    [0.7, 0.72],
    [0.75, 0.9]
  ];
  const WEST = [...EAST].reverse();

  function lineLayer(layout: Record<string, unknown> = {}) {
    return new MVTLabelLayer({
      id: 'line-labels',
      config: {labels: true},
      zoom: 14,
      tileZoom: 14,
      tileSize: 512,
      styleLayer: {
        layout: {'text-field': '{name}', 'symbol-placement': 'line', 'text-size': 10, ...layout}
      }
    } as any);
  }

  function rowsOf(layer: MVTLabelLayer, line: number[][], name = 'Quai de Conti'): any[] {
    const feature = {geometry: {type: 'LineString', coordinates: line}, properties: {name}};
    const rows = layer.getLabelData([feature as any], false) as any[];
    layer.state = {...layer.state, labelData: rows};
    layer.context = {viewport: {zoom: 14, bearing: 0}} as any;
    return rows;
  }

  /** MapLibre's glyphs for `row`, its label `text` drawn 10 px high at `zoom`, unturned or not. */
  function expected(row: any, text: string, zoom: number, flip: boolean) {
    const width = FALLBACK_CHARACTER_WIDTH * 10;
    const count = Array.from(text).length;
    const offsets = Array.from({length: count}, (_, i) => (i + 0.5 - count / 2) * width);
    const {points, segment, t} = row.line;
    return mapLibreGlyphs({points, segment, t}, offsets, 2 ** (zoom - 14), flip);
  }

  test('places every glyph of a row as MapLibre does, at the zoom of the view', () => {
    const layer = lineLayer();
    const rows = rowsOf(layer, EAST);
    expect(rows.length).toBeGreaterThan(0);
    for (const zoom of [14, 14.5]) {
      for (const row of rows) {
        const {glyphs} = layer.getLineGlyphs(row, {zoom}, 0, 'style')!;
        expected(row, 'Quai de Conti', zoom, false).forEach((glyph, i) => {
          expect(glyph).not.toBeNull();
          expect(glyphs[i * 4]).toBeCloseTo(glyph![0], 3);
          expect(glyphs[i * 4 + 1]).toBeCloseTo(glyph![1], 3);
          expect(glyphs[i * 4 + 2]).toBeCloseTo(glyph![2], 3);
          expect(glyphs[i * 4 + 3]).toBe(1);
        });
      }
    }
  });

  test('turns a westward label around to read upright, as MapLibre, unless keep-upright is off', () => {
    const layer = lineLayer();
    const [row] = rowsOf(layer, WEST);
    const {glyphs} = layer.getLineGlyphs(row, {zoom: 14}, 0, 'style')!;
    expected(row, 'Quai de Conti', 14, true).forEach((glyph, i) => {
      expect(glyphs[i * 4]).toBeCloseTo(glyph![0], 3);
      expect(glyphs[i * 4 + 1]).toBeCloseTo(glyph![1], 3);
    });
    // Read left to right: the first glyph is left of the last.
    expect(glyphs[0]).toBeLessThan(glyphs[glyphs.length - 4]);
    // At bearing 180 the eastward label reads right to left, and turns.
    const east = lineLayer();
    const [eastRow] = rowsOf(east, EAST);
    const turned = east.getLineGlyphs(eastRow, {zoom: 14}, 180, 'style')!.glyphs;
    expect(turned[0]).toBeGreaterThan(turned[turned.length - 4]);
    const fixed = lineLayer({'text-keep-upright': false});
    const [fixedRow] = rowsOf(fixed, WEST);
    const unturned = fixed.getLineGlyphs(fixedRow, {zoom: 14}, 0, 'style')!.glyphs;
    expect(unturned[0]).toBeGreaterThan(unturned[unturned.length - 4]);
    // `text-keep-upright` is part of the style the glyphs are cached for.
    expect(fixed.getLineGlyphStyleKey()).not.toBe(layer.getLineGlyphStyleKey());
  });

  test('hides a label whose glyphs do not all fit on the line at the zoom of the view', () => {
    const layer = lineLayer();
    const [row] = rowsOf(layer, EAST);
    // Zoomed out, the line is shorter under the same text.
    const {glyphs, path} = layer.getLineGlyphs(row, {zoom: 12}, 0, 'style')!;
    expect(path).toBeNull();
    expect(Array.from({length: glyphs.length / 4}, (_, i) => glyphs[i * 4 + 3])).toEqual(
      Array(glyphs.length / 4).fill(-1)
    );
  });

  test('hides a label that must turn but does not fit turned, and keeps its unturned circles', () => {
    // Anchored left, the text runs from its anchor along the line; turned, it runs back from it.
    const layer = lineLayer({'text-anchor': 'left'});
    const [row] = rowsOf(layer, WEST);
    // Anchored near the start of a westward line: it fits along the line, not back from it.
    const nearStart = {...row, line: {...row.line, segment: 0, t: 0.1}};
    const width = FALLBACK_CHARACTER_WIDTH * 10;
    const offsets = Array.from({length: 'Quai de Conti'.length}, (_, i) => (i + 0.5) * width);
    expect(mapLibreGlyphs(nearStart.line, offsets, 1, false)).not.toContain(null);
    expect(mapLibreGlyphs(nearStart.line, offsets, 1, true)).toContain(null);
    // At bearing 180 it reads left to right unturned, and is drawn.
    const unturned = layer.getLineGlyphs(nearStart, {zoom: 14}, 180, 'style')!;
    expect(unturned.path).not.toBeNull();
    expect(unturned.glyphs[3]).toBe(1);
    // At bearing 0 it must turn, and cannot: MapLibre hides its glyphs when drawing, but places it
    // by its circles along the unturned glyphs, so it still takes their room.
    const {glyphs, path} = layer.getLineGlyphs(nearStart, {zoom: 14}, 0, 'style')!;
    expect(Array.from({length: glyphs.length / 4}, (_, i) => glyphs[i * 4 + 3])).toEqual(
      Array(glyphs.length / 4).fill(-1)
    );
    expect(path).toEqual(unturned.path);

    // Placed, it collides by those circles: those of the same label drawn unturned, without
    // `text-keep-upright`, in the same view.
    const place = (labels: MVTLabelLayer) => {
      const viewport = new WebMercatorViewport({
        width: 400,
        height: 200,
        longitude: 0,
        latitude: 0,
        zoom: 14
      });
      labels.state = {...labels.state, labelData: [{...nearStart}]};
      labels.context = {viewport, device: {type: 'webgl'}} as any;
      (labels as any).internalState = {subLayers: []};
      (labels as any).project = () => [200, 100];
      const out: PlacementSymbol[] = [];
      const rules = labels.getPlacementSymbols(viewport, 0, out)!;
      const padded = 2 * PLACEMENT_VIEWPORT_PADDING;
      const grid = new GridIndex(400 + padded, 200 + padded, 25);
      return {circles: out[0].text!.circles!, visible: placeSymbol(grid, out[0], rules), grid};
    };
    const hidden = place(layer);
    const drawn = place(lineLayer({'text-anchor': 'left', 'text-keep-upright': false}));
    expect(hidden.circles.length).toBeGreaterThan(0);
    expect(hidden.circles).toEqual(drawn.circles);
    expect(hidden.visible & TEXT_VISIBLE).toBe(TEXT_VISIBLE);
    const [x, y, r] = hidden.circles;
    expect(hidden.grid.hitTestCircle(x, y, r)).toBe(true);
  });

  test('draws multi-line text and rows not along a line straight', () => {
    const layer = lineLayer();
    const [row] = rowsOf(layer, EAST);
    expect(layer.getLineGlyphs({position: [0, 0]} as any, {zoom: 14}, 0, 'style')).toBeNull();
    const multiLine = lineLayer({'text-field': 'Quai\nde Conti'});
    const [multiRow] = rowsOf(multiLine, EAST);
    expect(multiRow && multiLine.getLineGlyphs(multiRow, {zoom: 14}, 0, 'style')).toBeFalsy();
    expect(row).toBeTruthy();
  });

  test('places glyphs once per zoom step and style, whatever the bearing', () => {
    const layer = lineLayer();
    const [row] = rowsOf(layer, EAST);
    const first = layer.getLineGlyphs(row, {zoom: 14.2}, 0, 'style');
    expect(layer.getLineGlyphs(row, {zoom: 14.201}, 0, 'style')).toBe(first);
    expect(layer.getLineGlyphs(row, {zoom: 14.2}, 30, 'style')).toBe(first);
    expect(layer.getLineGlyphs(row, {zoom: 14.21}, 0, 'style')).not.toBe(first);
    expect(layer.getLineGlyphs(row, {zoom: 14.21}, 0, 'other')).not.toBe(
      layer.getLineGlyphs(row, {zoom: 14.21}, 0, 'style')
    );
  });

  test('keeps the glyphs of each view: views at different zooms do not place them in turn', () => {
    const layer = lineLayer();
    const [row] = rowsOf(layer, EAST);
    const main = {id: 'main', zoom: 14};
    const mini = {id: 'mini', zoom: 10};
    const first = layer.getLineGlyphs(row, main, 0, 'style');
    const other = layer.getLineGlyphs(row, mini, 0, 'style');
    expect(other).not.toBe(first);
    const rows = LINE_GLYPH_STATS.rows;
    for (let frame = 0; frame < 3; frame++) {
      expect(layer.getLineGlyphs(row, main, 0, 'style')).toBe(first);
      expect(layer.getLineGlyphs(row, mini, 0, 'style')).toBe(other);
    }
    expect(LINE_GLYPH_STATS.rows).toBe(rows);
  });

  test('places glyphs again once the label font has loaded with other advances', () => {
    // A canvas whose font measures each character `width` pixels at 64px: half an em at first.
    let width = 32;
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {font: '', measureText: () => ({width})};
        }
      }
    );
    try {
      const layer = lineLayer({'text-font': ['Font Loading In This Test']});
      const [row] = rowsOf(layer, EAST);
      const font = layer.getFont();
      const weight = getTextLayerFontWeight(font);
      const key = layer.getLineGlyphStyleKey();
      const first = layer.getLineGlyphs(row, {zoom: 14}, 0, key)!.glyphs[0];
      // Another font loads, or this one loads with the advances already measured: the same glyphs.
      forgetCharacterWidths(weight, 'Another Font');
      forgetCharacterWidths(weight, font.fontFamily);
      expect(layer.getLineGlyphStyleKey()).toBe(key);
      // The font loads with wider advances: the glyphs are placed again, further apart.
      width = 36;
      forgetCharacterWidths(weight, font.fontFamily);
      const next = layer.getLineGlyphStyleKey();
      expect(next).not.toBe(key);
      const placed = layer.getLineGlyphs(row, {zoom: 14}, 0, next)!.glyphs[0];
      expect(Math.abs(placed)).toBeGreaterThan(Math.abs(first) + 1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('draws the glyphs placement placed after the font loads, without the layer updating', () => {
    let width = 32;
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {font: '', measureText: () => ({width})};
        }
      }
    );
    try {
      const layer = lineLayer({'text-font': ['Font Loaded For Another Layer']});
      const [row] = rowsOf(layer, EAST);
      (layer.context as any).device = {type: 'webgl'};
      // The text sublayers' props, handed down once.
      const {getLineGlyphs, getLineGlyphKey} = layer.getLineGlyphProps();
      const viewport = {zoom: 14, bearing: 0};
      const drawn = getLineGlyphs!(row, viewport);
      expect(layer.getLineGlyphs(row, viewport, 0, layer.getLineGlyphStyleKey())!.glyphs).toBe(
        drawn
      );
      const key = getLineGlyphKey!(viewport);
      // Another layer finds the font loaded with other advances, and forgets them; this layer
      // does not update, so its sublayers keep the same props.
      width = 36;
      const font = layer.getFont();
      forgetCharacterWidths(getTextLayerFontWeight(font), font.fontFamily);
      // Placement places the glyphs again; the sublayers see a new key, and draw those glyphs.
      const placed = layer.getLineGlyphs(row, viewport, 0, layer.getLineGlyphStyleKey())!.glyphs;
      expect(placed).not.toBe(drawn);
      expect(getLineGlyphKey!(viewport)).not.toBe(key);
      expect(getLineGlyphs!(row, viewport)).toBe(placed);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('curves text only on a flat map, on WebGL, for text turned to the line', () => {
    const layer = lineLayer();
    rowsOf(layer, EAST);
    expect(layer.curvesLineText({zoom: 14})).toBe(true);
    expect(layer.curvesLineText({zoom: 14, projectionMode: 2})).toBe(false);
    // deck.gl v10 sets `resolution` to 0 on a globe too.
    const camera = {width: 256, height: 256, longitude: 0, latitude: 0, zoom: 2};
    const globe = new GlobeViewport(camera);
    const globeAtResolution0 = new GlobeViewport({...camera, resolution: 0});
    expect(layer.curvesLineText(globe)).toBe(false);
    expect(layer.curvesLineText(globeAtResolution0)).toBe(false);
    (layer.context as any).device = {type: 'webgpu'};
    expect(layer.curvesLineText({zoom: 14})).toBe(false);
    const viewport = lineLayer({'text-rotation-alignment': 'viewport'});
    rowsOf(viewport, EAST);
    expect(viewport.curvesLineText({zoom: 14})).toBe(false);
    const point = lineLayer({'symbol-placement': 'point'});
    expect(point.curvesLineText({zoom: 14})).toBe(false);
  });
});

describe('LabelCharactersLayer glyphs along lines', () => {
  function charactersLayer(props: Record<string, unknown>): any {
    const layer: any = new LabelCharactersLayer({id: 'characters', ...props} as any);
    layer.context = {viewport: {zoom: 14}, device: {type: 'webgl'}, defaultShaderModules: []};
    layer.state = {};
    return layer;
  }

  /** An attribute over rows of `counts` characters each, `size` values per character. */
  function attribute(counts: number[], size: number): any {
    const startIndices = [0];
    for (const count of counts) {
      startIndices.push(startIndices.at(-1)! + count);
    }
    const numInstances = startIndices.at(-1)!;
    return {
      size,
      numInstances,
      value: new Float32Array(numInstances * size).fill(9),
      getVertexOffset: (row: number) =>
        (row < startIndices.length ? startIndices[row] : numInstances) * size
    };
  }

  test("writes each row's glyphs at its characters, leaving rows without text alone", () => {
    const rows = [{text: 'ab'}, {text: ''}, {text: 'cde'}, {text: 'f'}];
    const glyphs = (row: any) =>
      row.text === 'ab'
        ? new Float32Array([1, 2, 3, 1, 4, 5, 6, 1])
        : row.text === 'f'
          ? null
          : new Float32Array(Array.from({length: 12}, (_, i) => 10 + i));
    const layer = charactersLayer({
      data: rows,
      getIcon: (row: any) => row.text,
      getLineGlyphs: (row: any, viewport: any) => (viewport.zoom === 14 ? glyphs(row) : null)
    });
    const target = attribute([2, 0, 3, 1], 4);
    layer.calculateInstanceLineGlyphs(target, {startRow: 0, endRow: Infinity});
    expect(Array.from(target.value)).toEqual([
      ...[1, 2, 3, 1, 4, 5, 6, 1],
      ...Array.from({length: 12}, (_, i) => 10 + i),
      // A row drawn straight: mode 0.
      ...[0, 0, 0, 0]
    ]);
  });

  test('gives each character its advance centre, about which it turns on the line', () => {
    const layer = charactersLayer({
      data: [{text: 'ab'}],
      getIcon: (row: any) => row.text,
      getIconOffsets: () => [10, 0, 30, 0],
      getLineGlyphs: () => new Float32Array(8),
      iconMapping: {a: {anchorX: 8, advance: 12}, b: {anchorX: 4, advance: 20}}
    });
    const target = attribute([2], 1);
    layer.calculateInstanceGlyphCentres(target, {startRow: 0, endRow: Infinity});
    expect(Array.from(target.value)).toEqual([10 - 8 + 6, 30 - 4 + 10]);
  });

  test('is a constant without glyphs along lines', () => {
    const layer = charactersLayer({data: [{text: 'ab'}], getIcon: (row: any) => row.text});
    const target = attribute([2], 4);
    layer.calculateInstanceLineGlyphs(target, {startRow: 0, endRow: Infinity});
    expect(target.constant).toBe(true);
  });

  test('turns curved glyphs about their centres in the vertex shader, on WebGL only', () => {
    const {vs} = charactersLayer({}).getShaders();
    expect(vs).toContain('in vec4 instanceLineGlyphs;');
    expect(vs).toContain('pixelOffset.x -= instanceGlyphCentres;');
    expect(vs).toContain('rotate_by_angle(pixelOffset, instanceLineGlyphs.z)');
    expect(vs).toContain('if (instanceLineGlyphs.w < -0.5)');
    const webgpu = new (LabelCharactersLayer as any)({id: 'characters'});
    webgpu.context = {device: {type: 'webgpu'}, defaultShaderModules: []};
    expect(webgpu.getShaders().vs).not.toContain('instanceLineGlyphs');
  });
});
