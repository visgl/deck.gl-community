// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Value: protects=benchmark query values cannot inject HTML or reach rendering as invalid detail;
// fails_when=untrusted detail is interpolated into markup or bypasses the supported values;
// why_new=the visual lab regression does not mount the separate benchmark entry point; seam=none

import type {Deck} from '@deck.gl/core';
import {TreeLayer} from '@deck.gl-community/layers';
import {expect, it} from 'vitest';
import {mountTreeBenchmark} from './benchmark';

type BenchmarkApi = {ready: boolean; errors: string[]; deck: Deck};

it.each([
  [
    '<img id="tree-query-injection" src="data:," onerror="document.documentElement.dataset.treeQueryInjected=1">',
    'high'
  ],
  ['invalid', 'high'],
  ['medium', 'medium'],
  ['low', 'low']
])('renders benchmark detail safely for %s', async (detail, expectedDetail) => {
  const originalUrl = location.href;
  const queryUrl = new URL(originalUrl);
  queryUrl.search = '';
  queryUrl.searchParams.set('count', '1');
  queryUrl.searchParams.set('detail', detail);
  history.replaceState(null, '', queryUrl);
  const parent = document.createElement('div');
  parent.id = 'app';
  parent.style.width = '640px';
  parent.style.height = '480px';
  document.body.append(parent);
  mountTreeBenchmark(TreeLayer, 'native');
  const api = (window as Window & {treeBenchmark?: BenchmarkApi}).treeBenchmark!;
  try {
    expect(parent.querySelector('#tree-query-injection')).toBeNull();
    expect(parent.querySelector('p')!.textContent).toContain(`${expectedDetail} detail`);
    await expect.poll(() => api.ready, {timeout: 15000}).toBe(true);
    expect(api.errors).toEqual([]);
    const layers = api.deck.props.layers as TreeLayer[];
    expect(layers[1].props.detail).toBe(expectedDetail);
    expect(document.documentElement.dataset.treeQueryInjected).toBeUndefined();
  } finally {
    api.deck.finalize();
    parent.remove();
    delete document.documentElement.dataset.treeQueryInjected;
    history.replaceState(null, '', originalUrl);
  }
});
