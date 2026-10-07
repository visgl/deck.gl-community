// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck, MapView, CompositeLayer, type Layer} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {WorldTreeLayer, TreeLayer} from '../../src';
import {getTestTreeTile, TEST_LEAF_ZOOM, type TestTree} from './fixtures/tree-inventory';

it('streams an independent inventory through region, forest and close views with one batched tree renderer and bounded submissions', async () => {
  const parent = document.createElement('div');
  parent.style.cssText = 'width:512px;height:512px';
  document.body.append(parent);
  const errors: string[] = [];
  let season = 'summer' as 'summer' | 'winter';
  let mergeIdentities = false;
  let identityRevision = 0;
  let authoredCoverage = 1,
    coverageRevision = 0;
  const getTreeKey = (tree: TestTree) =>
    mergeIdentities ? 'one-owner' : (tree as TestTree & {key: string}).key;
  const makeLayer = () =>
    new WorldTreeLayer<TestTree>({
      id: 'world',
      getTileData: getTestTreeTile,
      getTreeKey,
      updateTriggers: {getTreeKey: identityRevision},
      transitionDuration: 100,
      maxZoom: TEST_LEAF_ZOOM,
      targetFrameTime: 0,
      maxCanopySplats: 50000,
      maxShadowSplats: 30000,
      maxVisibleTiles: 16,
      treeProps: {
        getPosition: tree => tree.position,
        getTreeType: tree => tree.species,
        getHeight: tree => tree.height,
        getCanopyRadius: tree => tree.canopyRadius,
        getTrunkRadius: tree => tree.trunkRadius,
        getSeason: () => season,
        windStrength: 0,
        shadowEnabled: false,
        getCoverageWeight: (_tree, info) => authoredCoverage * (info.index >= 0 ? 1 : 0),
        updateTriggers: {getSeason: season, getCoverageWeight: coverageRevision}
      }
    });
  const deck = new Deck({
    parent,
    width: 512,
    height: 512,
    useDevicePixels: false,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: new MapView({controller: true}),
    initialViewState: {longitude: 0.00055, latitude: 0.00055, zoom: 1, pitch: 0},
    layers: [makeLayer()],
    onError: error => errors.push(error.message)
  });
  const current = () => deck.props.layers[0] as WorldTreeLayer<TestTree>;
  const leaves = (layer: Layer): Layer[] =>
    layer instanceof CompositeLayer ? layer.getSubLayers().flatMap(leaves) : [layer];
  try {
    await expect.poll(() => current().isLoaded, {timeout: 30000}).toBe(true);
    expect(current().streamingStats.residentTrees).toBe(0);
    await expect
      .poll(() => current().streamingStats.distantCrowns, {timeout: 30000})
      .toBeGreaterThan(0);
    for (const zoom of [19, 21, 19, 10, 21]) {
      deck.setProps({
        viewState: {
          longitude: 0.00055,
          latitude: 0.00055,
          zoom,
          pitch: zoom > 15 ? 80 : 0,
          bearing: 31
        }
      });
      await expect
        .poll(
          () =>
            current().isLoaded &&
            !current().state.coverage.active &&
            current().state.tileset?.selectedTiles?.some(tile => tile.isVisible),
          {timeout: 30000}
        )
        .toBe(true);
      await expect
        .poll(() => zoom < 15 || current().streamingStats.visibleTrees > 0, {timeout: 30000})
        .toBe(true);
      await expect
        .poll(
          () =>
            current()
              .getSubLayers()
              .filter(layer => layer instanceof TreeLayer).length,
          {timeout: 30000}
        )
        .toBe(zoom < 15 ? 0 : 1);
      const stats = current().streamingStats;
      expect(stats.selectedTiles).toBeLessThanOrEqual(16);
      expect(stats.cachedTiles).toBeLessThanOrEqual(80);
      expect(stats.residentTrees).toBeLessThan(65536);
      expect(stats.decodedBytes).toBeLessThan(32 * 1024 * 1024);
      expect(stats.canopySplats > 50000).toBe(stats.budgetExceeded);
      expect(leaves(current()).some(layer => layer.constructor.name === 'SolidPolygonLayer')).toBe(
        false
      );
      expect(
        current()
          .getSubLayers()
          .filter(layer => layer instanceof TreeLayer)
      ).toHaveLength(zoom < 15 ? 0 : 1);
    }
    const before = current()
      .getSubLayers()
      .find(layer => layer instanceof TreeLayer)!.props.data;
    season = 'winter';
    deck.setProps({layers: [makeLayer()]});
    await expect
      .poll(
        () =>
          current()
            .getSubLayers()
            .find(layer => layer instanceof TreeLayer)
            ?.props.getSeason?.(null),
        {timeout: 30000}
      )
      .toBe('winter');
    expect(
      current()
        .getSubLayers()
        .find(layer => layer instanceof TreeLayer)!.props.data
    ).toBe(before);
    expect(leaves(current()).filter(layer => layer.id.includes('canopy-oak')).length).toBe(0);
    // Ordinary accessors and their triggers survive the geographic wrapper.
    for (const value of [0.25, 0]) {
      authoredCoverage = value;
      coverageRevision++;
      deck.setProps({layers: [makeLayer()]});
      await expect
        .poll(
          () => {
            const trees = current()
              .getSubLayers()
              .find(layer => layer instanceof TreeLayer)!;
            const data = current().state.batch.trees;
            return trees.props.getCoverageWeight(data[0], {index: 0, data, target: []});
          },
          {timeout: 30000}
        )
        .toBe(value);
      const trees = current()
        .getSubLayers()
        .find(layer => layer instanceof TreeLayer)!;
      expect(trees.props.updateTriggers.getCoverageWeight).toContain(coverageRevision);
    }
    // A changed identity rule must regroup the already-loaded pages immediately.
    const loadedPages = current().state.batch.contents.slice();
    mergeIdentities = true;
    identityRevision++;
    deck.setProps({layers: [makeLayer()]});
    await expect.poll(() => current().state.batch.trees.length, {timeout: 30000}).toBe(1);
    expect(current().state.batch.contents).toEqual(loadedPages);
    mergeIdentities = false;
    identityRevision++;
    deck.setProps({layers: [makeLayer()]});
    await expect
      .poll(() => current().state.batch.trees.length, {timeout: 30000})
      .toBe(before.length);
    expect(errors).toEqual([]);
  } finally {
    deck.finalize();
    parent.remove();
  }
}, 90000);

it('crossfades density replacements without duplicating matching trees or exposing a ground-cell layer', async () => {
  const parent = document.createElement('div');
  parent.style.cssText = 'width:384px;height:384px';
  document.body.append(parent);
  const errors: string[] = [];
  let density = 400,
    revision = 0;
  const make = () =>
    new WorldTreeLayer<TestTree & {key: string}>({
      id: 'dense-world',
      getTileData: tile => getTestTreeTile(tile, density === 400 ? 4 : 8),
      getTreeKey: tree => tree.key,
      updateTriggers: {getTileData: revision},
      transitionDuration: 600,
      maxZoom: TEST_LEAF_ZOOM,
      maxVisibleTiles: 16,
      targetFrameTime: 0,
      maxCanopySplats: 20000,
      treeProps: {
        getPosition: tree => tree.position,
        getTreeType: tree => tree.species,
        getHeight: tree => tree.height,
        getCanopyRadius: tree => tree.canopyRadius,
        getTrunkRadius: tree => tree.trunkRadius,
        windStrength: 0,
        shadowEnabled: false
      }
    });
  const deck = new Deck({
    parent,
    width: 384,
    height: 384,
    useDevicePixels: false,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: new MapView(),
    initialViewState: {
      longitude: 0.00055,
      latitude: 0.00055,
      zoom: 21,
      pitch: 60,
      position: [0, 0, 42]
    },
    layers: [make()],
    onError: error => errors.push(error.message)
  });
  const current = () => deck.props.layers[0] as WorldTreeLayer<TestTree & {key: string}>;
  try {
    await expect.poll(() => current().isLoaded, {timeout: 30000}).toBe(true);
    await expect
      .poll(() => current().streamingStats.visibleTrees, {timeout: 30000})
      .toBeGreaterThan(0);
    const before = new Map(current().state.batch.trees.map(tree => [tree.key, tree]));
    expect(before.size).toBeGreaterThan(0);
    density = 800;
    revision++;
    deck.setProps({layers: [make()]});
    await expect.poll(() => current().state.coverage.active, {timeout: 30000}).toBe(true);
    const active = current(),
      rows = active.state.batch.trees;
    expect(new Set(rows.map(tree => tree.key)).size).toBe(rows.length);
    const treeLayer = active.getSubLayers().find(layer => layer instanceof TreeLayer)!;
    let retained = 0;
    for (const row of rows)
      if (before.has(row.key) && active.state.treePages.get(row)!.length > 1) {
        retained++;
        expect(row).toBe(before.get(row.key));
        expect(
          (treeLayer.props.getCoverageWeight as (value: TestTree & {key: string}) => number)(row)
        ).toBeCloseTo(1, 5);
      }
    expect(retained).toBeGreaterThan(0);
    expect(active.streamingStats.transitioningPages).toBeGreaterThan(0);
    expect(active.state.coverage.entries.size).toBeLessThanOrEqual(32);
    await expect.poll(() => current().isLoaded, {timeout: 30000}).toBe(true);
    expect(current().streamingStats.transitioningPages).toBe(0);
    for (const tree of current().state.batch.trees)
      if (before.has(tree.key)) expect(tree).toBe(before.get(tree.key));
    expect(current().streamingStats.visibleTrees).toBeGreaterThan(before.size);
    expect(errors).toEqual([]);
  } finally {
    deck.finalize();
    parent.remove();
  }
}, 45000);
