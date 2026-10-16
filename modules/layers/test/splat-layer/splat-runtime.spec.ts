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
