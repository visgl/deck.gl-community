// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it} from 'vitest';
import {
  resolveSplatBudget,
  SETTLED_SPLAT_BUDGET_FRACTION,
  SplatRuntime,
  type SplatBudgetGroup
} from '../../src/splat-layer/splat-runtime';
import type {SplatHierarchy} from '../../src/splat-layer/splat-hierarchy';
const hierarchy = (counts: number[]): SplatHierarchy =>
  counts.map((count, i) => ({
    error: i * 10,
    source: {positions: new Float32Array(count * 3)} as any
  }));

it('spends 90% of a public cap on settled detail while retaining the full cap for transitions', () => {
  const runtime = SplatRuntime.get({}, {});
  const applied: {rows: any[]; budget: number}[] = [];
  runtime.set('one', {
    rows: [{owner: 'one', pixels: 10, level: 0, blend: 0}],
    hierarchy: () => hierarchy([90, 10]),
    maxSplats: 100,
    maxTotalSplats: 100,
    apply: (rows, budget) => applied.push({rows, budget})
  });

  runtime.reconcile(new Set(['one']));

  expect(SETTLED_SPLAT_BUDGET_FRACTION).toBe(0.9);
  expect(applied).toHaveLength(1);
  expect(applied[0].rows[0].level).toBe(0);
  expect(applied[0].budget).toBe(100);
});

it('resolves an automatic shared cap once per device without changing explicit caps', () => {
  const softwareDevice = {
    info: {fallback: true, gpu: 'software' as const, gpuType: 'cpu' as const}
  };
  const gpuDevice = {
    info: {fallback: false, gpu: 'apple' as const, gpuType: 'integrated' as const}
  };
  expect(resolveSplatBudget('auto', softwareDevice)).toBe(5_000);
  expect(resolveSplatBudget(undefined, softwareDevice)).toBe(5_000);
  expect(resolveSplatBudget('auto', gpuDevice)).toBe(20_000);
  expect(resolveSplatBudget(1_234, softwareDevice)).toBe(1_234);

  const runtime = SplatRuntime.get({}, softwareDevice);
  const group: SplatBudgetGroup = {maxSplats: 'auto'};
  const selected: any[] = [];
  runtime.set('software-auto', {
    rows: [{owner: 'tree', pixels: 10, level: 0, blend: 0}],
    hierarchy: () => hierarchy([10_000, 1_000]),
    maxSplats: Infinity,
    maxTotalSplats: Infinity,
    group,
    apply: rows => selected.push(...rows)
  });
  runtime.reconcile(new Set(['software-auto']));
  expect(selected[0].level).toBe(1);
});

it('allocates one parent cap across differently sized sources by screen error rather than row count', () => {
  const runtime = SplatRuntime.get({}, {});
  const group = {maxSplats: 160};
  const selected = new Map<string, any[]>();
  const near = hierarchy([100, 10]);
  const far = hierarchy([1000, 10]);
  for (const [id, levels, pixels] of [
    ['near', near, 100],
    ['far', far, 1]
  ] as const)
    runtime.set(id, {
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
  const parent = {maxSplats: 30};
  const group = {maxSplats: 1000, parent};
  const selected = new Map<string, any[]>();
  for (const id of ['a', 'b'])
    runtime.set(id, {
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
  const group = {maxSplats: 30};
  const selected = new Map<string, any[]>();
  for (const id of ['a', 'b'])
    runtime.set(id, {
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

it('returns each registration its own contiguous allocation, even when owner values coincide', () => {
  const runtime = SplatRuntime.get({}, {});
  const group = {maxSplats: 250};
  const selected = new Map<string, any[]>();
  const fine = hierarchy([200, 10]);
  const coarse = hierarchy([100, 10]);
  const demands = {
    a: [
      {owner: 'tree', pixels: 1, level: 0, blend: 0},
      {owner: 'tree', pixels: 100, level: 0, blend: 0}
    ],
    b: [{owner: 'tree', pixels: 10, level: 0, blend: 0}]
  };
  for (const [id, rows] of Object.entries(demands))
    runtime.set(id, {
      rows,
      hierarchy: () => (id === 'a' ? fine : coarse),
      maxSplats: Infinity,
      maxTotalSplats: Infinity,
      group,
      apply: allocated => selected.set(id, allocated)
    });
  runtime.reconcile(new Set(['a', 'b']));
  // The settled 225 Gaussian cap funds only the highest-error owner of registration a.
  expect(selected.get('a')!.map(row => [row.owner, row.pixels, row.level])).toEqual([
    ['tree', 1, 1],
    ['tree', 100, 0]
  ]);
  expect(selected.get('b')!.map(row => [row.owner, row.pixels, row.level])).toEqual([
    ['tree', 10, 1]
  ]);

  // A fitting allocation hands back each registration's own rows without copying them.
  group.maxSplats = 10_000;
  runtime.reconcile(new Set(['a', 'b']));
  expect(selected.get('a')).toBe(demands.a);
  expect(selected.get('b')).toBe(demands.b);
});
