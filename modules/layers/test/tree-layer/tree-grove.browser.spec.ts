// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {COORDINATE_SYSTEM, Deck, MapView, WebMercatorViewport} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {SplatLayer, TreeLayer, type TreeSpec} from '../../src';

const GRID_SIDE = 100;
const TREE_COUNT = GRID_SIDE * GRID_SIDE;
const TREE_SPACING = 12;
const MAX_CANOPY_SPLATS = 20_000;
const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 752;
const GROVE_EXTENT = GRID_SIDE * TREE_SPACING;
const MAP_ORIGIN = new WebMercatorViewport({width: 1, height: 1});
const METER_ZOOM = Math.log2(1 / MAP_ORIGIN.distanceScales.unitsPerMeter[0]);
const getMapCenter = (x: number, y: number) => {
  const [longitude, latitude] = MAP_ORIGIN.addMetersToLngLat([0, 0], [x, y]);
  return {longitude, latitude};
};
const VIEW_STATE = {
  ...getMapCenter(0, 0),
  position: [0, 0, 3],
  pitch: 42,
  bearing: 0,
  zoom:
    METER_ZOOM + Math.log2(0.75 * Math.min(STAGE_WIDTH / GROVE_EXTENT, STAGE_HEIGHT / GROVE_EXTENT))
};
const GRAZING_VIEW_STATE = {
  // A close LOD-detail camera: it culls most of the grove, while a low
  // perspective angle leaves enough depth range to prove per-crown selection.
  ...getMapCenter(0, -GROVE_EXTENT * 0.1),
  position: [0, 0, 3],
  pitch: 50,
  bearing: 20,
  zoom: METER_ZOOM + Math.log2(Math.min(STAGE_WIDTH / 220, STAGE_HEIGHT / 150))
};

const grove: TreeSpec[] = Array.from({length: TREE_COUNT}, (_, index) => ({
  position: [
    ((index % GRID_SIDE) - (GRID_SIDE - 1) / 2) * TREE_SPACING,
    (Math.floor(index / GRID_SIDE) - (GRID_SIDE - 1) / 2) * TREE_SPACING,
    0
  ],
  species: 'citrus'
}));

it('keeps a 10,000-tree citrus grove within budget and refines a grazing view by projected error', async () => {
  const parent = document.createElement('div');
  parent.style.cssText = `width:${STAGE_WIDTH}px;height:${STAGE_HEIGHT}px`;
  document.body.append(parent);
  const errors: string[] = [];
  let frames = 0;
  const deck = new Deck({
    parent,
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    useDevicePixels: false,
    _animate: true,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: new MapView({id: 'tree-grove', nearZMultiplier: 0.02}),
    initialViewState: VIEW_STATE,
    layers: [
      new TreeLayer<TreeSpec>({
        id: 'citrus-grove',
        data: grove,
        coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
        coordinateOrigin: [0, 0, 0],
        getTree: tree => tree,
        maxCanopySplats: MAX_CANOPY_SPLATS,
        windEnabled: false
      })
    ],
    onError: error => errors.push(error.message),
    onAfterRender: () => frames++
  });
  const canopy = () =>
    deck.layerManager
      ?.getLayers()
      .find((layer): layer is SplatLayer => layer instanceof SplatLayer);
  const waitForFrames = async (count: number) => {
    const before = frames;
    await expect.poll(() => frames, {timeout: 60_000}).toBeGreaterThan(before + count);
  };
  const waitForSettledCanopy = async () => {
    await waitForFrames(6);
    await expect.poll(() => canopy()?.state.refinement.active, {timeout: 60_000}).toBe(false);
  };
  try {
    await expect.poll(() => canopy()?.state.owners.length, {timeout: 60_000}).toBe(TREE_COUNT);
    await expect
      .poll(() => canopy()?.splatStats.visibleInstances ?? 0, {timeout: 60_000})
      .toBeGreaterThan(0);
    await waitForSettledCanopy();

    const before = canopy()!;
    const beforeStats = before.splatStats;
    expect(
      deck.layerManager!.getLayers().filter(layer => layer instanceof SplatLayer)
    ).toHaveLength(1);
    expect(before.props.transparency).toBe('weighted');
    expect(before.state.owners).toHaveLength(TREE_COUNT);
    expect(beforeStats.visibleInstances).toBeGreaterThan(0);
    expect(beforeStats.renderedSplats).toBeGreaterThan(0);
    // The settled allocator uses most of the public cap; the remaining headroom is reserved for
    // short optical old/new mixtures during camera-driven refinement.
    expect(beforeStats.renderedSplats).toBeGreaterThan(MAX_CANOPY_SPLATS * 0.75);
    // If the coarsest representation alone needs more than the allocation, retain coverage.
    expect(beforeStats.renderedSplats).toBeLessThanOrEqual(
      Math.max(MAX_CANOPY_SPLATS, beforeStats.coverageFloor)
    );
    deck.setProps({viewState: GRAZING_VIEW_STATE});
    await waitForFrames(2);
    // A broad camera retarget must select the runtime's per-owner allocation promptly, while the
    // renderer retains the old coverage until the new hierarchy mixtures have faded in.
    const retargeted = canopy()!;
    const retargetedAllocation = retargeted.state.candidates
      .map(candidate => ({
        pixels: candidate.pixels,
        level: retargeted.state.refinement.entries.get(candidate.owner.key)?.level
      }))
      .filter((row): row is {pixels: number; level: number} => row.level !== undefined)
      .sort((a, b) => b.pixels - a.pixels);
    const retargetedCohortSize = Math.max(25, Math.floor(retargetedAllocation.length * 0.05));
    const retargetedNear = retargetedAllocation.slice(0, retargetedCohortSize);
    const retargetedFar = retargetedAllocation.slice(-retargetedCohortSize);
    const averageLevel = (rows: {level: number}[]) =>
      rows.reduce((sum, row) => sum + row.level, 0) / rows.length;

    expect(retargetedAllocation.length).toBeGreaterThanOrEqual(50);
    expect(retargetedNear[0].pixels).toBeGreaterThan(retargetedFar.at(-1)!.pixels * 1.5);
    expect(new Set(retargetedAllocation.map(row => row.level)).size).toBeGreaterThan(1);
    expect(averageLevel(retargetedNear)).toBeLessThan(averageLevel(retargetedFar));
    expect(retargeted.state.refinement.active).toBe(true);
    await waitForSettledCanopy();
    const tilted = canopy()!;
    const allocation = tilted.state.candidates
      .map(candidate => ({
        pixels: candidate.pixels,
        level: tilted.state.refinement.entries.get(candidate.owner.key)?.dominant
      }))
      .filter((row): row is {pixels: number; level: number} => row.level !== undefined)
      .sort((a, b) => b.pixels - a.pixels);
    const cohortSize = Math.max(25, Math.floor(allocation.length * 0.05));
    const near = allocation.slice(0, cohortSize);
    const far = allocation.slice(-cohortSize);

    expect(allocation.length).toBeGreaterThanOrEqual(50);
    expect(near[0].pixels).toBeGreaterThan(far.at(-1)!.pixels * 1.5);
    // Lower hierarchy indices are finer. TreeLayer forwards the common source and cap; the
    // SplatLayer must select independently by projected error instead of a source-wide tier.
    expect(new Set(allocation.map(row => row.level)).size).toBeGreaterThan(1);
    expect(averageLevel(near)).toBeLessThan(averageLevel(far));

    const owners = before.state.owners;
    const spatialIndex = before.state.spatialIndex;
    deck.setProps({
      viewState: {...GRAZING_VIEW_STATE, ...getMapCenter(TREE_SPACING / 4, 0)}
    });
    await waitForFrames(4);

    const moved = canopy()!;
    expect(moved.state.owners).toBe(owners);
    expect(moved.state.spatialIndex).toBe(spatialIndex);
    await waitForSettledCanopy();
    const movedStats = moved.splatStats;
    expect(movedStats.visibleInstances).toBeGreaterThan(0);
    expect(movedStats.renderedSplats).toBeGreaterThan(0);
    expect(movedStats.renderedSplats).toBeLessThanOrEqual(
      Math.max(MAX_CANOPY_SPLATS, movedStats.coverageFloor)
    );
    expect(errors).toEqual([]);
  } finally {
    deck.finalize();
    parent.remove();
  }
}, 120_000);
