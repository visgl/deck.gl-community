// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it, vi} from 'vitest';
import {TreeWoodLayer} from '../../../modules/layers/src/tree-layer/tree-wood-layer';
import {createTreeProfiler} from './tree-profiler';

it('shares one wrapper and restores methods after overlapping hosts dispose out of order', () => {
  const target = TreeWoodLayer.prototype as unknown as {prepareShadow(this: unknown): void};
  const stub = vi.spyOn(target, 'prepareShadow').mockImplementation(() => {});
  const original = target.prepareShadow;
  const first = createTreeProfiler();
  const wrapper = target.prepareShadow;
  const second = createTreeProfiler();
  const owner = {props: {data: [1, 2]}, state: {shadow: [1]}};
  try {
    expect(target.prepareShadow).toBe(wrapper);
    target.prepareShadow.call(owner);
    first.dispose();
    target.prepareShadow.call(owner);
    expect(first.read()['wood.prepareShadow'].calls).toBe(1);
    expect(second.read()['wood.prepareShadow']).toMatchObject({
      calls: 2,
      inputOwners: 4,
      selectedOwners: 2
    });
    expect(target.prepareShadow).toBe(wrapper);
    second.dispose();
    expect(target.prepareShadow).toBe(original);
    first.dispose();
    expect(target.prepareShadow).toBe(original);
    const next = createTreeProfiler();
    target.prepareShadow.call(owner);
    expect(next.read()['wood.prepareShadow'].calls).toBe(1);
    next.dispose();
    expect(target.prepareShadow).toBe(original);
  } finally {
    first.dispose();
    second.dispose();
    stub.mockRestore();
  }
});
