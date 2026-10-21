// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, test, vi} from 'vitest';
import {_GlobeViewport as GlobeViewport, WebMercatorViewport} from '@deck.gl/core';
import {GridIndex, allowsOverlap} from '../src/grid-index.ts';
import {
  ANCHOR_SHIFT,
  ICON_VISIBLE,
  LabelPlacement,
  PLACEMENT_VIEWPORT_PADDING,
  TEXT_VISIBLE,
  placeSymbol,
  type PlacementLayer,
  type PlacementSymbol,
  type SymbolPlacementRules
} from '../src/label-placement.ts';
import {MVTLabelLayer, getVariableAnchorOffset} from '../src/mvt-label-layer.ts';
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

  test('a symbol waiting for its icon is not placed, nor in the way, unless the icon is optional', () => {
    const waiting = {...symbol(FREE, null), iconPending: true};
    const grid = new GridIndex(300, 300, 25);
    expect(placeSymbol(grid, waiting, {...RULES, textOverlap: 'always'})).toBe(0);
    expect(grid.hitTest(110, 110, 112, 112)).toBe(false);
    expect(placeSymbol(grid, waiting, {...RULES, iconOptional: true})).toBe(TEXT_VISIBLE);
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

/** A symbol with text at each box of `anchors` in turn, drawn from slots `1..`, and an icon. */
function variableSymbol(anchors: number[][], icon: number[] | null = null): PlacementSymbol {
  const shapes = anchors.map(box => ({box}));
  return {
    slot: 1,
    text: shapes[0],
    icon: icon && {box: icon},
    textAnchors: {shapes, slots: anchors.map((_, index) => index + 1), key: {}}
  };
}

describe('placeSymbol with text-variable-anchor', () => {
  const RIGHT = [60, 10, 90, 30];
  const BELOW = [10, 60, 30, 80];

  test('text is placed at the first anchor where it fits, and only that box is added', () => {
    const grid = new GridIndex(300, 300, 25);
    grid.insert(0, 0, 50, 50);
    const bits = placeSymbol(grid, variableSymbol([BLOCKED, RIGHT, BELOW]), RULES);
    expect(bits & TEXT_VISIBLE).toBe(TEXT_VISIBLE);
    expect(bits >> ANCHOR_SHIFT).toBe(1);
    expect(grid.hitTest(70, 15, 71, 16)).toBe(true);
    expect(grid.hitTest(15, 65, 16, 66)).toBe(false);
  });

  test('text that fits at no anchor is hidden; text that may overlap takes its first anchor', () => {
    expect(placeAfterBlocker(variableSymbol([BLOCKED, [20, 20, 40, 40]]))).toBe(0);
    expect(
      placeAfterBlocker(variableSymbol([BLOCKED, [20, 20, 40, 40]]), {textOverlap: 'always'})
    ).toBe(TEXT_VISIBLE);
    // Without overlap first: a free anchor wins over the first one, even when text may overlap.
    expect(
      placeAfterBlocker(variableSymbol([BLOCKED, RIGHT]), {textOverlap: 'always'}) >> ANCHOR_SHIFT
    ).toBe(1);
  });

  test('the anchor of the last placement is kept while it fits, else the order decides', () => {
    const grid = new GridIndex(300, 300, 25);
    expect(placeSymbol(grid, variableSymbol([FREE, RIGHT, BELOW]), RULES, 2) >> ANCHOR_SHIFT).toBe(
      2
    );
    const blocked = new GridIndex(300, 300, 25);
    blocked.insert(0, 50, 50, 100);
    expect(
      placeSymbol(blocked, variableSymbol([FREE, RIGHT, BELOW]), RULES, 2) >> ANCHOR_SHIFT
    ).toBe(0);
  });

  test('the icon stays where it is, and needs the text placed at some anchor', () => {
    expect(placeAfterBlocker(variableSymbol([BLOCKED, RIGHT], FREE))).toBe(
      TEXT_VISIBLE | ICON_VISIBLE | (1 << ANCHOR_SHIFT)
    );
    expect(placeAfterBlocker(variableSymbol([BLOCKED, BLOCKED], FREE))).toBe(0);
  });
});

/** A layer of fixed symbols at `order`, each a 20 pixel box at an x in pixels. */
function fakeLayer(
  order: number,
  xs: number[],
  drawnIn: (viewport: any) => boolean = () => true
): PlacementLayer & {redraws: number; slotRevision: number} {
  return {
    redraws: 0,
    slotRevision: 0,
    getPlacementOrder: () => order,
    isDrawnIn: drawnIn,
    getPlacementRevision: () => 0,
    getPlacementSlotRevision() {
      return this.slotRevision;
    },
    getPlacementSlotCount: () => xs.length,
    getPlacementSymbols(_viewport, base, out) {
      xs.forEach((x, index) => out.push(symbol([x, 50, x + 20, 70], null, base + index)));
      return RULES;
    },
    setNeedsRedraw() {
      this.redraws++;
    }
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

  test('text with variable anchors is drawn from the slot of its anchor, its icon from its own', () => {
    const placement = new LabelPlacement();
    placement.interval = 0;
    const key = {};
    let blockFirstAnchor = true;
    const layer: PlacementLayer = {
      ...fakeLayer(1, []),
      getPlacementSlotCount: () => 4,
      getPlacementSymbols(_viewport, base, out) {
        if (blockFirstAnchor) {
          out.push(symbol([0, 50, 20, 70], null, base + 3));
        }
        out.push({
          slot: base,
          text: {box: [0, 50, 20, 70]},
          icon: {box: [100, 50, 110, 60]},
          textAnchors: {
            shapes: [{box: [0, 50, 20, 70]}, {box: [30, 50, 50, 70]}, {box: [60, 50, 80, 70]}],
            slots: [base, base + 1, base + 2],
            key
          }
        });
        return RULES;
      }
    };
    placement.register(layer);
    const device = fakeDevice();
    placement.prepare(device as any, fakeViewport('map', 0), false, 0);
    expect(textVisibility(device, 4)).toEqual([false, true, false, true]);
    const values = device.written[device.written.length - 1];
    expect(values[1]).toBe(255);
    // Placed again with its first anchor free, it keeps the anchor it had.
    blockFirstAnchor = false;
    placement.prepare(device as any, fakeViewport('map', 1), false, 1);
    expect(textVisibility(device, 4)).toEqual([false, true, false, false]);
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

  test('layers under a later deck layer are placed first, whatever their placement order', () => {
    const placement = new LabelPlacement();
    placement.interval = 0;
    // Two basemaps, the second drawn over the first, each with a bottom and a top style layer.
    const first = {id: 'first', parent: null};
    const second = {id: 'second', parent: null};
    const deckLayers = [
      first,
      {id: 'first-tiles', parent: first},
      second,
      {id: 'second-tiles', parent: second}
    ];
    const under = (root: {id: string}, order: number, xs: number[]) => ({
      ...fakeLayer(order, xs),
      getPlacementRoot: () => ({root, layers: deckLayers})
    });
    // Registered first-basemap first, and its top style layer above any of the second's.
    placement.register(under(first, 2, [0]));
    placement.register(under(first, 1, [100]));
    placement.register(under(second, 1, [10]));
    placement.register(under(second, 0, [110, 120]));
    const device = fakeDevice();
    placement.prepare(device as any, fakeViewport(), false, 0);
    // The second basemap's labels are placed first: its label at 10 hides the first's at 0, and
    // its label at 110 hides the first's at 100, though that style layer's order is higher. Its
    // label at 120 overlaps its own at 110.
    expect(textVisibility(device, 5)).toEqual([false, false, true, true, false]);
  });

  test('placed again at once when the deck layers swap, and by id when deck.gl renews them', () => {
    const placement = new LabelPlacement();
    // Never placed for the interval alone: only a change places again.
    placement.interval = Number.POSITIVE_INFINITY;
    let deckLayers: {id: string; parent: null}[] = [
      {id: 'first', parent: null},
      {id: 'second', parent: null}
    ];
    // Each layer finds its deck layer by id, as a sublayer still pointing at the instance deck.gl
    // replaced would.
    const under = (id: string, xs: number[]) => ({
      ...fakeLayer(1, xs),
      getPlacementRoot: () => ({root: {id}, layers: deckLayers})
    });
    placement.register(under('first', [0]));
    placement.register(under('second', [10]));
    const device = fakeDevice();
    const place = vi.spyOn(placement as any, 'place');
    placement.prepare(device as any, fakeViewport(), false, 0, 0);
    expect(textVisibility(device, 2)).toEqual([false, true]);
    // The same view at the next frame: nothing to place again.
    placement.prepare(device as any, fakeViewport(), false, 1, 1);
    expect(place).toHaveBeenCalledTimes(1);
    deckLayers = [deckLayers[1], deckLayers[0]];
    placement.prepare(device as any, fakeViewport(), false, 2, 2);
    expect(place).toHaveBeenCalledTimes(2);
    expect(textVisibility(device, 2)).toEqual([true, false]);
  });

  test('placed again at once when a layer comes to be drawn in the view, or no longer is', () => {
    const placement = new LabelPlacement();
    placement.interval = Number.POSITIVE_INFINITY;
    let drawn = true;
    placement.register(fakeLayer(1, [0]));
    placement.register(fakeLayer(2, [10], () => drawn));
    const device = fakeDevice();
    const place = vi.spyOn(placement as any, 'place');
    placement.prepare(device as any, fakeViewport(), false, 0, 0);
    expect(textVisibility(device, 2)).toEqual([false, true]);
    drawn = false;
    placement.prepare(device as any, fakeViewport(), false, 1, 1);
    expect(place).toHaveBeenCalledTimes(2);
    expect(textVisibility(device, 2)).toEqual([true, false]);
  });

  test('a layer without a deck layer is placed after those with one', () => {
    const placement = new LabelPlacement();
    placement.interval = 0;
    const root = {id: 'root', parent: null};
    placement.register({
      ...fakeLayer(1, [0]),
      getPlacementRoot: () => ({root, layers: [root]})
    });
    placement.register({...fakeLayer(2, [10]), getPlacementRoot: () => null});
    const device = fakeDevice();
    placement.prepare(device as any, fakeViewport(), false, 0);
    // A layer under a deck layer goes before those without one, whatever its order.
    expect(textVisibility(device, 2)).toEqual([true, false]);
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

  test('a layer that needs more slots takes the first free ones, and moves no other layer', () => {
    const placement = new LabelPlacement();
    const first = fakeLayer(1, new Array(600).fill(0));
    const second = fakeLayer(2, new Array(600).fill(0));
    expect(placement.register(first)).toBe(0);
    expect(placement.register(second)).toBe(600);
    placement.unregister(first);
    // Too many for the slots the first layer left: after the second, past the first texture row.
    const third = fakeLayer(3, new Array(1000).fill(0));
    expect(placement.register(third)).toBe(1200);
    // Enough room where the first layer was.
    const fourth = fakeLayer(4, new Array(500).fill(0));
    expect(placement.register(fourth)).toBe(0);
    // A layer that grows gives up its slots, which its new ones may take, and moves no other.
    second.getPlacementSlotCount = () => 700;
    expect(placement.register(second)).toBe(500);
    second.getPlacementSlotCount = () => 800;
    expect(placement.register(second)).toBe(2200);
    expect(placement.getSlotBase(third)).toBe(1200);
    expect(placement.getSlotBase(fourth)).toBe(0);
  });

  test('a layer that takes the slots another left is placed at once, while the view moves', () => {
    const placement = new LabelPlacement();
    placement.interval = 300;
    const first = fakeLayer(1, [0, 100]);
    placement.register(first);
    const device = fakeDevice();
    const place = vi.spyOn(placement as any, 'place');
    placement.prepare(device as any, fakeViewport('map', 0), false, 0);
    // Replaced by a layer of the same slot revision, in the same slots.
    placement.unregister(first);
    const second = fakeLayer(1, [100, 0]);
    expect(placement.register(second)).toBe(0);
    placement.prepare(device as any, fakeViewport('map', 1), false, 50);
    expect(place).toHaveBeenCalledTimes(2);
  });

  test('a texture that grows keeps the visibility of every slot', () => {
    const placement = new LabelPlacement();
    placement.interval = 300;
    const first = fakeLayer(1, [0, 100]);
    placement.register(first);
    const device = fakeDevice();
    placement.prepare(device as any, fakeViewport('map', 0), false, 0);
    // Past the first texture row, while the view moves: the first layer's labels stay shown.
    placement.register(fakeLayer(2, new Array(2000).fill(1000)));
    const place = vi.spyOn(placement as any, 'place').mockImplementation(() => {});
    placement.prepare(device as any, fakeViewport('map', 1), false, 50);
    expect(place).toHaveBeenCalledTimes(1);
    expect(textVisibility(device, 2)).toEqual([true, true]);
  });

  test('a layer whose symbols take other slots is placed at once, while the view moves', () => {
    const placement = new LabelPlacement();
    placement.interval = 300;
    const xs = [0, 100];
    const layer = fakeLayer(1, xs);
    placement.register(layer);
    const device = fakeDevice();
    const place = vi.spyOn(placement as any, 'place');
    placement.prepare(device as any, fakeViewport('map', 0), false, 0);
    expect(textVisibility(device, 2)).toEqual([true, true]);
    // Another layer's rows change, as when a tile comes into view: it has more symbols, and
    // slots of its own.
    const other = fakeLayer(2, [200]);
    expect(placement.register(other)).toBe(2);
    placement.prepare(device as any, fakeViewport('map', 1), false, 50);
    expect(place).toHaveBeenCalledTimes(2);
    other.getPlacementSymbols = (_viewport, base, out) => {
      [200, 220].forEach((x, index) => out.push(symbol([x, 50, x + 20, 70], null, base + index)));
      return RULES;
    };
    other.getPlacementSlotCount = () => 2;
    other.slotRevision++;
    expect(placement.register(other)).toBe(2);
    placement.prepare(device as any, fakeViewport('map', 2), false, 100);
    expect(place).toHaveBeenCalledTimes(3);
    expect(textVisibility(device, 4)).toEqual([true, true, true, false]);
    // Rows that change in the same slots are placed at once too.
    xs.reverse();
    layer.slotRevision++;
    placement.prepare(device as any, fakeViewport('map', 3), false, 150);
    expect(place).toHaveBeenCalledTimes(4);
    // Otherwise a moving view waits for the interval.
    placement.prepare(device as any, fakeViewport('map', 4), false, 200);
    expect(place).toHaveBeenCalledTimes(4);
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

  test('a text-size that changes with zoom collides at its size at the next integer zoom, as MapLibre', () => {
    // MapLibre lays a point label's box out at `text-size` at the tile's zoom + 1: at z8.5, a size
    // of 10 at z8 and 20 at z9 is drawn at 15 and collides at 20 ('abcd' is 2 ems by 1.2 ems).
    const box = (layout: Record<string, unknown>) => {
      const layer = labelLayer(
        {
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 9, 20],
          'text-padding': 0,
          ...layout
        },
        [{properties: {name: 'abcd'}, x: 100}],
        {zoom: 8.5}
      );
      expect(layer.getLabelSize(layer.state.labelData[0].__source.object)).toBe(15);
      const out: PlacementSymbol[] = [];
      layer.getPlacementSymbols(VIEWPORT, 0, out);
      const p = PLACEMENT_VIEWPORT_PADDING;
      return out[0].text!.box!.map(v => Math.round((v - p - 100) * 100) / 100);
    };
    expect(box({})).toEqual([-20, -12, 20, 12]);
    // The anchor and offset are laid out at that size too.
    expect(box({'text-anchor': 'bottom', 'text-offset': [0, -1]})).toEqual([-20, -44, 20, -20]);
  });

  test('text-radial-offset moves the text away from its text-anchor, as MapLibre', () => {
    const layer = labelLayer(
      {
        'text-field': ['get', 'name'],
        'text-size': 10,
        'text-padding': 0,
        'text-anchor': 'top',
        'text-radial-offset': 1
      },
      [{properties: {name: 'abcd'}, x: 100}]
    );
    const out: PlacementSymbol[] = [];
    layer.getPlacementSymbols(VIEWPORT, 0, out);
    const p = PLACEMENT_VIEWPORT_PADDING;
    // One em down, less MapLibre's baseline shift of 7/24 em.
    expect(out[0].text!.box!.map(v => Math.round((v - p - 100) * 100) / 100)).toEqual([
      -10, 7.08, 10, 19.08
    ]);
  });

  test('line labels take text-radial-offset, but no offset with variable anchors, as MapLibre', () => {
    const feature = {properties: {name: 'abcd'}};
    const offset = (layout: Record<string, unknown>) =>
      labelLayer(
        {'text-field': ['get', 'name'], 'text-size': 10, 'symbol-placement': 'line', ...layout},
        []
      ).getLabelPixelOffset(feature);
    expect(offset({'text-offset': [0, 1]})).toEqual([0, 10]);
    expect(offset({'text-anchor': 'left', 'text-radial-offset': 1})).toEqual([10, 0]);
    // MapLibre moves labels with variable anchors at placement, which it does only for points.
    expect(offset({'text-offset': [0, 1], 'text-variable-anchor': ['top']})).toEqual([0, 0]);
    expect(offset({'text-radial-offset': 1, 'text-variable-anchor': ['left']})).toEqual([0, 0]);
    expect(offset({'text-variable-anchor-offset': ['top', [0, 1]]})).toEqual([0, 0]);
  });

  test('text-variable-anchor: a text box per anchor, offset and padded as MapLibre', () => {
    const layout = {
      'text-field': ['get', 'name'],
      'text-size': 10,
      'icon-image': 'dot',
      'text-variable-anchor': ['left', 'top', 'bottom-right'],
      'text-radial-offset': 1
    };
    const layer = labelLayer(layout, []);
    const feature = {geometry: {type: 'Point', coordinates: [100, 0]}, properties: {name: 'abcd'}};
    layer.state.labelData = [0, 1, 2].map(textAnchorIndex => ({
      position: [100, 0],
      textAnchorIndex,
      textAnchorCount: 3,
      __source: {object: feature, index: 0}
    }));
    const out: PlacementSymbol[] = [];
    layer.getPlacementSymbols(VIEWPORT, 10, out);
    expect(out).toHaveLength(1);
    const [placed] = out;
    // The first row draws the icon; the text is drawn from the row of its anchor.
    expect(placed.slot).toBe(12);
    expect(placed.icon).toBeTruthy();
    expect(placed.textAnchors!.slots).toEqual([12, 11, 10]);
    expect(placed.textAnchors!.key).toBe(layer.state.labelData[0]);
    const p = PLACEMENT_VIEWPORT_PADDING;
    const boxes = placed.textAnchors!.shapes.map(shape =>
      shape.box!.map(v => Math.round((v - p - 100) * 100) / 100)
    );
    // MapLibre shifts the text by half its box padded by text-padding (2 pixels), so the padded
    // box's edge lies at the offset: right of the point by one em; below it by one em less the
    // baseline shift; above and left of it along the diagonal.
    const diagonal = Math.round((10 / Math.SQRT2) * 100) / 100;
    const corner = Math.round((-10 / Math.SQRT2 + (7 / 24) * 10) * 100) / 100;
    expect(boxes).toEqual([
      [10, -8, 34, 8],
      [-12, 7.08, 12, 23.08],
      [-24 - diagonal, -16 + corner, -diagonal, corner]
    ]);
    // Only the first row draws an icon.
    expect(layer.getRowIcons().map(Boolean)).toEqual([false, false, true]);
  });

  test('zoom-dependent collision sizes preserve variable-anchor padding in pixels', () => {
    const layer = labelLayer(
      {
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 9, 20],
        'text-variable-anchor': ['left', 'top'],
        'text-radial-offset': 1,
        'text-padding': 2
      },
      [],
      {zoom: 8.5}
    );
    const feature = {geometry: {type: 'Point', coordinates: [100, 0]}, properties: {name: 'abcd'}};
    layer.state.labelData = [0, 1].map(textAnchorIndex => ({
      position: [100, 0],
      textAnchorIndex,
      textAnchorCount: 2,
      __source: {object: feature, index: 0}
    }));
    const out: PlacementSymbol[] = [];
    layer.getPlacementSymbols(VIEWPORT, 0, out);
    const p = PLACEMENT_VIEWPORT_PADDING;
    const box = out[0].textAnchors!.shapes[0].box!.map(v => Math.round((v - p - 100) * 100) / 100);
    // The left anchor's offset and text scale to 20 px; its 2 px padding does not scale.
    expect(box).toEqual([20, -14, 64, 14]);
  });

  test('getVariableAnchorOffset follows MapLibre evaluateVariableOffset', () => {
    const b = 7 / 24;
    expect(getVariableAnchorOffset('center', [2], true)).toEqual([0, 0]);
    expect(getVariableAnchorOffset('top', [2], true)).toEqual([0, 2 - b]);
    expect(getVariableAnchorOffset('bottom', [2], true)).toEqual([0, -2 + b]);
    expect(getVariableAnchorOffset('left', [2], true)).toEqual([2, 0]);
    expect(getVariableAnchorOffset('right', [2], true)).toEqual([-2, 0]);
    const d = 2 / Math.SQRT2;
    expect(getVariableAnchorOffset('top-left', [2], true)).toEqual([d, d - b]);
    expect(getVariableAnchorOffset('bottom-right', [2], true)).toEqual([-d, -d + b]);
    // A negative radial offset is taken as 0.
    expect(getVariableAnchorOffset('left', [-1], true)).toEqual([0, 0]);
    // `text-offset`: its sizes, in the anchor's directions.
    expect(getVariableAnchorOffset('top-right', [1, -2], false)).toEqual([-1, 2 - b]);
    expect(getVariableAnchorOffset('left', [-1, 3], false)).toEqual([1, 0]);
    expect(getVariableAnchorOffset('bottom', [5, 3], false)).toEqual([0, -3 + b]);
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

  test('on a turned globe, the circles of text along a line follow the line as it is drawn', () => {
    const circles = (bearing: number, layout: Record<string, unknown> = {}) => {
      const layer = labelLayer(
        {'text-field': 'abcdefgh', 'symbol-placement': 'line', 'text-padding': 0, ...layout},
        [{properties: {}, x: 0}]
      );
      const viewport = new GlobeViewport({
        ...VIEWPORT,
        longitude: 0,
        latitude: 0,
        zoom: 4,
        bearing
      });
      layer.context = {viewport};
      const out: PlacementSymbol[] = [];
      layer.getPlacementSymbols(viewport, 0, out);
      return out[0].text!.circles!;
    };
    // An eastward line, drawn up the screen and a little left at bearing 100, where the view turns
    // the label to it (screen y points down). Kept upright, it reads from the top left down to the
    // bottom right; otherwise as the line runs.
    for (const [layout, degrees] of [
      [{}, 80],
      [{'text-keep-upright': false}, -100]
    ] as const) {
      const turned = circles(100, layout);
      const last = turned.length - 3;
      const drawn = Math.atan2(turned[last + 1] - turned[1], turned[last] - turned[0]);
      expect((drawn * 180) / Math.PI).toBeCloseTo(degrees, 0);
    }
  });

  test('on a turned globe, the circles of text along a line keep its text-offset on its side', () => {
    const offset = (bearing: number) => {
      const layer = labelLayer(
        {
          'text-field': 'abcdefgh',
          'symbol-placement': 'line',
          'text-padding': 0,
          'text-size': 10,
          'text-offset': [0, -1]
        },
        [{properties: {}, x: 0}]
      );
      const viewport = new GlobeViewport({
        ...VIEWPORT,
        longitude: 0,
        latitude: 0,
        zoom: 4,
        bearing
      });
      layer.context = {viewport};
      const out: PlacementSymbol[] = [];
      layer.getPlacementSymbols(viewport, 0, out);
      const values = out[0].text!.circles!;
      // The mean of the circles' centres, from the anchor at (0, 100).
      let [x, y] = [0, 0];
      for (let k = 0; k < values.length; k += 3) {
        x += values[k] - PLACEMENT_VIEWPORT_PADDING;
        y += values[k + 1] - PLACEMENT_VIEWPORT_PADDING - 100;
      }
      return [x, y].map(value => value / (values.length / 3));
    };
    // 10 px to the left of an eastward line, as the view draws it: at bearing 40 the text reads
    // along the line, at bearing 100 it is turned around (screen y points down).
    for (const bearing of [40, 100]) {
      const radians = (bearing * Math.PI) / 180;
      const [x, y] = offset(bearing);
      expect(x).toBeCloseTo(-10 * Math.sin(radians), 1);
      expect(y).toBeCloseTo(-10 * Math.cos(radians), 1);
    }
  });

  test('on a turned globe, an icon along a line collides as it is drawn along the line', () => {
    const box = (bearing: number) => {
      const layer = labelLayer(
        {'icon-image': 'bar', 'symbol-placement': 'line', 'icon-padding': 0},
        [{properties: {}, x: 0}]
      );
      const viewport = new GlobeViewport({
        ...VIEWPORT,
        longitude: 0,
        latitude: 0,
        zoom: 4,
        bearing
      });
      layer.context = {viewport};
      const out: PlacementSymbol[] = [];
      layer.getPlacementSymbols(viewport, 0, out);
      const [x1, y1, x2, y2] = out[0].icon!.box!;
      return [Math.round(x2 - x1), Math.round(y2 - y1)];
    };
    // A bar along an eastward line: across the screen at bearing 0, up it at bearing 90.
    expect(box(0)).toEqual([16, 4]);
    expect(box(90)).toEqual([4, 16]);
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

  test("is not drawn in a view the deck's layerFilter keeps its topmost parent out of", () => {
    const layer = labelLayer({'text-field': 'x'}, [{properties: {}, x: 0}]);
    const root = {id: 'overlay', props: {visible: true}, parent: null, filterSubLayer: () => true};
    layer.parent = root;
    const filtered: string[] = [];
    layer.context = {
      deck: {
        props: {
          // Asked as deck.gl's screen pass asks it.
          layerFilter: ({layer: filteredLayer, viewport, renderPass, isPicking}: any) => {
            filtered.push(filteredLayer.id);
            return viewport.id === 'left' && renderPass === 'screen' && !isPicking;
          }
        }
      }
    };
    expect(layer.isDrawnIn({id: 'left'})).toBe(true);
    expect(layer.isDrawnIn({id: 'right'})).toBe(false);
    expect(filtered).toEqual(['overlay', 'overlay']);
  });

  test('its deck layer is its topmost parent, among the layers of its deck', () => {
    const layer = labelLayer({'text-field': 'x'}, [{properties: {}, x: 0}]);
    const root = {id: 'basemap', parent: null};
    layer.parent = {id: 'tiles', parent: root};
    const deckLayers = [root, layer.parent, layer];
    layer.context = {layerManager: {getLayers: () => deckLayers}};
    expect(layer.getPlacementRoot()).toEqual({root, layers: deckLayers});
    layer.context = {};
    expect(layer.getPlacementRoot()).toBe(null);
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

  test('while the sprites load, a symbol whose icon-image names an image waits for it', () => {
    const pending = (spriteAtlases: unknown, iconImage: unknown = 'dot') => {
      const layer = labelLayer(
        {'text-field': 'x', 'icon-image': iconImage},
        [{properties: {}, x: 100}],
        {spriteAtlases}
      );
      const out: PlacementSymbol[] = [];
      layer.getPlacementSymbols(VIEWPORT, 0, out);
      return out.map(({iconPending}) => Boolean(iconPending));
    };
    expect(pending(null)).toEqual([true]);
    expect(pending([ATLAS])).toEqual([false]);
    expect(pending([])).toEqual([false]);
    // An image expression names its image before the sprites hold it.
    expect(pending(null, ['image', 'dot'])).toEqual([true]);
    // An empty image name, or a token that resolves to none, has no icon to wait for.
    expect(pending(null, '')).toEqual([false]);
    expect(pending(null, '{missing}')).toEqual([false]);
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
