// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, test, vi} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer';
import {getPoleOfInaccessibility} from '../src/polylabel';

function square(x: number, y: number, size: number): number[][] {
  return [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y]
  ];
}

/** A comb with `teeth` slots: many cells compete for the best distance, so a search runs long. */
function comb(teeth: number): number[][][] {
  const ring: number[][] = [[0, 0]];
  for (let i = 0; i < teeth; i++) {
    ring.push([i * 2 + 1, 0], [i * 2 + 1, 100], [i * 2 + 2, 100], [i * 2 + 2, 0]);
  }
  ring.push([teeth * 2 + 1, 0], [teeth * 2 + 1, -1], [0, -1], [0, 0]);
  return [ring];
}

/**
 * Counts the cells a search scores. Scoring a cell walks the polygon's rings once, reading ring 0;
 * the search reads ring 0 three more times while setting up.
 */
function countScoredCells(polygon: number[][][], run: (counted: number[][][]) => void): number {
  let ringZeroReads = 0;
  const counted = new Proxy(polygon, {
    get(target, key, receiver) {
      if (key === '0') {
        ringZeroReads++;
      }
      return Reflect.get(target, key, receiver);
    }
  });
  run(counted);
  return ringZeroReads - 3;
}

function createLayer(props: Record<string, unknown> = {}, layout: Record<string, unknown> = {}) {
  return new MVTLabelLayer({
    id: 'polygon-labels',
    config: {labels: true},
    zoom: 14,
    styleLayer: {layout: {'text-field': '{name}', ...layout}},
    ...props
  });
}

test('charges every scored cell, including the setup cells, to the budget', () => {
  const polygon = comb(50);
  const vertexCount = polygon[0].length;
  const budget = {segmentTests: 40 * vertexCount};
  const cells = countScoredCells(polygon, counted => {
    getPoleOfInaccessibility(counted, 0, budget);
  });
  // The comb has more than 40 cells to score, so the budget is the limit.
  expect(cells).toBeGreaterThan(0);
  expect(cells * vertexCount).toBeLessThanOrEqual(40 * vertexCount);
  expect(budget.segmentTests).toBe(40 * vertexCount - cells * vertexCount);
  expect(budget.segmentTests).toBeGreaterThanOrEqual(0);
});

test('returns the best point so far when the budget runs out, and null when it cannot start', () => {
  const polygon = [square(0, 0, 1)];
  const vertexCount = polygon[0].length;
  expect(getPoleOfInaccessibility(polygon, 0, {segmentTests: vertexCount - 1})).toBeNull();
  const pole = getPoleOfInaccessibility(polygon, 0, {segmentTests: vertexCount});
  expect(pole?.[0]).toBeCloseTo(0.5, 6);
  expect(pole?.[1]).toBeCloseTo(0.5, 6);
});

test('shares one budget across the polygons of a tile', () => {
  // Each comb alone can use the whole per-search budget; together they would exceed the tile's.
  const features = Array.from({length: 40}, () => ({
    // Scaled into the tile's [0, 1) square so the poles are kept.
    geometry: {
      type: 'Polygon',
      coordinates: comb(2500).map(ring => ring.map(([x, y]) => [x / 5002, (y + 1) / 102]))
    }
  }));
  const start = performance.now();
  const rows = createLayer().getLabelData(features as any, false);
  const elapsed = performance.now() - start;
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThan(features.length);
  expect(elapsed).toBeLessThan(10000);
});

test('evaluates symbol-placement once per tile, not per feature', () => {
  const layer = createLayer();
  const placement = vi.spyOn(layer, 'getSymbolPlacement');
  const features = [0.1, 0.4, 0.7].map(x => ({
    geometry: {type: 'Polygon', coordinates: [square(x, 0.1, 0.2)]}
  }));
  layer.getLabelData(features as any, false);
  expect(placement).toHaveBeenCalledTimes(1);
});

test('labels a polygon in two tiles once, in the tile that holds its pole', () => {
  // A 0.2-wide square across the edge between tiles A and B, in both buffers. Its pole is at
  // x = 1.05 in tile A's coordinates, outside A, and at x = 0.05 in tile B's, inside B.
  const shiftedA = [square(0.95, 0.4, 0.2)];
  const shiftedB = [square(-0.05, 0.4, 0.2)];
  expect(
    createLayer().getLabelAnchors(
      {geometry: {type: 'Polygon', coordinates: shiftedA}} as any,
      false
    )
  ).toEqual([]);
  expect(
    createLayer().getLabelAnchors(
      {geometry: {type: 'Polygon', coordinates: shiftedB}} as any,
      false
    )
  ).toHaveLength(1);
});

test('drops globe polygon labels outside the tile bounding box', () => {
  const polygon = [square(13.5, 52.4, 0.2)];
  const tileBoundingBox = {west: 13.0, south: 52.0, east: 13.55, north: 53.0};
  expect(
    createLayer({tileBoundingBox}).getLabelAnchors(
      {geometry: {type: 'Polygon', coordinates: polygon}} as any,
      true
    )
  ).toEqual([]);
  expect(
    createLayer({tileBoundingBox: {...tileBoundingBox, east: 14}}).getLabelAnchors(
      {geometry: {type: 'Polygon', coordinates: polygon}} as any,
      true
    )
  ).toHaveLength(1);
});

/** Runs `updateState` outside deck.gl, carrying state over as deck.gl does between updates. */
function update(layer: MVTLabelLayer, state: Record<string, any>, dataChanged: boolean): void {
  (layer as any).state = state;
  (layer as any).setState = (partial: Record<string, any>) => Object.assign(state, partial);
  layer.updateState({changeFlags: {dataChanged}} as any);
}

test('recomputes anchors when symbol-placement changes with zoom, without new tile data', () => {
  const data = [{geometry: {type: 'Polygon', coordinates: [square(0.1, 0.1, 0.4)]}}];
  const layout = {'symbol-placement': ['step', ['zoom'], 'point', 12, 'line']};
  const state: Record<string, any> = {};
  update(createLayer({data, zoom: 11}, layout), state, true);
  expect(state.labelData).toHaveLength(1);
  update(createLayer({data, zoom: 12.5}, layout), state, false);
  expect(state.labelData).toHaveLength(0);
});

test('keeps the anchors when an unrelated prop changes', () => {
  const data = [{geometry: {type: 'Polygon', coordinates: [square(0.1, 0.1, 0.4)]}}];
  const state: Record<string, any> = {};
  update(createLayer({data}), state, true);
  const first = state.labelData;
  update(createLayer({data, textColor: [1, 2, 3]}), state, false);
  expect(state.labelData).toBe(first);
});
