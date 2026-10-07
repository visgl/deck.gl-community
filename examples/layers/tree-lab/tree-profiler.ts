// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {SplatLayer} from '../../../modules/layers/src/splat-layer/splat-layer';
import {TreeWoodLayer} from '../../../modules/layers/src/tree-layer/tree-wood-layer';

type ProfileLayer = {
  props: {data: unknown[]};
  state: {shadow?: unknown[]; shadowGroups?: unknown[][]};
};
type ProfileMethod = (this: ProfileLayer, ...args: unknown[]) => unknown;
type Sample = {calls: number; milliseconds: number; selectedOwners: number; inputOwners: number};

/** Opt-in CPU attribution for the single-renderer benchmark; never enabled by the forest demo. */
export function createTreeProfiler() {
  let samples: Record<string, Sample> = {};
  for (const [prototype, prefix] of [
    [TreeWoodLayer.prototype, 'wood'],
    [SplatLayer.prototype, 'canopy']
  ] as const) {
    for (const method of prefix === 'canopy'
      ? ['updateState', 'prepareShadow', 'updateRefinement', 'getRefinementGroups', 'renderLayers']
      : ['updateState', 'prepareShadow']) {
      const target = prototype as unknown as Record<typeof method, ProfileMethod>;
      const original = target[method];
      const label = `${prefix}.${method}`;
      target[method] = function (...args: unknown[]) {
        const start = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          samples[label] ??= {
            calls: 0,
            milliseconds: 0,
            selectedOwners: 0,
            inputOwners: 0
          };
          const sample = samples[label];
          sample.calls++;
          sample.milliseconds += performance.now() - start;
          sample.inputOwners += this.props.data.length;
          if (method === 'prepareShadow') {
            const state = this.state;
            sample.selectedOwners +=
              prefix === 'wood'
                ? (state.shadow?.length ?? 0)
                : (state.shadowGroups ?? []).reduce((sum, rows) => sum + rows.length, 0);
          }
        }
      };
    }
  }
  return {
    reset() {
      samples = {};
    },
    read() {
      return structuredClone(samples);
    }
  };
}
