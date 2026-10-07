// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it} from 'vitest';
import {SplatRefinementTransition} from '../../src/splat-layer/splat-refinement-transition';
const counts = [1000, 100, 10];
const cost = (transition: SplatRefinementTransition<string>) =>
  [...transition.entries.values()].reduce(
    (sum, entry) =>
      sum + entry.weights.reduce((n, weight, level) => n + (weight > 0 ? counts[level] : 0), 0),
    0
  );
const target = (level: number, blend = 0) => [{owner: 'tree', pixels: 10, level, blend}];
it('keeps optical mass continuous when budget or camera retargets a crown mid-refinement', () => {
  const transition = new SplatRefinementTransition<string>();
  transition.reconcile(target(2), counts, 1200, owner => owner);
  transition.sample(1);
  transition.reconcile(target(0), counts, 1200, owner => owner);
  const before = [...transition.entries.get('tree')!.weights];
  transition.sample(17);
  const refined = [...transition.entries.get('tree')!.weights];
  expect(refined[0]).toBeGreaterThan(0);
  expect(refined[0]).toBeLessThan(0.2);
  expect(refined.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
  transition.reconcile(target(1), counts, 1200, owner => owner);
  expect(transition.entries.get('tree')!.weights).toEqual(refined);
  transition.sample(33);
  expect(transition.entries.get('tree')!.weights[1]).toBeGreaterThan(0);
  expect(before).toEqual([0, 0, 1]);
  expect(cost(transition)).toBeLessThanOrEqual(1200);
  for (let now = 49; now < 6000; now += 16) transition.sample(now);
  expect(transition.active).toBe(false);
  expect(transition.entries.get('tree')!.weights).toEqual([0, 1, 0]);
});
it('reserves submissions for mixtures, retaining coverage and making progress after a forced budget reduction', () => {
  const transition = new SplatRefinementTransition<string>();
  transition.reconcile(target(0), counts, 1200, owner => owner);
  transition.sample(1);
  transition.reconcile(target(2), counts, 100, owner => owner);
  transition.sample(17);
  expect(cost(transition)).toBe(1010);
  for (let now = 33; now < 6000; now += 16) transition.sample(now);
  expect(cost(transition)).toBe(10);
  expect(transition.entries.get('tree')!.weights).toEqual([0, 0, 1]);
  transition.reconcile([], counts, 100, owner => owner);
  expect(transition.entries.size).toBe(0);
});
it('retains pose identity across streamed wrapper replacements and limits the first step after an idle gap', () => {
  const transition = new SplatRefinementTransition<string>();
  transition.reconcile(target(2), counts, 1200, () => 'pose');
  transition.sample(1);
  transition.reconcile(
    [{owner: 'replacement', pixels: 30, level: 0, blend: 0}],
    counts,
    1200,
    () => 'pose'
  );
  expect(transition.entries.get('pose')!.owner).toBe('replacement');
  expect(transition.entries.get('pose')!.weights).toEqual([0, 0, 1]);
  transition.sample(10000);
  expect(transition.entries.get('pose')!.weights[0]).toBeLessThan(0.4);
});

it('does not deadlock a forced reduction to an intermediate aggregate that costs more than the coverage floor', () => {
  const transition = new SplatRefinementTransition<string>();
  transition.reconcile(target(0), counts, 1200, owner => owner);
  transition.sample(1);
  transition.reconcile(target(1), counts, 200, owner => owner);
  transition.sample(17);
  expect(transition.entries.get('tree')!.weights[1]).toBeGreaterThan(0);
  for (let now = 33; now < 6000; now += 16) transition.sample(now);
  expect(transition.active).toBe(false);
  expect(cost(transition)).toBe(100);
});
