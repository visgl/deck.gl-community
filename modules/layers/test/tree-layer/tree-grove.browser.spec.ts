// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck, MapView, WebMercatorViewport} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/core/webgl';
import {expect, it} from 'vitest';
import {TreeLayer, type TreeSpec} from '../../src';
import {getTreeRenderTiers} from './tree-grove-test-utils';

const GRID_SIDE = 100;
const TREE_COUNT = GRID_SIDE * GRID_SIDE;
const TREE_SPACING = 12;
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
  species: 'citrus',
  wind: false
}));

it('refines a 10,000-tree citrus grove in a grazing view and retains source owners', async () => {
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
        coordinateSystem: 'meter-offsets',
        coordinateOrigin: [0, 0, 0],
        getTree: tree => tree,
        windStrength: 0,
        pickable: true
      })
    ],
    onError: error => errors.push(error.message),
    onAfterRender: () => frames++
  });
  const treeLayer = () =>
    deck['layerManager']
      ?.getLayers()
      .find((layer): layer is TreeLayer<TreeSpec> => layer instanceof TreeLayer);
  const waitForFrames = async (count: number) => {
    const before = frames;
    await expect.poll(() => frames, {timeout: 60_000}).toBeGreaterThan(before + count);
  };
  const getTiers = () => getTreeRenderTiers(treeLayer());
  try {
    await expect.poll(() => getTiers().size, {timeout: 60_000}).toBeGreaterThan(1_000);
    const rows = treeLayer()!.state.photoreal!.rows;
    expect(rows).toHaveLength(TREE_COUNT);
    const overview = getTiers();
    expect([...overview.values()].some(tier => tier >= 5)).toBe(true);

    deck.setProps({viewState: GRAZING_VIEW_STATE});
    await waitForFrames(6);
    const viewport = deck.getViewports()[0];
    const detail = [...getTiers()]
      .map(([owner, tier]) => {
        const [x, y] = owner.position!;
        const west = getMapCenter(x - 2, y);
        const east = getMapCenter(x + 2, y);
        const a = viewport.project([west.longitude, west.latitude, 3]);
        const b = viewport.project([east.longitude, east.latitude, 3]);
        return {pixels: Math.hypot(a[0] - b[0], a[1] - b[1]), tier};
      })
      .sort((a, b) => b.pixels - a.pixels);
    expect(detail.length).toBeGreaterThanOrEqual(50);
    const cohort = Math.max(25, Math.floor(detail.length * 0.05));
    const near = detail.slice(0, cohort);
    const far = detail.slice(-cohort);
    const averageTier = (entries: typeof detail) =>
      entries.reduce((total, row) => total + row.tier, 0) / entries.length;
    expect(near[0].pixels).toBeGreaterThan(far.at(-1)!.pixels * 1.5);
    expect(new Set(detail.map(row => row.tier)).size).toBeGreaterThan(1);
    expect(averageTier(near)).toBeLessThan(averageTier(far));

    // Test all source trees against an independent screen projection, including missing rows.
    // Ignore subpixel crowns and centers grazing the screen or depth clip planes.
    for (const pitch of [50, 74]) {
      deck.setProps({viewState: {...GRAZING_VIEW_STATE, pitch}});
      await waitForFrames(4);
      const view = deck.getViewports()[0];
      const visible = getTiers();
      let expected = 0;
      const missing: number[] = [];
      for (const [index, owner] of grove.entries()) {
        const [x, y] = owner.position!;
        const project = (east: number) => {
          const {longitude, latitude} = getMapCenter(east, y);
          return view.project([longitude, latitude, 2.4]);
        };
        const [cx, cy, depth] = project(x);
        if (
          cx < 12 ||
          cx > STAGE_WIDTH - 12 ||
          cy < 12 ||
          cy > STAGE_HEIGHT - 12 ||
          depth <= -1 ||
          depth >= 1
        )
          continue;
        const west = project(x - 2);
        const east = project(x + 2);
        if (Math.hypot(east[0] - west[0], east[1] - west[1]) < 8) continue;
        expected++;
        if (!visible.has(owner)) missing.push(index);
      }
      expect(expected).toBeGreaterThan(50);
      expect(missing).toEqual([]);
    }

    deck.setProps({viewState: {...GRAZING_VIEW_STATE, ...getMapCenter(TREE_SPACING / 4, 0)}});
    await waitForFrames(4);
    expect(treeLayer()!.state.photoreal!.rows).toBe(rows);
    expect(getTiers().size).toBeGreaterThan(0);
    const owners = new Set(grove);
    const picks = deck.pickObjects({
      x: STAGE_WIDTH / 4,
      y: STAGE_HEIGHT / 4,
      width: STAGE_WIDTH / 2,
      height: STAGE_HEIGHT / 2
    });
    expect(picks.some(info => owners.has(info.object))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    deck.finalize();
    parent.remove();
  }
}, 120_000);
