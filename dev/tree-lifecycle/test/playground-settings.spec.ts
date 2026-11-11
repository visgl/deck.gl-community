// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {
  applyAttributePatch,
  createPlaygroundField,
  createFieldDetailGovernor,
  getFieldCamera,
  getOrbitCamera,
  getPresetCamera,
  getScopeIndices,
  readTreeAttributes,
  settleFieldDetailGovernor,
  updateFieldDetailGovernor
} from '../playground-settings';

describe('the interactive tree field', () => {
  it('changes a row without replacing data or changing its neighbours', () => {
    const trees = createPlaygroundField(20000);
    const tree = trees[10000];
    const crop = tree.crop;
    const position = tree.position;
    const indices = getScopeIndices(trees, 10000, 'row');
    applyAttributePatch(trees, indices, {growth: 0.4, foliage: 0.3, cropSize: 0.07});
    expect(indices.length).toBeGreaterThan(1);
    expect(trees[10000]).toBe(tree);
    expect(tree.crop).toBe(crop);
    expect(tree.position).toBe(position);
    expect(tree.growth).toBe(0.4);
    expect(tree.crop?.radius).toBe(0.07);
    expect(trees.filter(item => item.growth === 0.4)).toHaveLength(indices.length);
    const neighbour = trees.find(item => item.row !== tree.row);
    expect(neighbour?.crop?.radius).toBe(0.04);
    expect(neighbour?.foliage).toBe(1);
  });

  it('keeps selected edits local and rejects invalid values', () => {
    const trees = createPlaygroundField(8);
    const indices = getScopeIndices(trees, 3, 'selected');
    applyAttributePatch(trees, indices, {health: -1, damage: 3, cropCount: 250, flush: Number.NaN});
    expect(readTreeAttributes(trees[3])).toMatchObject({
      health: 0,
      damage: 1,
      cropCount: 250,
      flush: 0
    });
    expect(trees[2].health).toBe(1);
    expect(trees[2].crop?.count).toBe(80);
    expect(getScopeIndices(trees, -1, 'all')).toEqual([]);
  });

  it('updates all 20,000 trees, including separate crop and lean states', () => {
    const trees = createPlaygroundField();
    const all = getScopeIndices(trees, 0, 'all');
    applyAttributePatch(trees, all, {leanAngle: 24, leanBearing: 60, cropCount: 0});
    expect(all).toHaveLength(20000);
    expect(trees.every(tree => tree.lean[0] === 24 && tree.crop?.count === 0)).toBe(true);
    applyAttributePatch(trees, [0], {leanAngle: 2, cropCount: 10});
    expect(trees[1].lean[0]).toBe(24);
    expect(trees[1].crop?.count).toBe(0);
  });

  it('round trips the orbit controller through the field scheduler camera', () => {
    const camera = {east: 30, north: -12, up: 4, zoom: 20.2, pitch: 73, bearing: -112};
    const roundTrip = getFieldCamera(getOrbitCamera(camera));
    expect(roundTrip.zoom).toBeCloseTo(camera.zoom, 10);
    expect({...roundTrip, zoom: camera.zoom}).toEqual(camera);
  });

  it('zooms from the orchard into the selected tree and keeps presets finite', () => {
    const trees = createPlaygroundField();
    const overview = getPresetCamera('overview', trees, 10000, 1000);
    const tree = getPresetCamera('tree', trees, 10000, 1000);
    const leaf = getPresetCamera('leaf', trees, 10000, 1000);
    expect(overview.target).toEqual([0, 0, 0]);
    expect(tree.target.slice(0, 2)).toEqual(trees[10000].position.slice(0, 2));
    expect(leaf.zoom).toBeGreaterThan(tree.zoom);
    expect(tree.zoom).toBeGreaterThan(overview.zoom);
    expect(Object.values(getFieldCamera(leaf)).every(Number.isFinite)).toBe(true);
  });
});

describe('the field detail governor', () => {
  function runFrames(state, duration: number, count: number, from = 0) {
    let now = from;
    for (let index = 0; index < count; index++) {
      now += duration;
      updateFieldDetailGovernor(state, duration, now);
    }
    return now;
  }

  it('excludes startup and camera-jump samples before adapting sustained load', () => {
    const state = createFieldDetailGovernor();
    let now = runFrames(state, 80, 30);
    expect(state.bias).toBe(0);
    now = runFrames(state, 30, 80, now);
    expect(state.bias).toBeGreaterThan(0);
    const bias = state.bias;
    settleFieldDetailGovernor(state, now);
    runFrames(state, 100, 30, now);
    expect(state.bias).toBe(bias);
    expect(state.samples).toBe(0);
  });

  it('does not chatter at the budget boundary or respond to an isolated CPU spike', () => {
    const state = createFieldDetailGovernor();
    let now = runFrames(state, 1000 / 60, 100);
    now = runFrames(state, 1000, 1, now);
    now = runFrames(state, 1000 / 60, 120, now);
    expect(state.bias).toBe(0);
    const boundary = createFieldDetailGovernor(now, 1);
    for (let index = 0; index < 180; index++) {
      now += index % 2 ? 17.5 : 16;
      updateFieldDetailGovernor(boundary, index % 2 ? 17.5 : 16, now);
    }
    expect(boundary.bias).toBe(1);
  });

  it('bounds overload and backs off near residency only after maximum bias', () => {
    const state = createFieldDetailGovernor();
    runFrames(state, 50, 400);
    expect(state.bias).toBe(3);
    expect(state.nearScale).toBe(0.25);
    expect(state.lastAdjustMs).toBeGreaterThan(0);
  });

  it('recovers slowly after sustained headroom, restoring residency before more geometry', () => {
    const state = createFieldDetailGovernor(0, 2);
    state.nearScale = 0.5;
    let now = runFrames(state, 8, 30);
    now = runFrames(state, 8, 300, now);
    expect(state.bias).toBe(2);
    expect(state.nearScale).toBe(0.5);
    now = runFrames(state, 8, 150, now);
    expect(state.nearScale).toBe(1);
    expect(state.bias).toBe(2);
    runFrames(state, 8, 1800, now);
    expect(state.bias).toBeLessThan(2);
    expect(state.bias).toBeGreaterThanOrEqual(0);
    expect(updateFieldDetailGovernor(state, Number.NaN, now)).toBe(state.bias);
  });

  it('recovers quality at a vsync-limited 60 Hz after load disappears', () => {
    const state = createFieldDetailGovernor();
    let now = runFrames(state, 50, 400);
    expect(state.bias).toBe(3);
    expect(state.nearScale).toBe(0.25);
    now = runFrames(state, 1000 / 60, 900, now);
    expect(state.nearScale).toBeGreaterThan(0.25);
    runFrames(state, 1000 / 60, 6000, now);
    expect(state.bias).toBe(0);
    expect(state.nearScale).toBe(1);
  });

  it('rolls back an overloaded quality probe and cools down instead of oscillating', () => {
    const state = createFieldDetailGovernor(0, 1);
    let now = 0;
    while (!state.probe && now < 10000) {
      now += 1000 / 60;
      updateFieldDetailGovernor(state, 1000 / 60, now);
    }
    expect(state.probe).not.toBeNull();
    expect(state.bias).toBe(0.75);
    while (state.probe && now < 12000) {
      now += 30;
      updateFieldDetailGovernor(state, 30, now);
    }
    expect(state.bias).toBe(1);
    expect(state.probe).toBeNull();
    runFrames(state, 1000 / 60, 300, now);
    expect(state.bias).toBe(1);
    expect(state.probe).toBeNull();
  });
});
