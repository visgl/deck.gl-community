// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it} from 'vitest';
import {SplatRuntime} from '../../src/splat-layer/splat-runtime';
import type {SplatHierarchy} from '../../src/splat-layer/splat-hierarchy';
const hierarchy = (counts: number[]): SplatHierarchy =>
  counts.map((count, i) => ({
    error: i * 10,
    source: {positions: new Float32Array(count * 3)} as any
  }));

it('allocates one parent cap across differently sized sources by screen error rather than row count', () => {
  const runtime = SplatRuntime.get({}, {});
  const group = {maxSplats: 160, maxShadowSplats: 40};
  const selected = new Map<string, any[]>();
  const near = hierarchy([100, 10]);
  const far = hierarchy([1000, 10]);
  for (const [id, levels, pixels] of [
    ['near', near, 100],
    ['far', far, 1]
  ] as const)
    runtime.set(id, false, {
      rows: [{owner: id, pixels, level: 0, blend: 0}],
      hierarchy: () => levels,
      maxSplats: Infinity,
      maxTotalSplats: Infinity,
      group,
      apply: rows => selected.set(id, rows)
    });
  runtime.reconcile(new Set(['near', 'far']));
  expect(selected.get('near')![0].level).toBe(0);
  expect(selected.get('far')![0].level).toBe(1);
  expect(selected.get('near')![0].owner).toBe('near');
  expect(selected.get('far')![0].owner).toBe('far');
});

it('respects local, nested and strictest global ceilings and removes finalized or hidden demand', () => {
  const deck = {},
    device = {};
  const runtime = SplatRuntime.get(deck, device);
  expect(SplatRuntime.get(deck, device)).toBe(runtime);
  expect(SplatRuntime.get(deck, {})).not.toBe(runtime);
  const levels = hierarchy([100, 10]);
  const parent = {maxSplats: 30, maxShadowSplats: 30};
  const group = {maxSplats: 1000, maxShadowSplats: 1000, parent};
  const selected = new Map<string, any[]>();
  for (const id of ['a', 'b'])
    runtime.set(id, false, {
      rows: [{owner: id, pixels: 10, level: 0, blend: 0}],
      hierarchy: () => levels,
      maxSplats: 1000,
      maxTotalSplats: id === 'a' ? 1000 : 30,
      group,
      apply: rows => selected.set(id, rows)
    });
  runtime.reconcile(new Set(['a', 'b']));
  expect([...selected.values()].map(rows => rows[0].level)).toEqual([1, 1]);
  runtime.delete('a');
  selected.clear();
  runtime.reconcile(new Set(['a']));
  expect(selected.size).toBe(0);
});

it('reallocates when a shared cap changes or its restrictive registration disappears', () => {
  const runtime = SplatRuntime.get({}, {});
  const levels = hierarchy([100, 10]);
  const group = {maxSplats: 30, maxShadowSplats: 30};
  const selected = new Map<string, any[]>();
  for (const id of ['a', 'b'])
    runtime.set(id, false, {
      rows: [{owner: id, pixels: 10, level: 0, blend: 0}],
      hierarchy: () => levels,
      maxSplats: Infinity,
      maxTotalSplats: id === 'a' ? 30 : Infinity,
      group,
      apply: rows => selected.set(id, rows)
    });
  runtime.reconcile(new Set(['a', 'b']));
  expect(selected.get('b')![0].level).toBe(1);
  group.maxSplats = 1000;
  runtime.reconcile(new Set(['b']));
  expect(selected.get('b')![0].level).toBe(0);
  runtime.reconcile(new Set(['a', 'b']));
  expect(selected.get('b')![0].level).toBe(1);
  runtime.delete('a');
  runtime.reconcile(new Set(['a', 'b']));
  expect(selected.get('b')![0].level).toBe(0);
  group.maxSplats = 30;
  runtime.reconcile(new Set(['b']));
  expect(selected.get('b')![0].level).toBe(1);
});

it('shares a strict host cap with scene demand and releases the reservation when scenes hide', () => {
  const runtime = SplatRuntime.get({}, {});
  const levels = hierarchy([100, 10]);
  let rows: any[] = [];
  runtime.set('prepared', false, {
    rows: [{owner: 'tree', pixels: 10, level: 0, blend: 0}],
    hierarchy: () => levels,
    maxSplats: 100,
    maxTotalSplats: 100,
    apply: selected => {
      rows = selected;
    }
  });
  const ids = new Set(['prepared']);
  expect(
    runtime
      .setSceneDemands(ids, [{id: 'scene', desired: 100, floor: 10, maxTotalSplats: 100}])
      .get('scene')
  ).toBe(50);
  runtime.reconcile(ids);
  expect(rows[0].level).toBe(1);
  expect(runtime.setSceneDemands(ids, []).size).toBe(0);
  runtime.reconcile(ids);
  expect(rows[0].level).toBe(1);
  runtime.set('prepared', false, {
    rows: [{owner: 'tree', pixels: 10, level: 0, blend: 0}],
    hierarchy: () => levels,
    maxSplats: Infinity,
    maxTotalSplats: Infinity,
    apply: selected => {
      rows = selected;
    }
  });
  runtime.setSceneDemands(ids, []).size;
  runtime.reconcile(ids);
  expect(rows[0].level).toBe(0);
});

it('charges sibling scenes and prepared members once against their nested parent cap', () => {
  const runtime = SplatRuntime.get({}, {});
  const parent = {maxSplats: 120, maxShadowSplats: Infinity};
  const first = {maxSplats: 1000, maxShadowSplats: Infinity, parent};
  const second = {maxSplats: 1000, maxShadowSplats: Infinity, parent};
  const scenes = [
    {id: 'a', desired: 100, floor: 10, maxTotalSplats: Infinity, group: first},
    {id: 'b', desired: 100, floor: 10, maxTotalSplats: Infinity, group: second}
  ];
  expect([...runtime.setSceneDemands(new Set(), scenes).values()]).toEqual([60, 60]);
  let selected: any[] = [];
  let preparedBudget = Infinity;
  runtime.set('prepared', false, {
    rows: [{owner: 'tree', pixels: 10, level: 0, blend: 0}],
    hierarchy: () => hierarchy([100, 10]),
    maxSplats: Infinity,
    maxTotalSplats: Infinity,
    group: first,
    apply: (rows, budget) => {
      selected = rows;
      preparedBudget = budget;
    }
  });
  const ids = new Set(['prepared']);
  expect([...runtime.setSceneDemands(ids, scenes).values()]).toEqual([40, 40]);
  runtime.reconcile(ids);
  expect(selected[0].level).toBe(1);
  expect(preparedBudget + 80).toBeLessThanOrEqual(parent.maxSplats);
  expect(runtime.setSceneDemands(new Set(), [scenes[0]]).get('a')).toBe(100);
  parent.maxSplats = 50;
  expect([...runtime.setSceneDemands(new Set(), scenes).values()]).toEqual([25, 25]);
  // Complete static/coarse coverage is retained when a soft cap is below the floor.
  expect(runtime.setSceneDemands(new Set(), [{...scenes[0], floor: 60}]).get('a')).toBe(60);
});
