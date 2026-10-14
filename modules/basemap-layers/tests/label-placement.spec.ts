// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, test, vi} from 'vitest';
import {WebMercatorViewport} from '@deck.gl/core';
import {GridIndex, allowsOverlap} from '../src/grid-index.ts';
import {
  ICON_VISIBLE,
  LabelPlacement,
  PLACEMENT_VIEWPORT_PADDING,
  TEXT_VISIBLE,
  placeSymbol,
  type PlacementLayer,
  type PlacementSymbol,
  type SymbolPlacementRules
} from '../src/label-placement.ts';
import {MVTLabelLayer} from '../src/mvt-label-layer.ts';
import {getSpriteIconMapping} from '../src/sprite.ts';
import {getTextLayerFontWeight} from '../src/text-font.ts';
import {
  forgetCharacterWidths,
  getCharacterWidthMeasurer,
  MAX_CACHED_FONTS
} from '../src/text-layout.ts';

describe('GridIndex', () => {
  test('a box hits a box it overlaps or touches, not one beside it', () => {
    const grid = new GridIndex(200, 200, 25);
    grid.insert(10, 10, 40, 30);
    expect(grid.hitTest(30, 20, 60, 50)).toBe(true);
    expect(grid.hitTest(40, 30, 60, 50)).toBe(true);
    expect(grid.hitTest(41, 10, 60, 30)).toBe(false);
    expect(grid.hitTest(100, 100, 150, 150)).toBe(false);
  });

  test('circles hit boxes and circles by their round shape', () => {
    const grid = new GridIndex(200, 200, 25);
    grid.insertCircle(50, 50, 10);
    // The box's corner is 7.07 pixels from the centre on each axis: 10 pixels away.
    expect(grid.hitTest(57.1, 57.1, 80, 80)).toBe(false);
    expect(grid.hitTest(55, 55, 80, 80)).toBe(true);
    expect(grid.hitTestCircle(70, 50, 9)).toBe(false);
    expect(grid.hitTestCircle(70, 50, 11)).toBe(true);
    grid.insert(100, 100, 120, 120);
    expect(grid.hitTestCircle(125, 110, 4)).toBe(false);
    expect(grid.hitTestCircle(125, 110, 6)).toBe(true);
  });

  test('a shape across many cells is found, and only within the grid', () => {
    const grid = new GridIndex(200, 200, 25);
    grid.insert(0, 0, 199, 10);
    expect(grid.hitTest(180, 0, 190, 5)).toBe(true);
    expect(grid.isInside(-30, -30, -1, -1)).toBe(false);
    expect(grid.isInside(-30, -30, 1, 1)).toBe(true);
    expect(grid.hitTest(-50, -50, -10, -10)).toBe(false);
  });

  test('overlap modes, as MapLibre: always overlaps anything, cooperative overlaps all but never', () => {
    expect(allowsOverlap('always', 'never')).toBe(true);
    expect(allowsOverlap('never', 'always')).toBe(false);
    expect(allowsOverlap('cooperative', 'cooperative')).toBe(true);
    expect(allowsOverlap('cooperative', 'always')).toBe(true);
    expect(allowsOverlap('cooperative', 'never')).toBe(false);
    const grid = new GridIndex(100, 100, 25);
    grid.insert(0, 0, 50, 50, 'cooperative');
    expect(grid.hitTest(10, 10, 20, 20, 'cooperative')).toBe(false);
    expect(grid.hitTest(10, 10, 20, 20, 'never')).toBe(true);
  });
});

const RULES: SymbolPlacementRules = {
  textOverlap: 'never',
  iconOverlap: 'never',
  textIgnorePlacement: false,
  iconIgnorePlacement: false,
  textOptional: false,
  iconOptional: false,
  hasTextData: true,
  hasIconData: true
};

/** A symbol whose text box is at `text` and icon box at `icon` (null for none). */
function symbol(text: number[] | null, icon: number[] | null, slot = 0): PlacementSymbol {
  return {slot, text: text && {box: text}, icon: icon && {box: icon}};
}

/** A grid with one placed box at 0..50, 0..50, and the visibility of `placed` after it. */
function placeAfterBlocker(placed: PlacementSymbol, rules: Partial<SymbolPlacementRules> = {}) {
  const grid = new GridIndex(300, 300, 25);
  grid.insert(0, 0, 50, 50);
  return placeSymbol(grid, placed, {...RULES, ...rules});
}

const BLOCKED = [10, 10, 30, 30];
const FREE = [100, 100, 130, 130];

describe('placeSymbol', () => {
  test('places a symbol whose parts are free, and adds both to the grid', () => {
    const grid = new GridIndex(300, 300, 25);
    expect(placeSymbol(grid, symbol(FREE, [140, 100, 160, 120]), RULES)).toBe(
      TEXT_VISIBLE | ICON_VISIBLE
    );
    expect(grid.hitTest(110, 110, 112, 112)).toBe(true);
    expect(grid.hitTest(150, 110, 151, 111)).toBe(true);
  });

  test('without optional parts, a symbol is placed only if both parts are', () => {
    expect(placeAfterBlocker(symbol(BLOCKED, FREE))).toBe(0);
    expect(placeAfterBlocker(symbol(FREE, BLOCKED))).toBe(0);
  });

  test('an optional text lets the icon be placed alone, an optional icon the text', () => {
    expect(placeAfterBlocker(symbol(BLOCKED, FREE), {textOptional: true})).toBe(ICON_VISIBLE);
    expect(placeAfterBlocker(symbol(FREE, BLOCKED), {iconOptional: true})).toBe(TEXT_VISIBLE);
    // The text still needs its icon.
    expect(placeAfterBlocker(symbol(FREE, BLOCKED), {textOptional: true})).toBe(0);
  });

  test('a symbol without one part follows the other part alone', () => {
    expect(placeAfterBlocker(symbol(FREE, null))).toBe(TEXT_VISIBLE);
    expect(placeAfterBlocker(symbol(null, FREE))).toBe(ICON_VISIBLE);
    expect(placeAfterBlocker(symbol(BLOCKED, null))).toBe(0);
  });

  test('a part that allows overlap is placed where it collides', () => {
    expect(placeAfterBlocker(symbol(BLOCKED, null), {textOverlap: 'always'})).toBe(TEXT_VISIBLE);
    expect(placeAfterBlocker(symbol(BLOCKED, FREE), {textOverlap: 'always'})).toBe(
      TEXT_VISIBLE | ICON_VISIBLE
    );
    // Its icon still has to fit.
    expect(placeAfterBlocker(symbol(BLOCKED, BLOCKED), {textOverlap: 'always'})).toBe(0);
  });

  test('a part that ignores placement is placed without being added to the grid', () => {
    const grid = new GridIndex(300, 300, 25);
    placeSymbol(grid, symbol(FREE, null), {...RULES, textIgnorePlacement: true});
    expect(grid.size).toBe(0);
    placeSymbol(grid, symbol(FREE, null), RULES);
    expect(grid.size).toBe(1);
  });

  test('outside the grid nothing is placed, but a part that always overlaps is shown', () => {
    const outside = [400, 400, 420, 420];
    expect(placeAfterBlocker(symbol(outside, null))).toBe(0);
    expect(
      placeAfterBlocker(symbol(outside, null), {textOverlap: 'always', hasIconData: false})
    ).toBe(TEXT_VISIBLE);
  });

  test('text along a line collides by its circles', () => {
    const grid = new GridIndex(300, 300, 25);
    grid.insert(0, 0, 50, 50);
    const line = (x: number): PlacementSymbol => ({
      slot: 0,
      text: {circles: [x, 25, 5, x + 12, 25, 5]},
      icon: null
    });
    expect(placeSymbol(grid, line(60), RULES)).toBe(TEXT_VISIBLE);
    expect(placeSymbol(grid, line(40), RULES)).toBe(0);
  });

  test('a symbol beyond the horizon is hidden, even when it always overlaps', () => {
    const grid = new GridIndex(300, 300, 25);
    expect(
      placeSymbol(grid, {...symbol(FREE, null), occluded: true}, {...RULES, textOverlap: 'always'})
    ).toBe(0);
  });

  test('a symbol beyond the horizon takes no room from the symbols placed after it', () => {
    const grid = new GridIndex(300, 300, 25);
    expect(placeSymbol(grid, {...symbol(FREE, null), occluded: true}, RULES)).toBe(0);
    expect(placeSymbol(grid, symbol(FREE, null), RULES)).toBe(TEXT_VISIBLE);
  });
});

/** A layer of fixed symbols at `order`, each a 20 pixel box at an x in pixels. */
function fakeLayer(
  order: number,
  xs: number[],
  drawnIn: (viewport: any) => boolean = () => true
): PlacementLayer & {redraws: number} {
  return {
    redraws: 0,
    getPlacementOrder: () => order,
    isDrawnIn: drawnIn,
    getPlacementRevision: () => 0,
    getPlacementSlotCount: () => xs.length,
    getPlacementSymbols(_viewport, base, out) {
      xs.forEach((x, index) => out.push(symbol([x, 50, x + 20, 70], null, base + index)));
      return RULES;
    },
    setNeedsRedraw() {
      this.redraws++;
    },
    setNeedsUpdate() {}
  };
}

/** Enough of a device and viewport for `LabelPlacement.prepare`. */
function fakeDevice() {
  const written: Uint8Array[] = [];
  return {
    written,
    createTexture: ({width, height}: any) => ({
      device: null as any,
      width,
      height,
      writeData: (data: Uint8Array) => written.push(data.slice()),
      destroy() {}
    })
  };
}

function fakeViewport(id = 'map', x = 0): any {
  return {id, width: 300, height: 200, x, equals: (other: any) => other.x === x};
}

/** The text visibility of slots `0..count-1` in the last texture write. */
function textVisibility(device: ReturnType<typeof fakeDevice>, count: number): boolean[] {
  const values = device.written[device.written.length - 1];
  return Array.from({length: count}, (_, slot) => values[slot * 4] === 255);
}

describe('LabelPlacement', () => {
  test('places style layers from the top down, each against those placed before it', () => {
    const placement = new LabelPlacement();
    placement.interval = 0;
    const bottom = fakeLayer(1, [0, 100]);
    const top = fakeLayer(2, [10]);
    // Registered bottom first: the order comes from the layers, not from registration.
    expect(placement.register(bottom)).toBe(0);
    expect(placement.register(top)).toBe(2);
    const device = fakeDevice();
    placement.prepare(device as any, fakeViewport(), false, 0);
    // The top layer's label at x 10 hides the bottom one's at x 0; the one at x 100 is free.
    expect(textVisibility(device, 3)).toEqual([false, true, true]);
  });

  test('within a layer, the first symbol wins', () => {
    const placement = new LabelPlacement();
    placement.interval = 0;
    placement.register(fakeLayer(1, [0, 10, 25]));
    const device = fakeDevice();
    placement.prepare(device as any, fakeViewport(), false, 0);
    expect(textVisibility(device, 3)).toEqual([true, false, true]);
  });

  test('while the view keeps changing, places at most every interval, and at once when it rests', () => {
    const placement = new LabelPlacement();
    placement.interval = 300;
    const layer = fakeLayer(1, [0]);
    placement.register(layer);
    const device = fakeDevice();
    const place = vi.spyOn(placement as any, 'place');
    placement.prepare(device as any, fakeViewport('map', 0), false, 0);
    placement.prepare(device as any, fakeViewport('map', 1), false, 100);
    placement.prepare(device as any, fakeViewport('map', 2), false, 200);
    expect(place).toHaveBeenCalledTimes(1);
    // Asked for frames until the view it rests in is placed.
    expect(layer.redraws).toBe(2);
    placement.prepare(device as any, fakeViewport('map', 3), false, 300);
    expect(place).toHaveBeenCalledTimes(2);
    placement.prepare(device as any, fakeViewport('map', 4), false, 350);
    expect(place).toHaveBeenCalledTimes(2);
    // The same view as at the last frame: at rest, placed without waiting for the interval.
    placement.prepare(device as any, fakeViewport('map', 4), false, 360);
    expect(place).toHaveBeenCalledTimes(3);
    placement.prepare(device as any, fakeViewport('map', 4), false, 700);
    expect(place).toHaveBeenCalledTimes(3);
  });

  test('the label sublayers of one frame all draw by the decision made at its first', () => {
    const placement = new LabelPlacement();
    placement.interval = 300;
    placement.register(fakeLayer(1, [0]));
    const device = fakeDevice();
    const place = vi.spyOn(placement as any, 'place');
    placement.prepare(device as any, fakeViewport('map', 0), false, 0, 0);
    // A moving view, within the interval: not placed, by any of the frame's sublayers.
    placement.prepare(device as any, fakeViewport('map', 1), false, 100, 1);
    placement.prepare(device as any, fakeViewport('map', 1), false, 101, 1);
    expect(place).toHaveBeenCalledTimes(1);
    // The next frame finds the view as it was: at rest, placed.
    placement.prepare(device as any, fakeViewport('map', 1), false, 120, 2);
    expect(place).toHaveBeenCalledTimes(2);
  });

  test('a layer that is not drawn in the view has no say in what is placed there', () => {
    const placement = new LabelPlacement();
    placement.interval = 0;
    placement.register(fakeLayer(1, [0]));
    placement.register(fakeLayer(2, [10], viewport => viewport.id === 'a'));
    const device = fakeDevice();
    placement.prepare(device as any, fakeViewport('b'), false, 0);
    expect(textVisibility(device, 2)).toEqual([true, false]);
    placement.prepare(device as any, fakeViewport('a'), false, 0);
    expect(textVisibility(device, 2)).toEqual([false, true]);
  });

  test('picking reads the last placement and never places', () => {
    const placement = new LabelPlacement();
    placement.interval = 0;
    placement.register(fakeLayer(1, [0]));
    const device = fakeDevice();
    const place = vi.spyOn(placement as any, 'place');
    placement.prepare(device as any, fakeViewport('map', 0), true, 0);
    expect(place).not.toHaveBeenCalled();
    placement.prepare(device as any, fakeViewport('map', 0), false, 0);
    placement.prepare(device as any, fakeViewport('map', 5), true, 0);
    expect(place).toHaveBeenCalledTimes(1);
  });

  test('each view has its own placement', () => {
    const placement = new LabelPlacement();
    placement.interval = 0;
    placement.register(fakeLayer(1, [0]));
    const device = fakeDevice();
    const place = vi.spyOn(placement as any, 'place');
    placement.prepare(device as any, fakeViewport('a'), false, 0);
    placement.prepare(device as any, fakeViewport('b'), false, 0);
    placement.prepare(device as any, fakeViewport('a'), false, 0);
    expect(place).toHaveBeenCalledTimes(2);
  });

  test('a layer that needs more slots than are left moves the others, and is told so', () => {
    const placement = new LabelPlacement();
    const first = fakeLayer(1, new Array(600).fill(0));
    const second = fakeLayer(2, new Array(600).fill(0));
    placement.register(first);
    placement.register(second);
    expect(placement.getSlotBase(second)).toBe(600);
    placement.unregister(first);
    const moved = vi.spyOn(second, 'setNeedsUpdate');
    const third = fakeLayer(3, new Array(1000).fill(0));
    placement.register(third);
    expect(placement.getSlotBase(second)).toBe(0);
    expect(placement.getSlotBase(third)).toBe(600);
    expect(moved).toHaveBeenCalledTimes(1);
  });
});

const ATLAS = {
  id: 'default',
  image: 'https://example.com/sprite.png',
  mapping: getSpriteIconMapping({
    dot: {x: 0, y: 0, width: 8, height: 8},
    bar: {x: 8, y: 0, width: 16, height: 4}
  })
};

/**
 * A label layer over `rows` (properties, and the tile each lies in), drawn at a pixel per
 * longitude degree from the grid's corner, at zoom 8 with sprites loaded.
 */
function labelLayer(
  layout: Record<string, unknown>,
  rows: {
    properties: Record<string, unknown>;
    x: number;
    tile?: {x: number; y: number; z: number};
  }[],
  props: Record<string, unknown> = {}
): any {
  const layer: any = new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    styleLayer: {layout, paint: {}},
    zoom: 8,
    spriteAtlases: [ATLAS],
    ...props
  } as any);
  layer.state = {
    labelData: rows.map(({properties, x, tile}, index) => ({
      position: [x, 0],
      __tile: tile && {index: tile},
      __source: {object: {geometry: {type: 'Point', coordinates: [x, 0]}, properties}, index}
    }))
  };
  layer.context = {viewport: {}} as any;
  layer.internalState = {subLayers: []} as any;
  layer.project = ([x]: number[]) => [x, 100];
  return layer;
}

const VIEWPORT = {width: 400, height: 200, bearing: 0};

/** A map view of the size of `VIEWPORT`, turned and tilted. */
function mapViewport(bearing: number, pitch = 0): any {
  return new WebMercatorViewport({...VIEWPORT, longitude: 0, latitude: 0, zoom: 8, bearing, pitch});
}

/** The names of the symbols in placement order. */
function placementOrder(layer: any): string[] {
  const out: PlacementSymbol[] = [];
  layer.getPlacementSymbols(VIEWPORT, 0, out);
  const rows = layer.getRows();
  return out.map(({slot}) => rows[slot].__source.object.properties.name);
}

describe('MVTLabelLayer placement symbols', () => {
  test('in MapLibre order: deeper tiles first, then by tile x and y, then feature order', () => {
    const layer = labelLayer({'text-field': ['get', 'name']}, [
      {properties: {name: 'a'}, x: 0, tile: {x: 1, y: 0, z: 3}},
      {properties: {name: 'b'}, x: 50, tile: {x: 0, y: 1, z: 3}},
      {properties: {name: 'c'}, x: 100, tile: {x: 0, y: 0, z: 3}},
      {properties: {name: 'd'}, x: 150, tile: {x: 0, y: 0, z: 4}},
      {properties: {name: 'e'}, x: 200, tile: {x: 0, y: 0, z: 3}}
    ]);
    expect(placementOrder(layer)).toEqual(['d', 'c', 'e', 'b', 'a']);
  });

  test('symbol-sort-key orders the symbols of all tiles, ascending, before tile order', () => {
    const layer = labelLayer({'text-field': ['get', 'name'], 'symbol-sort-key': ['get', 'key']}, [
      {properties: {name: 'a', key: 3}, x: 0, tile: {x: 0, y: 0, z: 4}},
      {properties: {name: 'b', key: 1}, x: 50, tile: {x: 0, y: 0, z: 3}},
      {properties: {name: 'c', key: 1}, x: 100, tile: {x: 0, y: 0, z: 4}}
    ]);
    expect(placementOrder(layer)).toEqual(['c', 'b', 'a']);
  });

  test('a symbol takes the slot of its row in the sublayers, which hold the rows reversed', () => {
    const layer = labelLayer({'text-field': ['get', 'name']}, [
      {properties: {name: 'a'}, x: 0},
      {properties: {name: 'b'}, x: 100}
    ]);
    const out: PlacementSymbol[] = [];
    layer.getPlacementSymbols(VIEWPORT, 10, out);
    expect(out.map(s => s.slot)).toEqual([11, 10]);
    layer.state.placementSlotBase = 10;
    const accessor = layer.getPlacementSlotAccessor();
    expect(layer.getRows().map(accessor)).toEqual([10, 11]);
  });

  test('the text box: the label at its size, placed by text-anchor and text-offset, padded', () => {
    // Without a canvas every character is half an em: 'abcd' is 2 ems wide, one line 1.2 ems high.
    const box = (layout: Record<string, unknown>) => {
      const layer = labelLayer({'text-field': ['get', 'name'], 'text-size': 10, ...layout}, [
        {properties: {name: 'abcd'}, x: 100}
      ]);
      const out: PlacementSymbol[] = [];
      layer.getPlacementSymbols(VIEWPORT, 0, out);
      const p = PLACEMENT_VIEWPORT_PADDING;
      return out[0].text!.box!.map((v, i) => Math.round((v - p - (i % 2 ? 100 : 100)) * 100) / 100);
    };
    // Centred, with the default text-padding of 2 pixels.
    expect(box({})).toEqual([-12, -8, 12, 8]);
    expect(box({'text-padding': 0})).toEqual([-10, -6, 10, 6]);
    expect(box({'text-anchor': 'left', 'text-padding': 0})).toEqual([0, -6, 20, 6]);
    expect(box({'text-anchor': 'top', 'text-offset': [0, 1], 'text-padding': 0})).toEqual([
      -10, 10, 10, 22
    ]);
  });

  test('the icon box: the image at icon-size, placed by icon-anchor, padded by icon-padding', () => {
    const box = (layout: Record<string, unknown>) => {
      const layer = labelLayer({'icon-image': 'dot', ...layout}, [{properties: {}, x: 100}]);
      const out: PlacementSymbol[] = [];
      layer.getPlacementSymbols(VIEWPORT, 0, out);
      const p = PLACEMENT_VIEWPORT_PADDING;
      return out[0].icon!.box!.map(v => v - p - 100);
    };
    expect(box({})).toEqual([-6, -6, 6, 6]);
    expect(box({'icon-size': 2, 'icon-padding': 0})).toEqual([-8, -8, 8, 8]);
    expect(box({'icon-anchor': 'bottom', 'icon-padding': [1, 2, 3, 4]})).toEqual([-8, -9, 6, 3]);
  });

  test('an icon drawn in the map plane collides as the bearing turns it on screen', () => {
    const box = (alignment: string, bearing: number, anchor = 'center') => {
      const layout = {
        'icon-image': 'bar',
        'icon-rotation-alignment': alignment,
        'icon-anchor': anchor
      };
      const layer = labelLayer(layout, [{properties: {}, x: 100}]);
      const out: PlacementSymbol[] = [];
      layer.getPlacementSymbols(mapViewport(bearing, pitch), 0, out);
      const p = PLACEMENT_VIEWPORT_PADDING;
      return out[0].icon!.box!.map((v, i) => Math.round(v - p - (i % 2 ? 100 : 100)));
    };
    let pitch = 0;
    expect(box('map', 0)).toEqual([-10, -4, 10, 4]);
    expect(box('map', 90)).toEqual([-4, -10, 4, 10]);
    expect(box('viewport', 90)).toEqual([-10, -4, 10, 4]);
    // The map plane's down is the screen's at bearing 0, and its left at bearing 90.
    expect(box('map', 0, 'bottom')).toEqual([-10, -6, 10, 2]);
    expect(box('map', 90, 'bottom')).toEqual([-6, -10, 2, 10]);
    // Tilted, an icon in the map plane is foreshortened; a billboard is not.
    pitch = 60;
    const [, y1, , y2] = box('map', 90);
    expect(y2 - y1).toBeLessThan(15);
    expect(box('viewport', 90)).toEqual([-10, -4, 10, 4]);
  });

  test("the circles of text along a line follow the line's turn on screen, bearing included", () => {
    const circles = (bearing: number) => {
      const layer = labelLayer(
        {'text-field': 'abcdefgh', 'symbol-placement': 'line', 'text-padding': 0},
        [{properties: {}, x: 100}]
      );
      const out: PlacementSymbol[] = [];
      layer.getPlacementSymbols(mapViewport(bearing), 0, out);
      return out[0].text!.circles!;
    };
    // An eastward line: across the screen at bearing 0; turned 45 degrees anticlockwise, up and
    // to the right, at bearing 45, as the map's east is.
    const flat = circles(0);
    expect(flat[1]).toBeCloseTo(flat[flat.length - 2]);
    expect(flat[0]).toBeLessThan(flat[flat.length - 3]);
    const turned = circles(45);
    const last = turned.length - 3;
    expect(turned[last] - turned[0]).toBeGreaterThan(1);
    expect(turned[last + 1] - turned[1]).toBeCloseTo(-(turned[last] - turned[0]));
  });

  test('the circles of text along a line take its text-offset across the line, as drawn', () => {
    const circles = (angle: number) => {
      const layer = labelLayer(
        {
          'text-field': 'abcdefgh',
          'symbol-placement': 'line',
          'text-padding': 0,
          'text-size': 10,
          'text-offset': [0.5, -1]
        },
        [{properties: {}, x: 100}]
      );
      layer.state.labelData[0].angle = angle;
      const out: PlacementSymbol[] = [];
      layer.getPlacementSymbols(mapViewport(0), 0, out);
      const values = out[0].text!.circles!;
      // The circles' centres, from the anchor at (100, 100).
      const centres: number[][] = [];
      for (let k = 0; k < values.length; k += 3) {
        const [x, y] = [values[k], values[k + 1]].map(v => v - PLACEMENT_VIEWPORT_PADDING - 100);
        centres.push([x, y]);
      }
      return centres;
    };
    const meanX = (centres: number[][]) =>
      centres.reduce((sum, [x]) => sum + x, 0) / centres.length;
    // Text 10 px above an eastward line and 5 px along it; below a westward one and 5 px west,
    // though the text is turned around to read upright.
    expect(meanX(circles(0))).toBeCloseTo(5, 6);
    for (const [, y] of circles(0)) {
      expect(y).toBeCloseTo(-10, 6);
    }
    expect(meanX(circles(180))).toBeCloseTo(-5, 6);
    for (const [, y] of circles(180)) {
      expect(y).toBeCloseTo(10, 6);
    }
    // Across a line drawn north, to its west.
    for (const [x] of circles(90)) {
      expect(x).toBeCloseTo(-10, 6);
    }
  });

  test('text along a line without height has one circle', () => {
    const layer = labelLayer(
      {
        'text-field': 'abcdefgh',
        'symbol-placement': 'line',
        'text-padding': 0,
        'text-line-height': 0,
        'text-size': 10
      },
      [{properties: {}, x: 100}]
    );
    const out: PlacementSymbol[] = [];
    layer.getPlacementSymbols(mapViewport(0), 0, out);
    expect(out[0].text!.circles).toHaveLength(3);
  });

  test('is drawn in a view while it and its parents are visible and its parents keep it', () => {
    const layer = labelLayer({'text-field': 'x'}, [{properties: {}, x: 0}]);
    const parent = {
      props: {visible: true},
      parent: null,
      filterSubLayer: ({viewport}: any) => viewport.id === 'a'
    };
    layer.parent = parent;
    expect(layer.isDrawnIn({id: 'a'})).toBe(true);
    expect(layer.isDrawnIn({id: 'b'})).toBe(false);
    parent.props.visible = false;
    expect(layer.isDrawnIn({id: 'a'})).toBe(false);
    parent.props.visible = true;
    layer.props = {...layer.props, visible: false};
    expect(layer.isDrawnIn({id: 'a'})).toBe(false);
  });

  test('reads the placement rules, *-overlap over *-allow-overlap', () => {
    const rules = (layout: Record<string, unknown>) =>
      labelLayer({'text-field': 'x', 'icon-image': 'dot', ...layout}, [
        {properties: {}, x: 0}
      ]).getPlacementSymbols(VIEWPORT, 0, []);
    expect(rules({})).toMatchObject({textOverlap: 'never', iconOverlap: 'never'});
    expect(rules({'text-allow-overlap': true, 'icon-overlap': 'cooperative'})).toMatchObject({
      textOverlap: 'always',
      iconOverlap: 'cooperative'
    });
    expect(rules({'text-allow-overlap': true, 'text-overlap': 'never'})).toMatchObject({
      textOverlap: 'never'
    });
    expect(
      rules({'text-optional': true, 'icon-ignore-placement': true, 'text-ignore-placement': false})
    ).toMatchObject({textOptional: true, iconIgnorePlacement: true, textIgnorePlacement: false});
  });

  test('while the sprites load, a symbol keeps the rules it has once its icon arrives', () => {
    const rules = (spriteAtlases: unknown) =>
      labelLayer({'text-field': 'x', 'icon-image': 'dot'}, [{properties: {}, x: 0}], {
        spriteAtlases
      }).getPlacementSymbols(VIEWPORT, 0, []);
    expect(rules([ATLAS]).hasIconData).toBe(true);
    // Loading (`null`) is taken as having the icon; a style without sprites (`[]`) has none.
    expect(rules(null).hasIconData).toBe(true);
    expect(rules([]).hasIconData).toBe(false);
  });

  test('a text box is measured again once its font has loaded', () => {
    // A canvas whose font measures each character `width` pixels at 64px.
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
      const layer = labelLayer(
        {'text-field': 'abcd', 'text-size': 10, 'text-padding': 0},
        [{properties: {}, x: 100}],
        {fontFamily: 'Font Loading In This Test'}
      );
      const boxWidth = () => {
        const out: PlacementSymbol[] = [];
        layer.getPlacementSymbols(VIEWPORT, 0, out);
        const [x1, , x2] = out[0].text!.box!;
        return x2 - x1;
      };
      expect(boxWidth()).toBe(20);
      const geometry = layer.getPlacementGeometry();
      // Another font loads, or this one loads again with the same advances: nothing to measure.
      const font = layer.getFont();
      const weight = getTextLayerFontWeight(font);
      forgetCharacterWidths(weight, 'Another Font');
      forgetCharacterWidths(weight, font.fontFamily);
      expect(layer.getPlacementGeometry()).toBe(geometry);
      // Measuring many other fonts empties the cache of measurers; the widths are the same.
      for (let i = 0; i <= MAX_CACHED_FONTS; i++) {
        getCharacterWidthMeasurer(400, `Other Font ${i}`);
      }
      expect(layer.getPlacementGeometry()).toBe(geometry);
      // The font loads: its characters are a full em wide, and the widths measured before it are
      // forgotten, as `isLineTextFontLoading` does.
      width = 64;
      forgetCharacterWidths(weight, font.fontFamily);
      expect(boxWidth()).toBe(40);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('a style layer edited in place gives new boxes and rules', () => {
    const layout: Record<string, unknown> = {
      'text-field': 'abcd',
      'text-size': 10,
      'text-padding': 0
    };
    const layer = labelLayer(layout, [{properties: {}, x: 100}]);
    const place = () => {
      const out: PlacementSymbol[] = [];
      const rules = layer.getPlacementSymbols(VIEWPORT, 0, out);
      const p = PLACEMENT_VIEWPORT_PADDING;
      return {rules, box: out[0].text!.box!.map(v => Math.round(v - p - 100))};
    };
    expect(place().box).toEqual([-10, -6, 10, 6]);
    layout['text-anchor'] = 'left';
    expect(place().box).toEqual([0, -6, 20, 6]);
    layout['text-offset'] = [0, 1];
    expect(place().box).toEqual([0, 4, 20, 16]);
    layout['text-allow-overlap'] = true;
    expect(place().rules.textOverlap).toBe('always');
  });

  test('label layers made without a placement share one per deck, released with the last', () => {
    const layerManager = {};
    const make = (id: string, context: any) => {
      const layer: any = new MVTLabelLayer({
        id,
        config: {labels: true},
        styleLayer: {layout: {'text-field': ['get', 'name']}, paint: {}},
        zoom: 8,
        data: [
          {type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}, properties: {name: 'a'}}
        ]
      } as any);
      layer.context = {...context, resourceManager: {unsubscribe() {}}};
      layer.internalState = {
        subLayers: [],
        uniformTransitions: {clear() {}},
        finalize() {}
      } as any;
      layer.state = {};
      layer.setState = (partial: Record<string, unknown>) => Object.assign(layer.state, partial);
      layer.updateState({changeFlags: {dataChanged: true}} as any);
      return layer;
    };
    const first = make('first', {layerManager});
    const second = make('second', {layerManager});
    const elsewhere = make('elsewhere', {layerManager: {}});
    const shared = first.state.placement;
    expect(second.state.placement).toBe(shared);
    expect(elsewhere.state.placement).not.toBe(shared);
    expect(shared.getSlotBase(second.state.placementHandle)).toBe(1);
    const destroy = vi.spyOn(shared, 'destroy');
    first.finalizeState(first.context);
    expect(destroy).not.toHaveBeenCalled();
    second.finalizeState(second.context);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test('text and icon sublayers draw by the shared slots, text by part 0 and icons by part 1', () => {
    const placement = new LabelPlacement();
    const layer: any = new MVTLabelLayer({
      id: 'labels',
      config: {labels: true},
      styleLayer: {layout: {'text-field': ['get', 'name'], 'icon-image': 'dot'}, paint: {}},
      zoom: 8,
      spriteAtlases: [ATLAS],
      labelPlacement: placement,
      data: [
        {type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}, properties: {name: 'a'}}
      ]
    } as any);
    layer.context = {} as any;
    layer.internalState = {subLayers: []} as any;
    layer.state = {};
    layer.setState = (partial: Record<string, unknown>) => Object.assign(layer.state, partial);
    layer.updateState({changeFlags: {dataChanged: true}} as any);
    const sublayers = layer.renderLayers();
    const icons = sublayers.find((sublayer: any) => sublayer.id.includes('icons'));
    const text = sublayers.find((sublayer: any) => sublayer.id === 'labels-text');
    expect(icons.props.placementPart).toBe(1);
    expect(text.props.placementPart).toBe(0);
    expect(icons.props.labelPlacement).toBe(placement);
    const [row] = layer.getRows();
    expect(icons.props.getPlacementSlot(row)).toBe(text.props.getPlacementSlot(row));
    expect(placement.getSlotBase(layer.state.placementHandle)).toBe(0);
  });
});
