// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it, vi} from 'vitest';
import {WebMercatorViewport} from '@deck.gl/core';
import {WorldTreeLayer} from '../../src/tree-layer/world-tree-layer';
import {TreeLayer} from '../../src/tree-layer/tree-layer';
import {TreeTileLayer} from '../../src/tree-layer/tree-tile-layer';
import {TreeTileset} from '../../src/tree-layer/tree-tileset';
import {TreeFrameBudget} from '../../src/tree-layer/tree-frame-budget';
import {validateTreeTile} from '../../src/tree-layer/tree-tile-data';

it('uses the same public TreeLayer for rows and streamed inventories without recursive tile sources', () => {
  const tree = {position: [0, 0] as [number, number], species: 'oak' as const};
  const getTileData = vi.fn(() => ({trees: [tree], canopies: [], byteLength: 64}));
  const getCanopyColor = () => [20, 140, 40, 255] as [number, number, number, number];
  const getDistantCanopyColor = () => [80, 150, 60, 255] as [number, number, number, number];
  const layer = new TreeLayer({
    id: 'one-tree-api',
    getTileData,
    getCanopyColor,
    getDistantCanopyColor,
    getHeight: 16,
    getSeason: 'winter',
    maxVisibleTiles: 12,
    windStrength: 0.03,
    updateTriggers: {getDistantCanopyColor: 'winter', getTileData: 1}
  });
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  layer.updateState({props: layer.props, oldProps: layer.props, changeFlags: {dataChanged: true}});
  const inventory = layer.renderLayers()[0] as TreeTileLayer<typeof tree>;
  expect(inventory).toBeInstanceOf(TreeTileLayer);
  expect(inventory.props.getTileData).toBe(getTileData);
  expect(inventory.props.maxVisibleTiles).toBe(12);
  expect(inventory.props.getCanopyColor).toBe(getDistantCanopyColor);
  expect(inventory.props.updateTriggers.getCanopyColor).toBe('winter');
  expect(inventory.props.canopyWindStrength).toBe(0.03);
  expect(inventory.props.treeProps?.getCanopyColor).toBe(getCanopyColor);
  expect(inventory.props.treeProps?.getHeight).toBe(16);
  expect(inventory.props.treeProps?.getTileData).toBeUndefined();
  expect(getTileData).not.toHaveBeenCalled();
  const oldProps = layer.props;
  Object.assign(layer, {props: layer.clone({getTileData: undefined, data: [tree]}).props});
  layer.updateState({props: layer.props, oldProps, changeFlags: {dataChanged: true}});
  expect(layer.renderLayers().some(child => child.id.includes('wood'))).toBe(true);
  expect(layer.renderLayers().some(child => child instanceof TreeTileLayer)).toBe(false);
  expect(() =>
    layer.updateState({
      props: {...layer.props, getTileData},
      oldProps,
      changeFlags: {dataChanged: true}
    })
  ).toThrow('either data rows or getTileData');
});

it('caps the geographic frontier by coarsening, including pitched horizon and antimeridian views', () => {
  const tileset = new TreeTileset({
    getTileData: () => null!,
    minZoom: 0,
    maxZoom: 18,
    tileSize: 512,
    maxVisibleTiles: 16
  } as ConstructorParameters<typeof TreeTileset>[0]);
  for (const zoom of [1, 8, 16, 18, 22])
    for (const pitch of [0, 60, 80])
      for (const longitude of [0, 179.99]) {
        const viewport = new WebMercatorViewport({
          width: 1600,
          height: 1000,
          longitude,
          latitude: 45,
          zoom,
          pitch,
          bearing: 31
        });
        const indices = tileset.getTileIndices({
          viewport,
          maxZoom: 18,
          minZoom: 0,
          zRange: [0, 100]
        });
        expect(indices.length).toBeLessThanOrEqual(16);
        expect(indices.length).toBeGreaterThan(0);
      }
  tileset.finalize();
});
it('rejects oversized decoded content instead of letting one tile expand without bound', () => {
  expect(() => validateTreeTile({trees: [1, 2, 3], canopies: [], byteLength: 12}, 2, 100)).toThrow(
    'record limit'
  );
  expect(() => validateTreeTile({trees: [], canopies: [], byteLength: 101}, 2, 100)).toThrow(
    'byte limit'
  );
});
it('reduces refinement under sustained frame pressure and recovers with hysteresis, ignoring idle gaps', () => {
  const controller = new TreeFrameBudget();
  let now = 0;
  for (let i = 0; i < 100; i++) {
    now += 25;
    controller.sample(now, 1000 / 60, 0.125);
  }
  expect(controller.scale).toBeLessThan(1);
  const reduced = controller.scale;
  now += 5000;
  controller.sample(now, 1000 / 60, 0.125);
  expect(controller.scale).toBe(reduced);
  for (let i = 0; i < 500; i++) {
    now += 8;
    controller.sample(now, 1000 / 60, 0.125);
  }
  expect(controller.scale).toBeGreaterThan(reduced);
  for (let i = 0; i < 1500; i++) {
    now += 30;
    controller.sample(now, 1000 / 60, 0.125);
  }
  expect(controller.scale).toBe(0.125);
});

it('holds parent coverage during replacement and aborts obsolete fine requests while navigating', async () => {
  const pending: {signal?: AbortSignal; resolve: () => void}[] = [];
  const aborted: AbortSignal[] = [];
  const tileset = new TreeTileset({
    maxVisibleTiles: 16,
    minZoom: 0,
    maxZoom: 18,
    tileSize: 512,
    maxCacheSize: 32,
    maxCacheByteSize: 1024 * 1024,
    maxRequests: 4,
    refinementStrategy: 'no-overlap',
    getTileData: tile =>
      tile.index.z < 2
        ? Promise.resolve({byteLength: 1})
        : new Promise(resolve => {
            const item = {signal: tile.signal, resolve: () => resolve({byteLength: 1})};
            pending.push(item);
            tile.signal?.addEventListener(
              'abort',
              () => {
                aborted.push(tile.signal!);
                resolve(null);
              },
              {once: true}
            );
          })
  } as ConstructorParameters<typeof TreeTileset>[0]);
  const frame = (longitude: number, zoom: number) =>
    tileset.update(
      new WebMercatorViewport({width: 600, height: 600, longitude, latitude: 0, zoom, pitch: 0}),
      {zRange: [0, 100], modelMatrix: null}
    );
  const settle = async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
  };
  try {
    frame(0, 0);
    await settle();
    frame(0, 0);
    expect(tileset.isLoaded).toBe(true);
    const parent = tileset.tiles.find(tile => tile.isVisible)!;
    frame(0, 19);
    await settle();
    frame(0, 19);
    expect(pending.length).toBeGreaterThan(0);
    expect(parent.isVisible).toBe(true);
    expect(tileset.tiles.filter(tile => tile.isVisible)).toEqual([parent]);
    frame(120, 19);
    await settle();
    frame(120, 19);
    expect(aborted.length).toBeGreaterThan(0);
    expect(parent.isVisible).toBe(true);
    for (let wave = 0; wave < 8 && !tileset.isLoaded; wave++) {
      for (const item of pending.splice(0)) item.resolve();
      await settle();
      frame(120, 19);
    }
    expect(tileset.isLoaded).toBe(true);
    expect(parent.isVisible).toBe(false);
    expect(tileset.selectedTiles!.every(tile => tile.isVisible && tile.isLoaded)).toBe(true);
    expect(tileset.tiles.length).toBeLessThanOrEqual(32);
    expect(tileset.selectedTiles!.length).toBeLessThanOrEqual(16);
  } finally {
    tileset.finalize();
  }
});

it('keeps nearby source refinement when limiting a horizon frontier and retains every requested region', () => {
  const viewport = new WebMercatorViewport({
    width: 1600,
    height: 1000,
    longitude: 0,
    latitude: 0,
    zoom: 18,
    pitch: 80,
    bearing: 31
  });
  const options = {viewport, maxZoom: 18, minZoom: 0, zRange: [0, 100] as [number, number]};
  const make = (maxVisibleTiles: number) =>
    new TreeTileset({
      getTileData: () => null!,
      minZoom: 0,
      maxZoom: 18,
      tileSize: 512,
      maxVisibleTiles
    } as ConstructorParameters<typeof TreeTileset>[0]);
  const bounded = make(32),
    full = make(100000);
  try {
    const selected = bounded.getTileIndices(options),
      desired = full.getTileIndices(options);
    expect(selected.length).toBeLessThanOrEqual(32);
    expect(Math.max(...selected.map(index => index.z))).toBe(18);
    for (const leaf of desired)
      expect(
        selected.some(
          parent =>
            parent.z <= leaf.z &&
            Math.floor(leaf.x / 2 ** (leaf.z - parent.z)) === parent.x &&
            Math.floor(leaf.y / 2 ** (leaf.z - parent.z)) === parent.y
        )
      ).toBe(true);
    for (const a of selected)
      for (const b of selected)
        if (a !== b && a.z <= b.z)
          expect(
            Math.floor(b.x / 2 ** (b.z - a.z)) === a.x && Math.floor(b.y / 2 ** (b.z - a.z)) === a.y
          ).toBe(false);
  } finally {
    bounded.finalize();
    full.finalize();
  }
});

import {TreeCoverageTransition} from '../../src/tree-layer/tree-coverage-transition';
it('conserves source coverage through interrupted replacement without snapping', () => {
  const blend = new TreeCoverageTransition<string>();
  blend.reconcile(['parent'], 0, 1000);
  blend.reconcile(['child'], 100, 1000);
  blend.sample(600, 1000);
  expect(blend.entries.get('parent')!.weight).toBeCloseTo(0.5);
  expect(blend.entries.get('child')!.weight).toBeCloseTo(0.5);
  const before = [...blend.entries.values()].map(entry => entry.weight);
  blend.reconcile(['parent'], 600, 1000);
  expect([...blend.entries.values()].map(entry => entry.weight)).toEqual(before);
  blend.sample(1100, 1000);
  expect(blend.entries.get('parent')!.weight + blend.entries.get('child')!.weight).toBeCloseTo(1);
  blend.sample(1600, 1000);
  expect([...blend.entries.keys()]).toEqual(['parent']);
  expect(blend.active).toBe(false);
});
it('bounds interrupted transition history while retaining every current source page', () => {
  const blend = new TreeCoverageTransition<number>();
  for (let i = 0; i < 100; i++) {
    blend.reconcile([i], i * 10, 1000);
    blend.trim(4, [i]);
  }
  expect(blend.entries.size).toBeLessThanOrEqual(4);
  expect(blend.entries.has(99)).toBe(true);
});

it('retains full regional coverage when a third page interrupts an existing replacement', () => {
  const blend = new TreeCoverageTransition<string>();
  blend.reconcile(['a'], 0, 1000);
  blend.reconcile(['b'], 100, 1000);
  blend.reconcile(['c'], 600, 1000);
  for (const now of [650, 850, 1100, 1400, 1600]) {
    blend.sample(now, 1000);
    expect([...blend.entries.values()].reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(
      1
    );
  }
  expect([...blend.entries.keys()]).toEqual(['c']);
});

it('retains full quality at a stable 60Hz delivery interval', () => {
  const controller = new TreeFrameBudget();
  for (let i = 0; i < 600; i++) controller.sample((i * 1000) / 60, 1000 / 60, 0.125);
  expect(controller.scale).toBe(1);
});

it('responds to sustained animated loading stalls instead of treating every slow frame as idle', () => {
  const controller = new TreeFrameBudget();
  for (let i = 0; i < 150; i++) controller.sample(i * 120, 1000 / 60, 0.125, true);
  expect(controller.scale).toBeLessThan(0.5);
  const reduced = controller.scale;
  controller.sample(50000, 1000 / 60, 0.125, true);
  expect(controller.scale).toBe(reduced);
});

it('gradually restores reduced quality at 60Hz after sustained pressure clears', () => {
  const controller = new TreeFrameBudget();
  for (let i = 1; i <= 150; i++) controller.sample(i * 80, 1000 / 60, 0.125, true);
  const reduced = controller.scale;
  expect(reduced).toBeLessThan(0.5);
  for (let i = 1; i <= 600; i++) controller.sample(12000 + (i * 1000) / 60, 1000 / 60, 0.125, true);
  expect(controller.scale).toBeGreaterThan(reduced);
  expect(controller.scale).toBeLessThan(reduced * 1.25);
});

it('maps species-local picks by original owner and selects its strongest replacement page', () => {
  const a = {species: 'oak'},
    b = {species: 'palm'};
  const pageA = {trees: [a], canopies: [], byteLength: 1};
  const pageB = {trees: [b], canopies: [], byteLength: 1};
  const replacement = {trees: [b], canopies: [], byteLength: 1};
  const canopy = {position: [0, 0, 0], scale: [1, 1, 1], color: [100, 150, 100, 255]};
  const canopyPage = {trees: [], canopies: [canopy], byteLength: 1};
  const tileA = {id: 'a', content: pageA},
    tileB = {id: 'b', content: pageB};
  const tileReplacement = {id: 'replacement', content: replacement};
  const canopyTile = {id: 'coarse-canopy', content: canopyPage};
  const layer = new WorldTreeLayer({id: 'picking', getTileData: () => pageA});
  Object.assign(layer, {
    state: {
      treePages: new Map([
        [a, [pageA]],
        [b, [pageB, replacement]]
      ]),
      canopyPages: new Map([[canopy, canopyPage]]),
      pageTiles: new Map([
        [pageA, tileA],
        [pageB, tileB],
        [replacement, tileReplacement],
        [canopyPage, canopyTile]
      ]),
      coverage: {
        entries: new Map([
          [pageA, {weight: 1}],
          [pageB, {weight: 0.2}],
          [replacement, {weight: 0.8}],
          [canopyPage, {weight: 1}]
        ])
      }
    }
  });
  const sourceLayer = {id: 'picking-trees-canopy-palm-0'};
  const info = {object: b, index: 0};
  const picked = layer.getPickingInfo({info, sourceLayer} as any);
  expect(picked.object).toBe(b);
  expect(picked.tile).toBe(tileReplacement);
  expect(picked.sourceTile).toBe(tileReplacement);
  expect(picked.sourceTileSubLayer).toBe(sourceLayer);
  expect(layer.getPickingInfo({info: {object: a, index: 99}, sourceLayer} as any).tile).toBe(tileA);
  const canopySource = {id: 'picking-distant-crowns-refinement-0'};
  const canopyPick = layer.getPickingInfo({
    info: {object: canopy, index: 99},
    sourceLayer: canopySource
  } as any);
  expect(canopyPick.object).toBe(canopy);
  expect(canopyPick.tile).toBe(canopyTile);
  expect(canopyPick.sourceTile).toBe(canopyTile);
  expect(canopyPick.sourceTileSubLayer).toBe(canopySource);
});
